"""Untimed media/text draft contract. No model-provided URL or timing is trusted."""
from __future__ import annotations

from collections import Counter
from typing import Any


LINKED_DRAFT_VERSION = "compact-v2"


def source_media_catalog(media: list[Any]) -> list[dict[str, Any]]:
    catalog = []
    seen = set()
    for item in media:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("media_type") or item.get("type") or "").lower()
        src = item.get("storage_url") or item.get("source_url") or item.get("url")
        # A thumbnail is an image, never a substitute for a playable source video.
        if "video" in kind:
            kind = "video"
        elif not kind or "image" in kind or "thumbnail" in kind:
            kind = "image"
            src = src or item.get("thumbnail_url")
        else:
            continue
        if not src or (kind, str(src)) in seen:
            continue
        seen.add((kind, str(src)))
        catalog.append({"index": len(catalog), "type": kind, "src": str(src),
                        "description": str(item.get("caption") or item.get("alt") or "")[:240]})
    return catalog


def media_prompt_catalog(catalog: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in item.items() if key != "src"} for item in catalog]


def normalize_linked_timeline(value: Any) -> dict[str, Any]:
    timeline = value if isinstance(value, dict) else {}
    result: dict[str, Any] = {}
    for track in ("video", "text"):
        raw = timeline.get(track)
        # Keep malformed rows for validation; never silently drop a model's text.
        result[track] = [dict(item) if isinstance(item, dict) else item for item in raw] if isinstance(raw, list) else raw
    return result


