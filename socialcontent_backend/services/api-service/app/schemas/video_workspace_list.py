"""The video library read model, deliberately separate from the editor payload."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class WorkspaceProfile(BaseModel):
    name: str
    platform: str
    avatar: str | None = None


class WorkspaceSeries(BaseModel):
    title: str | None = None


class WorkspaceCard(BaseModel):
    id: str
    profile_id: str
    series_id: str | None = None
    title: str | None = None
    thumbnail_url: str | None = None
    category: str | None = None
    status: str
    current_stage: str | None = None
    progress_percent: float
    task_status: str | None = None
    updated_at: datetime


class VideoWorkspaceListResponse(BaseModel):
    schema_version: Literal[2] = 2
    items: list[WorkspaceCard] = Field(default_factory=list)
    # Page-local catalogs: the UUID is the key, not repeated inside the value.
    profiles: dict[str, WorkspaceProfile] = Field(default_factory=dict)
    series: dict[str, WorkspaceSeries] = Field(default_factory=dict)
    total: int
    limit: int
    offset: int
