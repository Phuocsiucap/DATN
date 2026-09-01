from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MediaWorkflowResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_id: uuid.UUID | None = None
    profile_id: uuid.UUID | None = None
    primary_content_id: uuid.UUID | None = None
    primary_story_id: uuid.UUID | None = None
    title: str
    content_angle: str | None = None
    target_audience: str | None = None
    tone: str | None = None
    format: str | None = None
    planning_mode: str = "SINGLE"
    target_duration_seconds: int | None = None
    recommended_part_count: int | None = None
    confidence_score: float = 0.0
    risk_level: str | None = None
    status: str
    version: int = 1
    ai_reasoning: list[Any] = Field(default_factory=list)
    production_requirements: dict[str, Any] = Field(default_factory=dict)
    draft_json: dict[str, Any] = Field(default_factory=dict)
    story_data: list[dict[str, Any]] = Field(default_factory=list)
    artifacts_jsonb: list[Any] = Field(default_factory=list)
    inputs_jsonb: list[Any] = Field(default_factory=list)
    approved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ProfileSeriesReviewSourceResponse(BaseModel):
    id: uuid.UUID
    content_type: str
    canonical_title: str
    summary: str | None = None
    full_text: str | None = None
    language: str
    status: str
    canonical_url: str | None = None
    source_type: str | None = None
    source_url: str | None = None
    source_author: str | None = None
    source_published_at: datetime | str | None = None
    source_metadata: dict[str, Any] = Field(default_factory=dict)
    article_id: str | None = None
    articleId: str | None = None
    category_id: str | None = None
    categoryId: str | None = None
    category: str | None = None
    site_id: str | None = None
    siteId: str | None = None
    quality_score: float
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    sources: list[dict[str, Any]] = Field(default_factory=list)
    media: list[dict[str, Any]] = Field(default_factory=list)


class ContentSeriesCreateRequest(BaseModel):
    title: str
    description: str | None = None
    series_type: str = "NARRATIVE"
    profile_id: uuid.UUID | None = None
    status: str = "ACTIVE"
    total_parts: int = 0


class ContentSeriesUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    series_type: str | None = None
    status: str | None = None
    total_parts: int | None = None
    current_part: int | None = None
    profile_id: uuid.UUID | None = None


class ContentSeriesResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    profile_id: uuid.UUID | None = None
    profileId: uuid.UUID | None = None
    title: str
    description: str | None
    series_type: str
    total_parts: int
    current_part: int
    status: str
    context_version: int
    category_id: str | None = None
    categoryId: str | None = None
    category: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ProfileSeriesReviewArticleResponse(BaseModel):
    plan: MediaWorkflowResponse | None = None
    source_content: ProfileSeriesReviewSourceResponse | None = None
    story_data: list[dict[str, Any]] = Field(default_factory=list)


class ProfileSeriesReviewResponse(BaseModel):
    series: ContentSeriesResponse
    articles: list[ProfileSeriesReviewArticleResponse] = Field(default_factory=list)
