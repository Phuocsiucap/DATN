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
    content_topic_descriptions: dict[str, str] | None = None
    avoid_topics: str | None = None
    avoid_topic_descriptions: dict[str, str] | None = None
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
    min_similarity: float | None = None
    avoid_similarity_threshold: float | None = None
    require_video: bool | None = None
    receive_system_content: bool | None = None
    auto_project_queue_enabled: bool | None = None
    video_render_mode: str | None = None
    max_system_recommendations: int | None = None
    auto_queue_enabled: bool | None = None
    auto_publish_enabled: bool | None = None


class StrategyTopicDetailResponse(BaseModel):
    topic: str
    topic_key: str
    description: str
    embedding_text: str
    custom_description: bool = False


class StrategyTopicMutationRequest(BaseModel):
    kind: str = "content"
    topic: str | None = None
    description: str | None = None


class SocialProfileStrategyResponse(BaseModel):
    id: uuid.UUID
    content_topics: str
    content_topic_descriptions: dict[str, str] = Field(default_factory=dict)
    content_topic_details: list[StrategyTopicDetailResponse] = Field(default_factory=list)
    avoid_topics: str
    avoid_topic_descriptions: dict[str, str] = Field(default_factory=dict)
    avoid_topic_details: list[StrategyTopicDetailResponse] = Field(default_factory=list)
    tone: str
    target_audience: str
    post_frequency_per_day: int
    active_hours: str
    schedule_enabled: bool
    schedule_days: str
    schedule_times: str
    schedule_timezone: str
    approval_mode: str
    risk_level: str
    min_similarity: float
    avoid_similarity_threshold: float
    require_video: bool
    receive_system_content: bool
    auto_project_queue_enabled: bool
    video_render_mode: str
    max_system_recommendations: int
    auto_queue_enabled: bool
    auto_publish_enabled: bool
    created_at: datetime
    updated_at: datetime


class SchedulerSettingsRequest(BaseModel):
    vnexpress_interval_minutes: int = Field(default=30, ge=1, le=1440)
    bilibili_interval_minutes: int = Field(default=30, ge=1, le=1440)
    publish_queue_interval_minutes: int = Field(default=5, ge=1, le=1440)


class QueueStatusRequest(BaseModel):
    status: str


class QueueApproveScheduleRequest(BaseModel):
    schedule_mode: str = "ai"
    scheduled_at: datetime | None = None
    timezone: str | None = "Asia/Bangkok"


class QueueRequestChangesRequest(BaseModel):
    note: str | None = None


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
    follower_count: int | None = None
    following_count: int | None = None
    likes_count: int | None = None
    video_count: int | None = None
    status: str
    scopes: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    token_expires_at: datetime | None = None
    refresh_expires_at: datetime | None = None
    created_at: datetime
    strategy: SocialProfileStrategyResponse | None = None


class SocialProfileListResponse(BaseModel):
    items: list[SocialProfileResponse]
