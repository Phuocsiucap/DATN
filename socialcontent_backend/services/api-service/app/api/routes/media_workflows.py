import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from common.db.media_workflows import serialize_workflow
from common.db.models import ContentItem, MediaWorkflow, CrawlJob, KafkaTask, SocialProfile, Story, User
from common.db.session import get_db
from app.api.deps import get_current_user


router = APIRouter()


VIDEO_WORKSPACE_STATUSES = {
    "APPROVED",
    "PRODUCTION_READY",
    "SCRIPTING",
    "EDITING",
    "REVIEWING",
    "VOICE_READY",
    "RENDERING",
    "RENDERED",
    "VIDEO_APPROVED",
    "QUEUED_FOR_PUBLISHING",
    "PUBLISHED",
}

VIDEO_RUN_TYPES = {
    "GENERATE_VIDEO_SCRIPT",
    "GENERATE_VIDEO_EDIT",
    "GENERATE_VIDEO_REVIEW",
    "GENERATE_VIDEO_RENDER",
}


from sqlalchemy import exists
def _visible_in_video_workspace_filter():
    return or_(
        MediaWorkflow.status.in_(VIDEO_WORKSPACE_STATUSES),
        exists().where(KafkaTask.reference_id == MediaWorkflow.id, KafkaTask.task_type.in_(VIDEO_RUN_TYPES)),
    )


class MediaWorkflowFromContentSeriesRequest(BaseModel):
    series_id: uuid.UUID
    part_ids: list[uuid.UUID] = Field(default_factory=list)
    priority: int = 5
    note: str | None = None


class MediaWorkflowFromSourcesRequest(BaseModel):
    profile_id: uuid.UUID
    crawl_job_id: uuid.UUID | None = None
    content_ids: list[uuid.UUID] = Field(default_factory=list)
    story_ids: list[uuid.UUID] = Field(default_factory=list)
    title: str | None = None
    note: str | None = None
    selection_mode: str = "MANUAL"
    filters: dict = Field(default_factory=dict)


class MediaWorkflowFromCrawlRequest(BaseModel):
    profile_id: uuid.UUID
    crawl_job_id: uuid.UUID
    candidate_limit: int = 20
    min_quality_score: float | None = None
    title: str | None = None
    note: str | None = None
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
    story_data: list | None = None


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


