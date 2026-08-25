from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ContentUpdateRequest(BaseModel):
    canonical_title: str | None = None
    summary: str | None = None
    status: str | None = None
    quality_score: float | None = None


class ContentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content_type: str
    canonical_title: str
    normalized_title: str | None
    summary: str | None
    language: str
    status: str
    canonical_url: str | None
    quality_score: float
    created_at: datetime


class ContentDetailResponse(ContentResponse):
    full_text: str | None = None
    published_at: datetime | None
    duration_seconds: int | None
    content_hash: str | None
    transcript_hash: str | None
    updated_at: datetime
    sources_jsonb: list[Any] = Field(default_factory=list)
    media_jsonb: list[Any] = Field(default_factory=list)
    story_id: uuid.UUID | None = None
    episode_order: int | None = None


class FinalSeriesInfoResponse(BaseModel):
    id: uuid.UUID
    canonical_name: str
    completion_status: str
    total_episodes: int
    grouping_confidence: float


class FinalContentItemResponse(ContentResponse):
    source_type: str | None = None
    source_url: str | None = None
    published_at: datetime | None = None
    media_jsonb: list[Any] = Field(default_factory=list)
    story_id: uuid.UUID | None = None
    episode_order: int | None = None


class FinalContentViewResponse(BaseModel):
    normal_items: list[FinalContentItemResponse]
    series_items: list[FinalContentItemResponse]
