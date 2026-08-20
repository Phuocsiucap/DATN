from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.services import generate_video as pipeline
from app.api.deps import get_current_user
from common.db.models import (
    ContentItem,
    ContentMedia,
    ContentPlan,
    ContentProject,
    ContentSource,
    Episode,
    ProjectRun,
    PublishingQueueItem,
    SocialProfile,
    SocialProfileStrategy,
    Story,
    User,
    VideoDraft,
)
from common.db.session import get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import GENERATE_VIDEO_RENDER_REQUESTED, GENERATE_VIDEO_SCRIPT_REQUESTED


router = APIRouter()

DEFAULT_SHARED_VOICE = {
    "voice_id": "pNInz6obpgDQGcFmaJgB",
    "name": "Adam",
    "description": "Default fallback voice. ElevenLabs shared voice discovery is currently unavailable.",
    "category": "premade",
    "language": "vi",
}


class CreateStoryRequest(BaseModel):
    source: dict


class StoryRequest(BaseModel):
    story: dict | None = None
    project_id: uuid.UUID | None = None


class EditStoryRequest(BaseModel):
    story: dict | None = None
    project_id: uuid.UUID | None = None
    prompt: str


class ReviewStoryRequest(BaseModel):
    story: dict | None = None
    project_id: uuid.UUID | None = None
    instructions: str | None = None


class VoiceRequest(BaseModel):
    story: dict | None = None
    project_id: uuid.UUID | None = None
    voice_id: str | None = None
    voice_speed: float = 1.0
    voice_provider: str | None = None


class GenerateVideoRequest(BaseModel):
    story: dict | None = None
    project_id: uuid.UUID | None = None


class AudioUploadRequest(BaseModel):
    filename: str
    content_base64: str


class QueueRenderedVideoRequest(BaseModel):
    scheduled_at: datetime | None = None
    caption: str | None = None
    status: str | None = None


