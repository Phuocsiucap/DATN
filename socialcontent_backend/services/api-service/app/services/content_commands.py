from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.schemas.api import ContentCreateRequest, ContentUpdateRequest
from app.services.content_queries import private_content_ids_for_user
from common.db.models import CrawlJob, CrawlJobContent, ContentItem, User


logger = logging.getLogger(__name__)


def create_manual_content(db: Session, payload: ContentCreateRequest, user: User) -> ContentItem:
    requested_scope = str(payload.content_scope or "PRIVATE").strip().upper()
    if requested_scope == "GLOBAL" and not user.is_system_admin:
        raise HTTPException(status_code=403, detail="Only system admins can create GLOBAL content")
    if requested_scope not in {"GLOBAL", "PRIVATE"}:
        raise HTTPException(status_code=422, detail="content_scope must be GLOBAL or PRIVATE")

    source_metadata = {
        "created_via": "manual_input",
        "created_by_user_id": str(user.id),
        "created_by_email": user.email,
    }
    if payload.category:
        source_metadata["category"] = payload.category
    if payload.tags:
        source_metadata["tags"] = payload.tags
    if payload.source_author:
        source_metadata["author"] = payload.source_author

    media_jsonb = [
        {"media_type": "IMAGE", "source_url": url, "order": index}
        for index, url in enumerate(payload.media_urls)
    ]
    media_jsonb.extend(
        {
            "media_type": media.type.upper(),
            "source_url": media.url,
            "thumbnail_url": media.thumbnail_url,
            "caption": media.caption,
            "alt": media.alt,
            "order": len(payload.media_urls) + index,
        }
        for index, media in enumerate(payload.media_items)
    )
    sources_jsonb = [{
        "source_type": payload.source_type.upper(),
        "source_url": payload.canonical_url,
        "source_author": payload.source_author,
        "source_published_at": payload.published_at.isoformat() if payload.published_at else None,
        "metadata_json": source_metadata,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }]

    hash_input = f"{payload.canonical_title}|{payload.canonical_url or ''}".lower()
    content_hash = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()
    duplicate_query = db.query(ContentItem).filter(ContentItem.content_hash == content_hash)
    if requested_scope == "PRIVATE":
        duplicate_query = duplicate_query.filter(
            ContentItem.id.in_(private_content_ids_for_user(user.id))
        )
    existing = duplicate_query.first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Content with similar title/URL already exists (ID: {existing.id})",
        )

    quality_score = 75.0
    if payload.full_text and len(payload.full_text) > 200:
        quality_score += 5.0
    if payload.media_urls or payload.media_items:
        quality_score += 10.0
    if payload.tags and len(payload.tags) >= 2:
        quality_score += 5.0
    quality_score = min(quality_score, 95.0)
    content = ContentItem(
        content_type=payload.content_type.upper(),
        canonical_title=payload.canonical_title,
        normalized_title=payload.canonical_title,
        summary=payload.summary,
        language=payload.language,
        content_scope=requested_scope,
        created_by_type="MANUAL",
        status="AVAILABLE",
        published_at=payload.published_at,
        canonical_url=payload.canonical_url,
        content_hash=content_hash,
        quality_score=quality_score,
        sources_jsonb=sources_jsonb,
        media_jsonb=media_jsonb,
    )
    db.add(content)
    db.flush()

    if requested_scope == "PRIVATE":
        manual_job = CrawlJob(
            name=f"Manual content import - {content.canonical_title[:80]}",
            crawl_mode="MANUAL_IMPORT",
            content_scope="PRIVATE",
            created_by_type="CREATOR",
            status="SUCCEEDED",
            current_stage="COMPLETED",
            total_discovered=1,
            total_crawled=1,
            total_normalized=1,
            progress_percent=100,
            requested_by=user.id,
            completed_at=datetime.now(timezone.utc),
        )
        db.add(manual_job)
        db.flush()
        db.add(CrawlJobContent(job_id=manual_job.id, content_id=content.id, is_duplicate=False))

    if payload.full_text:
        try:
            from common.db.mongo import processed_documents

            normalized_doc = {
                "content": payload.full_text,
                "title": payload.canonical_title,
                "description": payload.summary or "",
                "source": "manual_input",
                "created_by": str(user.id),
            }
            result = processed_documents().insert_one({"normalized": normalized_doc})
            content.mongo_normalized_id = str(result.inserted_id)
        except Exception:
            logger.warning("Failed to store manual content full_text in MongoDB", exc_info=True)

    db.commit()
    db.refresh(content)
    return content


def update_content_item(
    db: Session,
    content_id,
    payload: ContentUpdateRequest,
) -> ContentItem:
    content = db.get(ContentItem, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(content, field, value)
    db.commit()
    db.refresh(content)
    return content
