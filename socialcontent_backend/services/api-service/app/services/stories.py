from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from common.db.models import ContentItem, CrawlJob, CrawlJobContent, KafkaTask, MediaWorkflow, PublishingQueueItem, SocialPost, SocialProfile, Story, User

VIDEO_RUN_TYPES = {
    "GENERATE_VIDEO_SCRIPT", "GENERATE_VIDEO_EDIT", "GENERATE_VIDEO_REVIEW",
    "GENERATE_VIDEO_VOICE", "GENERATE_VIDEO_RENDER", "BILIBILI_OCR_EPISODE",
    "BILIBILI_RENDER_TASK",
}
ACTIVE_TASK_STATUSES = {"PENDING", "QUEUED", "RUNNING", "PROCESSING"}
ACTIVE_WORKFLOW_STATUSES = {"PROCESSING", "SCRIPTING", "EDITING", "REVIEWING", "VOICE_READY", "RENDERING"}


def list_stories(db: Session, user: User) -> list[Story]:
    return visible_stories_query(db, user).order_by(Story.updated_at.desc()).limit(100).all()


def get_story(db: Session, story_id: uuid.UUID, user: User) -> Story:
    return get_visible_story(db, story_id, user)


def story_episodes(db: Session, story_id: uuid.UUID, user: User) -> list[ContentItem]:
    get_visible_story(db, story_id, user)
    return (
        db.query(ContentItem)
        .filter(ContentItem.story_id == story_id)
        .order_by(ContentItem.episode_order.asc().nullslast())
        .all()
    )


def story_publish_status(db: Session, user: User) -> dict:
    stories = visible_stories_query(db, user).order_by(Story.updated_at.desc()).limit(100).all()
    story_ids = [story.id for story in stories]
    episodes = (
        db.query(ContentItem)
        .filter(ContentItem.story_id.in_(story_ids))
        .order_by(ContentItem.story_id.asc(), ContentItem.episode_order.asc().nullslast(), ContentItem.created_at.asc())
        .all()
        if story_ids else []
    )
    episodes_by_story: dict[uuid.UUID, list[ContentItem]] = {story_id: [] for story_id in story_ids}
    episode_ids_by_story: dict[uuid.UUID, set[uuid.UUID]] = {story_id: set() for story_id in story_ids}
    for episode in episodes:
        if episode.story_id:
            episodes_by_story.setdefault(episode.story_id, []).append(episode)
            episode_ids_by_story.setdefault(episode.story_id, set()).add(episode.id)
    fallback_story_content_ids = {
        story.content_id for story in stories
        if story.content_id and story.content_id not in episode_ids_by_story.get(story.id, set())
    }
    fallback_story_contents = (
        db.query(ContentItem).filter(ContentItem.id.in_(fallback_story_content_ids)).all()
        if fallback_story_content_ids else []
    )
    fallback_contents_by_id = {content.id: content for content in fallback_story_contents}
    for story in stories:
        content = fallback_contents_by_id.get(story.content_id)
        if content:
            episodes_by_story.setdefault(story.id, []).insert(0, content)
            episodes.append(content)

    fallback_contents = fallback_series_contents(db, user, exclude_content_ids={episode.id for episode in episodes})
    all_content_rows = [*episodes, *fallback_contents]
    content_ids = [episode.id for episode in all_content_rows]
    workflows_by_content = workflows_by_content_id(db, content_ids, user)
    workflow_ids = [workflow.id for workflows in workflows_by_content.values() for workflow in workflows]
    tasks_by_workflow = latest_tasks_by_workflow(db, workflow_ids)
    queues_by_workflow = latest_queue_items_by_workflow(db, workflow_ids, user)
    posts_by_queue = latest_posts_by_queue(db, [item.id for item in queues_by_workflow.values()], user)

    items = []
    for story in stories:
        story_episodes = episodes_by_story.get(story.id, [])
        episode_rows = []
        for episode in story_episodes:
            episode_rows.extend(episode_publish_rows(episode, workflows_by_content.get(episode.id), tasks_by_workflow, queues_by_workflow, posts_by_queue))
        items.append({
            "id": str(story.id),
            "canonical_name": story.canonical_name,
            "normalized_name": story.normalized_name,
            "language": story.language,
            "completion_status": story.completion_status,
            "grouping_confidence": float(story.grouping_confidence or 0),
            "total_episodes": len(story_episodes) or story.total_episodes,
            "published_count": sum(1 for row in episode_rows if row["publish_status"] == "PUBLISHED"),
            "in_progress_count": sum(1 for row in episode_rows if is_episode_in_progress(row)),
            "unpublished_count": sum(1 for row in episode_rows if row["publish_status"] == "NOT_PUBLISHED"),
            "source_type": episode_source_type(story_episodes[0]) if story_episodes else None,
            "created_at": story.created_at,
            "updated_at": story.updated_at,
            "episodes": episode_rows,
        })
    for content in fallback_contents:
        source = primary_source(content)
        metadata = source_metadata(source)
        episode_rows = episode_publish_rows(content, workflows_by_content.get(content.id), tasks_by_workflow, queues_by_workflow, posts_by_queue)
        items.append({
            "id": f"content:{content.id}",
            "canonical_name": metadata.get("season_title") or metadata.get("series_title") or content.canonical_title,
            "normalized_name": f"content:{content.id}",
            "language": content.language,
            "completion_status": "UNKNOWN",
            "grouping_confidence": 0,
            "total_episodes": len(episode_rows) or safe_int(metadata.get("episode_count")) or 1,
            "published_count": sum(1 for row in episode_rows if row["publish_status"] == "PUBLISHED"),
            "in_progress_count": sum(1 for row in episode_rows if is_episode_in_progress(row)),
            "unpublished_count": sum(1 for row in episode_rows if row["publish_status"] == "NOT_PUBLISHED"),
            "source_type": source.get("source_type"),
            "created_at": content.created_at,
            "updated_at": content.updated_at,
            "episodes": episode_rows,
        })
    return {"items": items}
