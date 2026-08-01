from __future__ import annotations

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CRAWL_JOB_CREATED
from app.services.orchestrator import CrawlOrchestrator


def run_job_created_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("Kafka disabled; crawl-orchestrator worker idle")
        return

    kafka_consumer = consumer([CRAWL_JOB_CREATED], group_id="crawl-orchestrator")
    orchestrator = CrawlOrchestrator()
    for record in kafka_consumer:
        with SessionLocal() as db:
            orchestrator.handle_crawl_job_created(db, record.value)
        kafka_consumer.commit()
