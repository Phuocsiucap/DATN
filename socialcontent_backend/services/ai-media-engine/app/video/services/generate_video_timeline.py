from __future__ import annotations

import json
import math
import re
import unicodedata
from typing import Any
from common.planning.auto_draft_policy import sync_compact_scenes

from app.video.services.generate_video_constants import DEFAULT_EFFECTS, DEFAULT_IMAGES


def normalize_story_for_project(story: dict[str, Any]) -> dict[str, Any]:
    next_story = json.loads(json.dumps(story, ensure_ascii=False))
    sanitize_story_subtitles(next_story)
    replace_default_images_with_source_images(next_story)
    sync_story_timeline(next_story)
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
    if normalized.get("project_status") is not None:
        payload["project_status"] = normalized.get("project_status")
    return payload



def sanitize_story_subtitles(story: dict[str, Any]) -> None:
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    text_clips = timeline.get("text") if isinstance(timeline.get("text"), list) else []
    for clip in text_clips:
        if isinstance(clip, dict) and clip.get("text") is not None:
            text = strip_voice_tags(str(clip.get("text") or ""))
            if "manual_direct_script" in text or "bypass_ai_selection" in text or text.startswith("{'") or text.startswith("{\""):
                clip["text"] = ""
            else:
                clip["text"] = text



def sync_story_timeline(story: dict[str, Any]) -> None:
    fps = int((story.get("video") or {}).get("fps") or 30)
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    if not timeline:
        timeline = timeline_from_legacy_scenes(story, fps)

    video_clips = collapse_shared_video_clips(normalize_video_clips(timeline.get("video"), fps), fps)
    text_clips = prevent_timeline_text_overlap(normalize_text_clips(timeline.get("text"), fps), fps)
    video_clips = fit_video_clips_to_text(video_clips, text_clips, fps)
    audio_clips = normalize_audio_clips(timeline.get("audio"), fps)
    timeline_metadata = timeline.get("metadata") if isinstance(timeline.get("metadata"), dict) else {}
    if "full_script" in timeline_metadata:
        timeline_metadata = {**timeline_metadata, "full_script": " ".join(str(clip.get("voice_text") or clip.get("text") or "").strip() for clip in text_clips)}
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
    if timeline_metadata:
        story["timeline"]["metadata"] = timeline_metadata

    scenes = []
    count = max(len(text_clips), len(video_clips))
    for idx in range(count):
        t_clip = text_clips[idx] if idx < len(text_clips) else {}
        v_clip = _video_clip_for_text(video_clips, t_clip, idx) if t_clip else (video_clips[idx] if idx < len(video_clips) else {})
        text_str = str(t_clip.get("text") or "").strip()
        if not text_str and not v_clip.get("src"):
            continue
        scenes.append({
            "scene_index": t_clip.get("scene_index") if t_clip.get("scene_index") is not None else v_clip.get("scene_index"),
            "video_id": v_clip.get("id"),
            "text_id": t_clip.get("id"),
            **({"video_ids": _clip_video_ids(t_clip)} if _clip_video_ids(t_clip) else {}),
            **({"text_ids": _clip_text_ids(v_clip)} if _clip_text_ids(v_clip) else {}),
            "subtitle": text_str,
            "voice_text": t_clip.get("voice_text") or text_str,
            "image": v_clip.get("src") or "",
            "media_type": v_clip.get("type") or "image",
            "effect": v_clip.get("effect") or "slow-zoom",
            "fit": v_clip.get("fit") or "contain",
            "duration": t_clip.get("duration") or v_clip.get("duration") or 4,
            "subtitle_start": t_clip.get("start"),
            "subtitle_duration": t_clip.get("duration"),
        })
    story["story_data"] = scenes
    story.pop("scenes", None)


