from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CrawlJobSourceInput(BaseModel):
    source_type: str
    source_url: str | None = None
    keywords: list[str] = Field(default_factory=list)
    configuration: dict[str, Any] = Field(default_factory=dict)


class CrawlJobCreateRequest(BaseModel):
    name: str
    crawl_mode: str = "ONE_TIME"
    content_scope: str = "GLOBAL"
    created_by_type: str = "SYSTEM"
    priority: int = 5
    sources: list[CrawlJobSourceInput]


class CrawlJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    crawl_mode: str
    content_scope: str = "GLOBAL"
    created_by_type: str = "SYSTEM"
    status: str
    current_stage: str
    priority: int
    total_discovered: int
    total_crawled: int
    total_normalized: int
    total_failed: int
    total_duplicates: int
    progress_percent: float
    requested_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class CrawlLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    task_id: uuid.UUID | None
    source_type: str | None
    stage: str
    level: str
    message: str
    metadata_json: dict[str, Any]
    created_at: datetime
