from __future__ import annotations

from uuid import uuid4

from backend.user_service.app.core.kafka import PUBLISH_REQUESTED_TOPIC, publish_event


def request_publish(
    *,
    user_id: int | None,
    article_link: str | None,
    platform: str | None,
    profile_id: int | None = None,
    queue_item_id: int | None = None,
    content_override: str | None = None,
) -> dict:
    payload = {
        "request_id": str(uuid4()),
        "user_id": user_id,
        "queue_item_id": queue_item_id,
        "profile_id": profile_id,
        "platform": platform,
        "article_link": article_link,
        "content_override": content_override,
    }
    publish_event(PUBLISH_REQUESTED_TOPIC, payload, key=queue_item_id or payload["request_id"])
    return payload
