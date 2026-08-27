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
    source_metadata: dict[str, Any] = Field(default_factory=dict)
    article_id: str | None = None
    category_id: str | None = None
    category: str | None = None
    site_id: str | None = None
    articleId: str | None = None
    categoryId: str | None = None
    siteId: str | None = None

class ContentDetailResponse(ContentResponse):
    full_text: str | None = None
    published_at: datetime | None = None
    duration_seconds: int | None = None
    updated_at: datetime
    source_type: str | None = None
    source_url: str | None = None
    source_author: str | None = None
    source_published_at: datetime | str | None = None
    story_id: uuid.UUID | None = None
    episode_order: int | None = None
    title: str | None = None
    lead: str | None = None
    publishedAt: datetime | str | None = None
    content: str | None = None
    images: list[Any] = Field(default_factory=list)
    videos: list[Any] = Field(default_factory=list)
    url: str | None = None
    normalized: dict[str, Any] = Field(default_factory=dict)


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
    series: FinalSeriesInfoResponse | None = None


class FinalContentViewResponse(BaseModel):
    normal_items: list[FinalContentItemResponse]
    series_items: list[FinalContentItemResponse]
