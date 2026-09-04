from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CrawlSourceCreateRequest(BaseModel):
    job_id: uuid.UUID | None = None
    name: str | None = None
    source_type: str
    source_url: str | None = None
    keywords: list[str] = Field(default_factory=list)
    configuration: dict[str, Any] = Field(default_factory=dict)


class CrawlSourceUpdateRequest(BaseModel):
    source_url: str | None = None
    keywords: list[str] | None = None
    configuration: dict[str, Any] | None = None
    status: str | None = None


class CrawlSourceConfigCreateRequest(BaseModel):
    name: str
    source_type: str
    source_url: str | None = None
    keywords: list[str] = Field(default_factory=list)
    configuration: dict[str, Any] = Field(default_factory=dict)
    description: str | None = None


class CrawlSourceConfigUpdateRequest(BaseModel):
    name: str | None = None
    source_url: str | None = None
    keywords: list[str] | None = None
    configuration: dict[str, Any] | None = None
    description: str | None = None


class CrawlSourceConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    source_type: str
    source_url: str | None = None
    keywords: list[str] = Field(default_factory=list)
    configuration: dict[str, Any] = Field(default_factory=dict)
    status: str
    description: str | None = None
    creator_name: str | None = None
    created_at: datetime
    updated_at: datetime
