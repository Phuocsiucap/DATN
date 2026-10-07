from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.services import generate_video as video_pipeline
from common.db.models import KafkaTask, MediaWorkflow, PublishingQueueItem

logger = logging.getLogger(__name__)

ACTIVE_QUEUE_STATUSES = {"queued", "approved", "publishing", "needs_approval", "changes_requested"}
ACTIVE_WORKFLOW_STATUSES = {"RENDERING", "EDITING", "VIDEO_APPROVED", "SCRIPTING", "REVIEWING"}
FINAL_ARTIFACT_TYPES = {"FINAL_VIDEO"}

DEFAULT_RETENTION_DAYS = {
    "rendered_unqueued": 7,
    "published": 30,
    "inbox_published": 14,
    "failed_or_cancelled": 7,
}


@dataclass
class RetentionResult:
    checked: int = 0
    purged: int = 0
    skipped: int = 0
    failed: int = 0
    bytes_freed: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "checked": self.checked,
            "purged": self.purged,
            "skipped": self.skipped,
            "failed": self.failed,
            "bytes_freed": self.bytes_freed,
        }


def run_video_artifact_retention_once(db: Session, *, limit: int = 50, now: datetime | None = None) -> dict[str, Any]:
    current = _aware_utc(now)
    result = RetentionResult()
    workflows = (
        db.query(MediaWorkflow)
        .filter(
            MediaWorkflow.artifacts_jsonb.isnot(None),
            or_(
                MediaWorkflow.status.in_(["RENDERED", "PUBLISHED", "FAILED", "REJECTED", "QUEUED_FOR_PUBLISHING"]),
                MediaWorkflow.metadata_json["artifact_lifecycle"].astext.in_(["ACTIVE", "PUBLISHED", "EXPIRED", "QUEUED_FOR_PUBLISHING"]),
            ),
        )
        .order_by(MediaWorkflow.updated_at.asc(), MediaWorkflow.created_at.asc())
        .limit(limit)
        .all()
    )
    for workflow in workflows:
        result.checked += 1
        try:
            outcome = purge_workflow_artifacts_if_expired(db, workflow, now=current)
            db.commit()
            if outcome.get("purged"):
                result.purged += 1
                result.bytes_freed += int(outcome.get("storage_bytes_freed") or 0)
            else:
                result.skipped += 1
        except Exception as exc:
            db.rollback()
            logger.exception("Video artifact retention failed workflow_id=%s: %s", workflow.id, exc)
            result.failed += 1
    return result.as_dict()


def purge_workflow_artifacts_if_expired(
    db: Session,
    workflow: MediaWorkflow,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = _aware_utc(now)
    decision = retention_decision(db, workflow, now=current)
    if not decision["eligible"]:
        metadata = _workflow_metadata(workflow)
        metadata["artifact_lifecycle"] = decision["lifecycle"]
        metadata["retention_reason"] = decision["reason"]
        metadata["retention_checked_at"] = current.isoformat()
        if decision.get("expires_at"):
            metadata["artifact_expires_at"] = decision["expires_at"]
        workflow.metadata_json = metadata
        db.add(workflow)
        return {"purged": False, **decision}

    return purge_workflow_artifacts(db, workflow, reason=decision["reason"], now=current)


def purge_workflow_artifacts(
    db: Session,
    workflow: MediaWorkflow,
    *,
    reason: str = "manual",
    now: datetime | None = None,
) -> dict[str, Any]:
    current = _aware_utc(now)
    guard = active_retention_guard(db, workflow)
    if guard:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=guard)

    artifacts = workflow.artifacts_jsonb if isinstance(workflow.artifacts_jsonb, list) else []
    draft = workflow.draft_json if isinstance(workflow.draft_json, dict) else {}
    paths = _workflow_artifact_paths(artifacts, draft)
    purged_paths: list[str] = []
    bytes_freed = 0

    for raw_path in paths:
        resolved = _resolve_local_artifact_path(raw_path)
        if not resolved or not resolved.exists() or not resolved.is_file():
            continue
        try:
            size = resolved.stat().st_size
            resolved.unlink()
            bytes_freed += size
            purged_paths.append(raw_path)
        except OSError as exc:
            logger.warning("Could not delete video artifact path=%s workflow_id=%s: %s", resolved, workflow.id, exc)

    workflow.artifacts_jsonb = [_mark_artifact_purged(item, current) for item in artifacts]
    workflow.draft_json = _clear_draft_video_artifacts(draft)
    metadata = _workflow_metadata(workflow)
    metadata["artifact_lifecycle"] = "PURGED"
    metadata["artifact_purged_at"] = current.isoformat()
    metadata["purged_paths"] = purged_paths
    metadata["retention_reason"] = reason
    metadata["storage_bytes_freed"] = int(metadata.get("storage_bytes_freed") or 0) + bytes_freed
    metadata.pop("rendered_video", None)
    workflow.metadata_json = metadata
    if workflow.status == "RENDERED":
        workflow.current_stage = "ARTIFACT_PURGED"
    db.add(workflow)
    return {
        "purged": True,
        "workflow_id": str(workflow.id),
        "purged_paths": purged_paths,
        "storage_bytes_freed": bytes_freed,
        "artifact_lifecycle": "PURGED",
    }


