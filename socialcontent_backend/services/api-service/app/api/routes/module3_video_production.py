from __future__ import annotations

import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services import module3_video_production as pipeline
from app.api.deps import get_current_user
from common.db.models import Module3Handoff, Module3RenderJob, Module3StoryVersion, User
from common.db.session import get_db


router = APIRouter()


class CreateStoryRequest(BaseModel):
    source: dict


class HandoffStoryRequest(BaseModel):
    raw_source: dict | None = None


class StoryRequest(BaseModel):
    story: dict | None = None
    handoff_id: uuid.UUID | None = None


class EditStoryRequest(BaseModel):
    story: dict | None = None
    handoff_id: uuid.UUID | None = None
    prompt: str


class VoiceRequest(BaseModel):
    story: dict | None = None
    handoff_id: uuid.UUID | None = None
    voice_id: str | None = None
    voice_speed: float = 1.0


class GenerateVideoRequest(BaseModel):
    story: dict | None = None
    handoff_id: uuid.UUID | None = None


class AudioUploadRequest(BaseModel):
    filename: str
    content_base64: str


@router.get("/state")
def get_state():
    return {"story": pipeline.read_story()}


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
        raise HTTPException(status_code=502, detail=detail) from error


@router.post("/create-story")
def create_story(payload: CreateStoryRequest):
    try:
        story = pipeline.create_story_from_raw(payload.source)
        return _story_script_preview(story)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/handoffs/{handoff_id}/create-story")
def create_story_from_handoff(
    handoff_id: uuid.UUID,
    payload: HandoffStoryRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    handoff = db.get(Module3Handoff, handoff_id)
    if not handoff or handoff.user_id != user.id:
        raise HTTPException(status_code=404, detail="Module 3 handoff not found")
    try:
        story = pipeline.create_story_from_module2_output(handoff, payload.raw_source if payload else None)
        _persist_handoff_story(db, handoff, story)
        return _story_script_preview(story)
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
        "source": public_story.get("source") or {},
    }


def _persist_handoff_story(db: Session, handoff: Module3Handoff, story: dict, status: str | None = None) -> None:
    public_story = _public_story(story)
    public_story["project_status"] = _project_status(public_story)
    next_payload = dict(handoff.payload or {})
    next_payload["video_project"] = public_story
    handoff.payload = next_payload
    if status:
        handoff.status = status
    elif handoff.status == "READY":
        handoff.status = "IN_PROGRESS"
    db.add(handoff)
    db.commit()


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


