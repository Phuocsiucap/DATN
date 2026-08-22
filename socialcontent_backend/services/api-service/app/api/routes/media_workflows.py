import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from common.db.media_workflows import serialize_workflow
from common.db.models import ContentItem, MediaWorkflow, CrawlJob, Episode, ProcessingRun, WorkflowArtifact, WorkflowRun, WorkflowSource, WorkflowCandidate, SocialProfile, Story, User
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


def _visible_in_video_workspace_filter():
    return or_(
        MediaWorkflow.status.in_(VIDEO_WORKSPACE_STATUSES),
        MediaWorkflow.runs.any(WorkflowRun.run_type.in_(VIDEO_RUN_TYPES)),
        MediaWorkflow.artifacts.any(WorkflowArtifact.artifact_type == "FINAL_VIDEO"),
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
    episode_ids: list[uuid.UUID] = Field(default_factory=list)
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
    content_angle: str | None = None
    target_audience: str | None = None
    tone: str | None = None
    format: str | None = None
    target_duration_seconds: int | None = None
    recommended_part_count: int | None = None
    risk_level: str | None = None
    ai_reasoning: list | None = None
    production_requirements: dict | None = None


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
    raise HTTPException(status_code=410, detail="Workflow-series production entrypoint was removed. Use media_workflows/workflow_parts.")


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
    db.flush()
    active_count = db.query(WorkflowSource).filter(WorkflowSource.workflow_id == workflow.id, WorkflowSource.status == "ACTIVE").count()
    if active_count == 0:
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
    for run in workflow.runs:
        if run.run_type == "PLANNING" and run.status == "WAITING_REVIEW":
            run.status = "SUCCEEDED"
            run.current_stage = "APPROVED"
            run.progress_percent = 100
            db.add(run)
    for part in workflow.parts:
        if part.status == "DRAFT":
            part.status = "APPROVED"
            db.add(part)
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
    for part in workflow.parts:
        if part.status in {"DRAFT", "APPROVED"}:
            part.status = "REJECTED"
            db.add(part)
    if payload.get("feedback_text") and not was_rejected:
        from common.db.models import PlanningFeedback
        feedback = PlanningFeedback(media_workflow_id=workflow.id, feedback_type="REJECT", feedback_text=payload["feedback_text"], created_by=user.id)
        db.add(feedback)
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return serialize_workflow(workflow, db)


@router.patch("/{workflow_id}")
def update_media_workflow(workflow_id: uuid.UUID, payload: MediaWorkflowUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    workflow = db.get(MediaWorkflow, workflow_id)
    if not workflow or workflow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Workflow not found")

    data = payload.model_dump(exclude_unset=True)
    title = data.pop("title", None)
    if title is not None:
        workflow.title = title.strip() or workflow.title

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
        .join(ProcessingRun, ProcessingRun.content_id == ContentItem.id)
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
    for item in items:
        _add_workflow_source(db, workflow, "CONTENT", item.id, content_id=item.id, active=True, score=item.quality_score or 0)
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
        episode = db.get(Episode, payload.episode_ids[0])
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
        episode = db.get(Episode, episode_id)
        _add_workflow_source(db, workflow, "EPISODE", episode_id, episode_id=episode_id, active=bool(episode and _can_use_episode(db, episode, user)))


def _can_use_content(content: ContentItem, user: User) -> bool:
    return user.is_system_admin or content.content_scope == "GLOBAL" or (content.content_scope == "PRIVATE" and content.owner_user_id == user.id)


def _can_use_story(db: Session, story: Story, user: User) -> bool:
    if story.content_id:
        content = db.get(ContentItem, story.content_id)
        return bool(content and _can_use_content(content, user))
    episode = db.query(Episode).filter(Episode.story_id == story.id).first()
    return _can_use_episode(db, episode, user) if episode else user.is_system_admin


def _can_use_episode(db: Session, episode: Episode | None, user: User) -> bool:
    if not episode:
        return False
    content = db.get(ContentItem, episode.content_id)
    return bool(content and _can_use_content(content, user))


def _add_workflow_source(
    db: Session,
    workflow: MediaWorkflow,
    source_type: str,
    source_id: uuid.UUID,
    *,
    content_id=None,
    story_id=None,
    episode_id=None,
    active: bool,
    score: float = 0,
) -> None:
    source = WorkflowSource(
        workflow_id=workflow.id,
        source_type=source_type,
        source_id=source_id,
        content_id=content_id,
        story_id=story_id,
        episode_id=episode_id,
        role="PRIMARY" if active else "REJECTED",
        status="ACTIVE" if active else "REJECTED",
        score=score,
        metadata_json={},
    )
    db.add(source)
    if active:
        candidate = WorkflowCandidate(
            workflow_id=workflow.id,
            content_id=content_id,
            story_id=story_id,
            episode_id=episode_id,
            rank_order=1,
            score=score or 100,
            eligible=True,
            metadata_json={},
        )
        db.add(candidate)
        if not workflow.primary_content_id and not workflow.primary_story_id:
            workflow.primary_content_id = content_id
            workflow.primary_story_id = story_id
