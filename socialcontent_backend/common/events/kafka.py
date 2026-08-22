from __future__ import annotations

import json
from datetime import date, datetime
from functools import lru_cache
from typing import Any, Iterable

from kafka import KafkaConsumer, KafkaProducer

from common.core.config import get_settings
from common.events.envelope import EventEnvelope


def json_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


@lru_cache
def get_producer() -> KafkaProducer:
    settings = get_settings()
    return KafkaProducer(
        bootstrap_servers=[s.strip() for s in settings.kafka_bootstrap_servers.split(",") if s.strip()],
        value_serializer=lambda value: json.dumps(value, ensure_ascii=False, default=json_default).encode("utf-8"),
        key_serializer=lambda value: str(value).encode("utf-8") if value is not None else None,
        max_block_ms=1000,
        request_timeout_ms=1000,
    )


def publish(topic: str, envelope: EventEnvelope) -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print(f"Kafka disabled; skipped {topic}: {envelope.event_id}")
        return
    try:
        producer = get_producer()
        producer.send(topic, key=envelope.kafka_key(), value=envelope.to_message())
        producer.flush(timeout=1.0)
    except Exception as exc:
        print(f"[Kafka Warning] Failed to publish event {topic}: {exc}")


def consumer(topics: Iterable[str], group_id: str) -> KafkaConsumer:
    settings = get_settings()
    return KafkaConsumer(
        *topics,
        bootstrap_servers=[s.strip() for s in settings.kafka_bootstrap_servers.split(",") if s.strip()],
        group_id=group_id,
        auto_offset_reset="earliest",
        enable_auto_commit=False,
        value_deserializer=lambda value: json.loads(value.decode("utf-8")),
        key_deserializer=lambda value: value.decode("utf-8") if value else None,
    )
