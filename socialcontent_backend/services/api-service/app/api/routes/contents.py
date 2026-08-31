import html
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import JSONB

from common.db.models import ContentItem, ProfileContentLink, SocialProfile, SocialProfileStrategy, Story, User, KafkaTask
from common.db.session import get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import CONTENT_DEDUPLICATION_REQUESTED, CONTENT_NORMALIZATION_REQUESTED
from common.db.media_workflows import _load_content_full_text
from common.planning.embedding_matcher import StrategyEmbeddingMatcher
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


@router.get("/final-view")
def final_content_view(
    crawl_job_id: uuid.UUID | None = None,
    content_scope: str | None = None,
    view: str | None = None,
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
    profiles = db.query(SocialProfile).filter(SocialProfile.user_id == user.id).order_by(SocialProfile.created_at.desc()).all()
    links = (
        db.query(ProfileContentLink)
        .filter(ProfileContentLink.user_id == user.id, ProfileContentLink.content_id == content.id)
        .all()
    )
    link_by_profile = {link.profile_id: link for link in links}
    matcher = StrategyEmbeddingMatcher()
    matcher.ensure_content_embedding(db, content, preferred_model_name=matcher.model_name())
    matches = []
    for profile in profiles:
        strategy = profile.strategy
        link = link_by_profile.get(profile.id)
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
        reason_parts.append("Không được đề xuất sau bước đánh giá AI.")
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
    return f"AI giữ bài vì điểm chất lượng {score}/100 và tín hiệu chủ đề từ {topic} đủ để đưa vào bước phân tích tài khoản."


def _metadata_terms(metadata: dict, key: str) -> list[str]:
    value = metadata.get(key)
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return _split_terms(value)
    return []


def _content_match_text(content: ContentItem, source_metadata: dict) -> str:
    tags = source_metadata.get("tags") if isinstance(source_metadata.get("tags"), list) else []
    values = [
        content.canonical_title,
        content.normalized_title,
        content.summary,
        source_metadata.get("category"),
        " ".join(str(tag) for tag in tags),
    ]
    return " ".join(str(value or "") for value in values).lower()


def _split_terms(value: str | None) -> list[str]:
    return [part.strip() for part in str(value or "").replace("\n", ",").split(",") if part.strip()]


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
