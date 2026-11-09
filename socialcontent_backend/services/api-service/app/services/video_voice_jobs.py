from __future__ import annotations

from sqlalchemy.orm import Session

from fastapi import HTTPException

from app.services.video_task_guard import ACTIVE_VIDEO_TASK_STATUSES
from common.db.models import KafkaTask, MediaWorkflow
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import GENERATE_VIDEO_VOICE_REQUESTED
from common.planning.auto_draft_policy import auto_production_allowed, auto_production_block_reason


DEFAULT_AUTO_VOICE_PROVIDER = "edge_tts_namminh"
DEFAULT_VOICE_SPEED = 1.2


def enqueue_project_voice_job(
    db: Session,
    project: MediaWorkflow,
    *,
    trigger: str,
    voice_id: str | None = None,
    voice_speed: float = DEFAULT_VOICE_SPEED,
    voice_provider: str | None = None,
) -> KafkaTask:
    """Validate draft readiness and enqueue one voice task, preserving DB-before-event ordering."""
    story = project.draft_json if isinstance(project.draft_json, dict) else {}
    metadata = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    if project.status == "REJECTED":
        raise HTTPException(status_code=409, detail="Workflow đã bị từ chối. Hãy mở lại workflow trước khi tiếp tục.")
    if not auto_production_allowed(metadata, story):
        raise HTTPException(status_code=409, detail=auto_production_block_reason(metadata, story))

    existing = (
        db.query(KafkaTask)
        .filter(
            KafkaTask.reference_id == project.id,
            KafkaTask.task_type == "GENERATE_VIDEO_VOICE",
            KafkaTask.status.in_(ACTIVE_VIDEO_TASK_STATUSES),
        )
        .order_by(KafkaTask.created_at.desc())
        .first()
    )
    if existing:
        return existing

    effective_provider = voice_provider or DEFAULT_AUTO_VOICE_PROVIDER
    job = KafkaTask(
        reference_id=project.id,
        reference_type="media_workflow",
        task_type="GENERATE_VIDEO_VOICE",
        status="PENDING",
        current_stage="QUEUED_VOICE",
        payload_jsonb={
            "trigger": trigger,
            "voice_id": voice_id,
            "voice_provider": effective_provider,
            "voice_speed": voice_speed,
        },
    )
    project.status = "EDITING"
    project.current_stage = "QUEUED_VOICE"
    project.progress_percent = 0
    db.add_all([job, project])
    db.commit()
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
                "voice_provider": effective_provider,
            },
            correlation_id=project.id,
        ),
    )
    return job
