import json
import os
from datetime import datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from backend.user_service.app.core.database_mongo import articles_col
from backend.user_service.app.models.user import (
    ArticleProfileMatch,
    PublishingQueueItem,
    SocialProfile,
    SocialProfileStrategy,
)
from backend.user_service.app.services.ai_rewriter import get_client
from backend.user_service.app.services.publisher_gateway import request_publish


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip().lower() for item in value.split(",") if item.strip()]


def _article_text(article: dict[str, Any]) -> str:
    content = article.get("content") or ""
    if isinstance(content, list):
        content = "\n".join(str(item) for item in content)
    return f"{article.get('title', '')}\n{content}"


def _default_strategy(profile: SocialProfile) -> SocialProfileStrategy:
    return SocialProfileStrategy(
        user_id=profile.user_id,
        profile_id=profile.id,
        content_topics="tin nóng, đời sống, xã hội, công nghệ",
        avoid_topics="bạo lực, tai nạn nghiêm trọng, nội dung nhạy cảm",
        tone="ngắn gọn, tự nhiên, dễ hiểu",
        target_audience="người xem phổ thông",
        schedule_enabled=True,
        schedule_days="0,1,2,3,4,5,6",
        schedule_times="08:30,20:30",
        schedule_timezone=os.getenv("APP_TIMEZONE", "Asia/Bangkok"),
        approval_mode="manual",
        risk_level="medium",
        min_score=70.0,
        require_video=profile.platform == "tiktok",
        auto_queue_enabled=True,
        auto_publish_enabled=False,
    )


def get_or_create_strategy(db: Session, profile: SocialProfile) -> SocialProfileStrategy:
    if profile.strategy:
        return profile.strategy
    strategy = _default_strategy(profile)
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


def serialize_strategy(strategy: SocialProfileStrategy) -> dict[str, Any]:
    return {
        "id": strategy.id,
        "user_id": strategy.user_id,
        "profile_id": strategy.profile_id,
        "content_topics": strategy.content_topics,
        "avoid_topics": strategy.avoid_topics,
        "tone": strategy.tone,
        "target_audience": strategy.target_audience,
        "post_frequency_per_day": strategy.post_frequency_per_day,
        "active_hours": strategy.active_hours,
        "schedule_enabled": strategy.schedule_enabled,
        "schedule_days": strategy.schedule_days,
        "schedule_times": strategy.schedule_times,
        "schedule_timezone": strategy.schedule_timezone,
        "approval_mode": strategy.approval_mode,
        "risk_level": strategy.risk_level,
        "min_score": strategy.min_score,
        "require_video": strategy.require_video,
        "auto_queue_enabled": strategy.auto_queue_enabled,
        "auto_publish_enabled": strategy.auto_publish_enabled,
        "created_at": strategy.created_at,
        "updated_at": strategy.updated_at,
    }


def serialize_match(match: ArticleProfileMatch) -> dict[str, Any]:
    return {
        "id": match.id,
        "user_id": match.user_id,
        "profile_id": match.profile_id,
        "article_link": match.article_link,
        "article_title": match.article_title,
        "score": match.score,
        "decision": match.decision,
        "reason": match.reason,
        "suggested_platform": match.suggested_platform,
        "matched_topics": _split_csv(match.matched_topics),
        "created_at": match.created_at,
    }


