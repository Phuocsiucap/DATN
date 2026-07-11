from fastapi import APIRouter, Query
from backend.services.article_service import get_articles_list, get_article_detail
from typing import Optional
from datetime import datetime

router = APIRouter()

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

@router.get("/detail")
async def get_article(link: str = Query(...)):
    doc = get_article_detail(link)
    if not doc:
        return {"error": "not found"}
    return doc
