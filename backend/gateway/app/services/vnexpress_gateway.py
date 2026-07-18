from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from backend.gateway.app.core.kafka import VNEXPRESS_CRAWL_REQUESTED_TOPIC, publish_event


def request_vnexpress_topic_crawl(
    *,
    user_id: int,
    topics: list[str],
    exclude_keywords: list[str] | None = None,
    limit: int = 10,
    use_ai_scoring: bool = True,
    source: str = "custom_topic_crawl",
) -> dict[str, Any]:
    request_id = str(uuid4())
    payload = {
        "request_id": request_id,
        "type": "topic_crawl",
        "user_id": user_id,
        "topics": topics,
        "exclude_keywords": exclude_keywords or [],
        "limit": max(1, min(int(limit or 10), 30)),
        "use_ai_scoring": bool(use_ai_scoring),
        "source": source,
        "requested_at": datetime.utcnow().isoformat(),
    }
    publish_event(VNEXPRESS_CRAWL_REQUESTED_TOPIC, payload, key=user_id)
    return {
        "status": "queued",
        "request_id": request_id,
        "topic": VNEXPRESS_CRAWL_REQUESTED_TOPIC,
        "payload": payload,
    }
