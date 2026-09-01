from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.services import generate_video as pipeline
from common.db.content_series import (
    find_active_series_by_title,
    lock_active_series,
    lock_profile_series_scope,
    sync_series_current_part,
)
from app.api.deps import get_current_user
from common.db.media_workflows import content_category_payload
from common.db.models import (
    ContentItem,
    ContentSeries,
    MediaWorkflow,
    KafkaTask,
    PublishingQueueItem,
    SocialProfile,
    User,
)
from common.planning.auto_draft_policy import (
    auto_production_allowed,
    auto_production_block_reason,
    draft_script_signature,
    draft_has_script,
    invalidate_draft_media,
    is_auto_workflow,
)
from common.db.session import get_db
from common.planning.publishing_schedule import choose_publish_schedule, lock_schedule_profile, schedule_timezone, utc_datetime
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import (
    GENERATE_VIDEO_EDIT_REQUESTED,
    GENERATE_VIDEO_RENDER_REQUESTED,
    GENERATE_VIDEO_REVIEW_REQUESTED,
    GENERATE_VIDEO_SCRIPT_REQUESTED,
    GENERATE_VIDEO_VOICE_REQUESTED,
)

router = APIRouter()
DEFAULT_AUTO_VOICE_PROVIDER = "edge_tts_namminh"
DEFAULT_VOICE_SPEED = 1.2
ACTIVE_TASK_STATUSES = {"PENDING", "RUNNING", "PROCESSING"}
PRE_RENDER_TASK_TYPES = {
    "GENERATE_VIDEO_SCRIPT",
    "GENERATE_VIDEO_EDIT",
    "GENERATE_VIDEO_REVIEW",
    "GENERATE_VIDEO_VOICE",
}

class StoryRequest(BaseModel):
    story: dict
    workflow_id: uuid.UUID


class EditStoryRequest(BaseModel):
    workflow_id: uuid.UUID
    prompt: str


class ReviewStoryRequest(BaseModel):
    workflow_id: uuid.UUID
    instructions: str | None = None


class ProjectVoiceRequest(BaseModel):
    voice_id: str | None = None
    voice_speed: float = Field(default=DEFAULT_VOICE_SPEED, ge=0.5, le=2.0)
    voice_provider: str | None = None


class ApproveDraftRequest(BaseModel):
    script_signature: str


class GenerateVideoRequest(BaseModel):
    workflow_id: uuid.UUID


class AudioUploadRequest(BaseModel):
    filename: str
    content_base64: str


class DirectScriptRequest(BaseModel):
    profile_id: uuid.UUID
    content_id: uuid.UUID
    title: str | None = None
    instructions: str | None = None
    target_duration_seconds: int = 60
    note: str | None = None


class QueueRenderedVideoRequest(BaseModel):
    scheduled_at: datetime | None = None
    caption: str | None = None
    status: str | None = None


@router.post("/projects/{workflow_id}/create-story")
def create_story_from_project(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, workflow_id, user)
    try:
        if not project.primary_content_id:
            raise HTTPException(status_code=400, detail="Workflow chưa có ContentItem chính để sinh kịch bản")
        content = db.get(ContentItem, project.primary_content_id)
        if not content or not _can_use_content(content, user):
            raise HTTPException(status_code=404, detail="ContentItem chính không tồn tại hoặc không thuộc quyền truy cập")

        project_meta = project.metadata_json if isinstance(project.metadata_json, dict) else {}
        task_payload = _script_task_payload(
            project.primary_content_id,
            trigger="project_create_story",
            target_duration_seconds=project_meta.get("target_duration_seconds"),
            instructions=project_meta.get("instructions"),
        )
        existing = (
            db.query(KafkaTask)
            .filter(KafkaTask.reference_id == project.id, KafkaTask.task_type == "GENERATE_VIDEO_SCRIPT", KafkaTask.status.in_(["PENDING", "RUNNING", "PROCESSING"]))
            .order_by(KafkaTask.created_at.desc())
            .first()
        )
        if existing:
            return {"job": _serialize_workflow_run(db, existing)}

        job = KafkaTask(
            reference_id=project.id,
            reference_type="media_workflow",
            task_type="GENERATE_VIDEO_SCRIPT",
            status="PENDING",
            current_stage="QUEUED_SCRIPT",
            progress_percent=0,
            payload_jsonb=task_payload,
        )
        _ensure_no_active_video_task(db, project)
        project.status = "SCRIPTING"
        project.current_stage = "QUEUED_SCRIPT"
        project.progress_percent = 0
        db.add_all([job, project])
        db.commit()
        db.refresh(job)
        publish(
            GENERATE_VIDEO_SCRIPT_REQUESTED,
            build_event(
                event_type=GENERATE_VIDEO_SCRIPT_REQUESTED,
                source="api-service",
                job_id=job.id,
                payload={"workflow_id": str(project.id), "run_type": job.task_type},
                correlation_id=project.id,
            ),
        )
        return {"job": _serialize_workflow_run(db, job)}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


