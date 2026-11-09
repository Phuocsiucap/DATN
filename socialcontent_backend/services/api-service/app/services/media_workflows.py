from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from common.db.media_workflows import content_category_payload, content_source_type, serialize_workflow, serialize_workflows
from common.db.content_series import sync_series_current_part
from common.db.content_series import lock_active_series
from common.db.models import ContentItem, ContentSeries, KafkaTask, MediaWorkflow, PlanningFeedback, SocialProfile, Story, User
from common.planning.auto_draft_policy import draft_script_signature, invalidate_draft_media, is_auto_workflow, sync_compact_scenes
from app.services.content_access import accessible_content_ids
from app.services.video_artifact_retention import purge_workflow_artifacts
from app.services.video_task_guard import ensure_no_active_video_task


def list_media_workflows(
    db: Session,
    user: User,
    *,
    visible_statuses: set[str] | None = None,
    limit: int = 200,
) -> list[dict]:
    query = (
        db.query(MediaWorkflow)
        .join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
        .options(joinedload(MediaWorkflow.series))
        .filter(SocialProfile.user_id == user.id)
    )
    if visible_statuses is not None:
        query = query.filter(MediaWorkflow.status.in_(visible_statuses))

    workflows = query.order_by(MediaWorkflow.updated_at.desc()).limit(limit).all()
    return serialize_workflows(workflows, db)


def owned_workflow_query(db: Session, user: User, *, for_update: bool = False):
    query = (
        db.query(MediaWorkflow)
        .join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
        .filter(SocialProfile.user_id == user.id)
    )
    return query.with_for_update() if for_update else query


def get_owned_workflow(
    db: Session,
    workflow_id: UUID,
    user: User,
    *,
    for_update: bool = False,
    allow_admin: bool = False,
) -> MediaWorkflow:
    if allow_admin and user.is_system_admin:
        query = db.query(MediaWorkflow)
        if for_update:
            query = query.with_for_update()
        workflow = query.filter(MediaWorkflow.id == workflow_id).first()
    else:
        workflow = owned_workflow_query(db, user, for_update=for_update).filter(
            MediaWorkflow.id == workflow_id
        ).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


def create_media_workflow_from_sources(
    db: Session,
    user: User,
    *,
    profile_id: UUID,
    content_ids: list[UUID],
    story_ids: list[UUID],
    primary_source: tuple[str, UUID] | None,
    crawl_job_id: UUID | None,
    title: str | None,
    note: str | None,
    selection_mode: str,
    filters: dict,
) -> dict:
    profile = (
        db.query(SocialProfile)
        .filter(SocialProfile.id == profile_id)
        .with_for_update()
        .first()
    )
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")

    source_refs = _ordered_source_refs(content_ids, story_ids, primary_source)
    direct_content_ids = list(dict.fromkeys(
        source_id for source_type, source_id in source_refs if source_type == "content"
    ))
    requested_story_ids = list(dict.fromkeys(
        source_id for source_type, source_id in source_refs if source_type == "story"
    ))
    stories = (
        db.query(Story).filter(Story.id.in_(requested_story_ids)).all()
        if requested_story_ids
        else []
    )
    stories_by_id = {story.id: story for story in stories}

    content_ids_to_load = list(dict.fromkeys([
        *direct_content_ids,
        *(story.content_id for story in stories if story.content_id),
    ]))
    contents = (
        db.query(ContentItem).filter(ContentItem.id.in_(content_ids_to_load)).all()
        if content_ids_to_load
        else []
    )
    contents_by_id = {content.id: content for content in contents}
    accessible_ids = accessible_content_ids(db, user, contents)

    for content_id in direct_content_ids:
        if content_id not in contents_by_id or content_id not in accessible_ids:
            raise HTTPException(
                status_code=404,
                detail=f"ContentItem not found or inaccessible: {content_id}",
            )
    for story_id in requested_story_ids:
        story = stories_by_id.get(story_id)
        story_content = contents_by_id.get(story.content_id) if story and story.content_id else None
        allowed = (
            bool(story_content and story_content.id in accessible_ids)
            if story and story.content_id
            else bool(story and user.is_system_admin)
        )
        if not story or not allowed:
            raise HTTPException(
                status_code=404,
                detail=f"Story not found or inaccessible: {story_id}",
            )

    primary_type, primary_id = source_refs[0]
    primary_content = _source_ref_content(primary_type, primary_id, contents_by_id, stories_by_id)
    if not primary_content:
        raise HTTPException(status_code=400, detail="Nguồn chính chưa có ContentItem để sản xuất video")

    requested_title = (title or "").strip()
    workflow_title = (
        requested_title
        or _source_ref_title(primary_type, primary_id, contents_by_id, stories_by_id)
        or note
        or "Content workflow"
    )
    primary_category_payload = content_category_payload(primary_content)
    source_type = content_source_type(primary_content)
    workflow = MediaWorkflow(
        profile_id=profile.id,
        title=workflow_title,
        status="READY",
        planning_mode=None,
        primary_content_id=primary_content.id,
        current_stage="READY",
        metadata_json={
            "workflow_type": "ORIGINAL_VIDEO_HARDSUB" if source_type == "BILIBILI" else "ASSEMBLED_VIDEO",
            "selection_mode": selection_mode.upper(),
            "creation_source": "MANUAL_SOURCE_SELECTION",
            "primary_source": {"type": primary_type, "id": str(primary_id)},
            "source_count": len(source_refs),
            "note": note,
            "filters": filters,
            "crawl_job_id": str(crawl_job_id) if crawl_job_id else None,
            **primary_category_payload,
        },
    )
    db.add(workflow)
    db.flush()

    inputs = []
    for index, (source_type, source_id) in enumerate(source_refs):
        role = "primary" if index == 0 else "supporting"
        if source_type == "content":
            content = contents_by_id[source_id]
            inputs.append({
                "type": "content",
                "id": str(source_id),
                "role": role,
                "title": content.canonical_title or content.normalized_title,
                **content_category_payload(content),
            })
            continue

        story = stories_by_id[source_id]
        story_content = contents_by_id.get(story.content_id) if story.content_id else None
        inputs.append({
            "type": "story",
            "id": str(source_id),
            "role": role,
            "title": story.canonical_name,
            "episode_count": int(story.total_episodes or 0),
            "completion_status": story.completion_status,
            **content_category_payload(story_content),
        })

    workflow.inputs_jsonb = inputs
    workflow.status = "READY"
    db.commit()
    db.refresh(workflow)
    return serialize_workflow(workflow, db)


