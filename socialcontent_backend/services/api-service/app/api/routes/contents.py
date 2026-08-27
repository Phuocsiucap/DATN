import html
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import JSONB

from common.db.models import ContentItem, Story, User, KafkaTask
from common.db.session import get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import CONTENT_DEDUPLICATION_REQUESTED, CONTENT_NORMALIZATION_REQUESTED
from common.db.media_workflows import _load_content_full_text
from app.api.deps import get_current_user, require_admin
from app.schemas import api as schemas

router = APIRouter()


@router.get("", response_model=list[schemas.ContentResponse])
def list_contents(
    source_type: str | None = None,
    content_type: str | None = None,
    status: str | None = None,
    language: str | None = None,
    content_scope: str | None = None,
    crawl_job_id: uuid.UUID | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ContentItem)

    # Privacy filtering
    if not user.is_system_admin:
        if content_scope == "PRIVATE":
            query = query.filter(ContentItem.content_scope == "PRIVATE", ContentItem.owner_user_id == user.id)
        elif content_scope == "GLOBAL":
            query = query.filter(ContentItem.content_scope == "GLOBAL")
        else:
            query = query.filter(
                (ContentItem.content_scope == "GLOBAL")
                | ((ContentItem.content_scope == "PRIVATE") & (ContentItem.owner_user_id == user.id))
            )
    elif content_scope:
        query = query.filter(ContentItem.content_scope == content_scope.upper())

    if content_type:
        query = query.filter(ContentItem.content_type == content_type.upper())
    if status:
        query = query.filter(ContentItem.status == status.upper())
    if language:
        query = query.filter(ContentItem.language == language)
    if crawl_job_id:
        query = query.filter(ContentItem.crawl_job_id == crawl_job_id)

    contents = query.order_by(ContentItem.created_at.desc()).limit(100).all()
    return [_content_response(item) for item in contents]


@router.get("/final-view", response_model=schemas.FinalContentViewResponse)
def final_content_view(
    crawl_job_id: uuid.UUID | None = None,
    content_scope: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ContentItem)

    # Privacy filtering
    if not user.is_system_admin:
        if content_scope == "PRIVATE":
            query = query.filter(ContentItem.content_scope == "PRIVATE", ContentItem.owner_user_id == user.id)
        elif content_scope == "GLOBAL":
            query = query.filter(ContentItem.content_scope == "GLOBAL")
        else:
            query = query.filter(
                (ContentItem.content_scope == "GLOBAL")
                | ((ContentItem.content_scope == "PRIVATE") & (ContentItem.owner_user_id == user.id))
            )
    elif content_scope:
        query = query.filter(ContentItem.content_scope == content_scope.upper())
    if crawl_job_id:
        query = query.filter(ContentItem.crawl_job_id == crawl_job_id)

    contents = query.order_by(ContentItem.created_at.desc()).limit(200).all()
    
    story_ids = {content.story_id for content in contents if content.story_id}
    stories = db.query(Story).filter(Story.id.in_(story_ids)).all() if story_ids else []
    story_by_id = {story.id: story for story in stories}

    normal_items = []
    series_items = []
    for content in contents:
        story = story_by_id.get(content.story_id) if content.story_id else None
        sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
        primary_source = sources[0] if sources else {}
        source_metadata = _source_metadata(primary_source)
        list_metadata = _list_source_metadata(source_metadata)
        source_type = primary_source.get("source_type")
        story_for_view = None if _is_vnexpress_article(source_type, content) else story
        article_id = source_metadata.get("article_id")
        category_id = source_metadata.get("category_id")
        site_id = source_metadata.get("site_id")
        
        row = {
            "id": content.id,
            "content_type": content.content_type,
            "canonical_title": content.canonical_title,
            "normalized_title": content.normalized_title,
            "summary": content.summary,
            "language": content.language,
            "status": content.status,
            "canonical_url": content.canonical_url,
            "quality_score": content.quality_score,
            "created_at": content.created_at,
            "published_at": content.published_at,
            "source_type": source_type,
            "source_url": primary_source.get("source_url") or content.canonical_url,
            "source_metadata": list_metadata,
            "article_id": article_id,
            "articleId": article_id,
            "category_id": category_id,
            "categoryId": category_id,
            "category": source_metadata.get("category"),
            "site_id": site_id,
            "siteId": site_id,
            "media_jsonb": _media_preview_items(content.media_jsonb),
            "story_id": story_for_view.id if story_for_view else None,
            "episode_order": content.episode_order if story_for_view else None,
            "series": _series_info(story_for_view) if story_for_view else None,
        }
        if story_for_view:
            series_items.append(row)
        else:
            normal_items.append(row)

    return {"normal_items": normal_items, "series_items": series_items}