def private_content_ids_for_user(user_id: uuid.UUID):
    return (
        select(CrawlJobContent.content_id)
        .join(CrawlJob, CrawlJob.id == CrawlJobContent.job_id)
        .where(
            CrawlJob.requested_by == user_id,
            CrawlJob.content_scope == "PRIVATE",
        )
    )


def visible_stories_query(db: Session, user: User):
    query = db.query(Story)
    if not user.is_system_admin:
        private_content_ids = private_content_ids_for_user(user.id)
        query = query.join(ContentItem, ContentItem.id == Story.content_id).filter(
            or_(
                ContentItem.content_scope == "GLOBAL",
                and_(ContentItem.content_scope == "PRIVATE", ContentItem.id.in_(private_content_ids)),
            )
        )
    return query


def get_visible_story(db: Session, story_id: uuid.UUID, user: User) -> Story:
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


def workflows_by_content_id(db: Session, content_ids: list[uuid.UUID], user: User) -> dict[uuid.UUID, list[MediaWorkflow]]:
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
    by_content: dict[uuid.UUID, list[MediaWorkflow]] = {}
    for workflow in workflows:
        if workflow.primary_content_id:
            by_content.setdefault(workflow.primary_content_id, []).append(workflow)
    return by_content


def latest_tasks_by_workflow(db: Session, workflow_ids: list[uuid.UUID]) -> dict[uuid.UUID, KafkaTask]:
    if not workflow_ids:
        return {}
    tasks = (
        db.query(KafkaTask)
        .filter(
            KafkaTask.reference_type == "media_workflow",
            KafkaTask.reference_id.in_(workflow_ids),
            KafkaTask.task_type.in_(VIDEO_RUN_TYPES),
        )
        .order_by(KafkaTask.created_at.desc())
        .all()
    )
    by_workflow: dict[uuid.UUID, KafkaTask] = {}
    for task in tasks:
        if not task.reference_id:
            continue
        current = by_workflow.get(task.reference_id)
        if not current:
            by_workflow[task.reference_id] = task
            continue
        if str(current.status or "").upper() not in ACTIVE_TASK_STATUSES and str(task.status or "").upper() in ACTIVE_TASK_STATUSES:
            by_workflow[task.reference_id] = task
    return by_workflow