def get_media_workflow(db: Session, workflow_id: UUID, user: User) -> dict:
    workflow = get_owned_workflow(db, workflow_id, user)
    return serialize_workflow(workflow, db)


def delete_media_workflow(db: Session, workflow_id: UUID, user: User) -> dict:
    workflow = get_owned_workflow(db, workflow_id, user, allow_admin=True)
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


def approve_media_workflow(db: Session, workflow_id: UUID, user: User, payload: dict) -> dict:
    workflow = get_owned_workflow(db, workflow_id, user, for_update=True)
    ensure_no_active_video_task(db, workflow, allow_rejected=True)
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
    tasks = db.query(KafkaTask).filter(
        KafkaTask.reference_id == workflow.id,
        KafkaTask.task_type == "PLANNING",
        KafkaTask.status == "WAITING_REVIEW",
    ).all()
    for task in tasks:
        task.status = "COMPLETED"
        db.add(task)
    if payload.get("feedback_text") and not was_approved:
        db.add(PlanningFeedback(
            media_workflow_id=workflow.id,
            feedback_type="APPROVE",
            feedback_text=payload["feedback_text"],
            created_by=user.id,
        ))
    db.add(workflow)
    if was_rejected and workflow.series_id:
        db.flush()
        sync_series_current_part(db, series)
    db.commit()
    db.refresh(workflow)
    return {"plan": serialize_workflow(workflow, db), "media_workflows": []}


def reject_media_workflow(db: Session, workflow_id: UUID, user: User, payload: dict) -> dict:
    workflow = get_owned_workflow(db, workflow_id, user, for_update=True)
    ensure_no_active_video_task(db, workflow, allow_rejected=True)
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
        db.add(PlanningFeedback(
            media_workflow_id=workflow.id,
            feedback_type="REJECT",
            feedback_text=payload["feedback_text"],
            created_by=user.id,
        ))
    db.add(workflow)
    db.flush()
    sync_series_current_part(db, series_id)
    db.commit()
    db.refresh(workflow)
    return serialize_workflow(workflow, db)


def update_media_workflow(db: Session, workflow_id: UUID, user: User, payload: dict) -> dict:
    workflow = get_owned_workflow(db, workflow_id, user, for_update=True)
    data = dict(payload)
    title = data.pop("title", None)
    has_series_id = "series_id" in data
    series_id = data.pop("series_id", None)
    draft_json = data.pop("draft_json", None)
    if draft_json is not None:
        ensure_no_active_video_task(db, workflow)
    if title is not None:
        workflow.title = title.strip() or workflow.title

    old_series_id = workflow.series_id
    if has_series_id:
        if series_id:
            series = db.get(ContentSeries, series_id) if series_id == old_series_id else lock_active_series(db, series_id, profile_id=workflow.profile_id)
            if not series or series.profile_id != workflow.profile_id:
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
    metadata.update(data)
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


def purge_media_workflow_artifacts(db: Session, workflow_id: UUID, user: User) -> dict:
    workflow = get_owned_workflow(db, workflow_id, user, for_update=True, allow_admin=True)
    result = purge_workflow_artifacts(db, workflow, reason="manual_user_request")
    db.commit()
    db.refresh(workflow)
    return {**result, "workflow": serialize_workflow(workflow, db)}


def _ordered_source_refs(
    content_ids: list[UUID],
    story_ids: list[UUID],
    primary_source: tuple[str, UUID] | None,
) -> list[tuple[str, UUID]]:
    refs = [
        *(('content', value) for value in dict.fromkeys(content_ids)),
        *(('story', value) for value in dict.fromkeys(story_ids)),
    ]
    if not refs:
        raise HTTPException(status_code=400, detail="Workflow cần ít nhất một nguồn nội dung hoặc truyện")
    if len(refs) > 20:
        raise HTTPException(status_code=400, detail="Mỗi workflow chỉ hỗ trợ tối đa 20 nguồn")
    if not primary_source:
        return refs

    if primary_source not in refs:
        raise HTTPException(status_code=400, detail="Nguồn chính phải nằm trong danh sách nguồn đã chọn")
    return [primary_source, *[ref for ref in refs if ref != primary_source]]


def _source_ref_content(
    source_type: str,
    source_id: UUID,
    contents: dict[UUID, ContentItem],
    stories: dict[UUID, Story],
) -> ContentItem | None:
    if source_type == "content":
        return contents.get(source_id)
    story = stories.get(source_id)
    return contents.get(story.content_id) if story and story.content_id else None


def _source_ref_title(
    source_type: str,
    source_id: UUID,
    contents: dict[UUID, ContentItem],
    stories: dict[UUID, Story],
) -> str | None:
    if source_type == "content":
        content = contents.get(source_id)
        return (content.canonical_title or content.normalized_title) if content else None
    story = stories.get(source_id)
    return story.canonical_name if story else None
