import logging

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CONTENT_NORMALIZED
from app.services.canonical_writer import CanonicalWriter

logger = logging.getLogger(__name__)


def run_content_normalized_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("Kafka disabled; story-processing-service worker idle")
        return

    kafka_consumer = consumer([CONTENT_NORMALIZED], group_id="story-processing-service")
    writer = CanonicalWriter()
    print("[story-processing-service] Consumer started listening on CONTENT_NORMALIZED")
    for record in kafka_consumer:
        try:
            print(f"[story-processing-service] Received normalized record offset: {record.offset}")
            with SessionLocal() as db:
                writer.handle_content_normalized(db, record.value)
            kafka_consumer.commit()
        except Exception as exc:
            print(f"[story-processing-service] Error handling content.normalized event: {exc}")
