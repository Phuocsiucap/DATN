import uuid
from copy import deepcopy
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case
from sqlalchemy.orm import Session

from common.db.media_workflows import _load_content_full_text, content_category_payload, serialize_workflow
from common.db.content_series import lock_active_series, sync_series_current_part
from common.db.models import ContentItem, ContentSeries, MediaWorkflow, KafkaTask, SocialProfile, Story, User
from common.db.session import get_db
from common.planning.auto_draft_policy import auto_production_allowed, draft_script_signature, invalidate_draft_media, is_auto_workflow, sync_compact_scenes
from app.api.deps import get_current_user
from app.schemas.video_workspace_list import VideoWorkspaceListResponse
from app.services.video_workspace_list import ACTIVE_TASK_STATUSES, ACTIVE_TASK_STATUS_PRIORITY, build_video_workspace_list


router = APIRouter()


VIDEO_WORKSPACE_STATUSES = {
    "DRAFT",
    "READY",
    "APPROVED",
    "PRODUCTION_READY",
    "SCRIPTING",
    "EDITING",
    "REVIEWING",
    "VOICE_READY",
    "RENDERING",
    "RENDERED",
    "NEEDS_REVIEW",
    "FAILED",
}

VIDEO_RUN_TYPES = {
    "GENERATE_VIDEO_SCRIPT",
    "GENERATE_VIDEO_EDIT",
    "GENERATE_VIDEO_REVIEW",
    "GENERATE_VIDEO_VOICE",
    "GENERATE_VIDEO_RENDER",
}

WORKSPACE_METADATA_KEYS = {
    "selection_mode",
    "note",
    "crawl_job_id",
    "content_angle",
    "target_audience",
    "tone",
    "format",
    "target_duration_seconds",
    "recommended_part_count",
    "confidence_score",
    "risk_level",
    "ai_reasoning",
    "production_requirements",
    "production_gate",
    "draft_quality",
    "draft_quality_recheck",
    "draft_review",
    "draft_review_approved",
    "pending_series_decision",
    "series_decision",
    "series_decision_error",
    "risk_flags",
    "video_approved",
    "video_approved_at",
    "queued_post_id",
    "queued_at",
}


def _visible_in_video_workspace_filter():
    return MediaWorkflow.status.in_(VIDEO_WORKSPACE_STATUSES)


class MediaWorkflowFromSourcesRequest(BaseModel):
    profile_id: uuid.UUID
    crawl_job_id: uuid.UUID | None = None
    content_ids: list[uuid.UUID] = Field(default_factory=list)
    story_ids: list[uuid.UUID] = Field(default_factory=list)
    title: str | None = None
    note: str | None = None
    selection_mode: str = "MANUAL"
    filters: dict = Field(default_factory=dict)


class MediaWorkflowUpdateRequest(BaseModel):
    title: str | None = None
    series_id: uuid.UUID | None = None
    content_angle: str | None = None
    target_audience: str | None = None
    tone: str | None = None
    format: str | None = None
    target_duration_seconds: int | None = None
    recommended_part_count: int | None = None
    risk_level: str | None = None
    ai_reasoning: list | None = None
    production_requirements: dict | None = None
    draft_json: dict | None = None


