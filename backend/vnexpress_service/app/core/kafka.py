from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from kafka import KafkaConsumer, KafkaProducer

from backend.vnexpress_service.app.core.config import settings


def json_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def make_producer() -> KafkaProducer:
    return KafkaProducer(
        bootstrap_servers=settings.kafka_bootstrap_servers.split(","),
        value_serializer=lambda value: json.dumps(value, ensure_ascii=False, default=json_default).encode("utf-8"),
        key_serializer=lambda value: str(value).encode("utf-8") if value is not None else None,
    )


def make_consumer() -> KafkaConsumer:
    return KafkaConsumer(
        settings.crawl_requested_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers.split(","),
        group_id=settings.consumer_group,
        value_deserializer=lambda value: json.loads(value.decode("utf-8")),
        auto_offset_reset="latest",
        enable_auto_commit=True,
    )
