from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.services.content_access import can_user_access_content
from app.services.video_runs import serialize_video_run
from common.db.media_workflows import content_category_payload, content_source_type
from common.db.models import ContentItem, KafkaTask, MediaWorkflow, SocialProfile, User
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import GENERATE_VIDEO_SCRIPT_REQUESTED


def create_direct_video_script(
    db: Session,
    user: User,
    *,
    profile_id: UUID,
    content_id: UUID,
    title: str | None,
    note: str | None,
    target_duration_seconds: int | None,
    instructions: str | None,
) -> dict:
    profile = (
        db.query(SocialProfile)
        .filter(SocialProfile.id == profile_id)
        .with_for_update()
        .first()
    )
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")

    content = db.get(ContentItem, content_id)
    if not content or not can_user_access_content(db, content, user):
        raise HTTPException(status_code=404, detail="ContentItem không tồn tại hoặc không thuộc quyền truy cập")
    _ensure_bilibili_ocr_ready(content)

    existing_workflow = (
        db.query(MediaWorkflow)
        .filter(
            MediaWorkflow.profile_id == profile.id,
            MediaWorkflow.primary_content_id == content.id,
        )
        .order_by(MediaWorkflow.created_at.desc())
        .first()
    )
    if existing_workflow:
        existing_job = (
            db.query(KafkaTask)
            .filter(
                KafkaTask.reference_id == existing_workflow.id,
                KafkaTask.reference_type == "media_workflow",
            )
            .order_by(KafkaTask.created_at.desc())
            .first()
        )
        return {
            "workflow": _workflow_summary(existing_workflow),
            "job": serialize_video_run(existing_job) if existing_job else None,
            "reused": True,
        }

    resolved_title = title or content.canonical_title or content.normalized_title or note or "Direct script"
    category_payload = content_category_payload(content)
    workflow = MediaWorkflow(
        profile_id=profile.id,
        title=resolved_title,
        status="SCRIPTING",
        planning_mode=None,
        primary_content_id=content.id,
        inputs_jsonb=[{
            "type": "content",
            "id": str(content.id),
            "role": "primary",
            "title": content.canonical_title or content.normalized_title,
            **category_payload,
        }],
        metadata_json={
            "selection_mode": "MANUAL",
            "creation_source": "DIRECT_SCRIPT",
            "ai_review_required": True,
            "draft_ai_review": {
                "status": "PENDING",
                "provider": "deepseek",
                "model": "deepseek-v4-flash",
                "script_signature": None,
                "reason": "WAITING_FOR_DRAFT",
            },
            "target_duration_seconds": target_duration_seconds,
            "note": note,
            **category_payload,
        },
    )
    db.add(workflow)
    db.flush()
    task_payload = {"content_id": str(content.id), "trigger": "direct_script"}
    if target_duration_seconds:
        task_payload["target_duration_seconds"] = target_duration_seconds
    if instructions and instructions.strip():
        task_payload["instructions"] = instructions.strip()
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
    return {"workflow": _workflow_summary(workflow), "job": serialize_video_run(job), "reused": False}


def _workflow_summary(workflow: MediaWorkflow) -> dict:
    return {
        "id": str(workflow.id),
        "title": workflow.title,
        "status": workflow.status,
        "profile_id": str(workflow.profile_id),
        "primary_content_id": str(workflow.primary_content_id),
    }


def _ensure_bilibili_ocr_ready(content: ContentItem) -> None:
    if content_source_type(content) != "BILIBILI":
        return
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary = sources[0] if sources and isinstance(sources[0], dict) else {}
    metadata = primary.get("metadata_json") if isinstance(primary.get("metadata_json"), dict) else {}
    results = metadata.get("ocr_results") if isinstance(metadata.get("ocr_results"), dict) else {}
    has_translated_text = any(
        isinstance(item, dict) and bool(item.get("translated_text") or item.get("raw_text"))
        for item in results.values()
    )
    if not has_translated_text:
        raise HTTPException(
            status_code=409,
            detail="Bilibili cần OCR/dịch xong ít nhất một tập trước khi tạo workflow sản xuất.",
        )
