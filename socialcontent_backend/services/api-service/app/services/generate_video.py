from __future__ import annotations

import base64
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

from common.planning.auto_draft_policy import sync_compact_scenes


PROJECT_ROOT = Path(__file__).resolve().parents[4]
RENDER_WORKSPACE_ROOT = Path(
    os.getenv("VIDEO_STORAGE_ROOT", str(PROJECT_ROOT / "runtime" / "video-generation"))
).expanduser()
PUBLIC_DIR = RENDER_WORKSPACE_ROOT / "public"
AUDIO_DIR = PUBLIC_DIR / "assets" / "audio"
VIDEO_OUT_DIR = RENDER_WORKSPACE_ROOT / "out"

try:
    from app.video.services.generate_video_timeline import (
        normalize_story_for_project as _engine_normalize,
        public_story_payload as _engine_public_payload,
    )

    def normalize_story_for_project(story: dict[str, Any]) -> dict[str, Any]:
        return _engine_normalize(story)

    def public_story_payload(story: dict[str, Any]) -> dict[str, Any]:
        return _engine_public_payload(story)
except ImportError:
    try:
        import sys
        engine_path = str(Path(__file__).resolve().parents[3] / "ai-media-engine")
        if engine_path not in sys.path:
            sys.path.insert(0, engine_path)
        from app.video.services.generate_video_timeline import (
            normalize_story_for_project as _engine_normalize,
            public_story_payload as _engine_public_payload,
        )

        def normalize_story_for_project(story: dict[str, Any]) -> dict[str, Any]:
            return _engine_normalize(story)

        def public_story_payload(story: dict[str, Any]) -> dict[str, Any]:
            return _engine_public_payload(story)
    except ImportError:
        def normalize_story_for_project(story: dict[str, Any]) -> dict[str, Any]:
            next_story = json.loads(json.dumps(story, ensure_ascii=False))
            return next_story

        def public_story_payload(story: dict[str, Any]) -> dict[str, Any]:
            normalized = normalize_story_for_project(story)
            sync_compact_scenes(normalized)
            payload = {
                "meta": normalized.get("meta") or {},
                "video": normalized.get("video"),
                "audio": normalized.get("audio"),
                "timeline": normalized.get("timeline") or {},
                "video_artifacts": normalized.get("video_artifacts") or {},
                "story_data": normalized.get("story_data") or [],
            }
            if isinstance(normalized.get("compact_scenes"), list):
                payload["compact_scenes"] = normalized["compact_scenes"]
            return payload


def save_uploaded_audio(original_filename: str, content: bytes) -> str:
    suffix = Path(original_filename or "").suffix.lower()
    if suffix not in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"}:
        raise ValueError("Unsupported audio format")
    if not content:
        raise ValueError("Audio file is empty")

    safe_stem = re.sub(r"[^a-zA-Z0-9_-]+", "-", Path(original_filename).stem).strip("-") or "audio"
    filename = f"upload-{uuid.uuid4().hex[:12]}-{safe_stem}{suffix}"
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    (AUDIO_DIR / filename).write_bytes(content)
    return f"assets/audio/{filename}"


def save_uploaded_audio_base64(original_filename: str, content_base64: str) -> str:
    try:
        content = base64.b64decode(content_base64, validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("Invalid base64 audio payload") from error
    return save_uploaded_audio(original_filename, content)
