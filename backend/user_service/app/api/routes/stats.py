from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.user_service.app.api.routes.auth import get_current_user
from backend.user_service.app.core.database_mongo import articles_col, publish_log_col, user_article_feeds_col
from backend.user_service.app.core.database import get_db
from backend.user_service.app.models.user import ArticleProfileMatch, PublishingQueueItem, SocialProfile, SocialPost, User
from datetime import datetime, timedelta

router = APIRouter()

@router.get("")
async def get_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    last_24h = now - timedelta(hours=24)
    last_1h = now - timedelta(hours=1)
    is_system = any(role.name == "system" for role in current_user.roles)

    profile_query = db.query(SocialProfile)
    queue_query = db.query(PublishingQueueItem)
    post_query = db.query(SocialPost).join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
    match_query = db.query(ArticleProfileMatch)
    publish_query = {}

    if not is_system:
        profile_query = profile_query.filter(SocialProfile.user_id == current_user.id)
        queue_query = queue_query.filter(PublishingQueueItem.user_id == current_user.id)
        post_query = post_query.filter(SocialProfile.user_id == current_user.id)
        match_query = match_query.filter(ArticleProfileMatch.user_id == current_user.id)
        profile_ids = [profile.id for profile in profile_query.all()]
        publish_query = {"profile_id": {"$in": profile_ids}} if profile_ids else {"profile_id": "__none__"}

    total = articles_col.count_documents({}) if is_system else user_article_feeds_col.count_documents({"user_id": current_user.id})
    last_24h_count = articles_col.count_documents({"crawled_at": {"$gte": last_24h}}) if is_system else user_article_feeds_col.count_documents({"user_id": current_user.id, "matched_at": {"$gte": last_24h}})
    last_1h_count = articles_col.count_documents({"crawled_at": {"$gte": last_1h}}) if is_system else user_article_feeds_col.count_documents({"user_id": current_user.id, "matched_at": {"$gte": last_1h}})

    published_total = publish_log_col.count_documents({**publish_query, "success": True})
    published_failed = publish_log_col.count_documents({**publish_query, "success": False})

    by_platform = {}
    for platform in ["facebook", "tiktok"]:
        by_platform[platform] = publish_log_col.count_documents({**publish_query, "platform": platform, "success": True})

    queue_status = {
        "needs_approval": queue_query.filter(PublishingQueueItem.status == "needs_approval").count(),
        "upcoming": queue_query.filter(PublishingQueueItem.status.in_(["queued", "approved"])).count(),
        "published": queue_query.filter(PublishingQueueItem.status == "published").count(),
        "failed": queue_query.filter(PublishingQueueItem.status == "failed").count(),
        "skipped": queue_query.filter(PublishingQueueItem.status == "skipped").count(),
    }

    payload = {
        "scope": "system" if is_system else "user",
        "total_articles": total,
        "crawled_last_24h": last_24h_count,
        "crawled_last_1h": last_1h_count,
        "published_total": published_total,
        "published_failed": published_failed,
        "by_platform": by_platform,
        "profiles_total": profile_query.count(),
        "profiles_active": profile_query.filter(SocialProfile.status == "active").count(),
        "queue_status": queue_status,
        "ai_matches_total": match_query.count(),
        "social_posts_total": post_query.count(),
    }

    if is_system:
        payload["users_total"] = db.query(User).count()
        payload["users_active"] = db.query(User).filter(User.is_active == True).count()
    else:
        payload["feed_matched"] = user_article_feeds_col.count_documents({"user_id": current_user.id, "match_status": "matched"})
        payload["feed_low_suggestions"] = user_article_feeds_col.count_documents({"user_id": current_user.id, "match_status": "low_suggestion"})

    return payload
