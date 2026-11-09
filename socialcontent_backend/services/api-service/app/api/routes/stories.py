import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.services.bilibili_ocr import _queue_bilibili_ocr_for_content
from app.schemas import api as schemas
from app.services.stories import (
    get_story as get_story_service,
    get_visible_story,
    list_stories as list_stories_service,
    story_episodes as story_episodes_service,
    story_publish_status as story_publish_status_service,
)
from common.db.media_workflows import content_source_type as _content_source_type
from common.db.models import ContentItem, User
from common.db.session import get_db

router = APIRouter()


@router.get("/stories", response_model=list[schemas.StoryResponse])
def list_stories(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_stories_service(db, user)


@router.get("/stories/publish-status")
def story_publish_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return story_publish_status_service(db, user)


@router.post("/stories/{story_id}/bilibili/ocr-queue", status_code=202)
def queue_bilibili_story_ocr(story_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    story = get_visible_story(db, story_id, user)
    content_rows = (
        db.query(ContentItem)
        .filter(ContentItem.story_id == story.id)
        .order_by(ContentItem.episode_order.asc().nullslast(), ContentItem.created_at.asc())
        .all()
    )
    if story.content_id and not any(item.id == story.content_id for item in content_rows):
        story_content = db.get(ContentItem, story.content_id)
        if story_content:
            content_rows.insert(0, story_content)

    bilibili_rows = [content for content in content_rows if _content_source_type(content) == "BILIBILI"]
    if not bilibili_rows:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Story này chưa có video Bilibili để dịch")

    queued = 0
    reused = 0
    task_ids: list[str] = []
    content_results = []
    for content in bilibili_rows:
        result = _queue_bilibili_ocr_for_content(db, content, user)
        queued += int(result.get("queued") or 0)
        reused += int(result.get("reused") or 0)
        task_ids.extend(str(task_id) for task_id in result.get("task_ids") or [])
        content_results.append(result)

    db.commit()
    return {
        "story_id": str(story.id),
        "queued": queued,
        "reused": reused,
        "task_ids": task_ids,
        "contents": content_results,
    }


@router.get("/stories/{story_id}", response_model=schemas.StoryResponse)
def get_story(story_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_story_service(db, story_id, user)


@router.get("/stories/{story_id}/episodes")
def story_episodes(story_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return story_episodes_service(db, story_id, user)
