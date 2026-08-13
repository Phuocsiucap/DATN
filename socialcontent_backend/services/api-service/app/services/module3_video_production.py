from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import subprocess
import unicodedata
import uuid
import urllib.error
import urllib.request
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common.core.config import get_settings


PROJECT_ROOT = Path(__file__).resolve().parents[5]
RENDER_WORKSPACE_ROOT = PROJECT_ROOT / "data_demo" / "video_gen_demo"
STORY_PATH = RENDER_WORKSPACE_ROOT / "story.json"
STORY_DIR = RENDER_WORKSPACE_ROOT / "stories"
PUBLIC_DIR = RENDER_WORKSPACE_ROOT / "public"
AUDIO_DIR = PUBLIC_DIR / "assets" / "audio"
VIDEO_OUT_DIR = RENDER_WORKSPACE_ROOT / "out"
RENDER_JOB_DIR = RENDER_WORKSPACE_ROOT / "render_jobs"
RENDER_WORKER_COUNT = max(1, int(os.getenv("MODULE3_RENDER_WORKERS", "1")))
_RENDER_EXECUTOR = ThreadPoolExecutor(max_workers=RENDER_WORKER_COUNT, thread_name_prefix="module3-render")

DEFAULT_IMAGES = [
    "assets/images/001-signal-room.png",
    "assets/images/002-alien-tower.png",
    "assets/images/003-final-light.png",
]
DEFAULT_EFFECTS = ["slow-zoom", "pan-right", "shake-reveal"]
DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"


def normalize_story_for_project(story: dict[str, Any]) -> dict[str, Any]:
    next_story = json.loads(json.dumps(story, ensure_ascii=False))
    sanitize_story_subtitles(next_story)
    replace_default_images_with_source_images(next_story)
    sync_story_timeline(next_story)
    return next_story


def enqueue_render_job(render_job_id: uuid.UUID | str) -> None:
    _RENDER_EXECUTOR.submit(_render_job_worker, str(render_job_id))


def enqueue_unfinished_render_jobs() -> None:
    from common.db.models import Module3RenderJob
    from common.db.session import SessionLocal

    db = SessionLocal()
    try:
        jobs = (
            db.query(Module3RenderJob)
            .filter(Module3RenderJob.status.in_(["QUEUED", "RUNNING"]))
            .order_by(Module3RenderJob.created_at.asc())
            .limit(20)
            .all()
        )
        job_ids = [job.id for job in jobs]
        for job in jobs:
            if job.status == "RUNNING":
                job.status = "QUEUED"
                db.add(job)
        db.commit()
    finally:
        db.close()

    for job_id in job_ids:
        enqueue_render_job(job_id)


def _render_job_worker(render_job_id: str) -> None:
    from common.db.models import Module3Handoff, Module3RenderJob
    from common.db.session import SessionLocal

    db = SessionLocal()
    try:
        job = db.get(Module3RenderJob, uuid.UUID(render_job_id))
        if not job or job.status not in {"QUEUED", "FAILED"}:
            return

        job.status = "RUNNING"
        job.progress_percent = 5
        job.started_at = datetime.now(timezone.utc)
        job.error_message = None
        db.add(job)
        db.commit()

        story = normalize_story_for_project(dict(job.story_version.story or {}))
        result = export_final_video(story, render_job_id=str(job.id))
        result_story = result.get("story") or story
        artifact_path = str(result.get("artifact_path") or "")

        handoff = db.get(Module3Handoff, job.handoff_id)
        if handoff:
            next_payload = dict(handoff.payload or {})
            public_story = public_story_payload(result_story)
            public_story["project_status"] = "RENDERED"
            next_payload["video_project"] = public_story
            handoff.payload = next_payload
            handoff.status = "RENDERED"
            db.add(handoff)

        job.status = "RENDERED"
        job.progress_percent = 100
        job.output_path = artifact_path
        job.completed_at = datetime.now(timezone.utc)
        db.add(job)
        db.commit()
    except Exception as error:
        db.rollback()
        job = db.get(Module3RenderJob, uuid.UUID(render_job_id))
        if job:
            job.status = "FAILED"
            job.error_message = str(error)[-2000:]
            job.completed_at = datetime.now(timezone.utc)
            db.add(job)
            db.commit()
    finally:
        db.close()


