from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from common.planning.crawl_schedule import DEFAULT_TIMEZONE, validate_schedule_values


class CrawlJobSourceInput(BaseModel):
    source_type: str
    source_url: str | None = None
    keywords: list[str] = Field(default_factory=list)
    configuration: dict[str, Any] = Field(default_factory=dict)


class CrawlJobScheduleRequest(BaseModel):
    enabled: bool = True
    runs_per_day: int = Field(default=1, ge=1, le=24)
    window_start: time = time(8, 0)
    window_end: time = time(18, 0)
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)), min_length=1, max_length=7)
    timezone: str = DEFAULT_TIMEZONE

    @model_validator(mode="after")
    def validate_schedule(self):
        validate_schedule_values(
            runs_per_day=self.runs_per_day,
            window_start=self.window_start,
            window_end=self.window_end,
            weekdays=self.weekdays,
            timezone_name=self.timezone,
        )
        self.weekdays = sorted(self.weekdays)
        return self


class CrawlJobScheduleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    enabled: bool
    runs_per_day: int
    window_start: time
    window_end: time
    weekdays: list[int]
    timezone: str
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None


class CrawlJobCreateRequest(BaseModel):
    name: str
    crawl_mode: str = "ONE_TIME"
    content_scope: str = "GLOBAL"
    created_by_type: str = "SYSTEM"
    priority: int = 5
    sources: list[CrawlJobSourceInput] = Field(min_length=1)
    schedule: CrawlJobScheduleRequest | None = None


class CrawlJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    crawl_mode: str
    content_scope: str = "GLOBAL"
    created_by_type: str = "SYSTEM"
    creator_name: str | None = None
    status: str
    current_stage: str
    priority: int
    total_discovered: int
    total_crawled: int
    total_normalized: int
    total_failed: int
    total_duplicates: int
    progress_percent: float
    schedule: CrawlJobScheduleResponse | None = None
    created_at: datetime
    updated_at: datetime
