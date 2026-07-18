from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

from backend.publisher_service.app.core.config import settings
from backend.publisher_service.app.core.kafka import make_consumer, make_producer
from backend.publisher_service.app.services.publisher import publish_article
from backend.publisher_service.app.services.user_client import (
    complete_queue_item,
    get_article_by_link,
    get_profile,
    get_queue_item,
    mark_queue_item_publishing,
)

_executor = ThreadPoolExecutor(max_workers=1)
_producer = None


def _get_producer():
    global _producer
    if _producer is None:
        _producer = make_producer()
    return _producer


def _emit_completed(event: dict[str, Any], result: dict[str, Any], queue_item: dict[str, Any] | None = None) -> None:
    payload = {
        "type": "publish_completed",
        "request_id": event.get("request_id"),
        "queue_item_id": event.get("queue_item_id"),
        "user_id": event.get("user_id") or (queue_item.get("user_id") if queue_item else None),
        "profile_id": event.get("profile_id") or (queue_item.get("profile_id") if queue_item else None),
        "platform": event.get("platform") or (queue_item.get("platform") if queue_item else None),
        "article_link": event.get("article_link") or (queue_item.get("article_link") if queue_item else None),
        "success": bool(result.get("success")),
        "result": result,
        "error": None if result.get("success") else str(result.get("error", "Publish failed")),
        "timestamp": datetime.utcnow().isoformat(),
    }
    _get_producer().send(settings.publish_completed_topic, value=payload, key=payload.get("queue_item_id"))
    _get_producer().flush()


async def _publish_queue_item(event: dict[str, Any]) -> None:
    queue_item_id = event.get("queue_item_id")
    if not queue_item_id:
        _emit_completed(event, {"success": False, "error": "Missing queue_item_id"})
        return

    queue_item = None
    try:
        queue_item = await mark_queue_item_publishing(int(queue_item_id))
        article = await get_article_by_link(queue_item["article_link"])
        result = await publish_article(
            article,
            queue_item["platform"],
            queue_item.get("profile"),
            content_override=queue_item.get("generated_content"),
        )
        await complete_queue_item(
            int(queue_item_id),
            {
                "success": bool(result.get("success")),
                "result": result,
                "error": None if result.get("success") else str(result.get("error", "Publish failed")),
                "caption": queue_item.get("generated_content"),
                "content_preview": str(queue_item.get("generated_content") or "")[:200],
            },
        )
        _emit_completed(event, result, queue_item)
    except Exception as exc:
        if queue_item and queue_item_id:
            try:
                await complete_queue_item(int(queue_item_id), {"success": False, "result": {}, "error": str(exc)})
            except Exception:
                pass
        _emit_completed(event, {"success": False, "error": str(exc)}, queue_item)


async def _publish_article_event(event: dict[str, Any]) -> None:
    article_link = event.get("article_link")
    platform = event.get("platform")
    profile_id = event.get("profile_id")
    article = await get_article_by_link(article_link)
    profile = await get_profile(int(profile_id)) if profile_id else None
    result = await publish_article(article, platform, profile, content_override=event.get("content_override"))
    _emit_completed(event, result)


async def handle_publish_requested(event: dict[str, Any]) -> None:
    if event.get("queue_item_id"):
        await _publish_queue_item(event)
    else:
        await _publish_article_event(event)


def consume_forever(loop: asyncio.AbstractEventLoop) -> None:
    consumer = make_consumer()
    for message in consumer:
        asyncio.run_coroutine_threadsafe(handle_publish_requested(message.value), loop)


async def start_worker() -> None:
    loop = asyncio.get_running_loop()
    loop.run_in_executor(_executor, consume_forever, loop)
