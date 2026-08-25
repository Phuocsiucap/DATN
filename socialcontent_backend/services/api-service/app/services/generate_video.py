from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from common.core.config import get_settings


PROJECT_ROOT = Path(__file__).resolve().parents[4]
RENDER_WORKSPACE_ROOT = PROJECT_ROOT / "data_demo" / "video_gen_demo"
PUBLIC_DIR = RENDER_WORKSPACE_ROOT / "public"
AUDIO_DIR = PUBLIC_DIR / "assets" / "audio"
VIDEO_OUT_DIR = RENDER_WORKSPACE_ROOT / "out"

import json

def get_elevenlabs_api_key(settings=None) -> str:
    current_settings = settings or get_settings()
    api_key = current_settings.elevenlabs_api_key or os.getenv("ELEVENLABS_API_KEY") or os.getenv("ACD_ELEVENLABS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Missing ELEVENLABS_API_KEY")
    return api_key

def normalize_story_for_project(story: dict[str, Any]) -> dict[str, Any]:
    next_story = json.loads(json.dumps(story, ensure_ascii=False))
    return next_story

def public_story_payload(story: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_story_for_project(story)
    return {
        "meta": normalized.get("meta") or {},
        "video": normalized.get("video"),
        "audio": normalized.get("audio"),
        "timeline": normalized.get("timeline") or {},
        "video_artifacts": normalized.get("video_artifacts") or {},
        "story_data": normalized.get("story_data") or [],
    }


try:
    from app.video.services.generate_video_voice import enhance_emotion_and_generate_voice
except ImportError:
    try:
        import sys
        from pathlib import Path
        engine_path = str(Path(__file__).resolve().parents[3] / "ai-media-engine")
        if engine_path not in sys.path:
            sys.path.insert(0, engine_path)
        from app.video.services.generate_video_voice import enhance_emotion_and_generate_voice
    except ImportError:
        def enhance_emotion_and_generate_voice(
            story: dict[str, Any],
            voice_id: str | None = None,
            voice_speed: float = 1.0,
            voice_provider: str | None = None,
        ) -> dict[str, Any]:
            return {"story": normalize_story_for_project(story)}


def fit_frames_with_whisper(story: dict[str, Any]) -> dict[str, Any]:
    try:
        from app.video.services.generate_video_voice import fit_frames_with_whisper as _fit
        return _fit(story)
    except Exception:
        return {"story": normalize_story_for_project(story)}