def public_story_payload(story: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_story_for_project(story)
    return {
        "meta": normalized.get("meta") or {},
        "video": normalized.get("video"),
        "audio": normalized.get("audio"),
        "timeline": normalized.get("timeline") or {},
        "video_artifacts": normalized.get("video_artifacts") or {},
        "source": normalized.get("source") or {},
    }


def read_story() -> dict[str, Any]:
    if not STORY_PATH.exists():
        return create_story_from_raw({"title": "Demo", "content": ""})
    story = json.loads(STORY_PATH.read_text(encoding="utf-8"))
    sync_story_timeline(story)
    return story


def read_story_for_handoff(handoff_id: str) -> dict[str, Any]:
    path = STORY_DIR / f"{handoff_id}.json"
    if not path.exists():
        raise RuntimeError(f"Story not found for handoff_id: {handoff_id}")
    story = json.loads(path.read_text(encoding="utf-8"))
    sync_story_timeline(story)
    return story


def write_story(story: dict[str, Any]) -> None:
    sanitize_story_subtitles(story)
    replace_default_images_with_source_images(story)
    sync_story_timeline(story)
    STORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORY_PATH.write_text(json.dumps(story, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    scoped_path = story_storage_path(story)
    if scoped_path != STORY_PATH:
        scoped_path.parent.mkdir(parents=True, exist_ok=True)
        scoped_path.write_text(json.dumps(story, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sanitize_story_subtitles(story: dict[str, Any]) -> None:
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    text_clips = timeline.get("text") if isinstance(timeline.get("text"), list) else []
    for clip in text_clips:
        if isinstance(clip, dict) and clip.get("text") is not None:
            clip["text"] = strip_voice_tags(str(clip.get("text") or ""))


def sync_story_timeline(story: dict[str, Any]) -> None:
    fps = int((story.get("video") or {}).get("fps") or 30)
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    if not timeline:
        timeline = timeline_from_legacy_scenes(story, fps)

    video_clips = normalize_video_clips(timeline.get("video"), fps)
    text_clips = prevent_timeline_text_overlap(normalize_text_clips(timeline.get("text"), fps), fps)
    audio_clips = normalize_audio_clips(timeline.get("audio"), fps)
    if not audio_clips:
        audio_clips = build_audio_timeline(story, fps)
    story["timeline"] = {
        "version": 1,
        "duration": round_to_frame(
            max(
                [
                    0.0,
                    *[float(clip["end"]) for clip in video_clips if clip.get("end") is not None],
                    *[float(clip["end"]) for clip in text_clips if clip.get("end") is not None],
                    *[float(clip["end"]) for clip in audio_clips if clip.get("end") is not None],
                ]
            ),
            fps,
        ),
        "video": video_clips,
        "text": text_clips,
        "audio": audio_clips,
    }
    story.pop("scenes", None)
    story.pop("story_data", None)


def timeline_from_legacy_scenes(story: dict[str, Any], fps: int) -> dict[str, Any]:
    scenes = story.get("story_data") or story.get("scenes") or []
    if not isinstance(scenes, list):
        scenes = []
    video: list[dict[str, Any]] = []
    text: list[dict[str, Any]] = []
    cursor = 0.0
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            continue
        duration = max(1 / max(1, fps), float(scene.get("duration") or 4))
        start = round_to_frame(cursor, fps)
        end = round_to_frame(cursor + duration, fps)
        video.append(
            {
                "id": str(scene.get("id") or f"video-{index + 1}"),
                "type": "image",
                "start": start,
                "end": end,
                "src": scene.get("image") or DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)],
                "effect": scene.get("effect") or DEFAULT_EFFECTS[0],
            }
        )
        subtitle = strip_voice_tags(str(scene.get("subtitle") or ""))
        if subtitle:
            text_start = scene.get("subtitle_start") if scene.get("subtitle_start") is not None else start
            text_duration = scene.get("subtitle_duration") if scene.get("subtitle_duration") is not None else duration
            text.append(
                {
                    "id": str(scene.get("text_id") or f"text-{index + 1}"),
                    "type": "subtitle",
                    "start": round_to_frame(float(text_start), fps),
                    "end": round_to_frame(float(text_start) + float(text_duration), fps),
                    "text": subtitle,
                    "style": scene.get("subtitle_style") or scene.get("text_style") or {},
                }
            )
        cursor = end
    return {"version": 1, "duration": cursor, "video": video, "text": text, "audio": build_audio_timeline(story, fps)}


def normalize_video_clips(value: Any, fps: int) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    clips = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        start = round_to_frame(max(0.0, float(item.get("start") or 0.0)), fps)
        end = round_to_frame(max(start + 1 / max(1, fps), float(item.get("end") or start + float(item.get("duration") or 4))), fps)
        clips.append(
            {
                "id": str(item.get("id") or f"video-{index + 1}"),
                "type": str(item.get("type") or "image"),
                "start": start,
                "end": end,
                "duration": round_to_frame(end - start, fps),
                "src": item.get("src") or item.get("image") or DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)],
                "effect": item.get("effect") or DEFAULT_EFFECTS[0],
            }
        )
    return sorted(clips, key=lambda clip: (clip["start"], clip["end"]))


def normalize_text_clips(value: Any, fps: int) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    clips = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        text = strip_voice_tags(str(item.get("text") or item.get("subtitle") or ""))
        if not text:
            continue
        start = round_to_frame(max(0.0, float(item.get("start") or 0.0)), fps)
        end = round_to_frame(max(start + 1 / max(1, fps), float(item.get("end") or start + float(item.get("duration") or 2))), fps)
        clip = {
            "id": str(item.get("id") or f"text-{index + 1}"),
            "type": "subtitle",
            "start": start,
            "end": end,
            "duration": round_to_frame(end - start, fps),
            "text": text,
            "style": item.get("style") if isinstance(item.get("style"), dict) else {},
        }
        if item.get("voice_text"):
            clip["voice_text"] = str(item.get("voice_text"))
        if isinstance(item.get("timing"), dict):
            clip["timing"] = item["timing"]
        clips.append(clip)
    return sorted(clips, key=lambda clip: (clip["start"], clip["end"]))


def normalize_audio_clips(value: Any, fps: int) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    clips = []
    for index, item in enumerate(value):
        if not isinstance(item, dict) or not item.get("src"):
            continue
        start = round_to_frame(max(0.0, float(item.get("start") or 0.0)), fps)
        raw_end = item.get("end")
        end = round_to_frame(float(raw_end), fps) if raw_end is not None else None
        clips.append(
            {
                "id": str(item.get("id") or f"audio-{index + 1}"),
                "type": str(item.get("type") or "audio"),
                "start": start,
                "end": max(start + 1 / max(1, fps), end) if end is not None else None,
                "src": item.get("src"),
                "volume": float(item.get("volume") if item.get("volume") is not None else 1),
            }
        )
    return sorted(clips, key=lambda clip: (clip["start"], clip.get("end") or clip["start"]))


def build_audio_timeline(story: dict[str, Any], fps: int) -> list[dict[str, Any]]:
    audio = story.get("audio") if isinstance(story.get("audio"), dict) else {}
    clips: list[dict[str, Any]] = []
    voice = audio.get("voice")
    if voice:
        start = float(audio.get("voiceStart") or audio.get("voice_start") or 0.0)
        duration = float(audio.get("voiceDuration") or audio.get("voice_duration") or 0.0)
        clips.append(
            {
                "id": "voice-main",
                "type": "voice",
                "start": round_to_frame(max(0.0, start), fps),
                "end": round_to_frame(max(start + 1 / max(1, fps), start + duration), fps) if duration > 0 else None,
                "src": voice,
                "volume": float(audio.get("voiceVolume") if audio.get("voiceVolume") is not None else 1),
            }
        )
    music = audio.get("music")
    if music:
        start = float(audio.get("musicStart") or 0.0)
        duration = float(audio.get("musicDuration") or 0.0)
        clips.append(
            {
                "id": "music-main",
                "type": "music",
                "start": round_to_frame(max(0.0, start), fps),
                "end": round_to_frame(max(start + 1 / max(1, fps), start + duration), fps) if duration > 0 else None,
                "src": music,
                "volume": float(audio.get("musicVolume") or 0),
            }
        )
    tracks = audio.get("tracks") if isinstance(audio.get("tracks"), list) else []
    for index, track in enumerate(tracks):
        if not isinstance(track, dict):
            continue
        start = float(track.get("start") or 0.0)
        duration = float(track.get("duration") or 0.0)
        clips.append(
            {
                "id": str(track.get("id") or f"audio-{index + 1}"),
                "type": str(track.get("type") or "audio"),
                "start": round_to_frame(max(0.0, start), fps),
                "end": round_to_frame(max(start + 1 / max(1, fps), start + duration), fps) if duration > 0 else None,
                "src": track.get("src"),
                "volume": float(track.get("volume") if track.get("volume") is not None else 1),
            }
        )
    return [clip for clip in clips if clip.get("src")]


def prevent_timeline_text_overlap(text_clips: list[dict[str, Any]], fps: int) -> list[dict[str, Any]]:
    minimum = 1 / max(1, fps)
    previous_end = 0.0
    normalized = []
    for clip in sorted(text_clips, key=lambda item: (float(item.get("start") or 0), float(item.get("end") or 0))):
        start = max(previous_end, float(clip.get("start") or 0.0))
        end = max(start + minimum, float(clip.get("end") or start + minimum))
        next_clip = {**clip, "start": round_to_frame(start, fps), "end": round_to_frame(end, fps)}
        next_clip["duration"] = round_to_frame(next_clip["end"] - next_clip["start"], fps)
        normalized.append(next_clip)
        previous_end = end
    return normalized


def timeline_text_clips(story: dict[str, Any]) -> list[dict[str, Any]]:
    sync_story_timeline(story)
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    text_clips = timeline.get("text") if isinstance(timeline.get("text"), list) else []
    return sorted([clip for clip in text_clips if isinstance(clip, dict)], key=lambda clip: (float(clip.get("start") or 0), float(clip.get("end") or 0)))


def upsert_timeline_audio_clip(story: dict[str, Any], clip: dict[str, Any]) -> None:
    fps = int((story.get("video") or {}).get("fps") or 30)
    sync_story_timeline(story)
    timeline = story.setdefault("timeline", {})
    audio_clips = timeline.get("audio") if isinstance(timeline.get("audio"), list) else []
    normalized_clip = normalize_audio_clips([clip], fps)[0]
    replaced = False
    next_audio = []
    for item in audio_clips:
        if isinstance(item, dict) and (item.get("id") == normalized_clip["id"] or (item.get("type") == normalized_clip["type"] and normalized_clip["type"] == "voice")):
            next_audio.append(normalized_clip)
            replaced = True
        else:
            next_audio.append(item)
    if not replaced:
        next_audio.append(normalized_clip)
    timeline["audio"] = normalize_audio_clips(next_audio, fps)
    sync_story_timeline(story)


def story_storage_path(story: dict[str, Any]) -> Path:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    handoff_id = str(meta.get("handoff_id") or "").strip()
    if handoff_id:
        return STORY_DIR / f"{handoff_id}.json"
    return STORY_PATH


def replace_default_images_with_source_images(story: dict[str, Any]) -> None:
    source = story.get("source") if isinstance(story.get("source"), dict) else {}
    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    image_urls = list(
        dict.fromkeys(
            [
                *collect_image_urls(source),
                *collect_image_urls(raw_article.get("source_content") if isinstance(raw_article.get("source_content"), dict) else {}),
                *collect_image_urls(raw_article.get("raw_source") if isinstance(raw_article.get("raw_source"), dict) else {}),
            ]
        )
    )
    if not image_urls:
        return

    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    video_clips = timeline.get("video") if isinstance(timeline.get("video"), list) else []
    if not video_clips:
        return

    for index, clip in enumerate(video_clips):
        if not isinstance(clip, dict):
            continue
        src = str(clip.get("src") or "").strip()
        if not src or src in DEFAULT_IMAGES:
            clip["src"] = image_urls[index % len(image_urls)]


def create_story_from_raw(raw_article: dict[str, Any]) -> dict[str, Any]:
    text = raw_article.get("text") or raw_article.get("content") or raw_article.get("full_text") or raw_article.get("summary") or ""
    title = raw_article.get("title") or raw_article.get("canonical_title") or "Bản tin"
    images = collect_image_urls(raw_article)
    timeline = generate_story_timeline_with_ai(
        {
            "title": title,
            "source_text": text,
            "source": raw_article,
            # "target_scene_count": 3,
        },
        images,
    )
    story = {
        "meta": {
            "title": title,
            "source": "manual",
        },
        "video": {"width": 1080, "height": 1920, "fps": 30, "background": "#05070b"},
        "audio": {"voiceVolume": 1, "musicVolume": 0},
        "source": raw_article,
        "timeline": timeline,
    }
    write_story(story)
    return story


def create_story_from_module2_output(handoff: Any, raw_source: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = dict(handoff.payload or {})
    parts = sorted(list(handoff.parts or []), key=lambda item: item.part_number)
    raw_source = raw_source or {}
    source_content = payload.get("source_content") if isinstance(payload.get("source_content"), dict) else {}
    plan_payload = payload.get("plan") if isinstance(payload.get("plan"), dict) else {}
    series_payload = payload.get("series") if isinstance(payload.get("series"), dict) else {}
    image_urls = collect_image_urls(raw_source) + collect_image_urls(source_content)
    image_urls = list(dict.fromkeys(image_urls))
    raw = {
        "handoff_id": str(handoff.id),
        "series_id": str(handoff.content_series_id),
        "plan_id": str(handoff.content_plan_id),
        "title": series_payload.get("title") or plan_payload.get("title") or payload.get("series_title") or payload.get("plan_title") or source_content.get("canonical_title") or "Module 2 output",
        "summary": source_content.get("summary") or plan_payload.get("content_angle") or payload.get("plan_title") or handoff.handoff_note or "",
        "full_text": source_content.get("full_text"),
        "plan": plan_payload,
        "series": series_payload,
        "parts": [
            {
                "part_number": part.part_number,
                "series_part_id": str(part.series_part_id),
                **dict(part.payload or {}),
            }
            for part in parts
        ],
        "raw_article": {
            "source_content": source_content,
            "raw_source": raw_source,
        },
        "payload": payload,
        "raw_source": raw_source,
    }
    story = {
        "meta": {
            "handoff_id": str(handoff.id),
            "profile_id": str(handoff.profile_id),
            "series_id": str(handoff.content_series_id),
            "plan_id": str(handoff.content_plan_id),
            "context_id": str(handoff.context_id) if handoff.context_id else None,
            "title": raw["title"],
            "source_content_id": source_content.get("id"),
            "part_ids": [str(part.series_part_id) for part in parts],
        },
        "video": {"width": 1080, "height": 1920, "fps": 30, "background": "#05070b"},
        "audio": {"voiceVolume": 1, "musicVolume": 0},
        "source": raw,
        "timeline": generate_story_timeline_with_ai(raw, image_urls),
    }
    write_story(story)
    return story


def edit_story_with_ai(story: dict[str, Any], edit_prompt: str) -> dict[str, Any]:
    settings = get_settings()
    if not settings.deepseek_api_key:
        raise RuntimeError("Missing ACD_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY")

    sync_story_timeline(story)
    current_timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    if not current_timeline.get("video") and not current_timeline.get("text"):
        raise RuntimeError("Story has no timeline to edit")

    source = story.get("source") if isinstance(story.get("source"), dict) else {}
    image_urls = collect_image_urls(source)
    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    if isinstance(raw_article.get("source_content"), dict):
        image_urls += collect_image_urls(raw_article["source_content"])
    if isinstance(raw_article.get("raw_source"), dict):
        image_urls += collect_image_urls(raw_article["raw_source"])
    current_video = current_timeline.get("video") if isinstance(current_timeline.get("video"), list) else []
    image_urls = list(dict.fromkeys([*image_urls, *[clip.get("src") for clip in current_video if isinstance(clip, dict) and clip.get("src")]]))

    prompt_payload = {
        "task": "Edit an existing timeline for a Vietnamese vertical short video.",
        "edit_prompt": edit_prompt,
        "required_output": {
            "timeline": {
                "duration": "number seconds",
                "video": [{"id": "string", "type": "image", "start": "number", "end": "number", "src": "image URL/path", "effect": f"one of {DEFAULT_EFFECTS}"}],
                "text": [{"id": "string", "type": "subtitle", "start": "number", "end": "number", "text": "Vietnamese subtitle"}],
                "audio": [{"id": "string", "type": "voice|music|sfx", "start": "number", "end": "number|null", "src": "audio path", "volume": "number"}],
            }
        },
        "rules": [
            "Return only valid JSON object, no markdown.",
            "Apply the edit_prompt to the existing timeline.",
            "Use source_document to ground facts. Do not invent facts outside the source document.",
            "Preserve the story intent from Module 2 unless the edit_prompt explicitly asks to change it.",
            "Keep each subtitle text under 140 characters when possible.",
            "Do not make text clips overlap. Each text clip must have start < end.",
            "Keep clip count close to the original unless the edit_prompt asks to add/remove clips.",
            "Use only allowed_effects.",
        ],
        "current_timeline": current_timeline,
        "source_document": compact_story_source_for_ai(source),
        "available_images": image_urls,
        "default_images": DEFAULT_IMAGES,
        "allowed_effects": DEFAULT_EFFECTS,
    }
    payload = {
        "model": "deepseek-v4-flash",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a Vietnamese short-video editor. "
                    "You revise production timeline JSON while preserving factual grounding."
                ),
            },
            {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
        ],
        "temperature": 0.45,
        "response_format": {"type": "json_object"},
    }
    data = post_json(f"{settings.deepseek_base_url.rstrip('/')}/chat/completions", payload, settings.deepseek_api_key)
    content = data["choices"][0]["message"]["content"].strip()
    parsed = json.loads(strip_json_fence(content))
    normalized = normalize_ai_timeline(parsed.get("timeline") if isinstance(parsed, dict) else parsed, image_urls)
    if not normalized.get("video") and not normalized.get("text"):
        raise RuntimeError("AI did not return valid timeline")

    next_story = dict(story)
    next_story["timeline"] = normalized
    next_story.setdefault("edit_history", [])
    next_story["edit_history"].append({"prompt": edit_prompt})
    write_story(next_story)
    return next_story


