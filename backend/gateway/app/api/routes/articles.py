import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from backend.gateway.app.services.article_service import get_articles_list, get_article_detail
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
from backend.gateway.app.api.routes.auth import get_current_user
from backend.gateway.app.api.proxy import proxy_request
from backend.gateway.app.services.vnexpress_gateway import request_vnexpress_topic_crawl

router = APIRouter()
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")


class CrawlSettingsRequest(BaseModel):
    keywords: list[str] = []
    exclude_keywords: list[str] = []
    min_score: int = 70
    include_low_suggestions: bool = True
    use_ai_scoring: bool = True
    recent_limit: int = 50


class MatchRequest(BaseModel):
    force_ai: Optional[bool] = None


class CustomTopicCrawlRequest(BaseModel):
    topics: list[str]
    exclude_keywords: list[str] = []
    limit: int = 10
    use_ai_scoring: bool = True


@router.get("")
async def list_articles(
    page: int = Query(1, ge=1),
    limit: int = Query(20, le=100),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    has_video: Optional[bool] = Query(None)
):
    return get_articles_list(
        page=page, 
        limit=limit, 
        status=status, 
        search=search, 
        start_date=start_date, 
        end_date=end_date,
        has_video=has_video
    )


@router.get("/feed")
async def list_my_article_feed(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, le=100),
    include_low: bool = Query(False),
    current_user = Depends(get_current_user),
):
    _ = current_user
    return await proxy_request(request, f"{USER_SERVICE_URL}/api/articles/feed", "User service")


@router.get("/crawl-settings")
async def get_my_crawl_settings(request: Request, current_user = Depends(get_current_user)):
    _ = current_user
    return await proxy_request(request, f"{USER_SERVICE_URL}/api/articles/crawl-settings", "User service")


@router.put("/crawl-settings")
async def update_my_crawl_settings(
    http_request: Request,
    request: CrawlSettingsRequest,
    current_user = Depends(get_current_user),
):
    _ = current_user
    return await proxy_request(http_request, f"{USER_SERVICE_URL}/api/articles/crawl-settings", "User service")


@router.post("/match-for-me")
async def match_articles_for_me(
    http_request: Request,
    request: Optional[MatchRequest] = None,
    current_user = Depends(get_current_user),
):
    _ = current_user
    return await proxy_request(http_request, f"{USER_SERVICE_URL}/api/articles/match-for-me", "User service")


@router.post("/custom-crawl")
async def custom_topic_crawl(
    request: CustomTopicCrawlRequest,
    current_user = Depends(get_current_user),
):
    return request_vnexpress_topic_crawl(
        user_id=current_user.id,
        topics=request.topics,
        exclude_keywords=request.exclude_keywords,
        limit=request.limit,
        use_ai_scoring=request.use_ai_scoring,
    )


@router.get("/detail")
async def get_article(link: str = Query(...)):
    doc = get_article_detail(link)
    if not doc:
        return {"error": "not found"}
    return doc
