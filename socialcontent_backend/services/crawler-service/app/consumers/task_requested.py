from __future__ import annotations

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CRAWL_TASK_REQUESTED
from app.services.crawler_runner import CrawlerRunner


def run_task_requested_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("Kafka disabled; crawler-service worker idle")
        return

    kafka_consumer = consumer([CRAWL_TASK_REQUESTED], group_id="crawler-service")
    runner = CrawlerRunner()
    for record in kafka_consumer:
        with SessionLocal() as db:
            runner.handle_task_requested(db, record.value)
        kafka_consumer.commit()