def retention_decision(db: Session, workflow: MediaWorkflow, *, now: datetime | None = None) -> dict[str, Any]:
    current = _aware_utc(now)
    metadata = _workflow_metadata(workflow)
    if metadata.get("artifact_lifecycle") == "PURGED":
        return {"eligible": False, "lifecycle": "PURGED", "reason": "already_purged"}

    guard = active_retention_guard(db, workflow)
    if guard:
        lifecycle = "QUEUED_FOR_PUBLISHING" if _has_active_queue_item(db, workflow) else "ACTIVE"
        return {"eligible": False, "lifecycle": lifecycle, "reason": guard}

    queue_item = _latest_queue_item(db, workflow)
    if queue_item and (queue_item.status or "").lower() == "published":
        published_at = _aware_utc(queue_item.published_at or queue_item.updated_at or queue_item.created_at)
        mode = str((queue_item.publish_status_jsonb or {}).get("mode") or "").lower()
        ttl_days = DEFAULT_RETENTION_DAYS["inbox_published"] if mode == "inbox" else DEFAULT_RETENTION_DAYS["published"]
        expires_at = published_at + timedelta(days=ttl_days)
        return _expiry_payload(current, expires_at, "PUBLISHED", f"published_ttl_{ttl_days}d", pending_lifecycle="PUBLISHED")

    if (workflow.status or "").upper() in {"FAILED", "REJECTED", "CANCELLED"}:
        base = _aware_utc(workflow.updated_at or workflow.created_at)
        ttl_days = DEFAULT_RETENTION_DAYS["failed_or_cancelled"]
        return _expiry_payload(current, base + timedelta(days=ttl_days), "EXPIRED", f"failed_cancelled_ttl_{ttl_days}d")

    final_artifact = _latest_final_artifact(workflow)
    if final_artifact:
        created_at = _parse_dt(final_artifact.get("created_at")) or _aware_utc(workflow.updated_at or workflow.created_at)
        ttl_days = DEFAULT_RETENTION_DAYS["rendered_unqueued"]
        return _expiry_payload(current, created_at + timedelta(days=ttl_days), "EXPIRED", f"rendered_unqueued_ttl_{ttl_days}d")

    return {"eligible": False, "lifecycle": "ACTIVE", "reason": "no_purgeable_artifacts"}


def active_retention_guard(db: Session, workflow: MediaWorkflow) -> str | None:
    if (workflow.status or "").upper() in ACTIVE_WORKFLOW_STATUSES:
        return f"workflow_active:{workflow.status}"
    active_task = (
        db.query(KafkaTask.id)
        .filter(
            KafkaTask.reference_id == workflow.id,
            KafkaTask.reference_type == "media_workflow",
            KafkaTask.status.in_(["PENDING", "RUNNING", "PROCESSING"]),
        )
        .first()
    )
    if active_task:
        return "workflow_has_active_task"
    if _has_active_queue_item(db, workflow):
        return "queue_item_active"
    return None


def _expiry_payload(
    current: datetime,
    expires_at: datetime,
    lifecycle: str,
    reason: str,
    *,
    pending_lifecycle: str = "ACTIVE",
) -> dict[str, Any]:
    return {
        "eligible": current >= expires_at,
        "lifecycle": lifecycle if current >= expires_at else pending_lifecycle,
        "reason": reason,
        "expires_at": expires_at.isoformat(),
    }


def _workflow_metadata(workflow: MediaWorkflow) -> dict[str, Any]:
    return dict(workflow.metadata_json) if isinstance(workflow.metadata_json, dict) else {}


