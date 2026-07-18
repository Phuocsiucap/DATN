from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.user_service.app.api.routes.auth import get_current_user
from backend.user_service.app.models.user import User
from backend.user_service.app.services.user_feed_service import (
    get_user_article_feed,
    get_user_crawl_settings,
    match_recent_articles_for_user,
    save_user_crawl_settings,
)

router = APIRouter()


class CrawlSettingsRequest(BaseModel):
    keywords: list[str] = []
    exclude_keywords: list[str] = []
    min_score: int = 70
    include_low_suggestions: bool = True
    use_ai_scoring: bool = True
    recent_limit: int = 50


class MatchRequest(BaseModel):
    force_ai: Optional[bool] = None


@router.get("/feed")
async def list_my_article_feed(
    page: int = Query(1, ge=1),
    limit: int = Query(20, le=100),
    include_low: bool = Query(False),
    current_user: User = Depends(get_current_user),
):
    return get_user_article_feed(
        user_id=current_user.id,
        page=page,
        limit=limit,
        include_low=include_low,
    )


@router.get("/crawl-settings")
async def get_my_crawl_settings(current_user: User = Depends(get_current_user)):
    return get_user_crawl_settings(current_user.id)


@router.put("/crawl-settings")
async def update_my_crawl_settings(
    request: CrawlSettingsRequest,
    current_user: User = Depends(get_current_user),
):
    return save_user_crawl_settings(current_user.id, request.dict())


@router.post("/match-for-me")
async def match_articles_for_me(
    request: Optional[MatchRequest] = None,
    current_user: User = Depends(get_current_user),
):
    return await match_recent_articles_for_user(current_user.id, request.force_ai if request else None)
