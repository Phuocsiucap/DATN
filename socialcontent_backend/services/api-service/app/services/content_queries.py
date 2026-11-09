from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from common.db.models import (
    ContentItem,
    CrawlJob,
    CrawlJobContent,
    ProfileContentLink,
    SocialProfile,
    User,
)


def private_content_ids_for_user(user_id: uuid.UUID):
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

    own_private = and_(
        ContentItem.content_scope == "PRIVATE",
        ContentItem.id.in_(private_content_ids_for_user(user.id)),
    )
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
        creator_crawled_ids = private_content_ids_for_user(user.id)
        return query.filter(
            or_(
                own_private,
                and_(ContentItem.content_scope == "GLOBAL", ContentItem.id.in_(assigned_global_ids)),
                and_(ContentItem.content_scope == "GLOBAL", ContentItem.id.in_(creator_crawled_ids)),
            )
        )
    return query.filter(or_(ContentItem.content_scope == "GLOBAL", own_private))


def _content_order(
    content_scope: str | None,
    crawl_job_id: uuid.UUID | None,
    user: User | None = None,
):
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
        return (func.greatest(ContentItem.updated_at, last_creator_crawl, last_recommendation).desc(), ContentItem.created_at.desc())
    return (ContentItem.created_at.desc(),)


def list_visible_contents(
    db: Session,
    *,
    user: User,
    content_scope: str | None = None,
    source_type: str | None = None,
    content_type: str | None = None,
    status: str | None = None,
    language: str | None = None,
    crawl_job_id: uuid.UUID | None = None,
    created_after: datetime | None = None,
    created_before: datetime | None = None,
    published_after: datetime | None = None,
    published_before: datetime | None = None,
    sort_by: str | None = None,
    sort_order: str | None = None,
    limit: int = 100,
) -> list[ContentItem]:
    query = _visible_content_query(db.query(ContentItem), user, content_scope)
    if content_type:
        query = query.filter(ContentItem.content_type == content_type.upper())
    if status:
        query = query.filter(ContentItem.status == status.upper())
    if language:
        query = query.filter(ContentItem.language == language)
    if source_type:
        query = query.filter(ContentItem.sources_jsonb[0]["source_type"].astext == source_type.strip().upper())
    if crawl_job_id:
        query = query.join(CrawlJobContent, CrawlJobContent.content_id == ContentItem.id).filter(
            CrawlJobContent.job_id == crawl_job_id
        )
    for value, column, is_after in (
        (created_after, ContentItem.created_at, True),
        (created_before, ContentItem.created_at, False),
        (published_after, ContentItem.published_at, True),
        (published_before, ContentItem.published_at, False),
    ):
        if value is not None:
            query = query.filter(column >= value if is_after else column <= value)

    sort_columns = {
        "created_at": ContentItem.created_at,
        "published_at": ContentItem.published_at,
        "quality_score": ContentItem.quality_score,
    }
    sort_column = sort_columns.get(str(sort_by or "").strip().lower())
    if sort_column is not None:
        order = str(sort_order or "desc").strip().lower()
        if order not in {"asc", "desc"}:
            raise ValueError("sort_order must be asc or desc")
        primary_order = sort_column.asc() if order == "asc" else sort_column.desc()
        ordering = (primary_order, ContentItem.id.asc())
    else:
        ordering = _content_order(content_scope, crawl_job_id, user)
    return query.order_by(*ordering).limit(max(1, min(int(limit), 200))).all()


def get_visible_content(db: Session, content_id: uuid.UUID, user: User) -> ContentItem:
    content = db.get(ContentItem, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    if user.is_system_admin or content.content_scope == "GLOBAL":
        return content
    if content.content_scope == "PRIVATE":
        owner_link = (
            db.query(CrawlJobContent.job_id)
            .join(CrawlJob, CrawlJob.id == CrawlJobContent.job_id)
            .filter(
                CrawlJobContent.content_id == content.id,
                CrawlJob.requested_by == user.id,
                CrawlJob.content_scope == "PRIVATE",
            )
            .first()
        )
        if owner_link:
            return content
    raise HTTPException(status_code=404, detail="Content not found")
