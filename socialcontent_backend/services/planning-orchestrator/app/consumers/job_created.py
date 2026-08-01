from __future__ import annotations

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import PLANNING_JOB_CREATED
from app.services.pipeline import PlanningPipeline


def run_planning_job_created_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("Kafka disabled; planning-orchestrator worker idle")
        return

    kafka_consumer = consumer([PLANNING_JOB_CREATED], group_id="planning-orchestrator")
    pipeline = PlanningPipeline()
    for record in kafka_consumer:
        with SessionLocal() as db:
            pipeline.handle_planning_job_created(db, record.value)
        kafka_consumer.commit()
