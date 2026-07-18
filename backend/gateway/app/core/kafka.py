from __future__ import annotations

import json
import os
from datetime import date, datetime
from functools import lru_cache
from typing import Any

from kafka import KafkaProducer


KAFKA_DISABLED = os.getenv("DISABLE_KAFKA", "").strip().lower() in {"1", "true", "yes", "on"}
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
VNEXPRESS_CRAWL_REQUESTED_TOPIC = os.getenv("VNEXPRESS_CRAWL_REQUESTED_TOPIC", "vnexpress.crawl.requested")
VNEXPRESS_ARTICLE_CRAWLED_TOPIC = os.getenv("VNEXPRESS_ARTICLE_CRAWLED_TOPIC", "vnexpress.article.crawled")
VNEXPRESS_CRAWL_COMPLETED_TOPIC = os.getenv("VNEXPRESS_CRAWL_COMPLETED_TOPIC", "vnexpress.crawl.completed")
PUBLISH_COMPLETED_TOPIC = os.getenv("PUBLISH_COMPLETED_TOPIC", "publisher.publish.completed")


def json_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


@lru_cache
def get_kafka_producer() -> KafkaProducer:
    if KAFKA_DISABLED:
        raise RuntimeError("Kafka is disabled by DISABLE_KAFKA")
    return KafkaProducer(
        bootstrap_servers=[server.strip() for server in KAFKA_BOOTSTRAP_SERVERS.split(",") if server.strip()],
        value_serializer=lambda value: json.dumps(value, ensure_ascii=False, default=json_default).encode("utf-8"),
        key_serializer=lambda value: str(value).encode("utf-8") if value is not None else None,
    )


def publish_event(topic: str, payload: dict[str, Any], key: str | int | None = None) -> None:
    if KAFKA_DISABLED:
        print(f"Kafka disabled; skipped publishing to {topic}: {payload.get('request_id') or key}")
        return
    producer = get_kafka_producer()
    producer.send(topic, value=payload, key=key)
    producer.flush()
