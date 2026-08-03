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
        message = record.value
        event_id = message.get("event_id")
        with SessionLocal() as db:
            if event_id and not claim_event(db, event_id, "planning-orchestrator-auto-handoff"):
                kafka_consumer.commit()
                continue
            _handle_crawl_job_completed(db, message)
        kafka_consumer.commit()


def _handle_crawl_job_completed(db: Any, message: dict[str, Any]) -> None:
    job_id = message.get("job_id") or message.get("payload", {}).get("job_id")
    status = message.get("payload", {}).get("status") or "SUCCEEDED"

    if status not in {"SUCCEEDED", "PARTIAL_SUCCESS"}:
        logger.info("Skipping auto-handoff for non-successful crawl job %s (status=%s)", job_id, status)
        return

    # Find active social profiles with strategy
    profiles = (
        db.query(SocialProfile)
        .filter(SocialProfile.status == "active")
        .all()
    )

    if not profiles:
        logger.info("No active social profiles found for auto-handoff on crawl job %s", job_id)
        return

    planning_service = PlanningService()
    for profile in profiles:
        if not profile.strategy:
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
            logger.info(
                "Created auto handoff %s and planning job %s for profile %s from crawl job %s",
                handoff.id,
                planning_job.id if planning_job else None,
                profile.id,
                job_id,
            )
        except Exception as exc:
            logger.exception("Failed auto handoff for profile %s on crawl job %s: %s", profile.id, job_id, exc)
