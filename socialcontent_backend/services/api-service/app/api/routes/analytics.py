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


def _utc_range(start_date: date | None, end_date: date | None) -> tuple[datetime | None, datetime | None]:
    if start_date and end_date and end_date < start_date:
        start_date, end_date = end_date, start_date
    start = datetime.combine(start_date, time.min, tzinfo=timezone.utc) if start_date else None
    end = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=timezone.utc) if end_date else None
    return start, end


def _serialize_period(start: datetime | None, end_exclusive: datetime | None) -> dict:
    return {
        "start_date": start.date().isoformat() if start else None,
        "end_date": (end_exclusive - timedelta(days=1)).date().isoformat() if end_exclusive else None,
    }


def _apply_period(query, column, start: datetime | None, end: datetime | None):
    if start is not None:
        query = query.filter(column >= start)
    if end is not None:
        query = query.filter(column < end)
    return query


def _metric_change(current: int | float, previous: int | float) -> float | None:
    if previous == 0:
        return None if current == 0 else 100.0
    return round(((current - previous) / previous) * 100, 1)


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _empty_daily_views(date_key: str) -> dict:
    return {"date": date_key, "views": 0, "avg_views": 0, "videos": 0}


def _daily_view_deltas(
    db: Session,
    profile_id: uuid.UUID,
    start: datetime | None,
    end: datetime | None,
) -> list[dict]:
    by_day: dict[str, dict] = {}
    if start is not None and end is not None:
        cursor = start.date()
        while cursor < end.date():
            key = cursor.isoformat()
            by_day[key] = _empty_daily_views(key)
            cursor += timedelta(days=1)

    metrics_query = (
        db.query(SocialPostMetric)
        .join(SocialPost, SocialPost.id == SocialPostMetric.post_id)
        .filter(SocialPost.profile_id == profile_id)
    )
    if end is not None:
        metrics_query = metrics_query.filter(SocialPostMetric.captured_at < end)
    metrics = metrics_query.order_by(SocialPostMetric.post_id.asc(), SocialPostMetric.captured_at.asc()).all()

    latest_by_post: dict[uuid.UUID, SocialPostMetric] = {}
    changed_post_ids_by_day: dict[str, set[uuid.UUID]] = {}
    today = datetime.now(timezone.utc).date()
    for metric in metrics:
        captured_at = _aware_utc(metric.captured_at)
        previous = latest_by_post.get(metric.post_id)
        latest_by_post[metric.post_id] = metric
        if start is not None and captured_at < start:
            continue
        if previous is None:
            published_at = _aware_utc(metric.post.published_at)
            if captured_at.date() != today or published_at.date() != today:
                # First observation is only a baseline. It does not prove those views
                # happened on the capture date, except for videos published today.
                continue
            delta_views = int(metric.views or 0)
        else:
            delta_views = max(int(metric.views or 0) - int(previous.views or 0), 0)

        day_key = captured_at.date().isoformat()
        if day_key not in by_day:
            by_day[day_key] = _empty_daily_views(day_key)
        by_day[day_key]["views"] += delta_views
        changed_post_ids_by_day.setdefault(day_key, set()).add(metric.post_id)

    for day_key, item in by_day.items():
        item["videos"] = len(changed_post_ids_by_day.get(day_key, set()))
        item["avg_views"] = round(item["views"] / item["videos"]) if item["videos"] else 0

    return [by_day[key] for key in sorted(by_day)]


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
    posts_query = db.query(SocialPost).filter(SocialPost.profile_id == profile.id)
    posts = _apply_period(posts_query, SocialPost.published_at, start, end).all()
    post_ids = [post.id for post in posts]
    latest_metrics = _latest_metrics_by_post(db, post_ids)

    previous_posts = []
    if compare_previous and start is not None and end is not None:
        duration = end - start
        previous_start = start - duration
        previous_end = start
        previous_posts = (
            db.query(SocialPost)
            .filter(SocialPost.profile_id == profile.id, SocialPost.published_at >= previous_start, SocialPost.published_at < previous_end)
            .all()
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

    posts_query = db.query(SocialPost).filter(SocialPost.profile_id == profile.id)
    posts = _apply_period(posts_query, SocialPost.published_at, start, end).order_by(SocialPost.published_at.asc()).all()
    views_by_day = _daily_view_deltas(db, profile.id, start, end)

    posts_by_day_dict = {}
    for post in posts:
        if post.published_at:
            day_key = post.published_at.date().isoformat()
            if day_key not in posts_by_day_dict:
                posts_by_day_dict[day_key] = {"date": day_key, "published_videos": 0}
            posts_by_day_dict[day_key]["published_videos"] += 1
            
    posts_by_day = [posts_by_day_dict[key] for key in sorted(posts_by_day_dict)]

    snapshots_query = db.query(SocialProfileSnapshot).filter(SocialProfileSnapshot.profile_id == profile.id)
    snapshots = _apply_period(snapshots_query, SocialProfileSnapshot.captured_at, start, end).order_by(SocialProfileSnapshot.captured_at.asc()).all()

    return {
        "profile_id": str(profile.id),
        "granularity": granularity,
        "views_by_day": views_by_day,
        "posts_by_day": posts_by_day,
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
    posts_query = db.query(SocialPost).filter(SocialPost.profile_id == profile.id)
    posts = _apply_period(posts_query, SocialPost.published_at, start, end).all()
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
