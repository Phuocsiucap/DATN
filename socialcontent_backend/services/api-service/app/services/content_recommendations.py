from __future__ import annotations

import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from common.db.models import ContentItem, MediaWorkflow, ProfileContentLink, SocialProfile, SocialProfileStrategy, User
from common.planning.embedding_matcher import StrategyEmbeddingMatcher


def profile_matches_for_content(db: Session, content: ContentItem, source_metadata: dict, user: User) -> list[dict]:
    profiles = (
        db.query(SocialProfile)
        .filter(
            SocialProfile.user_id == user.id,
            func.lower(SocialProfile.status) != "deleted",
        )
        .order_by(SocialProfile.created_at.desc())
        .options(joinedload(SocialProfile.strategy))
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


def content_selection_summary(content: ContentItem, source_metadata: dict) -> str:
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
