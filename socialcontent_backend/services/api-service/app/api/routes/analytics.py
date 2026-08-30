from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.services.social_profiles import SocialProfileService
from common.db.models import SocialPost, SocialPostMetric, SocialProfile, SocialProfileSnapshot, User
from common.db.session import get_db

router = APIRouter()


def _utc_range(start_date: date | None, end_date: date | None) -> tuple[datetime, datetime]:
    today = datetime.now(timezone.utc).date()
    start = start_date or (today - timedelta(days=6))
    end = end_date or today
    if end < start:
        start, end = end, start
    return (
        datetime.combine(start, time.min, tzinfo=timezone.utc),
        datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc),
    )


def _serialize_period(start: datetime, end_exclusive: datetime) -> dict:
    return {
        "start_date": start.date().isoformat(),
        "end_date": (end_exclusive - timedelta(days=1)).date().isoformat(),
    }


def _metric_change(current: int | float, previous: int | float) -> float | None:
    if previous == 0:
        return None if current == 0 else 100.0
    return round(((current - previous) / previous) * 100, 1)


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _owned_profile(db: Session, service: SocialProfileService, profile_id: uuid.UUID, user: User) -> SocialProfile:
    return service.get_owned_profile(db, profile_id, user)


def _owned_post(db: Session, service: SocialProfileService, post_id: uuid.UUID, user: User) -> SocialPost:
    post = (
        db.query(SocialPost)
        .join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
        .filter(SocialPost.id == post_id)
        .first()
    )
    if post and not service.is_system_user(user) and post.profile.user_id != user.id:
        post = None
    if not post:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy bài đăng")
    return post


def _latest_metrics_by_post(db: Session, post_ids: list[uuid.UUID]) -> dict[uuid.UUID, SocialPostMetric]:
    latest_by_post: dict[uuid.UUID, SocialPostMetric] = {}
    if not post_ids:
        return latest_by_post
    metrics = (
        db.query(SocialPostMetric)
        .filter(SocialPostMetric.post_id.in_(post_ids))
        .order_by(SocialPostMetric.post_id.asc(), SocialPostMetric.captured_at.asc())
        .all()
    )
    for metric in metrics:
        latest_by_post[metric.post_id] = metric
    return latest_by_post