def compact_story_source_for_ai(source: dict[str, Any]) -> dict[str, Any]:
    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    source_content = raw_article.get("source_content") if isinstance(raw_article.get("source_content"), dict) else {}
    raw_source = raw_article.get("raw_source") if isinstance(raw_article.get("raw_source"), dict) else {}
    return {
        "title": source.get("title"),
        "summary": source.get("summary"),
        "full_text": truncate_text(str(source.get("full_text") or source.get("source_text") or source_content.get("full_text") or raw_source.get("text") or raw_source.get("content") or ""), 5000),
        "plan": source.get("plan") if isinstance(source.get("plan"), dict) else {},
        "series": source.get("series") if isinstance(source.get("series"), dict) else {},
        "parts": source.get("parts") if isinstance(source.get("parts"), list) else [],
        "source_content": {
            "canonical_title": source_content.get("canonical_title"),
            "summary": source_content.get("summary"),
            "source_url": source_content.get("source_url") or source_content.get("canonical_url"),
        },
        "raw_source": {
            "title": raw_source.get("title"),
            "summary": raw_source.get("summary"),
            "text": truncate_text(str(raw_source.get("text") or raw_source.get("content") or ""), 5000),
        },
    }


def enhance_emotion_and_generate_voice(
    story: dict[str, Any],
    voice_id: str | None = None,
    voice_speed: float = 1.0,
) -> dict[str, Any]:
    settings = get_settings()
    sync_story_timeline(story)
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    text_clips = timeline.get("text") if isinstance(timeline.get("text"), list) else []
    if not text_clips:
        raise RuntimeError("Story has no timeline text clips to generate voice")
    for clip in text_clips:
        clip["text"] = strip_voice_tags(str(clip.get("text") or ""))
    tagged_lines = tag_with_deepseek(story, settings)
    for clip, tagged in zip(text_clips, tagged_lines):
        clip["text"] = strip_voice_tags(str(clip.get("text") or ""))
        clip["voice_text"] = tagged

    selected_voice_id = voice_id or DEFAULT_VOICE_ID
    selected_voice_speed = clamp_voice_speed(voice_speed)
    audio_filename = story_audio_filename(story)
    audio_path = AUDIO_DIR / audio_filename
    generate_elevenlabs_voice(story, settings, selected_voice_id, selected_voice_speed, audio_path)
    voice_text = build_voice_text(story)
    story.setdefault("audio", {})
    story["audio"]["voice"] = f"assets/audio/{audio_filename}"
    story["audio"]["voiceVolume"] = 1
    if story["audio"].get("music"):
        story["audio"]["musicVolume"] = 0.08
    upsert_timeline_audio_clip(
        story,
        {
            "id": "voice-main",
            "type": "voice",
            "start": 0,
            "end": None,
            "src": f"assets/audio/{audio_filename}",
            "volume": 1,
        },
    )
    write_story(story)
    return {
        "story": story,
        "voice_id": selected_voice_id,
        "voice_speed": selected_voice_speed,
        "voice_text": voice_text,
        "audio_url": f"/api/v1/module3/video-production/media/assets/audio/{audio_filename}",
    }


