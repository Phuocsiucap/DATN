from backend.gateway.app.core.database_mongo import articles_col
from typing import Optional, Dict, Any
from datetime import datetime

def get_articles_list(
    page: int = 1,
    limit: int = 20,
    status: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    has_video: Optional[bool] = None
) -> Dict[str, Any]:
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

    if has_video is not None:
        if has_video:
            query["videos"] = {"$exists": True, "$not": {"$size": 0}}
        else:
            query["$or"] = [{"videos": {"$exists": False}}, {"videos": {"$size": 0}}]

    skip = (page - 1) * limit
    
    # Only fetch necessary fields for the list view to optimize performance
    cursor = articles_col.find(
        query, 
        {"link": 1, "title": 1, "status": 1, "crawled_at": 1, "videos": 1, "_id": 0}
    ).sort("crawled_at", -1).skip(skip).limit(limit)
    
    items = list(cursor)
    total = articles_col.count_documents(query)
    
    return {"items": items, "total": total, "page": page, "limit": limit}

def get_article_detail(link: str) -> Optional[Dict[str, Any]]:
    return articles_col.find_one({"link": link}, {"_id": 0})
