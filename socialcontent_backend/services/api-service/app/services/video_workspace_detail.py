from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from common.db.media_workflows import _load_content_full_text
from common.db.models import ContentItem, ContentSeries, KafkaTask, MediaWorkflow, SocialProfile, User
from common.planning.auto_draft_policy import auto_production_allowed, is_auto_workflow
from app.services.media_workflows import get_owned_workflow
from app.services.video_workspace_list import (
    ACTIVE_TASK_STATUS_PRIORITY,
    ACTIVE_TASK_STATUSES,
    VIDEO_RUN_TYPES,
)


WORKSPACE_METADATA_KEYS = {
    "selection_mode", "creation_source", "workflow_type", "primary_source", "source_count",
    "source_type", "bilibili_episode_indices", "target_episode_indices", "series_title",
    "season_id", "ocr_queue", "note", "crawl_job_id", "content_angle", "target_audience",
    "tone", "format", "target_duration_seconds", "recommended_part_count", "confidence_score",
    "risk_level", "ai_reasoning", "production_requirements", "production_gate", "draft_quality",
    "draft_quality_recheck", "draft_review", "draft_review_approved", "pending_series_decision",
    "series_decision", "series_decision_error", "risk_flags", "video_approved", "video_approved_at",
    "queued_post_id", "queued_at",
}


def get_video_workspace(db: Session, workflow_id: uuid.UUID, user: User) -> dict:
    workflow = get_owned_workflow(db, workflow_id, user, allow_admin=True)

    profile = (
        db.query(SocialProfile.id, SocialProfile.profile_name, SocialProfile.platform)
        .filter(SocialProfile.id == workflow.profile_id)
        .first()
    )
    series = None
    if workflow.series_id:
        series = (
            db.query(
                ContentSeries.id,
                ContentSeries.title,
                ContentSeries.description,
                ContentSeries.status,
                ContentSeries.current_part,
                ContentSeries.total_parts,
            )
            .filter(ContentSeries.id == workflow.series_id)
            .first()
        )
    source = workspace_source_content(db, workflow.primary_content_id)
    draft = workflow.draft_json if isinstance(workflow.draft_json, dict) else {}
    tasks = workflow_tasks(db, workflow.id, limit=20)
    active_task = select_active_task(tasks)
    artifacts = workflow.artifacts_jsonb if isinstance(workflow.artifacts_jsonb, list) else []
    metadata = workflow.metadata_json if isinstance(workflow.metadata_json, dict) else {}
    has_draft = bool(draft.get("timeline") or draft.get("story_data") or draft.get("scenes"))
    has_voice = draft_has_voice(draft)
    is_bilibili_hardsub = metadata.get("workflow_type") == "ORIGINAL_VIDEO_HARDSUB" or metadata.get("source_type") == "BILIBILI"
    final_video = final_video_uri(artifacts)
    production_allowed = workflow.status != "REJECTED" and auto_production_allowed(metadata, draft)
    can_render = has_draft and production_allowed and active_task is None
    if is_bilibili_hardsub:
        can_render = has_draft and workflow.status != "REJECTED" and active_task is None
    auto_review_required = is_auto_workflow(metadata) and has_draft and not production_allowed

    return {
        "id": str(workflow.id),
        "profile": {
            "id": str(profile.id),
            "name": profile.profile_name,
            "platform": profile.platform,
        } if profile else None,
        "series": {
            "id": str(series.id),
            "title": series.title,
            "description": series.description,
            "status": series.status,
            "current_part": series.current_part,
            "total_parts": series.total_parts,
        } if series else None,
        "primary_content_id": str(workflow.primary_content_id) if workflow.primary_content_id else None,
        "title": workflow.title,
        "status": workflow.status,
        "current_stage": workflow.current_stage,
        "progress_percent": float(workflow.progress_percent or 0),
        "planning_mode": workflow.planning_mode or "SINGLE",
        "metadata": {key: metadata[key] for key in WORKSPACE_METADATA_KEYS if key in metadata},
        "artifact_lifecycle": metadata.get("artifact_lifecycle"),
        "artifact_expires_at": metadata.get("artifact_expires_at"),
        "artifact_purged_at": metadata.get("artifact_purged_at"),
        "purged_paths": metadata.get("purged_paths") or [],
        "retention_reason": metadata.get("retention_reason"),
        "storage_bytes_freed": metadata.get("storage_bytes_freed"),
        "source_content": source,
        "inputs": workflow.inputs_jsonb if isinstance(workflow.inputs_jsonb, list) else [],
        "draft": draft,
        "final_video": final_video,
        "tasks": tasks,
        "capabilities": {
            "can_generate_draft": bool(workflow.primary_content_id) and workflow.status != "REJECTED" and active_task is None,
            "can_edit": has_draft and workflow.status != "REJECTED" and active_task is None,
            "can_approve_draft": auto_review_required and workflow.status != "REJECTED" and active_task is None,
            "can_generate_voice": has_draft and production_allowed and active_task is None,
            "can_render": can_render if is_bilibili_hardsub else has_draft and has_voice and production_allowed and active_task is None,
            "can_approve": bool(final_video) and production_allowed and active_task is None,
            "can_queue": bool(final_video) and bool(metadata.get("video_approved")) and production_allowed and active_task is None,
        },
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at or workflow.created_at,
    }