def latest_queue_items_by_workflow(db: Session, workflow_ids: list[uuid.UUID], user: User) -> dict[uuid.UUID, PublishingQueueItem]:
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


def latest_posts_by_queue(db: Session, queue_item_ids: list[uuid.UUID], user: User) -> dict[uuid.UUID, SocialPost]:
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


def episode_publish_rows(
    episode: ContentItem,
    workflows: list[MediaWorkflow] | None,
    tasks_by_workflow: dict[uuid.UUID, KafkaTask],
    queues_by_workflow: dict[uuid.UUID, PublishingQueueItem],
    posts_by_queue: dict[uuid.UUID, SocialPost],
) -> list[dict]:
    source = primary_source(episode)
    metadata = source_metadata(source)
    metadata_episodes = metadata.get("episodes") if isinstance(metadata.get("episodes"), list) else []
    if str(source.get("source_type") or "").upper() == "BILIBILI" and metadata_episodes:
        rows = []
        for index, metadata_episode in enumerate(metadata_episodes, start=1):
            if isinstance(metadata_episode, dict):
                episode_order = safe_int(metadata_episode.get("episode_index")) or index
                workflow = workflow_for_episode(workflows or [], episode_order)
                rows.append(episode_publish_row(
                    episode,
                    workflow,
                    tasks_by_workflow,
                    queues_by_workflow,
                    posts_by_queue,
                    episode_metadata=metadata_episode,
                    fallback_order=index,
                ))
        if rows:
            return rows
    return [episode_publish_row(episode, workflow_for_episode(workflows or [], episode.episode_order), tasks_by_workflow, queues_by_workflow, posts_by_queue)]


