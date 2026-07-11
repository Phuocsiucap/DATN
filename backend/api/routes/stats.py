from fastapi import APIRouter
from backend.core.database import articles_col, publish_log_col
from datetime import datetime, timedelta

router = APIRouter()

@router.get("")
async def get_stats():
    now = datetime.utcnow()
    last_24h = now - timedelta(hours=24)
    last_1h = now - timedelta(hours=1)

    total = articles_col.count_documents({})
    last_24h_count = articles_col.count_documents({"crawled_at": {"$gte": last_24h}})
    last_1h_count = articles_col.count_documents({"crawled_at": {"$gte": last_1h}})

    published_total = publish_log_col.count_documents({"success": True})
    published_failed = publish_log_col.count_documents({"success": False})

    by_platform = {}
    for platform in ["facebook", "tiktok"]:
        by_platform[platform] = publish_log_col.count_documents({"platform": platform, "success": True})

    return {
        "total_articles": total,
        "crawled_last_24h": last_24h_count,
        "crawled_last_1h": last_1h_count,
        "published_total": published_total,
        "published_failed": published_failed,
        "by_platform": by_platform,
    }
