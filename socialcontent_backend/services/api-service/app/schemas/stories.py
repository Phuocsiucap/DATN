from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class StoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    canonical_name: str
    normalized_name: str
    language: str
    total_episodes: int
    completion_status: str
    grouping_confidence: float
    created_at: datetime


class EpisodeUpdateRequest(BaseModel):
    episode_number: int | None = None
    chapter_number: int | None = None
    season_number: int | None = None
    sequence_order: int | None = None
    episode_title: str | None = None
    is_missing: bool | None = None
