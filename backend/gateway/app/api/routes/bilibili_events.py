from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from backend.gateway.app.api.websockets.events import broadcast


router = APIRouter()


class BilibiliEventRequest(BaseModel):
    event: dict[str, Any]


@router.post("/events")
async def receive_bilibili_event(request: BilibiliEventRequest) -> dict[str, bool]:
    event = {"channel": "bilibili_crawler", **request.event}
    await broadcast(event)
    return {"ok": True}
