from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.services import generate_video as pipeline
from app.api.deps import get_current_user
from common.db.models import (
    ContentItem,
    MediaWorkflow,
    KafkaTask,
    PublishingQueueItem,
    SocialProfile,
    User,
)
from common.db.session import get_db
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

DEFAULT_SHARED_VOICE = {
    "voice_id": "pNInz6obpgDQGcFmaJgB",
    "name": "Adam",
    "description": "Default fallback voice. ElevenLabs shared voice discovery is currently unavailable.",
    "category": "premade",
    "language": "vi",
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
    voice_speed: float = Field(default=1.0, ge=0.5, le=2.0)
    voice_provider: str | None = None


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


@router.get("/voices")
def list_elevenlabs_shared_voices(
    search: str | None = None,
    sort: str = "trending",
    page_size: int = Query(default=30, ge=1, le=100),
    page: int = Query(default=0, ge=0),
):
    params = {
        "sort": sort,
        "page_size": page_size,
        "page": page,
        "explore_source": "tts_explore_tab",
    }
    if search:
        params["search"] = search
    headers = {}
    api_key = pipeline.get_elevenlabs_api_key()
    if api_key:
        headers["xi-api-key"] = api_key
    try:
        response = httpx.get(
            "https://api.us.elevenlabs.io/v1/shared-voices",
            params=params,
            headers=headers,
            timeout=20,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as error:
        detail = error.response.text if getattr(error, "response", None) is not None else str(error)
        return {
            "voices": [DEFAULT_SHARED_VOICE],
            "has_more": False,
            "total_count": 1,
            "fallback": True,
            "error": detail,
        }


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
    project = db.get(MediaWorkflow, workflow_id)
    if not project or (not user.is_system_admin and project.user_id != user.id):
        raise HTTPException(status_code=404, detail="Content project not found")
    return project


def _persist_project_story(db: Session, project: MediaWorkflow, story: dict, status: str | None = None) -> None:
    public_story = _public_story(story)
    public_story.setdefault("meta", {})
    public_story["meta"]["workflow_id"] = str(project.id)
    public_story["project_status"] = _project_status(public_story)

    project.draft_json = public_story
    project.status = status or _project_status(public_story)
    db.add(project)
    db.commit()


def _enqueue_project_voice_job(
    db: Session,
    project: MediaWorkflow,
    *,
    trigger: str,
    voice_id: str | None = None,
    voice_speed: float = 1.0,
    voice_provider: str | None = None,
) -> KafkaTask:
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


def _enqueue_project_render_job(db: Session, project: MediaWorkflow, story: dict, *, trigger: str, mode: str) -> KafkaTask:
    existing = (
        db.query(KafkaTask)
        .filter(KafkaTask.reference_id == project.id, KafkaTask.task_type == "GENERATE_VIDEO_RENDER", KafkaTask.status.in_(["PENDING", "RUNNING", "PROCESSING"]))
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


def _can_use_content(content: ContentItem, user: User) -> bool:
    return (
        user.is_system_admin
        or content.content_scope == "GLOBAL"
        or (content.content_scope == "PRIVATE" and content.owner_user_id == user.id)
    )


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


@router.post("/projects/{workflow_id}/approve-video")
def approve_project_video(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, workflow_id, user)
    story = project.draft_json if isinstance(project.draft_json, dict) else {}
    rendered_video = _rendered_video_uri(project, story)
    if not rendered_video:
        raise HTTPException(status_code=400, detail="Project chưa có MP4 để duyệt")

    metadata = dict(project.metadata_json or {})
    metadata["video_approved"] = True
    metadata["video_approved_at"] = datetime.utcnow().isoformat()
    metadata["video_approved_by"] = str(user.id)
    project.metadata_json = metadata
    project.status = "VIDEO_APPROVED"
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"workflow_id": project.id, "status": project.status, "rendered_video": rendered_video}


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

    requested_status = (payload.status if payload else None) or "queued"
    if requested_status not in {"queued", "needs_approval", "approved"}:
        raise HTTPException(status_code=400, detail="Trạng thái queue không hợp lệ")

    scheduled_at = (payload.scheduled_at if payload else None) or _default_scheduled_at(profile)
    caption = (payload.caption if payload else None) or _default_video_caption(project, story)
    item = PublishingQueueItem(
        user_id=user.id,
        profile_id=profile.id,
        content_id=project.primary_content_id,
        article_link=rendered_video,
        article_title=project.title,
        platform=profile.platform,
        generated_content=caption,
        ai_reason="Queued from approved Generate Video render",
        status=requested_status,
        scheduled_at=scheduled_at,
    )
    db.add(item)
    db.flush()
    metadata["queued_post_id"] = str(item.id)
    metadata["queued_at"] = datetime.utcnow().isoformat()
    project.metadata_json = metadata
    project.status = "QUEUED_FOR_PUBLISHING"
    db.add(project)
    db.commit()
    db.refresh(item)
    db.refresh(project)
    return {
        "workflow_id": project.id,
        "status": project.status,
        "queue_item": {
            "id": item.id,
            "profile_id": item.profile_id,
            "profile_name": profile.profile_name,
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
        },
    }


def _rendered_video_uri(project: MediaWorkflow, story: dict | None) -> str | None:
    artifacts = project.artifacts_jsonb if isinstance(project.artifacts_jsonb, list) else []
    artifact = next(
        (
            item
            for item in sorted(artifacts, key=lambda value: value.get("created_at", ""), reverse=True)
            if item.get("uri") and (item.get("type") == "FINAL_VIDEO" or item.get("artifact_type") == "FINAL_VIDEO")
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


def _default_scheduled_at(profile: SocialProfile) -> datetime:
    strategy = profile.strategy
    if not strategy:
        return datetime.utcnow() + timedelta(hours=1)
    times = [item.strip() for item in str(strategy.schedule_times or "").split(",") if item.strip()]
    now = datetime.utcnow()
    if not times:
        return now + timedelta(hours=1)
    for day_offset in range(0, 8):
        candidate_day = now + timedelta(days=day_offset)
        for value in times:
            try:
                hour, minute = [int(part) for part in value.split(":", 1)]
            except ValueError:
                continue
            candidate = candidate_day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate > now:
                return candidate
    return now + timedelta(hours=1)


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
    payload.story.setdefault("meta", {})
    payload.story["meta"]["workflow_id"] = str(project.id)
    saved_story = pipeline.normalize_story_for_project(payload.story)
    _persist_project_story(db, project, saved_story)
    return {"story": _public_story(saved_story)}


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
        _persist_project_story(db, project, story, status="RENDERING")
        job = _enqueue_project_render_job(db, project, story, trigger="manual_generate_video", mode="manual")
        return {"job": _serialize_workflow_run(db, job)}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


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
        },
    )
    db.add(workflow)
    db.flush()

    workflow.primary_content_id = content.id
    workflow.inputs_jsonb = [{"type": "content", "id": str(content.id), "role": "primary"}]
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