def _public_story(story: dict) -> dict:
    return pipeline.public_story_payload(story)


def _get_owned_project(db: Session, workflow_id: uuid.UUID, user: User) -> MediaWorkflow:
    project = db.query(MediaWorkflow).filter(MediaWorkflow.id == workflow_id).with_for_update().first()
    if not project or (not user.is_system_admin and project.user_id != user.id):
        raise HTTPException(status_code=404, detail="Content project not found")
    return project


def _persist_project_story(db: Session, project: MediaWorkflow, story: dict, status: str | None = None) -> None:
    if project.status == "REJECTED":
        raise HTTPException(status_code=409, detail="Workflow đã bị từ chối. Hãy mở lại workflow trước khi sửa draft.")
    previous_story = project.draft_json if isinstance(project.draft_json, dict) else {}
    next_story = deepcopy(story)
    if isinstance(previous_story.get("compact_scenes"), list) and not isinstance(next_story.get("compact_scenes"), list):
        next_story["compact_scenes"] = previous_story["compact_scenes"]
    public_story = _public_story(next_story)
    public_story.setdefault("meta", {})
    public_story["meta"]["workflow_id"] = str(project.id)
    public_story["meta"]["user_id"] = str(project.user_id)
    public_story["project_status"] = _project_status(public_story)

    metadata = dict(project.metadata_json or {})
    script_changed = bool(previous_story) and draft_script_signature(previous_story) != draft_script_signature(public_story)
    if script_changed and is_auto_workflow(metadata):
        invalidate_draft_media(project, public_story)
        metadata = dict(project.metadata_json or {})
        metadata["draft_review_approved"] = False
        metadata.pop("approved_script_signature", None)
        metadata["draft_review"] = {
            "status": "REVIEW_REQUIRED",
            "reason": "DRAFT_CHANGED",
            "script_signature": draft_script_signature(public_story),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        project.current_stage = "DRAFT_REVIEW_REQUIRED"
        project.progress_percent = 80
        status = "EDITING"
    project.metadata_json = metadata
    project.draft_json = public_story
    project.status = status or _project_status(public_story)
    public_story["project_status"] = project.status
    db.add(project)
    db.commit()


def _enqueue_project_voice_job(
    db: Session,
    project: MediaWorkflow,
    *,
    trigger: str,
    voice_id: str | None = None,
    voice_speed: float = DEFAULT_VOICE_SPEED,
    voice_provider: str | None = None,
) -> KafkaTask:
    _require_auto_draft_production_ready(project, project.draft_json if isinstance(project.draft_json, dict) else {})
    existing = (
        db.query(KafkaTask)
        .filter(
            KafkaTask.reference_id == project.id,
            KafkaTask.task_type == "GENERATE_VIDEO_VOICE",
            KafkaTask.status.in_(["PENDING", "RUNNING", "PROCESSING"]),
        )
        .order_by(KafkaTask.created_at.desc())
        .first()
    )
    if existing:
        return existing

    job = KafkaTask(
        reference_id=project.id,
        reference_type="media_workflow",
        task_type="GENERATE_VIDEO_VOICE",
        status="PENDING",
        current_stage="QUEUED_VOICE",
        payload_jsonb={
            "trigger": trigger,
            "voice_id": voice_id,
            "voice_provider": voice_provider or DEFAULT_AUTO_VOICE_PROVIDER,
            "voice_speed": voice_speed,
        },
    )
    project.status = "EDITING"
    project.current_stage = "QUEUED_VOICE"
    project.progress_percent = 0
    db.add_all([job, project])
    db.commit()
    db.refresh(job)
    publish(
        GENERATE_VIDEO_VOICE_REQUESTED,
        build_event(
            event_type=GENERATE_VIDEO_VOICE_REQUESTED,
            source="api-service",
            job_id=job.id,
            payload={
                "workflow_id": str(project.id),
                "run_type": job.task_type,
                "task_id": str(job.id),
                "trigger": trigger,
                "voice_provider": voice_provider or DEFAULT_AUTO_VOICE_PROVIDER,
            },
            correlation_id=project.id,
        ),
    )
    return job


def _script_task_payload(
    content_id: uuid.UUID,
    *,
    trigger: str,
    target_duration_seconds: int | None = None,
    instructions: str | None = None,
) -> dict:
    payload = {"content_id": str(content_id), "trigger": trigger}
    if target_duration_seconds:
        payload["target_duration_seconds"] = target_duration_seconds
    if instructions and instructions.strip():
        payload["instructions"] = instructions.strip()
    return payload


def _enqueue_project_render_job(db: Session, project: MediaWorkflow, story: dict, *, trigger: str, mode: str) -> KafkaTask:
    _require_auto_draft_production_ready(project, story)
    blocking = _active_pre_render_task(db, project)
    if blocking:
        label = {
            "GENERATE_VIDEO_SCRIPT": "tạo draft",
            "GENERATE_VIDEO_EDIT": "chỉnh draft",
            "GENERATE_VIDEO_REVIEW": "review draft",
            "GENERATE_VIDEO_VOICE": "tạo voice/căn timeline",
        }.get(blocking.task_type, blocking.task_type)
        raise HTTPException(
            status_code=409,
            detail=f"Chưa thể render vì workflow vẫn đang {label}. Hãy đợi task hiện tại hoàn tất rồi render lại.",
        )
    existing = (
        db.query(KafkaTask)
        .filter(KafkaTask.reference_id == project.id, KafkaTask.task_type == "GENERATE_VIDEO_RENDER", KafkaTask.status.in_(ACTIVE_TASK_STATUSES))
        .order_by(KafkaTask.created_at.desc())
        .first()
    )
    if existing:
        return existing

    job = KafkaTask(
        reference_id=project.id,
        reference_type="media_workflow",
        task_type="GENERATE_VIDEO_RENDER",
        status="PENDING",
        current_stage="QUEUED_RENDER",
        progress_percent=0,
        payload_jsonb={"trigger": trigger, "video_render_mode": mode},
    )
    db.add(job)
    project.status = "RENDERING"
    project.current_stage = "QUEUED_RENDER"
    project.progress_percent = 0
    db.add(project)
    db.commit()
    db.refresh(job)
    publish(
        GENERATE_VIDEO_RENDER_REQUESTED,
        build_event(
            event_type=GENERATE_VIDEO_RENDER_REQUESTED,
            source="api-service",
            job_id=job.id,
            payload={"workflow_id": str(project.id), "run_type": job.task_type, "trigger": trigger},
            correlation_id=project.id,
        ),
    )
    return job


def _active_pre_render_task(db: Session, project: MediaWorkflow) -> KafkaTask | None:
    return (
        db.query(KafkaTask)
        .filter(
            KafkaTask.reference_id == project.id,
            KafkaTask.task_type.in_(PRE_RENDER_TASK_TYPES),
            KafkaTask.status.in_(ACTIVE_TASK_STATUSES),
        )
        .order_by(
            KafkaTask.status.desc(),
            KafkaTask.created_at.desc(),
        )
        .first()
    )


def _can_use_content(content: ContentItem, user: User) -> bool:
    return (
        user.is_system_admin
        or content.content_scope == "GLOBAL"
        or (content.content_scope == "PRIVATE" and content.owner_user_id == user.id)
    )


def _require_auto_draft_production_ready(project: MediaWorkflow, story: dict) -> None:
    if project.status == "REJECTED":
        raise HTTPException(status_code=409, detail="Workflow đã bị từ chối. Hãy mở lại workflow trước khi tiếp tục.")
    metadata = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    if not auto_production_allowed(metadata, story):
        raise HTTPException(status_code=409, detail=auto_production_block_reason(metadata, story))


def _apply_pending_series_decision(db: Session, project: MediaWorkflow, story: dict) -> ContentSeries | None:
    metadata = dict(project.metadata_json or {})
    decision = metadata.get("pending_series_decision") if isinstance(metadata.get("pending_series_decision"), dict) else None
    if not decision:
        return None
    action = str(decision.get("action") or "NONE").strip().upper()
    if action not in {"USE_EXISTING", "CREATE_NEW"}:
        metadata.pop("pending_series_decision", None)
        metadata.pop("series_decision_error", None)
        project.metadata_json = metadata
        return None
    series: ContentSeries | None = None
    if action == "USE_EXISTING":
        try:
            target_id = uuid.UUID(str(decision.get("target_series_id")))
        except (TypeError, ValueError):
            target_id = None
        if target_id:
            series = lock_active_series(db, target_id, profile_id=project.profile_id, workflow_id=project.id)
    elif action == "CREATE_NEW":
        title = " ".join(str(decision.get("series_title") or "").split()).strip()[:180]
        if title:
            lock_profile_series_scope(db, project.profile_id)
            existing = find_active_series_by_title(db, project.profile_id, title)
            if existing:
                series = lock_active_series(db, existing.id, profile_id=project.profile_id, workflow_id=project.id)
            else:
                try:
                    total_parts = max(0, int(decision.get("total_parts") or 0))
                except (TypeError, ValueError):
                    total_parts = 0
                content = db.get(ContentItem, project.primary_content_id) if project.primary_content_id else None
                category = content_category_payload(content) if content else {}
                description = str(decision.get("series_description") or decision.get("reason") or "").strip()[:1000]
                series = ContentSeries(
                    user_id=project.user_id,
                    profile_id=project.profile_id,
                    title=title,
                    description=description or None,
                    series_type=str(decision.get("series_type") or "NARRATIVE").strip().upper(),
                    status="ACTIVE",
                    current_part=0,
                    total_parts=total_parts,
                    context_json={
                        "version": 1,
                        "created_from": "approved_auto_draft",
                        "core_theme": description or None,
                        "reusable_followup_angles": decision.get("reusable_followup_angles") or [],
                    },
                    metadata_json={"created_from": "approved_auto_draft", "source": "pending_series_decision", **category},
                )
                db.add(series)
                db.flush()

    if series:
        metadata.pop("pending_series_decision", None)
    if series:
        metadata.pop("series_decision_error", None)
        old_series_id = project.series_id
        project.series_id = series.id
        project.planning_mode = "SERIES"
        db.flush()
        sync_series_current_part(db, series)
        if old_series_id and old_series_id != series.id:
            sync_series_current_part(db, old_series_id)
        normalized = {
            "action": action,
            "target_series_id": str(series.id),
            "series_title": series.title,
            "reason": decision.get("reason"),
        }
        metadata["planning_mode"] = "SERIES"
        metadata["series_decision"] = normalized
        story.setdefault("meta", {})["series_decision"] = normalized
        story["meta"]["series"] = {
            "id": str(series.id),
            "title": series.title,
            "description": series.description,
            "series_type": series.series_type,
            "status": series.status,
            "current_part": int(series.current_part or 0),
            "total_parts": int(series.total_parts or 0),
        }
    else:
        metadata["series_decision_error"] = "SERIES_UNAVAILABLE_OR_FULL"
        if not project.series_id:
            project.planning_mode = "SINGLE"
            metadata["planning_mode"] = "SINGLE"
    project.metadata_json = metadata
    return series


def _project_status(story: dict) -> str:
    artifacts = story.get("video_artifacts") if isinstance(story.get("video_artifacts"), dict) else {}
    audio = story.get("audio") if isinstance(story.get("audio"), dict) else {}
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    if artifacts.get("final"):
        return "RENDERED"
    if audio.get("voice") or any(isinstance(clip, dict) and str(clip.get("type") or "").lower() == "voice" for clip in timeline.get("audio") or []):
        return "VOICE_READY"
    if timeline.get("video") or timeline.get("text"):
        return "EDITING"
    return "READY"


def _story_has_voice(story: dict) -> bool:
    audio = story.get("audio") if isinstance(story.get("audio"), dict) else {}
    if audio.get("voice"):
        return True
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    return any(
        isinstance(clip, dict) and str(clip.get("type") or "").lower() == "voice" and clip.get("src")
        for clip in (timeline.get("audio") if isinstance(timeline.get("audio"), list) else [])
    )


def _ensure_no_active_video_task(db: Session, project: MediaWorkflow, *, allow_rejected: bool = False) -> None:
    if project.status == "REJECTED" and not allow_rejected:
        raise HTTPException(status_code=409, detail="Workflow đã bị từ chối. Hãy mở lại workflow trước khi tiếp tục.")
    blocking = db.query(KafkaTask.id).filter(
        KafkaTask.reference_id == project.id,
        KafkaTask.task_type.in_(PRE_RENDER_TASK_TYPES | {"GENERATE_VIDEO_RENDER"}),
        KafkaTask.status.in_(ACTIVE_TASK_STATUSES),
    ).first()
    if blocking:
        raise HTTPException(status_code=409, detail="Workflow đang xử lý. Hãy đợi task hiện tại hoàn tất trước khi thay đổi hoặc duyệt draft.")


@router.post("/projects/{workflow_id}/approve-draft")
def approve_project_draft(
    workflow_id: uuid.UUID,
    payload: ApproveDraftRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, workflow_id, user)
    story = deepcopy(project.draft_json) if isinstance(project.draft_json, dict) else {}
    if not draft_has_script(story):
        raise HTTPException(status_code=400, detail="Project chưa có draft để duyệt")
    metadata = dict(project.metadata_json or {})
    if not is_auto_workflow(metadata):
        raise HTTPException(status_code=400, detail="Workflow thủ công không cần bước duyệt auto draft")
    _ensure_no_active_video_task(db, project)
    if payload.script_signature != draft_script_signature(story):
        raise HTTPException(status_code=409, detail="Draft đã thay đổi. Hãy tải lại và kiểm tra phiên bản mới trước khi duyệt.")

    series = _apply_pending_series_decision(db, project, story)
    metadata = dict(project.metadata_json or {})
    approved_at = datetime.now(timezone.utc).isoformat()
    signature = draft_script_signature(story)
    metadata["draft_review_approved"] = True
    metadata["approved_script_signature"] = signature
    metadata["draft_review"] = {
        "status": "APPROVED",
        "reviewed_by": str(user.id),
        "reviewed_at": approved_at,
        "script_signature": signature,
        "override_risk": bool(metadata.get("risk_flags")),
    }
    project.metadata_json = metadata
    story.setdefault("meta", {})["draft_review"] = metadata["draft_review"]
    story["project_status"] = "EDITING"
    project.draft_json = story
    project.status = "EDITING"
    project.current_stage = "DRAFT_READY"
    project.progress_percent = 100
    db.add(project)
    db.commit()
    db.refresh(project)

    job = None
    profile = db.get(SocialProfile, project.profile_id)
    strategy = getattr(profile, "strategy", None) if profile else None
    if getattr(strategy, "video_render_mode", "manual") == "auto":
        if _story_has_voice(story):
            job = _enqueue_project_render_job(db, project, story, trigger="draft_approved", mode="auto")
        else:
            job = _enqueue_project_voice_job(db, project, trigger="draft_approved")

    return {
        "workflow_id": str(project.id),
        "status": project.status,
        "current_stage": project.current_stage,
        "series_id": str(series.id) if series else (str(project.series_id) if project.series_id else None),
        "series_applied": bool(series),
        "series_warning": (project.metadata_json or {}).get("series_decision_error"),
        "job": _serialize_workflow_run(db, job) if job else None,
    }


@router.post("/projects/{workflow_id}/approve-video")
def approve_project_video(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, workflow_id, user)
    story = project.draft_json if isinstance(project.draft_json, dict) else {}
    _ensure_no_active_video_task(db, project)
    _require_auto_draft_production_ready(project, story)
    rendered_video = _rendered_video_uri(project, story)
    if not rendered_video:
        raise HTTPException(status_code=400, detail="Project chưa có MP4 để duyệt")

    metadata = dict(project.metadata_json or {})
    metadata["video_approved"] = True
    metadata["video_approved_at"] = datetime.utcnow().isoformat()
    metadata["video_approved_by"] = str(user.id)
    metadata["module4_review"] = {
        "decision": "approved",
        "mode": "manual",
        "reviewed_by": str(user.id),
        "reviewed_at": metadata["video_approved_at"],
    }
    project.metadata_json = metadata
    project.status = "VIDEO_APPROVED"
    db.add(project)
    queue_item = None
    profile = db.get(SocialProfile, project.profile_id)
    strategy = getattr(profile, "strategy", None) if profile else None
    if profile and getattr(strategy, "auto_queue_enabled", False):
        queue_item = _queue_project_video(
            db,
            project,
            profile,
            story,
            metadata,
            requested_status="approved",
            reason="Module 4 auto queue sau khi reviewer duyệt video",
        )
    db.commit()
    db.refresh(project)
    return {
        "workflow_id": project.id,
        "status": project.status,
        "rendered_video": rendered_video,
        "queue_item": _serialize_queue_item(queue_item, profile) if queue_item and profile else None,
    }


@router.post("/projects/{workflow_id}/queue-post")
def queue_project_video_for_posting(
    workflow_id: uuid.UUID,
    payload: QueueRenderedVideoRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, workflow_id, user)
    profile = db.get(SocialProfile, project.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Social profile not found")

    story = project.draft_json if isinstance(project.draft_json, dict) else {}
    rendered_video = _rendered_video_uri(project, story)
    if not rendered_video:
        raise HTTPException(status_code=400, detail="Project chưa có MP4 để đưa vào queue")

    metadata = dict(project.metadata_json or {})
    if not metadata.get("video_approved"):
        raise HTTPException(status_code=400, detail="Video cần được duyệt trước khi đưa vào queue")

    strategy = getattr(profile, "strategy", None)
    default_queue_status = "approved" if strategy and strategy.approval_mode == "auto" else "needs_approval"
    requested_status = (payload.status if payload else None) or default_queue_status
    if requested_status not in {"queued", "needs_approval", "approved"}:
        raise HTTPException(status_code=400, detail="Trạng thái queue không hợp lệ")

    item = _queue_project_video(
        db,
        project,
        profile,
        story,
        metadata,
        requested_status=requested_status,
        scheduled_at=payload.scheduled_at if payload else None,
        caption=payload.caption if payload else None,
        reason="Module 4 manual queue từ video đã duyệt",
    )
    db.commit()
    db.refresh(item)
    db.refresh(project)
    return {
        "workflow_id": project.id,
        "status": project.status,
        "queue_item": {
            **_serialize_queue_item(item, profile),
        },
    }


def _rendered_video_uri(project: MediaWorkflow, story: dict | None) -> str | None:
    artifacts = project.artifacts_jsonb if isinstance(project.artifacts_jsonb, list) else []
    artifact = next(
        (
            item
            for item in sorted(artifacts, key=lambda value: value.get("created_at", ""), reverse=True)
            if item.get("status") != "STALE" and item.get("uri") and (item.get("type") == "FINAL_VIDEO" or item.get("artifact_type") == "FINAL_VIDEO")
        ),
        None,
    )
    if artifact:
        return artifact.get("uri")
    metadata = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    if metadata.get("rendered_video"):
        return str(metadata["rendered_video"])
    story_artifacts = story.get("video_artifacts") if isinstance(story, dict) and isinstance(story.get("video_artifacts"), dict) else {}
    return str(story_artifacts.get("final")) if story_artifacts.get("final") else None


def _queue_project_video(
    db: Session,
    project: MediaWorkflow,
    profile: SocialProfile,
    story: dict | None,
    metadata: dict,
    *,
    requested_status: str,
    scheduled_at: datetime | None = None,
    caption: str | None = None,
    reason: str,
) -> PublishingQueueItem:
    _require_auto_draft_production_ready(project, story or {})
    rendered_video = _rendered_video_uri(project, story)
    if not rendered_video:
        raise HTTPException(status_code=400, detail="Project chưa có MP4 để đưa vào queue")

    lock_schedule_profile(db, profile.id)
    existing_id = metadata.get("queued_post_id")
    item = None
    if existing_id:
        try:
            item = db.get(PublishingQueueItem, uuid.UUID(str(existing_id)))
        except ValueError:
            item = None
    if item and item.profile_id != profile.id:
        item = None
    if item is None:
        item = PublishingQueueItem(
            user_id=project.user_id,
            profile_id=profile.id,
            content_id=project.primary_content_id,
            platform=profile.platform,
        )
        db.add(item)

    item.article_link = rendered_video
    item.article_title = project.title
    item.generated_content = caption or item.generated_content or _default_video_caption(project, story)
    item.status = requested_status
    if scheduled_at is not None:
        tzinfo = schedule_timezone(getattr(profile.strategy, "schedule_timezone", None))
        item.scheduled_at = scheduled_at.replace(tzinfo=tzinfo) if scheduled_at.tzinfo is None else scheduled_at
        item.scheduled_at = utc_datetime(item.scheduled_at)
        if item.scheduled_at <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Thời gian đăng phải nằm trong tương lai")
    elif not item.scheduled_at or utc_datetime(item.scheduled_at) <= datetime.now(timezone.utc):
        try:
            decision = choose_publish_schedule(db, profile, item)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        item.scheduled_at = decision.scheduled_at
        reason = f"{reason}. {decision.reason}"
    item.ai_reason = reason
    item.error = None
    db.flush()

    metadata["queued_post_id"] = str(item.id)
    metadata["queued_at"] = datetime.now(timezone.utc).isoformat()
    metadata["module4_queue"] = {
        "status": item.status,
        "scheduled_at": item.scheduled_at.isoformat() if item.scheduled_at else None,
        "reason": reason,
    }
    project.metadata_json = metadata
    project.status = "QUEUED_FOR_PUBLISHING"
    db.add(project)
    return item


def _serialize_queue_item(item: PublishingQueueItem, profile: SocialProfile) -> dict:
    return {
        "id": item.id,
        "profile_id": item.profile_id,
        "profile_name": profile.profile_name,
        "profile_scopes": getattr(profile, "scopes_jsonb", None) or [],
        "content_id": item.content_id,
        "article_link": item.article_link,
        "article_title": item.article_title,
        "platform": item.platform,
        "generated_content": item.generated_content,
        "ai_reason": item.ai_reason,
        "status": item.status,
        "scheduled_at": item.scheduled_at,
        "published_at": item.published_at,
        "error": item.error,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _default_video_caption(project: MediaWorkflow, story: dict | None) -> str:
    meta = story.get("meta") if isinstance(story, dict) and isinstance(story.get("meta"), dict) else {}
    title = str(meta.get("title") or project.title).strip()
    return title or "Video mới đã sẵn sàng đăng"


@router.post("/save-story")
def save_story(
    payload: StoryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, payload.workflow_id, user)
    _ensure_no_active_video_task(db, project)
    payload.story.setdefault("meta", {})
    payload.story["meta"]["workflow_id"] = str(project.id)
    saved_story = pipeline.normalize_story_for_project(payload.story)
    _persist_project_story(db, project, saved_story, status="EDITING")
    return {"story": project.draft_json, "script_signature": draft_script_signature(project.draft_json)}


@router.post("/edit-story")
def edit_story(
    payload: EditStoryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Missing edit prompt")
    try:
        project = _get_owned_project(db, payload.workflow_id, user)
        _ensure_no_active_video_task(db, project)
        story = project.draft_json if isinstance(project.draft_json, dict) else {}
        if not story:
            raise HTTPException(status_code=404, detail="Story not found for content project")
        story = _public_story(story)
        _persist_project_story(db, project, story, status="EDITING")
        existing = (
            db.query(KafkaTask)
            .filter(
                KafkaTask.reference_id == project.id,
                KafkaTask.task_type == "GENERATE_VIDEO_EDIT",
                KafkaTask.status.in_(["PENDING", "RUNNING", "PROCESSING"]),
            )
            .order_by(KafkaTask.created_at.desc())
            .first()
        )
        if existing:
            return {"job": _serialize_workflow_run(db, existing)}

        job = KafkaTask(
            reference_id=project.id,
            reference_type="media_workflow",
            task_type="GENERATE_VIDEO_EDIT",
            status="PENDING",
            current_stage="QUEUED_EDIT",
            progress_percent=0,
            payload_jsonb={"prompt": payload.prompt, "trigger": "manual_edit"},
        )
        _ensure_no_active_video_task(db, project)
        project.status = "EDITING"
        project.current_stage = "QUEUED_EDIT"
        project.progress_percent = 0
        db.add_all([job, project])
        db.commit()
        db.refresh(job)
        publish(
            GENERATE_VIDEO_EDIT_REQUESTED,
            build_event(
                event_type=GENERATE_VIDEO_EDIT_REQUESTED,
                source="api-service",
                job_id=job.id,
                payload={"workflow_id": str(project.id), "run_type": job.task_type, "prompt": payload.prompt},
                correlation_id=project.id,
            ),
        )
        return {"job": _serialize_workflow_run(db, job)}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/review-story")
def review_story(
    payload: ReviewStoryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        project = _get_owned_project(db, payload.workflow_id, user)
        _ensure_no_active_video_task(db, project)
        story = project.draft_json if isinstance(project.draft_json, dict) else {}
        if not story:
            raise HTTPException(status_code=404, detail="Story not found for content project")
        story = _public_story(story)
        story.setdefault("meta", {})
        story["meta"]["workflow_id"] = str(project.id)
        _persist_project_story(db, project, story, status="REVIEWING")
        existing = (
            db.query(KafkaTask)
            .filter(
                KafkaTask.reference_id == project.id,
                KafkaTask.task_type == "GENERATE_VIDEO_REVIEW",
                KafkaTask.status.in_(["PENDING", "RUNNING", "PROCESSING"]),
            )
            .order_by(KafkaTask.created_at.desc())
            .first()
        )
        if existing:
            return {"job": _serialize_workflow_run(db, existing)}

        job = KafkaTask(
            reference_id=project.id,
            reference_type="media_workflow",
            task_type="GENERATE_VIDEO_REVIEW",
            status="PENDING",
            current_stage="QUEUED_REVIEW",
            progress_percent=0,
            payload_jsonb={"instructions": payload.instructions, "trigger": "manual_review"},
        )
        _ensure_no_active_video_task(db, project)
        project.status = "REVIEWING"
        project.current_stage = "QUEUED_REVIEW"
        project.progress_percent = 0
        db.add_all([job, project])
        db.commit()
        db.refresh(job)
        publish(
            GENERATE_VIDEO_REVIEW_REQUESTED,
            build_event(
                event_type=GENERATE_VIDEO_REVIEW_REQUESTED,
                source="api-service",
                job_id=job.id,
                payload={"workflow_id": str(project.id), "run_type": job.task_type, "instructions": payload.instructions},
                correlation_id=project.id,
            ),
        )
        return {"job": _serialize_workflow_run(db, job)}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/generate-video")
def generate_video(
    payload: GenerateVideoRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        project = _get_owned_project(db, payload.workflow_id, user)
        story = project.draft_json if isinstance(project.draft_json, dict) else {}
        if not story:
            raise HTTPException(status_code=404, detail="Story not found for content project")
        story = pipeline.normalize_story_for_project(story)
        story.setdefault("meta", {})
        story["meta"]["workflow_id"] = str(project.id)
        _require_auto_draft_production_ready(project, story)
        blocking = _active_pre_render_task(db, project)
        if blocking:
            label = {
                "GENERATE_VIDEO_SCRIPT": "tạo draft",
                "GENERATE_VIDEO_EDIT": "chỉnh draft",
                "GENERATE_VIDEO_REVIEW": "review draft",
                "GENERATE_VIDEO_VOICE": "tạo voice/căn timeline",
            }.get(blocking.task_type, blocking.task_type)
            raise HTTPException(
                status_code=409,
                detail=f"Chưa thể render vì workflow vẫn đang {label}. Hãy đợi task hiện tại hoàn tất rồi render lại.",
            )
        _persist_project_story(db, project, story, status="RENDERING")
        job = _enqueue_project_render_job(db, project, story, trigger="manual_generate_video", mode="manual")
        return {"job": _serialize_workflow_run(db, job)}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/projects/{workflow_id}/render")
def render_project_video(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return generate_video(payload=GenerateVideoRequest(workflow_id=workflow_id), user=user, db=db)


@router.get("/render-jobs/{job_id}")
def get_render_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = db.get(KafkaTask, job_id)
    if not job or job.task_type not in {
        "GENERATE_VIDEO_RENDER",
        "GENERATE_VIDEO_SCRIPT",
        "GENERATE_VIDEO_EDIT",
        "GENERATE_VIDEO_REVIEW",
        "GENERATE_VIDEO_VOICE",
    }:
        raise HTTPException(status_code=404, detail="Render job not found")

    project = db.get(MediaWorkflow, job.reference_id)
    if not project or (not user.is_system_admin and project.user_id != user.id):
        raise HTTPException(status_code=404, detail="Render job not found")

    job.project = project
    return {"job": _serialize_workflow_run(db, job)}


def _serialize_workflow_run(db: Session, job: KafkaTask) -> dict:
    metadata = job.payload_jsonb if isinstance(job.payload_jsonb, dict) else {}
    result = job.result_jsonb if isinstance(job.result_jsonb, dict) else {}
    output_path = result.get("output_path") or metadata.get("output_path")
    return {
        "id": str(job.id),
        "workflow_id": str(job.reference_id),
        "run_type": job.task_type,
        "status": job.status,
        "progress_percent": float(job.progress_percent or 0),
        "current_stage": job.current_stage,
        "output_path": output_path,
        "video_url": f"/api/v1/generate-video/output/{str(output_path).replace('out/', '')}" if output_path else None,
        "error_message": job.error_message,
        "created_at": job.created_at,
        "updated_at": getattr(job, "updated_at", job.created_at),
        "started_at": job.started_at,
        "completed_at": job.completed_at,
    }


@router.post("/audio/upload")
def upload_audio(payload: AudioUploadRequest):
    try:
        return {"asset_path": pipeline.save_uploaded_audio_base64(payload.filename, payload.content_base64)}
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/media/{asset_path:path}")
def media(asset_path: str):
    path = (pipeline.PUBLIC_DIR / asset_path).resolve()
    public_root = pipeline.PUBLIC_DIR.resolve()
    if not str(path).startswith(str(public_root)) or not path.exists():
        raise HTTPException(status_code=404, detail="Media not found")
    return FileResponse(path)


@router.get("/output/{output_path:path}")
def output(output_path: str):
    path = (pipeline.VIDEO_OUT_DIR / output_path).resolve()
    output_root = pipeline.VIDEO_OUT_DIR.resolve()
    if not str(path).startswith(str(output_root)) or not path.exists():
        raise HTTPException(status_code=404, detail="Output not found")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.post("/projects/{workflow_id}/voice")
def generate_project_voice(
    workflow_id: uuid.UUID,
    payload: ProjectVoiceRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, workflow_id, user)
    story = project.draft_json if isinstance(project.draft_json, dict) else {}
    if not story:
        raise HTTPException(status_code=400, detail="Workflow chưa có draft để tạo voice")
    _ensure_no_active_video_task(db, project)
    job = _enqueue_project_voice_job(
        db,
        project,
        trigger="manual_voice",
        voice_id=payload.voice_id,
        voice_speed=payload.voice_speed,
        voice_provider=payload.voice_provider or DEFAULT_AUTO_VOICE_PROVIDER,
    )
    return {"job": _serialize_workflow_run(db, job)}


@router.post("/direct-script")
def create_direct_script(
    payload: DirectScriptRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Tạo MediaWorkflow trực tiếp từ một ContentItem,
    sau đó ngay lập tức enqueue KafkaTask GENERATE_VIDEO_SCRIPT.
    Bỏ qua toàn bộ phần AI chọn lọc / đánh giá điểm.
    """
    # Validate profile
    profile = db.get(SocialProfile, payload.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")

    content = db.get(ContentItem, payload.content_id)
    if not content or not _can_use_content(content, user):
        raise HTTPException(status_code=404, detail="ContentItem không tồn tại hoặc không thuộc quyền truy cập")

    # Resolve title từ content nếu không truyền
    title = payload.title
    if not title:
        title = content.canonical_title or content.normalized_title
    title = title or payload.note or "Direct script"

    # Tạo MediaWorkflow
    category_payload = content_category_payload(content)
    workflow = MediaWorkflow(
        user_id=user.id,
        profile_id=profile.id,
        title=title,
        status="SCRIPTING",
        planning_mode=None,
        metadata_json={
            "selection_mode": "MANUAL",
            "target_duration_seconds": payload.target_duration_seconds,
            "note": payload.note,
            **category_payload,
        },
    )
    db.add(workflow)
    db.flush()

    workflow.primary_content_id = content.id
    workflow.inputs_jsonb = [{"type": "content", "id": str(content.id), "role": "primary", **category_payload}]
    db.flush()

    task_payload = _script_task_payload(
        workflow.primary_content_id,
        trigger="direct_script",
        target_duration_seconds=payload.target_duration_seconds,
        instructions=payload.instructions,
    )


    job = KafkaTask(
        reference_id=workflow.id,
        reference_type="media_workflow",
        task_type="GENERATE_VIDEO_SCRIPT",
        status="PENDING",
        current_stage="QUEUED_SCRIPT",
        progress_percent=0,
        payload_jsonb=task_payload,
    )
    workflow.current_stage = "QUEUED_SCRIPT"
    workflow.progress_percent = 0
    db.add(job)
    db.commit()
    db.refresh(workflow)
    db.refresh(job)

    publish(
        GENERATE_VIDEO_SCRIPT_REQUESTED,
        build_event(
            event_type=GENERATE_VIDEO_SCRIPT_REQUESTED,
            source="api-service",
            job_id=job.id,
            payload={"workflow_id": str(workflow.id), "run_type": job.task_type},
            correlation_id=workflow.id,
        ),
    )

    return {
        "workflow": {
            "id": str(workflow.id),
            "title": workflow.title,
            "status": workflow.status,
            "profile_id": str(workflow.profile_id),
            "primary_content_id": str(workflow.primary_content_id),
        },
        "job": _serialize_workflow_run(db, job),
    }
