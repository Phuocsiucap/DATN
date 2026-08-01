from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Module2HandoffCreateRequest(BaseModel):
    profile_id: uuid.UUID
    story_ids: list[uuid.UUID] = Field(default_factory=list)
    content_ids: list[uuid.UUID] = Field(default_factory=list)
    episode_ids: list[uuid.UUID] = Field(default_factory=list)
    handoff_note: str | None = None
    selection_mode: str = "MANUAL"
    candidate_limit: int | None = None
    filters: dict[str, Any] = Field(default_factory=dict)


class Module2HandoffItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    handoff_id: uuid.UUID
    content_id: uuid.UUID | None
    story_id: uuid.UUID | None
    episode_id: uuid.UUID | None
    status: str
    rejection_reason: str | None
    created_at: datetime


class Module2HandoffResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    profile_id: uuid.UUID
    selection_mode: str
    status: str
    handoff_note: str | None
    eligible_count: int
    rejected_count: int
    filters: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    items: list[Module2HandoffItemResponse] = Field(default_factory=list)


class PlanningJobCreateRequest(BaseModel):
    profile_id: uuid.UUID
    handoff_id: uuid.UUID
    planning_mode: str = "SERIES"
    target_duration_seconds: int | None = 60
    preferred_part_count: int | None = None
    language: str = "vi"
    instructions: str | None = None


class PlanningJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    profile_id: uuid.UUID
    handoff_id: uuid.UUID
    planning_mode: str
    status: str
    current_stage: str
    progress_percent: float
    target_duration_seconds: int | None
    preferred_part_count: int | None
    language: str
    instructions: str | None
    attempt_count: int
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class PlanningCandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    planning_job_id: uuid.UUID
    content_id: uuid.UUID | None
    story_id: uuid.UUID | None
    episode_id: uuid.UUID | None
    candidate_score: float
    eligible: bool
    rank_order: int | None
    score_breakdown: dict[str, Any]
    selection_reasons: list[Any]
    rejection_reasons: list[Any]
    created_at: datetime


class PlanningCandidateUpdateRequest(BaseModel):
    eligible: bool | None = None
    rank_order: int | None = None
    selection_reasons: list[Any] | None = None
    rejection_reasons: list[Any] | None = None


class PlanningCandidateReselectRequest(BaseModel):
    candidate_limit: int = 10
    min_score: float | None = None


class ContentPlanUpdateRequest(BaseModel):
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


class ContentPlanReviewRequest(BaseModel):
    feedback_text: str | None = None


class ContentPlanRegenerateRequest(BaseModel):
    instructions: str | None = None


class ContentPlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    planning_job_id: uuid.UUID
    profile_id: uuid.UUID
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
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SeriesPartResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    series_id: uuid.UUID
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


class SeriesUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    series_type: str | None = None
    status: str | None = None


class SeriesRegenerateRequest(BaseModel):
    instructions: str | None = None


class SeriesPartCreateRequest(BaseModel):
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


class SeriesPartUpdateRequest(BaseModel):
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


class SeriesPartReorderRequest(BaseModel):
    part_ids: list[uuid.UUID]


class ContentSeriesResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content_plan_id: uuid.UUID
    profile_id: uuid.UUID
    title: str
    description: str | None
    series_type: str
    total_parts: int
    current_part: int
    status: str
    context_version: int
    created_at: datetime
    updated_at: datetime


class Module3HandoffCreateRequest(BaseModel):
    content_series_id: uuid.UUID
    part_ids: list[uuid.UUID] = Field(default_factory=list)
    priority: int = 5
    handoff_note: str | None = None


class Module3HandoffPartResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    handoff_id: uuid.UUID
    series_part_id: uuid.UUID
    part_number: int
    status: str
    payload: dict[str, Any]
    created_at: datetime


class Module3HandoffResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    profile_id: uuid.UUID
    content_plan_id: uuid.UUID
    content_series_id: uuid.UUID
    context_id: uuid.UUID | None
    status: str
    handoff_note: str | None
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    parts: list[Module3HandoffPartResponse] = Field(default_factory=list)