def _latest_queue_item(db: Session, workflow: MediaWorkflow) -> PublishingQueueItem | None:
    return (
        db.query(PublishingQueueItem)
        .filter(PublishingQueueItem.workflow_id == workflow.id)
        .order_by(PublishingQueueItem.updated_at.desc(), PublishingQueueItem.created_at.desc())
        .first()
    )


def _has_active_queue_item(db: Session, workflow: MediaWorkflow) -> bool:
    return bool(
        db.query(PublishingQueueItem.id)
        .filter(
            PublishingQueueItem.workflow_id == workflow.id,
            PublishingQueueItem.status.in_(ACTIVE_QUEUE_STATUSES),
        )
        .first()
    )


def _latest_final_artifact(workflow: MediaWorkflow) -> dict[str, Any] | None:
    artifacts = workflow.artifacts_jsonb if isinstance(workflow.artifacts_jsonb, list) else []
    candidates = [
        item for item in artifacts
        if isinstance(item, dict)
        and item.get("uri")
        and item.get("status") not in {"STALE", "PURGED"}
        and (item.get("type") in FINAL_ARTIFACT_TYPES or item.get("artifact_type") in FINAL_ARTIFACT_TYPES)
    ]
    candidates.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return candidates[0] if candidates else None


def _workflow_artifact_paths(artifacts: list[Any], draft: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    for item in artifacts:
        if not isinstance(item, dict) or item.get("status") == "PURGED":
            continue
        if item.get("uri"):
            paths.append(str(item["uri"]))
    story_artifacts = draft.get("video_artifacts") if isinstance(draft.get("video_artifacts"), dict) else {}
    if story_artifacts.get("final"):
        paths.append(str(story_artifacts["final"]))
    audio = draft.get("audio") if isinstance(draft.get("audio"), dict) else {}
    if audio.get("voice"):
        paths.append(str(audio["voice"]))
    timeline = draft.get("timeline") if isinstance(draft.get("timeline"), dict) else {}
    for clip in timeline.get("audio") if isinstance(timeline.get("audio"), list) else []:
        if isinstance(clip, dict) and clip.get("src"):
            paths.append(str(clip["src"]))
    return list(dict.fromkeys(paths))


def _resolve_local_artifact_path(value: str) -> Path | None:
    raw = value.strip()
    if not raw or "://" in raw or raw.startswith("//"):
        return None
    output_prefix = "/api/v1/generate-video/output/"
    media_prefix = "/api/v1/generate-video/media/"
    if raw.startswith(output_prefix):
        raw = "out/" + raw[len(output_prefix):]
    elif raw.startswith(media_prefix):
        raw = "public/" + raw[len(media_prefix):]

    candidate = Path(raw)
    if candidate.is_absolute():
        resolved = candidate.resolve()
    elif raw.startswith("out/") or raw.startswith("out\\"):
        resolved = (video_pipeline.RENDER_WORKSPACE_ROOT / raw).resolve()
    elif raw.startswith("public/") or raw.startswith("public\\"):
        resolved = (video_pipeline.RENDER_WORKSPACE_ROOT / raw).resolve()
    else:
        resolved = (video_pipeline.PUBLIC_DIR / raw).resolve()

    workspace_root = video_pipeline.RENDER_WORKSPACE_ROOT.resolve()
    try:
        if not resolved.is_relative_to(workspace_root):
            return None
    except AttributeError:
        if not str(resolved).startswith(str(workspace_root)):
            return None
    return resolved


def _mark_artifact_purged(item: Any, purged_at: datetime) -> Any:
    if not isinstance(item, dict):
        return item
    if item.get("uri") and (item.get("type") in FINAL_ARTIFACT_TYPES or item.get("artifact_type") in FINAL_ARTIFACT_TYPES):
        next_item = dict(item)
        next_item["status"] = "PURGED"
        next_item["purged_at"] = purged_at.isoformat()
        return next_item
    return item


def _clear_draft_video_artifacts(draft: dict[str, Any]) -> dict[str, Any]:
    if not draft:
        return draft
    next_draft = dict(draft)
    story_artifacts = dict(next_draft.get("video_artifacts") or {})
    story_artifacts.pop("final", None)
    if story_artifacts:
        next_draft["video_artifacts"] = story_artifacts
    else:
        next_draft.pop("video_artifacts", None)
    return next_draft


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return _aware_utc(value)
    if not value:
        return None
    try:
        return _aware_utc(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        return None


def _aware_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
