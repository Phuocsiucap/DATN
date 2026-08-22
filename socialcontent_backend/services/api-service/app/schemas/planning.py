from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class WorkflowRunCreateRequest(BaseModel):
    profile_id: uuid.UUID
    workflow_id: uuid.UUID
    planning_mode: str = "SERIES"
    target_duration_seconds: int | None = 60
    preferred_part_count: int | None = None
    language: str = "vi"
    instructions: str | None = None
    skip_ai_evaluation: bool = False


class WorkflowRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID | None = None
    profile_id: uuid.UUID | None = None
    workflow_id: uuid.UUID | None = None
    planning_mode: str
    status: str
    current_stage: str
    progress_percent: float
    display_name: str | None = None
    target_duration_seconds: int | None
    preferred_part_count: int | None
    language: str
    instructions: str | None
    attempt_count: int
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class WorkflowCandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_run_id: uuid.UUID | None = None
    content_id: uuid.UUID | None
    story_id: uuid.UUID | None
    episode_id: uuid.UUID | None
    candidate_score: float
    eligible: bool
    rank_order: int | None
    score_breakdown: dict[str, Any]
    selection_reasons: list[Any]
    rejection_reasons: list[Any]
    content_title: str | None = None
    content_url: str | None = None
    created_at: datetime


class WorkflowCandidateUpdateRequest(BaseModel):
    eligible: bool | None = None
    rank_order: int | None = None
    selection_reasons: list[Any] | None = None
    rejection_reasons: list[Any] | None = None


class WorkflowCandidateReselectRequest(BaseModel):
    candidate_limit: int = 10
    min_score: float | None = None


class MediaWorkflowUpdateRequest(BaseModel):
    title: str | None = None
    content_angle: str | None = None
    target_audience: str | None = None
    tone: str | None = None
    format: str | None = None
    target_duration_seconds: int | None = None
    recommended_part_count: int | None = None
    risk_level: str | None = None
    ai_reasoning: list[Any] | None = None
    production_requirements: dict[str, Any] | None = None


class MediaWorkflowReviewRequest(BaseModel):
    feedback_text: str | None = None


class MediaWorkflowRegenerateRequest(BaseModel):
    instructions: str | None = None


class MediaWorkflowResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_id: uuid.UUID | None = None
    workflow_run_id: uuid.UUID | None = None
    profile_id: uuid.UUID | None = None
    primary_content_id: uuid.UUID | None
    primary_story_id: uuid.UUID | None
    title: str
    content_angle: str | None
    target_audience: str | None
    tone: str | None
    format: str | None
    planning_mode: str
    target_duration_seconds: int | None
    recommended_part_count: int | None
    confidence_score: float
    risk_level: str | None
    status: str
    version: int
    ai_reasoning: list[Any]
    production_requirements: dict[str, Any]
    draft_json: dict[str, Any] = Field(default_factory=dict)
    approved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class WorkflowPartResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    series_id: uuid.UUID | None = None
    part_number: int
    part_type: str
    title: str
    goal: str | None
    hook_direction: str | None
    ending_direction: str | None
    previous_part_recap: str | None
    next_part_tease: str | None
    target_duration_seconds: int | None
    status: str
    source_refs: list[Any]
    main_beats: list[Any]
    production_notes: dict[str, Any]
    risk_notes: list[Any]
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
    source_published_at: datetime | None = None
    quality_score: float
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    sources: list[dict[str, Any]] = Field(default_factory=list)
    media: list[dict[str, Any]] = Field(default_factory=list)


class ContentSeriesUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    series_type: str | None = None
    status: str | None = None


class ContentSeriesRegenerateRequest(BaseModel):
    instructions: str | None = None


class WorkflowPartCreateRequest(BaseModel):
    part_number: int | None = None
    part_type: str = "MIDDLE"
    title: str
    goal: str | None = None
    hook_direction: str | None = None
    ending_direction: str | None = None
    previous_part_recap: str | None = None
    next_part_tease: str | None = None
    target_duration_seconds: int | None = None
    source_refs: list[Any] = Field(default_factory=list)
    main_beats: list[Any] = Field(default_factory=list)
    production_notes: dict[str, Any] = Field(default_factory=dict)
    risk_notes: list[Any] = Field(default_factory=list)


class WorkflowPartUpdateRequest(BaseModel):
    part_number: int | None = None
    part_type: str | None = None
    title: str | None = None
    goal: str | None = None
    hook_direction: str | None = None
    ending_direction: str | None = None
    previous_part_recap: str | None = None
    next_part_tease: str | None = None
    target_duration_seconds: int | None = None
    status: str | None = None
    source_refs: list[Any] | None = None
    main_beats: list[Any] | None = None
    production_notes: dict[str, Any] | None = None
    risk_notes: list[Any] | None = None


class WorkflowPartReorderRequest(BaseModel):
    part_ids: list[uuid.UUID]


class ContentSeriesResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    series_type: str
    total_parts: int
    current_part: int
    status: str
    context_version: int
    created_at: datetime
    updated_at: datetime


class ProfileSeriesReviewArticleResponse(BaseModel):
    plan: MediaWorkflowResponse | None = None
    source_content: ProfileSeriesReviewSourceResponse | None = None
    parts: list[WorkflowPartResponse] = Field(default_factory=list)


class ProfileSeriesReviewResponse(BaseModel):
    series: ContentSeriesResponse
    articles: list[ProfileSeriesReviewArticleResponse] = Field(default_factory=list)


class MediaWorkflowSummaryResponse(BaseModel):
    id: uuid.UUID | str
    title: str
    status: str | None = None
    timeline_duration: float | None = None
    rendered_video: str | None = None
    updated_at: datetime | str | None = None
