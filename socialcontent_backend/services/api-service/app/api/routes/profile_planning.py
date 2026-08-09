import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.schemas import api as schemas
from common.db.models import ContentItem, ContentMedia, ContentPlan, ContentSeries, ContentSource, Episode, SeriesPart, SocialProfile, User
from common.db.session import get_db

router = APIRouter()


def _get_owned_profile(db: Session, profile_id: uuid.UUID, user: User) -> SocialProfile:
    profile = db.get(SocialProfile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Social profile not found")
    return profile


@router.get("/{profile_id}/content-plans", response_model=list[schemas.ContentPlanResponse])
def list_profile_content_plans(profile_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_profile(db, profile_id, user)
    return (
        db.query(ContentPlan)
        .filter(ContentPlan.profile_id == profile_id)
        .order_by(ContentPlan.updated_at.desc())
        .limit(100)
        .all()
    )


@router.get("/{profile_id}/content-series", response_model=list[schemas.ContentSeriesResponse])
def list_profile_content_series(profile_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_profile(db, profile_id, user)
    return (
        db.query(ContentSeries)
        .filter(ContentSeries.profile_id == profile_id)
        .order_by(ContentSeries.updated_at.desc())
        .limit(100)
        .all()
    )


@router.get("/{profile_id}/series-review", response_model=list[schemas.ProfileSeriesReviewResponse])
def list_profile_series_review(profile_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_profile(db, profile_id, user)
    series_items = (
        db.query(ContentSeries)
        .filter(ContentSeries.profile_id == profile_id)
        .order_by(ContentSeries.updated_at.desc())
        .limit(100)
        .all()
    )
    series_ids = [item.id for item in series_items]
    parts = (
        db.query(SeriesPart)
        .filter(SeriesPart.series_id.in_(series_ids))
        .order_by(SeriesPart.series_id.asc(), SeriesPart.updated_at.desc(), SeriesPart.part_number.asc())
        .all()
        if series_ids
        else []
    )
    parts_by_series: dict[uuid.UUID, list[SeriesPart]] = {}
    for part in parts:
        parts_by_series.setdefault(part.series_id, []).append(part)

    plan_ids = {item.content_plan_id for item in series_items}
    content_ids: set[uuid.UUID] = set()
    story_ids: set[uuid.UUID] = set()
    episode_ids: set[uuid.UUID] = set()
    for part in parts:
        for ref in part.source_refs or []:
            if not isinstance(ref, dict):
                continue
            if ref.get("content_id"):
                content_ids.add(uuid.UUID(str(ref["content_id"])))
            if ref.get("story_id"):
                story_ids.add(uuid.UUID(str(ref["story_id"])))
            if ref.get("episode_id"):
                episode_ids.add(uuid.UUID(str(ref["episode_id"])))

    episodes = db.query(Episode).filter(Episode.id.in_(episode_ids)).all() if episode_ids else []
    episode_lookup = {episode.id: episode for episode in episodes}
    for episode in episodes:
        if episode.content_id:
            content_ids.add(episode.content_id)
        if episode.story_id:
            story_ids.add(episode.story_id)

    plans_query = db.query(ContentPlan).filter(ContentPlan.profile_id == profile_id)
    if plan_ids or content_ids or story_ids:
        filters = []
        if plan_ids:
            filters.append(ContentPlan.id.in_(plan_ids))
        if content_ids:
            filters.append(ContentPlan.primary_content_id.in_(content_ids))
        if story_ids:
            filters.append(ContentPlan.primary_story_id.in_(story_ids))
        from sqlalchemy import or_

        plans_query = plans_query.filter(or_(*filters))
    plans = plans_query.order_by(ContentPlan.updated_at.desc()).all()
    plans_by_id = {plan.id: plan for plan in plans}
    plans_by_content = {plan.primary_content_id: plan for plan in plans if plan.primary_content_id}
    plans_by_story = {plan.primary_story_id: plan for plan in plans if plan.primary_story_id}
    for plan in plans:
        if plan.primary_content_id:
            content_ids.add(plan.primary_content_id)

    contents = db.query(ContentItem).filter(ContentItem.id.in_(content_ids)).all() if content_ids else []
    content_lookup = {content.id: content for content in contents}
    sources = (
        db.query(ContentSource)
        .filter(ContentSource.content_id.in_(content_ids))
        .order_by(ContentSource.is_primary.desc(), ContentSource.first_seen_at.desc())
        .all()
        if content_ids
        else []
    )
    source_lookup: dict[uuid.UUID, ContentSource] = {}
    sources_lookup: dict[uuid.UUID, list[ContentSource]] = {}
    for source in sources:
        source_lookup.setdefault(source.content_id, source)
        sources_lookup.setdefault(source.content_id, []).append(source)
    media = (
        db.query(ContentMedia)
        .filter(ContentMedia.content_id.in_(content_ids))
        .order_by(ContentMedia.created_at.desc())
        .all()
        if content_ids
        else []
    )
    media_lookup: dict[uuid.UUID, list[ContentMedia]] = {}
    for item in media:
        media_lookup.setdefault(item.content_id, []).append(item)
    full_text_lookup = _load_full_texts(sources)

    return [
        {
            "series": item,
            "articles": _build_review_articles(
                item,
                parts_by_series.get(item.id, []),
                plans_by_id,
                plans_by_content,
                plans_by_story,
                content_lookup,
                source_lookup,
                sources_lookup,
                media_lookup,
                full_text_lookup,
                episode_lookup,
            ),
        }
        for item in series_items
    ]


def _build_review_articles(
    series: ContentSeries,
    parts: list[SeriesPart],
    plans_by_id: dict[uuid.UUID, ContentPlan],
    plans_by_content: dict[uuid.UUID, ContentPlan],
    plans_by_story: dict[uuid.UUID, ContentPlan],
    content_lookup: dict[uuid.UUID, ContentItem],
    source_lookup: dict[uuid.UUID, ContentSource],
    sources_lookup: dict[uuid.UUID, list[ContentSource]],
    media_lookup: dict[uuid.UUID, list[ContentMedia]],
    full_text_lookup: dict[uuid.UUID, str],
    episode_lookup: dict[uuid.UUID, Episode],
) -> list[dict]:
    grouped: dict[str, list[SeriesPart]] = {}
    for part in parts:
        grouped.setdefault(_part_article_key(part, episode_lookup), []).append(part)

    articles = []
    fallback_plan = plans_by_id.get(series.content_plan_id)
    for key, article_parts in grouped.items():
        plan = _find_plan_for_article_key(key, plans_by_content, plans_by_story) or fallback_plan
        source_content = _source_content_for_article_key(key, plan, content_lookup, source_lookup, sources_lookup, media_lookup, full_text_lookup)
        articles.append({"plan": plan, "source_content": source_content, "parts": article_parts})

    if not articles and fallback_plan:
        articles.append({
            "plan": fallback_plan,
            "source_content": _source_content_for_plan(fallback_plan, content_lookup, source_lookup, sources_lookup, media_lookup, full_text_lookup),
            "parts": [],
        })

    articles.sort(
        key=lambda item: max((part.updated_at for part in item["parts"]), default=(item["plan"].updated_at if item["plan"] else series.updated_at)),
        reverse=True,
    )
    return articles


def _source_content_for_article_key(
    key: str,
    plan: ContentPlan | None,
    content_lookup: dict[uuid.UUID, ContentItem],
    source_lookup: dict[uuid.UUID, ContentSource],
    sources_lookup: dict[uuid.UUID, list[ContentSource]],
    media_lookup: dict[uuid.UUID, list[ContentMedia]],
    full_text_lookup: dict[uuid.UUID, str],
) -> dict | None:
    kind, _, raw_id = key.partition(":")
    if kind == "content" and raw_id:
        try:
            content_id = uuid.UUID(raw_id)
        except ValueError:
            content_id = None
        if content_id and content_id in content_lookup:
            return _serialize_source_content(
                content_lookup[content_id],
                source_lookup.get(content_id),
                sources_lookup.get(content_id, []),
                media_lookup.get(content_id, []),
                full_text_lookup.get(content_id),
            )
    return _source_content_for_plan(plan, content_lookup, source_lookup, sources_lookup, media_lookup, full_text_lookup)


def _source_content_for_plan(
    plan: ContentPlan | None,
    content_lookup: dict[uuid.UUID, ContentItem],
    source_lookup: dict[uuid.UUID, ContentSource],
    sources_lookup: dict[uuid.UUID, list[ContentSource]],
    media_lookup: dict[uuid.UUID, list[ContentMedia]],
    full_text_lookup: dict[uuid.UUID, str],
) -> dict | None:
    if not plan or not plan.primary_content_id:
        return None
    content = content_lookup.get(plan.primary_content_id)
    if not content:
        return None
    return _serialize_source_content(
        content,
        source_lookup.get(content.id),
        sources_lookup.get(content.id, []),
        media_lookup.get(content.id, []),
        full_text_lookup.get(content.id),
    )


def _serialize_source_content(
    content: ContentItem,
    source: ContentSource | None,
    sources: list[ContentSource],
    media: list[ContentMedia],
    full_text: str | None,
) -> dict:
    return {
        "id": content.id,
        "content_type": content.content_type,
        "canonical_title": content.canonical_title,
        "summary": content.summary,
        "full_text": full_text or content.summary,
        "language": content.language,
        "status": content.status,
        "canonical_url": content.canonical_url,
        "source_type": source.source_type if source else None,
        "source_url": source.source_url if source else content.canonical_url,
        "source_author": source.source_author if source else None,
        "source_published_at": source.source_published_at if source else None,
        "quality_score": float(content.quality_score or 0),
        "published_at": content.published_at,
        "created_at": content.created_at,
        "updated_at": content.updated_at,
        "sources": [
            {
                "id": item.id,
                "source_type": item.source_type,
                "source_external_id": item.source_external_id,
                "source_url": item.source_url,
                "raw_document_id": item.raw_document_id,
                "source_title": item.source_title,
                "source_author": item.source_author,
                "source_published_at": item.source_published_at,
                "metadata_json": item.metadata_json,
                "first_seen_at": item.first_seen_at,
                "last_seen_at": item.last_seen_at,
            }
            for item in sources
        ],
        "media": [
            {
                "id": item.id,
                "media_type": item.media_type,
                "source_url": item.source_url,
                "storage_url": item.storage_url,
                "thumbnail_url": item.thumbnail_url,
                "mime_type": item.mime_type,
                "width": item.width,
                "height": item.height,
                "duration_seconds": item.duration_seconds,
                "created_at": item.created_at,
            }
            for item in media
        ],
    }


def _load_full_texts(sources: list[ContentSource]) -> dict[uuid.UUID, str]:
    result: dict[uuid.UUID, str] = {}
    try:
        from bson import ObjectId
        from common.db.mongo import processed_documents, raw_documents

        proc_coll = processed_documents()
        raw_coll = raw_documents()
        for source in sources:
            full_text = None
            metadata = dict(source.metadata_json or {})
            proc_id_str = metadata.get("processed_document_id")
            if proc_id_str:
                try:
                    proc_doc = proc_coll.find_one({"_id": ObjectId(proc_id_str)})
                    if proc_doc and "normalized" in proc_doc:
                        full_text = proc_doc["normalized"].get("content") or proc_doc["normalized"].get("description")
                except Exception:
                    pass
            if not full_text and source.raw_document_id:
                try:
                    raw_doc = raw_coll.find_one({"_id": ObjectId(source.raw_document_id)})
                    if raw_doc and "raw" in raw_doc:
                        full_text = raw_doc["raw"].get("text") or raw_doc["raw"].get("raw_text")
                except Exception:
                    pass
            if full_text:
                result[source.content_id] = full_text
    except Exception as exc:
        print("Error fetching source content text from mongo:", exc)
    return result


def _part_article_key(part: SeriesPart, episode_lookup: dict[uuid.UUID, Episode]) -> str:
    refs = part.source_refs or []
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        if ref.get("content_id"):
            return f"content:{ref['content_id']}"
        if ref.get("story_id"):
            return f"story:{ref['story_id']}"
        if ref.get("episode_id"):
            episode_id = uuid.UUID(str(ref["episode_id"]))
            episode = episode_lookup.get(episode_id)
            if episode and episode.content_id:
                return f"content:{episode.content_id}"
            if episode and episode.story_id:
                return f"story:{episode.story_id}"
            return f"episode:{episode_id}"
    return f"unlinked:{part.id}"


def _find_plan_for_article_key(
    key: str,
    plans_by_content: dict[uuid.UUID, ContentPlan],
    plans_by_story: dict[uuid.UUID, ContentPlan],
) -> ContentPlan | None:
    kind, _, raw_id = key.partition(":")
    if not raw_id:
        return None
    try:
        parsed_id = uuid.UUID(raw_id)
    except ValueError:
        return None
    if kind == "content":
        return plans_by_content.get(parsed_id)
    if kind == "story":
        return plans_by_story.get(parsed_id)
    return None
