from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

from app.services.generate_video_constants import DEFAULT_EFFECTS, DEFAULT_IMAGES, DEFAULT_VOICE_PROVIDER


def normalize_story_for_project(story: dict[str, Any]) -> dict[str, Any]:
    next_story = json.loads(json.dumps(story, ensure_ascii=False))
    sanitize_story_subtitles(next_story)
    replace_default_images_with_source_images(next_story)
    sync_story_timeline(next_story)
    return next_story



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
    timeline_metadata = timeline.get("metadata") if isinstance(timeline.get("metadata"), dict) else {}
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
                "fit": normalize_media_fit(scene.get("fit")),
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
                "fit": normalize_media_fit(item.get("fit")),
            }
        )
    return sorted(clips, key=lambda clip: (clip["start"], clip["end"]))



def normalize_media_fit(value: Any) -> str:
    return "cover" if str(value or "").lower() == "cover" else "contain"



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

    fitted: list[dict[str, Any]] = []
    last_end = 0.0
    for index, clip in enumerate(video_clips):
        text_clip = text_clips[index] if index < len(text_clips) else None
        if not text_clip:
            fitted.append(clip)
            continue
        start = round_to_frame(max(last_end, float(text_clip.get("start") or clip.get("start") or 0.0)), fps)
        end = round_to_frame(max(start + 1 / max(1, fps), float(text_clip.get("end") or clip.get("end") or start + 1)), fps)
        next_clip = {**clip, "start": start, "end": end, "duration": round_to_frame(end - start, fps)}
        fitted.append(next_clip)
        last_end = end

    return fitted



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
    return max(1 / fps, round(seconds * fps) / fps)



def truncate_text(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len].rsplit(" ", 1)[0] + "..."
