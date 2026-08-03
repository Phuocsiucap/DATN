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


class ContentSourceDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_type: str
    source_external_id: str
    source_url: str | None
    raw_document_id: str | None
    source_title: str | None
    source_author: str | None
    source_published_at: datetime | None
    metadata_json: dict[str, Any]
    first_seen_at: datetime
    last_seen_at: datetime


class ContentMediaDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    media_type: str
    source_url: str | None
    storage_url: str | None
    thumbnail_url: str | None
    mime_type: str | None
    duration_seconds: int | None
    created_at: datetime


class ProcessingRunDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    processing_type: str
    status: str
    processor_version: str | None
    input_reference: str | None
    output_reference: str | None
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None
    created_at: datetime


class ContentDetailResponse(ContentResponse):
    published_at: datetime | None
    duration_seconds: int | None
    content_hash: str | None
    transcript_hash: str | None
    updated_at: datetime
    sources: list[ContentSourceDetailResponse]
    media: list[ContentMediaDetailResponse]
    processing_runs: list[ProcessingRunDetailResponse]


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
    media: list[ContentMediaDetailResponse] = Field(default_factory=list)
    episode_id: uuid.UUID | None = None
    episode_number: int | None = None
    sequence_order: int | None = None
    episode_title: str | None = None
    series: FinalSeriesInfoResponse | None = None


class FinalContentViewResponse(BaseModel):
    normal_items: list[FinalContentItemResponse]
    series_items: list[FinalContentItemResponse]
