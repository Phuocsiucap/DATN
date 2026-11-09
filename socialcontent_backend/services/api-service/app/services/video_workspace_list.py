from uuid import UUID

from sqlalchemy import case
from sqlalchemy.orm import Session

from common.db.models import ContentItem, ContentSeries, KafkaTask, MediaWorkflow, SocialProfile
from app.schemas.video_workspace_list import (
    VideoWorkspaceListResponse, WorkspaceCard, WorkspaceProfile, WorkspaceSeries,
)

VIDEO_WORKSPACE_STATUSES = {
    "DRAFT", "READY", "APPROVED", "PRODUCTION_READY", "SCRIPTING", "EDITING",
    "REVIEWING", "VOICE_READY", "RENDERING", "RENDERED", "NEEDS_REVIEW", "FAILED",
}
VIDEO_RUN_TYPES = {
    "GENERATE_VIDEO_SCRIPT", "GENERATE_VIDEO_EDIT", "GENERATE_VIDEO_REVIEW",
    "GENERATE_VIDEO_VOICE", "GENERATE_VIDEO_RENDER", "BILIBILI_OCR_EPISODE",
    "BILIBILI_RENDER_TASK",
}
ACTIVE_TASK_STATUS_PRIORITY = {"RUNNING": 3, "PROCESSING": 2, "PENDING": 1}
ACTIVE_TASK_STATUSES = frozenset(ACTIVE_TASK_STATUS_PRIORITY)
FAILED_STAGE_BY_TASK_TYPE = {
    "GENERATE_VIDEO_SCRIPT": "GENERATING_DRAFT",
    "GENERATE_VIDEO_EDIT": "EDITING_DRAFT",
    "GENERATE_VIDEO_REVIEW": "REVIEWING_DRAFT",
    "GENERATE_VIDEO_VOICE": "GENERATING_VOICE",
    "GENERATE_VIDEO_RENDER": "RENDERING_VIDEO",
}


def list_video_workspace(
    db: Session,
    user_id: UUID,
    *,
    profile_id: UUID | None = None,
    series_id: UUID | None = None,
    status: str | None = None,
    stage: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> VideoWorkspaceListResponse:
    filters = [SocialProfile.user_id == user_id, MediaWorkflow.status.in_(VIDEO_WORKSPACE_STATUSES)]
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

    total = (
        db.query(MediaWorkflow.id)
        .join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
        .filter(*filters)
        .count()
    )
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


def _latest_tasks_by_workflow(db: Session, workflow_ids: list[UUID]) -> dict[UUID, dict]:
    if not workflow_ids:
        return {}
    # PostgreSQL DISTINCT ON returns one task per workflow, preferring active
    # work before newer completed history.
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
    return {
        row.reference_id: {
            "task_type": row.task_type,
            "status": row.status,
            "current_stage": row.current_stage,
            "progress_percent": float(row.progress_percent or 0),
        }
        for row in rows
    }


def _card_current_stage(row, task: dict, *, active: bool) -> str | None:
    if active:
        return task.get("current_stage") or row.current_stage
    if row.current_stage != "FAILED":
        return row.current_stage
    if task.get("status") == "FAILED":
        task_stage = task.get("current_stage")
        if task_stage and task_stage != "FAILED":
            return task_stage
        return FAILED_STAGE_BY_TASK_TYPE.get(task.get("task_type"), row.current_stage)
    return row.current_stage


def build_video_workspace_list(rows, tasks_by_workflow, *, total: int, limit: int, offset: int) -> VideoWorkspaceListResponse:
    result = VideoWorkspaceListResponse(total=total, limit=limit, offset=offset)
    for row in rows:
        profile_id = str(row.profile_id)
        series_id = str(row.series_id) if row.series_id else None
        result.profiles.setdefault(profile_id, WorkspaceProfile(
            name=row.profile_name, platform=row.profile_platform, avatar=row.profile_avatar,
        ))
        if series_id:
            result.series.setdefault(series_id, WorkspaceSeries(title=row.series_title))

        # Preserve the existing thumbnail fallback without exposing source metadata.
        media = row.content_media if isinstance(row.content_media, list) else []
        thumbnail = row.source_thumbnail or row.source_image
        if not thumbnail:
            thumbnail = next((
                item.get("thumbnail_url") or item.get("source_url") or item.get("storage_url")
                for item in media if isinstance(item, dict)
                and (item.get("thumbnail_url") or item.get("source_url") or item.get("storage_url"))
            ), None)
        task = tasks_by_workflow.get(row.id, {})
        active = task.get("status") in ACTIVE_TASK_STATUSES
        result.items.append(WorkspaceCard(
            id=str(row.id), profile_id=profile_id, series_id=series_id,
            title=row.title, thumbnail_url=thumbnail, category=row.source_category,
            status=row.status,
            current_stage=_card_current_stage(row, task, active=active),
            progress_percent=float(task.get("progress_percent") or 0) if active else float(row.progress_percent or 0),
            task_status=task.get("status"), updated_at=row.updated_at or row.created_at,
        ))
    return result
