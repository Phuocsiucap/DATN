from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.gateway.app.api.routes.auth import get_current_user
from backend.gateway.app.services.bilibili_content_crawler import crawl_bilibili_feed, list_bilibili_feed


router = APIRouter()


class BilibiliFeedCrawlRequest(BaseModel):
    keywords: list[str] = []
    limit: int = 10
    max_duration_seconds: int = 7200
    evaluate: bool = True


@router.get("")
async def list_items(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    current_user=Depends(get_current_user),
):
    _ = current_user
    return list_bilibili_feed(page=page, limit=limit, search=search)


@router.post("/crawl-now")
async def crawl_now(
    request: BilibiliFeedCrawlRequest | None = None,
    current_user=Depends(get_current_user),
):
    payload = request or BilibiliFeedCrawlRequest()
    return await crawl_bilibili_feed(
        user_id=current_user.id,
        keywords=payload.keywords or None,
        limit=payload.limit,
        max_duration_seconds=payload.max_duration_seconds,
        evaluate=payload.evaluate,
    )
