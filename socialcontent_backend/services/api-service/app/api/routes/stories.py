import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import Episode, Story, User
from common.db.session import get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import STORY_GROUPING_REQUESTED
from app.api.deps import get_current_user, require_admin
from app.schemas import api as schemas

router = APIRouter()


@router.get("/stories", response_model=list[schemas.StoryResponse])
def list_stories(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Story).order_by(Story.updated_at.desc()).limit(100).all()


@router.get("/stories/{story_id}", response_model=schemas.StoryResponse)
def get_story(story_id: uuid.UUID, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return story


@router.get("/stories/{story_id}/episodes")
def story_episodes(story_id: uuid.UUID, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return db.query(Episode).filter(Episode.story_id == story_id).order_by(Episode.sequence_order.asc().nullslast()).all()


@router.post("/stories/{story_id}/regroup")
def regroup_story(story_id: uuid.UUID, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    story = db.get(Story, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    publish(
        STORY_GROUPING_REQUESTED,
        build_event(event_type=STORY_GROUPING_REQUESTED, source="api-service", payload={"story_id": str(story.id)}),
    )
    return {"requested": True, "story_id": story.id}


@router.patch("/episodes/{episode_id}")
def update_episode(episode_id: uuid.UUID, payload: schemas.EpisodeUpdateRequest, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    episode = db.get(Episode, episode_id)
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(episode, field, value)
    db.commit()
    db.refresh(episode)
    return episode
