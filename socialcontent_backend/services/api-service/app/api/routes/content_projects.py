import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from common.db.content_projects import serialize_project
from common.db.models import ContentItem, ContentProject, CrawlJob, Episode, ProcessingRun, ProjectSource, SocialProfile, Story, User
from common.db.session import get_db
from app.api.deps import get_current_user


router = APIRouter()


class ContentProjectFromProjectSeriesRequest(BaseModel):
    series_id: uuid.UUID
    part_ids: list[uuid.UUID] = Field(default_factory=list)
    priority: int = 5
    note: str | None = None


class ContentProjectFromSourcesRequest(BaseModel):
    profile_id: uuid.UUID
    crawl_job_id: uuid.UUID | None = None
    content_ids: list[uuid.UUID] = Field(default_factory=list)
    story_ids: list[uuid.UUID] = Field(default_factory=list)
    episode_ids: list[uuid.UUID] = Field(default_factory=list)
    title: str | None = None
    note: str | None = None
    selection_mode: str = "MANUAL"
    filters: dict = Field(default_factory=dict)


class ContentProjectFromCrawlRequest(BaseModel):
    profile_id: uuid.UUID
    crawl_job_id: uuid.UUID
    candidate_limit: int = 20
    min_quality_score: float | None = None
    title: str | None = None
    note: str | None = None
    filters: dict = Field(default_factory=dict)


@router.get("")
def list_content_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = (
        db.query(ContentProject)
        .filter(ContentProject.user_id == user.id)
        .order_by(ContentProject.updated_at.desc())
        .limit(200)
        .all()
    )
    return [serialize_project(project, db) for project in projects]