@router.get("/account/overview")
def account_overview(
    profile_id: uuid.UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    compare_previous: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = _owned_profile(db, service, profile_id, current_user)
    start, end = _utc_range(start_date, end_date)
    duration = end - start
    previous_start = start - duration
    previous_end = start

    posts = (
        db.query(SocialPost)
        .filter(SocialPost.profile_id == profile.id, SocialPost.published_at >= start, SocialPost.published_at < end)
        .all()
    )
    post_ids = [post.id for post in posts]
    latest_metrics = _latest_metrics_by_post(db, post_ids)

    previous_posts = (
        db.query(SocialPost)
        .filter(SocialPost.profile_id == profile.id, SocialPost.published_at >= previous_start, SocialPost.published_at < previous_end)
        .all()
        if compare_previous
        else []
    )
    previous_metrics = _latest_metrics_by_post(db, [post.id for post in previous_posts])

    current_totals = {
        "views": sum(metric.views for metric in latest_metrics.values()),
        "likes": sum(metric.likes for metric in latest_metrics.values()),
        "comments": sum(metric.comments for metric in latest_metrics.values()),
        "shares": sum(metric.shares for metric in latest_metrics.values()),
        "saves": 0,
        "videos_count": len(posts),
    }
    previous_totals = {
        "views": sum(metric.views for metric in previous_metrics.values()),
        "likes": sum(metric.likes for metric in previous_metrics.values()),
        "comments": sum(metric.comments for metric in previous_metrics.values()),
        "shares": sum(metric.shares for metric in previous_metrics.values()),
        "saves": 0,
        "videos_count": len(previous_posts),
    }

    return {
        "profile": service.serialize_profile(profile),
        "profile_id": str(profile.id),
        "period": _serialize_period(start, end),
        "metrics": {
            key: {
                "value": value,
                "change_pct": _metric_change(value, previous_totals[key]) if key != "videos_count" else None,
                "change_count": value - previous_totals[key] if key == "videos_count" else None,
            }
            for key, value in current_totals.items()
        },
    }


@router.get("/account/charts")
def account_charts(
    profile_id: uuid.UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    granularity: str = Query(default="day"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = _owned_profile(db, service, profile_id, current_user)
    start, end = _utc_range(start_date, end_date)

    posts = (
        db.query(SocialPost)
        .filter(SocialPost.profile_id == profile.id, SocialPost.published_at >= start, SocialPost.published_at < end)
        .order_by(SocialPost.published_at.asc())
        .all()
    )
    latest_metrics = _latest_metrics_by_post(db, [post.id for post in posts])
    by_day: dict[str, dict] = {}
    cursor = start.date()
    while cursor < end.date():
        by_day[cursor.isoformat()] = {"date": cursor.isoformat(), "views": 0, "avg_views": 0, "videos": 0}
        cursor += timedelta(days=1)

    for post in posts:
        key = post.published_at.date().isoformat()
        metric = latest_metrics.get(post.id)
        if key not in by_day:
            by_day[key] = {"date": key, "views": 0, "avg_views": 0, "videos": 0}
        by_day[key]["views"] += metric.views if metric else 0
        by_day[key]["videos"] += 1

    for item in by_day.values():
        item["avg_views"] = round(item["views"] / item["videos"]) if item["videos"] else 0

    snapshots = (
        db.query(SocialProfileSnapshot)
        .filter(SocialProfileSnapshot.profile_id == profile.id, SocialProfileSnapshot.captured_at >= start, SocialProfileSnapshot.captured_at < end)
        .order_by(SocialProfileSnapshot.captured_at.asc())
        .all()
    )

    return {
        "profile_id": str(profile.id),
        "granularity": granularity,
        "views_by_day": list(by_day.values()),
        "account_snapshots": [
            {
                "date": snapshot.captured_at.date().isoformat(),
                "followers": snapshot.follower_count,
                "following": snapshot.following_count,
                "likes": snapshot.likes_count,
                "videos": snapshot.video_count,
            }
            for snapshot in snapshots
        ],
        "content_mix": [
            {"name": "Video ngắn", "value": len(posts), "color": "#2556ea"},
            {"name": "Series", "value": 0, "color": "#16a34a"},
            {"name": "Video dài", "value": 0, "color": "#f59e0b"},
            {"name": "Livestream", "value": 0, "color": "#db2777"},
        ],
    }


@router.get("/account/top-topics")
def account_top_topics(
    profile_id: uuid.UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = Query(default=8, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = _owned_profile(db, service, profile_id, current_user)
    start, end = _utc_range(start_date, end_date)
    posts = (
        db.query(SocialPost)
        .filter(SocialPost.profile_id == profile.id, SocialPost.published_at >= start, SocialPost.published_at < end)
        .all()
    )
    latest_metrics = _latest_metrics_by_post(db, [post.id for post in posts])
    topics: dict[str, dict] = {}
    for post in posts:
        raw = post.caption or post.title or "Chưa phân loại"
        tags = [part.strip("#.,;:!?()[]{}").lower() for part in raw.split() if part.startswith("#")]
        if not tags:
            tags = [post.title.split()[0].strip("#.,;:!?()[]{}").lower() if post.title else "chung"]
        metric = latest_metrics.get(post.id)
        views = metric.views if metric else 0
        engagement = ((metric.likes + metric.comments + metric.shares) / views * 100) if metric and views else 0
        for tag in tags[:4]:
            if not tag:
                continue
            item = topics.setdefault(tag, {"topic": tag, "views": 0, "posts": 0, "engagement_total": 0.0})
            item["views"] += views
            item["posts"] += 1
            item["engagement_total"] += engagement

    rows = []
    for item in topics.values():
        rows.append({
            "topic": item["topic"],
            "views": item["views"],
            "avg_watch_pct": None,
            "avg_engagement_pct": round(item["engagement_total"] / item["posts"], 1) if item["posts"] else 0,
            "posts": item["posts"],
        })
    return {"profile_id": str(profile.id), "items": sorted(rows, key=lambda row: row["views"], reverse=True)[:limit]}


@router.get("/post/{post_id}/overview")
def post_overview(post_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    post = _owned_post(db, service, post_id, current_user)
    metrics = sorted(post.metrics, key=lambda metric: metric.captured_at)
    latest = metrics[-1] if metrics else None
    views = latest.views if latest else 0
    engagement = ((latest.likes + latest.comments + latest.shares) / views * 100) if latest and views else 0
    return {
        "post": {
            **service.serialize_post(post),
            "profile": service.serialize_profile(post.profile),
            "tiktok_embed_url": f"https://www.tiktok.com/player/v1/{post.platform_post_id}?controls=1&description=1&music_info=1" if post.platform_post_id else None,
        },
        "metrics": {
            "views": {"value": views, "change_pct": None},
            "likes": {"value": latest.likes if latest else 0, "change_pct": None},
            "comments": {"value": latest.comments if latest else 0, "change_pct": None},
            "shares": {"value": latest.shares if latest else 0, "change_pct": None},
            "saves": {"value": 0, "change_pct": None},
            "engagement_rate": {"value": round(engagement, 1), "change_pct": None},
            "avg_watch_seconds": {"value": None, "change_pct": None},
            "completion_rate": {"value": None, "change_pct": None},
        },
    }


@router.get("/post/{post_id}/charts")
def post_charts(post_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    post = _owned_post(db, service, post_id, current_user)
    metrics = sorted(post.metrics, key=lambda metric: metric.captured_at)
    timeline = [
        {
            "time": metric.captured_at.isoformat(),
            "hours_since_publish": round((_aware_utc(metric.captured_at) - _aware_utc(post.published_at)).total_seconds() / 3600, 1),
            "views": metric.views,
            "likes": metric.likes,
            "comments": metric.comments,
            "shares": metric.shares,
        }
        for metric in metrics
    ]
    return {
        "post_id": str(post.id),
        "retention_curve": [],
        "traffic_sources": [],
        "engagement_timeline": timeline,
        "data_availability": {
            "retention_curve": False,
            "traffic_sources": False,
            "engagement_timeline": bool(timeline),
        },
    }
