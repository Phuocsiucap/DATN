from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SocialProfileCreateRequest(BaseModel):
    platform: str = "tiktok"
    profile_name: str
    username: str | None = None


class TikTokQrStartRequest(BaseModel):
    profile_name: str | None = None
    username: str | None = None


class SocialProfileStrategyRequest(BaseModel):
    content_topics: str | None = None
    avoid_topics: str | None = None
    tone: str | None = None
    target_audience: str | None = None
    post_frequency_per_day: int | None = None
    active_hours: str | None = None
    schedule_enabled: bool | None = None
    schedule_days: str | None = None
    schedule_times: str | None = None
    schedule_timezone: str | None = None
    approval_mode: str | None = None
    risk_level: str | None = None
    min_score: float | None = None
    require_video: bool | None = None
    receive_system_content: bool | None = None
    auto_project_queue_enabled: bool | None = None
    video_render_mode: str | None = None
    max_system_recommendations: int | None = None
    auto_queue_enabled: bool | None = None
    auto_publish_enabled: bool | None = None


class SchedulerSettingsRequest(BaseModel):
    vnexpress_interval_minutes: int = Field(default=30, ge=1, le=1440)
    bilibili_interval_minutes: int = Field(default=30, ge=1, le=1440)
    publish_queue_interval_minutes: int = Field(default=5, ge=1, le=1440)


class QueueStatusRequest(BaseModel):
    status: str


class TikTokPublishRequest(BaseModel):
    mode: str = "inbox"
    privacy_level: str | None = None
    disable_comment: bool = False
    disable_duet: bool = False
    disable_stitch: bool = False
    is_aigc: bool = True
    brand_content_toggle: bool = False
    brand_organic_toggle: bool = False


class SocialPostCreateRequest(BaseModel):
    title: str
    post_url: str | None = None
    platform_post_id: str | None = None
    caption: str | None = None
    status: str = "published"
    published_at: datetime | None = None


class SocialPostMetricCreateRequest(BaseModel):
    views: int = 0
    likes: int = 0
    comments: int = 0
    shares: int = 0
    captured_at: datetime | None = None


class SocialProfileResponse(BaseModel):
    id: uuid.UUID
    platform: str
    profile_name: str
    username: str | None
    external_id: str | None = None
    avatar_url: str | None = None
    status: str
    scopes: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    token_expires_at: datetime | None = None
    refresh_expires_at: datetime | None = None
    created_at: datetime
    strategy: dict | None = None
