from __future__ import annotations

from app.video.services.generate_video_alignment import fit_frames_with_whisper
from app.video.services.generate_video_constants import AUDIO_DIR, PUBLIC_DIR, RENDER_WORKSPACE_ROOT, VIDEO_OUT_DIR
from app.video.services.generate_video_jobs import (
    process_generate_video_edit_run,
    process_generate_video_render_run,
    process_generate_video_review_run,
    process_generate_video_script_run,
    process_generate_video_voice_run,
)
from app.video.services.generate_video_rendering import export_final_video, generate_visual_video
from app.video.services.generate_video_scripting import create_story_from_raw, edit_story_with_ai, review_story_with_ai
from app.video.services.generate_video_timeline import normalize_story_for_project, public_story_payload
from app.video.services.generate_video_voice import enhance_emotion_and_generate_voice, get_elevenlabs_api_key, save_uploaded_audio_base64

__all__ = [
    "AUDIO_DIR",
    "PUBLIC_DIR",
    "RENDER_WORKSPACE_ROOT",
    "VIDEO_OUT_DIR",
    "create_story_from_raw",
    "edit_story_with_ai",
    "enhance_emotion_and_generate_voice",
    "export_final_video",
    "fit_frames_with_whisper",
    "generate_visual_video",
    "get_elevenlabs_api_key",
    "normalize_story_for_project",
    "process_generate_video_edit_run",
    "process_generate_video_render_run",
    "process_generate_video_review_run",
    "process_generate_video_script_run",
    "process_generate_video_voice_run",
    "public_story_payload",
    "review_story_with_ai",
    "save_uploaded_audio_base64",
]
