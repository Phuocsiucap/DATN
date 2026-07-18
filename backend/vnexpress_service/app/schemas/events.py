from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CrawlRequested(BaseModel):
    request_id: str
    type: str = "topic_crawl"
    user_id: int | None = None
    topics: list[str] = Field(default_factory=list)
    exclude_keywords: list[str] = Field(default_factory=list)
    limit: int = Field(default=10, ge=1, le=30)
    use_ai_scoring: bool = True
    source: str = "gateway"
    requested_at: str | None = None


class ArticleCrawled(BaseModel):
    request_id: str
    user_id: int | None = None
    article: dict[str, Any]


class CrawlCompleted(BaseModel):
    request_id: str
    user_id: int | None = None
    crawled: int = 0
    skipped: int = 0
    failed: int = 0
    source: str = "vnexpress_service"