@router.get("/{project_id}")
def get_content_project(project_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.get(ContentProject, project_id)
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content project not found")
    return serialize_project(project, db)


@router.post("/from-project-series")
def create_content_project_from_project_series(payload: ContentProjectFromProjectSeriesRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    raise HTTPException(status_code=410, detail="Project-series production entrypoint was removed. Use content_projects/project_parts.")


@router.post("/from-sources")
def create_content_project_from_sources(payload: ContentProjectFromSourcesRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(SocialProfile, payload.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    title = payload.title or _source_project_title(db, payload, user) or payload.note or "Content project"
    project = ContentProject(
        user_id=user.id,
        profile_id=profile.id,
        title=title,
        status="READY",
        planning_mode=None,
        metadata_json={
            "selection_mode": payload.selection_mode.upper(),
            "note": payload.note,
            "filters": payload.filters,
            "crawl_job_id": str(payload.crawl_job_id) if payload.crawl_job_id else None,
        },
    )
    db.add(project)
    db.flush()
    _add_project_sources(db, project, payload, user)
    db.flush()
    active_count = db.query(ProjectSource).filter(ProjectSource.project_id == project.id, ProjectSource.status == "ACTIVE").count()
    if active_count == 0:
        raise HTTPException(status_code=400, detail="Content project requires at least one accessible source")
    project.status = "READY"
    db.commit()
    db.refresh(project)
    return serialize_project(project, db)


@router.post("/from-crawl")
def create_content_project_from_crawl(payload: ContentProjectFromCrawlRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(SocialProfile, payload.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Profile not found")
    crawl_job = db.get(CrawlJob, payload.crawl_job_id)
    if not crawl_job or (not user.is_system_admin and crawl_job.requested_by != user.id):
        raise HTTPException(status_code=404, detail="Crawl job not found")
    min_quality = payload.min_quality_score
    query = (
        db.query(ContentItem)
        .join(ProcessingRun, ProcessingRun.content_id == ContentItem.id)
        .filter(
            ProcessingRun.job_id == payload.crawl_job_id,
            ProcessingRun.processing_type == "CANONICAL_SAVE",
            ProcessingRun.status == "SUCCEEDED",
            ContentItem.status.in_(["READY", "USABLE_WITH_WARNING"]),
        )
        .distinct()
    )
    if min_quality is not None:
        query = query.filter(ContentItem.quality_score >= min_quality)
    content_types = payload.filters.get("content_types") if isinstance(payload.filters, dict) else None
    if content_types:
        query = query.filter(ContentItem.content_type.in_([str(value).upper() for value in content_types]))
    languages = payload.filters.get("languages") if isinstance(payload.filters, dict) else None
    if languages:
        query = query.filter(ContentItem.language.in_(languages))
    items = query.order_by(ContentItem.quality_score.desc(), ContentItem.updated_at.desc()).limit(payload.candidate_limit).all()
    project = ContentProject(
        user_id=user.id,
        profile_id=profile.id,
        title=payload.title or payload.note or "Auto content project",
        status="READY" if items else "NEEDS_REVIEW",
        metadata_json={
            "selection_mode": "AUTO",
            "note": payload.note,
            "filters": payload.filters,
            "crawl_job_id": str(payload.crawl_job_id),
        },
    )
    db.add(project)
    db.flush()
    for item in items:
        _add_project_source(db, project, "CONTENT", item.id, content_id=item.id, active=True, score=item.quality_score or 0)
    db.commit()
    db.refresh(project)
    return serialize_project(project, db)


def _source_project_title(db: Session, payload: ContentProjectFromSourcesRequest, user: User) -> str | None:
    if payload.content_ids:
        content = db.get(ContentItem, payload.content_ids[0])
        return (content.canonical_title or content.normalized_title) if content and _can_use_content(content, user) else None
    if payload.story_ids:
        story = db.get(Story, payload.story_ids[0])
        return story.canonical_name if story and _can_use_story(db, story, user) else None
    if payload.episode_ids:
        episode = db.get(Episode, payload.episode_ids[0])
        return episode.episode_title if episode and _can_use_episode(db, episode, user) else None
    return None


def _add_project_sources(db: Session, project: ContentProject, payload: ContentProjectFromSourcesRequest, user: User) -> None:
    for content_id in payload.content_ids:
        content = db.get(ContentItem, content_id)
        _add_project_source(db, project, "CONTENT", content_id, content_id=content_id, active=bool(content and _can_use_content(content, user)))
    for story_id in payload.story_ids:
        story = db.get(Story, story_id)
        _add_project_source(db, project, "STORY", story_id, story_id=story_id, active=bool(story and _can_use_story(db, story, user)))
    for episode_id in payload.episode_ids:
        episode = db.get(Episode, episode_id)
        _add_project_source(db, project, "EPISODE", episode_id, episode_id=episode_id, active=bool(episode and _can_use_episode(db, episode, user)))


def _can_use_content(content: ContentItem, user: User) -> bool:
    return user.is_system_admin or content.content_scope == "GLOBAL" or (content.content_scope == "PRIVATE" and content.owner_user_id == user.id)


def _can_use_story(db: Session, story: Story, user: User) -> bool:
    if story.content_id:
        content = db.get(ContentItem, story.content_id)
        return bool(content and _can_use_content(content, user))
    episode = db.query(Episode).filter(Episode.story_id == story.id).first()
    return _can_use_episode(db, episode, user) if episode else user.is_system_admin


def _can_use_episode(db: Session, episode: Episode | None, user: User) -> bool:
    if not episode:
        return False
    content = db.get(ContentItem, episode.content_id)
    return bool(content and _can_use_content(content, user))


def _add_project_source(
    db: Session,
    project: ContentProject,
    source_type: str,
    source_id: uuid.UUID,
    *,
    content_id=None,
    story_id=None,
    episode_id=None,
    active: bool,
    score: float = 0,
) -> None:
    source = ProjectSource(
        project_id=project.id,
        source_type=source_type,
        source_id=source_id,
        content_id=content_id,
        story_id=story_id,
        episode_id=episode_id,
        role="PRIMARY" if active else "REJECTED",
        status="ACTIVE" if active else "REJECTED",
        score=score,
        metadata_json={},
    )
    db.add(source)
    if active and not project.primary_content_id and not project.primary_story_id:
        project.primary_content_id = content_id
        project.primary_story_id = story_id
