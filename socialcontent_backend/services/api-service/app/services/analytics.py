from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
import uuid

from sqlalchemy import Date, cast, func
from sqlalchemy.orm import Session

from common.db.models import SocialPost, SocialPostMetric, SocialProfileSnapshot


def empty_daily_views(date_key: str) -> dict:
    return {"date": date_key, "views": 0, "avg_views": 0, "videos": 0}


def period_day_keys(start: datetime | None, end: datetime | None) -> list[str]:
    if start is None or end is None:
        return []
    keys: list[str] = []
    cursor = start.date()
    while cursor < end.date():
        keys.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return keys


def daily_view_deltas(
    db: Session,
    profile_id: uuid.UUID,
    start: datetime | None,
    end: datetime | None,
) -> list[dict]:
    by_day = {key: empty_daily_views(key) for key in period_day_keys(start, end)}
    metric_day = cast(func.timezone("UTC", SocialPostMetric.captured_at), Date)
    ranked_daily_metrics = (
        db.query(
            SocialPostMetric.post_id.label("post_id"),
            metric_day.label("metric_day"),
            SocialPostMetric.views.label("views"),
            func.row_number().over(
                partition_by=(SocialPostMetric.post_id, metric_day),
                order_by=(SocialPostMetric.captured_at.desc(), SocialPostMetric.id.desc()),
            ).label("day_rank"),
        )
        .join(SocialPost, SocialPost.id == SocialPostMetric.post_id)
        .filter(SocialPost.profile_id == profile_id)
    )
    if end is not None:
        ranked_daily_metrics = ranked_daily_metrics.filter(SocialPostMetric.captured_at < end)
    ranked_daily_metrics = ranked_daily_metrics.subquery()
    latest_daily_metrics = (
        db.query(
            ranked_daily_metrics.c.post_id,
            ranked_daily_metrics.c.metric_day,
            ranked_daily_metrics.c.views,
        )
        .filter(ranked_daily_metrics.c.day_rank == 1)
        .subquery()
    )
    daily_deltas = (
        db.query(
            latest_daily_metrics.c.metric_day.label("metric_day"),
            latest_daily_metrics.c.views.label("views"),
            func.coalesce(
                func.lag(latest_daily_metrics.c.views).over(
                    partition_by=latest_daily_metrics.c.post_id,
                    order_by=latest_daily_metrics.c.metric_day,
                ),
                0,
            ).label("previous_views"),
        )
        .subquery()
    )
    daily_totals_query = db.query(
        daily_deltas.c.metric_day,
        func.sum(func.greatest(daily_deltas.c.views - daily_deltas.c.previous_views, 0)).label("views"),
        func.count().filter(daily_deltas.c.views > daily_deltas.c.previous_views).label("videos"),
    )
    if start is not None:
        daily_totals_query = daily_totals_query.filter(daily_deltas.c.metric_day >= start.date())
    if end is not None:
        daily_totals_query = daily_totals_query.filter(daily_deltas.c.metric_day < end.date())
    for day, views, videos in daily_totals_query.group_by(daily_deltas.c.metric_day).all():
        day_key = day.isoformat()
        item = by_day.setdefault(day_key, empty_daily_views(day_key))
        item["views"] = int(views or 0)
        item["videos"] = int(videos or 0)
        item["avg_views"] = round(item["views"] / item["videos"]) if item["videos"] else 0
    return [by_day[key] for key in sorted(by_day)]


def latest_metrics_by_post(db: Session, post_ids: list[uuid.UUID]) -> dict[uuid.UUID, SocialPostMetric]:
    if not post_ids:
        return {}
    ranked_metrics = (
        db.query(
            SocialPostMetric.id.label("metric_id"),
            func.row_number().over(
                partition_by=SocialPostMetric.post_id,
                order_by=(SocialPostMetric.captured_at.desc(), SocialPostMetric.id.desc()),
            ).label("metric_rank"),
        )
        .filter(SocialPostMetric.post_id.in_(post_ids))
        .subquery()
    )
    latest_metrics = (
        db.query(SocialPostMetric)
        .join(ranked_metrics, SocialPostMetric.id == ranked_metrics.c.metric_id)
        .filter(ranked_metrics.c.metric_rank == 1)
        .all()
    )
    return {metric.post_id: metric for metric in latest_metrics}


def latest_profile_snapshots_by_day(
    db: Session,
    profile_id: uuid.UUID,
    start: datetime | None,
    end: datetime | None,
) -> list[dict]:
    """Return only the last account snapshot for each UTC day in the period."""
    snapshot_day = cast(func.timezone("UTC", SocialProfileSnapshot.captured_at), Date)
    ranked = db.query(
        SocialProfileSnapshot.captured_at.label("captured_at"),
        snapshot_day.label("snapshot_day"),
        SocialProfileSnapshot.follower_count.label("followers"),
        SocialProfileSnapshot.following_count.label("following"),
        SocialProfileSnapshot.likes_count.label("likes"),
        SocialProfileSnapshot.video_count.label("videos"),
        func.row_number().over(
            partition_by=snapshot_day,
            order_by=(SocialProfileSnapshot.captured_at.desc(), SocialProfileSnapshot.id.desc()),
        ).label("day_rank"),
    ).filter(SocialProfileSnapshot.profile_id == profile_id)
    if start is not None:
        ranked = ranked.filter(SocialProfileSnapshot.captured_at >= start)
    if end is not None:
        ranked = ranked.filter(SocialProfileSnapshot.captured_at < end)
    ranked = ranked.subquery()
    rows = db.query(
        ranked.c.captured_at,
        ranked.c.snapshot_day,
        ranked.c.followers,
        ranked.c.following,
        ranked.c.likes,
        ranked.c.videos,
    ).filter(ranked.c.day_rank == 1).order_by(ranked.c.snapshot_day.asc()).all()
    return [
        {
            "date": row.snapshot_day.isoformat(),
            "followers": row.followers,
            "following": row.following,
            "likes": row.likes,
            "videos": row.videos,
        }
        for row in rows
    ]
