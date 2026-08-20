from __future__ import annotations

import logging
import uuid
from typing import Any

from common.core.config import get_settings
from common.db.idempotency import claim_event
from common.db.models import ContentItem, ContentProject, ProcessingRun, ProjectSource, SocialProfile
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CRAWL_JOB_COMPLETED
from app.schemas.planning import ProjectRunCreateRequest
from app.services.planning import PlanningService

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

    # Find active social profiles with strategy
    profiles = (
        db.query(SocialProfile)
        .filter(SocialProfile.status == "active")
        .all()
    )

    if not profiles:
        print(f"[planning-orchestrator] No active social profiles found for auto project queue on crawl job {job_id}")
        return

    planning_service = PlanningService()
    for profile in profiles:
        if not profile.strategy:
            print(f"[planning-orchestrator] Profile {profile.id} has no strategy, skipping auto project queue")
            continue
        
        # Check if automatic project queueing is disabled for this profile (MANUAL MODE)
        strategy = profile.strategy
        if not getattr(strategy, "receive_system_content", True):
            print(f"[planning-orchestrator] Profile {profile.id} does not receive system content, skipping automatic project creation")
            continue
        if not getattr(strategy, "auto_project_queue_enabled", False):
            print(f"[planning-orchestrator] Profile {profile.id} is in manual project mode (auto_project_queue_enabled=False), skipping automatic project creation")
            continue

        try:
            candidate_limit = max(1, min(int(getattr(strategy, "max_system_recommendations", 20) or 20), 100))
            project = _create_project_from_crawl(db, profile, job_id, candidate_limit)
            project_run = None
            if getattr(strategy, "auto_planning_enabled", False):
                project_run = planning_service.create_job(
                    db,
                    ProjectRunCreateRequest(
                        profile_id=profile.id,
                        project_id=project.id,
                        planning_mode="AUTO",
                        target_duration_seconds=60,
                        language="vi",
                    ),
                    profile.user,
                )
            else:
                print(
                    f"[planning-orchestrator] Created content project {project.id} for profile {profile.id} from crawl job {job_id}; "
                    "auto_planning_enabled=False so planning run was not created"
                )
            if project_run:
                print(
                    f"[planning-orchestrator] Created content project {project.id} and planning run {project_run.id} for profile {profile.id} from crawl job {job_id}"
                )
        except Exception as exc:
            print(f"[planning-orchestrator] Failed auto project for profile {profile.id} on crawl job {job_id}: {exc}")


def _create_project_from_crawl(db: Any, profile: SocialProfile, job_id: str, candidate_limit: int = 20) -> ContentProject:
    crawl_job_id = uuid.UUID(str(job_id))
    existing = next(
        (
            project
            for project in db.query(ContentProject)
            .filter(ContentProject.profile_id == profile.id)
            .order_by(ContentProject.created_at.desc())
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
    items = (
        db.query(ContentItem)
        .join(ProcessingRun, ProcessingRun.content_id == ContentItem.id)
        .filter(
            ProcessingRun.job_id == crawl_job_id,
            ProcessingRun.processing_type == "CANONICAL_SAVE",
            ProcessingRun.status == "SUCCEEDED",
            ContentItem.status.in_(["READY", "USABLE_WITH_WARNING"]),
        )
        .order_by(ContentItem.quality_score.desc(), ContentItem.updated_at.desc())
        .limit(candidate_limit)
        .all()
    )
    project = ContentProject(
        user_id=profile.user_id,
        profile_id=profile.id,
        title="Auto dataset from Module 1",
        status="READY" if items else "NEEDS_REVIEW",
        metadata_json={"selection_mode": "AUTO", "crawl_job_id": str(job_id), "filters": {"source_crawl_job_id": str(job_id)}},
    )
    db.add(project)
    db.flush()
    for item in items:
        db.add(
            ProjectSource(
                project_id=project.id,
                source_type="CONTENT",
                source_id=item.id,
                content_id=item.id,
                role="PRIMARY",
                status="ACTIVE",
                score=item.quality_score or 0,
                metadata_json={"source_crawl_job_id": str(job_id)},
            )
        )
        if not project.primary_content_id:
            project.primary_content_id = item.id
    db.add(project)
    db.commit()
    db.refresh(project)
    return project