def linked_draft_issues(timeline: dict[str, Any], available_media: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []

    def issue(code: str, message: str, **details: Any) -> None:
        issues.append({"code": code, "message": message, "severity": "CRITICAL", "details": details})

    for track in ("video", "text"):
        rows = timeline.get(track)
        if not isinstance(rows, list) or not rows:
            issue("MISSING_DRAFT_TRACK", f"timeline.{track} must be a nonempty array", track=track)
            continue
        ids = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"].strip():
                issue("INVALID_CLIP_ID", "Every clip needs a nonempty string id", track=track, index=index)
                continue
            ids.append(row["id"])
            if track == "text" and any(key in row and row[key] is not None and not isinstance(row[key], str) for key in ("text", "voice_text")):
                issue("INVALID_DRAFT_TEXT", "Subtitle and narration must be strings", text_id=row["id"])
            if track == "text" and not str(row.get("text") or row.get("voice_text") or "").strip():
                issue("EMPTY_DRAFT_TEXT", "Text clips must contain a subtitle or narration", text_id=row["id"])
            for field in (("text_ids",) if track == "video" else ("video_ids",)):
                if field in row and (not isinstance(row[field], list) or any(not isinstance(ref, str) or not ref for ref in row[field])):
                    issue("INVALID_LINK_IDS", f"{field} must be an array of nonempty string IDs", clip_id=row["id"])
        duplicates = [key for key, count in Counter(ids).items() if count > 1]
        if duplicates:
            issue("DUPLICATE_CLIP_ID", "Clip IDs must be unique within each track", track=track, ids=duplicates)

    if issues:
        return issues
    videos, texts = timeline["video"], timeline["text"]
    video_ids, text_ids = {v["id"] for v in videos}, {t["id"] for t in texts}
    for row, field, valid in [(v, "text_ids", text_ids) for v in videos] + [(t, "video_ids", video_ids) for t in texts]:
        unknown = [ref for ref in row.get(field, []) if ref not in valid]
        if unknown:
            issue("UNKNOWN_LINK_ID", "A link references a clip that does not exist", clip_id=row["id"], field=field, ids=unknown)
    for video in videos:
        if video.get("type") not in {"image", "video"}:
            issue("INVALID_MEDIA_TYPE", "Visual type must be image or video", video_id=video["id"])
        source_index = video.get("source_media_index")
        if available_media is not None:
            if source_index is None:
                if video.get("type") == "video":
                    issue("MISSING_VIDEO_SOURCE", "Video clips require a playable source from available_media", video_id=video["id"])
            elif type(source_index) is not int or not 0 <= source_index < len(available_media):
                issue("INVALID_SOURCE_MEDIA_INDEX", "Use an exact available_media index", video_id=video["id"], index=source_index)
            elif available_media[source_index]["type"] != video.get("type"):
                issue("SOURCE_MEDIA_TYPE_MISMATCH", "Clip type must match the chosen source", video_id=video["id"], index=source_index)
        for text in texts:
            if "text_ids" in video and "video_ids" in text:
                if (text["id"] in video["text_ids"]) != (video["id"] in text["video_ids"]):
                    issue("CONFLICTING_MEDIA_LINKS", "Both directions of an explicit link must agree", video_id=video["id"], text_id=text["id"])
    links = linked_text_ids(videos, texts)
    for video_id, refs in links.items():
        if not refs:
            issue("UNLINKED_MEDIA", "Every visual must be linked to text", video_id=video_id)
    walk: list[int] = []
    for text in texts:
        indexes = [index for index, video in enumerate(videos) if text["id"] in links[video["id"]]]
        if not indexes:
            issue("UNLINKED_TEXT", "Every text must have at least one visual", text_id=text["id"])
        walk.extend(indexes)
    if any(right < left for left, right in zip(walk, walk[1:])):
        issue("NON_SEQUENTIAL_MEDIA_LINKS", "Media/text links cross the playback order. Split a reused asset into separate clip IDs when returning to it.")
    return issues


def linked_text_ids(videos: list[dict[str, Any]], texts: list[dict[str, Any]]) -> dict[str, list[str]]:
    return {video["id"]: [text["id"] for text in texts if text["id"] in video.get("text_ids", []) or video["id"] in text.get("video_ids", [])] for video in videos}


def build_linked_timeline(compact: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, Any]:
    from app.video.services.generate_video_constants import DEFAULT_IMAGES, DEFAULT_EFFECTS
    from app.video.services.generate_video_timeline import fit_video_clips_to_text

    timeline = compact["timeline"]
    problems = linked_draft_issues(timeline, catalog)
    if problems:
        raise ValueError("Invalid media/text graph: " + ", ".join(dict.fromkeys(p["code"] for p in problems)))
    links = linked_text_ids(timeline["video"], timeline["text"])
    texts = []
    cursor_frames = 0
    for index, raw in enumerate(timeline["text"]):
        subtitle = str(raw.get("text") or raw.get("voice_text") or "").strip()
        voice = str(raw.get("voice_text") or subtitle).strip()
        # An estimate, not a length constraint. TTS alignment supplies real timing later.
        video_ids = [key for key, refs in links.items() if raw["id"] in refs]
        frames = max(30, len(video_ids), round(len(voice.split()) / 2.5 * 30))
        texts.append({"id": raw["id"], "type": "subtitle", "scene_index": index,
                      "text": subtitle, "voice_text": voice, "role": raw.get("role") or "BEAT",
                      "video_ids": video_ids, "video_id": video_ids[0],
                      "start": cursor_frames / 30, "end": (cursor_frames + frames) / 30, "style": {}})
        cursor_frames += frames
    images = [item["src"] for item in catalog if item["type"] == "image"] or DEFAULT_IMAGES
    videos = []
    for index, raw in enumerate(timeline["video"]):
        source_index = raw.get("source_media_index")
        src = catalog[source_index]["src"] if source_index is not None else images[index % len(images)]
        refs = links[raw["id"]]
        videos.append({"id": raw["id"], "type": raw["type"], "src": src,
                       "source_media_index": source_index, "text_ids": refs, "text_id": refs[0],
                       "text_weights": {ref: 1.0 for ref in refs},
                       "start": float(index), "end": float(index + 1),
                       "effect": DEFAULT_EFFECTS[index % len(DEFAULT_EFFECTS)], "fit": "contain",
                       "visual_direction": str(raw.get("visual_query") or "")})
    videos = fit_video_clips_to_text(videos, texts, 30)
    return {"version": 1, "duration": cursor_frames / 30, "video": videos, "text": texts, "audio": [],
            "metadata": {"draft_generation_mode": LINKED_DRAFT_VERSION, "timing_mode": "narration_estimate",
                         "creative_plan": compact.get("plan") or {}, "full_script": " ".join(t["voice_text"] for t in texts)}}
