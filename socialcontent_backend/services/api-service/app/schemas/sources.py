from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field


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
