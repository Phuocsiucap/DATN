import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from common.db.models import ContentItem, CrawlJob, CrawlJobContent, Story, User
from common.db.session import get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


@router.get("/stories", response_model=list[schemas.StoryResponse])
def list_stories(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Story)
    if not user.is_system_admin:
        private_content_ids = _private_content_ids_for_user(user.id)
        query = query.join(ContentItem, ContentItem.id == Story.content_id).filter(
            or_(
                ContentItem.content_scope == "GLOBAL",
                and_(ContentItem.content_scope == "PRIVATE", ContentItem.id.in_(private_content_ids)),
            )
        )
    return query.order_by(Story.updated_at.desc()).limit(100).all()


@router.get("/stories/{story_id}", response_model=schemas.StoryResponse)
def get_story(story_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_visible_story(db, story_id, user)


@router.get("/stories/{story_id}/episodes")
def story_episodes(story_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_visible_story(db, story_id, user)
    return db.query(ContentItem).filter(ContentItem.story_id == story_id).order_by(ContentItem.episode_order.asc().nullslast()).all()


def _private_content_ids_for_user(user_id: uuid.UUID):
    return (
        select(CrawlJobContent.content_id)
        .join(CrawlJob, CrawlJob.id == CrawlJobContent.job_id)
        .where(
            CrawlJob.requested_by == user_id,
            CrawlJob.content_scope == "PRIVATE",
        )
    )


def _get_visible_story(db: Session, story_id: uuid.UUID, user: User) -> Story:
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    if user.is_system_admin:
        return story
    content = db.get(ContentItem, story.content_id) if story.content_id else None
    if content and content.content_scope == "GLOBAL":
        return story
    if content and content.content_scope == "PRIVATE":
        private_link = db.query(CrawlJobContent.job_id).join(CrawlJob, CrawlJob.id == CrawlJobContent.job_id).filter(
            CrawlJobContent.content_id == content.id,
            CrawlJob.requested_by == user.id,
            CrawlJob.content_scope == "PRIVATE",
        ).first()
        if private_link:
            return story
    raise HTTPException(status_code=404, detail="Story not found")