@router.get("/{content_id}", response_model=schemas.ContentResponse)
def get_content(content_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _content_response(_get_visible_content(db, content_id, user))


@router.get("/{content_id}/detail", response_model=schemas.ContentDetailResponse)
def get_content_detail(content_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    content = _get_visible_content(db, content_id, user)
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources else {}
    source_metadata = _source_metadata(primary_source)
    list_metadata = _list_source_metadata(source_metadata)
    source_type = primary_source.get("source_type")
    story_for_detail = None if _is_vnexpress_article(source_type, content) else content.story_id
    
    full_text = _load_content_full_text(content.mongo_normalized_id, content.mongo_raw_id) or content.summary
    normalized_article = _normalized_article(content, source_metadata, full_text, content.media_jsonb)
    if not normalized_article.get("publishedAt"):
        normalized_article["publishedAt"] = primary_source.get("source_published_at")
    
    return {
        "id": content.id,
        "content_type": content.content_type,
        "canonical_title": html.unescape(content.canonical_title) if content.canonical_title else content.canonical_title,
        "normalized_title": html.unescape(content.normalized_title) if content.normalized_title else content.normalized_title,
        "summary": html.unescape(content.summary) if content.summary else content.summary,
        "full_text": html.unescape(full_text) if full_text else full_text,
        "language": content.language,
        "status": content.status,
        "published_at": content.published_at,
        "duration_seconds": content.duration_seconds,
        "canonical_url": content.canonical_url,
        "quality_score": content.quality_score,
        "created_at": content.created_at,
        "updated_at": content.updated_at,
        "source_type": source_type,
        "source_url": primary_source.get("source_url") or content.canonical_url,
        "source_author": primary_source.get("source_author"),
        "source_published_at": primary_source.get("source_published_at"),
        "source_metadata": list_metadata,
        "article_id": source_metadata.get("article_id"),
        "category_id": source_metadata.get("category_id"),
        "category": source_metadata.get("category"),
        "site_id": source_metadata.get("site_id"),
        "story_id": story_for_detail,
        "episode_order": content.episode_order if story_for_detail else None,
        **_normalized_aliases(normalized_article),
    }


def _get_visible_content(db: Session, content_id: uuid.UUID, user: User) -> ContentItem:
    content = db.get(ContentItem, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    if user.is_system_admin:
        return content
    if content.content_scope == "GLOBAL":
        return content
    if content.content_scope == "PRIVATE" and content.owner_user_id == user.id:
        return content
    raise HTTPException(status_code=404, detail="Content not found")


def _content_response(content: ContentItem) -> dict:
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources else {}
    source_metadata = _source_metadata(primary_source)
    list_metadata = _list_source_metadata(source_metadata)
    article_id = source_metadata.get("article_id")
    category_id = source_metadata.get("category_id")
    site_id = source_metadata.get("site_id")
    return {
        "id": content.id,
        "content_type": content.content_type,
        "canonical_title": content.canonical_title,
        "normalized_title": content.normalized_title,
        "summary": content.summary,
        "language": content.language,
        "status": content.status,
        "canonical_url": content.canonical_url,
        "quality_score": content.quality_score,
        "created_at": content.created_at,
        "source_metadata": list_metadata,
        "article_id": article_id,
        "articleId": article_id,
        "category_id": category_id,
        "categoryId": category_id,
        "category": source_metadata.get("category"),
        "site_id": site_id,
        "siteId": site_id,
    }


def _source_metadata(primary_source: dict) -> dict:
    metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def _list_source_metadata(metadata: dict) -> dict:
    keys = ("article_id", "category_id", "site_id", "category", "tags", "image_count", "video_count", "thumbnail_url", "embed_url")
    return {key: metadata.get(key) for key in keys if metadata.get(key) not in (None, "", [])}


def _series_info(story: Story) -> dict:
    return {
        "id": story.id,
        "canonical_name": story.canonical_name,
        "completion_status": story.completion_status,
        "total_episodes": story.total_episodes,
        "grouping_confidence": story.grouping_confidence,
    }


def _normalized_aliases(article: dict) -> dict:
    return {
        "articleId": article["articleId"],
        "categoryId": article["categoryId"],
        "siteId": article["siteId"],
        "title": article["title"],
        "lead": article["lead"],
        "publishedAt": article["publishedAt"],
        "content": article["content"],
        "images": article["images"],
        "videos": article["videos"],
        "url": article["url"],
        "normalized": article,
    }


def _is_vnexpress_article(source_type: str | None, content: ContentItem) -> bool:
    return (source_type or "").upper() == "VNEXPRESS" and (content.content_type or "").upper() == "ARTICLE"


def _media_preview_items(media_items: list | None) -> list:
    media = media_items if isinstance(media_items, list) else []
    return media[:1]


def _normalized_article(content: ContentItem, source_metadata: dict, body: str | None, media_items: list | None) -> dict:
    media = media_items if isinstance(media_items, list) else []
    published_at = content.published_at or source_metadata.get("published_at")
    return {
        "articleId": source_metadata.get("article_id"),
        "categoryId": source_metadata.get("category_id"),
        "siteId": source_metadata.get("site_id"),
        "title": html.unescape(content.canonical_title or content.normalized_title or ""),
        "lead": html.unescape(content.summary or ""),
        "publishedAt": published_at,
        "content": html.unescape(body or ""),
        "images": [_normalized_image(item) for item in media if _media_kind(item) == "IMAGE"],
        "videos": [_normalized_video(item) for item in media if _media_kind(item).startswith("VIDEO")],
        "url": content.canonical_url,
    }


def _normalized_image(item: dict) -> dict:
    return {
        "src": item.get("source_url") or item.get("storage_url") or item.get("thumbnail_url"),
        "alt": html.unescape(str(item.get("alt") or "")),
        "caption": html.unescape(str(item.get("caption") or "")),
    }


def _normalized_video(item: dict) -> dict:
    source_url = item.get("source_url") or item.get("storage_url") or item.get("embed_url")
    mime_type = item.get("mime_type") or ("application/x-mpegURL" if str(source_url or "").lower().endswith(".m3u8") else None)
    kind = item.get("format") or ("hls" if mime_type == "application/x-mpegURL" else "video")
    return {
        "url": source_url,
        "kind": kind,
        "mimeType": mime_type,
        "embedUrl": item.get("embed_url") or "",
        "provider": item.get("provider") or "",
        "title": html.unescape(str(item.get("title") or "")),
        "description": html.unescape(str(item.get("description") or "")),
        "thumbnail": item.get("thumbnail_url") or "",
        "uploadDate": item.get("upload_date") or "",
        "duration": item.get("duration") or "",
        "qualities": item.get("qualities") if isinstance(item.get("qualities"), list) else [],
        "maxQuality": item.get("max_quality") or "",
        "extractionSource": item.get("extraction_source") or "",
    }


def _media_kind(item: dict) -> str:
    if not isinstance(item, dict):
        return ""
    return str(item.get("media_type") or item.get("type") or "").upper()


@router.patch("/{content_id}", response_model=schemas.ContentResponse)
def update_content(content_id: uuid.UUID, payload: schemas.ContentUpdateRequest, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    content = db.get(ContentItem, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(content, field, value)
    db.commit()
    db.refresh(content)
    return _content_response(content)


@router.post("/{content_id}/reprocess")
def reprocess_content(content_id: uuid.UUID, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    content = db.get(ContentItem, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    
    task = KafkaTask(
        reference_id=str(content.id),
        task_type="AI_NORMALIZATION",
        status="PENDING",
        payload_jsonb={"content_id": str(content.id)}
    )
    db.add(task)
    db.commit()
    
    publish(
        CONTENT_NORMALIZATION_REQUESTED,
        build_event(
            event_type=CONTENT_NORMALIZATION_REQUESTED,
            source="api-service",
            payload={"content_id": str(content.id), "task_id": str(task.id)},
        ),
    )
    return {"requested": True, "processing_run_id": task.id}


@router.post("/{content_id}/mark-duplicate")
def mark_duplicate(content_id: uuid.UUID, duplicate_content_id: uuid.UUID, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    primary = db.get(ContentItem, content_id)
    duplicate = db.get(ContentItem, duplicate_content_id)
    if not primary or not duplicate:
        raise HTTPException(status_code=404, detail="Content not found")
        
    duplicate.duplicate_count += 1
    db.add(duplicate)
    db.commit()
    
    publish(
        CONTENT_DEDUPLICATION_REQUESTED,
        build_event(
            event_type=CONTENT_DEDUPLICATION_REQUESTED,
            source="api-service",
            payload={"primary_content_id": str(primary.id), "duplicate_content_id": str(duplicate.id)},
        ),
    )
    return {"marked": True, "duplicate_id": duplicate.id}