def save_uploaded_audio(original_filename: str, content: bytes) -> str:
    suffix = Path(original_filename or "audio").suffix.lower()
    if suffix not in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"}:
        raise RuntimeError("Unsupported audio file type")
    if not content:
        raise RuntimeError("Empty audio file")
    stem = Path(original_filename or "audio").stem
    safe_stem = re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip("-") or "audio"
    filename = f"upload-{uuid.uuid4().hex[:10]}-{safe_stem}{suffix}"
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    output_path = AUDIO_DIR / filename
    output_path.write_bytes(content)
    return f"assets/audio/{filename}"


def save_uploaded_audio_base64(original_filename: str, content_base64: str) -> str:
    try:
        content = base64.b64decode(content_base64, validate=True)
    except Exception as error:
        raise RuntimeError("Invalid audio payload") from error
    return save_uploaded_audio(original_filename, content)


def generate_visual_video(story: dict[str, Any]) -> dict[str, Any]:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    handoff_id = str(meta.get("handoff_id") or uuid.uuid4()).strip()
    output_name = f"visual-{handoff_id}-{uuid.uuid4().hex[:8]}.mp4"
    output_path = VIDEO_OUT_DIR / output_name
    VIDEO_OUT_DIR.mkdir(parents=True, exist_ok=True)

    original_story = read_story() if STORY_PATH.exists() else None
    visual_story = dict(story)
    replace_default_images_with_source_images(visual_story)
    sync_story_timeline(visual_story)
    visual_story["audio"] = {
        **dict(story.get("audio") or {}),
        "voice": None,
        "music": None,
        "voiceVolume": 0,
        "musicVolume": 0,
    }
    visual_story["timeline"] = {
        **dict(visual_story.get("timeline") or {}),
        "audio": [],
    }
    STORY_PATH.write_text(json.dumps(visual_story, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        run_remotion_render(output_path)
    finally:
        if original_story is not None:
            STORY_PATH.write_text(json.dumps(original_story, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        else:
            write_story(story)

    story.setdefault("video_artifacts", {})
    story["video_artifacts"]["visual_only"] = f"out/{output_name}"
    write_story(story)
    return {
        "story": story,
        "video_url": f"/api/v1/module3/video-production/output/{output_name}",
        "video_path": str(output_path),
    }


def export_final_video(story: dict[str, Any], render_job_id: str | None = None) -> dict[str, Any]:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    handoff_id = str(meta.get("handoff_id") or uuid.uuid4()).strip()
    render_key = (render_job_id or uuid.uuid4().hex).replace("-", "")[:12]
    output_name = f"final-{handoff_id}-{render_key}.mp4"
    output_path = VIDEO_OUT_DIR / output_name
    VIDEO_OUT_DIR.mkdir(parents=True, exist_ok=True)

    story = normalize_story_for_project(story)
    job_dir = RENDER_JOB_DIR / (render_job_id or uuid.uuid4().hex)
    job_dir.mkdir(parents=True, exist_ok=True)
    props_path = job_dir / "props.json"
    props_path.write_text(json.dumps({"story": story}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    run_remotion_render(output_path, props_path=props_path)

    story.setdefault("video_artifacts", {})
    story["video_artifacts"]["final"] = f"out/{output_name}"
    return {
        "story": story,
        "video_url": f"/api/v1/module3/video-production/output/{output_name}",
        "artifact_path": f"out/{output_name}",
        "video_path": str(output_path),
    }


def run_remotion_render(output_path: Path, props_path: Path | None = None) -> None:
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise RuntimeError("npm is required to render visual video")
    command = [
        npm,
        "exec",
        "remotion",
        "--",
        "render",
        "src/index.ts",
        "StorytellingDemo",
        str(output_path),
    ]
    if props_path is not None:
        command.append(f"--props={props_path}")
    concurrency = os.getenv("MODULE3_REMOTION_CONCURRENCY")
    if concurrency:
        command.append(f"--concurrency={concurrency}")
    x264_preset = os.getenv("MODULE3_REMOTION_X264_PRESET", "veryfast")
    if x264_preset:
        command.append(f"--x264-preset={x264_preset}")
    crf = os.getenv("MODULE3_REMOTION_CRF", "23")
    if crf:
        command.append(f"--crf={crf}")
    completed = subprocess.run(
        command,
        cwd=RENDER_WORKSPACE_ROOT,
        capture_output=True,
        text=True,
        timeout=300,
        env={**os.environ, "NO_COLOR": "1"},
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "Remotion render failed").strip()
        raise RuntimeError(detail[-2000:])


def story_audio_filename(story: dict[str, Any]) -> str:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    handoff_id = str(meta.get("handoff_id") or "").strip()
    if handoff_id:
        return f"voice-{handoff_id}.mp3"
    return "voice-elevenlabs.mp3"


def fit_frames_with_whisper(story: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    api_key = settings.openai_api_key
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY")

    sync_story_timeline(story)
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    timeline_audio = timeline.get("audio") if isinstance(timeline.get("audio"), list) else []
    voice_clip = next((clip for clip in timeline_audio if isinstance(clip, dict) and str(clip.get("type") or "").lower() == "voice" and clip.get("src")), None)
    audio_rel = (voice_clip or {}).get("src") or story.get("audio", {}).get("voice")
    if not audio_rel:
        raise RuntimeError("Voice audio has not been generated for this story")
    audio_path = PUBLIC_DIR / audio_rel
    if not audio_path.exists():
        raise RuntimeError(f"Voice audio not found: {audio_rel}")

    text_clips = timeline_text_clips(story)
    if not text_clips:
        raise RuntimeError("Story has no timeline text clips to fit")

    scene_texts = [strip_voice_tags(str(clip.get("voice_text") or clip.get("text") or "")) for clip in text_clips]
    transcription = transcribe_whisper(api_key, audio_path)
    segments = transcription.get("segments") if isinstance(transcription.get("segments"), list) else []
    words = transcription.get("words") if isinstance(transcription.get("words"), list) else []
    scene_ranges = map_scenes_to_segments(scene_texts, segments)
    fallback_ranges = map_scenes_to_word_ranges(scene_texts, words, segments)
    transcript_text = str(transcription.get("text") or "")
    transcript_score = word_similarity("\n".join(scene_texts), transcript_text)
    matched_scene_count = sum(1 for item in scene_ranges if item.get("start") is not None)
    if len(scene_texts) > 1 and (matched_scene_count <= 1 or transcript_score < 0.35):
        debug = {
            "expected_text": "\n".join(scene_texts),
            "transcription": transcription,
            "sceneRanges": scene_ranges,
            "fallbackRanges": fallback_ranges,
            "matchQuality": {
                "matched_scene_count": matched_scene_count,
                "scene_count": len(scene_texts),
                "transcript_score": transcript_score,
            },
            "error": "Voice audio does not match timeline text. Regenerate voice from the current timeline before fitting frames.",
        }
        (RENDER_WORKSPACE_ROOT / "whisper-align-debug.json").write_text(
            json.dumps(debug, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        raise RuntimeError(debug["error"])
    fps = int(story["video"]["fps"])
    voice_offset = _voice_timeline_offset(story, audio_rel)
    audio_end = float(transcription.get("duration") or (segments[-1]["end"] if segments else 0))
    timeline_audio_end = voice_offset + audio_end

    for index, clip in enumerate(text_clips):
        current = scene_ranges[index] if scene_ranges[index].get("start") is not None else fallback_ranges[index]
        next_range = scene_ranges[index + 1] if index + 1 < len(scene_ranges) else None
        if current.get("start") is None or current.get("end") is None:
            continue
        voice_start = float(current["start"])
        voice_end = float(next_range.get("start")) if next_range and next_range.get("start") is not None else (audio_end or float(current.get("end")))
        timeline_start = voice_offset + voice_start
        timeline_end = voice_offset + voice_end
        clip["start"] = round_to_frame(timeline_start, fps)
        clip["end"] = round_to_frame(timeline_end, fps)
        clip["duration"] = max(1 / fps, round_to_frame(clip["end"] - clip["start"], fps))
        clip["timing"] = {
            "start": round_to_frame(timeline_start, fps),
            "end": round_to_frame(timeline_end, fps),
            "voice_start": round_to_frame(voice_start, fps),
            "voice_end": round_to_frame(voice_end, fps),
        }

    story["timeline"]["text"] = prevent_timeline_text_overlap(text_clips, fps)
    if voice_clip is not None:
        voice_clip["end"] = round_to_frame(timeline_audio_end, fps)
        story["timeline"]["audio"] = normalize_audio_clips(timeline_audio, fps)
    sync_story_timeline(story)
    debug = {
        "expected_text": "\n".join(scene_texts),
        "transcription": transcription,
        "sceneRanges": scene_ranges,
        "fallbackRanges": fallback_ranges,
        "voiceOffset": voice_offset,
        "timelineAudioEnd": timeline_audio_end,
    }
    (RENDER_WORKSPACE_ROOT / "whisper-align-debug.json").write_text(
        json.dumps(debug, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_story(story)
    return {"story": story, "debug": debug}


def _voice_timeline_offset(story: dict[str, Any], voice_path: str) -> float:
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    timeline_audio = timeline.get("audio") if isinstance(timeline.get("audio"), list) else []
    normalized_voice_path = str(voice_path or "").replace("\\", "/").lstrip("/")
    voice_timeline_clips = []
    for clip in timeline_audio:
        if not isinstance(clip, dict) or str(clip.get("type") or "").lower() != "voice":
            continue
        src = str(clip.get("src") or "").replace("\\", "/").lstrip("/")
        if normalized_voice_path and src and (src == normalized_voice_path or src.endswith(normalized_voice_path) or normalized_voice_path.endswith(src)):
            voice_timeline_clips.append(clip)
        elif not normalized_voice_path:
            voice_timeline_clips.append(clip)
    if voice_timeline_clips:
        return max(0.0, min(float(clip.get("start") or 0.0) for clip in voice_timeline_clips))

    audio = story.get("audio") if isinstance(story.get("audio"), dict) else {}
    tracks = audio.get("tracks") if isinstance(audio.get("tracks"), list) else []
    voice_tracks = []
    for track in tracks:
        if not isinstance(track, dict) or str(track.get("type") or "").lower() != "voice":
            continue
        src = str(track.get("src") or "").replace("\\", "/").lstrip("/")
        if normalized_voice_path and src and (src == normalized_voice_path or src.endswith(normalized_voice_path) or normalized_voice_path.endswith(src)):
            voice_tracks.append(track)
        elif not normalized_voice_path:
            voice_tracks.append(track)
    if voice_tracks:
        return max(0.0, min(float(track.get("start") or 0.0) for track in voice_tracks))
    return max(0.0, float(audio.get("voiceStart") or audio.get("voice_start") or 0.0))


def _prevent_subtitle_overlap(scenes: list[dict[str, Any]], fps: int) -> None:
    minimum = 1 / max(1, fps)
    previous_end = 0.0
    for scene in scenes:
        start = float(scene.get("subtitle_start") or scene.get("subtitleStart") or previous_end)
        duration = float(scene.get("subtitle_duration") or scene.get("subtitleDuration") or scene.get("duration") or minimum)
        start = max(previous_end, start)
        duration = max(minimum, duration)
        end = start + duration
        scene["subtitle_start"] = round_to_frame(start, fps)
        scene["subtitle_duration"] = round_to_frame(duration, fps)
        timing = scene.get("timing") if isinstance(scene.get("timing"), dict) else {}
        if timing:
            timing["start"] = scene["subtitle_start"]
            timing["end"] = round_to_frame(end, fps)
            scene["timing"] = timing
        previous_end = end


def generate_story_timeline_with_ai(source: dict[str, Any], image_urls: list[str] | None = None) -> dict[str, Any]:
    image_urls = list(dict.fromkeys(image_urls or []))
    fallback = build_fallback_timeline(source, image_urls)
    settings = get_settings()
    if not settings.deepseek_api_key:
        return fallback

    compact_parts = []
    for part in source.get("parts") or []:
        if not isinstance(part, dict):
            continue
        compact_parts.append(
            {
                "part_number": part.get("part_number"),
                "title": part.get("title"),
                "goal": part.get("goal"),
                "hook_direction": part.get("hook_direction"),
                "main_beats": part.get("main_beats"),
                "ending_direction": part.get("ending_direction"),
                "production_notes": part.get("production_notes"),
            }
        )

    plan = source.get("plan") if isinstance(source.get("plan"), dict) else {}
    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    prompt_payload = {
        "task": "Generate a timeline for a vertical Vietnamese short video from Module 2 production handoff.",
        "required_output": {
            "timeline": {
                "version": 1,
                "duration": "number seconds",
                "video": [
                    {
                        "id": "video-1",
                        "type": "image",
                        "start": 0,
                        "end": 4,
                        "src": "one available image URL/path or default asset path",
                        "effect": f"one of {DEFAULT_EFFECTS}",
                    }
                ],
                "text": [
                    {
                        "id": "text-1",
                        "type": "subtitle",
                        "start": 0,
                        "end": 4,
                        "text": "Vietnamese narration subtitle, cinematic, concise",
                    }
                ],
                "audio": [],
            }
        },
        "rules": [
            "Return only valid JSON object, no markdown.",
            "Create text clips from hook_direction, each main_beats item, and ending_direction in that order.",
            "Do not drop any non-empty script beat.",
            "Use the raw article/full_text/source_content only to ground facts. Do not invent facts outside it.",
            "Every subtitle must preserve source meaning and be natural Vietnamese narration.",
            "Create 3 to 8 video clips and matching text clips unless source requires fewer.",
            "Text clips must not overlap. Each clip must have start < end.",
            "Each subtitle should stay under 140 characters when possible.",
            "Use available_images in order when possible; otherwise use default_images.",
            "Use allowed_effects only.",
            "Do not output scenes or story_data.",
        ],
        "title": source.get("title"),
        "summary": source.get("summary"),
        "plan": {
            "title": plan.get("title"),
            "content_angle": plan.get("content_angle"),
            "target_audience": plan.get("target_audience"),
            "tone": plan.get("tone"),
            "format": plan.get("format"),
            "planning_mode": plan.get("planning_mode"),
            "target_duration_seconds": plan.get("target_duration_seconds"),
            "production_requirements": plan.get("production_requirements"),
            "ai_reasoning": plan.get("ai_reasoning"),
            "risk_level": plan.get("risk_level"),
        },
        "script_parts": compact_parts,
        "raw_article": {
            "source_content": {
                "id": (raw_article.get("source_content") or {}).get("id") if isinstance(raw_article.get("source_content"), dict) else None,
                "canonical_title": (raw_article.get("source_content") or {}).get("canonical_title") if isinstance(raw_article.get("source_content"), dict) else None,
                "summary": (raw_article.get("source_content") or {}).get("summary") if isinstance(raw_article.get("source_content"), dict) else None,
                "full_text": truncate_text(str((raw_article.get("source_content") or {}).get("full_text") or source.get("full_text") or source.get("source_text") or ""), 3500) if isinstance(raw_article.get("source_content"), dict) else truncate_text(str(source.get("full_text") or source.get("source_text") or ""), 3500),
                "source_url": (raw_article.get("source_content") or {}).get("source_url") if isinstance(raw_article.get("source_content"), dict) else None,
                "canonical_url": (raw_article.get("source_content") or {}).get("canonical_url") if isinstance(raw_article.get("source_content"), dict) else None,
            },
            "raw_source": raw_article.get("raw_source") or {},
        },
        "available_images": image_urls,
        "default_images": DEFAULT_IMAGES,
        "allowed_effects": DEFAULT_EFFECTS,
    }
    payload = {
        "model": "deepseek-v4-flash",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a Vietnamese short-video editor. "
                    "You output production-ready timeline JSON matching the exact schema."
                ),
            },
            {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
        ],
        "temperature": 0.65,
        "response_format": {"type": "json_object"},
    }
    try:
        data = post_json(f"{settings.deepseek_base_url.rstrip('/')}/chat/completions", payload, settings.deepseek_api_key, timeout=35)
        content = data["choices"][0]["message"]["content"].strip()
        parsed = json.loads(strip_json_fence(content))
        normalized = normalize_ai_timeline(parsed.get("timeline") if isinstance(parsed, dict) else parsed, image_urls)
        return normalized or fallback
    except Exception:
        return fallback


def build_fallback_timeline(source: dict[str, Any], image_urls: list[str]) -> dict[str, Any]:
    scenes = build_fallback_scenes(source, image_urls)
    fps = 30
    video: list[dict[str, Any]] = []
    text: list[dict[str, Any]] = []
    cursor = 0.0
    for index, scene in enumerate(scenes):
        duration = max(1.0, float(scene.get("duration") or 4))
        start = round_to_frame(cursor, fps)
        end = round_to_frame(cursor + duration, fps)
        video.append(
            {
                "id": f"video-{index + 1}",
                "type": "image",
                "start": start,
                "end": end,
                "src": scene.get("image") or DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)],
                "effect": scene.get("effect") or DEFAULT_EFFECTS[index % len(DEFAULT_EFFECTS)],
            }
        )
        subtitle = strip_voice_tags(str(scene.get("subtitle") or ""))
        if subtitle:
            text.append(
                {
                    "id": f"text-{index + 1}",
                    "type": "subtitle",
                    "start": start,
                    "end": end,
                    "text": subtitle,
                    "style": {},
                }
            )
        cursor = end
    return {
        "version": 1,
        "duration": round_to_frame(cursor, fps),
        "video": normalize_video_clips(video, fps),
        "text": prevent_timeline_text_overlap(normalize_text_clips(text, fps), fps),
        "audio": [],
    }


def normalize_ai_timeline(value: Any, image_urls: list[str]) -> dict[str, Any]:
    fps = 30
    if isinstance(value, dict) and isinstance(value.get("timeline"), dict):
        value = value["timeline"]
    if not isinstance(value, dict):
        return {"version": 1, "duration": 0, "video": [], "text": [], "audio": []}

    if not value.get("text") and value.get("scenes"):
        legacy_story = {"video": {"fps": fps}, "scenes": value.get("scenes"), "audio": {}}
        return timeline_from_legacy_scenes(legacy_story, fps)

    video = replace_default_video_clip_sources(normalize_video_clips(value.get("video"), fps), image_urls)
    text = prevent_timeline_text_overlap(normalize_text_clips(value.get("text"), fps), fps)
    audio = normalize_audio_clips(value.get("audio"), fps)
    if not video and text:
        video = normalize_video_clips(
            [
                {
                    "id": f"video-{index + 1}",
                    "type": "image",
                    "start": clip["start"],
                    "end": clip["end"],
                    "src": image_urls[index] if index < len(image_urls) else DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)],
                    "effect": DEFAULT_EFFECTS[index % len(DEFAULT_EFFECTS)],
                }
                for index, clip in enumerate(text)
            ],
            fps,
        )
    duration = round_to_frame(
        max(
            [
                float(value.get("duration") or 0),
                *[float(clip["end"]) for clip in video if clip.get("end") is not None],
                *[float(clip["end"]) for clip in text if clip.get("end") is not None],
                *[float(clip["end"]) for clip in audio if clip.get("end") is not None],
            ]
        ),
        fps,
    )
    return {"version": 1, "duration": duration, "video": video, "text": text, "audio": audio}


def generate_story_scenes_with_ai(source: dict[str, Any], image_urls: list[str] | None = None) -> list[dict[str, Any]]:
    image_urls = list(dict.fromkeys(image_urls or []))
    fallback = build_fallback_scenes(source, image_urls)
    settings = get_settings()
    if not settings.deepseek_api_key:
        return fallback

    compact_parts = []
    for part in source.get("parts") or []:
        if not isinstance(part, dict):
            continue
        compact_parts.append(
            {
                "part_number": part.get("part_number"),
                "title": part.get("title"),
                "goal": part.get("goal"),
                "hook_direction": part.get("hook_direction"),
                "main_beats": part.get("main_beats"),
                "ending_direction": part.get("ending_direction"),
                "production_notes": part.get("production_notes"),
            }
        )

    plan = source.get("plan") if isinstance(source.get("plan"), dict) else {}
    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    prompt_payload = {
        "task": "Generate story_data scenes for a vertical short video from Module 2 production handoff.",
        "required_output": {
            "scenes": [
                {
                    "duration": "integer seconds, usually 4",
                    "image": "one of available_images or a provided default asset path",
                    "effect": f"one of {DEFAULT_EFFECTS}",
                    "subtitle": "Vietnamese narration subtitle, cinematic, concise",
                }
            ]
        },
        "rules": [
            "Return only valid JSON object, no markdown.",
            "Create scenes from the Module 2 script structure in this exact order: hook_direction, each main_beats item, ending_direction.",
            "Do not drop any hook_direction, main_beats, or ending_direction unless it is empty.",
            "Use the plan to choose angle, tone, audience, format, target duration, and production requirements.",
            "Use the raw article/full_text/source_content only to ground facts and add specificity. Do not invent facts outside it.",
            "Every subtitle must preserve the meaning of its source script beat while being natural for narration.",
            "Create 3 to 8 scenes depending on the number of script beats.",
            "Each scene subtitle must be a complete Vietnamese sentence under 140 characters.",
            "Use available_images in order when possible; otherwise use default_images.",
            "Use duration 4 unless plan target duration or narration length genuinely needs 3, 5, or 6 seconds.",
        ],
        "title": source.get("title"),
        "summary": source.get("summary"),
        "plan": {
            "title": plan.get("title"),
            "content_angle": plan.get("content_angle"),
            "target_audience": plan.get("target_audience"),
            "tone": plan.get("tone"),
            "format": plan.get("format"),
            "planning_mode": plan.get("planning_mode"),
            "target_duration_seconds": plan.get("target_duration_seconds"),
            "production_requirements": plan.get("production_requirements"),
            "ai_reasoning": plan.get("ai_reasoning"),
            "risk_level": plan.get("risk_level"),
        },
        "script_parts": compact_parts,
        "raw_article": {
            "source_content": {
                "id": (raw_article.get("source_content") or {}).get("id") if isinstance(raw_article.get("source_content"), dict) else None,
                "canonical_title": (raw_article.get("source_content") or {}).get("canonical_title") if isinstance(raw_article.get("source_content"), dict) else None,
                "summary": (raw_article.get("source_content") or {}).get("summary") if isinstance(raw_article.get("source_content"), dict) else None,
                "full_text": truncate_text(str((raw_article.get("source_content") or {}).get("full_text") or source.get("full_text") or source.get("source_text") or ""), 3500) if isinstance(raw_article.get("source_content"), dict) else truncate_text(str(source.get("full_text") or source.get("source_text") or ""), 3500),
                "source_url": (raw_article.get("source_content") or {}).get("source_url") if isinstance(raw_article.get("source_content"), dict) else None,
                "canonical_url": (raw_article.get("source_content") or {}).get("canonical_url") if isinstance(raw_article.get("source_content"), dict) else None,
            },
            "raw_source": raw_article.get("raw_source") or {},
        },
        "available_images": image_urls,
        "default_images": DEFAULT_IMAGES,
        "allowed_effects": DEFAULT_EFFECTS,
    }
    payload = {
        "model": "deepseek-v4-flash",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a Vietnamese short-video scriptwriter. "
                    "You output production-ready JSON scenes matching the exact schema."
                ),
            },
            {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
        ],
        "temperature": 0.65,
        "response_format": {"type": "json_object"},
    }
    try:
        data = post_json(f"{settings.deepseek_base_url.rstrip('/')}/chat/completions", payload, settings.deepseek_api_key, timeout=35)
        content = data["choices"][0]["message"]["content"].strip()
        parsed = json.loads(strip_json_fence(content))
        scenes = parsed.get("scenes") if isinstance(parsed, dict) else parsed
        normalized = normalize_ai_scenes(scenes, image_urls)
        return normalized or fallback
    except Exception:
        return fallback


def build_fallback_scenes(source: dict[str, Any], image_urls: list[str]) -> list[dict[str, Any]]:
    parts = source.get("parts") or []
    script_scenes = build_script_scenes_from_parts(parts)
    if script_scenes:
        subtitles = script_scenes
    else:
        title = source.get("title") or "Bản tin"
        text = source.get("source_text") or source.get("full_text") or source.get("summary") or ""
        subtitles = split_to_scenes(str(text), str(title))
    return normalize_ai_scenes(
        [
            {
                "duration": 4,
                "image": image_urls[index] if index < len(image_urls) else DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)],
                "effect": DEFAULT_EFFECTS[index % len(DEFAULT_EFFECTS)],
                "subtitle": subtitle,
            }
            for index, subtitle in enumerate(subtitles or [source.get("title") or "Nội dung đang chờ biên tập."])
        ],
        image_urls,
    )


def build_script_scenes_from_parts(parts: Any) -> list[str]:
    if not isinstance(parts, list):
        return []
    scenes: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        hook = part.get("hook_direction")
        if hook:
            scenes.append(to_short_subtitle(str(hook)))

        beats = part.get("main_beats") or []
        if isinstance(beats, list):
            for beat in beats:
                if beat:
                    scenes.append(to_short_subtitle(str(beat)))

        ending = part.get("ending_direction")
        if ending:
            scenes.append(to_short_subtitle(str(ending)))

    return list(dict.fromkeys(item for item in scenes if item))[:6]


def normalize_ai_scenes(scenes: Any, image_urls: list[str]) -> list[dict[str, Any]]:
    if not isinstance(scenes, list):
        return []
    normalized = []
    for index, item in enumerate(scenes[:8]):
        if not isinstance(item, dict):
            continue
        subtitle = truncate_text(str(item.get("subtitle") or "").strip(), 180)
        if not subtitle:
            continue
        try:
            duration = int(float(item.get("duration") or 4))
        except (TypeError, ValueError):
            duration = 4
        image = str(item.get("image") or "").strip()
        if not image or (image_urls and image in DEFAULT_IMAGES):
            image = image_urls[index] if index < len(image_urls) else DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)]
        effect = str(item.get("effect") or "").strip()
        if effect not in DEFAULT_EFFECTS:
            effect = DEFAULT_EFFECTS[index % len(DEFAULT_EFFECTS)]
        normalized.append(
            {
                "duration": max(3, min(8, duration)),
                "image": image,
                "effect": effect,
                "subtitle": subtitle,
            }
        )
    return normalized


