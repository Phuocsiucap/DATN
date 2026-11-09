import html
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from common.db.media_workflows import _load_content_full_text
from common.db.models import (
    ContentItem,
    KafkaTask,
    MediaWorkflow,
    SocialProfile,
    Story,
    User,
)
from common.db.session import get_db
from app.api.deps import get_current_user, require_admin
from app.schemas import api as schemas
from app.services.bilibili_ocr import (
    _bilibili_episodes_for_queue,
    _list_source_metadata,
    _queue_bilibili_ocr_for_content,
    _safe_int,
    _source_metadata,
)
from app.services.content_queries import get_visible_content, list_visible_contents
from app.services.content_recommendations import (
    content_selection_summary,
    profile_matches_for_content,
)
from app.services.content_commands import create_manual_content, update_content_item

router = APIRouter()


class BilibiliOcrQueueRequest(BaseModel):
    episode_indices: list[int] | None = None


class BilibiliTranslationWorkflowRequest(BaseModel):
    profile_id: uuid.UUID
    episode_indices: list[int] | None = None
    title: str | None = None


@router.get("", response_model=list[schemas.ContentResponse])
def list_contents(
    source_type: str | None = None,
    content_type: str | None = None,
    status: str | None = None,
    language: str | None = None,
    content_scope: str | None = None,
    crawl_job_id: uuid.UUID | None = None,
    created_after: str | None = None,
    created_before: str | None = None,
    published_after: str | None = None,
    published_before: str | None = None,
    sort_by: str | None = None,
    sort_order: str | None = None,
    limit: int = 100,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        date_filters = {
            name: datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
            for name, value in {
                "created_after": created_after,
                "created_before": created_before,
                "published_after": published_after,
                "published_before": published_before,
            }.items()
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Date filters must be ISO-8601 datetimes") from exc
    try:
        contents = list_visible_contents(
            db,
            user=user,
            content_scope=content_scope,
            source_type=source_type,
            content_type=content_type,
            status=status,
            language=language,
            crawl_job_id=crawl_job_id,
            sort_by=sort_by,
            sort_order=sort_order,
            limit=limit,
            **date_filters,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return [_content_response(item) for item in contents]


@router.get("/final-view")
def final_content_view(
    crawl_job_id: uuid.UUID | None = None,
    content_scope: str | None = None,
    view: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contents = list_visible_contents(db, user=user, content_scope=content_scope, crawl_job_id=crawl_job_id, limit=200)
    
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
        story_for_view = story
        article_id = source_metadata.get("article_id")
        category_id = source_metadata.get("category_id")
        site_id = source_metadata.get("site_id")
        
        row = _final_content_list_item(
            content=content,
            primary_source=primary_source,
            source_metadata=source_metadata,
            story_for_view=story_for_view,
        ) if view == "list" else {
            "id": content.id,
            "content_type": content.content_type,
            "canonical_title": content.canonical_title,
            "normalized_title": content.normalized_title,
            "summary": content.summary,
            "language": content.language,
            "content_scope": content.content_scope,
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


@router.post("/{content_id}/bilibili/ocr-queue", status_code=202)
def queue_bilibili_ocr(
    content_id: uuid.UUID,
    payload: BilibiliOcrQueueRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = get_visible_content(db, content_id, user)
    result = _queue_bilibili_ocr_for_content(db, content, user, payload.episode_indices if payload else None)
    db.commit()
    return result


@router.post("/{content_id}/bilibili/translation-workflow", status_code=201)
def create_bilibili_translation_workflow(
    content_id: uuid.UUID,
    payload: BilibiliTranslationWorkflowRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = get_visible_content(db, content_id, user)
    profile = db.query(SocialProfile).filter(SocialProfile.id == payload.profile_id).with_for_update().first()
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources and isinstance(sources[0], dict) else {}
    if str(primary_source.get("source_type") or "").upper() != "BILIBILI":
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ tạo workflow dịch cho Bilibili")

    requested_indices = sorted({int(value) for value in (payload.episode_indices or []) if int(value) > 0})
    source_metadata = _source_metadata(primary_source)
    title_suffix = f" tập {', '.join(str(value) for value in requested_indices)}" if requested_indices else ""
    workflow = MediaWorkflow(
        profile_id=profile.id,
        title=(payload.title or f"Dịch Bilibili: {content.canonical_title or content.normalized_title or 'video'}{title_suffix}").strip(),
        status="PROCESSING",
        planning_mode=None,
        primary_content_id=content.id,
        current_stage="QUEUED_OCR",
        progress_percent=5,
        metadata_json={
            "workflow_type": "ORIGINAL_VIDEO_HARDSUB",
            "selection_mode": "MANUAL",
            "creation_source": "BILIBILI_TRANSLATION",
            "source_type": "BILIBILI",
            "bilibili_episode_indices": ",".join(str(value) for value in requested_indices) if requested_indices else None,
            "target_episode_indices": requested_indices or None,
            "series_title": source_metadata.get("series_title") or source_metadata.get("season_title"),
            "season_id": source_metadata.get("season_id"),
            "primary_source": {"type": "content", "id": str(content.id)},
        },
        inputs_jsonb=[{
            "type": "content",
            "id": str(content.id),
            "role": "primary",
            "title": content.canonical_title or content.normalized_title,
            "source_type": "BILIBILI",
            "episode_indices": requested_indices or None,
        }],
    )
    db.add(workflow)
    db.flush()
    result = _queue_bilibili_ocr_for_content(db, content, user, requested_indices or None, workflow=workflow)
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return {"workflow": _serialize_bilibili_translation_workflow(workflow), "ocr_queue": result, "reused": False}


@router.get("/{content_id}/bilibili/ocr-progress")
def bilibili_ocr_progress(content_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    content = get_visible_content(db, content_id, user)
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources and isinstance(sources[0], dict) else {}
    if str(primary_source.get("source_type") or "").upper() != "BILIBILI":
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ xem tiến trình OCR cho Bilibili")

    source_metadata = _source_metadata(primary_source)
    expected_episodes = _bilibili_episodes_for_queue(content, source_metadata, primary_source)
    tasks = (
        db.query(KafkaTask)
        .filter(
            KafkaTask.task_type == "BILIBILI_OCR_EPISODE",
            or_(
                and_(KafkaTask.reference_type == "content_item", KafkaTask.reference_id == content.id),
                KafkaTask.payload_jsonb["content_id"].astext == str(content.id),
            ),
        )
        .order_by(KafkaTask.created_at.asc(), KafkaTask.id.asc())
        .all()
    )
    task_rows = [_serialize_bilibili_ocr_task(task) for task in tasks]
    overall = _bilibili_ocr_overall(task_rows, expected_count=len(expected_episodes) or len(task_rows))
    return {
        "content_id": str(content.id),
        "title": content.canonical_title,
        "source_type": "BILIBILI",
        "expected_episode_count": len(expected_episodes) or len(task_rows),
        "overall": overall,
        "episodes": task_rows,
        "updated_at": max((task.get("updated_at") for task in task_rows if task.get("updated_at")), default=None),
    }


@router.get("/{content_id}", response_model=schemas.ContentResponse)
def get_content(content_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _content_response(get_visible_content(db, content_id, user))


@router.get("/{content_id}/detail", response_model=schemas.ContentDetailResponse)
def get_content_detail(content_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    content = get_visible_content(db, content_id, user)
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources else {}
    source_metadata = _source_metadata(primary_source)
    list_metadata = _list_source_metadata(source_metadata)
    source_type = primary_source.get("source_type")
    if str(source_type or "").upper() == "BILIBILI":
        bilibili_episodes = _bilibili_episodes_for_queue(content, source_metadata, primary_source)
        if bilibili_episodes:
            list_metadata = {
                **list_metadata,
                "episodes": bilibili_episodes,
                "episode_count": len(bilibili_episodes),
            }
    story_for_detail = content.story_id
    
    full_text = _load_content_full_text(content.mongo_normalized_id) or content.summary
    normalized_article = _normalized_article(content, source_metadata, full_text, content.media_jsonb)
    if not normalized_article.get("publishedAt"):
        normalized_article["publishedAt"] = primary_source.get("source_published_at")
    profile_matches = profile_matches_for_content(db, content, source_metadata, user)
    
    return {
        "id": content.id,
        "content_type": content.content_type,
        "canonical_title": html.unescape(content.canonical_title) if content.canonical_title else content.canonical_title,
        "normalized_title": html.unescape(content.normalized_title) if content.normalized_title else content.normalized_title,
        "summary": html.unescape(content.summary) if content.summary else content.summary,
        "full_text": html.unescape(full_text) if full_text else full_text,
        "language": content.language,
        "content_scope": content.content_scope,
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
        "thumbnail_url": source_metadata.get("thumbnail_url") or _first_media_url(content.media_jsonb),
        "media_counts": {
            "images": int(source_metadata.get("image_count") or _media_count(content.media_jsonb, "IMAGE")),
            "videos": int(source_metadata.get("video_count") or _media_count(content.media_jsonb, "VIDEO")),
        },
        "tags": source_metadata.get("tags") if isinstance(source_metadata.get("tags"), list) else [],
        "media_jsonb": content.media_jsonb if isinstance(content.media_jsonb, list) else [],
        "sources_jsonb": content.sources_jsonb if isinstance(content.sources_jsonb, list) else [],
        "story_id": story_for_detail,
        "episode_order": content.episode_order if story_for_detail else None,
        "profile_matches": profile_matches,
        "ai_selection_summary": profile_matches[0].get("selection_reason") if profile_matches else content_selection_summary(content, source_metadata),
        **_normalized_aliases(normalized_article),
    }


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
        "content_scope": content.content_scope,
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


def _final_content_list_item(content: ContentItem, primary_source: dict, source_metadata: dict, story_for_view: Story | None) -> dict:
    article_id = source_metadata.get("article_id")
    category_id = source_metadata.get("category_id")
    site_id = source_metadata.get("site_id")
    thumbnail_url = source_metadata.get("thumbnail_url") or _first_media_url(content.media_jsonb)
    return {
        "id": content.id,
        "content_type": content.content_type,
        "canonical_title": html.unescape(content.canonical_title) if content.canonical_title else content.canonical_title,
        "summary": html.unescape(content.summary) if content.summary else content.summary,
        "language": content.language,
        "content_scope": content.content_scope,
        "status": content.status,
        "quality_score": float(content.quality_score or 0),
        "created_at": content.created_at,
        "published_at": content.published_at,
        "source_type": primary_source.get("source_type"),
        "source_url": primary_source.get("source_url") or content.canonical_url,
        "article_id": article_id,
        "category_id": category_id,
        "category": source_metadata.get("category"),
        "site_id": site_id,
        "thumbnail_url": thumbnail_url,
        "media_counts": {
            "images": int(source_metadata.get("image_count") or _media_count(content.media_jsonb, "IMAGE")),
            "videos": int(source_metadata.get("video_count") or _media_count(content.media_jsonb, "VIDEO")),
        },
        "tags": source_metadata.get("tags") if isinstance(source_metadata.get("tags"), list) else [],
        "story_id": story_for_view.id if story_for_view else None,
        "episode_order": content.episode_order if story_for_view else None,
        "series": _series_info(story_for_view) if story_for_view else None,
    }



def _serialize_bilibili_translation_workflow(workflow: MediaWorkflow) -> dict:
    return {
        "id": str(workflow.id),
        "title": workflow.title,
        "status": workflow.status,
        "profile_id": str(workflow.profile_id),
        "primary_content_id": str(workflow.primary_content_id) if workflow.primary_content_id else None,
        "current_stage": workflow.current_stage,
        "progress_percent": float(workflow.progress_percent or 0),
    }


def _serialize_bilibili_ocr_task(task: KafkaTask) -> dict:
    payload = task.payload_jsonb if isinstance(task.payload_jsonb, dict) else {}
    result = task.result_jsonb if isinstance(task.result_jsonb, dict) else {}
    segments = _bilibili_ocr_segments(result)
    return {
        "id": str(task.id),
        "content_id": str(task.reference_id) if task.reference_id else None,
        "workflow_id": payload.get("workflow_id") or (str(task.reference_id) if str(task.reference_type or "").lower() == "media_workflow" and task.reference_id else None),
        "reference_type": task.reference_type,
        "episode_index": _safe_int(payload.get("episode_index")),
        "title": payload.get("title"),
        "url": payload.get("url"),
        "bvid": payload.get("bvid"),
        "aid": payload.get("aid"),
        "cid": payload.get("cid"),
        "thumbnail_url": payload.get("thumbnail_url"),
        "status": task.status,
        "current_stage": task.current_stage,
        "progress_percent": float(task.progress_percent or 0),
        "error_message": task.error_message,
        "raw_text": result.get("raw_text") or result.get("ocr_text") or result.get("transcript"),
        "translated_text": result.get("translated_text") or result.get("translation"),
        "source_kind": result.get("source_kind"),
        "segments": segments,
        "created_at": task.created_at,
        "updated_at": task.completed_at or task.heartbeat_at or task.started_at or task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
    }


def _bilibili_ocr_segments(result: dict) -> list[dict]:
    raw_segments = (
        result.get("translated_segments")
        or result.get("segments")
        or result.get("transcript_segments")
        or result.get("ocr_segments")
        or []
    )
    if not isinstance(raw_segments, list):
        return []
    rows = []
    for index, item in enumerate(raw_segments, start=1):
        if not isinstance(item, dict):
            continue
        rows.append({
            "index": _safe_int(item.get("index")) or index,
            "start": _safe_float(item.get("start") or item.get("start_time")),
            "end": _safe_float(item.get("end") or item.get("end_time")),
            "raw_text": item.get("raw_text") or item.get("text") or item.get("ocr_text"),
            "translated_text": item.get("translated_text") or item.get("translation") or item.get("vi_text"),
            "confidence": _safe_float(item.get("confidence")),
        })
    return rows


def _bilibili_ocr_overall(tasks: list[dict], expected_count: int) -> dict:
    total = max(expected_count, len(tasks), 0)
    completed = sum(1 for task in tasks if task.get("status") == "COMPLETED")
    failed = sum(1 for task in tasks if task.get("status") == "FAILED")
    active = sum(1 for task in tasks if task.get("status") in {"PENDING", "RUNNING", "PROCESSING"})
    if not tasks:
        status = "NOT_QUEUED"
        progress = 0
    elif failed and completed + failed >= total:
        status = "FAILED"
        progress = 100
    elif total and completed >= total:
        status = "COMPLETED"
        progress = 100
    elif active:
        status = "PROCESSING"
        progress = sum(float(task.get("progress_percent") or 0) for task in tasks) / max(total, 1)
    else:
        status = "QUEUED"
        progress = sum(float(task.get("progress_percent") or 0) for task in tasks) / max(total, 1)
    return {
        "status": status,
        "total": total,
        "queued": len(tasks),
        "active": active,
        "completed": completed,
        "failed": failed,
        "progress_percent": round(float(progress), 2),
    }


def _safe_float(value) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


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


def _media_preview_items(media_items: list | None) -> list:
    media = media_items if isinstance(media_items, list) else []
    return media[:1]


def _first_media_url(media_items: list | None) -> str | None:
    media = media_items if isinstance(media_items, list) else []
    for item in media:
        if not isinstance(item, dict):
            continue
        value = item.get("thumbnail_url") or item.get("source_url") or item.get("storage_url")
        if value:
            return value
    return None


def _media_count(media_items: list | None, media_type: str) -> int:
    media = media_items if isinstance(media_items, list) else []
    return sum(1 for item in media if isinstance(item, dict) and _media_kind(item).startswith(media_type))


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


@router.post("", response_model=schemas.ContentResponse, status_code=201)
def create_content(
    payload: schemas.ContentCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = create_manual_content(db, payload, user)
    return _content_response(content)


@router.patch("/{content_id}", response_model=schemas.ContentResponse)
def update_content(
    content_id: uuid.UUID,
    payload: schemas.ContentUpdateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    content = update_content_item(db, content_id, payload)
    return _content_response(content)
