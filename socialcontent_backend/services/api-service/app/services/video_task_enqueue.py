from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.services.video_runs import serialize_video_run
from app.services.video_task_guard import ACTIVE_VIDEO_TASK_STATUSES
from common.db.models import KafkaTask, MediaWorkflow
from common.events.envelope import build_event
from common.events.kafka import publish


def enqueue_video_task(
    db: Session,
    workflow: MediaWorkflow,
    *,
    task_type: str,
    queued_stage: str,
    workflow_status: str,
    trigger: str,
    task_payload: dict[str, Any],
    event_topic: str,
    event_payload: dict[str, Any],
) -> dict:
    existing = (
        db.query(KafkaTask)
        .filter(
            KafkaTask.reference_id == workflow.id,
            KafkaTask.task_type == task_type,
            KafkaTask.status.in_(ACTIVE_VIDEO_TASK_STATUSES),
        )
        .order_by(KafkaTask.created_at.desc())
        .first()
    )
    if existing:
        return {"job": serialize_video_run(existing)}

    job = KafkaTask(
        reference_id=workflow.id,
        reference_type="media_workflow",
        task_type=task_type,
        status="PENDING",
        current_stage=queued_stage,
        progress_percent=0,
        payload_jsonb={**task_payload, "trigger": trigger},
    )
    workflow.status = workflow_status
    workflow.current_stage = queued_stage
    workflow.progress_percent = 0
    db.add_all([job, workflow])
    db.commit()
    db.refresh(job)
    publish(
        event_topic,
        build_event(
            event_type=event_topic,
            source="api-service",
            job_id=job.id,
            payload={"workflow_id": str(workflow.id), "run_type": job.task_type, **event_payload},
            correlation_id=workflow.id,
        ),
    )
    return {"job": serialize_video_run(job)}