def get_video_workflow_progress(db: Session, workflow_id: uuid.UUID, user: User) -> dict:
    workflow = (
        db.query(
            MediaWorkflow.id,
            SocialProfile.user_id.label("profile_user_id"),
            MediaWorkflow.status,
            MediaWorkflow.current_stage,
            MediaWorkflow.progress_percent,
            MediaWorkflow.updated_at,
            MediaWorkflow.artifacts_jsonb,
        )
        .join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
        .filter(MediaWorkflow.id == workflow_id)
        .first()
    )
    if not workflow or (not user.is_system_admin and workflow.profile_user_id != user.id):
        raise HTTPException(status_code=404, detail="Video workflow not found")
    tasks = workflow_tasks(db, workflow.id, limit=12)
    active_task = select_active_task(tasks)
    effective_task = active_task
    return {
        "workflow_id": str(workflow.id),
        "status": workflow.status,
        "current_stage": (effective_task or {}).get("current_stage") or workflow.current_stage,
        "progress_percent": (effective_task or {}).get("progress_percent") if active_task else float(workflow.progress_percent or 0),
        "tasks": tasks,
        "final_video": final_video_uri(workflow.artifacts_jsonb if isinstance(workflow.artifacts_jsonb, list) else []),
        "updated_at": workflow.updated_at,
    }


def workflow_tasks(db: Session, workflow_id: uuid.UUID, *, limit: int) -> list[dict]:
    rows = (
        db.query(
            KafkaTask.id,
            KafkaTask.reference_id,
            KafkaTask.task_type,
            KafkaTask.status,
            KafkaTask.current_stage,
            KafkaTask.progress_percent,
            KafkaTask.error_message,
            KafkaTask.created_at,
            KafkaTask.started_at,
            KafkaTask.completed_at,
        )
        .filter(
            KafkaTask.reference_type == "media_workflow",
            KafkaTask.reference_id == workflow_id,
            KafkaTask.task_type.in_(VIDEO_RUN_TYPES),
        )
        .order_by(KafkaTask.created_at.desc())
        .limit(limit)
        .all()
    )
    return [serialize_task_row(row) for row in rows]


def select_active_task(tasks: list[dict]) -> dict | None:
    active = [task for task in tasks if task["status"] in ACTIVE_TASK_STATUSES]
    return max(active, key=active_task_sort_key) if active else None


