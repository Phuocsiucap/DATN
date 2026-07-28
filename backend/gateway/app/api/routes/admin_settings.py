from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.gateway.app.api.routes.auth import get_current_user
from backend.gateway.app.services.scheduler import (
    get_scheduler_status_payload,
    update_scheduler_settings,
)

router = APIRouter()


class SchedulerSettingsRequest(BaseModel):
    vnexpress_interval_minutes: int = Field(..., ge=1, le=1440)
    bilibili_interval_minutes: int = Field(..., ge=1, le=1440)
    publish_queue_interval_minutes: int = Field(5, ge=1, le=1440)


def _require_system_user(current_user) -> None:
    roles = [getattr(role, "name", role) for role in getattr(current_user, "roles", [])]
    if "system" not in roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin system only")


@router.get("/scheduler")
async def get_scheduler_settings(current_user=Depends(get_current_user)):
    _require_system_user(current_user)
    return get_scheduler_status_payload()


@router.put("/scheduler")
async def save_scheduler_settings(
    request: SchedulerSettingsRequest,
    current_user=Depends(get_current_user),
):
    _require_system_user(current_user)
    settings = await update_scheduler_settings(request.dict())
    status_payload = get_scheduler_status_payload()
    return {
        **status_payload,
        "settings": settings,
    }
