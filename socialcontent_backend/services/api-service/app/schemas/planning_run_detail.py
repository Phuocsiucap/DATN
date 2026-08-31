"""Public read model for one planning run; storage JSON is not an API contract."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class NamedReference(BaseModel):
    id: str
    name: str | None = None


class TopicDefinition(BaseModel):
    id: str
    kind: Literal["CONTENT", "AVOID"]
    name: str
    key: str | None = None
    description: str | None = None


class TopicScore(BaseModel):
    topic_id: str
    similarity: float | None = None
    threshold: float | None = None
    matched: bool
    source: str | None = None


class CandidateMatching(BaseModel):
    eligible: bool
    score: float
    source_quality_score: float | None = None
    similarity: float | None = None
    similarity_threshold: float | None = None
    avoid_threshold: float | None = None
    passed_similarity_gate: bool | None = None
    blocked_by_avoid_topics: bool | None = None
    require_video: bool | None = None
    has_required_video: bool | None = None
    embedding_model: str | None = None
    source: str | None = None
    topics: list[TopicScore] = Field(default_factory=list)
    avoid_topics: list[TopicScore] = Field(default_factory=list)
    selection_reasons: list[str] = Field(default_factory=list)
    rejection_reasons: list[str] = Field(default_factory=list)


class ProductionDecision(BaseModel):
    status: str | None = None
    source: str | None = None
    reason_code: str | None = None
    reason: str | None = None
    confidence_score: float | None = None


class DraftIssue(BaseModel):
    code: str
    message: str | None = None
    severity: str | None = None
    scene_indexes: list[int] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)


class DraftQuality(BaseModel):
    status: str | None = None
    score: float | None = None
    word_count: int | None = None
    scene_count: int | None = None
    retry_count: int | None = None
    retry_error: str | None = None
    issues: list[DraftIssue] = Field(default_factory=list)


class DraftRisk(BaseModel):
    type: str | None = None
    severity: str | None = None
    message: str | None = None


class DraftDecision(BaseModel):
    title: str | None = None
    angle: str | None = None
    format: str | None = None
    hook_type: str | None = None
    cta_mode: str | None = None
    tone: str | None = None
    target_audience: str | None = None
    confidence_score: float | None = None
    quality: DraftQuality | None = None
    risk_flags: list[DraftRisk] = Field(default_factory=list)


class SeriesDecision(BaseModel):
    action: str | None = None
    target_series_id: str | None = None
    title: str | None = None
    description: str | None = None
    series_type: str | None = None
    total_parts: int | None = None
    reason: str | None = None
    followup_angles: list[str] = Field(default_factory=list)


class TokenUsage(BaseModel):
    input_tokens: int | None = None
    output_tokens: int | None = None
    creative_call_count: int | None = None
    fit_judge_call_count: int | None = None


class CandidateDecision(BaseModel):
    status: str | None = None
    production: ProductionDecision | None = None
    draft: DraftDecision | None = None
    series: SeriesDecision | None = None
    provider: str | None = None
    model: str | None = None
    token_usage: TokenUsage | None = None
    error_message: str | None = None
    # Old runs may only have a textual decision, without a production gate.
    legacy_reason: str | None = None
    notes: list[str] = Field(default_factory=list)


class CandidateReview(BaseModel):
    status: str | None = None
    action: str | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    reason: str | None = None
    task_id: str | None = None
    error_message: str | None = None
    can_approve: bool = False
    can_reject: bool = False
    can_retry: bool = False
    original_production: ProductionDecision | None = None


class CandidateDetail(BaseModel):
    id: str
    content_id: str | None = None
    title: str | None = None
    summary: str | None = None
    rank: int | None = None
    selected: bool
    workflow_id: str | None = None
    matching: CandidateMatching
    decision: CandidateDecision | None = None
    review: CandidateReview = Field(default_factory=CandidateReview)


class WorkflowState(BaseModel):
    id: str
    title: str | None = None
    status: str | None = None
    current_stage: str | None = None
    series: NamedReference | None = None
    pending_series: bool = False
    series_error: str | None = None
    updated_at: datetime | None = None


class RunSummary(BaseModel):
    candidate_count: int
    eligible_count: int
    filtered_count: int
    selected_count: int
    workflow_count: int
    production: dict[str, int] = Field(default_factory=dict)
    draft_quality: dict[str, int] = Field(default_factory=dict)


class PlanningRunDetailResponse(BaseModel):
    schema_version: Literal[2] = 2
    id: str
    profile: NamedReference | None = None
    crawl_job: NamedReference | None = None
    planning_mode: str
    status: str
    trigger: str | None = None
    algorithm: str | None = None
    similarity_threshold: float | None = None
    error_code: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    summary: RunSummary
    topics: list[TopicDefinition]
    candidates: list[CandidateDetail]
    # Current workflow state is separate from historical planning decisions.
    workflows: list[WorkflowState]


class CandidateSummary(BaseModel):
    """One result row, not the matching matrix or the draft diagnostic log."""
    id: str
    content_id: str | None = None
    title: str | None = None
    rank: int | None = None
    status: str
    reason: str
    reason_code: str | None = None
    similarity: float | None = None
    workflow_id: str | None = None
    review: CandidateReview | None = None


class PlanningRunCompactResponse(BaseModel):
    schema_version: Literal[3] = 3
    id: str
    profile: NamedReference | None = None
    crawl_job: NamedReference | None = None
    planning_mode: str
    status: str
    trigger: str | None = None
    algorithm: str | None = None
    similarity_threshold: float | None = None
    error_code: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    summary: RunSummary
    candidates: list[CandidateSummary]
    workflows: list[WorkflowState]


class PlanningCandidateDiagnosticsResponse(BaseModel):
    schema_version: Literal[3] = 3
    run_id: str
    candidate: CandidateDetail
    # Topic IDs belong to this response, not to the run overview's catalog.
    topics: list[TopicDefinition]
    workflow: WorkflowState | None = None
