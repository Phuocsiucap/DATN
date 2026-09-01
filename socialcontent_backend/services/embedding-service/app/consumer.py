from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.idempotency import claim_event
from common.db.models import ContentItem, CrawlJobContent
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CONTENT_EMBEDDING_REQUESTED
from app.service import ensure_content_embeddings

logger = logging.getLogger(__name__)
CONSUMER_NAME = "content-embedding-service"


def run_content_embedding_requested_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        logger.info("Kafka disabled; content embedding consumer idle")
        return

    kafka_consumer = consumer([CONTENT_EMBEDDING_REQUESTED], group_id=CONSUMER_NAME)
    for record in kafka_consumer:
        try:
            message = record.value
            event_id = message.get("event_id")
            with SessionLocal() as db:
                if event_id and not claim_event(db, event_id, CONSUMER_NAME):
                    kafka_consumer.commit()
                    continue
                _handle_content_embedding_requested(db, message)
            kafka_consumer.commit()
        except Exception as exc:
            logger.exception("[content-embedding-service] Error processing offset %s: %s", record.offset, exc)


def _handle_content_embedding_requested(db: Session, message: dict[str, Any]) -> None:
    payload = message.get("payload", {}) if isinstance(message.get("payload"), dict) else {}
    content_id = payload.get("content_id")
    job_id = message.get("job_id") or payload.get("job_id")
    items: list[ContentItem] = []
    if job_id:
        items = (
            db.query(ContentItem)
            .join(CrawlJobContent, CrawlJobContent.content_id == ContentItem.id)
            .filter(CrawlJobContent.job_id == uuid.UUID(str(job_id)))
            .order_by(ContentItem.updated_at.desc(), ContentItem.quality_score.desc())
            .all()
        )
    elif content_id:
        content = db.get(ContentItem, uuid.UUID(str(content_id)))
        if content:
            items = [content]

    if not items:
        logger.warning("[content-embedding-service] No content found for crawl_job_id=%s content_id=%s", job_id, content_id)
        return

    result = ensure_content_embeddings(db, items)
    db.commit()
    logger.info(
        "[content-embedding-service] Stored embeddings for crawl_job_id=%s content_id=%s count=%s model=%s",
        job_id,
        content_id,
        result.get("count"),
        result.get("model_name"),
    )
