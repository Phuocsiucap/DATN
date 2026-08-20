from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from app.services import generate_video as pipeline


app = FastAPI(title="Generate Video Service", version="1.0")


class StorySourceRequest(BaseModel):
    source: dict[str, Any]


class StoryRequest(BaseModel):
    story: dict[str, Any]


class EditStoryRequest(BaseModel):
    story: dict[str, Any]
    prompt: str


class ReviewStoryRequest(BaseModel):
    story: dict[str, Any]
    instructions: str | None = None


class EmotionVoiceRequest(BaseModel):
    story: dict[str, Any]
    voice_id: str | None = None
    voice_speed: float = 1.0
    voice_provider: str | None = None


class UploadAudioRequest(BaseModel):
    filename: str
    content_base64: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "generate-video-service"}


@app.post("/internal/create-story")
def create_story(payload: StorySourceRequest) -> dict[str, Any]:
    return pipeline.create_story_from_raw(payload.source)


@app.post("/internal/normalize-story")
def normalize_story(payload: StoryRequest) -> dict[str, Any]:
    return pipeline.normalize_story_for_project(payload.story)


@app.post("/internal/public-story")
def public_story(payload: StoryRequest) -> dict[str, Any]:
    return pipeline.public_story_payload(payload.story)


@app.post("/internal/edit-story")
def edit_story(payload: EditStoryRequest) -> dict[str, Any]:
    return pipeline.edit_story_with_ai(payload.story, payload.prompt)


@app.post("/internal/review-story")
def review_story(payload: ReviewStoryRequest) -> dict[str, Any]:
    return pipeline.review_story_with_ai(payload.story, payload.instructions)


@app.post("/internal/emotion-voice")
def emotion_voice(payload: EmotionVoiceRequest) -> dict[str, Any]:
    return pipeline.enhance_emotion_and_generate_voice(
        payload.story,
        payload.voice_id,
        payload.voice_speed,
        payload.voice_provider,
    )


@app.post("/internal/fit-frames")
def fit_frames(payload: StoryRequest) -> dict[str, Any]:
    return pipeline.fit_frames_with_whisper(payload.story)


@app.post("/internal/audio/upload")
def upload_audio(payload: UploadAudioRequest) -> dict[str, str]:
    return {"asset_path": pipeline.save_uploaded_audio_base64(payload.filename, payload.content_base64)}