def _video_clip_for_text(video_clips: list[dict[str, Any]], text_clip: dict[str, Any], fallback_index: int) -> dict[str, Any]:
    if not video_clips:
        return {}

    video_ids = _clip_video_ids(text_clip)
    if video_ids:
        matched = next((clip for clip in video_clips if str(clip.get("id") or "") in video_ids), None)
        if matched:
            return matched

    text_id = str(text_clip.get("id") or "")
    if text_id:
        matched = next((clip for clip in video_clips if text_id in _clip_text_ids(clip)), None)
        if matched:
            return matched

    matched = next((clip for clip in video_clips if _clip_overlap_seconds(clip, text_clip) > 0), None)
    if matched:
        return matched

    return video_clips[fallback_index] if fallback_index < len(video_clips) else video_clips[-1]



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
        scene_index = _clip_scene_index(scene, index)
        text_id = str(scene.get("text_id") or f"text-{index + 1}")
        video_id = str(scene.get("video_id") or scene.get("id") or f"video-{index + 1}")
        media_type = normalize_visual_media_type(scene.get("media_type") or scene.get("type"), scene.get("image") or scene.get("src"))
        video.append(
            {
                "id": video_id,
                "scene_index": scene_index,
                "type": media_type,
                "start": start,
                "end": end,
                "src": scene.get("image") or DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)],
                "effect": scene.get("effect") or DEFAULT_EFFECTS[0],
                "fit": normalize_media_fit(scene.get("fit")),
                **({"text_ids": [text_id], "text_id": text_id} if strip_voice_tags(str(scene.get("subtitle") or "")) else {}),
            }
        )
        subtitle = strip_voice_tags(str(scene.get("subtitle") or ""))
        if subtitle:
            text_start = scene.get("subtitle_start") if scene.get("subtitle_start") is not None else start
            text_duration = scene.get("subtitle_duration") if scene.get("subtitle_duration") is not None else duration
            text.append(
                {
                    "id": text_id,
                    "scene_index": scene_index,
                    "video_id": video_id,
                    "video_ids": _clip_video_ids(scene) or [video_id],
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
        clip = {
            "id": str(item.get("id") or f"video-{index + 1}"),
            "type": str(item.get("type") or "image"),
            "start": start,
            "end": end,
            "duration": round_to_frame(end - start, fps),
            "src": item.get("src") or item.get("image") or DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)],
            "effect": item.get("effect") or DEFAULT_EFFECTS[0],
            "fit": normalize_media_fit(item.get("fit")),
        }
        clip["scene_index"] = _clip_scene_index(item, index)
        text_ids = _clip_text_ids(item)
        if text_ids:
            clip["text_ids"] = text_ids
            clip["text_id"] = text_ids[0]
        if item.get("scene_number") is not None:
            clip["scene_number"] = item.get("scene_number")
        if item.get("visual_direction"):
            clip["visual_direction"] = str(item.get("visual_direction"))
        if isinstance(item.get("text_weights"), dict):
            clip["text_weights"] = dict(item["text_weights"])
        if type(item.get("source_media_index")) is int:
            clip["source_media_index"] = item["source_media_index"]
        clips.append(clip)
    return sorted(clips, key=lambda clip: (clip["start"], clip["end"]))


def collapse_shared_video_clips(video_clips: list[dict[str, Any]], fps: int) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    order: list[tuple[str, str]] = []
    passthrough: list[dict[str, Any]] = []

    for clip in video_clips:
        if str(clip.get("type") or "").lower() != "video" or not clip.get("id"):
            passthrough.append(clip)
            continue
        key = (str(clip.get("id")), str(clip.get("src") or ""))
        existing = grouped.get(key)
        if not existing:
            grouped[key] = {**clip}
            order.append(key)
            continue
        start = min(float(existing.get("start") or 0.0), float(clip.get("start") or 0.0))
        end = max(float(existing.get("end") or 0.0), float(clip.get("end") or 0.0))
        text_ids = list(dict.fromkeys([*(_clip_text_ids(existing)), *(_clip_text_ids(clip))]))
        grouped[key] = {
            **existing,
            "start": round_to_frame(start, fps),
            "end": round_to_frame(end, fps),
            "duration": round_to_frame(max(1 / max(1, fps), end - start), fps),
            **({"text_ids": text_ids, "text_id": text_ids[0]} if text_ids else {}),
        }

    return sorted([*passthrough, *[grouped[key] for key in order]], key=lambda clip: (clip["start"], clip["end"]))



def normalize_media_fit(value: Any) -> str:
    return "cover" if str(value or "").lower() == "cover" else "contain"


def normalize_visual_media_type(value: Any, src: Any = None) -> str:
    media_type = str(value or "").lower()
    if "video" in media_type:
        return "video"
    if re.search(r"\.(?:mp4|webm|mov|m4v)(?:[?#]|$)", str(src or ""), flags=re.IGNORECASE):
        return "video"
    return "image"


