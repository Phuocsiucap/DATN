from __future__ import annotations

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CONTENT_RAW_CREATED
from app.services.normalization_runner import NormalizationRunner


def run_raw_created_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("Kafka disabled; normalization-service worker idle")
        return

    kafka_consumer = consumer([CONTENT_RAW_CREATED], group_id="normalization-service")
    runner = NormalizationRunner()
    for record in kafka_consumer:
        with SessionLocal() as db:
            runner.handle_raw_created(db, record.value)
        kafka_consumer.commit()
