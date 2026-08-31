from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from common.db.models import (
    ContentItem,
    MediaWorkflow,
    ContentSeries,
    Story,
)


DEFAULT_STORY_IMAGES = [
    "assets/images/001-signal-room.png",
    "assets/images/002-alien-tower.png",
    "assets/images/003-final-light.png",
]
DEFAULT_STORY_EFFECTS = ["slow-zoom", "pan-right", "pan-left", "push-in"]


def serialize_workflow(workflow: MediaWorkflow, db: Session | None = None) -> dict[str, Any]:
    artifacts = workflow.artifacts_jsonb if isinstance(workflow.artifacts_jsonb, list) else []
    final_artifact = next(
        (
            item
            for item in artifacts
            if getattr(item, "get", lambda x: None)("uri")
            and (item.get("type") == "FINAL_VIDEO" or item.get("artifact_type") == "FINAL_VIDEO")
        ),
        None,
    )

    source_context = _workflow_source_context(workflow, db) if db else {"source_content": None, "media": [], "images": []}
    draft_json = _normalized_workflow_draft_json(workflow)
    metadata = workflow.metadata_json or {}
    raw_meta = workflow.metadata_json or {}
    story_data = _serialize_story_data(draft_json, workflow)
    draft_json["story_data"] = story_data
    story = draft_json if draft_json else None

    return {
        "id": str(workflow.id),
        "user_id": str(workflow.user_id),
        "profile_id": str(workflow.profile_id),
        "series_id": str(workflow.series_id) if workflow.series_id else None,
        "title": workflow.title,
        "status": workflow.status,
        "planning_mode": workflow.planning_mode or "SINGLE",
        "primary_content_id": str(workflow.primary_content_id) if workflow.primary_content_id else None,
        "current_stage": workflow.current_stage,
        "progress_percent": float(workflow.progress_percent or 0),
        "timeline_duration": raw_meta.get("timeline_duration"),
        "rendered_video": final_artifact.get("uri") if final_artifact else None,
        "metadata": metadata,
        "source_content": source_context["source_content"],
        "media": source_context["media"],
        "images": source_context["images"],
        "series": serialize_content_series(workflow.series) if getattr(workflow, "series", None) else None,
        "story_data": story_data,
        "artifacts": artifacts,
        "inputs": workflow.inputs_jsonb if isinstance(workflow.inputs_jsonb, list) else [],
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at or workflow.created_at,
        "content_angle": raw_meta.get("content_angle"),
        "target_audience": raw_meta.get("target_audience"),
        "tone": raw_meta.get("tone"),
        "format": raw_meta.get("format"),
        "target_duration_seconds": raw_meta.get("target_duration_seconds"),
        "recommended_part_count": raw_meta.get("recommended_part_count"),
        "confidence_score": float(raw_meta.get("confidence_score") or 0.0),
        "risk_level": raw_meta.get("risk_level"),
        "version": 1,
        "ai_reasoning": raw_meta.get("ai_reasoning") or [],
        "production_requirements": raw_meta.get("production_requirements") or {},
        "draft_json": draft_json,
        "story": story,
        "approved_at": raw_meta.get("approved_at") or (workflow.updated_at if workflow.status == "APPROVED" else None),
    }


def _workflow_source_context(workflow: MediaWorkflow, db: Session) -> dict[str, Any]:
    content_ids = _workflow_content_ids(workflow, db)
    if not content_ids:
        return {"source_content": None, "media": [], "images": []}

    contents = db.query(ContentItem).filter(ContentItem.id.in_(content_ids)).all()
    primary = _primary_workflow_content(workflow, contents)

    media = []
    if primary and isinstance(primary.media_jsonb, list):
        media = primary.media_jsonb

    source_content = _serialize_source_content(primary)
    images = _image_urls(media)
    return {"source_content": source_content, "media": media, "images": images}


