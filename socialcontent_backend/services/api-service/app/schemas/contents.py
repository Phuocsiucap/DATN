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


class ContentTopicMatchResponse(BaseModel):
    topic: str
    topic_key: str | None = None
    description: str | None = None
    similarity: float
    threshold: float | None = None
    matched: bool | None = None
    match_source: str | None = None


class ContentFitInsightResponse(BaseModel):
    label: str
    value: str
    tone: str | None = None


class ProfileContentMatchResponse(BaseModel):
    profile_id: uuid.UUID
    profile_name: str
    username: str | None = None
    platform: str
    avatar_url: str | None = None
    status: str
    score: float
    recommendation_status: str
    relation_reason: str | None = None
    threshold: float | None = None
    embedding_similarity: float | None = None
    similarity_threshold: float | None = None
    passed_similarity_gate: bool | None = None
    similarity_source: str | None = None
    top_topic_match: ContentTopicMatchResponse | None = None
    avoid_similarity_threshold: float | None = None
    embedding_model: str | None = None
    matched_topics: list[str] = Field(default_factory=list)
    avoided_topics: list[str] = Field(default_factory=list)
    blocked_by_avoid_topics: bool = False
    topic_matches: list[ContentTopicMatchResponse] = Field(default_factory=list)
    avoid_topic_matches: list[ContentTopicMatchResponse] = Field(default_factory=list)
    tone: str | None = None
    target_audience: str | None = None
    can_create_script: bool = False
    selection_reason: str | None = None
    ai_decision_reason: str | None = None
    fit_insights: list[ContentFitInsightResponse] = Field(default_factory=list)
    suggested_angle: str | None = None
    risk_notes: list[str] = Field(default_factory=list)
    source_evidence: list[str] = Field(default_factory=list)


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
    source_metadata: dict[str, Any] = Field(default_factory=dict)
    thumbnail_url: str | None = None
    media_counts: dict[str, int] = Field(default_factory=dict)
    tags: list[Any] = Field(default_factory=list)
    media_jsonb: list[Any] = Field(default_factory=list)
    sources_jsonb: list[Any] = Field(default_factory=list)
    profile_matches: list[ProfileContentMatchResponse] = Field(default_factory=list)
    ai_selection_summary: str | None = None
