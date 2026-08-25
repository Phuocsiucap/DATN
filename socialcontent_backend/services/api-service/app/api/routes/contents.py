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

    return query.order_by(ContentItem.created_at.desc()).limit(100).all()


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
            "source_type": primary_source.get("source_type"),
            "source_url": primary_source.get("source_url") or content.canonical_url,
            "media_jsonb": content.media_jsonb if isinstance(content.media_jsonb, list) else [],
            "story_id": story.id if story else None,
            "episode_order": content.episode_order,
        }
        if story:
            series_items.append(row)
        else:
            normal_items.append(row)

    return {"normal_items": normal_items, "series_items": series_items}


@router.get("/{content_id}", response_model=schemas.ContentResponse)
def get_content(content_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_visible_content(db, content_id, user)


@router.get("/{content_id}/detail", response_model=schemas.ContentDetailResponse)
def get_content_detail(content_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    content = _get_visible_content(db, content_id, user)
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    
    full_text = _load_content_full_text(content.mongo_normalized_id, content.mongo_raw_id) or content.summary
    
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
        "content_hash": content.content_hash,
        "transcript_hash": content.transcript_hash,
        "quality_score": content.quality_score,
        "created_at": content.created_at,
        "updated_at": content.updated_at,
        "sources_jsonb": sources,
        "media_jsonb": content.media_jsonb if isinstance(content.media_jsonb, list) else [],
        "story_id": content.story_id,
        "episode_order": content.episode_order,
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


@router.patch("/{content_id}", response_model=schemas.ContentResponse)
def update_content(content_id: uuid.UUID, payload: schemas.ContentUpdateRequest, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    content = db.get(ContentItem, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(content, field, value)
    db.commit()
    db.refresh(content)
    return content


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
