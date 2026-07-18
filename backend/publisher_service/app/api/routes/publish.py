from __future__ import annotations

from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.publisher_service.app.core.config import settings
from backend.publisher_service.app.core.kafka import make_producer
from backend.publisher_service.app.services.publisher import publish_local_video_to_tiktok
from backend.publisher_service.app.services.user_client import get_profile

router = APIRouter()


class PublishCommand(BaseModel):
    request_id: str | None = None
    user_id: int | None = None
    queue_item_id: int | None = None
    profile_id: int | None = None
    platform: str | None = None
    article_link: str | None = None
    content_override: str | None = None


class LocalTikTokPublishRequest(BaseModel):
    profile_id: int
    user_id: int | None = None
    caption: str
    video_path: str


@router.post("")
def enqueue_publish(command: PublishCommand):
    payload = command.model_dump()
    payload["request_id"] = payload.get("request_id") or str(uuid4())
    producer = make_producer()
    producer.send(settings.publish_requested_topic, value=payload, key=payload.get("queue_item_id") or payload["request_id"])
    producer.flush()
    return {"status": "queued", "request_id": payload["request_id"]}


@router.post("/tiktok/local-video")
async def publish_local_tiktok_video(request: LocalTikTokPublishRequest):
    try:
        profile = await get_profile(request.profile_id)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"User service unavailable: {exc}") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text) from exc

    if request.user_id is not None and int(profile.get("user_id")) != int(request.user_id):
        return {"success": False, "error": "Profile does not belong to current user"}
    if profile.get("platform") != "tiktok":
        return {"success": False, "error": "Profile is not a TikTok account"}
    if profile.get("status") != "active":
        return {"success": False, "error": f"Account {profile.get('profile_name')} chưa active"}
    return await publish_local_video_to_tiktok(request.caption, request.video_path, profile)