def active_task_sort_key(task: dict) -> tuple[int, datetime]:
    created_at = task.get("created_at")
    if not isinstance(created_at, datetime):
        created_at = datetime.min
    return ACTIVE_TASK_STATUS_PRIORITY.get(str(task.get("status") or ""), 0), created_at


def serialize_task_row(row) -> dict:
    return {
        "id": str(row.id),
        "workflow_id": str(row.reference_id),
        "task_type": row.task_type,
        "status": row.status,
        "current_stage": row.current_stage,
        "progress_percent": float(row.progress_percent or 0),
        "error_message": row.error_message,
        "created_at": row.created_at,
        "started_at": row.started_at,
        "completed_at": row.completed_at,
    }


def workspace_source_content(db: Session, content_id: uuid.UUID | None) -> dict | None:
    if not content_id:
        return None
    row = (
        db.query(
            ContentItem.id,
            ContentItem.content_type,
            ContentItem.canonical_title,
            ContentItem.summary,
            ContentItem.language,
            ContentItem.status,
            ContentItem.canonical_url,
            ContentItem.quality_score,
            ContentItem.mongo_normalized_id,
            ContentItem.sources_jsonb,
            ContentItem.media_jsonb,
            ContentItem.published_at,
            ContentItem.created_at,
            ContentItem.updated_at,
        )
        .filter(ContentItem.id == content_id)
        .first()
    )
    if not row:
        return None
    sources = row.sources_jsonb if isinstance(row.sources_jsonb, list) else []
    media = row.media_jsonb if isinstance(row.media_jsonb, list) else []
    primary_source = sources[0] if sources else {}
    source_metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    if not isinstance(source_metadata, dict):
        source_metadata = {}
    article_id = source_metadata.get("article_id")
    category_id = source_metadata.get("category_id")
    site_id = source_metadata.get("site_id")
    full_text = _load_content_full_text(row.mongo_normalized_id)
    return {
        "id": str(row.id),
        "content_type": row.content_type,
        "title": row.canonical_title,
        "canonical_title": row.canonical_title,
        "summary": row.summary,
        "full_text": full_text,
        "language": row.language,
        "status": row.status,
        "canonical_url": row.canonical_url,
        "source_type": primary_source.get("source_type"),
        "source_url": primary_source.get("source_url") or row.canonical_url,
        "source_author": primary_source.get("source_author"),
        "source_published_at": primary_source.get("source_published_at"),
        "source_metadata": source_metadata,
        "article_id": article_id,
        "articleId": article_id,
        "category_id": category_id,
        "categoryId": category_id,
        "category": source_metadata.get("category"),
        "site_id": site_id,
        "siteId": site_id,
        "quality_score": float(row.quality_score or 0),
        "media": media,
        "published_at": row.published_at,
        "normalized": {
            "articleId": article_id,
            "categoryId": category_id,
            "siteId": site_id,
            "title": row.canonical_title or "",
            "lead": row.summary or "",
            "publishedAt": row.published_at or primary_source.get("source_published_at"),
            "content": full_text or row.summary or "",
            "images": [],
            "videos": [],
            "url": row.canonical_url,
        },
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def draft_has_voice(draft: dict) -> bool:
    audio = draft.get("audio") if isinstance(draft.get("audio"), dict) else {}
    if audio.get("voice"):
        return True
    timeline = draft.get("timeline") if isinstance(draft.get("timeline"), dict) else {}
    clips = timeline.get("audio") if isinstance(timeline.get("audio"), list) else []
    return any(
        isinstance(clip, dict)
        and clip.get("src")
        and str(clip.get("type") or "").lower() == "voice"
        for clip in clips
    )


def final_video_uri(artifacts: list[dict]) -> str | None:
    candidates = [
        item for item in artifacts
        if isinstance(item, dict)
        and item.get("uri")
        and item.get("status") not in {"STALE", "PURGED"}
        and (item.get("type") == "FINAL_VIDEO" or item.get("artifact_type") == "FINAL_VIDEO")
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return str(candidates[0]["uri"])