@router.get("/handoffs/{handoff_id}/story")
def get_saved_handoff_story(
    handoff_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    handoff = db.get(Module3Handoff, handoff_id)
    if not handoff or handoff.user_id != user.id:
        raise HTTPException(status_code=404, detail="Module 3 handoff not found")
    payload = handoff.payload if isinstance(handoff.payload, dict) else {}
    video_project = payload.get("video_project") if isinstance(payload.get("video_project"), dict) else None
    if video_project:
        return _public_story(video_project)
    try:
        return _public_story(pipeline.read_story_for_handoff(str(handoff_id)))
    except Exception as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/save-story")
def save_story(
    payload: StoryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.story is None:
        raise HTTPException(status_code=400, detail="Missing story")
    pipeline.write_story(payload.story)
    handoff_id = payload.handoff_id or payload.story.get("meta", {}).get("handoff_id")
    saved_story = pipeline.read_story_for_handoff(str(handoff_id)) if handoff_id else pipeline.read_story()
    if handoff_id:
        handoff = db.get(Module3Handoff, handoff_id)
        if not handoff or handoff.user_id != user.id:
            raise HTTPException(status_code=404, detail="Module 3 handoff not found")
        _persist_handoff_story(db, handoff, saved_story)
    return {"story": _public_story(saved_story)}


@router.post("/edit-story")
def edit_story(
    payload: EditStoryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Missing edit prompt")
    try:
        story = payload.story or (pipeline.read_story_for_handoff(str(payload.handoff_id)) if payload.handoff_id else pipeline.read_story())
        edited = pipeline.edit_story_with_ai(story, payload.prompt)
        if payload.handoff_id or edited.get("meta", {}).get("handoff_id"):
            handoff_id = payload.handoff_id or edited.get("meta", {}).get("handoff_id")
            handoff = db.get(Module3Handoff, handoff_id)
            if not handoff or handoff.user_id != user.id:
                raise HTTPException(status_code=404, detail="Module 3 handoff not found")
            _persist_handoff_story(db, handoff, edited)
        return _public_story(edited)
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
        story = payload.story or (pipeline.read_story_for_handoff(str(payload.handoff_id)) if payload.handoff_id else pipeline.read_story())
        handoff_id = payload.handoff_id or story.get("meta", {}).get("handoff_id")
        if not handoff_id:
            raise HTTPException(status_code=400, detail="Missing handoff_id for render job")
        handoff = db.get(Module3Handoff, handoff_id)
        if not handoff or handoff.user_id != user.id:
            raise HTTPException(status_code=404, detail="Module 3 handoff not found")

        story = pipeline.normalize_story_for_project(story)
        story.setdefault("meta", {})
        story["meta"]["handoff_id"] = str(handoff.id)
        _persist_handoff_story(db, handoff, story)

        version = _create_story_version(db, handoff, user, story, reason="RENDER")
        job = Module3RenderJob(
            handoff_id=handoff.id,
            story_version_id=version.id,
            user_id=user.id,
            status="QUEUED",
            progress_percent=0,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        pipeline.enqueue_render_job(job.id)
        return {"job": _serialize_render_job(job, handoff)}
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
    job = db.get(Module3RenderJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Render job not found")
    handoff = db.get(Module3Handoff, job.handoff_id)
    return {"job": _serialize_render_job(job, handoff)}


def _create_story_version(
    db: Session,
    handoff: Module3Handoff,
    user: User,
    story: dict,
    reason: str,
) -> Module3StoryVersion:
    latest = (
        db.query(func.max(Module3StoryVersion.version_number))
        .filter(Module3StoryVersion.handoff_id == handoff.id)
        .scalar()
        or 0
    )
    version = Module3StoryVersion(
        handoff_id=handoff.id,
        user_id=user.id,
        version_number=int(latest) + 1,
        reason=reason,
        story=story,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def _serialize_render_job(job: Module3RenderJob, handoff: Module3Handoff | None = None) -> dict:
    story = {}
    if handoff and isinstance(handoff.payload, dict):
        story = handoff.payload.get("video_project") if isinstance(handoff.payload.get("video_project"), dict) else {}
    output_path = job.output_path
    return {
        "id": str(job.id),
        "handoff_id": str(job.handoff_id),
        "story_version_id": str(job.story_version_id),
        "status": job.status,
        "progress_percent": float(job.progress_percent or 0),
        "output_path": output_path,
        "video_url": f"/api/v1/module3/video-production/output/{str(output_path).replace('out/', '')}" if output_path else None,
        "error_message": job.error_message,
        "story": _public_story(story) if story else None,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
    }


@router.post("/emotion-voice")
def emotion_voice(
    payload: VoiceRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        story = payload.story or (pipeline.read_story_for_handoff(str(payload.handoff_id)) if payload.handoff_id else pipeline.read_story())
        result = pipeline.enhance_emotion_and_generate_voice(story, payload.voice_id, payload.voice_speed)
        result_story = result.get("story") or {}
        if payload.handoff_id or result_story.get("meta", {}).get("handoff_id"):
            handoff_id = payload.handoff_id or result_story.get("meta", {}).get("handoff_id")
            handoff = db.get(Module3Handoff, handoff_id)
            if not handoff or handoff.user_id != user.id:
                raise HTTPException(status_code=404, detail="Module 3 handoff not found")
            _persist_handoff_story(db, handoff, result_story)
        return {
            "meta": result_story.get("meta") or {},
            "audio": result_story.get("audio") or {},
            "timeline": result_story.get("timeline") or {},
            "voice_id": result.get("voice_id"),
            "voice_speed": result.get("voice_speed"),
            "voice_text": result.get("voice_text"),
            "audio_url": result.get("audio_url"),
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
        story = payload.story or (pipeline.read_story_for_handoff(str(payload.handoff_id)) if payload.handoff_id else pipeline.read_story())
        result = pipeline.fit_frames_with_whisper(story)
        result_story = result.get("story") or {}
        if payload.handoff_id or result_story.get("meta", {}).get("handoff_id"):
            handoff_id = payload.handoff_id or result_story.get("meta", {}).get("handoff_id")
            handoff = db.get(Module3Handoff, handoff_id)
            if not handoff or handoff.user_id != user.id:
                raise HTTPException(status_code=404, detail="Module 3 handoff not found")
            _persist_handoff_story(db, handoff, result_story)
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