def _workflow_content_ids(workflow: MediaWorkflow, db: Session) -> list[Any]:
    ids: list[Any] = []

    def add(value: Any) -> None:
        if value and value not in ids:
            ids.append(value)

    def add_story(story_id: Any) -> None:
        if not story_id:
            return
        story = db.get(Story, story_id)
        if story and getattr(story, "content_id", None):
            add(story.content_id)

    add(workflow.primary_content_id)

    if isinstance(workflow.inputs_jsonb, list):
        for inp in workflow.inputs_jsonb:
            if isinstance(inp, dict) and inp.get("type") == "content" and inp.get("id"):
                add(inp.get("id"))
            elif isinstance(inp, dict) and inp.get("type") == "story" and inp.get("id"):
                add_story(inp.get("id"))

    draft = _workflow_draft_json(workflow)
    for scene in (draft.get("story_data") or draft.get("scenes") or []):
        if not isinstance(scene, dict):
            continue
        for ref in _source_refs_from_payload(scene):
            if not isinstance(ref, dict):
                continue
            add(ref.get("content_id"))
            add_story(ref.get("story_id"))

    return ids


def _primary_workflow_content(workflow: MediaWorkflow, contents: list[ContentItem]) -> ContentItem | None:
    if not contents:
        return None
    if workflow.primary_content_id:
        match = next((item for item in contents if item.id == workflow.primary_content_id), None)
        if match:
            return match
    return contents[0]


def _source_refs_from_payload(payload: dict[str, Any]) -> list[Any]:
    refs = payload.get("source_refs")
    if isinstance(refs, list):
        return refs
    nested = payload.get("payload")
    if isinstance(nested, dict):
        nested_refs = nested.get("source_refs")
        if isinstance(nested_refs, list):
            return nested_refs
    return []


def _serialize_source_content(
    content: ContentItem | None, *, allow_description_fallback: bool = True,
) -> dict[str, Any] | None:
    if not content:
        return None

    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources else {}
    source_metadata = _source_metadata(primary_source)
    full_text = _load_content_full_text(content.mongo_normalized_id, allow_description_fallback=allow_description_fallback)
    category_id = source_metadata.get("category_id")
    article_id = source_metadata.get("article_id")
    site_id = source_metadata.get("site_id")

    return {
        "id": str(content.id),
        "content_type": content.content_type,
        "canonical_title": content.canonical_title,
        "summary": content.summary,
        "full_text": full_text,
        "language": content.language,
        "status": content.status,
        "canonical_url": content.canonical_url,
        "source_type": primary_source.get("source_type"),
        "source_url": primary_source.get("source_url") or content.canonical_url,
        "source_author": primary_source.get("source_author"),
        "source_published_at": primary_source.get("source_published_at"),
        "source_metadata": source_metadata,
        "article_id": article_id,
        "articleId": article_id,
        "category_id": category_id,
        "categoryId": category_id,
        "category": source_metadata.get("category"),
        "site_id": site_id,
        "siteId": site_id,
        "quality_score": float(content.quality_score or 0),
        "published_at": content.published_at.isoformat() if content.published_at else None,
        "created_at": content.created_at.isoformat() if content.created_at else None,
        "updated_at": content.updated_at.isoformat() if content.updated_at else None,
        "normalized": {
            "articleId": article_id,
            "categoryId": category_id,
            "siteId": site_id,
            "title": content.canonical_title or content.normalized_title or "",
            "lead": content.summary or "",
            "publishedAt": content.published_at.isoformat() if content.published_at else primary_source.get("source_published_at"),
            "content": full_text or content.summary or "",
            "images": [],
            "videos": [],
            "url": content.canonical_url,
        },
    }


def _source_metadata(primary_source: dict[str, Any]) -> dict[str, Any]:
    metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def content_category_payload(content: ContentItem | None) -> dict[str, Any]:
    if not content:
        return {}
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources else {}
    metadata = _source_metadata(primary_source)
    article_id = metadata.get("article_id")
    category_id = metadata.get("category_id")
    site_id = metadata.get("site_id")
    payload = {
        "article_id": article_id,
        "articleId": article_id,
        "category_id": category_id,
        "categoryId": category_id,
        "category": metadata.get("category"),
        "site_id": site_id,
        "siteId": site_id,
    }
    return {key: value for key, value in payload.items() if value not in (None, "", [])}


