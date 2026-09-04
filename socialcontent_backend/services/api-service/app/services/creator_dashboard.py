from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from common.db.models import (
    MediaWorkflow,
    ProfileContentLink,
    PublishingQueueItem,
    SocialPost,
    SocialProfile,
)


ACTIVE_PROJECT_STATUSES = (
    "DRAFT",
    "READY",
    "APPROVED",
    "PRODUCTION_READY",
    "SCRIPTING",
    "EDITING",
    "REVIEWING",
    "VOICE_READY",
    "RENDERING",
    "RENDERED",
    "NEEDS_REVIEW",
)
READY_RECOMMENDATION_STATUSES = ("RECOMMENDED", "REVIEW_REQUIRED")
QUEUE_STATUSES = ("needs_approval", "approved", "queued", "publishing", "published", "failed")


def creator_dashboard_overview(db: Session, user_id: UUID) -> dict[str, Any]:
    profile_counts = _grouped_counts(
        db.query(func.lower(SocialProfile.status), func.count(SocialProfile.id))
        .filter(SocialProfile.user_id == user_id)
        .group_by(func.lower(SocialProfile.status))
        .all()
    )
    queue_counts = _creator_queue_counts(db, user_id)

    recommendations_ready = _count(
        db.query(func.count(ProfileContentLink.id)).filter(
            ProfileContentLink.user_id == user_id,
            ProfileContentLink.status == "ACTIVE",
            ProfileContentLink.recommendation_status.in_(READY_RECOMMENDATION_STATUSES),
        )
    )
    projects_total = _count(
        db.query(func.count(MediaWorkflow.id)).filter(MediaWorkflow.user_id == user_id)
    )
    projects_in_progress = _count(
        db.query(func.count(MediaWorkflow.id)).filter(
            MediaWorkflow.user_id == user_id,
            MediaWorkflow.status.in_(ACTIVE_PROJECT_STATUSES),
        )
    )
    scheduled_total = _creator_scheduled_count(db, user_id)
    published_total = _creator_published_count(db, user_id)

    return {
        "generated_at": _generated_at(),
        "recommendations_ready": recommendations_ready,
        "profiles": {
            "total": sum(profile_counts.values()),
            "active": profile_counts.get("active", 0),
        },
        "projects": {
            "total": projects_total,
            "in_progress": projects_in_progress,
        },
        "publishing": {
            "needs_approval": queue_counts.get("needs_approval", 0) + queue_counts.get("pending", 0),
            "scheduled": scheduled_total,
            "published": published_total,
            "failed": queue_counts.get("failed", 0),
        },
    }


def creator_dashboard_publishing(db: Session, user_id: UUID) -> dict[str, Any]:
    counts = _creator_queue_counts(db, user_id)
    statuses = {
        status: counts.get(status, 0)
        for status in QUEUE_STATUSES
    }
    statuses["needs_approval"] += counts.get("pending", 0)
    statuses["published"] = _creator_published_count(db, user_id)

    now = datetime.now(timezone.utc)
    upcoming_rows = (
        db.query(
            PublishingQueueItem.id,
            PublishingQueueItem.article_title,
            PublishingQueueItem.platform,
            PublishingQueueItem.status,
            PublishingQueueItem.scheduled_at,
            SocialProfile.profile_name,
        )
        .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
        .filter(
            PublishingQueueItem.user_id == user_id,
            PublishingQueueItem.status.in_(("approved", "queued", "publishing")),
            PublishingQueueItem.scheduled_at.is_not(None),
            PublishingQueueItem.scheduled_at >= now,
        )
        .order_by(PublishingQueueItem.scheduled_at.asc())
        .limit(5)
        .all()
    )

    return {
        "generated_at": _generated_at(),
        "status_counts": statuses,
        "upcoming": [
            {
                "id": str(row.id),
                "title": row.article_title,
                "platform": row.platform,
                "profile_name": row.profile_name,
                "status": row.status,
                "scheduled_at": row.scheduled_at.isoformat() if row.scheduled_at else None,
            }
            for row in upcoming_rows
        ],
    }


def creator_dashboard_projects(db: Session, user_id: UUID) -> dict[str, Any]:
    counts = _grouped_counts(
        db.query(MediaWorkflow.status, func.count(MediaWorkflow.id))
        .filter(MediaWorkflow.user_id == user_id)
        .group_by(MediaWorkflow.status)
        .all()
    )
    recent_rows = (
        db.query(
            MediaWorkflow.id,
            MediaWorkflow.title,
            MediaWorkflow.status,
            MediaWorkflow.current_stage,
            MediaWorkflow.progress_percent,
            MediaWorkflow.updated_at,
            SocialProfile.profile_name,
            SocialProfile.platform,
        )
        .join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
        .filter(MediaWorkflow.user_id == user_id)
        .order_by(MediaWorkflow.updated_at.desc())
        .limit(6)
        .all()
    )

    return {
        "generated_at": _generated_at(),
        "status_counts": counts,
        "recent_projects": [
            {
                "id": str(row.id),
                "title": row.title,
                "status": row.status,
                "current_stage": row.current_stage,
                "progress_percent": float(row.progress_percent or 0),
                "profile_name": row.profile_name,
                "platform": row.platform,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in recent_rows
        ],
    }


def _creator_queue_counts(db: Session, user_id: UUID) -> dict[str, int]:
    return _grouped_counts(
        db.query(func.lower(PublishingQueueItem.status), func.count(PublishingQueueItem.id))
        .filter(PublishingQueueItem.user_id == user_id)
        .group_by(func.lower(PublishingQueueItem.status))
        .all()
    )


def _creator_scheduled_count(db: Session, user_id: UUID) -> int:
    return _count(
        db.query(func.count(PublishingQueueItem.id)).filter(
            PublishingQueueItem.user_id == user_id,
            PublishingQueueItem.status.in_(("approved", "queued")),
            PublishingQueueItem.scheduled_at.is_not(None),
            PublishingQueueItem.scheduled_at >= datetime.now(timezone.utc),
        )
    )


def _creator_published_count(db: Session, user_id: UUID) -> int:
    return _count(
        db.query(func.count(SocialPost.id))
        .join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
        .filter(SocialProfile.user_id == user_id)
    )


def _grouped_counts(rows: list[tuple[Any, Any]]) -> dict[str, int]:
    return {str(status or "unknown").lower(): int(count or 0) for status, count in rows}


def _count(query) -> int:
    return int(query.scalar() or 0)


def _generated_at() -> str:
    return datetime.now(timezone.utc).isoformat()