@router.get("/voices")
def list_elevenlabs_shared_voices(
    search: str | None = None,
    sort: str = "trending",
    page_size: int = Query(default=30, ge=1, le=100),
    page: int = Query(default=0, ge=0),
):
    params = {
        "sort": sort,
        "page_size": page_size,
        "page": page,
        "explore_source": "tts_explore_tab",
    }
    if search:
        params["search"] = search
    headers = {}
    api_key = pipeline.get_elevenlabs_api_key()
    if api_key:
        headers["xi-api-key"] = api_key
    try:
        response = httpx.get(
            "https://api.us.elevenlabs.io/v1/shared-voices",
            params=params,
            headers=headers,
            timeout=20,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as error:
        detail = error.response.text if getattr(error, "response", None) is not None else str(error)
        return {
            "voices": [DEFAULT_SHARED_VOICE],
            "has_more": False,
            "total_count": 1,
            "fallback": True,
            "error": detail,
        }


@router.post("/create-story")
def create_story(payload: CreateStoryRequest):
    try:
        story = pipeline.create_story_from_raw(payload.source)
        return _story_script_preview(story)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/projects/{project_id}/create-story")
def create_story_from_project(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, project_id, user)
    try:
        source = _build_project_story_source(
            db,
            project,
            db.get(ContentPlan, project.content_plan_id) if project.content_plan_id else None,
            project.metadata_json if isinstance(project.metadata_json, dict) else {},
        )
        existing = (
            db.query(ProjectRun)
            .filter(ProjectRun.project_id == project.id, ProjectRun.run_type == "GENERATE_VIDEO_SCRIPT", ProjectRun.status.in_(["QUEUED", "RUNNING"]))
            .order_by(ProjectRun.created_at.desc())
            .first()
        )
        if existing:
            return {"job": _serialize_project_run(db, existing)}

        job = ProjectRun(
            project_id=project.id,
            run_type="GENERATE_VIDEO_SCRIPT",
            status="QUEUED",
            progress_percent=0,
            metadata_json={"source": source},
        )
        project.status = "SCRIPTING"
        db.add_all([job, project])
        db.commit()
        db.refresh(job)
        publish(
            GENERATE_VIDEO_SCRIPT_REQUESTED,
            build_event(
                event_type=GENERATE_VIDEO_SCRIPT_REQUESTED,
                source="api-service",
                job_id=job.id,
                payload={"project_id": str(project.id), "run_type": job.run_type},
                correlation_id=project.id,
            ),
        )
        return {"job": _serialize_project_run(db, job)}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


def _public_story(story: dict) -> dict:
    return pipeline.public_story_payload(story)


def _story_script_preview(story: dict) -> dict:
    public_story = pipeline.public_story_payload(story)
    return {
        "meta": public_story.get("meta") or {},
        "video": public_story.get("video"),
        "audio": public_story.get("audio"),
        "timeline": public_story.get("timeline") or {},
    }


def _get_owned_project(db: Session, project_id: uuid.UUID, user: User) -> ContentProject:
    project = db.get(ContentProject, project_id)
    if not project or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content project not found")
    return project


def _create_story_from_project_source(db: Session, project: ContentProject) -> dict:
    plan = db.get(ContentPlan, project.content_plan_id) if project.content_plan_id else None
    metadata = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    return pipeline.create_story_from_raw(_build_project_story_source(db, project, plan, metadata))


def _build_project_story_source(db: Session, project: ContentProject, plan: ContentPlan | None, metadata: dict) -> dict:
    parts = sorted(project.parts, key=lambda item: item.part_number)
    content_ids = _project_content_ids(db, project, plan, parts)
    contents = db.query(ContentItem).filter(ContentItem.id.in_(content_ids)).all() if content_ids else []
    media = (
        db.query(ContentMedia)
        .filter(ContentMedia.content_id.in_(content_ids))
        .order_by(ContentMedia.created_at.asc())
        .all()
        if content_ids
        else []
    )
    sources = (
        db.query(ContentSource)
        .filter(ContentSource.content_id.in_(content_ids))
        .order_by(ContentSource.is_primary.desc(), ContentSource.first_seen_at.desc())
        .all()
        if content_ids
        else []
    )
    media_payload = [_serialize_content_media(item) for item in media]
    image_urls = _merge_unique(
        [
            str(item.get("storage_url") or item.get("source_url") or item.get("thumbnail_url") or "")
            for item in media_payload
            if str(item.get("media_type") or "").upper() in {"IMAGE", "THUMBNAIL"} or not item.get("media_type")
        ]
    )
    primary_content = _primary_project_content(project, plan, contents)
    source_content = _serialize_source_content(primary_content, sources, media_payload) if primary_content else None
    return {
        "title": (plan.title if plan else None) or project.title,
        "summary": (plan.content_angle if plan else None) or metadata.get("content_angle") or metadata.get("summary") or (primary_content.summary if primary_content else ""),
        "content": metadata,
        "plan": _serialize_project_plan(plan, metadata),
        "target_duration_seconds": plan.target_duration_seconds if plan else metadata.get("target_duration_seconds"),
        "parts": [_serialize_project_part(part) for part in parts],
        "images": image_urls,
        "media": media_payload,
        "raw_article": {
            "source_content": source_content,
        },
    }


def _project_content_ids(db: Session, project: ContentProject, plan: ContentPlan | None, parts: list) -> list[uuid.UUID]:
    content_ids: list[uuid.UUID] = []
    for value in [project.primary_content_id, plan.primary_content_id if plan else None]:
        if value:
            content_ids.append(value)
    for part in parts:
        payload = part.payload if isinstance(part.payload, dict) else {}
        for ref in payload.get("source_refs") or []:
            if not isinstance(ref, dict):
                continue
            if ref.get("content_id"):
                content_ids.append(uuid.UUID(str(ref["content_id"])))
            if ref.get("episode_id"):
                episode = db.get(Episode, uuid.UUID(str(ref["episode_id"])))
                if episode and episode.content_id:
                    content_ids.append(episode.content_id)
            if ref.get("story_id"):
                story = db.get(Story, uuid.UUID(str(ref["story_id"])))
                if story and story.content_id:
                    content_ids.append(story.content_id)
    return list(dict.fromkeys(content_ids))


def _serialize_project_plan(plan: ContentPlan | None, metadata: dict) -> dict:
    if not plan:
        return {
            "content_angle": metadata.get("content_angle"),
            "target_audience": metadata.get("target_audience"),
            "tone": metadata.get("tone"),
            "format": metadata.get("format"),
            "risk_level": metadata.get("risk_level"),
            "production_requirements": metadata.get("production_requirements") or {},
            "target_duration_seconds": metadata.get("target_duration_seconds"),
        }
    return {
        "id": str(plan.id),
        "title": plan.title,
        "content_angle": plan.content_angle,
        "target_audience": plan.target_audience,
        "tone": plan.tone,
        "format": plan.format,
        "planning_mode": plan.planning_mode,
        "target_duration_seconds": plan.target_duration_seconds,
        "recommended_part_count": plan.recommended_part_count,
        "production_requirements": plan.production_requirements or {},
        "ai_reasoning": plan.ai_reasoning or [],
        "risk_level": plan.risk_level,
    }


def _serialize_project_part(part) -> dict:
    payload = part.payload if isinstance(part.payload, dict) else {}
    return {
        **payload,
        "id": str(part.id),
        "series_id": str(part.series_id) if part.series_id else None,
        "part_number": part.part_number,
        "title": part.title,
        "target_duration_seconds": part.target_duration_seconds if part.target_duration_seconds is not None else payload.get("target_duration_seconds"),
        "status": part.status,
    }


def _primary_project_content(project: ContentProject, plan: ContentPlan | None, contents: list[ContentItem]) -> ContentItem | None:
    by_id = {item.id: item for item in contents}
    for content_id in [project.primary_content_id, plan.primary_content_id if plan else None]:
        if content_id and content_id in by_id:
            return by_id[content_id]
    return contents[0] if contents else None


def _serialize_source_content(content: ContentItem, sources: list[ContentSource], media: list[dict]) -> dict:
    content_sources = [source for source in sources if source.content_id == content.id]
    primary_source = next((source for source in content_sources if source.is_primary), None) or (content_sources[0] if content_sources else None)
    return {
        "id": str(content.id),
        "content_type": content.content_type,
        "canonical_title": content.canonical_title,
        "summary": content.summary,
        "full_text": _load_content_full_text(content_sources),
        "language": content.language,
        "status": content.status,
        "canonical_url": content.canonical_url,
        "source_url": primary_source.source_url if primary_source else content.canonical_url,
        "quality_score": float(content.quality_score or 0),
        "published_at": content.published_at,
        "created_at": content.created_at.isoformat() if content.created_at else None,
        "updated_at": content.updated_at.isoformat() if content.updated_at else None,
        "media": [item for item in media if item.get("content_id") == str(content.id)],
    }


def _load_content_full_text(sources: list[ContentSource]) -> str | None:
    try:
        from bson import ObjectId
        from common.db.mongo import processed_documents, raw_documents

        proc_coll = processed_documents()
        raw_coll = raw_documents()
        for source in sources:
            metadata = dict(source.metadata_json or {})
            proc_id_str = metadata.get("processed_document_id")
            if proc_id_str:
                try:
                    proc_doc = proc_coll.find_one({"_id": ObjectId(proc_id_str)})
                    normalized = proc_doc.get("normalized") if isinstance(proc_doc, dict) else None
                    if isinstance(normalized, dict):
                        full_text = normalized.get("content") or normalized.get("description")
                        if full_text:
                            return str(full_text)
                except Exception:
                    pass
            if source.raw_document_id:
                try:
                    raw_doc = raw_coll.find_one({"_id": ObjectId(source.raw_document_id)})
                    raw = raw_doc.get("raw") if isinstance(raw_doc, dict) else None
                    if isinstance(raw, dict):
                        full_text = raw.get("text") or raw.get("raw_text")
                        if full_text:
                            return str(full_text)
                except Exception:
                    pass
    except Exception as exc:
        print("Error fetching full text for Generate Video project source:", exc)
    return None


def _serialize_content_media(item: ContentMedia) -> dict:
    return {
        "id": str(item.id),
        "content_id": str(item.content_id),
        "media_type": item.media_type,
        "source_url": item.source_url,
        "storage_url": item.storage_url,
        "thumbnail_url": item.thumbnail_url,
        "mime_type": item.mime_type,
        "width": item.width,
        "height": item.height,
        "duration_seconds": item.duration_seconds,
        "checksum": item.checksum,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def _merge_unique(values: list) -> list[str]:
    return list(dict.fromkeys(str(item).strip() for item in values if str(item or "").strip()))


def _persist_project_story(db: Session, project: ContentProject, story: dict, status: str | None = None) -> None:
    public_story = _public_story(story)
    public_story.setdefault("meta", {})
    public_story["meta"]["project_id"] = str(project.id)
    public_story["project_status"] = _project_status(public_story)
    draft = _upsert_project_video_draft(db, project, public_story)
    project.video_draft_id = draft.id
    project.status = status or _project_status(public_story)
    db.add(project)
    db.commit()


def _profile_strategy(db: Session, project: ContentProject) -> SocialProfileStrategy | None:
    profile = db.get(SocialProfile, project.profile_id)
    return profile.strategy if profile else None


def _maybe_enqueue_auto_project_render(db: Session, project: ContentProject, story: dict, *, trigger: str) -> ProjectRun | None:
    strategy = _profile_strategy(db, project)
    if getattr(strategy, "video_render_mode", "manual") != "auto":
        return None
    return _enqueue_project_render_job(db, project, story, trigger=trigger, mode="auto")


def _enqueue_project_render_job(db: Session, project: ContentProject, story: dict, *, trigger: str, mode: str) -> ProjectRun:
    existing = (
        db.query(ProjectRun)
        .filter(ProjectRun.project_id == project.id, ProjectRun.run_type == "GENERATE_VIDEO_RENDER", ProjectRun.status.in_(["QUEUED", "RUNNING"]))
        .order_by(ProjectRun.created_at.desc())
        .first()
    )
    if existing:
        return existing

    render_story = _public_story(story)
    render_story.setdefault("meta", {})
    render_story["meta"]["project_id"] = str(project.id)
    job = ProjectRun(
        project_id=project.id,
        run_type="GENERATE_VIDEO_RENDER",
        status="QUEUED",
        progress_percent=0,
        metadata_json={"story": render_story, "trigger": trigger, "video_render_mode": mode},
    )
    db.add(job)
    project.status = "RENDERING"
    db.add(project)
    db.commit()
    db.refresh(job)
    publish(
        GENERATE_VIDEO_RENDER_REQUESTED,
        build_event(
            event_type=GENERATE_VIDEO_RENDER_REQUESTED,
            source="api-service",
            job_id=job.id,
            payload={"project_id": str(project.id), "run_type": job.run_type, "trigger": trigger},
            correlation_id=project.id,
        ),
    )
    return job


def _preserve_saved_source(db: Session, project: ContentProject, story: dict) -> dict:
    if not isinstance(story, dict):
        return story
    if isinstance(story.get("source"), dict) and story["source"]:
        return story
    saved_story = _find_video_draft_for_project(db, project)
    saved_source = saved_story.get("source") if isinstance(saved_story, dict) and isinstance(saved_story.get("source"), dict) else None
    if not saved_source:
        return story
    next_story = dict(story)
    next_story["source"] = saved_source
    return next_story


def _project_status(story: dict) -> str:
    artifacts = story.get("video_artifacts") if isinstance(story.get("video_artifacts"), dict) else {}
    audio = story.get("audio") if isinstance(story.get("audio"), dict) else {}
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    if artifacts.get("final"):
        return "RENDERED"
    if audio.get("voice") or any(isinstance(clip, dict) and str(clip.get("type") or "").lower() == "voice" for clip in timeline.get("audio") or []):
        return "VOICE_READY"
    if timeline.get("video") or timeline.get("text"):
        return "EDITING"
    return "READY"


@router.post("/projects/{project_id}/approve-video")
def approve_project_video(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, project_id, user)
    story = _find_video_draft_for_project(db, project)
    rendered_video = _rendered_video_uri(project, story)
    if not rendered_video:
        raise HTTPException(status_code=400, detail="Project chưa có MP4 để duyệt")

    metadata = dict(project.metadata_json or {})
    metadata["video_approved"] = True
    metadata["video_approved_at"] = datetime.utcnow().isoformat()
    metadata["video_approved_by"] = str(user.id)
    project.metadata_json = metadata
    project.status = "VIDEO_APPROVED"
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"project_id": project.id, "status": project.status, "rendered_video": rendered_video}


@router.post("/projects/{project_id}/queue-post")
def queue_project_video_for_posting(
    project_id: uuid.UUID,
    payload: QueueRenderedVideoRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, project_id, user)
    profile = db.get(SocialProfile, project.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Social profile not found")

    story = _find_video_draft_for_project(db, project)
    rendered_video = _rendered_video_uri(project, story)
    if not rendered_video:
        raise HTTPException(status_code=400, detail="Project chưa có MP4 để đưa vào queue")

    metadata = dict(project.metadata_json or {})
    if not metadata.get("video_approved"):
        raise HTTPException(status_code=400, detail="Video cần được duyệt trước khi đưa vào queue")

    requested_status = (payload.status if payload else None) or "queued"
    if requested_status not in {"queued", "needs_approval", "approved"}:
        raise HTTPException(status_code=400, detail="Trạng thái queue không hợp lệ")

    scheduled_at = (payload.scheduled_at if payload else None) or _default_scheduled_at(profile)
    caption = (payload.caption if payload else None) or _default_video_caption(project, story)
    item = PublishingQueueItem(
        user_id=user.id,
        profile_id=profile.id,
        content_id=project.primary_content_id,
        article_link=rendered_video,
        article_title=project.title,
        platform=profile.platform,
        generated_content=caption,
        ai_reason="Queued from approved Generate Video render",
        status=requested_status,
        scheduled_at=scheduled_at,
    )
    db.add(item)
    db.flush()
    metadata["queued_post_id"] = str(item.id)
    metadata["queued_at"] = datetime.utcnow().isoformat()
    project.metadata_json = metadata
    project.status = "QUEUED_FOR_PUBLISHING"
    db.add(project)
    db.commit()
    db.refresh(item)
    db.refresh(project)
    return {
        "project_id": project.id,
        "status": project.status,
        "queue_item": {
            "id": item.id,
            "profile_id": item.profile_id,
            "profile_name": profile.profile_name,
            "article_link": item.article_link,
            "article_title": item.article_title,
            "platform": item.platform,
            "generated_content": item.generated_content,
            "ai_reason": item.ai_reason,
            "status": item.status,
            "scheduled_at": item.scheduled_at,
            "published_at": item.published_at,
            "error": item.error,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        },
    }


def _rendered_video_uri(project: ContentProject, story: dict | None) -> str | None:
    artifact = next(
        (
            item
            for item in sorted(project.artifacts or [], key=lambda value: value.created_at, reverse=True)
            if item.artifact_type == "FINAL_VIDEO" and item.uri
        ),
        None,
    )
    if artifact:
        return artifact.uri
    metadata = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    if metadata.get("rendered_video"):
        return str(metadata["rendered_video"])
    artifacts = story.get("video_artifacts") if isinstance(story, dict) and isinstance(story.get("video_artifacts"), dict) else {}
    return str(artifacts.get("final")) if artifacts.get("final") else None


def _default_scheduled_at(profile: SocialProfile) -> datetime:
    strategy = profile.strategy
    if not strategy:
        return datetime.utcnow() + timedelta(hours=1)
    times = [item.strip() for item in str(strategy.schedule_times or "").split(",") if item.strip()]
    now = datetime.utcnow()
    if not times:
        return now + timedelta(hours=1)
    for day_offset in range(0, 8):
        candidate_day = now + timedelta(days=day_offset)
        for value in times:
            try:
                hour, minute = [int(part) for part in value.split(":", 1)]
            except ValueError:
                continue
            candidate = candidate_day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate > now:
                return candidate
    return now + timedelta(hours=1)


def _default_video_caption(project: ContentProject, story: dict | None) -> str:
    meta = story.get("meta") if isinstance(story, dict) and isinstance(story.get("meta"), dict) else {}
    title = str(meta.get("title") or project.title).strip()
    return title or "Video mới đã sẵn sàng đăng"


@router.get("/projects/{project_id}/story")
def get_saved_project_story(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(db, project_id, user)
    video_project = _find_video_draft_for_project(db, project)
    if video_project:
        return _public_story(video_project)
    raise HTTPException(status_code=404, detail="Story not found for content project")


@router.post("/save-story")
def save_story(
    payload: StoryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.story is None:
        raise HTTPException(status_code=400, detail="Missing story")
    project = _project_from_payload(db, user, payload.project_id, payload.story)
    payload.story = _preserve_saved_source(db, project, payload.story)
    payload.story.setdefault("meta", {})
    payload.story["meta"]["project_id"] = str(project.id)
    payload.story = pipeline.review_story_with_ai(payload.story)
    saved_story = pipeline.normalize_story_for_project(payload.story)
    _persist_project_story(db, project, saved_story)
    auto_render_job = _maybe_enqueue_auto_project_render(db, project, saved_story, trigger="save_story")
    return {
        "story": _public_story(saved_story),
        "auto_render_job": _serialize_project_run(db, auto_render_job) if auto_render_job else None,
    }


@router.post("/edit-story")
def edit_story(
    payload: EditStoryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Missing edit prompt")
    try:
        project = _project_from_payload(db, user, payload.project_id, payload.story)
        story = payload.story or _find_video_draft_for_project(db, project)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found for content project")
        story = _preserve_saved_source(db, project, story)
        edited = pipeline.edit_story_with_ai(story, payload.prompt)
        _persist_project_story(db, project, edited)
        auto_render_job = _maybe_enqueue_auto_project_render(db, project, edited, trigger="edit_story")
        response = _public_story(edited)
        if auto_render_job:
            response["auto_render_job"] = _serialize_project_run(db, auto_render_job)
        return response
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/review-story")
def review_story(
    payload: ReviewStoryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        project = _project_from_payload(db, user, payload.project_id, payload.story)
        story = payload.story or _find_video_draft_for_project(db, project)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found for content project")
        story = _preserve_saved_source(db, project, story)
        story.setdefault("meta", {})
        story["meta"]["project_id"] = str(project.id)
        reviewed = pipeline.review_story_with_ai(story, payload.instructions)
        _persist_project_story(db, project, reviewed)
        auto_render_job = _maybe_enqueue_auto_project_render(db, project, reviewed, trigger="review_story")
        return {
            "story": _public_story(reviewed),
            "review": (reviewed.get("meta") or {}).get("ai_story_review"),
            "auto_render_job": _serialize_project_run(db, auto_render_job) if auto_render_job else None,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/generate-video")
def generate_video(
    payload: GenerateVideoRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        project = _project_from_payload(db, user, payload.project_id, payload.story)
        story = payload.story or _find_video_draft_for_project(db, project)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found for content project")
        story = _preserve_saved_source(db, project, story)
        story = pipeline.normalize_story_for_project(story)
        story.setdefault("meta", {})
        story["meta"]["project_id"] = str(project.id)
        _persist_project_story(db, project, story, status="RENDERING")
        job = _enqueue_project_render_job(db, project, story, trigger="manual_generate_video", mode="manual")
        return {"job": _serialize_project_run(db, job)}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.get("/render-jobs/{job_id}")
def get_render_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = db.get(ProjectRun, job_id)
    if not job or job.project.user_id != user.id or job.run_type not in {"GENERATE_VIDEO_RENDER", "GENERATE_VIDEO_SCRIPT"}:
        raise HTTPException(status_code=404, detail="Render job not found")
    return {"job": _serialize_project_run(db, job)}


def _serialize_project_run(db: Session, job: ProjectRun) -> dict:
    story = _find_video_draft_for_project(db, job.project) or {}
    metadata = job.metadata_json if isinstance(job.metadata_json, dict) else {}
    output_path = metadata.get("output_path")
    return {
        "id": str(job.id),
        "project_id": str(job.project_id),
        "run_type": job.run_type,
        "status": job.status,
        "progress_percent": float(job.progress_percent or 0),
        "output_path": output_path,
        "video_url": f"/api/v1/generate-video/output/{str(output_path).replace('out/', '')}" if output_path else None,
        "error_message": job.error_message,
        "story": _public_story(story) if story else None,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
    }


def _project_from_payload(db: Session, user: User, project_id: uuid.UUID | None, story: dict | None) -> ContentProject:
    candidate_id = project_id or ((story.get("meta") or {}).get("project_id") if isinstance(story, dict) else None)
    if not candidate_id:
        raise HTTPException(status_code=400, detail="Missing project_id")
    return _get_owned_project(db, uuid.UUID(str(candidate_id)), user)


def _draft_project_id(draft_json: dict | None) -> str:
    meta = draft_json.get("meta") if isinstance(draft_json, dict) and isinstance(draft_json.get("meta"), dict) else {}
    return str(meta.get("project_id") or "")


def _find_video_draft_for_project(db: Session | None, project: ContentProject) -> dict | None:
    if db is None:
        return None
    if project.video_draft_id:
        draft = db.get(VideoDraft, project.video_draft_id)
        if draft and draft.user_id == project.user_id and isinstance(draft.draft_json, dict):
            return draft.draft_json
    drafts = (
        db.query(VideoDraft)
        .filter(VideoDraft.user_id == project.user_id)
        .order_by(VideoDraft.updated_at.desc())
        .limit(100)
        .all()
    )
    project_id = str(project.id)
    for draft in drafts:
        draft_json = draft.draft_json if isinstance(draft.draft_json, dict) else {}
        if _draft_project_id(draft_json) == project_id:
            return draft_json
    return None


def _upsert_project_video_draft(db: Session, project: ContentProject, story: dict) -> VideoDraft:
    story.setdefault("meta", {})
    story["meta"]["project_id"] = str(project.id)
    title = str(story.get("meta", {}).get("title") or project.title or f"Video {str(project.id)[:8]}")
    draft = db.get(VideoDraft, project.video_draft_id) if project.video_draft_id else None
    if draft and draft.user_id == project.user_id:
        draft.title = title
        draft.draft_json = story
        db.add(draft)
        return draft
    drafts = (
        db.query(VideoDraft)
        .filter(VideoDraft.user_id == project.user_id)
        .order_by(VideoDraft.updated_at.desc())
        .limit(100)
        .all()
    )
    draft = next((item for item in drafts if _draft_project_id(item.draft_json if isinstance(item.draft_json, dict) else {}) == str(project.id)), None)
    if draft:
        draft.title = title
        draft.draft_json = story
        db.add(draft)
        return draft
    draft = VideoDraft(user_id=project.user_id, title=title, draft_json=story)
    db.add(draft)
    db.flush()
    return draft


@router.post("/emotion-voice")
def emotion_voice(
    payload: VoiceRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        project = _project_from_payload(db, user, payload.project_id, payload.story)
        story = payload.story or _find_video_draft_for_project(db, project)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found for content project")
        story = _preserve_saved_source(db, project, story)
        story = pipeline.review_story_with_ai(story, "Duyệt story lần cuối trước khi tạo voice.")
        result = pipeline.enhance_emotion_and_generate_voice(story, payload.voice_id, payload.voice_speed, payload.voice_provider)
        result_story = result.get("story") or {}
        fit_debug = None
        fit_error = None
        try:
            fit_result = pipeline.fit_frames_with_whisper(result_story)
            result_story = fit_result.get("story") or result_story
            fit_debug = fit_result.get("debug")
        except Exception as error:
            fit_error = str(error)
        _persist_project_story(db, project, result_story)
        auto_render_job = _maybe_enqueue_auto_project_render(db, project, result_story, trigger="emotion_voice")
        return {
            "meta": result_story.get("meta") or {},
            "audio": result_story.get("audio") or {},
            "timeline": result_story.get("timeline") or {},
            "voice_id": result.get("voice_id"),
            "voice_provider": result.get("voice_provider"),
            "voice_speed": result.get("voice_speed"),
            "voice_text": result.get("voice_text"),
            "audio_url": result.get("audio_url"),
            "debug": fit_debug,
            "fit_frame_error": fit_error,
            "auto_render_job": _serialize_project_run(db, auto_render_job) if auto_render_job else None,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/fit-frames")
def fit_frames(
    payload: StoryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        project = _project_from_payload(db, user, payload.project_id, payload.story)
        story = payload.story or _find_video_draft_for_project(db, project)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found for content project")
        story = _preserve_saved_source(db, project, story)
        result = pipeline.fit_frames_with_whisper(story)
        result_story = result.get("story") or {}
        _persist_project_story(db, project, result_story)
        return {
            "meta": result_story.get("meta") or {},
            "audio": result_story.get("audio") or {},
            "timeline": result_story.get("timeline") or {},
            "debug": result.get("debug"),
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/audio/upload")
def upload_audio(payload: AudioUploadRequest):
    try:
        return {"asset_path": pipeline.save_uploaded_audio_base64(payload.filename, payload.content_base64)}
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/media/{asset_path:path}")
def media(asset_path: str):
    path = (pipeline.PUBLIC_DIR / asset_path).resolve()
    public_root = pipeline.PUBLIC_DIR.resolve()
    if not str(path).startswith(str(public_root)) or not path.exists():
        raise HTTPException(status_code=404, detail="Media not found")
    return FileResponse(path)


@router.get("/output/{output_path:path}")
def output(output_path: str):
    path = (pipeline.VIDEO_OUT_DIR / output_path).resolve()
    output_root = pipeline.VIDEO_OUT_DIR.resolve()
    if not str(path).startswith(str(output_root)) or not path.exists():
        raise HTTPException(status_code=404, detail="Output not found")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Cache-Control": "no-store, max-age=0"},
    )
