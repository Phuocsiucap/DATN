import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from common.db.models import User
from common.db.session import get_db
from app.api.deps import get_current_user
from app.schemas.video_workspace_list import VideoWorkspaceListResponse
from app.services.media_workflows import (
    approve_media_workflow as approve_media_workflow_service,
    create_media_workflow_from_sources as create_media_workflow_from_sources_service,
    delete_media_workflow as delete_media_workflow_service,
    get_media_workflow as get_media_workflow_service,
    get_owned_workflow as _get_owned_workflow,
    list_media_workflows as list_media_workflows_service,
    purge_media_workflow_artifacts as purge_media_workflow_artifacts_service,
    reject_media_workflow as reject_media_workflow_service,
    update_media_workflow as update_media_workflow_service,
)
from app.services.video_workspace_list import (
    VIDEO_WORKSPACE_STATUSES,
    list_video_workspace as list_video_workspace_service,
)
from app.services.video_workspace_detail import (
    get_video_workflow_progress as get_video_workflow_progress_service,
    get_video_workspace as get_video_workspace_service,
)


router = APIRouter()


class MediaWorkflowSourceRef(BaseModel):
    type: Literal["content", "story"]
    id: uuid.UUID


class MediaWorkflowFromSourcesRequest(BaseModel):
    profile_id: uuid.UUID
    crawl_job_id: uuid.UUID | None = None
    content_ids: list[uuid.UUID] = Field(default_factory=list)
    story_ids: list[uuid.UUID] = Field(default_factory=list)
    primary_source: MediaWorkflowSourceRef | None = None
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
    visible_statuses = VIDEO_WORKSPACE_STATUSES if video_workspace_only else None
    return list_media_workflows_service(
        db,
        user,
        visible_statuses=visible_statuses,
        limit=200,
    )


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
    return list_video_workspace_service(
        db,
        user.id,
        profile_id=profile_id,
        series_id=series_id,
        status=status,
        stage=stage,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get("/{workflow_id:uuid}")
def get_media_workflow(workflow_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_media_workflow_service(db, workflow_id, user)


@router.get("/{workflow_id:uuid}/workspace")
def get_video_workspace(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_video_workspace_service(db, workflow_id, user)


@router.get("/{workflow_id:uuid}/progress")
def get_video_workflow_progress(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_video_workflow_progress_service(db, workflow_id, user)


@router.post("/from-sources", status_code=201)
def create_media_workflow_from_sources(payload: MediaWorkflowFromSourcesRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    primary_source = (
        (payload.primary_source.type, payload.primary_source.id)
        if payload.primary_source
        else None
    )
    return create_media_workflow_from_sources_service(
        db,
        user,
        profile_id=payload.profile_id,
        crawl_job_id=payload.crawl_job_id,
        content_ids=payload.content_ids,
        story_ids=payload.story_ids,
        primary_source=primary_source,
        title=payload.title,
        note=payload.note,
        selection_mode=payload.selection_mode,
        filters=payload.filters,
    )


@router.post("/{workflow_id:uuid}/approve")
def approve_media_workflow(workflow_id: uuid.UUID, payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return approve_media_workflow_service(db, workflow_id, user, payload)


@router.post("/{workflow_id:uuid}/reject")
def reject_media_workflow(workflow_id: uuid.UUID, payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return reject_media_workflow_service(db, workflow_id, user, payload)


@router.patch("/{workflow_id:uuid}")
def update_media_workflow(workflow_id: uuid.UUID, payload: MediaWorkflowUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return update_media_workflow_service(
        db, workflow_id, user, payload.model_dump(exclude_unset=True)
    )


@router.delete("/{workflow_id:uuid}")
def delete_media_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return delete_media_workflow_service(db, workflow_id, user)


@router.post("/{workflow_id:uuid}/purge-artifacts")
def purge_media_workflow_artifacts(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return purge_media_workflow_artifacts_service(db, workflow_id, user)
