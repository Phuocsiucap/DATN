import html
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import ContentDuplicate, ContentItem, ContentMedia, ContentSource, Episode, ProcessingRun, Story, User
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

    if crawl_job_id:
        subq = (
            db.query(ProcessingRun.content_id)
            .filter(ProcessingRun.job_id == crawl_job_id, ProcessingRun.content_id.isnot(None))
            .scalar_subquery()
        )
        query = query.filter(ContentItem.id.in_(subq))

    if content_type:
        query = query.filter(ContentItem.content_type == content_type.upper())
    if status:
        query = query.filter(ContentItem.status == status.upper())
    if language:
        query = query.filter(ContentItem.language == language)
    if source_type:
        subq_src = (
            db.query(ContentSource.content_id)
            .filter(ContentSource.source_type == source_type.upper())
            .scalar_subquery()
        )
        query = query.filter(ContentItem.id.in_(subq_src))
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
        subq = (
            db.query(ProcessingRun.content_id)
            .filter(ProcessingRun.job_id == crawl_job_id, ProcessingRun.content_id.isnot(None))
            .scalar_subquery()
        )
        query = query.filter(ContentItem.id.in_(subq))
    contents = query.order_by(ContentItem.created_at.desc()).limit(200).all()
    content_ids = [content.id for content in contents]
    sources = []
    episodes = []
    media = []
    if content_ids:
        sources = (
            db.query(ContentSource)
            .filter(ContentSource.content_id.in_(content_ids))
            .order_by(ContentSource.is_primary.desc(), ContentSource.first_seen_at.desc())
            .all()
        )
        episodes = (
            db.query(Episode)
            .filter(Episode.content_id.in_(content_ids))
            .order_by(Episode.sequence_order.asc().nullslast(), Episode.episode_number.asc().nullslast())
            .all()
        )
        media = (
            db.query(ContentMedia)
            .filter(ContentMedia.content_id.in_(content_ids))
            .order_by(ContentMedia.created_at.desc())
            .all()
        )

    source_by_content = {}
    for source in sources:
        source_by_content.setdefault(source.content_id, source)

    media_by_content = {}
    for item in media:
        media_by_content.setdefault(item.content_id, [])
        if len(media_by_content[item.content_id]) < 4:
            media_by_content[item.content_id].append(item)

    episode_by_content = {}
    story_ids = set()
    for episode in episodes:
        episode_by_content.setdefault(episode.content_id, episode)
        story_ids.add(episode.story_id)
    stories = db.query(Story).filter(Story.id.in_(story_ids)).all() if story_ids else []
    story_by_id = {story.id: story for story in stories}

    normal_items = []
    series_items = []
    for content in contents:
        source = source_by_content.get(content.id)
        episode = episode_by_content.get(content.id)
        story = story_by_id.get(episode.story_id) if episode else None
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
            "source_type": source.source_type if source else None,
            "source_url": source.source_url if source else content.canonical_url,
            "media": media_by_content.get(content.id, []),
            "episode_id": episode.id if episode else None,
            "episode_number": episode.episode_number if episode else None,
            "sequence_order": episode.sequence_order if episode else None,
            "episode_title": episode.episode_title if episode else None,
            "series": {
                "id": story.id,
                "canonical_name": story.canonical_name,
                "completion_status": story.completion_status,
                "total_episodes": story.total_episodes,
                "grouping_confidence": story.grouping_confidence,
            } if story else None,
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
    media = db.query(ContentMedia).filter(ContentMedia.content_id == content_id).order_by(ContentMedia.created_at.desc()).all()
    runs = db.query(ProcessingRun).filter(ProcessingRun.content_id == content_id).order_by(ProcessingRun.created_at.desc()).limit(20).all()
    sources = db.query(ContentSource).filter(ContentSource.content_id == content_id).order_by(ContentSource.first_seen_at.desc()).all()

    full_text = _load_content_full_text(sources) or content.summary
    cleaned_sources = []
    for s in sources:
        meta = dict(s.metadata_json or {})
        meta.pop("processed_document_id", None)
        cleaned_sources.append({
            "id": s.id,
            "source_type": s.source_type,
            "source_external_id": s.source_external_id,
            "source_url": s.source_url,
            "raw_document_id": s.raw_document_id,
            "processed_document_id": s.processed_document_id,
            "source_title": s.source_title,
            "source_author": s.source_author,
            "source_published_at": s.source_published_at,
            "metadata_json": meta,
            "first_seen_at": s.first_seen_at,
            "last_seen_at": s.last_seen_at,
        })

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
        "sources": cleaned_sources,
        "media": media,
        "processing_runs": runs,
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
    run = ProcessingRun(content_id=content.id, processing_type="NORMALIZATION", status="REQUESTED", input_reference=str(content.id))
    db.add(run)
    db.commit()
    publish(
        CONTENT_NORMALIZATION_REQUESTED,
        build_event(
            event_type=CONTENT_NORMALIZATION_REQUESTED,
            source="api-service",
            payload={"content_id": str(content.id), "processing_run_id": str(run.id)},
        ),
    )
    return {"requested": True, "processing_run_id": run.id}


@router.post("/{content_id}/mark-duplicate")
def mark_duplicate(content_id: uuid.UUID, duplicate_content_id: uuid.UUID, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    primary = db.get(ContentItem, content_id)
    duplicate = db.get(ContentItem, duplicate_content_id)
    if not primary or not duplicate:
        raise HTTPException(status_code=404, detail="Content not found")
    row = ContentDuplicate(
        primary_content_id=primary.id,
        duplicate_content_id=duplicate.id,
        match_type="MANUAL",
        similarity_score=100,
        decision="DUPLICATE",
        decision_reason="Marked by admin",
    )
    db.add(row)
    db.commit()
    publish(
        CONTENT_DEDUPLICATION_REQUESTED,
        build_event(
            event_type=CONTENT_DEDUPLICATION_REQUESTED,
            source="api-service",
            payload={"primary_content_id": str(primary.id), "duplicate_content_id": str(duplicate.id)},
        ),
    )
    return {"marked": True, "duplicate_id": row.id}