def _clip_scene_index(item: dict[str, Any], fallback: int) -> int:
    for key in ("scene_index", "sceneIndex"):
        try:
            value = int(float(item.get(key)))
        except (TypeError, ValueError):
            continue
        return max(0, value)
    for key in ("scene_number", "sceneNumber"):
        try:
            value = int(float(item.get(key)))
        except (TypeError, ValueError):
            continue
        return max(0, value - 1)
    return max(0, fallback)


def _clip_text_ids(item: dict[str, Any]) -> list[str]:
    values: list[Any] = []
    raw_list = item.get("text_ids") if item.get("text_ids") is not None else item.get("textIds")
    if isinstance(raw_list, list):
        values.extend(raw_list)
    raw_single = item.get("text_id") if item.get("text_id") is not None else item.get("textId")
    if raw_single is not None:
        values.append(raw_single)
    return list(dict.fromkeys(str(value) for value in values if str(value or "").strip()))


def _clip_video_ids(item: dict[str, Any]) -> list[str]:
    values: list[Any] = []
    raw_list = item.get("video_ids") if item.get("video_ids") is not None else item.get("videoIds")
    if isinstance(raw_list, list):
        values.extend(raw_list)
    raw_single = item.get("video_id") if item.get("video_id") is not None else item.get("videoId")
    if raw_single is not None:
        values.append(raw_single)
    return list(dict.fromkeys(str(value) for value in values if str(value or "").strip()))


def link_timeline_visual_text(video_clips: list[dict[str, Any]], text_clips: list[dict[str, Any]]) -> None:
    if not video_clips or not text_clips:
        return

    text_by_id = {str(clip.get("id")): clip for clip in text_clips if clip.get("id")}
    # Snapshot both directions before mutating either. Explicit IDs take priority
    # over scene indexes, which cannot represent a many-to-many relationship.
    reverse = {str(clip.get("id")): set(_clip_video_ids(clip)) for clip in text_clips}
    forward = {str(clip.get("id")): set(_clip_text_ids(clip)) for clip in video_clips}
    explicit_texts = {key for key, refs in reverse.items() if refs} | set().union(*forward.values())
    for text_clip in text_clips:
        text_clip.pop("video_id", None)
        text_clip.pop("video_ids", None)
    text_by_scene: dict[int, list[dict[str, Any]]] = {}
    for index, text_clip in enumerate(text_clips):
        scene_index = _clip_scene_index(text_clip, index)
        text_clip["scene_index"] = scene_index
        text_by_scene.setdefault(scene_index, []).append(text_clip)

    claimed_ids: set[str] = set()
    for index, video_clip in enumerate(video_clips):
        scene_index = _clip_scene_index(video_clip, index)
        video_clip["scene_index"] = scene_index
        linked = [text_by_id[text_id] for text_id in _clip_text_ids(video_clip) if text_id in text_by_id]
        has_forward = bool(forward.get(str(video_clip.get("id"))))
        if not linked and not has_forward:
            linked = [clip for clip in text_clips if str(video_clip.get("id")) in reverse.get(str(clip.get("id")), set())]
        if not linked and not has_forward:
            linked = [clip for clip in text_by_scene.get(scene_index, []) if str(clip.get("id")) not in explicit_texts]
        if not linked and not has_forward:
            linked = [
                text_clip
                for text_clip in text_clips
                if str(text_clip.get("id")) not in explicit_texts and _clip_overlap_seconds(video_clip, text_clip) > 0
            ]
        if not linked and not has_forward and index < len(text_clips) and str(text_clips[index].get("id")) not in explicit_texts:
            linked = [text_clips[index]]
        text_ids = [str(text_clip.get("id")) for text_clip in linked if text_clip.get("id")]
        if not text_ids:
            continue
        video_clip["text_ids"] = list(dict.fromkeys(text_ids))
        video_clip["text_id"] = video_clip["text_ids"][0]
        for text_clip in linked:
            text_clip["scene_index"] = scene_index
            video_ids = _clip_video_ids(text_clip)
            video_ids.append(str(video_clip.get("id")))
            text_clip["video_ids"] = list(dict.fromkeys(video_ids))
            text_clip["video_id"] = text_clip["video_ids"][0]
            if text_clip.get("id"):
                claimed_ids.add(str(text_clip["id"]))

    if claimed_ids == {str(clip.get("id")) for clip in text_clips if clip.get("id")}:
        return

    last_video = video_clips[-1]
    last_scene_index = _clip_scene_index(last_video, len(video_clips) - 1)
    last_ids = list(last_video.get("text_ids") or [])
    for text_clip in text_clips:
        text_id = str(text_clip.get("id") or "")
        if not text_id or text_id in claimed_ids or text_id in explicit_texts:
            continue
        text_clip["scene_index"] = last_scene_index
        video_ids = _clip_video_ids(text_clip)
        video_ids.append(str(last_video.get("id")))
        text_clip["video_ids"] = list(dict.fromkeys(video_ids))
        text_clip["video_id"] = text_clip["video_ids"][0]
        last_ids.append(text_id)
    if last_ids:
        last_video["text_ids"] = list(dict.fromkeys(str(item) for item in last_ids if str(item or "").strip()))
        last_video["text_id"] = last_video["text_ids"][0]