def _load_content_full_text(mongo_normalized_id: str | None, *, allow_description_fallback: bool = True) -> str | None:
    try:
        from bson import ObjectId
        from common.db.mongo import processed_documents

        if mongo_normalized_id:
            proc_coll = processed_documents()
            try:
                proc_doc = proc_coll.find_one({"_id": ObjectId(mongo_normalized_id)})
                normalized = proc_doc.get("normalized") if isinstance(proc_doc, dict) else None
                if isinstance(normalized, dict):
                    full_text = normalized.get("content")
                    if not full_text and allow_description_fallback:
                        full_text = normalized.get("description")
                    if full_text:
                        return str(full_text)
            except Exception:
                pass
    except Exception as exc:
        print("Error fetching full text for content workflow:", exc)
    return None


def _image_urls(media: list[dict[str, Any]]) -> list[str]:
    urls = []
    for item in media:
        media_type = str(item.get("media_type") or "").upper()
        if media_type and "IMAGE" not in media_type and "THUMBNAIL" not in media_type:
            continue
        url = item.get("storage_url") or item.get("source_url") or item.get("thumbnail_url")
        if url:
            urls.append(str(url))
    return list(dict.fromkeys(urls))


def serialize_content_series(series: ContentSeries) -> dict[str, Any]:
    metadata = series.metadata_json if isinstance(series.metadata_json, dict) else {}
    category_id = metadata.get("category_id") or metadata.get("categoryId")
    return {
        "id": str(series.id),
        "user_id": str(series.user_id),
        "profile_id": str(series.profile_id),
        "title": series.title,
        "description": series.description,
        "series_type": series.series_type,
        "status": series.status,
        "current_part": series.current_part,
        "total_parts": series.total_parts,
        "context_json": series.context_json or {},
        "metadata": series.metadata_json or {},
        "category_id": category_id,
        "categoryId": category_id,
        "category": metadata.get("category"),
        "created_at": series.created_at,
        "updated_at": series.updated_at,
    }


def _workflow_draft_json(workflow: MediaWorkflow) -> dict[str, Any]:
    draft = getattr(workflow, "draft_json", None)
    if isinstance(draft, dict):
        return draft
    metadata = workflow.metadata_json if isinstance(workflow.metadata_json, dict) else {}
    draft = metadata.get("draft_json")
    return draft if isinstance(draft, dict) else {}


def _normalized_workflow_draft_json(workflow: MediaWorkflow) -> dict[str, Any]:
    draft = dict(_workflow_draft_json(workflow))
    raw_scenes = draft.get("story_data")
    if not isinstance(raw_scenes, list):
        raw_scenes = draft.get("scenes") if isinstance(draft.get("scenes"), list) else []
    if not raw_scenes and isinstance(draft.get("script_parts"), list):
        raw_scenes = _legacy_script_parts_to_story_data(draft["script_parts"])
    if not isinstance(raw_scenes, list):
        return draft
    normalized_scenes = []
    for index, raw in enumerate(raw_scenes, start=1):
        if not isinstance(raw, dict):
            continue
        normalized_scenes.append(_normalize_story_scene(raw, index))
    draft["story_data"] = normalized_scenes
    draft.pop("script_parts", None)
    draft.pop("script_part", None)
    draft.pop("scenes", None)
    return draft


def _legacy_script_parts_to_story_data(script_parts: list[Any]) -> list[dict[str, Any]]:
    scenes: list[dict[str, Any]] = []
    for part in script_parts:
        if not isinstance(part, dict):
            continue
        voiceover = str(part.get("voiceover") or "").strip()
        if not voiceover:
            lines = [
                str(part.get("hook_direction") or "").strip(),
                *[str(item).strip() for item in part.get("main_beats") or [] if str(item).strip()],
                str(part.get("ending_direction") or "").strip(),
            ]
            voiceover = " ".join(line for line in lines if line)
        for segment in _split_scene_text(voiceover):
            scenes.append(
                {
                    "duration": round(max(3.0, min(8.0, len(segment.split()) / 2.5 + 0.8)), 2),
                    "image": DEFAULT_STORY_IMAGES[len(scenes) % len(DEFAULT_STORY_IMAGES)],
                    "effect": DEFAULT_STORY_EFFECTS[len(scenes) % len(DEFAULT_STORY_EFFECTS)],
                    "fit": "cover",
                    "subtitle": _compact_scene_text(segment, 140),
                    "voice_text": segment,
                }
            )
    return scenes


