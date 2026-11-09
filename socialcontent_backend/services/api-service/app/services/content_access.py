from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from common.db.models import ContentItem, CrawlJob, CrawlJobContent, User


def accessible_content_ids(
    db: Session,
    user: User,
    contents: list[ContentItem],
) -> set[UUID]:
    if user.is_system_admin:
        return {content.id for content in contents}

    accessible = {content.id for content in contents if content.content_scope == "GLOBAL"}
    private_ids = [content.id for content in contents if content.content_scope == "PRIVATE"]
    if private_ids:
        rows = (
            db.query(CrawlJobContent.content_id)
            .join(CrawlJob, CrawlJob.id == CrawlJobContent.job_id)
            .filter(
                CrawlJobContent.content_id.in_(private_ids),
                CrawlJob.requested_by == user.id,
                CrawlJob.content_scope == "PRIVATE",
            )
            .all()
        )
        accessible.update(row.content_id for row in rows)
    return accessible


def can_user_access_content(db: Session, content: ContentItem, user: User) -> bool:
    return content.id in accessible_content_ids(db, user, [content])
