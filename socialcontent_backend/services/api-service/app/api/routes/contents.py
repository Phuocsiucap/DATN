import html
import hashlib
import re
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote_plus, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from common.db.models import CrawlJob, CrawlJobContent, ContentItem, KafkaTask, MediaWorkflow, ProfileContentLink, SocialProfile, SocialProfileStrategy, Story, User
from common.db.session import get_db
from common.db.media_workflows import _load_content_full_text
from common.planning.embedding_matcher import StrategyEmbeddingMatcher
from app.api.deps import get_current_user, require_admin
from app.schemas import api as schemas

router = APIRouter()
BILIBILI_HEADERS = {
    "Referer": "https://www.bilibili.com/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}


class BilibiliOcrQueueRequest(BaseModel):
    episode_indices: list[int] | None = None


class BilibiliTranslationWorkflowRequest(BaseModel):
    profile_id: uuid.UUID
    episode_indices: list[int] | None = None
    title: str | None = None


def _private_content_ids_for_user(user_id: uuid.UUID):
    return (
        select(CrawlJobContent.content_id)
        .join(CrawlJob, CrawlJob.id == CrawlJobContent.job_id)
        .where(
            CrawlJob.requested_by == user_id,
            CrawlJob.content_scope == "PRIVATE",
        )
    )


def _visible_content_query(query, user: User, content_scope: str | None):
    requested_scope = str(content_scope or "").strip().upper()
    if user.is_system_admin:
        return query.filter(ContentItem.content_scope == requested_scope) if requested_scope else query

    own_private_ids = _private_content_ids_for_user(user.id)
    own_private = and_(ContentItem.content_scope == "PRIVATE", ContentItem.id.in_(own_private_ids))
    if requested_scope == "PRIVATE":
        return query.filter(own_private)
    if requested_scope == "GLOBAL":
        return query.filter(ContentItem.content_scope == "GLOBAL")
    if requested_scope in {"INBOX", "CREATOR"}:
        assigned_global_ids = (
            select(ProfileContentLink.content_id)
            .join(SocialProfile, SocialProfile.id == ProfileContentLink.profile_id)
            .where(
                SocialProfile.user_id == user.id,
                ProfileContentLink.status == "ACTIVE",
                ProfileContentLink.source_scope == "GLOBAL",
            )
        )
        creator_crawled_ids = _private_content_ids_for_user(user.id)
        return query.filter(
            or_(
                own_private,
                and_(ContentItem.content_scope == "GLOBAL", ContentItem.id.in_(assigned_global_ids)),
                and_(ContentItem.content_scope == "GLOBAL", ContentItem.id.in_(creator_crawled_ids)),
            )
        )
    return query.filter(or_(ContentItem.content_scope == "GLOBAL", own_private))


def _crawl_job_content_query(query, crawl_job_id: uuid.UUID):
    return query.join(CrawlJobContent, CrawlJobContent.content_id == ContentItem.id).filter(
        CrawlJobContent.job_id == crawl_job_id
    )


def _content_order(content_scope: str | None, crawl_job_id: uuid.UUID | None, user: User | None = None):
    if crawl_job_id:
        return (CrawlJobContent.created_at.desc(), ContentItem.created_at.desc())
    if user and str(content_scope or "").strip().upper() in {"INBOX", "CREATOR"}:
        last_creator_crawl = (
            select(func.max(CrawlJobContent.created_at))
            .join(CrawlJob, CrawlJob.id == CrawlJobContent.job_id)
            .where(
                CrawlJobContent.content_id == ContentItem.id,
                CrawlJob.requested_by == user.id,
                CrawlJob.content_scope == "PRIVATE",
            )
            .correlate(ContentItem)
            .scalar_subquery()
        )
        last_recommendation = (
            select(func.max(ProfileContentLink.recommended_at))
            .join(SocialProfile, SocialProfile.id == ProfileContentLink.profile_id)
            .where(
                ProfileContentLink.content_id == ContentItem.id,
                SocialProfile.user_id == user.id,
                ProfileContentLink.status == "ACTIVE",
            )
            .correlate(ContentItem)
            .scalar_subquery()
        )
        activity_at = func.greatest(ContentItem.updated_at, last_creator_crawl, last_recommendation)
        return (activity_at.desc(), ContentItem.created_at.desc())
    return (ContentItem.created_at.desc(),)


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
    query = db.query(ContentItem)

    query = _visible_content_query(query, user, content_scope)

    if content_type:
        query = query.filter(ContentItem.content_type == content_type.upper())
    if status:
        query = query.filter(ContentItem.status == status.upper())
    if language:
        query = query.filter(ContentItem.language == language)
    if crawl_job_id:
        query = _crawl_job_content_query(query, crawl_job_id)

    contents = query.order_by(*_content_order(content_scope, crawl_job_id, user)).limit(100).all()
    return [_content_response(item) for item in contents]


@router.get("/final-view")
def final_content_view(
    crawl_job_id: uuid.UUID | None = None,
    content_scope: str | None = None,
    view: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ContentItem)

    query = _visible_content_query(query, user, content_scope)
    if crawl_job_id:
        query = _crawl_job_content_query(query, crawl_job_id)

    contents = query.order_by(*_content_order(content_scope, crawl_job_id, user)).limit(200).all()
    
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
    content = _get_visible_content(db, content_id, user)
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
    content = _get_visible_content(db, content_id, user)
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
    content = _get_visible_content(db, content_id, user)
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
    return _content_response(_get_visible_content(db, content_id, user))


@router.get("/{content_id}/detail", response_model=schemas.ContentDetailResponse)
def get_content_detail(content_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    content = _get_visible_content(db, content_id, user)
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
    story_for_detail = None if _is_vnexpress_article(source_type, content) else content.story_id
    
    full_text = _load_content_full_text(content.mongo_normalized_id) or content.summary
    normalized_article = _normalized_article(content, source_metadata, full_text, content.media_jsonb)
    if not normalized_article.get("publishedAt"):
        normalized_article["publishedAt"] = primary_source.get("source_published_at")
    profile_matches = _profile_matches(db, content, source_metadata, user)
    db.commit()
    
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
        "ai_selection_summary": profile_matches[0].get("selection_reason") if profile_matches else _content_selection_summary(content, source_metadata),
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
    if content.content_scope == "PRIVATE":
        owner_link = db.query(CrawlJobContent.job_id).join(CrawlJob, CrawlJob.id == CrawlJobContent.job_id).filter(
            CrawlJobContent.content_id == content.id,
            CrawlJob.requested_by == user.id,
            CrawlJob.content_scope == "PRIVATE",
        ).first()
        if owner_link:
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


def _profile_matches(db: Session, content: ContentItem, source_metadata: dict, user: User) -> list[dict]:
    profiles = (
        db.query(SocialProfile)
        .filter(
            SocialProfile.user_id == user.id,
            func.lower(SocialProfile.status) != "deleted",
        )
        .order_by(SocialProfile.created_at.desc())
        .all()
    )
    links = (
        db.query(ProfileContentLink)
        .join(SocialProfile, SocialProfile.id == ProfileContentLink.profile_id)
        .filter(SocialProfile.user_id == user.id, ProfileContentLink.content_id == content.id)
        .all()
    )
    link_by_profile = {link.profile_id: link for link in links}
    workflows = (
        db.query(MediaWorkflow)
        .join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
        .filter(
            SocialProfile.user_id == user.id,
            MediaWorkflow.primary_content_id == content.id,
        )
        .order_by(MediaWorkflow.created_at.desc())
        .all()
    )
    workflow_by_profile: dict[uuid.UUID, MediaWorkflow] = {}
    for workflow in workflows:
        workflow_by_profile.setdefault(workflow.profile_id, workflow)
    matcher = StrategyEmbeddingMatcher()
    matcher.ensure_content_embedding(db, content, preferred_model_name=matcher.model_name())
    matches = []
    for profile in profiles:
        strategy = profile.strategy
        link = link_by_profile.get(profile.id)
        existing_workflow = workflow_by_profile.get(profile.id)
        metadata = link.metadata_json if link and isinstance(link.metadata_json, dict) else {}
        if strategy and link and _has_stored_embedding_match(metadata):
            score = round(float(link.score or _metadata_float(metadata, "strategy_score", "score") or 0), 1)
            similarity_threshold = _metadata_float(metadata, "similarity_threshold")
            threshold = round(similarity_threshold * 100.0, 1) if similarity_threshold is not None else 70.0
            match_metadata = metadata
            matched_topics = _metadata_terms(metadata, "matched_topics")
            avoided_topics = _metadata_terms(metadata, "avoided_topics")
            topic_matches = _metadata_list(metadata, "topic_matches")
            avoid_topic_matches = _metadata_list(metadata, "avoid_topic_matches")
            embedding_similarity = _metadata_float(metadata, "embedding_similarity")
            embedding_model = metadata.get("embedding_model") or _metadata_from_breakdown(metadata, "embedding_model")
            passed_similarity_gate = metadata.get("passed_similarity_gate")
            similarity_source = metadata.get("similarity_source") or _metadata_from_breakdown(metadata, "similarity_source")
            top_topic_match = metadata.get("top_topic_match") or _metadata_from_breakdown(metadata, "top_topic_match")
            avoid_similarity_threshold = _metadata_float(metadata, "avoid_similarity_threshold")
            can_create_script = str(profile.status or "").lower() == "active" and bool(metadata.get("eligible_for_auto_workflow"))
            recommendation_status = link.recommendation_status
            relation_reason = link.relation_reason
        elif strategy:
            match_score = matcher.score_candidate(db, content, strategy)
            score = match_score.score
            similarity_threshold = match_score.threshold
            threshold = round(similarity_threshold * 100.0, 1)
            match_metadata = match_score.metadata
            matched_topics = match_score.matched_topics
            avoided_topics = match_score.avoided_topics
            topic_matches = match_metadata.get("topic_matches") or []
            avoid_topic_matches = match_metadata.get("avoid_topic_matches") or []
            embedding_similarity = match_score.similarity
            embedding_model = match_metadata.get("embedding_model")
            passed_similarity_gate = match_metadata.get("passed_similarity_gate")
            similarity_source = match_metadata.get("similarity_source")
            top_topic_match = match_metadata.get("top_topic_match")
            avoid_similarity_threshold = match_metadata.get("avoid_similarity_threshold")
            can_create_script = str(profile.status or "").lower() == "active" and match_score.eligible
            recommendation_status = _profile_recommendation_status(link, match_score.eligible, bool(match_score.avoided_topics))
            relation_reason = link.relation_reason if link else _profile_relation_reason(match_score.eligible, bool(match_score.avoided_topics))
        else:
            score = round(float(content.quality_score or 0), 1)
            threshold = 70.0
            similarity_threshold = None
            match_metadata = {}
            matched_topics = []
            avoided_topics = []
            topic_matches = []
            avoid_topic_matches = []
            embedding_similarity = None
            embedding_model = None
            passed_similarity_gate = None
            similarity_source = None
            top_topic_match = None
            avoid_similarity_threshold = None
            can_create_script = str(profile.status or "").lower() == "active" and score >= threshold
            recommendation_status = link.recommendation_status if link else ("RECOMMENDED" if score >= threshold else "LOW_MATCH")
            relation_reason = link.relation_reason if link else "QUALITY_FALLBACK"
        if existing_workflow:
            can_create_script = False
        selection = _profile_selection_explanation(
            content=content,
            source_metadata=source_metadata,
            profile=profile,
            strategy=strategy,
            score=score,
            threshold=threshold,
            matched_topics=matched_topics,
            avoided_topics=avoided_topics,
            metadata={**metadata, **match_metadata},
            recommendation_status=recommendation_status,
        )
        matches.append({
            "profile_id": profile.id,
            "profile_name": profile.profile_name,
            "username": profile.username,
            "platform": profile.platform,
            "avatar_url": profile.avatar_url,
            "status": profile.status,
            "score": round(score, 1),
            "recommendation_status": recommendation_status,
            "relation_reason": relation_reason,
            "threshold": threshold,
            "embedding_similarity": embedding_similarity,
            "similarity_threshold": similarity_threshold,
            "passed_similarity_gate": passed_similarity_gate,
            "similarity_source": similarity_source,
            "top_topic_match": top_topic_match,
            "avoid_similarity_threshold": avoid_similarity_threshold,
            "embedding_model": embedding_model,
            "matched_topics": matched_topics,
            "avoided_topics": avoided_topics,
            "topic_matches": topic_matches,
            "avoid_topic_matches": avoid_topic_matches,
            "blocked_by_avoid_topics": bool(avoided_topics),
            "tone": strategy.tone if strategy else None,
            "target_audience": strategy.target_audience if strategy else None,
            "can_create_script": can_create_script,
            "existing_workflow_id": existing_workflow.id if existing_workflow else None,
            "existing_workflow_status": existing_workflow.status if existing_workflow else None,
            **selection,
        })
    return sorted(matches, key=lambda item: item["score"], reverse=True)


def _has_stored_embedding_match(metadata: dict) -> bool:
    return bool(
        metadata.get("selection_algorithm")
        or metadata.get("embedding_similarity") is not None
        or _metadata_from_breakdown(metadata, "embedding_similarity") is not None
    )


def _metadata_from_breakdown(metadata: dict, key: str):
    breakdown = metadata.get("score_breakdown")
    if isinstance(breakdown, dict):
        return breakdown.get(key)
    return None


def _metadata_float(metadata: dict, *keys: str) -> float | None:
    for key in keys:
        value = metadata.get(key)
        if value is None:
            value = _metadata_from_breakdown(metadata, key)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def _metadata_list(metadata: dict, key: str) -> list:
    value = metadata.get(key)
    if value is None:
        value = _metadata_from_breakdown(metadata, key)
    return value if isinstance(value, list) else []


def _profile_recommendation_status(link: ProfileContentLink | None, eligible: bool, blocked_by_avoid_topics: bool) -> str:
    if link and link.recommendation_status in {"WORKFLOW_CREATED", "AI_REJECTED", "REVIEW_REQUIRED", "HUMAN_REJECTED", "DRAFT_QUEUED", "DRAFT_FAILED"}:
        return link.recommendation_status
    if blocked_by_avoid_topics:
        return "AVOID_TOPIC_MATCH"
    return "RECOMMENDED" if eligible else "LOW_MATCH"


def _profile_relation_reason(eligible: bool, blocked_by_avoid_topics: bool) -> str:
    if eligible:
        return "EMBEDDING_STRATEGY_MATCH"
    if blocked_by_avoid_topics:
        return "EMBEDDING_AVOID_TOPIC_MATCH"
    return "EMBEDDING_LOW_MATCH"


def _profile_selection_explanation(
    content: ContentItem,
    source_metadata: dict,
    profile: SocialProfile,
    strategy: SocialProfileStrategy | None,
    score: float,
    threshold: float,
    matched_topics: list[str],
    avoided_topics: list[str],
    metadata: dict,
    recommendation_status: str,
) -> dict:
    tags = [str(tag).strip() for tag in source_metadata.get("tags", []) if str(tag).strip()] if isinstance(source_metadata.get("tags"), list) else []
    category = str(source_metadata.get("category") or "").strip()
    tone = str(strategy.tone or "").strip() if strategy else ""
    audience = str(strategy.target_audience or "").strip() if strategy else ""
    content_topics = _split_terms(strategy.content_topics) if strategy else []
    metadata_reason = _human_selection_note(str(metadata.get("reason") or metadata.get("selection_reason") or "").strip())
    title = html.unescape(content.canonical_title or "bài viết này")
    score_text = f"{round(score, 1)}/100"
    threshold_text = f"{round(threshold, 1)}/100"

    topic_value = ", ".join(matched_topics[:3]) or category or ", ".join(tags[:3]) or "Chưa có chủ đề rõ"
    topic_tone = "green" if matched_topics else "gray"
    audience_value = audience or "Chưa cấu hình persona"
    tone_value = tone or "Chưa cấu hình tone"

    reason_parts: list[str] = []
    if recommendation_status == "AI_REJECTED":
        reason_parts.append("Không được đề xuất sau bước đánh giá hệ thống.")
    elif recommendation_status == "HUMAN_REJECTED":
        reason_parts.append("Người dùng đã quyết định không sản xuất bài này.")
    elif recommendation_status == "DRAFT_QUEUED":
        reason_parts.append("Người dùng đã duyệt bài; job đang chờ hoặc đang sinh draft.")
    elif recommendation_status == "DRAFT_FAILED":
        reason_parts.append("Bài đã được duyệt nhưng sinh draft thất bại; xem chi tiết plan để thử lại.")
    elif recommendation_status == "REVIEW_REQUIRED":
        reason_parts.append("Cần kiểm duyệt trước khi tiếp tục.")
    elif avoided_topics:
        reason_parts.append(f"Không đề xuất vì khớp chủ đề cần tránh: {', '.join(avoided_topics[:4])}.")
    if score >= threshold:
        reason_parts.append(f"Điểm phù hợp {score_text} đạt ngưỡng {threshold_text} của kênh {profile.profile_name}.")
    else:
        reason_parts.append(f"Điểm phù hợp {score_text} chưa đạt ngưỡng {threshold_text} của kênh {profile.profile_name}.")
    if metadata_reason:
        reason_parts.append(metadata_reason)
    if matched_topics:
        reason_parts.append(f"Nội dung khớp chủ đề ưu tiên: {', '.join(matched_topics[:4])}.")

    risk_notes = []
    if score < threshold:
        risk_notes.append("Điểm phù hợp thấp hơn ngưỡng lựa chọn nội dung của kênh.")
    if avoided_topics:
        risk_notes.append(f"Có chủ đề nên tránh: {', '.join(avoided_topics[:4])}.")
    if not matched_topics and content_topics:
        risk_notes.append("Chưa ghi nhận chủ đề ưu tiên khớp với bài viết.")

    return {
        "selection_reason": " ".join(reason_parts),
        "ai_decision_reason": metadata_reason or None,
        "fit_insights": [
            {"label": "Chủ đề khớp với kênh" if matched_topics else "Chuyên mục / thẻ bài viết", "value": topic_value, "tone": topic_tone},
            {"label": "Khán giả mục tiêu của kênh", "value": audience_value, "tone": "gray"},
            {"label": "Giọng điệu cấu hình", "value": tone_value, "tone": "gray"},
        ],
        "suggested_angle": (
            _profile_suggested_angle(title, profile.platform, topic_value, tone)
            if recommendation_status in {"RECOMMENDED", "WORKFLOW_CREATED"} and score >= threshold and not avoided_topics
            else None
        ),
        "risk_notes": risk_notes,
        "source_evidence": [value for value in [category, *tags[:5]] if value],
    }


def _profile_suggested_angle(title: str, platform: str | None, topic_value: str, tone: str) -> str:
    clean_title = title.strip()[:120]
    platform_name = str(platform or "").lower()
    if platform_name == "tiktok":
        return f"Mở bằng câu hỏi từ tiêu đề \"{clean_title}\", dùng hình ảnh chính làm hook 3 giây đầu và giữ nhịp {tone or 'ngắn gọn, tự nhiên'}."
    if platform_name == "facebook":
        return f"Dẫn bằng insight gây tranh luận quanh {topic_value}, sau đó tóm tắt ý chính và hỏi ý kiến cộng đồng."
    if platform_name == "youtube":
        return f"Biến bài thành kịch bản ngắn có hook, bối cảnh, ba luận điểm chính và kết luận dễ nhớ."
    return f"Khai thác góc {topic_value}, bắt đầu bằng vấn đề chính của bài và chốt bằng lời kêu gọi tương tác."


def _human_selection_note(value: str) -> str:
    normalized = value.strip().lower()
    if not normalized:
        return ""
    if normalized == "auto-recommended from global scope":
        return "Bài được hệ thống tự đề xuất từ kho nội dung global."
    if normalized == "auto-recommended from private scope":
        return "Bài được hệ thống tự đề xuất từ kho nội dung riêng."
    if normalized in {"strategy_match", "recommended"}:
        return ""
    return value


def _content_selection_summary(content: ContentItem, source_metadata: dict) -> str:
    tags = source_metadata.get("tags") if isinstance(source_metadata.get("tags"), list) else []
    topic = source_metadata.get("category") or ", ".join(str(tag) for tag in tags[:3]) or "nội dung này"
    score = round(float(content.quality_score or 0), 1)
    return f"Hệ thống giữ bài vì điểm chất lượng {score}/100 và tín hiệu chủ đề từ {topic} đủ để đưa vào bước phân tích tài khoản."


def _metadata_terms(metadata: dict, key: str) -> list[str]:
    value = metadata.get(key)
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return _split_terms(value)
    return []


def _split_terms(value: str | None) -> list[str]:
    return [part.strip() for part in str(value or "").replace("\n", ",").split(",") if part.strip()]


def _source_metadata(primary_source: dict) -> dict:
    metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def _list_source_metadata(metadata: dict) -> dict:
    keys = (
        "article_id",
        "category_id",
        "site_id",
        "category",
        "tags",
        "image_count",
        "video_count",
        "thumbnail_url",
        "embed_url",
        "episode_count",
        "episodes",
        "season_id",
        "season_title",
        "series_title",
    )
    return {key: metadata.get(key) for key in keys if metadata.get(key) not in (None, "", [])}


def _bilibili_episodes_for_queue(content: ContentItem, source_metadata: dict, primary_source: dict) -> list[dict]:
    episodes = source_metadata.get("episodes")
    if isinstance(episodes, list):
        cleaned = [episode for episode in episodes if isinstance(episode, dict)]
        if cleaned:
            normalized = [_normalize_bilibili_episode(content, source_metadata, primary_source, episode, index) for index, episode in enumerate(cleaned, start=1)]
            if all(episode.get("url") and episode.get("embed_url") for episode in normalized):
                return normalized
            live_episodes = _fetch_bilibili_episodes_live(content, source_metadata, primary_source)
            if live_episodes:
                return _merge_bilibili_episode_sources(normalized, live_episodes)
            return normalized

    live_episodes = _fetch_bilibili_episodes_live(content, source_metadata, primary_source)
    if live_episodes:
        return live_episodes

    text_episodes = _bilibili_episodes_from_text(content)
    if text_episodes:
        live_episodes = _fetch_bilibili_episodes_live(content, source_metadata, primary_source)
        if live_episodes:
            return _merge_bilibili_episode_sources(text_episodes, live_episodes)
        return text_episodes

    return [{
        "episode_index": content.episode_order or 1,
        "title": content.canonical_title,
        "url": primary_source.get("source_url") or content.canonical_url,
        "bvid": source_metadata.get("bvid"),
        "aid": source_metadata.get("aid"),
        "cid": source_metadata.get("cid"),
        "thumbnail_url": source_metadata.get("thumbnail_url"),
        "duration_seconds": content.duration_seconds,
        "content_id": str(content.id),
        "current": True,
    }]


def _normalize_bilibili_episode(
    content: ContentItem,
    source_metadata: dict,
    primary_source: dict,
    episode: dict,
    fallback_index: int,
) -> dict:
    episode_index = _safe_int(episode.get("episode_index")) or _extract_bilibili_episode_index(episode.get("title")) or fallback_index
    raw_url = episode.get("url")
    if raw_url:
        url = str(raw_url)
    elif episode.get("current"):
        url = str(primary_source.get("source_url") or content.canonical_url or "")
    else:
        url = ""
    current_url = str(primary_source.get("source_url") or content.canonical_url or "")
    return {
        "episode_index": episode_index,
        "title": episode.get("title") or content.canonical_title,
        "url": url or None,
        "bvid": episode.get("bvid") or source_metadata.get("bvid"),
        "aid": episode.get("aid") or source_metadata.get("aid"),
        "cid": episode.get("cid") or source_metadata.get("cid"),
        "thumbnail_url": episode.get("thumbnail_url") or source_metadata.get("thumbnail_url"),
        "duration_seconds": episode.get("duration_seconds") or content.duration_seconds,
        "embed_url": episode.get("embed_url") or (source_metadata.get("embed_url") if episode.get("current") else None),
        "content_id": str(content.id),
        "current": _same_bilibili_url(url, current_url),
    }


def _merge_bilibili_episode_sources(base_episodes: list[dict], live_episodes: list[dict]) -> list[dict]:
    live_by_index = {
        _safe_int(episode.get("episode_index")): episode
        for episode in live_episodes
        if _safe_int(episode.get("episode_index")) is not None
    }
    live_by_title = {
        re.sub(r"\s+", "", str(episode.get("title") or "")): episode
        for episode in live_episodes
        if episode.get("title")
    }
    merged: list[dict] = []
    used_live_ids: set[int] = set()
    for base in base_episodes:
        episode_index = _safe_int(base.get("episode_index"))
        title_key = re.sub(r"\s+", "", str(base.get("title") or ""))
        live = live_by_index.get(episode_index) or live_by_title.get(title_key)
        if live:
            used_live_ids.add(id(live))
            merged.append({
                **base,
                **{key: value for key, value in live.items() if value not in (None, "", [])},
                "content_id": base.get("content_id") or live.get("content_id"),
                "current": bool(base.get("current") or live.get("current")),
                "metadata_only": False,
            })
        else:
            merged.append(base)
    for live in live_episodes:
        if id(live) not in used_live_ids:
            merged.append(live)
    return sorted(merged, key=lambda episode: _safe_int(episode.get("episode_index")) or 10_000)


def _fetch_bilibili_episodes_live(content: ContentItem, source_metadata: dict, primary_source: dict) -> list[dict]:
    bvid = str(source_metadata.get("bvid") or "").strip()
    aid = _safe_int(source_metadata.get("aid"))
    if not bvid and not aid:
        source_url = str(primary_source.get("source_url") or content.canonical_url or "")
        match = re.search(r"/video/(BV[0-9A-Za-z]+)", source_url)
        if match:
            bvid = match.group(1)
    if not bvid and not aid:
        return []

    params = {"bvid": bvid} if bvid else {"aid": aid}
    headers = {**BILIBILI_HEADERS, "Referer": str(primary_source.get("source_url") or "https://www.bilibili.com/")}
    with httpx.Client(timeout=12, follow_redirects=True, headers=headers) as client:
        try:
            response = client.get(
                "https://api.bilibili.com/x/web-interface/view",
                params=params,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception:
            return _bilibili_episodes_from_page_archives(client, content, source_metadata, primary_source)

        data = payload.get("data") if isinstance(payload, dict) else {}
        if not isinstance(data, dict):
            return _bilibili_episodes_from_page_archives(client, content, source_metadata, primary_source)
        current_url = str(primary_source.get("source_url") or content.canonical_url or "")
        episodes = _bilibili_episodes_from_ugc_season(data, source_metadata, current_url)
        if episodes:
            return episodes
        episodes = _bilibili_episodes_from_season_archives(data, source_metadata, primary_source)
        if episodes:
            return episodes
        episodes = _bilibili_episodes_from_pages(data, source_metadata, current_url)
        return episodes or _bilibili_episodes_from_page_archives(client, content, source_metadata, primary_source)


def _bilibili_episodes_from_page_archives(
    client: httpx.Client,
    content: ContentItem,
    source_metadata: dict,
    primary_source: dict,
) -> list[dict]:
    source_url = str(primary_source.get("source_url") or content.canonical_url or "")
    if not source_url:
        return []
    try:
        hints = _bilibili_page_series_hints(client, source_url)
        season_id = _safe_int(hints.get("season_id") or source_metadata.get("season_id"))
        mid = _safe_int(hints.get("mid"))
        if not season_id or not mid:
            return []
        mixin_key = _bilibili_wbi_mixin_key(client)
        return _bilibili_episodes_from_archive_api(
            client,
            mixin_key,
            mid=mid,
            season_id=season_id,
            source_metadata=source_metadata,
            referer=source_url,
        )
    except Exception:
        return []


def _bilibili_page_series_hints(client: httpx.Client, url: str) -> dict[str, object]:
    response = client.get(url, headers={"Referer": "https://www.bilibili.com/"})
    response.raise_for_status()
    html_text = response.text
    initial_match = re.search(r"__INITIAL_STATE__=(\{.*?\});\s*\(function", html_text, re.S)
    state_text = initial_match.group(1) if initial_match else html_text
    return {
        "season_id": _first_regex_int(state_text, (r'"season_id"\s*:\s*(\d+)', r'"seasonId"\s*:\s*(\d+)', r"season_id[^0-9]{0,20}(\d+)")),
        "mid": _first_regex_int(state_text, (r'"owner"\s*:\s*\{[^{}]*"mid"\s*:\s*(\d+)', r'"upData"\s*:\s*\{[^{}]*"mid"\s*:\s*(\d+)', r'"mid"\s*:\s*(\d{5,})')),
    }


def _first_regex_int(text: str, patterns: tuple[str, ...]) -> int | None:
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return _safe_int(match.group(1))
    return None


def _bilibili_episodes_from_text(content: ContentItem) -> list[dict]:
    text = _load_content_full_text(content.mongo_normalized_id) or content.summary or ""
    if "Danh sách tập" not in text:
        return []
    segment = text.split("Danh sách tập", 1)[1]
    segment = segment.split("\n", 1)[0].lstrip(":：").strip()
    if not segment:
        return []
    rows: list[dict] = []
    for index, part in enumerate(segment.split(";"), start=1):
        item = part.strip()
        if not item:
            continue
        match = re.match(r"(?P<episode>\d+)(?:\s*[-~至到]\s*\d+)?\.\s*(?P<title>.+)", item)
        episode_index = _safe_int(match.group("episode")) if match else None
        title = (match.group("title") if match else item).strip()
        if not title:
            continue
        rows.append({
            "episode_index": episode_index or _extract_bilibili_episode_index(title) or index,
            "title": title,
            "url": None,
            "bvid": None,
            "aid": None,
            "cid": None,
            "thumbnail_url": None,
            "duration_seconds": None,
            "content_id": str(content.id),
            "current": _same_bilibili_title(title, content.canonical_title),
            "metadata_only": True,
        })
    return rows


def _bilibili_episodes_from_ugc_season(data: dict, source_metadata: dict, current_url: str) -> list[dict]:
    ugc_season = data.get("ugc_season")
    if not isinstance(ugc_season, dict):
        return []
    rows: list[dict] = []
    for section in ugc_season.get("sections") or []:
        if not isinstance(section, dict) or not isinstance(section.get("episodes"), list):
            continue
        for fallback_index, episode in enumerate(section["episodes"], start=len(rows) + 1):
            if not isinstance(episode, dict):
                continue
            arc = episode.get("arc") if isinstance(episode.get("arc"), dict) else {}
            bvid = str(episode.get("bvid") or arc.get("bvid") or "").strip()
            aid = _safe_int(episode.get("aid") or arc.get("aid"))
            page_index = _safe_int(episode.get("page") or episode.get("index"))
            url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
            if url and page_index and page_index > 1:
                url = f"{url}?p={page_index}"
            title = str(episode.get("title") or arc.get("title") or f"Tập {fallback_index}").strip()
            rows.append({
                "episode_index": page_index or _extract_bilibili_episode_index(title) or fallback_index,
                "title": title,
                "url": url,
                "bvid": bvid or None,
                "aid": aid,
                "cid": _safe_int(episode.get("cid") or arc.get("cid")),
                "thumbnail_url": episode.get("cover") or arc.get("pic") or source_metadata.get("thumbnail_url"),
                "duration_seconds": _safe_int(episode.get("duration") or arc.get("duration")),
                "embed_url": _bilibili_embed_url(bvid or None, url, page_index),
                "current": _same_bilibili_url(url, current_url),
            })
    return rows


def _bilibili_episodes_from_pages(data: dict, source_metadata: dict, current_url: str) -> list[dict]:
    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        return []
    bvid = str(data.get("bvid") or source_metadata.get("bvid") or "").strip()
    aid = _safe_int(data.get("aid") or source_metadata.get("aid"))
    base_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else current_url
    base_title = str(data.get("title") or "").strip()
    rows = []
    for index, page in enumerate(pages, start=1):
        if not isinstance(page, dict):
            continue
        page_index = _safe_int(page.get("page")) or index
        url = f"{base_url}?p={page_index}" if page_index > 1 else base_url
        title = str(page.get("part") or "").strip() or f"{base_title} P{page_index}".strip()
        rows.append({
            "episode_index": page_index,
            "title": title or f"Tập {page_index}",
            "url": url,
            "bvid": bvid or None,
            "aid": aid,
            "cid": _safe_int(page.get("cid")),
            "thumbnail_url": source_metadata.get("thumbnail_url") or data.get("pic"),
            "duration_seconds": _safe_int(page.get("duration")),
            "embed_url": _bilibili_embed_url(bvid or None, url, page_index),
            "current": _same_bilibili_url(url, current_url),
        })
    return rows


def _bilibili_episodes_from_season_archives(data: dict, source_metadata: dict, primary_source: dict) -> list[dict]:
    season_id = _safe_int(source_metadata.get("season_id"))
    owner = data.get("owner") if isinstance(data.get("owner"), dict) else {}
    mid = _safe_int(owner.get("mid"))
    if not season_id or not mid:
        return []

    referer = str(primary_source.get("source_url") or "https://www.bilibili.com/")
    try:
        with httpx.Client(timeout=12, follow_redirects=True, headers={**BILIBILI_HEADERS, "Referer": referer}) as client:
            mixin_key = _bilibili_wbi_mixin_key(client)
            return _bilibili_episodes_from_archive_api(
                client,
                mixin_key,
                mid=mid,
                season_id=season_id,
                source_metadata=source_metadata,
                referer=referer,
            )
    except Exception:
        return []


def _bilibili_episodes_from_archive_api(
    client: httpx.Client,
    mixin_key: str,
    *,
    mid: int,
    season_id: int,
    source_metadata: dict,
    referer: str,
) -> list[dict]:
    rows: list[dict] = []
    page_size = 50
    for page_num in range(1, 11):
        params = _sign_bilibili_wbi_params(
            {
                "mid": mid,
                "season_id": season_id,
                "sort_reverse": "false",
                "page_num": page_num,
                "page_size": page_size,
                "web_location": 333.999,
            },
            mixin_key,
        )
        response = client.get(
            "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list",
            params=params,
            headers={"Referer": referer or "https://www.bilibili.com/"},
        )
        response.raise_for_status()
        payload = response.json()
        result = payload.get("data") if isinstance(payload, dict) else {}
        archives = result.get("archives") if isinstance(result, dict) else None
        if not isinstance(archives, list) or not archives:
            break
        for archive in archives:
            if not isinstance(archive, dict):
                continue
            episode = _bilibili_episode_from_archive(archive, source_metadata, len(rows) + 1)
            if episode:
                rows.append(episode)
        page = result.get("page") if isinstance(result.get("page"), dict) else {}
        total = _safe_int(page.get("total"))
        returned_page_size = _safe_int(page.get("page_size")) or page_size
        if total and page_num * returned_page_size >= total:
            break
    return rows


def _bilibili_episode_from_archive(archive: dict, source_metadata: dict, fallback_index: int) -> dict | None:
    arc = archive.get("arc") if isinstance(archive.get("arc"), dict) else {}
    source = arc or archive
    bvid = str(source.get("bvid") or archive.get("bvid") or "").strip()
    aid = _safe_int(source.get("aid") or archive.get("aid"))
    url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    if not url:
        return None
    title = str(source.get("title") or archive.get("title") or f"Tập {fallback_index}").strip()
    return {
        "episode_index": _extract_bilibili_episode_index(title) or fallback_index,
        "title": title,
        "url": url,
        "bvid": bvid or None,
        "aid": aid,
        "cid": _safe_int(source.get("cid") or archive.get("cid")),
        "thumbnail_url": source.get("pic") or archive.get("pic") or archive.get("cover") or source_metadata.get("thumbnail_url"),
        "duration_seconds": _safe_int(source.get("duration") or archive.get("duration")),
        "embed_url": _bilibili_embed_url(bvid or None, url),
        "current": str(source_metadata.get("bvid") or "") == bvid if bvid else str(source_metadata.get("aid") or "") == str(aid or ""),
    }


BILIBILI_WBI_MIXIN_TABLE = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]


def _bilibili_wbi_mixin_key(client: httpx.Client) -> str:
    response = client.get("https://api.bilibili.com/x/web-interface/nav")
    response.raise_for_status()
    data = response.json().get("data", {})
    wbi_img = data.get("wbi_img") if isinstance(data, dict) else {}
    raw = _bilibili_wbi_key_part(str((wbi_img or {}).get("img_url") or "")) + _bilibili_wbi_key_part(str((wbi_img or {}).get("sub_url") or ""))
    if len(raw) < 64:
        raise RuntimeError("Bilibili WBI keys are unavailable")
    return "".join(raw[index] for index in BILIBILI_WBI_MIXIN_TABLE)[:32]


def _bilibili_wbi_key_part(value: str) -> str:
    return urlparse(value).path.rsplit("/", 1)[-1].split(".", 1)[0]


def _sign_bilibili_wbi_params(params: dict[str, object], mixin_key: str) -> dict[str, object]:
    signed: dict[str, object] = {**params, "wts": int(time.time())}
    filtered = {key: re.sub(r"[!'()*]", "", str(value)) for key, value in signed.items()}
    query = "&".join(f"{quote_plus(key)}={quote_plus(filtered[key])}" for key in sorted(filtered))
    filtered["w_rid"] = hashlib.md5((query + mixin_key).encode("utf-8")).hexdigest()
    return filtered


def _bilibili_embed_url(bvid: str | None, url: str, page: int | None = None) -> str | None:
    if not bvid:
        match = re.search(r"/video/(BV[0-9A-Za-z]+)", str(url or ""))
        bvid = match.group(1) if match else None
    if not bvid:
        return None
    page_part = f"&p={page}" if page and page > 1 else ""
    return f"https://player.bilibili.com/player.html?bvid={bvid}{page_part}&autoplay=0"


def _same_bilibili_url(left: str, right: str) -> bool:
    def clean(value: str) -> str:
        return str(value or "").split("#", 1)[0].rstrip("/")
    return bool(clean(left) and clean(left) == clean(right))


def _same_bilibili_title(left: str, right: str) -> bool:
    return re.sub(r"\s+", "", str(left or "")) == re.sub(r"\s+", "", str(right or ""))


def _extract_bilibili_episode_index(value: object) -> int | None:
    text = str(value or "")
    match = re.search(r"第\s*(\d+)(?:\s*[-~至到]\s*\d+)?\s*[集话話]", text)
    if match:
        return _safe_int(match.group(1))
    match = re.search(r"\b(?:ep|episode|tập|p)\s*(\d+)\b", text, re.IGNORECASE)
    return _safe_int(match.group(1)) if match else None


def _queue_bilibili_ocr_for_content(
    db: Session,
    content: ContentItem,
    user: User,
    episode_indices: list[int] | None = None,
    workflow: MediaWorkflow | None = None,
) -> dict:
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources and isinstance(sources[0], dict) else {}
    if str(primary_source.get("source_type") or "").upper() != "BILIBILI":
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ đưa Bilibili vào hàng đợi OCR")

    source_metadata = _source_metadata(primary_source)
    episodes = _bilibili_episodes_for_queue(content, source_metadata, primary_source)
    requested_indices = {int(value) for value in (episode_indices or []) if int(value) > 0}
    if requested_indices:
        episodes = [
            episode
            for index, episode in enumerate(episodes, start=1)
            if (_safe_int(episode.get("episode_index")) or index) in requested_indices
        ]
    if not episodes:
        raise HTTPException(status_code=400, detail="Video Bilibili chưa có tập phù hợp để OCR")

    created = 0
    reused = 0
    task_ids: list[str] = []
    reference_id = workflow.id if workflow else content.id
    reference_type = "media_workflow" if workflow else "content_item"
    for index, episode in enumerate(episodes, start=1):
        episode_index = _safe_int(episode.get("episode_index")) or index
        episode_url = str(episode.get("url") or content.canonical_url or primary_source.get("source_url") or "")
        if episode.get("metadata_only") and not episode.get("url"):
            reused += 1
            continue
        idempotency_key = f"bilibili-ocr:{reference_id}:{episode_index}:{episode.get('bvid') or episode_url}"
        existing = (
            db.query(KafkaTask)
            .filter(KafkaTask.idempotency_key == idempotency_key)
            .order_by(KafkaTask.created_at.desc())
            .first()
        )
        if existing:
            reused += 1
            task_ids.append(str(existing.id))
            continue
        task = KafkaTask(
            reference_id=reference_id,
            reference_type=reference_type,
            task_type="BILIBILI_OCR_EPISODE",
            status="PENDING",
            current_stage="QUEUED_OCR",
            progress_percent=0,
            idempotency_key=idempotency_key,
            payload_jsonb={
                "content_id": str(content.id),
                "source_type": "BILIBILI",
                "episode_index": episode_index,
                "title": episode.get("title") or content.canonical_title,
                "url": episode_url,
                "bvid": episode.get("bvid"),
                "aid": episode.get("aid"),
                "cid": episode.get("cid"),
                "thumbnail_url": episode.get("thumbnail_url") or source_metadata.get("thumbnail_url"),
                "queued_by": str(user.id),
                "workflow_id": str(workflow.id) if workflow else None,
            },
        )
        db.add(task)
        db.flush()
        created += 1
        task_ids.append(str(task.id))

    metadata = dict(source_metadata)
    metadata["ocr_queue"] = {
        "status": "QUEUED",
        "task_count": len(task_ids),
        "created_count": created,
        "reused_count": reused,
        "queued_at": datetime.now(timezone.utc).isoformat(),
        "episode_indices": sorted(requested_indices) if requested_indices else None,
    }
    primary_source["metadata_json"] = metadata
    content.sources_jsonb = [primary_source, *sources[1:]]
    db.add(content)
    if workflow:
        workflow.current_stage = "QUEUED_OCR"
        workflow.progress_percent = 10 if task_ids else workflow.progress_percent
        workflow.status = "PROCESSING" if task_ids else workflow.status
        workflow.metadata_json = {
            **(workflow.metadata_json if isinstance(workflow.metadata_json, dict) else {}),
            "ocr_queue": metadata["ocr_queue"],
        }
        db.add(workflow)
    return {"content_id": str(content.id), "queued": created, "reused": reused, "task_ids": task_ids}


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


def _safe_int(value) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
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


def _is_vnexpress_article(source_type: str | None, content: ContentItem) -> bool:
    return (source_type or "").upper() == "VNEXPRESS" and (content.content_type or "").upper() == "ARTICLE"


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
    db: Session = Depends(get_db)
):
    """
    Manually create content item. 
    Creators can add to their PRIVATE scope, admins can add to GLOBAL or PRIVATE.
    """
    import hashlib
    from datetime import datetime, timezone
    
    # Validate content_scope permission
    requested_scope = payload.content_scope.upper()
    if requested_scope == "GLOBAL" and not user.is_system_admin:
        raise HTTPException(
            status_code=403, 
            detail="Only system admins can create GLOBAL content"
        )
    
    # Build source metadata
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
    
    # Build media_jsonb from media_urls and media_items
    media_jsonb = []
    
    # Add simple media URLs
    for idx, url in enumerate(payload.media_urls):
        media_jsonb.append({
            "media_type": "IMAGE",  # Default assumption
            "source_url": url,
            "order": idx,
        })
    
    # Add detailed media items
    for idx, media in enumerate(payload.media_items):
        media_jsonb.append({
            "media_type": media.type.upper(),
            "source_url": media.url,
            "thumbnail_url": media.thumbnail_url,
            "caption": media.caption,
            "alt": media.alt,
            "order": len(payload.media_urls) + idx,
        })
    
    # Build sources_jsonb
    sources_jsonb = [{
        "source_type": payload.source_type.upper(),
        "source_url": payload.canonical_url,
        "source_author": payload.source_author,
        "source_published_at": payload.published_at.isoformat() if payload.published_at else None,
        "metadata_json": source_metadata,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }]
    
    # Generate content hash for deduplication
    hash_input = f"{payload.canonical_title}|{payload.canonical_url or ''}".lower()
    content_hash = hashlib.sha256(hash_input.encode('utf-8')).hexdigest()
    
    # Check for duplicates
    duplicate_query = db.query(ContentItem).filter(ContentItem.content_hash == content_hash)
    if requested_scope == "PRIVATE":
        duplicate_query = duplicate_query.filter(ContentItem.id.in_(_private_content_ids_for_user(user.id)))
    existing = duplicate_query.first()
    
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Content with similar title/URL already exists (ID: {existing.id})"
        )
    
    # Calculate initial quality score (manual content gets a baseline score)
    quality_score = 75.0  # Baseline for manual content
    if payload.full_text and len(payload.full_text) > 200:
        quality_score += 5.0
    if payload.media_urls or payload.media_items:
        quality_score += 10.0
    if payload.tags and len(payload.tags) >= 2:
        quality_score += 5.0
    quality_score = min(quality_score, 95.0)  # Cap at 95
    
    # Create ContentItem
    content = ContentItem(
        content_type=payload.content_type.upper(),
        canonical_title=payload.canonical_title,
        normalized_title=payload.canonical_title,  # Same as canonical for manual input
        summary=payload.summary,
        language=payload.language,
        content_scope=requested_scope,
        created_by_type="MANUAL",
        status="AVAILABLE",  # Manual content is immediately available
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
    
    # Store full_text in MongoDB if provided
    if payload.full_text:
        try:
            from bson import ObjectId
            from common.db.mongo import processed_documents
            
            normalized_doc = {
                "content": payload.full_text,
                "title": payload.canonical_title,
                "description": payload.summary or "",
                "source": "manual_input",
                "created_by": str(user.id),
            }
            
            proc_coll = processed_documents()
            result = proc_coll.insert_one({"normalized": normalized_doc})
            content.mongo_normalized_id = str(result.inserted_id)
        except Exception as e:
            # Log error but don't fail the request
            print(f"Warning: Failed to store full_text in MongoDB: {e}")
    
    db.commit()
    db.refresh(content)
    
    return _content_response(content)


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