def _split_scene_text(text: str) -> list[str]:
    import re

    sentences = [item.strip() for item in re.split(r"(?<=[.!?。！？])\s+", text) if item.strip()]
    return sentences or ([text.strip()] if text.strip() else [])


def _compact_scene_text(text: str, limit: int) -> str:
    value = " ".join(str(text or "").split())
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 1)].rstrip() + "..."


def sanitize_instruction_text(text: str) -> str:
    """Removes leaked internal instruction lines and JSON-like system strings."""
    if not text:
        return ""
    val = str(text).strip()
    if "manual_direct_script" not in val and "bypass_ai_selection" not in val and not val.startswith("{'") and not val.startswith('{"'):
        return val

    for marker in ("{'instructions'", '{"instructions"', "manual_direct_script", "bypass_ai_selection"):
        if marker in val:
            val = val.split(marker)[0].strip()

    lines = []
    for line in val.splitlines():
        l = line.strip()
        if not l or "manual_direct_script" in l or "bypass_ai_selection" in l or l.startswith("{") or l.endswith("}"):
            continue
        lines.append(l)
    clean = " ".join(lines).strip().rstrip("',\" ")
    return clean


def _sanitize_draft_json(draft_json: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(draft_json, dict):
        return {}
    import json
    clean_draft = json.loads(json.dumps(draft_json, ensure_ascii=False))

    source_summary = ""
    source = clean_draft.get("source")
    if isinstance(source, dict):
        source_summary = source.get("summary") or source.get("title") or ""
        source.pop("instructions", None)
        if isinstance(source.get("content"), dict):
            source["content"].pop("instructions", None)
        raw_art = source.get("raw_article")
        if isinstance(raw_art, dict) and isinstance(raw_art.get("source_content"), dict):
            sc = raw_art["source_content"]
            if "media" in sc and (source.get("media") or source.get("images")):
                sc["media"] = []
        clean_draft.pop("source", None)

    # 1. Clean timeline text clips
    timeline = clean_draft.get("timeline")
    if isinstance(timeline, dict):
        text_clips = timeline.get("text")
        if isinstance(text_clips, list):
            for clip in text_clips:
                if isinstance(clip, dict):
                    if "text" in clip:
                        txt = sanitize_instruction_text(clip.get("text") or "")
                        if not txt and source_summary:
                            txt = _compact_scene_text(source_summary, 120)
                        clip["text"] = txt
                    if "voice_text" in clip:
                        vtxt = sanitize_instruction_text(clip.get("voice_text") or "")
                        if not vtxt:
                            vtxt = clip.get("text") or ""
                        clip["voice_text"] = vtxt

    return clean_draft


def _serialize_story_data(draft_json: dict[str, Any], workflow: MediaWorkflow) -> list[dict[str, Any]]:
    clean_draft = _sanitize_draft_json(draft_json)
    raw_scenes = clean_draft.get("story_data")
    if not isinstance(raw_scenes, list):
        raw_scenes = clean_draft.get("scenes") if isinstance(clean_draft.get("scenes"), list) else []

    if not raw_scenes and isinstance(clean_draft.get("timeline"), dict):
        timeline = clean_draft["timeline"]
        text_clips = timeline.get("text") if isinstance(timeline.get("text"), list) else []
        video_clips = timeline.get("video") if isinstance(timeline.get("video"), list) else []
        count = max(len(text_clips), len(video_clips))
        raw_scenes = []
        for idx in range(count):
            t_clip = text_clips[idx] if idx < len(text_clips) else {}
            v_clip = _video_clip_for_text(video_clips, t_clip, idx) if t_clip else (video_clips[idx] if idx < len(video_clips) else {})
            text_str = sanitize_instruction_text(str(t_clip.get("text") or "").strip())
            voice_str = sanitize_instruction_text(str(t_clip.get("voice_text") or text_str).strip())

            # If text_str is empty due to prompt instruction scrub, provide a clean fallback if video clip exists
            if not text_str and v_clip.get("src"):
                text_str = _compact_scene_text(workflow.title, 120)
                voice_str = text_str

            if not text_str and not v_clip.get("src"):
                continue
            raw_scenes.append({
                "scene_index": t_clip.get("scene_index") if t_clip.get("scene_index") is not None else v_clip.get("scene_index"),
                "video_id": v_clip.get("id"),
                "text_id": t_clip.get("id"),
                **({"video_ids": _clip_video_ids(t_clip)} if _clip_video_ids(t_clip) else {}),
                **({"text_ids": _clip_text_ids(v_clip)} if _clip_text_ids(v_clip) else {}),
                "subtitle": text_str,
                "voice_text": voice_str,
                "image": v_clip.get("src") or "",
                "media_type": v_clip.get("type") or "image",
                "effect": v_clip.get("effect") or "slow-zoom",
                "fit": v_clip.get("fit") or "contain",
                "duration": t_clip.get("duration") or v_clip.get("duration") or 4,
                "subtitle_start": t_clip.get("start"),
                "subtitle_duration": t_clip.get("duration"),
            })

    result: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_scenes, start=1):
        if not isinstance(raw, dict):
            continue
        result.append(_normalize_story_scene(raw, index, fallback_text=workflow.title if not raw.get("subtitle") else ""))
    return result


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