def _clip_overlap_seconds(left: dict[str, Any], right: dict[str, Any]) -> float:
    try:
        start = max(float(left.get("start") or 0), float(right.get("start") or 0))
        end = min(float(left.get("end") or 0), float(right.get("end") or 0))
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, end - start)



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
            "scene_index": _clip_scene_index(item, index),
            "type": "subtitle",
            "start": start,
            "end": end,
            "duration": round_to_frame(end - start, fps),
            "text": text,
            "style": item.get("style") if isinstance(item.get("style"), dict) else {},
        }
        if item.get("video_id"):
            clip["video_id"] = str(item.get("video_id"))
        video_ids = _clip_video_ids(item)
        if video_ids:
            clip["video_ids"] = video_ids
            clip["video_id"] = video_ids[0]
        if item.get("voice_text"):
            clip["voice_text"] = str(item.get("voice_text"))
        if item.get("role"):
            clip["role"] = str(item.get("role"))
        if isinstance(item.get("evidence_ids"), list):
            clip["evidence_ids"] = [str(value) for value in item.get("evidence_ids") if str(value).strip()]
        if item.get("scene_number") is not None:
            clip["scene_number"] = item.get("scene_number")
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



def collect_story_image_urls(story: dict[str, Any]) -> list[str]:
    source = story.get("source") if isinstance(story.get("source"), dict) else {}
    image_urls = collect_image_urls(source)
    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    if isinstance(raw_article.get("source_content"), dict):
        image_urls += collect_image_urls(raw_article["source_content"])
    if isinstance(raw_article.get("raw_source"), dict):
        image_urls += collect_image_urls(raw_article["raw_source"])
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    video_clips = timeline.get("video") if isinstance(timeline.get("video"), list) else []
    image_urls += [str(clip.get("src")) for clip in video_clips if isinstance(clip, dict) and clip.get("src")]
    return list(dict.fromkeys(item for item in image_urls if item))



def invalidate_story_voice(story: dict[str, Any]) -> None:
    audio = story.get("audio") if isinstance(story.get("audio"), dict) else {}
    audio.pop("voice", None)
    audio.pop("voiceProvider", None)
    audio.pop("voiceId", None)
    tracks = audio.get("tracks") if isinstance(audio.get("tracks"), list) else []
    audio["tracks"] = [track for track in tracks if not (isinstance(track, dict) and str(track.get("type") or "").lower() == "voice")]
    story["audio"] = audio
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    timeline_audio = timeline.get("audio") if isinstance(timeline.get("audio"), list) else []
    timeline["audio"] = [clip for clip in timeline_audio if not (isinstance(clip, dict) and str(clip.get("type") or "").lower() == "voice")]
    story["timeline"] = timeline
    story.setdefault("meta", {})
    story["meta"]["voice_invalidated_by_story_review"] = True



