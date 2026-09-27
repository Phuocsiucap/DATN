import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from common.db.models import ContentItem, CrawlJob, CrawlJobContent, MediaWorkflow, PublishingQueueItem, SocialPost, SocialProfile, Story, User
from common.db.session import get_db
from app.api.deps import get_current_user
from app.api.routes.contents import _queue_bilibili_ocr_for_content
from app.schemas import api as schemas

router = APIRouter()


@router.get("/stories", response_model=list[schemas.StoryResponse])
def list_stories(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = _visible_stories_query(db, user)
    return query.order_by(Story.updated_at.desc()).limit(100).all()


@router.get("/stories/publish-status")
def story_publish_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stories = _visible_stories_query(db, user).order_by(Story.updated_at.desc()).limit(100).all()
    story_ids = [story.id for story in stories]
    episodes = []
    if story_ids:
        episodes = (
            db.query(ContentItem)
            .filter(ContentItem.story_id.in_(story_ids))
            .order_by(ContentItem.story_id.asc(), ContentItem.episode_order.asc().nullslast(), ContentItem.created_at.asc())
            .all()
        )
    episodes_by_story: dict[uuid.UUID, list[ContentItem]] = {story_id: [] for story_id in story_ids}
    for episode in episodes:
        if episode.story_id:
            episodes_by_story.setdefault(episode.story_id, []).append(episode)
    for story in stories:
        if story.content_id and not any(episode.id == story.content_id for episode in episodes_by_story.get(story.id, [])):
            content = db.get(ContentItem, story.content_id)
            if content:
                episodes_by_story.setdefault(story.id, []).insert(0, content)
                episodes.append(content)

    fallback_contents = _fallback_series_contents(db, user, exclude_content_ids={episode.id for episode in episodes})
    all_content_rows = [*episodes, *fallback_contents]
    content_ids = [episode.id for episode in all_content_rows]
    workflows_by_content = _latest_workflows_by_content(db, content_ids, user)
    queues_by_workflow = _latest_queue_items_by_workflow(db, [workflow.id for workflow in workflows_by_content.values()], user)
    posts_by_queue = _latest_posts_by_queue(db, [item.id for item in queues_by_workflow.values()], user)

    items = []
    for story in stories:
        story_episodes = episodes_by_story.get(story.id, [])
        episode_rows = []
        for episode in story_episodes:
            episode_rows.extend(_episode_publish_rows(episode, workflows_by_content.get(episode.id), queues_by_workflow, posts_by_queue))
        published_count = sum(1 for row in episode_rows if row["publish_status"] == "PUBLISHED")
        in_progress_count = sum(1 for row in episode_rows if row["publish_status"] in {"QUEUED", "WORKFLOW_READY"})
        unpublished_count = sum(1 for row in episode_rows if row["publish_status"] == "NOT_PUBLISHED")

        items.append({
            "id": str(story.id),
            "canonical_name": story.canonical_name,
            "normalized_name": story.normalized_name,
            "language": story.language,
            "completion_status": story.completion_status,
            "grouping_confidence": float(story.grouping_confidence or 0),
            "total_episodes": len(story_episodes) or story.total_episodes,
            "published_count": published_count,
            "in_progress_count": in_progress_count,
            "unpublished_count": unpublished_count,
            "source_type": _episode_source_type(story_episodes[0]) if story_episodes else None,
            "created_at": story.created_at,
            "updated_at": story.updated_at,
            "episodes": episode_rows,
        })

    for content in fallback_contents:
        source = _primary_source(content)
        metadata = _source_metadata(source)
        episode_rows = _episode_publish_rows(content, workflows_by_content.get(content.id), queues_by_workflow, posts_by_queue)
        published_count = sum(1 for row in episode_rows if row["publish_status"] == "PUBLISHED")
        in_progress_count = sum(1 for row in episode_rows if row["publish_status"] in {"QUEUED", "WORKFLOW_READY"})
        unpublished_count = sum(1 for row in episode_rows if row["publish_status"] == "NOT_PUBLISHED")
        title = metadata.get("season_title") or metadata.get("series_title") or content.canonical_title
        items.append({
            "id": f"content:{content.id}",
            "canonical_name": title,
            "normalized_name": f"content:{content.id}",
            "language": content.language,
            "completion_status": "UNKNOWN",
            "grouping_confidence": 0,
            "total_episodes": len(episode_rows) or _safe_int(metadata.get("episode_count")) or 1,
            "published_count": published_count,
            "in_progress_count": in_progress_count,
            "unpublished_count": unpublished_count,
            "source_type": source.get("source_type"),
            "created_at": content.created_at,
            "updated_at": content.updated_at,
            "episodes": episode_rows,
        })

    return {"items": items}


@router.post("/stories/{story_id}/bilibili/ocr-queue", status_code=202)
def queue_bilibili_story_ocr(story_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    story = _get_visible_story(db, story_id, user)
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


def _visible_stories_query(db: Session, user: User):
    query = db.query(Story)
    if not user.is_system_admin:
        private_content_ids = _private_content_ids_for_user(user.id)
        query = query.join(ContentItem, ContentItem.id == Story.content_id).filter(
            or_(
                ContentItem.content_scope == "GLOBAL",
                and_(ContentItem.content_scope == "PRIVATE", ContentItem.id.in_(private_content_ids)),
            )
        )
    return query


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


def _latest_workflows_by_content(db: Session, content_ids: list[uuid.UUID], user: User) -> dict[uuid.UUID, MediaWorkflow]:
    if not content_ids:
        return {}
    query = (
        db.query(MediaWorkflow)
        .join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
        .filter(MediaWorkflow.primary_content_id.in_(content_ids))
    )
    if not user.is_system_admin:
        query = query.filter(SocialProfile.user_id == user.id)
    workflows = query.order_by(MediaWorkflow.updated_at.desc(), MediaWorkflow.created_at.desc()).all()
    by_content: dict[uuid.UUID, MediaWorkflow] = {}
    for workflow in workflows:
        if workflow.primary_content_id and workflow.primary_content_id not in by_content:
            by_content[workflow.primary_content_id] = workflow
    return by_content


def _latest_queue_items_by_workflow(db: Session, workflow_ids: list[uuid.UUID], user: User) -> dict[uuid.UUID, PublishingQueueItem]:
    if not workflow_ids:
        return {}
    query = (
        db.query(PublishingQueueItem)
        .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
        .filter(PublishingQueueItem.workflow_id.in_(workflow_ids))
    )
    if not user.is_system_admin:
        query = query.filter(SocialProfile.user_id == user.id)
    queue_items = query.order_by(PublishingQueueItem.updated_at.desc(), PublishingQueueItem.created_at.desc()).all()
    by_workflow: dict[uuid.UUID, PublishingQueueItem] = {}
    for item in queue_items:
        if item.workflow_id and item.workflow_id not in by_workflow:
            by_workflow[item.workflow_id] = item
    return by_workflow


def _latest_posts_by_queue(db: Session, queue_item_ids: list[uuid.UUID], user: User) -> dict[uuid.UUID, SocialPost]:
    if not queue_item_ids:
        return {}
    query = (
        db.query(SocialPost)
        .join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
        .filter(SocialPost.queue_item_id.in_(queue_item_ids))
    )
    if not user.is_system_admin:
        query = query.filter(SocialProfile.user_id == user.id)
    posts = query.order_by(SocialPost.published_at.desc(), SocialPost.created_at.desc()).all()
    by_queue: dict[uuid.UUID, SocialPost] = {}
    for post in posts:
        if post.queue_item_id and post.queue_item_id not in by_queue:
            by_queue[post.queue_item_id] = post
    return by_queue


def _episode_publish_rows(
    episode: ContentItem,
    workflow: MediaWorkflow | None,
    queues_by_workflow: dict[uuid.UUID, PublishingQueueItem],
    posts_by_queue: dict[uuid.UUID, SocialPost],
) -> list[dict]:
    source = _primary_source(episode)
    metadata = _source_metadata(source)
    metadata_episodes = metadata.get("episodes") if isinstance(metadata.get("episodes"), list) else []
    if str(source.get("source_type") or "").upper() == "BILIBILI" and metadata_episodes:
        rows = []
        for index, metadata_episode in enumerate(metadata_episodes, start=1):
            if isinstance(metadata_episode, dict):
                rows.append(_episode_publish_row(
                    episode,
                    workflow,
                    queues_by_workflow,
                    posts_by_queue,
                    episode_metadata=metadata_episode,
                    fallback_order=index,
                ))
        if rows:
            return rows
    return [_episode_publish_row(episode, workflow, queues_by_workflow, posts_by_queue)]


def _episode_publish_row(
    episode: ContentItem,
    workflow: MediaWorkflow | None,
    queues_by_workflow: dict[uuid.UUID, PublishingQueueItem],
    posts_by_queue: dict[uuid.UUID, SocialPost],
    *,
    episode_metadata: dict | None = None,
    fallback_order: int | None = None,
) -> dict:
    queue_item = queues_by_workflow.get(workflow.id) if workflow else None
    post = posts_by_queue.get(queue_item.id) if queue_item else None
    publish_status = "NOT_PUBLISHED"
    if post and (post.status or "").lower() == "published":
        publish_status = "PUBLISHED"
    elif queue_item and ((queue_item.status or "").lower() == "published" or queue_item.published_at):
        publish_status = "PUBLISHED"
    elif queue_item:
        publish_status = "QUEUED"
    elif workflow:
        publish_status = "WORKFLOW_READY"

    source = _primary_source(episode)
    metadata = episode_metadata if isinstance(episode_metadata, dict) else {}
    return {
        "content_id": str(episode.id),
        "title": metadata.get("title") or episode.canonical_title,
        "summary": metadata.get("description") or episode.summary,
        "episode_order": _safe_int(metadata.get("episode_index")) or episode.episode_order or fallback_order,
        "content_status": episode.status,
        "source_type": source.get("source_type") or _episode_source_type(episode),
        "source_url": metadata.get("url") or source.get("source_url") or episode.canonical_url,
        "thumbnail_url": metadata.get("thumbnail_url") or _thumbnail_url(episode),
        "publish_status": publish_status,
        "workflow_id": str(workflow.id) if workflow else None,
        "workflow_status": workflow.status if workflow else None,
        "queue_item_id": str(queue_item.id) if queue_item else None,
        "queue_status": queue_item.status if queue_item else None,
        "scheduled_at": queue_item.scheduled_at if queue_item else None,
        "published_at": (post.published_at if post else queue_item.published_at if queue_item else None),
        "post_id": str(post.id) if post else None,
        "post_url": post.post_url if post else None,
        "platform": (post.profile.platform if post and post.profile else queue_item.platform if queue_item else None),
        "profile_name": (
            post.profile.profile_name
            if post and post.profile
            else queue_item.profile.profile_name
            if queue_item and queue_item.profile
            else workflow.profile.profile_name
            if workflow and workflow.profile
            else None
        ),
    }


def _primary_source(content: ContentItem) -> dict:
    sources = content.sources_jsonb or []
    return sources[0] if sources and isinstance(sources[0], dict) else {}


def _source_metadata(primary_source: dict) -> dict:
    metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def _episode_source_type(content: ContentItem) -> str | None:
    source_type = _primary_source(content).get("source_type")
    return str(source_type) if source_type else None


def _thumbnail_url(content: ContentItem) -> str | None:
    media_items = content.media_jsonb or []
    for media in media_items:
        if isinstance(media, dict) and media.get("thumbnail_url"):
            return str(media.get("thumbnail_url"))
    return None


def _content_source_type(content: ContentItem | None) -> str:
    if not content:
        return ""
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary = sources[0] if sources and isinstance(sources[0], dict) else {}
    return str(primary.get("source_type") or "").upper()


def _fallback_series_contents(db: Session, user: User, *, exclude_content_ids: set[uuid.UUID]) -> list[ContentItem]:
    query = db.query(ContentItem)
    if not user.is_system_admin:
        private_content_ids = _private_content_ids_for_user(user.id)
        query = query.filter(
            or_(
                ContentItem.content_scope == "GLOBAL",
                and_(ContentItem.content_scope == "PRIVATE", ContentItem.id.in_(private_content_ids)),
            )
        )
    query = query.order_by(ContentItem.updated_at.desc()).limit(300)
    rows = []
    for content in query.all():
        if content.id in exclude_content_ids:
            continue
        source = _primary_source(content)
        metadata = _source_metadata(source)
        source_type = str(source.get("source_type") or "").upper()
        episodes = metadata.get("episodes") if isinstance(metadata.get("episodes"), list) else []
        if source_type == "BILIBILI" and (episodes or str(content.content_type or "").upper() in {"PLAYLIST", "VIDEO"}):
            rows.append(content)
    return rows[:100]


def _safe_int(value) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None
