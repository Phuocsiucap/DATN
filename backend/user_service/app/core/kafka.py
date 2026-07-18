from __future__ import annotations

import json
import os
from datetime import date, datetime
from functools import lru_cache
from typing import Any

from kafka import KafkaProducer

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
PUBLISH_REQUESTED_TOPIC = os.getenv("PUBLISH_REQUESTED_TOPIC", "publisher.publish.requested")


def json_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


@lru_cache
def get_kafka_producer() -> KafkaProducer:
    return KafkaProducer(
        bootstrap_servers=[server.strip() for server in KAFKA_BOOTSTRAP_SERVERS.split(",") if server.strip()],
        value_serializer=lambda value: json.dumps(value, ensure_ascii=False, default=json_default).encode("utf-8"),
        key_serializer=lambda value: str(value).encode("utf-8") if value is not None else None,
    )


def publish_event(topic: str, payload: dict[str, Any], key: str | int | None = None) -> None:
    producer = get_kafka_producer()
    producer.send(topic, value=payload, key=key)
    producer.flush()