def fit_video_clips_to_text(video_value: Any, text_clips: list[dict[str, Any]], fps: int) -> list[dict[str, Any]]:
    video_clips = normalize_video_clips(video_value, fps)
    if not video_clips or not text_clips:
        return video_clips

    link_timeline_visual_text(video_clips, text_clips)
    text_by_id = {str(clip.get("id")): clip for clip in text_clips if clip.get("id")}
    videos_by_text_id: dict[str, list[dict[str, Any]]] = {}
    for video_clip in video_clips:
        for text_id in _clip_text_ids(video_clip):
            videos_by_text_id.setdefault(text_id, []).append(video_clip)

    # Partition each text once, then join adjacent pieces belonging to the same
    # visual. This also handles v1=[t1,t2], v2=[t2,t3] without duplicating t2.
    ranges: dict[str, list[tuple[float, float]]] = {}
    for text_id, siblings in videos_by_text_id.items():
        text_clip = text_by_id.get(text_id)
        if not text_clip:
            continue
        weights = []
        for sibling in siblings:
            stored = (sibling.get("text_weights") or {}).get(text_id)
            if isinstance(stored, (int, float)) and math.isfinite(stored) and stored > 0:
                weights.append(float(stored))
            else:
                overlap = _clip_overlap_seconds(sibling, text_clip)
                weights.append(overlap or max(1 / fps, float(sibling.get("duration") or 1)))
        total = sum(weights)
        start = float(text_clip.get("start") or 0)
        end = max(start + 1 / fps, float(text_clip.get("end") or start + 1))
        cursor = start
        for index, sibling in enumerate(siblings):
            fraction = weights[index] / total
            next_end = end if index == len(siblings) - 1 else cursor + (end - start) * fraction
            ranges.setdefault(str(sibling.get("id")), []).append((cursor, next_end))
            # Persist proportions so normalizing again or fitting to new voice
            # timing does not progressively shift a mixed relationship.
            sibling.setdefault("text_weights", {})[text_id] = fraction
            cursor = next_end

    fitted: list[dict[str, Any]] = []
    last_end = 0.0
    for index, clip in enumerate(video_clips):
        linked_texts = [text_by_id[text_id] for text_id in _clip_text_ids(clip) if text_id in text_by_id]
        if not linked_texts:
            linked_texts = [
                text_clip
                for text_clip in text_clips
                if str(text_clip.get("video_id") or "") == str(clip.get("id") or "")
                or _clip_scene_index(text_clip, index) == _clip_scene_index(clip, index)
            ]
        if not linked_texts:
            fitted.append(clip)
            continue
        portions = ranges.get(str(clip.get("id")), [])
        if portions:
            start = round_to_frame(max(last_end, min(item[0] for item in portions)), fps)
            end = round_to_frame(max(start + 1 / fps, max(item[1] for item in portions)), fps)
        else:
            start, end = _fit_video_range_for_linked_texts(clip, linked_texts, videos_by_text_id, last_end, fps)
        text_ids = [str(text_clip.get("id")) for text_clip in linked_texts if text_clip.get("id")]
        next_clip = {
            **clip,
            "id": str(clip.get("id") or f"video-{index + 1}"),
            "start": start,
            "end": end,
            "duration": round_to_frame(end - start, fps),
            "text_ids": list(dict.fromkeys(text_ids)),
        }
        if next_clip["text_ids"]:
            next_clip["text_id"] = next_clip["text_ids"][0]
        fitted.append(next_clip)
        last_end = end

    return fitted


def _fit_video_range_for_linked_texts(
    video_clip: dict[str, Any],
    linked_texts: list[dict[str, Any]],
    videos_by_text_id: dict[str, list[dict[str, Any]]],
    last_end: float,
    fps: int,
) -> tuple[float, float]:
    if len(linked_texts) == 1:
        text_clip = linked_texts[0]
        sibling_videos = videos_by_text_id.get(str(text_clip.get("id") or ""), [])
        if len(sibling_videos) > 1:
            return _partition_text_range_for_video(video_clip, text_clip, sibling_videos, last_end, fps)

    start = round_to_frame(max(last_end, min(float(text_clip.get("start") or 0.0) for text_clip in linked_texts)), fps)
    end = round_to_frame(max(start + 1 / max(1, fps), max(float(text_clip.get("end") or start + 1) for text_clip in linked_texts)), fps)
    return start, end


