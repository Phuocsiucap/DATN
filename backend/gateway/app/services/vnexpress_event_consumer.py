from __future__ import annotations

import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import httpx
from kafka import KafkaConsumer

from backend.gateway.app.api.websockets.events import broadcast
from backend.gateway.app.core.database_mongo import articles_col
from backend.gateway.app.core.kafka import (
    KAFKA_DISABLED,
    KAFKA_BOOTSTRAP_SERVERS,
    VNEXPRESS_ARTICLE_CRAWLED_TOPIC,
    VNEXPRESS_CRAWL_COMPLETED_TOPIC,
)

USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")


_executor = ThreadPoolExecutor(max_workers=1)


def make_consumer() -> KafkaConsumer:
    return KafkaConsumer(
        VNEXPRESS_ARTICLE_CRAWLED_TOPIC,
        VNEXPRESS_CRAWL_COMPLETED_TOPIC,
        bootstrap_servers=[server.strip() for server in KAFKA_BOOTSTRAP_SERVERS.split(",") if server.strip()],
        group_id="gateway-vnexpress-events",
        value_deserializer=lambda value: json.loads(value.decode("utf-8")),
        auto_offset_reset="latest",
        enable_auto_commit=True,
    )


async def handle_article_crawled(event: dict) -> None:
    article = event.get("article") or {}
    link = article.get("link")
    if not link:
        return

    existing = articles_col.find_one({"link": link})
    if existing:
        return
    if article.get("title") and articles_col.find_one({"title": article.get("title")}):
        return

    article["crawled_at"] = parse_datetime(article.get("crawled_at")) or datetime.utcnow()
    article["status"] = article.get("status") or "crawled"
    articles_col.insert_one(article)
    article.pop("_id", None)

    queued_count = 0
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(f"{USER_SERVICE_URL}/api/internal/articles/evaluate", json={"article": article})
            response.raise_for_status()
            queued_count = int(response.json().get("queued", 0))
    except Exception as exc:
        await broadcast({
            "type": "article_evaluate_error",
            "title": article.get("title"),
            "link": link,
            "error": str(exc),
            "timestamp": datetime.utcnow().isoformat(),
        })

    await broadcast({
        "type": "article_crawled",
        "title": article.get("title"),
        "link": link,
        "queued_for_profiles": queued_count,
        "timestamp": article["crawled_at"].isoformat(),
    })


async def handle_crawl_completed(event: dict) -> None:
    await broadcast({
        "type": "crawl_done",
        "request_id": event.get("request_id"),
        "new_articles": event.get("crawled", 0),
        "skipped": event.get("skipped", 0),
        "timestamp": datetime.utcnow().isoformat(),
    })


def parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def consume_forever(loop: asyncio.AbstractEventLoop) -> None:
    consumer = make_consumer()
    for message in consumer:
        event = message.value
        if message.topic == VNEXPRESS_ARTICLE_CRAWLED_TOPIC:
            asyncio.run_coroutine_threadsafe(handle_article_crawled(event), loop)
        elif message.topic == VNEXPRESS_CRAWL_COMPLETED_TOPIC:
            asyncio.run_coroutine_threadsafe(handle_crawl_completed(event), loop)


async def start_vnexpress_event_consumer() -> None:
    if KAFKA_DISABLED:
        print("Kafka disabled; VNExpress event consumer not started")
        return
    loop = asyncio.get_running_loop()
    loop.run_in_executor(_executor, consume_forever, loop)