def _clip_overlap_seconds(left: dict[str, Any], right: dict[str, Any]) -> float:
    try:
        start = max(float(left.get("start") or 0), float(right.get("start") or 0))
        end = min(float(left.get("end") or 0), float(right.get("end") or 0))
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, end - start)


def _normalize_story_scene(raw: dict[str, Any], index: int, fallback_text: str = "") -> dict[str, Any]:
    subtitle = sanitize_instruction_text(str(raw.get("subtitle") or raw.get("text") or raw.get("voice_text") or raw.get("voiceover") or "").strip())
    voice_text = sanitize_instruction_text(str(raw.get("voice_text") or raw.get("voiceover") or "").strip())

    if not subtitle and fallback_text:
        subtitle = fallback_text
    if not voice_text:
        voice_text = subtitle
    try:
        duration = float(raw.get("duration") if raw.get("duration") is not None else raw.get("duration_seconds") or 4)
    except (TypeError, ValueError):
        duration = 4.0
    image = str(raw.get("image") or raw.get("src") or "").strip()
    if not image or (image.startswith("assets/images/") and image not in DEFAULT_STORY_IMAGES):
        image = DEFAULT_STORY_IMAGES[(index - 1) % len(DEFAULT_STORY_IMAGES)]
    scene: dict[str, Any] = {
        "duration": round(max(3.0, min(8.0, duration)), 2),
        "image": image,
        "effect": DEFAULT_STORY_EFFECTS[(index - 1) % len(DEFAULT_STORY_EFFECTS)],
        "fit": "cover" if str(raw.get("fit") or "cover").lower() == "cover" else "contain",
        "subtitle": _compact_scene_text(subtitle, 140),
        "voice_text": _compact_scene_text(voice_text, 250),
    }
    for key in (
        "scene_index",
        "video_id",
        "video_ids",
        "text_id",
        "text_ids",
        "media_type",
        "scale",
        "opacity",
        "position_x",
        "position_y",
        "rotation",
        "subtitle_start",
        "subtitle_duration",
    ):
        if raw.get(key) is not None:
            scene[key] = raw[key]
    if isinstance(raw.get("text_style"), dict):
        scene["text_style"] = raw["text_style"]
    if raw.get("voice_subtitle"):
        scene["voice_subtitle"] = str(raw["voice_subtitle"])
    if isinstance(raw.get("timing"), dict):
        scene["timing"] = raw["timing"]
    return scene
