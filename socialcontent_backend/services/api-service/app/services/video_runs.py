from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from common.db.models import KafkaTask, MediaWorkflow, SocialProfile, User


VIDEO_RUN_TYPES = frozenset({
    "GENERATE_VIDEO_RENDER",
    "GENERATE_VIDEO_SCRIPT",
    "GENERATE_VIDEO_EDIT",
    "GENERATE_VIDEO_REVIEW",
    "GENERATE_VIDEO_VOICE",
    "BILIBILI_RENDER_TASK",
})


def get_video_run(db: Session, run_id: UUID, user: User) -> dict:
    job = db.get(KafkaTask, run_id)
    if not job or job.task_type not in VIDEO_RUN_TYPES:
        raise HTTPException(status_code=404, detail="Render job not found")

    project_query = db.query(MediaWorkflow).filter(MediaWorkflow.id == job.reference_id)
    if not user.is_system_admin:
        project_query = (
            project_query.join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
            .filter(SocialProfile.user_id == user.id)
        )
    project = project_query.first()
    if not project:
        raise HTTPException(status_code=404, detail="Render job not found")
    job.project = project
    return {"job": serialize_video_run(job)}


def serialize_video_run(job: KafkaTask) -> dict:
    metadata = job.payload_jsonb if isinstance(job.payload_jsonb, dict) else {}
    result = job.result_jsonb if isinstance(job.result_jsonb, dict) else {}
    output_path = result.get("output_path") or metadata.get("output_path")
    return {
        "id": str(job.id),
        "workflow_id": str(job.reference_id),
        "run_type": job.task_type,
        "status": job.status,
        "progress_percent": float(job.progress_percent or 0),
        "current_stage": job.current_stage,
        "output_path": output_path,
        "video_url": f"/api/v1/generate-video/output/{str(output_path).replace('out/', '')}" if output_path else None,
        "error_message": job.error_message,
        "created_at": job.created_at,
        "updated_at": getattr(job, "updated_at", job.created_at),
        "started_at": job.started_at,
        "completed_at": job.completed_at,
    }