@router.get("/{workflow_id}")
def get_media_workflow(workflow_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.get(MediaWorkflow, workflow_id)
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content workflow not found")
    return serialize_workflow(workflow, db)


@router.post("/from-content-series")
def create_media_workflow_from_content_series(payload: MediaWorkflowFromContentSeriesRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    raise HTTPException(status_code=410, detail="Workflow-series production entrypoint was removed. Use media_workflows draft_json/story_data.")


@router.post("/from-sources")
def create_media_workflow_from_sources(payload: MediaWorkflowFromSourcesRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(SocialProfile, payload.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    title = payload.title or _source_workflow_title(db, payload, user) or payload.note or "Content workflow"
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
        },
    )
    db.add(workflow)
    db.flush()
    _add_workflow_sources(db, workflow, payload, user)
    if not workflow.inputs_jsonb:
        raise HTTPException(status_code=400, detail="Content workflow requires at least one accessible source")
    workflow.status = "READY"
    db.commit()
    db.refresh(workflow)
    return serialize_workflow(workflow, db)


@router.post("/{workflow_id}/approve")
def approve_media_workflow(workflow_id: uuid.UUID, payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.get(MediaWorkflow, workflow_id)
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workflow not found")
    was_approved = workflow.status == "APPROVED"
    metadata = dict(workflow.metadata_json or {})
    metadata.setdefault("approved_at", datetime.now(timezone.utc).isoformat())
    metadata["approved_by"] = str(user.id)
    workflow.metadata_json = metadata
    workflow.status = "APPROVED"
    tasks = db.query(KafkaTask).filter(KafkaTask.reference_id == workflow.id, KafkaTask.task_type == "PLANNING", KafkaTask.status == "WAITING_REVIEW").all()
    for t in tasks:
        t.status = "COMPLETED"
        db.add(t)
    if payload.get("feedback_text") and not was_approved:
        from common.db.models import PlanningFeedback
        feedback = PlanningFeedback(media_workflow_id=workflow.id, feedback_type="APPROVE", feedback_text=payload["feedback_text"], created_by=user.id)
        db.add(feedback)
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return {"plan": serialize_workflow(workflow, db), "media_workflows": []}


@router.post("/{workflow_id}/reject")
def reject_media_workflow(workflow_id: uuid.UUID, payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.get(MediaWorkflow, workflow_id)
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workflow not found")
    was_rejected = workflow.status == "REJECTED"
    metadata = dict(workflow.metadata_json or {})
    metadata.setdefault("rejected_at", datetime.now(timezone.utc).isoformat())
    metadata["rejected_by"] = str(user.id)
    workflow.metadata_json = metadata
    workflow.status = "REJECTED"
    if payload.get("feedback_text") and not was_rejected:
        from common.db.models import PlanningFeedback
        feedback = PlanningFeedback(media_workflow_id=workflow.id, feedback_type="REJECT", feedback_text=payload["feedback_text"], created_by=user.id)
        db.add(feedback)
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return serialize_workflow(workflow, db)


@router.get("/{workflow_id}/video-script")
def get_media_workflow_video_script(workflow_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.get(MediaWorkflow, workflow_id)
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content workflow not found")
        
    draft_json = workflow.draft_json or {}
    metadata = workflow.metadata_json or {}
    
    story_data = draft_json.get("story_data") or metadata.get("story_data") or []
    
    return {
        "id": str(workflow.id),
        "title": workflow.title,
        "status": workflow.status,
        "production_requirements": metadata.get("production_requirements", {}),
        "story_data": story_data,
        # Required fields for VideoProductionWorkspace backwards compatibility
        "video_draft_id": str(getattr(workflow, "video_draft_id", None)) if getattr(workflow, "video_draft_id", None) else None,
        "artifacts": workflow.artifacts_jsonb if isinstance(workflow.artifacts_jsonb, list) else [],
        "metadata": {k: v for k, v in metadata.items() if k != "story_data"},
        "draft_json": {k: v for k, v in draft_json.items() if k != "story_data"},
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at
    }


@router.patch("/{workflow_id}")
def update_media_workflow(workflow_id: uuid.UUID, payload: MediaWorkflowUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.get(MediaWorkflow, workflow_id)
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workflow not found")

    data = payload.model_dump(exclude_unset=True)
    title = data.pop("title", None)
    has_series_id = "series_id" in data
    series_id = data.pop("series_id", None)
    draft_json = data.pop("draft_json", None)
    story_data = data.pop("story_data", None)

    if title is not None:
        workflow.title = title.strip() or workflow.title

    if has_series_id:
        if series_id:
            series = db.get(ContentSeries, series_id)
            if not series or series.user_id != user.id:
                raise HTTPException(status_code=404, detail="Content series not found")
            workflow.series_id = series_id
        else:
            workflow.series_id = None

    if draft_json is not None:
        workflow.draft_json = draft_json
    elif story_data is not None:
        draft = dict(workflow.draft_json or {})
        draft["story_data"] = story_data
        draft.pop("script_parts", None)
        draft.pop("script_part", None)
        workflow.draft_json = draft

    metadata = dict(workflow.metadata_json or {})
    for key, value in data.items():
        metadata[key] = value
    workflow.metadata_json = metadata

    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return serialize_workflow(workflow, db)


@router.post("/from-crawl")
def create_media_workflow_from_crawl(payload: MediaWorkflowFromCrawlRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(SocialProfile, payload.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    crawl_job = db.get(CrawlJob, payload.crawl_job_id)
    if not crawl_job or (not user.is_system_admin and crawl_job.requested_by != user.id):
        raise HTTPException(status_code=404, detail="Crawl job not found")
    min_quality = payload.min_quality_score
    query = (
        db.query(ContentItem)
        .join(ProcessingRun.content_id == ContentItem.id)
        .filter(
            ProcessingRun.job_id == payload.crawl_job_id,
            ProcessingRun.processing_type == "CANONICAL_SAVE",
            ProcessingRun.status == "SUCCEEDED",
            ContentItem.status.in_(["READY", "USABLE_WITH_WARNING"]),
        )
        .distinct()
    )
    if min_quality is not None:
        query = query.filter(ContentItem.quality_score >= min_quality)
    content_types = payload.filters.get("content_types") if isinstance(payload.filters, dict) else None
    if content_types:
        query = query.filter(ContentItem.content_type.in_([str(value).upper() for value in content_types]))
    languages = payload.filters.get("languages") if isinstance(payload.filters, dict) else None
    if languages:
        query = query.filter(ContentItem.language.in_(languages))
    items = query.order_by(ContentItem.quality_score.desc(), ContentItem.updated_at.desc()).limit(payload.candidate_limit).all()
    workflow = MediaWorkflow(
        user_id=user.id,
        profile_id=profile.id,
        title=payload.title or payload.note or "Auto content workflow",
        status="READY" if items else "NEEDS_REVIEW",
        metadata_json={
            "selection_mode": "AUTO",
            "note": payload.note,
            "filters": payload.filters,
            "crawl_job_id": str(payload.crawl_job_id),
        },
    )
    db.add(workflow)
    db.flush()
    inputs = []
    for item in items:
        inputs.append({"type": "CONTENT", "id": str(item.id), "score": item.quality_score or 0})
        if not workflow.primary_content_id:
            workflow.primary_content_id = item.id
    workflow.inputs_jsonb = inputs
    db.commit()
    db.refresh(workflow)
    return serialize_workflow(workflow, db)


def _source_workflow_title(db: Session, payload: MediaWorkflowFromSourcesRequest, user: User) -> str | None:
    if payload.content_ids:
        content = db.get(ContentItem, payload.content_ids[0])
        return (content.canonical_title or content.normalized_title) if content and _can_use_content(content, user) else None
    if payload.story_ids:
        story = db.get(Story, payload.story_ids[0])
        return story.canonical_name if story and _can_use_story(db, story, user) else None
    if payload.episode_ids:
        episode = db.get(payload.episode_ids[0])
        return episode.episode_title if episode and _can_use_episode(db, episode, user) else None
    return None


def _add_workflow_sources(db: Session, workflow: MediaWorkflow, payload: MediaWorkflowFromSourcesRequest, user: User) -> None:
    for content_id in payload.content_ids:
        content = db.get(ContentItem, content_id)
        _add_workflow_source(db, workflow, "CONTENT", content_id, content_id=content_id, active=bool(content and _can_use_content(content, user)))
    for story_id in payload.story_ids:
        story = db.get(Story, story_id)
        _add_workflow_source(db, workflow, "STORY", story_id, story_id=story_id, active=bool(story and _can_use_story(db, story, user)))
    for episode_id in payload.episode_ids:
        episode = db.get(episode_id)
        _add_workflow_source(db, workflow, "EPISODE", episode_id, episode_id=episode_id, active=bool(episode and _can_use_episode(db, episode, user)))


def _can_use_content(content: ContentItem, user: User) -> bool:
    return user.is_system_admin or content.content_scope == "GLOBAL" or (content.content_scope == "PRIVATE" and content.owner_user_id == user.id)


def _can_use_story(db: Session, story: Story, user: User) -> bool:
    if story.content_id:
        content = db.get(ContentItem, story.content_id)
        return bool(content and _can_use_content(content, user))
    return user.is_system_admin


