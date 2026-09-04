from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MediaItemInput(BaseModel):
    """Media item for manual content creation"""
    url: str
    type: str = "IMAGE"  # IMAGE, VIDEO, AUDIO
    thumbnail_url: str | None = None
    caption: str | None = None
    alt: str | None = None


class ContentCreateRequest(BaseModel):
    """Schema for manually creating content"""
    canonical_title: str = Field(..., min_length=1, max_length=500, description="Title of the content")
    summary: str | None = Field(None, max_length=2000, description="Brief summary or description")
    full_text: str | None = Field(None, description="Full text content of the article")
    canonical_url: str | None = Field(None, description="Source URL if available")
    content_type: str = Field(default="ARTICLE", description="ARTICLE, VIDEO, IMAGE, etc.")
    source_type: str = Field(default="MANUAL", description="Source platform (MANUAL, VNEXPRESS, etc.)")
    category: str | None = Field(None, max_length=100, description="Content category")
    tags: list[str] = Field(default_factory=list, description="List of tags")
    language: str = Field(default="vi", description="Content language code")
    content_scope: str = Field(default="PRIVATE", description="PRIVATE or GLOBAL (admin only)")
    published_at: datetime | None = Field(None, description="Original publication date if known")
    media_urls: list[str] = Field(default_factory=list, description="List of media URLs (images/videos)")
    media_items: list[MediaItemInput] = Field(default_factory=list, description="Detailed media items")
    source_author: str | None = Field(None, max_length=200, description="Original author name")
    
    @field_validator('content_type')
    @classmethod
    def validate_content_type(cls, v: str) -> str:
        allowed = ['ARTICLE', 'VIDEO', 'IMAGE', 'AUDIO', 'POST']
        v_upper = v.upper()
        if v_upper not in allowed:
            raise ValueError(f'content_type must be one of {allowed}')
        return v_upper
    
    @field_validator('content_scope')
    @classmethod
    def validate_content_scope(cls, v: str) -> str:
        allowed = ['PRIVATE', 'GLOBAL']
        v_upper = v.upper()
        if v_upper not in allowed:
            raise ValueError(f'content_scope must be one of {allowed}')
        return v_upper
    
    @field_validator('tags')
    @classmethod
    def validate_tags(cls, v: list[str]) -> list[str]:
        # Remove empty tags and limit to 20 tags
        cleaned = [tag.strip() for tag in v if tag and tag.strip()]
        return cleaned[:20]


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
    content_scope: str
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
    existing_workflow_id: uuid.UUID | None = None
    existing_workflow_status: str | None = None
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