def replace_default_video_clip_sources(video_clips: list[dict[str, Any]], image_urls: list[str]) -> list[dict[str, Any]]:
    if not image_urls:
        return video_clips
    next_clips = []
    for index, clip in enumerate(video_clips):
        src = str(clip.get("src") or "").strip()
        if not src or src in DEFAULT_IMAGES:
            next_clips.append({**clip, "src": image_urls[index % len(image_urls)]})
        else:
            next_clips.append(clip)
    return next_clips


def split_to_scenes(text: str, title: str) -> list[str]:
    clean = re.sub(r"\s+", " ", text or "").strip()
    sentences = [part.strip() for part in re.split(r"(?<=[.!?。！？])\s+", clean) if part.strip()]
    if not sentences:
        sentences = [title, "Câu chuyện vẫn còn nhiều điều cần được làm rõ.", "Theo dõi tiếp để nắm các điểm chính."]
    elif len(sentences) < 3:
        sentences = [title, *sentences, "Điểm quan trọng nằm ở bối cảnh, nguyên nhân và cách xử lý đúng."]

    scene_count = 5 if len(clean) > 1200 else 4 if len(clean) > 650 else 3
    selected = sentences[: max(scene_count, min(len(sentences), 8))]
    chunks: list[str] = []
    cursor = 0
    for index in range(scene_count):
        remaining_sentences = len(selected) - cursor
        remaining_scenes = scene_count - index
        take = max(1, (remaining_sentences + remaining_scenes - 1) // remaining_scenes)
        chunk = " ".join(selected[cursor : cursor + take]).strip()
        cursor += take
        chunks.append(to_short_subtitle(chunk or title))

    return chunks


def to_short_subtitle(text: str) -> str:
    clean = re.sub(r"\s+", " ", text or "").strip()
    if len(clean) <= 135:
        return clean
    clauses = [part.strip() for part in re.split(r"[,;:–-]\s+", clean) if part.strip()]
    if clauses and 45 <= len(clauses[0]) <= 135:
        return clauses[0]
    words = clean.split()
    result = []
    for word in words:
        candidate = " ".join([*result, word])
        if len(candidate) > 135:
            break
        result.append(word)
    return " ".join(result).rstrip(".,;:")


def build_subtitle_from_part(payload: dict[str, Any], raw_source: dict[str, Any] | None = None) -> str:
    beats = payload.get("main_beats") or []
    if isinstance(beats, list) and beats:
        text = str(beats[0])
    else:
        text = " ".join(
            str(item)
            for item in [payload.get("title"), payload.get("goal"), payload.get("hook_direction"), payload.get("ending_direction")]
            if item
        )
    if not text and raw_source:
        text = raw_source.get("text") or raw_source.get("content") or raw_source.get("summary") or ""
    return to_short_subtitle(text or payload.get("title") or "Nội dung phần này đang chờ biên tập.")


def collect_image_urls(source: dict[str, Any]) -> list[str]:
    images = [str(item) for item in source.get("images", []) if item]
    media = source.get("media") or []
    for item in media:
        if isinstance(item, str):
            images.append(item)
            continue
        url = item.get("storage_url") or item.get("source_url") or item.get("thumbnail_url") or item.get("url")
        media_type = (item.get("media_type") or item.get("type") or "").upper()
        if url and ("IMAGE" in media_type or "THUMBNAIL" in media_type or not media_type):
            images.append(url)
    return list(dict.fromkeys(images))


def tag_with_deepseek(story: dict[str, Any], settings) -> list[str]:
    if not settings.deepseek_api_key:
        raise RuntimeError("Missing ACD_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY")

    lines = [strip_voice_tags(str(clip.get("text") or "")) for clip in timeline_text_clips(story)]
    payload = {
        "model": "deepseek-v4-flash",
        "messages": [
            {"role": "system", "content": "You prepare cinematic Vietnamese scripts for ElevenLabs v3."},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": "Add ElevenLabs v3 emotion tags.",
                        "rules": [
                            "Keep Vietnamese text unchanged.",
                            "Return only JSON array of strings.",
                            "Use tags like [whispers], [gasp], [serious], [confident], [sighs], [frustrated].",
                        ],
                        "lines": lines,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        "temperature": 0.4,
    }
    data = post_json(f"{settings.deepseek_base_url.rstrip('/')}/chat/completions", payload, settings.deepseek_api_key, timeout=60)
    content = data["choices"][0]["message"]["content"].strip()
    if content.startswith("```"):
        content = content.strip("`").removeprefix("json").strip()
    tagged = json.loads(content)
    if not isinstance(tagged, list) or len(tagged) != len(lines):
        raise RuntimeError(f"Unexpected DeepSeek response: {content}")
    return [str(item) for item in tagged]


def generate_elevenlabs_voice(story: dict[str, Any], settings, voice_id: str, voice_speed: float, out_path: Path) -> None:
    api_key = get_elevenlabs_api_key(settings)
    if not api_key:
        raise RuntimeError("Missing ELEVENLABS_API_KEY")

    payload = {
        "text": build_voice_text(story),
        "model_id": __import__("os").getenv("ELEVENLABS_MODEL_ID", "eleven_v3"),
        "language_code": __import__("os").getenv("ELEVENLABS_LANGUAGE_CODE", "vi"),
        "voice_settings": {
            "speed": voice_speed,
        },
    }
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format={__import__('os').getenv('ELEVENLABS_OUTPUT_FORMAT', 'mp3_44100_128')}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            audio = response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode("utf-8")) from error
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(audio)


def get_elevenlabs_api_key(settings=None) -> str:
    if settings is None:
        try:
            from common.core.config import settings as app_settings

            settings = app_settings
        except Exception:
            settings = None
    return (getattr(settings, "elevenlabs_api_key", "") if settings else "") or __import__("os").getenv("ELEVENLABS_API_KEY", "")


def build_voice_text(story: dict[str, Any]) -> str:
    return "\n\n".join(
        strip_voice_tags(str(clip.get("voice_text") or clip.get("text") or ""))
        for clip in timeline_text_clips(story)
    )


def transcribe_whisper(api_key: str, audio_path: Path, prompt: str | None = None) -> dict[str, Any]:
    fields = [
        ("model", "whisper-1"),
        ("language", "vi"),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "segment"),
        ("timestamp_granularities[]", "word"),
    ]
    if prompt:
        fields.append(("prompt", prompt))

    body, boundary = encode_multipart(
        fields=fields,
        files={"file": audio_path},
    )
    request = urllib.request.Request(
        "https://api.openai.com/v1/audio/transcriptions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode("utf-8")) from error


def encode_multipart(fields: dict[str, str] | list[tuple[str, str]], files: dict[str, Path]) -> tuple[bytes, str]:
    boundary = f"----module3-{uuid.uuid4().hex}"
    body = bytearray()
    field_items = fields.items() if isinstance(fields, dict) else fields
    for name, value in field_items:
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")
    for name, path in files.items():
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'.encode())
        body.extend(f"Content-Type: {content_type}\r\n\r\n".encode())
        body.extend(path.read_bytes())
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())
    return bytes(body), boundary


