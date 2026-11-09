from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.services import generate_video as pipeline
from common.db.models import MediaWorkflow, SocialProfile, User
from common.planning.auto_draft_policy import (
    draft_script_signature,
    invalidate_draft_media,
    is_auto_workflow,
)


def get_owned_video_project(db: Session, workflow_id: uuid.UUID, user: User) -> MediaWorkflow:
    query = db.query(MediaWorkflow).filter(MediaWorkflow.id == workflow_id).with_for_update()
    if not user.is_system_admin:
        query = query.join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id).filter(
            SocialProfile.user_id == user.id
        )
    project = query.first()
    if not project:
        raise HTTPException(status_code=404, detail="Content project not found")
    return project


def public_story_payload(story: dict) -> dict:
    return pipeline.public_story_payload(story)


def project_status(story: dict) -> str:
    artifacts = story.get("video_artifacts") if isinstance(story.get("video_artifacts"), dict) else {}
    audio = story.get("audio") if isinstance(story.get("audio"), dict) else {}
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    if artifacts.get("final"):
        return "RENDERED"
    if audio.get("voice") or any(
        isinstance(clip, dict) and str(clip.get("type") or "").lower() == "voice"
        for clip in timeline.get("audio") or []
    ):
        return "VOICE_READY"
    if timeline.get("video") or timeline.get("text"):
        return "EDITING"
    return "READY"


def persist_project_story(
    db: Session,
    project: MediaWorkflow,
    story: dict,
    status: str | None = None,
) -> None:
    if project.status == "REJECTED":
        raise HTTPException(status_code=409, detail="Workflow đã bị từ chối. Hãy mở lại workflow trước khi sửa draft.")
    previous_story = project.draft_json if isinstance(project.draft_json, dict) else {}
    next_story = deepcopy(story)
    if isinstance(previous_story.get("compact_scenes"), list) and not isinstance(next_story.get("compact_scenes"), list):
        next_story["compact_scenes"] = previous_story["compact_scenes"]
    public_story = public_story_payload(next_story)
    public_story.setdefault("meta", {})
    public_story["meta"]["workflow_id"] = str(project.id)
    public_story["meta"]["user_id"] = str(project.profile.user_id)
    public_story["project_status"] = project_status(public_story)

    metadata = dict(project.metadata_json or {})
    script_changed = bool(previous_story) and draft_script_signature(previous_story) != draft_script_signature(public_story)
    if script_changed and (is_auto_workflow(metadata) or metadata.get("ai_review_required")):
        invalidate_draft_media(project, public_story)
        metadata = dict(project.metadata_json or {})
        signature = draft_script_signature(public_story)
        metadata["draft_review_approved"] = False
        metadata.pop("approved_script_signature", None)
        metadata["draft_review"] = {
            "status": "REVIEW_REQUIRED",
            "reason": "DRAFT_CHANGED",
            "script_signature": signature,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if metadata.get("ai_review_required"):
            metadata["draft_ai_review"] = {
                "status": "PENDING",
                "provider": "deepseek",
                "model": "deepseek-v4-flash",
                "script_signature": signature,
                "reason": "DRAFT_CHANGED",
            }
        project.current_stage = "DRAFT_REVIEW_REQUIRED"
        project.progress_percent = 80
        status = "EDITING"
    project.metadata_json = metadata
    project.draft_json = public_story
    project.status = status or project_status(public_story)
    public_story["project_status"] = project.status
    db.add(project)
    db.commit()
