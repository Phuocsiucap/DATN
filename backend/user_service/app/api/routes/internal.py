from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.user_service.app.core.database import get_db
from backend.user_service.app.core.database_mongo import articles_col, publish_log_col
from backend.user_service.app.models.user import PublishingQueueItem, SocialPost, SocialProfile
from backend.user_service.app.services.content_automation import evaluate_article_for_all_profiles, process_due_queue

router = APIRouter()


class ArticleEvaluatedRequest(BaseModel):
    article: dict[str, Any]


class PublishCompletedRequest(BaseModel):
    success: bool
    result: dict[str, Any] = {}
    error: str | None = None
    content_preview: str | None = None
    caption: str | None = None


def _serialize_profile(profile: SocialProfile | None) -> dict[str, Any] | None:
    if not profile:
        return None
    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "platform": profile.platform,
        "profile_name": profile.profile_name,
        "username": profile.username,
        "folder_path": profile.folder_path,
        "status": profile.status,
    }


def _serialize_queue_item(item: PublishingQueueItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "profile_id": item.profile_id,
        "article_link": item.article_link,
        "article_title": item.article_title,
        "platform": item.platform,
        "generated_content": item.generated_content,
        "status": item.status,
        "scheduled_at": item.scheduled_at,
        "profile": _serialize_profile(item.profile),
    }


@router.get("/articles/by-link")
def get_article_by_link(link: str = Query(...)):
    article = articles_col.find_one({"link": link}, {"_id": 0})
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return article


@router.post("/articles/evaluate")
async def evaluate_article(request: ArticleEvaluatedRequest, db: Session = Depends(get_db)):
    queued_items = await evaluate_article_for_all_profiles(db, request.article)
    return {"queued": len(queued_items)}


@router.get("/social-profiles/{profile_id}")
def get_social_profile(profile_id: int, db: Session = Depends(get_db)):
    profile = db.query(SocialProfile).filter(SocialProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _serialize_profile(profile)


@router.get("/publishing/queue/{queue_item_id}")
def get_queue_item(queue_item_id: int, db: Session = Depends(get_db)):
    item = db.query(PublishingQueueItem).filter(PublishingQueueItem.id == queue_item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")
    return _serialize_queue_item(item)


@router.post("/publishing/queue/process-due")
async def process_due(db: Session = Depends(get_db)):
    processed = await process_due_queue(db)
    return {"processed": len(processed), "items": [_serialize_queue_item(item) for item in processed]}


@router.post("/publishing/queue/{queue_item_id}/publishing")
def mark_queue_item_publishing(queue_item_id: int, db: Session = Depends(get_db)):
    item = db.query(PublishingQueueItem).filter(PublishingQueueItem.id == queue_item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")
    item.status = "publishing"
    item.error = None
    db.commit()
    return _serialize_queue_item(item)


@router.post("/publishing/queue/{queue_item_id}/completed")
def complete_queue_item(queue_item_id: int, request: PublishCompletedRequest, db: Session = Depends(get_db)):
    item = db.query(PublishingQueueItem).filter(PublishingQueueItem.id == queue_item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")

    item.status = "published" if request.success else "failed"
    item.error = None if request.success else (request.error or "Publish failed")
    item.published_at = datetime.utcnow() if request.success else None
    if request.success:
        db.add(
            SocialPost(
                profile_id=item.profile_id,
                title=item.article_title[:255],
                caption=request.caption or item.generated_content,
                status="published",
                published_at=item.published_at,
            )
        )
    db.commit()
    return _serialize_queue_item(item)


@router.post("/publish-log")
def create_publish_log(payload: dict[str, Any]):
    payload["published_at"] = datetime.utcnow()
    publish_log_col.insert_one(payload)
    payload.pop("_id", None)
    return {"status": "ok"}