def _partition_text_range_for_video(
    video_clip: dict[str, Any],
    text_clip: dict[str, Any],
    sibling_videos: list[dict[str, Any]],
    last_end: float,
    fps: int,
) -> tuple[float, float]:
    ordered = sorted(sibling_videos, key=lambda clip: (float(clip.get("start") or 0.0), float(clip.get("end") or 0.0), str(clip.get("id") or "")))
    text_start = float(text_clip.get("start") or 0.0)
    text_end = max(text_start + 1 / max(1, fps), float(text_clip.get("end") or text_start + 1.0))
    total_text_duration = text_end - text_start
    weights = [max(1 / max(1, fps), float(clip.get("duration") or 0.0) or float(clip.get("end") or 0.0) - float(clip.get("start") or 0.0)) for clip in ordered]
    total_weight = sum(weights) or len(ordered)
    cursor = text_start
    for index, clip in enumerate(ordered):
        duration = total_text_duration * (weights[index] / total_weight)
        next_end = text_end if index == len(ordered) - 1 else cursor + duration
        if clip is video_clip or str(clip.get("id") or "") == str(video_clip.get("id") or ""):
            start = round_to_frame(max(last_end, cursor), fps)
            end = round_to_frame(max(start + 1 / max(1, fps), next_end), fps)
            return start, end
        cursor = next_end
    start = round_to_frame(max(last_end, text_start), fps)
    return start, round_to_frame(max(start + 1 / max(1, fps), text_end), fps)



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



def collect_image_urls(source: dict[str, Any]) -> list[str]:
    images = [str(item) for item in source.get("images", []) if item]
    for item in _collect_media_items(source):
        if isinstance(item, str):
            images.append(item)
            continue
        url = item.get("storage_url") or item.get("source_url") or item.get("thumbnail_url") or item.get("url")
        media_type = (item.get("media_type") or item.get("type") or "").upper()
        if url and ("IMAGE" in media_type or "THUMBNAIL" in media_type or not media_type):
            images.append(url)
    return list(dict.fromkeys(images))


def collect_video_urls(source: dict[str, Any]) -> list[str]:
    videos: list[str] = []
    source_assets = source.get("source_video_assets")
    if isinstance(source_assets, list):
        videos.extend(str(item) for item in source_assets if item)
    for item in _collect_media_items(source):
        if isinstance(item, str):
            if re.search(r"\.(?:mp4|webm|mov|m4v)(?:[?#]|$)", item, flags=re.IGNORECASE):
                videos.append(item)
            continue
        storage_url = str(item.get("storage_url") or "").strip()
        url = storage_url or item.get("source_url") or item.get("url") or item.get("contentUrl")
        mime_type = str(item.get("mime_type") or item.get("mimeType") or "").lower()
        if url and (
            storage_url.startswith("assets/videos/")
            or mime_type.startswith("video/")
            or re.search(r"\.(?:mp4|webm|mov|m4v)(?:[?#]|$)", str(url), flags=re.IGNORECASE)
        ):
            videos.append(str(url))
    return list(dict.fromkeys(videos))



def _collect_media_items(source: dict[str, Any]) -> list[Any]:
    media_items: list[Any] = []
    for value in [source.get("media"), source.get("images")]:
        if isinstance(value, list):
            media_items.extend(value)

    source_content = source.get("source_content") if isinstance(source.get("source_content"), dict) else {}
    if isinstance(source_content.get("media"), list):
        media_items.extend(source_content["media"])

    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    raw_source_content = raw_article.get("source_content") if isinstance(raw_article.get("source_content"), dict) else {}
    if isinstance(raw_source_content.get("media"), list):
        media_items.extend(raw_source_content["media"])
    raw_source = raw_article.get("raw_source") if isinstance(raw_article.get("raw_source"), dict) else {}
    if isinstance(raw_source.get("media"), list):
        media_items.extend(raw_source["media"])
    if isinstance(raw_source.get("images"), list):
        media_items.extend(raw_source["images"])
    return media_items



def get_words(text: str) -> list[str]:
    return strip_voice_tags(text).split()



def strip_voice_tags(text: str) -> str:
    return re.sub(r"\[[^\]]+\]\s*", "", text or "").strip()



def edge_tts_pause_text(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", strip_voice_tags(text)).strip()
    if not cleaned:
        return ""
    if re.search(r"(\.\.\.|[.!?])$", cleaned):
        return cleaned
    if cleaned.endswith((",", ";", ":")):
        return f"{cleaned}..."
    return f"{cleaned}..."



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
    # Zero is a valid timestamp (especially voiceStart). Durations are clamped
    # by the callers; adding a frame here shifts audio and every fitted clip.
    return max(0.0, round(seconds * fps) / fps)



def truncate_text(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len].rsplit(" ", 1)[0] + "..."
