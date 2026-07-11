from fastapi import APIRouter, Query
from backend.core.database import articles_col
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
    end_date: Optional[datetime] = Query(None)
):
    query = {}
    if status:
        query["status"] = status

    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"content": {"$regex": search, "$options": "i"}}
        ]
        
    if start_date or end_date:
        date_query = {}
        if start_date:
            date_query["$gte"] = start_date
        if end_date:
            date_query["$lte"] = end_date
        query["crawled_at"] = date_query

    skip = (page - 1) * limit
    # Only fetch necessary fields for the list view to optimize performance
    cursor = articles_col.find(
        query, 
        {"link": 1, "title": 1, "status": 1, "crawled_at": 1, "_id": 0}
    ).sort("crawled_at", -1).skip(skip).limit(limit)
    
    items = list(cursor)
    total = articles_col.count_documents(query)
    return {"items": items, "total": total, "page": page, "limit": limit}

@router.get("/detail")
async def get_article(link: str = Query(...)):
    doc = articles_col.find_one({"link": link}, {"_id": 0})
    if not doc:
        return {"error": "not found"}
    return doc