def serialize_queue_item(item: PublishingQueueItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "profile_id": item.profile_id,
        "profile_name": item.profile.profile_name if item.profile else None,
        "article_link": item.article_link,
        "article_title": item.article_title,
        "platform": item.platform,
        "generated_content": item.generated_content,
        "ai_reason": item.ai_reason,
        "status": item.status,
        "scheduled_at": item.scheduled_at,
        "published_at": item.published_at,
        "error": item.error,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _fallback_decision(article: dict[str, Any], profile: SocialProfile, strategy: SocialProfileStrategy) -> dict[str, Any]:
    text = _article_text(article).lower()
    topics = _split_csv(strategy.content_topics)
    avoid_topics = _split_csv(strategy.avoid_topics)
    matched_topics = [topic for topic in topics if topic in text]
    avoided = [topic for topic in avoid_topics if topic in text]
    has_video = bool(article.get("videos"))

    score = 45.0
    score += min(len(matched_topics) * 20.0, 40.0)
    if has_video:
        score += 15.0
    if strategy.require_video and not has_video:
        score -= 35.0
    if avoided:
        score -= 30.0
    score = max(0.0, min(score, 100.0))

    decision = "queue" if score >= float(strategy.min_score or 70.0) and not avoided else "skip"
    return {
        "score": score,
        "decision": decision,
        "reason": (
            f"Khớp chủ đề: {', '.join(matched_topics) or 'chưa rõ'}. "
            f"{'Có video.' if has_video else 'Không có video.'} "
            f"{'Tránh vì có: ' + ', '.join(avoided) if avoided else ''}"
        ).strip(),
        "suggested_platform": profile.platform,
        "matched_topics": matched_topics,
    }


async def decide_article_for_profile(
    article: dict[str, Any],
    profile: SocialProfile,
    strategy: SocialProfileStrategy,
) -> dict[str, Any]:
    content = _article_text(article)[:3500]
    fallback = _fallback_decision(article, profile, strategy)
    try:
        response = await get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Bạn là bộ máy chọn nội dung social media. "
                        "Trả về JSON hợp lệ với score 0-100, decision là queue hoặc skip, "
                        "reason ngắn, suggested_platform, matched_topics là mảng string. "
                        "Không bịa dữ kiện, tránh nội dung rủi ro theo cấu hình."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "profile": {
                                "platform": profile.platform,
                                "profile_name": profile.profile_name,
                                "username": profile.username,
                            },
                            "strategy": serialize_strategy(strategy),
                            "article": {
                                "title": article.get("title", ""),
                                "link": article.get("link", ""),
                                "has_video": bool(article.get("videos")),
                                "content": content,
                            },
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            max_tokens=400,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        data = json.loads(response.choices[0].message.content or "{}")
        score = float(data.get("score", fallback["score"]))
        decision = "queue" if data.get("decision") == "queue" and score >= float(strategy.min_score or 70.0) else "skip"
        if strategy.require_video and not article.get("videos"):
            decision = "skip"
        return {
            "score": max(0.0, min(score, 100.0)),
            "decision": decision,
            "reason": data.get("reason") or fallback["reason"],
            "suggested_platform": data.get("suggested_platform") or profile.platform,
            "matched_topics": data.get("matched_topics") or fallback["matched_topics"],
        }
    except Exception as exc:
        print(f"AI decision fallback for profile {profile.id}: {exc}")
        return fallback


async def generate_content_for_profile(
    article: dict[str, Any],
    profile: SocialProfile,
    strategy: SocialProfileStrategy,
) -> str:
    fallback = f"{article.get('title', '')}\n\n{_article_text(article)[:700]}\n\nNguồn: {article.get('link', '')}"
    try:
        response = await get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Viết caption social theo đúng chiến lược tài khoản. "
                        "Không bịa thêm dữ kiện, không copy nguyên văn dài, giữ nguồn nếu phù hợp."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "platform": profile.platform,
                            "profile_name": profile.profile_name,
                            "tone": strategy.tone,
                            "target_audience": strategy.target_audience,
                            "topics": strategy.content_topics,
                            "article": {
                                "title": article.get("title", ""),
                                "link": article.get("link", ""),
                                "content": _article_text(article)[:3000],
                            },
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            max_tokens=700,
            temperature=0.7,
        )
        return response.choices[0].message.content or fallback
    except Exception as exc:
        print(f"AI content fallback for profile {profile.id}: {exc}")
        return fallback


def _parse_schedule_days(value: str | None) -> set[int]:
    days: set[int] = set()
    for item in (value or "").split(","):
        item = item.strip()
        if not item:
            continue
        try:
            day = int(item)
        except ValueError:
            continue
        if 0 <= day <= 6:
            days.add(day)
    return days or {0, 1, 2, 3, 4, 5, 6}


def _parse_schedule_times(value: str | None) -> list[time]:
    times: list[time] = []
    for item in (value or "").split(","):
        item = item.strip()
        if not item:
            continue
        try:
            times.append(time.fromisoformat(item))
        except ValueError:
            continue
    return sorted(times) or [time(hour=8, minute=30)]


def _strategy_timezone(strategy: SocialProfileStrategy) -> ZoneInfo:
    timezone_name = strategy.schedule_timezone or os.getenv("APP_TIMEZONE", "Asia/Bangkok")
    try:
        return ZoneInfo(timezone_name)
    except Exception:
        return ZoneInfo("Asia/Bangkok")


def _next_schedule_slot_after(after_utc: datetime, strategy: SocialProfileStrategy) -> datetime:
    local_timezone = _strategy_timezone(strategy)
    after_local = after_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(local_timezone)
    days = _parse_schedule_days(strategy.schedule_days)
    times = _parse_schedule_times(strategy.schedule_times)

    for offset in range(0, 15):
        candidate_date = (after_local + timedelta(days=offset)).date()
        if candidate_date.weekday() not in days:
            continue
        for slot_time in times:
            candidate_local = datetime.combine(candidate_date, slot_time, tzinfo=local_timezone)
            if candidate_local > after_local:
                return candidate_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)

    fallback_local = after_local + timedelta(days=1)
    return fallback_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def _next_schedule_time(db: Session, profile: SocialProfile, strategy: SocialProfileStrategy) -> datetime:
    latest = (
        db.query(PublishingQueueItem)
        .filter(
            PublishingQueueItem.profile_id == profile.id,
            PublishingQueueItem.status.in_(["queued", "approved"]),
        )
        .order_by(PublishingQueueItem.scheduled_at.desc())
        .first()
    )
    now = datetime.utcnow()
    spacing_hours = 24 / max(int(strategy.post_frequency_per_day or 1), 1)
    base = latest.scheduled_at if latest and latest.scheduled_at else now
    after = max(now, base + timedelta(hours=spacing_hours))
    if not strategy.schedule_enabled:
        return after
    return _next_schedule_slot_after(after, strategy)


