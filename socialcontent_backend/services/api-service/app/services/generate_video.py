from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException

from common.core.config import get_settings


PROJECT_ROOT = Path(__file__).resolve().parents[5]
RENDER_WORKSPACE_ROOT = PROJECT_ROOT / "data_demo" / "video_gen_demo"
PUBLIC_DIR = RENDER_WORKSPACE_ROOT / "public"
AUDIO_DIR = PUBLIC_DIR / "assets" / "audio"
VIDEO_OUT_DIR = RENDER_WORKSPACE_ROOT / "out"


def _base_url() -> str:
    return get_settings().generate_video_service_url.rstrip("/")


def _post(path: str, payload: dict[str, Any], *, timeout: float = 300.0) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(f"{_base_url()}{path}", json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        try:
            detail = exc.response.json().get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Generate video service unavailable: {exc}") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Generate video service returned an invalid response")
    return data


def get_elevenlabs_api_key(settings=None) -> str:
    current_settings = settings or get_settings()
    api_key = current_settings.elevenlabs_api_key or os.getenv("ELEVENLABS_API_KEY") or os.getenv("ACD_ELEVENLABS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Missing ELEVENLABS_API_KEY")
    return api_key


def create_story_from_raw(raw_article: dict[str, Any]) -> dict[str, Any]:
    return _post("/internal/create-story", {"source": raw_article})


def normalize_story_for_project(story: dict[str, Any]) -> dict[str, Any]:
    return _post("/internal/normalize-story", {"story": story})


def public_story_payload(story: dict[str, Any]) -> dict[str, Any]:
    return _post("/internal/public-story", {"story": story}, timeout=60.0)


def edit_story_with_ai(story: dict[str, Any], edit_prompt: str) -> dict[str, Any]:
    return _post("/internal/edit-story", {"story": story, "prompt": edit_prompt})


def review_story_with_ai(story: dict[str, Any], review_instructions: str | None = None) -> dict[str, Any]:
    return _post("/internal/review-story", {"story": story, "instructions": review_instructions})


def enhance_emotion_and_generate_voice(
    story: dict[str, Any],
    voice_id: str | None = None,
    voice_speed: float = 1.0,
    voice_provider: str | None = None,
) -> dict[str, Any]:
    return _post(
        "/internal/emotion-voice",
        {
            "story": story,
            "voice_id": voice_id,
            "voice_speed": voice_speed,
            "voice_provider": voice_provider,
        },
        timeout=600.0,
    )


def fit_frames_with_whisper(story: dict[str, Any]) -> dict[str, Any]:
    return _post("/internal/fit-frames", {"story": story}, timeout=600.0)


def save_uploaded_audio_base64(original_filename: str, content_base64: str) -> str:
    result = _post(
        "/internal/audio/upload",
        {"filename": original_filename, "content_base64": content_base64},
        timeout=120.0,
    )
    return str(result.get("asset_path") or "")