@router.get("")
def list_media_workflows(
    video_workspace_only: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(MediaWorkflow).filter(MediaWorkflow.user_id == user.id)
    if video_workspace_only:
        query = query.filter(_visible_in_video_workspace_filter())
    workflows = query.order_by(MediaWorkflow.updated_at.desc()).limit(200).all()
    return [serialize_workflow(workflow, db) for workflow in workflows]


@router.get("/video-workspace", response_model=VideoWorkspaceListResponse, response_model_exclude_none=True)
def list_video_workspace(
    profile_id: uuid.UUID | None = None,
    series_id: uuid.UUID | None = None,
    status: str | None = None,
    stage: str | None = None,
    search: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    filters = [MediaWorkflow.user_id == user.id, _visible_in_video_workspace_filter()]
    if profile_id:
        filters.append(MediaWorkflow.profile_id == profile_id)
    if series_id:
        filters.append(MediaWorkflow.series_id == series_id)
    if status:
        statuses = [value.strip().upper() for value in status.split(",") if value.strip()]
        if statuses:
            filters.append(MediaWorkflow.status.in_(statuses))
    if stage:
        filters.append(MediaWorkflow.current_stage == stage.strip().upper())
    if search and search.strip():
        filters.append(MediaWorkflow.title.ilike(f"%{search.strip()}%"))

    total = db.query(MediaWorkflow.id).filter(*filters).count()
    rows = (
        db.query(
            MediaWorkflow.id,
            MediaWorkflow.profile_id,
            MediaWorkflow.series_id,
            MediaWorkflow.title,
            MediaWorkflow.status,
            MediaWorkflow.current_stage,
            MediaWorkflow.progress_percent,
            MediaWorkflow.created_at,
            MediaWorkflow.updated_at,
            SocialProfile.profile_name.label("profile_name"),
            SocialProfile.platform.label("profile_platform"),
            SocialProfile.avatar_url.label("profile_avatar"),
            ContentSeries.title.label("series_title"),
            ContentItem.sources_jsonb[0]["metadata_json"]["category"].astext.label("source_category"),
            ContentItem.sources_jsonb[0]["metadata_json"]["thumbnail_url"].astext.label("source_thumbnail"),
            ContentItem.sources_jsonb[0]["metadata_json"]["image_url"].astext.label("source_image"),
            ContentItem.media_jsonb.label("content_media"),
        )
        .join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
        .outerjoin(ContentSeries, ContentSeries.id == MediaWorkflow.series_id)
        .outerjoin(ContentItem, ContentItem.id == MediaWorkflow.primary_content_id)
        .filter(*filters)
        .order_by(MediaWorkflow.updated_at.desc(), MediaWorkflow.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    tasks_by_workflow = _latest_tasks_by_workflow(db, [row.id for row in rows])
    return build_video_workspace_list(rows, tasks_by_workflow, total=total, limit=limit, offset=offset)


@router.get("/{workflow_id:uuid}")
def get_media_workflow(workflow_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.get(MediaWorkflow, workflow_id)
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content workflow not found")
    return serialize_workflow(workflow, db)


@router.get("/{workflow_id:uuid}/workspace")
def get_video_workspace(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    workflow = db.get(MediaWorkflow, workflow_id)
    if not workflow or (not user.is_system_admin and workflow.user_id != user.id):
        raise HTTPException(status_code=404, detail="Video workflow not found")

    profile = (
        db.query(SocialProfile.id, SocialProfile.profile_name, SocialProfile.platform)
        .filter(SocialProfile.id == workflow.profile_id)
        .first()
    )
    series = None
    if workflow.series_id:
        series = (
            db.query(ContentSeries.id, ContentSeries.title, ContentSeries.description, ContentSeries.status, ContentSeries.current_part, ContentSeries.total_parts)
            .filter(ContentSeries.id == workflow.series_id)
            .first()
        )
    source = _workspace_source_content(db, workflow.primary_content_id)
    draft = workflow.draft_json if isinstance(workflow.draft_json, dict) else {}
    tasks = _workflow_tasks(db, workflow.id, limit=20)
    active_task = _select_active_task(tasks)
    latest_task = tasks[0] if tasks else None
    artifacts = workflow.artifacts_jsonb if isinstance(workflow.artifacts_jsonb, list) else []
    metadata = workflow.metadata_json if isinstance(workflow.metadata_json, dict) else {}
    has_draft = bool(draft.get("timeline") or draft.get("story_data") or draft.get("scenes"))
    has_voice = _draft_has_voice(draft)
    final_video = _final_video_uri(artifacts)
    production_allowed = workflow.status != "REJECTED" and auto_production_allowed(metadata, draft)
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
        "source_content": source,
        "draft": draft,
        "final_video": final_video,
        "tasks": tasks,
        "capabilities": {
            "can_generate_draft": bool(workflow.primary_content_id) and workflow.status != "REJECTED" and active_task is None,
            "can_edit": has_draft and workflow.status != "REJECTED" and active_task is None,
            "can_approve_draft": auto_review_required and workflow.status != "REJECTED" and active_task is None,
            "can_generate_voice": has_draft and production_allowed and active_task is None,
            "can_render": has_draft and has_voice and production_allowed and active_task is None,
            "can_approve": bool(final_video) and production_allowed and active_task is None,
            "can_queue": bool(final_video) and bool(metadata.get("video_approved")) and production_allowed and active_task is None,
        },
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at or workflow.created_at,
    }


@router.get("/{workflow_id:uuid}/progress")
def get_video_workflow_progress(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    workflow = (
        db.query(
            MediaWorkflow.id,
            MediaWorkflow.user_id,
            MediaWorkflow.status,
            MediaWorkflow.current_stage,
            MediaWorkflow.progress_percent,
            MediaWorkflow.updated_at,
            MediaWorkflow.artifacts_jsonb,
        )
        .filter(MediaWorkflow.id == workflow_id)
        .first()
    )
    if not workflow or (not user.is_system_admin and workflow.user_id != user.id):
        raise HTTPException(status_code=404, detail="Video workflow not found")
    tasks = _workflow_tasks(db, workflow.id, limit=12)
    active_task = _select_active_task(tasks)
    latest_task = tasks[0] if tasks else None
    effective_task = active_task
    return {
        "workflow_id": str(workflow.id),
        "status": workflow.status,
        "current_stage": (effective_task or {}).get("current_stage") or workflow.current_stage,
        "progress_percent": (effective_task or {}).get("progress_percent") if active_task else float(workflow.progress_percent or 0),
        "tasks": tasks,
        "final_video": _final_video_uri(workflow.artifacts_jsonb if isinstance(workflow.artifacts_jsonb, list) else []),
        "updated_at": workflow.updated_at,
    }


@router.post("/from-sources", status_code=201)
def create_media_workflow_from_sources(payload: MediaWorkflowFromSourcesRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(SocialProfile, payload.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    accessible_contents: dict[uuid.UUID, ContentItem] = {}
    accessible_stories: dict[uuid.UUID, Story] = {}
    for content_id in payload.content_ids:
        content = db.get(ContentItem, content_id)
        if not content or not _can_use_content(content, user):
            raise HTTPException(status_code=404, detail=f"ContentItem not found or inaccessible: {content_id}")
        accessible_contents[content_id] = content
    for story_id in payload.story_ids:
        story = db.get(Story, story_id)
        if not story or not _can_use_story(db, story, user):
            raise HTTPException(status_code=404, detail=f"Story not found or inaccessible: {story_id}")
        accessible_stories[story_id] = story
    if not accessible_contents and not accessible_stories:
        raise HTTPException(status_code=400, detail="Content workflow requires at least one accessible source")

    title = payload.title or _source_workflow_title(db, payload, user) or payload.note or "Content workflow"

    primary_category_payload = content_category_payload(accessible_contents[payload.content_ids[0]]) if payload.content_ids else {}
    workflow = MediaWorkflow(
        user_id=user.id,
        profile_id=profile.id,
        title=title,
        status="READY",
        planning_mode=None,
        metadata_json={
            "selection_mode": payload.selection_mode.upper(),
            "note": payload.note,
            "filters": payload.filters,
            "crawl_job_id": str(payload.crawl_job_id) if payload.crawl_job_id else None,
            **primary_category_payload,
        },
    )
    db.add(workflow)
    db.flush()

    inputs = []
    for content_id in payload.content_ids:
        content = accessible_contents[content_id]
        role = "primary" if workflow.primary_content_id is None else "supporting"
        inputs.append({"type": "content", "id": str(content_id), "role": role, **content_category_payload(content)})
        if workflow.primary_content_id is None:
            workflow.primary_content_id = content_id
    for story_id in payload.story_ids:
        story = accessible_stories[story_id]
        role = "primary" if workflow.primary_content_id is None else "supporting"
        story_content = db.get(ContentItem, story.content_id) if story.content_id else None
        inputs.append({"type": "story", "id": str(story_id), "role": role, **content_category_payload(story_content)})
        if workflow.primary_content_id is None and story.content_id:
            workflow.primary_content_id = story.content_id

    workflow.inputs_jsonb = inputs

    workflow.status = "READY"
    db.commit()
    db.refresh(workflow)
    return serialize_workflow(workflow, db)


@router.post("/{workflow_id:uuid}/approve")
def approve_media_workflow(workflow_id: uuid.UUID, payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.query(MediaWorkflow).filter(MediaWorkflow.id == workflow_id).with_for_update().first()
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workflow not found")
    from app.api.routes.generate_video import _ensure_no_active_video_task
    _ensure_no_active_video_task(db, workflow, allow_rejected=True)
    was_rejected = workflow.status == "REJECTED"
    if was_rejected and workflow.series_id:
        series = lock_active_series(db, workflow.series_id, profile_id=workflow.profile_id, workflow_id=workflow.id)
        if not series:
            raise HTTPException(status_code=409, detail="Series không còn active hoặc đã đủ số part. Hãy đổi hoặc bỏ series trước khi mở lại workflow.")
    was_approved = workflow.status == "APPROVED"
    metadata = dict(workflow.metadata_json or {})
    metadata.setdefault("approved_at", datetime.now(timezone.utc).isoformat())
    metadata["approved_by"] = str(user.id)
    workflow.metadata_json = metadata
    workflow.status = "APPROVED"
    if was_rejected and is_auto_workflow(metadata) and workflow.draft_json:
        workflow.current_stage = "DRAFT_REVIEW_REQUIRED"
    tasks = db.query(KafkaTask).filter(KafkaTask.reference_id == workflow.id, KafkaTask.task_type == "PLANNING", KafkaTask.status == "WAITING_REVIEW").all()
    for t in tasks:
        t.status = "COMPLETED"
        db.add(t)
    if payload.get("feedback_text") and not was_approved:
        from common.db.models import PlanningFeedback
        feedback = PlanningFeedback(media_workflow_id=workflow.id, feedback_type="APPROVE", feedback_text=payload["feedback_text"], created_by=user.id)
        db.add(feedback)
    db.add(workflow)
    if was_rejected and workflow.series_id:
        db.flush()
        sync_series_current_part(db, series)
    db.commit()
    db.refresh(workflow)
    return {"plan": serialize_workflow(workflow, db), "media_workflows": []}


@router.post("/{workflow_id:uuid}/reject")
def reject_media_workflow(workflow_id: uuid.UUID, payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.query(MediaWorkflow).filter(MediaWorkflow.id == workflow_id).with_for_update().first()
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workflow not found")
    from app.api.routes.generate_video import _ensure_no_active_video_task
    _ensure_no_active_video_task(db, workflow, allow_rejected=True)
    was_rejected = workflow.status == "REJECTED"
    metadata = dict(workflow.metadata_json or {})
    metadata.setdefault("rejected_at", datetime.now(timezone.utc).isoformat())
    metadata["rejected_by"] = str(user.id)
    if is_auto_workflow(metadata):
        metadata["draft_review_approved"] = False
        metadata.pop("approved_script_signature", None)
        metadata["draft_review"] = {"status": "REVIEW_REQUIRED", "reason": "WORKFLOW_REJECTED"}
    workflow.metadata_json = metadata
    workflow.status = "REJECTED"
    series_id = workflow.series_id
    if payload.get("feedback_text") and not was_rejected:
        from common.db.models import PlanningFeedback
        feedback = PlanningFeedback(media_workflow_id=workflow.id, feedback_type="REJECT", feedback_text=payload["feedback_text"], created_by=user.id)
        db.add(feedback)
    db.add(workflow)
    db.flush()
    sync_series_current_part(db, series_id)
    db.commit()
    db.refresh(workflow)
    return serialize_workflow(workflow, db)


@router.patch("/{workflow_id:uuid}")
def update_media_workflow(workflow_id: uuid.UUID, payload: MediaWorkflowUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.query(MediaWorkflow).filter(MediaWorkflow.id == workflow_id).with_for_update().first()
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workflow not found")

    data = payload.model_dump(exclude_unset=True)
    title = data.pop("title", None)
    has_series_id = "series_id" in data
    series_id = data.pop("series_id", None)
    draft_json = data.pop("draft_json", None)
    if draft_json is not None:
        from app.api.routes.generate_video import _ensure_no_active_video_task
        _ensure_no_active_video_task(db, workflow)

    if title is not None:
        workflow.title = title.strip() or workflow.title

    old_series_id = workflow.series_id
    if has_series_id:
        if series_id:
            series = db.get(ContentSeries, series_id) if series_id == old_series_id else lock_active_series(db, series_id, profile_id=workflow.profile_id)
            if not series or series.user_id != user.id:
                raise HTTPException(status_code=409, detail="Content series không tồn tại, không active hoặc đã đủ số part")
            workflow.series_id = series_id
        else:
            workflow.series_id = None

    if draft_json is not None:
        previous_draft = workflow.draft_json if isinstance(workflow.draft_json, dict) else {}
        draft_json = deepcopy(draft_json)
        if isinstance(previous_draft.get("compact_scenes"), list) and not isinstance(draft_json.get("compact_scenes"), list):
            draft_json["compact_scenes"] = deepcopy(previous_draft["compact_scenes"])
        sync_compact_scenes(draft_json)
        previous_signature = draft_script_signature(workflow.draft_json if isinstance(workflow.draft_json, dict) else {})
        next_signature = draft_script_signature(draft_json)
        workflow.draft_json = draft_json

    metadata = dict(workflow.metadata_json or {})
    for key, value in data.items():
        metadata[key] = value
    if has_series_id:
        workflow.planning_mode = "SERIES" if workflow.series_id else "SINGLE"
        metadata["planning_mode"] = workflow.planning_mode
        metadata.pop("pending_series_decision", None)
        metadata.pop("series_decision_error", None)
        metadata["series_decision"] = {
            "action": "USE_EXISTING" if workflow.series_id else "NONE",
            "target_series_id": str(workflow.series_id) if workflow.series_id else None,
            "series_title": series.title if workflow.series_id else None,
            "reason": "MANUAL_SERIES_SELECTION",
        }
        if isinstance(workflow.draft_json, dict):
            story = deepcopy(workflow.draft_json)
            story_meta = dict(story.get("meta") or {})
            story_meta["series_decision"] = metadata["series_decision"]
            story_meta["series"] = {
                "id": str(series.id), "title": series.title, "description": series.description,
                "series_type": series.series_type, "status": series.status,
                "current_part": int(series.current_part or 0), "total_parts": int(series.total_parts or 0),
            } if workflow.series_id else None
            story["meta"] = story_meta
            workflow.draft_json = story
            if draft_json is not None:
                draft_json = story
    if draft_json is not None and previous_signature != next_signature and is_auto_workflow(metadata):
        workflow.metadata_json = metadata
        invalidate_draft_media(workflow, draft_json)
        metadata = dict(workflow.metadata_json or {})
        metadata["draft_review_approved"] = False
        metadata.pop("approved_script_signature", None)
        metadata["draft_review"] = {
            "status": "REVIEW_REQUIRED",
            "reason": "DRAFT_CHANGED",
            "script_signature": next_signature,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        workflow.status = "EDITING"
        workflow.current_stage = "DRAFT_REVIEW_REQUIRED"
        workflow.progress_percent = 80
    workflow.metadata_json = metadata

    db.add(workflow)
    db.flush()
    if old_series_id != workflow.series_id:
        sync_series_current_part(db, old_series_id)
        sync_series_current_part(db, workflow.series_id)
    db.commit()
    db.refresh(workflow)
    return {
        "id": str(workflow.id),
        "title": workflow.title,
        "status": workflow.status,
        "series_id": str(workflow.series_id) if workflow.series_id else None,
        "updated_at": workflow.updated_at,
    }


@router.delete("/{workflow_id:uuid}")
def delete_media_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    workflow = db.get(MediaWorkflow, workflow_id)
    if not workflow or (not user.is_system_admin and workflow.user_id != user.id):
        raise HTTPException(status_code=404, detail="Workflow not found")

    old_series_id = workflow.series_id
    db.query(KafkaTask).filter(
        KafkaTask.reference_id == workflow.id,
        KafkaTask.reference_type == "media_workflow",
    ).delete(synchronize_session=False)

    db.delete(workflow)
    db.flush()
    sync_series_current_part(db, old_series_id)
    db.commit()
    return {"message": "Workflow deleted successfully", "workflow_id": str(workflow_id)}


def _source_workflow_title(db: Session, payload: MediaWorkflowFromSourcesRequest, user: User) -> str | None:
    if payload.content_ids:
        content = db.get(ContentItem, payload.content_ids[0])
        return (content.canonical_title or content.normalized_title) if content and _can_use_content(content, user) else None
    if payload.story_ids:
        story = db.get(Story, payload.story_ids[0])
        return story.canonical_name if story and _can_use_story(db, story, user) else None
    return None


def _can_use_content(content: ContentItem, user: User) -> bool:
    return user.is_system_admin or content.content_scope == "GLOBAL" or (content.content_scope == "PRIVATE" and content.owner_user_id == user.id)


def _can_use_story(db: Session, story: Story, user: User) -> bool:
    if story.content_id:
        content = db.get(ContentItem, story.content_id)
        return bool(content and _can_use_content(content, user))
    return user.is_system_admin


def _latest_tasks_by_workflow(db: Session, workflow_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    if not workflow_ids:
        return {}
    # PostgreSQL DISTINCT ON returns at most one small row per workflow, not its
    # entire task history. A still-active task wins over a newer completed task.
    priority = case(ACTIVE_TASK_STATUS_PRIORITY, value=KafkaTask.status, else_=0)
    rows = (
        db.query(
            KafkaTask.reference_id,
            KafkaTask.task_type,
            KafkaTask.status,
            KafkaTask.current_stage,
            KafkaTask.progress_percent,
        )
        .filter(
            KafkaTask.reference_type == "media_workflow",
            KafkaTask.reference_id.in_(workflow_ids),
            KafkaTask.task_type.in_(VIDEO_RUN_TYPES),
        )
        .distinct(KafkaTask.reference_id)
        .order_by(KafkaTask.reference_id, priority.desc(), KafkaTask.created_at.desc(), KafkaTask.id.desc())
        .all()
    )
    return {row.reference_id: {
        "task_type": row.task_type,
        "status": row.status, "current_stage": row.current_stage,
        "progress_percent": float(row.progress_percent or 0),
    } for row in rows}


def _workflow_tasks(db: Session, workflow_id: uuid.UUID, *, limit: int) -> list[dict]:
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
    return [_serialize_task_row(row) for row in rows]


def _select_active_task(tasks: list[dict]) -> dict | None:
    active = [task for task in tasks if task["status"] in ACTIVE_TASK_STATUSES]
    if not active:
        return None
    return max(active, key=_active_task_sort_key)


def _active_task_sort_key(task: dict) -> tuple[int, datetime]:
    created_at = task.get("created_at")
    if not isinstance(created_at, datetime):
        created_at = datetime.min
    return (ACTIVE_TASK_STATUS_PRIORITY.get(str(task.get("status") or ""), 0), created_at)


def _serialize_task_row(row) -> dict:
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


def _workspace_source_content(db: Session, content_id: uuid.UUID | None) -> dict | None:
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
    return {
        "id": str(row.id),
        "content_type": row.content_type,
        "title": row.canonical_title,
        "canonical_title": row.canonical_title,
        "summary": row.summary,
        "full_text": _load_content_full_text(row.mongo_normalized_id),
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
            "content": _load_content_full_text(row.mongo_normalized_id) or row.summary or "",
            "images": [],
            "videos": [],
            "url": row.canonical_url,
        },
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _draft_has_voice(draft: dict) -> bool:
    audio = draft.get("audio") if isinstance(draft.get("audio"), dict) else {}
    if audio.get("voice"):
        return True
    timeline = draft.get("timeline") if isinstance(draft.get("timeline"), dict) else {}
    clips = timeline.get("audio") if isinstance(timeline.get("audio"), list) else []
    return any(isinstance(clip, dict) and clip.get("src") and str(clip.get("type") or "").lower() == "voice" for clip in clips)


def _final_video_uri(artifacts: list[dict]) -> str | None:
    candidates = [
        item for item in artifacts
        if isinstance(item, dict)
        and item.get("uri")
        and item.get("status") != "STALE"
        and (item.get("type") == "FINAL_VIDEO" or item.get("artifact_type") == "FINAL_VIDEO")
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return str(candidates[0]["uri"])
