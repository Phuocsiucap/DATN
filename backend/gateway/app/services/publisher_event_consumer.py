from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from kafka import KafkaConsumer

from backend.gateway.app.api.websockets.events import broadcast
from backend.gateway.app.core.kafka import KAFKA_DISABLED, KAFKA_BOOTSTRAP_SERVERS, PUBLISH_COMPLETED_TOPIC

_executor = ThreadPoolExecutor(max_workers=1)


def make_consumer() -> KafkaConsumer:
    return KafkaConsumer(
        PUBLISH_COMPLETED_TOPIC,
        bootstrap_servers=[server.strip() for server in KAFKA_BOOTSTRAP_SERVERS.split(",") if server.strip()],
        group_id="gateway-publisher-events",
        value_deserializer=lambda value: json.loads(value.decode("utf-8")),
        auto_offset_reset="latest",
        enable_auto_commit=True,
    )


async def handle_publish_completed(event: dict) -> None:
    await broadcast({
        "type": "article_published",
        "request_id": event.get("request_id"),
        "queue_item_id": event.get("queue_item_id"),
        "user_id": event.get("user_id"),
        "profile_id": event.get("profile_id"),
        "platform": event.get("platform"),
        "link": event.get("article_link"),
        "success": event.get("success"),
        "error": event.get("error"),
        "timestamp": event.get("timestamp") or datetime.utcnow().isoformat(),
    })


def consume_forever(loop: asyncio.AbstractEventLoop) -> None:
    consumer = make_consumer()
    for message in consumer:
        asyncio.run_coroutine_threadsafe(handle_publish_completed(message.value), loop)


async def start_publisher_event_consumer() -> None:
    if KAFKA_DISABLED:
        print("Kafka disabled; publisher event consumer not started")
        return
    loop = asyncio.get_running_loop()
    loop.run_in_executor(_executor, consume_forever, loop)
