from __future__ import annotations

import logging
from typing import Any

from common.core.config import get_settings
from common.db.idempotency import claim_event
from common.db.models import SocialProfile
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CRAWL_JOB_COMPLETED
from app.schemas.planning import Module2AutoHandoffRequest
from app.services.planning import PlanningService

logger = logging.getLogger(__name__)


def run_crawl_job_completed_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        logger.info("Kafka disabled; crawl_job_completed consumer idle")
        return

    kafka_consumer = consumer([CRAWL_JOB_COMPLETED], group_id="planning-orchestrator-auto-handoff")
    for record in kafka_consumer:
        try:
            message = record.value
            event_id = message.get("event_id")
            with SessionLocal() as db:
                if event_id and not claim_event(db, event_id, "planning-orchestrator-auto-handoff"):
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
        print(f"[planning-orchestrator] Skipping auto-handoff for non-successful crawl job {job_id} (status={status})")
        return

    # Find active social profiles with strategy
    profiles = (
        db.query(SocialProfile)
        .filter(SocialProfile.status == "active")
        .all()
    )

    if not profiles:
        print(f"[planning-orchestrator] No active social profiles found for auto-handoff on crawl job {job_id}")
        return

    planning_service = PlanningService()
    for profile in profiles:
        if not profile.strategy:
            print(f"[planning-orchestrator] Profile {profile.id} has no strategy, skipping auto-handoff")
            continue
        
        # Check if auto_handoff is disabled for this profile (MANUAL MODE)
        strategy = profile.strategy
        if not getattr(strategy, "auto_handoff_enabled", True):
            print(f"[planning-orchestrator] Profile {profile.id} is in MANUAL Handoff mode (auto_handoff_enabled=False), skipping automatic Module 2 creation")
            continue

        try:
            payload = Module2AutoHandoffRequest(
                profile_id=profile.id,
                crawl_job_id=job_id,
                candidate_limit=20,
                max_related_items_per_primary=5,
                create_planning_job=True,
                planning_mode="AUTO",
            )
            handoff, planning_job = planning_service.create_auto_handoff_from_crawl(
                db, payload, profile.user
            )
            print(
                f"[planning-orchestrator] Created auto handoff {handoff.id} and planning job {planning_job.id if planning_job else None} for profile {profile.id} from crawl job {job_id}"
            )
        except Exception as exc:
            print(f"[planning-orchestrator] Failed auto handoff for profile {profile.id} on crawl job {job_id}: {exc}")
