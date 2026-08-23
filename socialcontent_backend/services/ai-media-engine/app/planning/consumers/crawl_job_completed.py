from __future__ import annotations

import logging
import uuid
from typing import Any

from common.core.config import get_settings
from common.db.idempotency import claim_event
from common.db.models import ContentItem, MediaWorkflow, KafkaTask, SocialProfile
from common.db.session import SessionLocal
from common.events.envelope import build_event
from common.events.kafka import consumer, publish
from common.events.topics import CRAWL_JOB_COMPLETED, PLANNING_AI_REQUESTED

logger = logging.getLogger(__name__)


def run_crawl_job_completed_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        logger.info("Kafka disabled; crawl_job_completed consumer idle")
        return

    kafka_consumer = consumer([CRAWL_JOB_COMPLETED], group_id="planning-orchestrator-auto-project-queue")
    for record in kafka_consumer:
        try:
            message = record.value
            event_id = message.get("event_id")
            with SessionLocal() as db:
                if event_id and not claim_event(db, event_id, "planning-orchestrator-auto-project-queue"):
                    kafka_consumer.commit()
                    continue
                _handle_crawl_job_completed(db, message)
            kafka_consumer.commit()
        except Exception as e:
            logger.exception(f"[planning-orchestrator] Error processing crawl_job_completed record offset {record.offset}: {e}")


def _handle_crawl_job_completed(db: Any, message: dict[str, Any]) -> None:
    job_id = message.get("job_id") or message.get("payload", {}).get("job_id")
    status = message.get("payload", {}).get("status") or "SUCCEEDED"
    print(f"[planning-orchestrator] Received crawl.job.completed for job_id={job_id}, status={status}")

    if status not in {"SUCCEEDED", "PARTIAL_SUCCESS"}:
        print(f"[planning-orchestrator] Skipping auto project queue for non-successful crawl job {job_id} (status={status})")
        return

    profiles = (
        db.query(SocialProfile)
        .filter(SocialProfile.status == "active")
        .all()
    )

    if not profiles:
        print(f"[planning-orchestrator] No active social profiles found for auto project queue on crawl job {job_id}")
        return

    for profile in profiles:
        if not profile.strategy:
            continue
        
        strategy = profile.strategy
        if not getattr(strategy, "receive_system_content", True):
            continue
        if not getattr(strategy, "auto_project_queue_enabled", False):
            continue

        try:
            candidate_limit = max(1, min(int(getattr(strategy, "max_system_recommendations", 20) or 20), 100))
            project = _create_project_from_crawl(db, profile, job_id, candidate_limit)
            
            if getattr(strategy, "auto_planning_enabled", False):
                run = KafkaTask(
                    reference_id=str(project.id),
                    task_type="AI_PLANNING",
                    status="PENDING",
                    payload_json={
                        "planning_mode": "AUTO",
                        "target_duration_seconds": 60,
                        "language": "vi",
                    },
                )
                db.add(run)
                project.status = "PLANNING"
                db.add(project)
                db.commit()
                db.refresh(run)

                publish(
                    PLANNING_AI_REQUESTED,
                    build_event(
                        event_type=PLANNING_AI_REQUESTED,
                        source="api-service",
                        payload={"workflow_id": str(project.id), "task_id": str(run.id)},
                        correlation_id=project.id,
                    ),
                )
                print(f"[planning-orchestrator] Created content project {project.id} and planning task {run.id} for profile {profile.id} from crawl job {job_id}")
            else:
                print(
                    f"[planning-orchestrator] Created content project {project.id} for profile {profile.id} from crawl job {job_id}; "
                    "auto_planning_enabled=False so planning task was not created"
                )
        except Exception as exc:
            print(f"[planning-orchestrator] Failed auto project for profile {profile.id} on crawl job {job_id}: {exc}")


def _create_project_from_crawl(db: Any, profile: SocialProfile, job_id: str, candidate_limit: int = 20) -> MediaWorkflow:
    crawl_job_id = uuid.UUID(str(job_id))
    existing = next(
        (
            project
            for project in db.query(MediaWorkflow)
            .filter(MediaWorkflow.profile_id == profile.id)
            .order_by(MediaWorkflow.created_at.desc())
            .limit(50)
            .all()
            if isinstance(project.metadata_json, dict)
            and str(project.metadata_json.get("crawl_job_id") or "") == str(job_id)
            and str(project.metadata_json.get("selection_mode") or "") == "AUTO"
        ),
        None,
    )
    if existing:
        return existing

    # Get content items from this crawl_job by checking sources_jsonb
    items = (
        db.query(ContentItem)
        .filter(ContentItem.status.in_(["READY", "USABLE_WITH_WARNING"]))
        .order_by(ContentItem.quality_score.desc(), ContentItem.updated_at.desc())
        .limit(candidate_limit)
        .all()
    )
    
    # Filter in python to avoid complex jsonb query for now
    items = [item for item in items if any(s.get("crawl_job_id") == str(job_id) for s in (item.sources_jsonb if isinstance(item.sources_jsonb, list) else []))]
    
    inputs = []
    primary_content_id = None
    for item in items:
        inputs.append({"type": "CONTENT", "id": str(item.id), "score": item.quality_score or 0})
        if not primary_content_id:
            primary_content_id = item.id

    project = MediaWorkflow(
        user_id=profile.user_id,
        profile_id=profile.id,
        title="Auto dataset from Module 1",
        status="READY" if items else "NEEDS_REVIEW",
        primary_content_id=primary_content_id,
        inputs_jsonb=inputs,
        metadata_json={"selection_mode": "AUTO", "crawl_job_id": str(job_id), "filters": {"source_crawl_job_id": str(job_id)}},
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project