def episode_publish_row(
    episode: ContentItem,
    workflow: MediaWorkflow | None,
    tasks_by_workflow: dict[uuid.UUID, KafkaTask],
    queues_by_workflow: dict[uuid.UUID, PublishingQueueItem],
    posts_by_queue: dict[uuid.UUID, SocialPost],
    *,
    episode_metadata: dict | None = None,
    fallback_order: int | None = None,
) -> dict:
    queue_item = queues_by_workflow.get(workflow.id) if workflow else None
    post = posts_by_queue.get(queue_item.id) if queue_item else None
    task = tasks_by_workflow.get(workflow.id) if workflow else None
    active_task = task if task and str(task.status or "").upper() in ACTIVE_TASK_STATUSES else None
    artifacts = workflow.artifacts_jsonb if workflow and isinstance(workflow.artifacts_jsonb, list) else []
    publish_status = "NOT_PUBLISHED"
    if post and (post.status or "").lower() == "published":
        publish_status = "PUBLISHED"
    elif queue_item and ((queue_item.status or "").lower() == "published" or queue_item.published_at):
        publish_status = "PUBLISHED"
    elif queue_item:
        publish_status = "QUEUED"
    elif workflow:
        publish_status = "WORKFLOW_READY"

    source = primary_source(episode)
    metadata = episode_metadata if isinstance(episode_metadata, dict) else {}
    return {
        "content_id": str(episode.id),
        "title": metadata.get("title") or episode.canonical_title,
        "summary": metadata.get("description") or episode.summary,
        "episode_order": safe_int(metadata.get("episode_index")) or episode.episode_order or fallback_order,
        "content_status": episode.status,
        "source_type": source.get("source_type") or episode_source_type(episode),
        "source_url": metadata.get("url") or source.get("source_url") or episode.canonical_url,
        "thumbnail_url": metadata.get("thumbnail_url") or thumbnail_url(episode),
        "publish_status": publish_status,
        "workflow_id": str(workflow.id) if workflow else None,
        "workflow_status": workflow.status if workflow else None,
        "workflow_current_stage": (active_task.current_stage if active_task else workflow.current_stage if workflow else None),
        "workflow_progress_percent": float(active_task.progress_percent if active_task else workflow.progress_percent if workflow else 0),
        "workflow_task_id": str(task.id) if task else None,
        "workflow_task_type": task.task_type if task else None,
        "workflow_task_status": task.status if task else None,
        "workflow_error_message": task.error_message if task and str(task.status or "").upper() == "FAILED" else None,
        "workflow_final_video": final_video_uri(artifacts),
        "workflow_updated_at": workflow.updated_at if workflow else None,
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


def workflow_for_episode(workflows: list[MediaWorkflow], episode_index: int | None) -> MediaWorkflow | None:
    if not workflows:
        return None
    if episode_index:
        for workflow in workflows:
            indices = workflow_episode_indices(workflow)
            if indices and episode_index in indices:
                return workflow
    for workflow in workflows:
        if not workflow_episode_indices(workflow):
            return workflow
    return workflows[0]


def workflow_episode_indices(workflow: MediaWorkflow) -> set[int]:
    metadata = workflow.metadata_json if isinstance(workflow.metadata_json, dict) else {}
    indices = metadata.get("target_episode_indices")
    if isinstance(indices, list):
        return {int(value) for value in indices if safe_int(value)}
    indices_text = str(metadata.get("bilibili_episode_indices") or "")
    return {int(value) for value in indices_text.replace(";", ",").split(",") if safe_int(value)}


def final_video_uri(artifacts: list[dict]) -> str | None:
    candidates = [
        item for item in artifacts
        if isinstance(item, dict)
        and item.get("uri")
        and item.get("status") != "STALE"
        and (item.get("type") == "FINAL_VIDEO" or item.get("artifact_type") == "FINAL_VIDEO")
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return str(candidates[0]["uri"])


def is_episode_in_progress(row: dict) -> bool:
    if row.get("publish_status") == "QUEUED":
        return True
    if str(row.get("workflow_task_status") or "").upper() in ACTIVE_TASK_STATUSES:
        return True
    return str(row.get("workflow_status") or "").upper() in ACTIVE_WORKFLOW_STATUSES


def primary_source(content: ContentItem) -> dict:
    sources = content.sources_jsonb or []
    return sources[0] if sources and isinstance(sources[0], dict) else {}


def source_metadata(primary_source: dict) -> dict:
    metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def episode_source_type(content: ContentItem) -> str | None:
    source_type = primary_source(content).get("source_type")
    return str(source_type) if source_type else None


def thumbnail_url(content: ContentItem) -> str | None:
    media_items = content.media_jsonb or []
    for media in media_items:
        if isinstance(media, dict) and media.get("thumbnail_url"):
            return str(media.get("thumbnail_url"))
    return None


def fallback_series_contents(db: Session, user: User, *, exclude_content_ids: set[uuid.UUID]) -> list[ContentItem]:
    query = db.query(ContentItem)
    if not user.is_system_admin:
        private_content_ids = private_content_ids_for_user(user.id)
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
        source = primary_source(content)
        metadata = source_metadata(source)
        source_type = str(source.get("source_type") or "").upper()
        episodes = metadata.get("episodes") if isinstance(metadata.get("episodes"), list) else []
        if source_type == "BILIBILI" and (episodes or str(content.content_type or "").upper() in {"PLAYLIST", "VIDEO"}):
            rows.append(content)
    return rows[:100]


def safe_int(value) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None
