from app.schemas.video_workspace_list import (
    VideoWorkspaceListResponse, WorkspaceCard, WorkspaceProfile, WorkspaceSeries,
)

ACTIVE_TASK_STATUS_PRIORITY = {"RUNNING": 3, "PROCESSING": 2, "PENDING": 1}
ACTIVE_TASK_STATUSES = frozenset(ACTIVE_TASK_STATUS_PRIORITY)
FAILED_STAGE_BY_TASK_TYPE = {
    "GENERATE_VIDEO_SCRIPT": "GENERATING_DRAFT",
    "GENERATE_VIDEO_EDIT": "EDITING_DRAFT",
    "GENERATE_VIDEO_REVIEW": "REVIEWING_DRAFT",
    "GENERATE_VIDEO_VOICE": "GENERATING_VOICE",
    "GENERATE_VIDEO_RENDER": "RENDERING_VIDEO",
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