async def evaluate_article_for_all_profiles(db: Session, article: dict[str, Any]) -> list[PublishingQueueItem]:
    profiles = db.query(SocialProfile).filter(SocialProfile.status == "active").all()
    queued_items: list[PublishingQueueItem] = []

    for profile in profiles:
        strategy = get_or_create_strategy(db, profile)
        if not strategy.auto_queue_enabled:
            continue

        existing = (
            db.query(ArticleProfileMatch)
            .filter(
                ArticleProfileMatch.profile_id == profile.id,
                ArticleProfileMatch.article_link == article.get("link", ""),
            )
            .first()
        )
        if existing:
            continue

        decision = await decide_article_for_profile(article, profile, strategy)
        match = ArticleProfileMatch(
            user_id=profile.user_id,
            profile_id=profile.id,
            article_link=article.get("link", ""),
            article_title=article.get("title", ""),
            score=decision["score"],
            decision=decision["decision"],
            reason=decision["reason"],
            suggested_platform=decision["suggested_platform"],
            matched_topics=", ".join(decision.get("matched_topics", [])),
        )
        db.add(match)
        db.commit()
        db.refresh(match)

        if match.decision != "queue":
            continue

        existing_queue = (
            db.query(PublishingQueueItem)
            .filter(
                PublishingQueueItem.profile_id == profile.id,
                PublishingQueueItem.article_link == article.get("link", ""),
                PublishingQueueItem.status.in_(["queued", "approved", "published"]),
            )
            .first()
        )
        if existing_queue:
            continue

        generated = await generate_content_for_profile(article, profile, strategy)
        queue_item = PublishingQueueItem(
            user_id=profile.user_id,
            profile_id=profile.id,
            match_id=match.id,
            article_link=match.article_link,
            article_title=match.article_title,
            platform=profile.platform,
            generated_content=generated,
            ai_reason=match.reason,
            status="queued" if strategy.approval_mode == "auto" else "needs_approval",
            scheduled_at=_next_schedule_time(db, profile, strategy),
        )
        db.add(queue_item)
        db.commit()
        db.refresh(queue_item)
        queued_items.append(queue_item)

    return queued_items


def _is_in_active_hours(strategy: SocialProfileStrategy, now: datetime) -> bool:
    ranges = [item.strip() for item in (strategy.active_hours or "").split(",") if item.strip()]
    if not ranges:
        return True
    local_timezone = _strategy_timezone(strategy)
    local_now = now.replace(tzinfo=ZoneInfo("UTC")).astimezone(local_timezone)
    current = local_now.time()
    for item in ranges:
        try:
            start_raw, end_raw = item.split("-", 1)
            start = time.fromisoformat(start_raw.strip())
            end = time.fromisoformat(end_raw.strip())
        except ValueError:
            continue
        if start <= end and start <= current <= end:
            return True
        if start > end and (current >= start or current <= end):
            return True
    return False


async def process_due_queue(db: Session, limit: int = 5) -> list[PublishingQueueItem]:
    now = datetime.utcnow()
    items = (
        db.query(PublishingQueueItem)
        .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
        .filter(
            PublishingQueueItem.status.in_(["queued", "approved"]),
            PublishingQueueItem.scheduled_at <= now,
            SocialProfile.status == "active",
        )
        .order_by(PublishingQueueItem.scheduled_at.asc())
        .limit(limit)
        .all()
    )
    processed: list[PublishingQueueItem] = []

    for item in items:
        strategy = get_or_create_strategy(db, item.profile)
        if item.status == "queued" and (not strategy.auto_publish_enabled or strategy.approval_mode != "auto"):
            item.status = "needs_approval"
            db.commit()
            continue
        if not _is_in_active_hours(strategy, now):
            continue

        item.status = "publishing"
        item.error = None
        db.commit()
        request_publish(
            user_id=item.user_id,
            queue_item_id=item.id,
            profile_id=item.profile_id,
            article_link=item.article_link,
            platform=item.platform,
            content_override=item.generated_content,
        )
        processed.append(item)

    return processed