def post_json(url: str, payload: dict[str, Any], api_key: str, timeout: int = 120) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode("utf-8")) from error


def map_scenes_to_segments(scene_texts: list[str], segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    remaining = list(segments)
    ranges = []
    for scene_text in scene_texts:
        best_score = 0.0
        best_end_index = -1
        combined = ""
        for index in range(min(len(remaining), 4)):
            combined = f"{combined} {remaining[index].get('text', '')}".strip()
            score = word_similarity(scene_text, combined)
            if score >= best_score:
                best_score = score
                best_end_index = index
        if best_end_index == -1 or best_score < 0.25:
            ranges.append({"start": None, "end": None, "score": best_score, "text": ""})
            continue
        matched = remaining[: best_end_index + 1]
        del remaining[: best_end_index + 1]
        ranges.append(
            {
                "start": float(matched[0]["start"]),
                "end": float(matched[-1]["end"]),
                "score": best_score,
                "text": " ".join(segment.get("text", "") for segment in matched).strip(),
            }
        )
    return ranges


def map_scenes_to_word_ranges(
    scene_texts: list[str],
    words: list[dict[str, Any]],
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not words:
        return map_scenes_to_segment_ranges(scene_texts, segments)

    total_scene_words = sum(len(get_words(text)) for text in scene_texts)
    if total_scene_words and len(words) < total_scene_words * 0.6:
        return [{"start": None, "end": None, "wordStartIndex": None, "wordEndIndex": None} for _ in scene_texts]

    ranges = []
    cursor = 0
    for scene_text in scene_texts:
        length = len(get_words(scene_text))
        start_index = cursor
        end_index = cursor + length - 1
        timed_words = [
            word
            for word in words[start_index : end_index + 1]
            if word.get("start") is not None and word.get("end") is not None
        ]
        ranges.append(
            {
                "start": timed_words[0].get("start") if timed_words else None,
                "end": timed_words[-1].get("end") if timed_words else None,
                "wordStartIndex": start_index,
                "wordEndIndex": end_index,
            }
        )
        cursor += length
    return ranges


def map_scenes_to_segment_ranges(scene_texts: list[str], segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total_words = sum(len(get_words(text)) for text in scene_texts)
    audio_end = float(segments[-1].get("end") or 0) if segments else 0.0
    cursor = 0
    ranges = []
    for scene_text in scene_texts:
        word_count = len(get_words(scene_text))
        start = (cursor / total_words) * audio_end if total_words > 0 else None
        cursor += word_count
        end = (cursor / total_words) * audio_end if total_words > 0 else None
        ranges.append({"start": start, "end": end})
    return ranges


def get_words(text: str) -> list[str]:
    return strip_voice_tags(text).split()


def strip_voice_tags(text: str) -> str:
    return re.sub(r"\[[^\]]+\]\s*", "", text or "").strip()


def strip_json_fence(text: str) -> str:
    clean = (text or "").strip()
    if clean.startswith("```"):
        clean = clean.strip("`").strip()
        if clean.startswith("json"):
            clean = clean[4:].strip()
    return clean


def normalize_text(text: str) -> str:
    text = strip_voice_tags(text).lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def word_similarity(left: str, right: str) -> float:
    left_words = set(normalize_text(left).split())
    right_words = set(normalize_text(right).split())
    if not left_words or not right_words:
        return 0.0
    return len(left_words & right_words) / max(len(left_words), len(right_words))


def round_to_frame(seconds: float, fps: int) -> float:
    return max(1 / fps, round(seconds * fps) / fps)


def clamp_voice_speed(value: float) -> float:
    try:
        speed = float(value)
    except (TypeError, ValueError):
        speed = 1.0
    return max(0.7, min(1.2, speed))


def truncate_text(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len].rsplit(" ", 1)[0] + "..."
