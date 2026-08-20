from __future__ import annotations

import json
import re
from typing import Any

from common.core.config import get_settings
from common.core.llm import deepseek_chat_completion
from app.services.generate_video_constants import DEFAULT_EFFECTS, DEFAULT_IMAGES
from app.services.generate_video_timeline import (
    _prevent_subtitle_overlap,
    collect_image_urls,
    collect_story_image_urls,
    invalidate_story_voice,
    normalize_audio_clips,
    normalize_media_fit,
    normalize_text_clips,
    normalize_story_for_project,
    normalize_video_clips,
    prevent_timeline_text_overlap,
    round_to_frame,
    strip_voice_tags,
    sync_story_timeline,
    timeline_from_legacy_scenes,
    truncate_text,
)


def create_story_from_raw(raw_article: dict[str, Any]) -> dict[str, Any]:
    text = raw_article.get("text") or raw_article.get("content") or raw_article.get("full_text") or raw_article.get("summary") or ""
    title = raw_article.get("title") or raw_article.get("canonical_title") or "Bản tin"
    images = collect_image_urls(raw_article)
    target_duration = resolve_target_duration_seconds(raw_article)
    timeline_source = {
        "title": title,
        "summary": raw_article.get("summary"),
        "source_text": text,
        "source": raw_article,
        "raw_article": raw_article,
        "plan": raw_article.get("plan") if isinstance(raw_article.get("plan"), dict) else {},
        "parts": raw_article.get("parts") if isinstance(raw_article.get("parts"), list) else [],
        "target_duration_seconds": target_duration,
    }
    timeline = generate_story_timeline_with_ai(
        timeline_source,
        images,
    )
    story = {
        "meta": {
            "title": title,
            "source": "manual",
            "target_duration_seconds": target_duration,
        },
        "video": {"width": 1080, "height": 1920, "fps": 30, "background": "#05070b"},
        "audio": {"voiceVolume": 1, "musicVolume": 0},
        "source": raw_article,
        "timeline": timeline,
    }
    story = review_story_with_ai(story)
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
    result = deepseek_chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model="deepseek-v4-flash",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a Vietnamese short-video editor. "
                    "You revise production timeline JSON while preserving factual grounding."
                ),
            },
            {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
        ],
        temperature=0.45,
        response_format={"type": "json_object"},
    )
    parsed = result.parsed_json()
    normalized = normalize_ai_timeline(parsed.get("timeline") if isinstance(parsed, dict) else parsed, image_urls)
    if not normalized.get("video") and not normalized.get("text"):
        raise RuntimeError("AI did not return valid timeline")

    next_story = dict(story)
    next_story["timeline"] = normalized
    next_story.setdefault("edit_history", [])
    next_story["edit_history"].append({"prompt": edit_prompt})
    next_story = review_story_with_ai(next_story, "Duyệt lại sau khi người dùng chỉnh story bằng AI.")
    return next_story



def review_story_with_ai(story: dict[str, Any], review_instructions: str | None = None) -> dict[str, Any]:
    settings = get_settings()
    next_story = json.loads(json.dumps(story, ensure_ascii=False))
    sync_story_timeline(next_story)
    current_timeline = next_story.get("timeline") if isinstance(next_story.get("timeline"), dict) else {}
    if not current_timeline.get("video") and not current_timeline.get("text"):
        raise RuntimeError("Story has no timeline to review")

    source = next_story.get("source") if isinstance(next_story.get("source"), dict) else {}
    image_urls = collect_story_image_urls(next_story)
    target_duration_source = dict(source)
    target_duration_source["source"] = source
    if isinstance(next_story.get("meta"), dict) and next_story["meta"].get("target_duration_seconds"):
        target_duration_source["target_duration_seconds"] = next_story["meta"]["target_duration_seconds"]
    target_duration = resolve_target_duration_seconds(target_duration_source)

    if not settings.deepseek_api_key:
        next_story.setdefault("meta", {})
        next_story["meta"]["ai_story_review"] = {
            "approved": True,
            "action": "SKIPPED_NO_DEEPSEEK_KEY",
            "notes": ["Không có DeepSeek API key nên chỉ normalize story, không gọi AI reviewer."],
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }
        return next_story

    prompt_payload = {
        "task": "Review and optionally fix story timeline before video production.",
        "review_instructions": review_instructions or "",
        "required_output": {
            "approved": "boolean. true only if current_timeline already matches script/source well",
            "action": "APPROVED or REVISED",
            "notes": ["Vietnamese review notes"],
            "timeline": {
                "version": 1,
                "duration": "number seconds",
                "video": [{"id": "string", "type": "image|video", "start": "number", "end": "number", "src": "media URL/path", "effect": f"one of {DEFAULT_EFFECTS}"}],
                "text": [{"id": "string", "type": "subtitle", "start": "number", "end": "number", "text": "Vietnamese subtitle", "voice_text": "optional longer narration"}],
                "audio": [],
            },
        },
        "rules": [
            "Return only valid JSON object, no markdown.",
            "If current_timeline is already good, set approved=true, action=APPROVED, and return the same timeline.",
            "If current_timeline is vague, off-script, factually risky, too sparse, poorly ordered, or not aligned with source_document, revise it.",
            "Revised timeline must follow the planned script order: hook_direction, main_beats, ending_direction when script_parts exist.",
            "Do not invent facts outside source_document. Prefer concrete names, dates, causes, effects, and outcomes from the source.",
            "Keep Vietnamese narration natural for short-form video; avoid meta phrases like 'bài viết này' or 'câu chuyện này'.",
            "Text clips must not overlap. Each clip must have start < end.",
            "Each subtitle should stay under 140 characters when possible; use voice_text for longer spoken narration.",
            "Use available_images first, preserve existing usable media, otherwise use default_images.",
            "Use allowed_effects only.",
            "Do not output legacy scenes or story_data.",
        ],
        "duration_contract": {
            "target_duration_seconds": target_duration,
            "minimum_text_clip_count": target_timeline_clip_count(target_duration),
        },
        "current_timeline": current_timeline,
        "source_document": compact_story_source_for_ai(source),
        "available_images": image_urls,
        "default_images": DEFAULT_IMAGES,
        "allowed_effects": DEFAULT_EFFECTS,
    }
    result = deepseek_chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model="deepseek-v4-flash",
        messages=[
            {
                "role": "system",
                "content": (
                    "Bạn là AI duyệt story_data trước khi sản xuất video. "
                    "Nếu story đã đúng kịch bản thì giữ nguyên; nếu chưa đúng thì sửa timeline cho khớp nguồn và plan."
                ),
            },
            {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
        ],
        temperature=0.25,
        response_format={"type": "json_object"},
        timeout=45,
    )
    parsed = result.parsed_json()
    if not isinstance(parsed, dict):
        raise RuntimeError("AI reviewer did not return a JSON object")

    reviewed_timeline = normalize_ai_timeline(parsed.get("timeline"), image_urls)
    if not reviewed_timeline.get("video") and not reviewed_timeline.get("text"):
        reviewed_timeline = current_timeline
    if target_duration:
        reviewed_timeline = enforce_timeline_target_duration(reviewed_timeline, target_duration, image_urls)

    timeline_changed = _json_signature(reviewed_timeline) != _json_signature(current_timeline)
    next_story["timeline"] = reviewed_timeline
    if timeline_changed:
        invalidate_story_voice(next_story)
    next_story.setdefault("meta", {})
    next_story["meta"]["ai_story_review"] = {
        "approved": bool(parsed.get("approved")) and not timeline_changed,
        "action": "REVISED" if timeline_changed else "APPROVED",
        "notes": [str(item) for item in (parsed.get("notes") if isinstance(parsed.get("notes"), list) else []) if str(item).strip()],
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "model": result.model,
        "provider": result.provider,
    }
    sync_story_timeline(next_story)
    return next_story



def _json_signature(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))



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



def generate_story_timeline_with_ai(source: dict[str, Any], image_urls: list[str] | None = None) -> dict[str, Any]:
    image_urls = list(dict.fromkeys(image_urls or []))
    target_duration = resolve_target_duration_seconds(source)
    target_clip_count = target_timeline_clip_count(target_duration)
    fallback = enforce_timeline_target_duration(build_fallback_timeline(source, image_urls), target_duration, image_urls)
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
        "task": "Generate a timeline for a vertical Vietnamese short video from a content project.",
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
                        "voice_text": "Longer Vietnamese narration spoken by TTS for this clip",
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
            "The plan target_duration_seconds is binding. The final timeline duration must be within +/-10% of that target.",
            f"Create at least {target_clip_count} text clips and matching video clips for this target duration.",
            "For targets of 45 seconds or longer, avoid sparse timelines. Do not stretch only 4 to 6 sentences across the full video.",
            "For a 60 second target, total spoken narration in text/voice_text should be about 135 to 170 Vietnamese words.",
            "If script beats are short, expand voice_text with grounded details from the raw article while keeping subtitle text concise.",
            "Text clips must not overlap. Each clip must have start < end.",
            "Each subtitle should stay under 140 characters when possible.",
            "Use voice_text when the spoken narration should be longer than the on-screen subtitle.",
            "Use available_images in order when possible; otherwise use default_images.",
            "Use allowed_effects only.",
            "Do not output scenes or story_data.",
        ],
        "duration_contract": {
            "target_duration_seconds": target_duration,
            "minimum_accepted_duration_seconds": round(target_duration * 0.9, 2) if target_duration else None,
            "maximum_accepted_duration_seconds": round(target_duration * 1.1, 2) if target_duration else None,
            "minimum_text_clip_count": target_clip_count,
            "estimated_vietnamese_words_per_second": 2.5,
        },
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
    try:
        result = deepseek_chat_completion(
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            model="deepseek-v4-flash",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a Vietnamese short-video editor. "
                        "You output production-ready timeline JSON matching the exact schema."
                    ),
                },
                {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
            ],
            temperature=0.65,
            response_format={"type": "json_object"},
            timeout=35,
        )
        parsed = result.parsed_json()
        normalized = normalize_ai_timeline(parsed.get("timeline") if isinstance(parsed, dict) else parsed, image_urls)
        normalized = enforce_timeline_target_duration(normalized, target_duration, image_urls)
        normalized = ensure_timeline_density(normalized, fallback, target_duration)
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



def resolve_target_duration_seconds(source: dict[str, Any] | None) -> int | None:
    if not isinstance(source, dict):
        return None
    plan = source.get("plan") if isinstance(source.get("plan"), dict) else {}
    candidates = [
        plan.get("target_duration_seconds"),
        source.get("target_duration_seconds"),
    ]
    parts = source.get("parts") if isinstance(source.get("parts"), list) else []
    if len(parts) == 1 and isinstance(parts[0], dict):
        candidates.append(parts[0].get("target_duration_seconds"))
    for value in candidates:
        try:
            seconds = int(float(value))
        except (TypeError, ValueError):
            continue
        if 5 <= seconds <= 600:
            return seconds
    return None



def target_timeline_clip_count(target_duration: int | None) -> int:
    if not target_duration:
        return 5
    return max(3, min(18, int(round(float(target_duration) / 5.0))))



def ensure_timeline_density(timeline: dict[str, Any], fallback: dict[str, Any], target_duration: int | None) -> dict[str, Any]:
    minimum = target_timeline_clip_count(target_duration)
    text = timeline.get("text") if isinstance(timeline, dict) and isinstance(timeline.get("text"), list) else []
    if len(text) >= minimum:
        return timeline

    fallback_text = fallback.get("text") if isinstance(fallback, dict) and isinstance(fallback.get("text"), list) else []
    if len(fallback_text) > len(text):
        return fallback
    return timeline



def enforce_timeline_target_duration(timeline: dict[str, Any], target_duration: int | None, image_urls: list[str]) -> dict[str, Any]:
    if not target_duration or not isinstance(timeline, dict):
        return timeline
    fps = 30
    current = float(timeline.get("duration") or 0)
    if current and target_duration * 0.9 <= current <= target_duration * 1.1:
        return timeline

    text = prevent_timeline_text_overlap(normalize_text_clips(timeline.get("text"), fps), fps)
    video = replace_default_video_clip_sources(normalize_video_clips(timeline.get("video"), fps), image_urls)
    audio = normalize_audio_clips(timeline.get("audio"), fps)
    if not text and not video:
        return timeline

    target = float(target_duration)
    if text:
        weights = [max(2.5, float(clip.get("duration") or 0) or float(clip.get("end") or 0) - float(clip.get("start") or 0)) for clip in text]
        total_weight = sum(weights) or len(text)
        cursor = 0.0
        stretched_text = []
        for index, clip in enumerate(text):
            duration = target * (weights[index] / total_weight)
            if index == len(text) - 1:
                end = target
            else:
                end = cursor + duration
            start = round_to_frame(cursor, fps)
            clip_end = round_to_frame(max(start + 1 / fps, end), fps)
            stretched = {**clip, "start": start, "end": clip_end, "duration": round_to_frame(clip_end - start, fps)}
            stretched_text.append(stretched)
            cursor = clip_end
        text = stretched_text

    if video:
        reference = text or video
        stretched_video = []
        for index, clip in enumerate(reference):
            source_clip = video[index % len(video)]
            start = round_to_frame(float(clip.get("start") or 0), fps)
            end = round_to_frame(float(clip.get("end") or start + 1 / fps), fps)
            stretched_video.append(
                {
                    **source_clip,
                    "id": str(source_clip.get("id") or f"video-{index + 1}"),
                    "start": start,
                    "end": end,
                    "duration": round_to_frame(end - start, fps),
                }
            )
        video = stretched_video

    timeline_meta = timeline.get("metadata") if isinstance(timeline.get("metadata"), dict) else {}
    return {
        "version": 1,
        "duration": round_to_frame(target, fps),
        "video": video,
        "text": text,
        "audio": audio,
        "metadata": {
            **timeline_meta,
            "target_duration_seconds": target_duration,
            "duration_adjusted_from_seconds": current,
        },
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
                    "fit": "contain",
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
    target_duration = resolve_target_duration_seconds(source)
    target_clip_count = target_timeline_clip_count(target_duration)
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
        "task": "Generate story_data scenes for a vertical short video from a content project.",
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
            f"Create at least {target_clip_count} scenes for this target duration.",
            "For targets of 45 seconds or longer, avoid sparse 4 to 6 scene outputs.",
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
    try:
        result = deepseek_chat_completion(
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            model="deepseek-v4-flash",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a Vietnamese short-video scriptwriter. "
                        "You output production-ready JSON scenes matching the exact schema."
                    ),
                },
                {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
            ],
            temperature=0.65,
            response_format={"type": "json_object"},
            timeout=35,
        )
        parsed = result.parsed_json()
        scenes = parsed.get("scenes") if isinstance(parsed, dict) else parsed
        normalized = normalize_ai_scenes(scenes, image_urls)
        return normalized or fallback
    except Exception:
        return fallback



def build_fallback_scenes(source: dict[str, Any], image_urls: list[str]) -> list[dict[str, Any]]:
    target_duration = resolve_target_duration_seconds(source)
    target_count = target_timeline_clip_count(target_duration)
    parts = source.get("parts") or []
    script_scenes = build_script_scenes_from_parts(parts, target_count)
    if script_scenes:
        subtitles = script_scenes
    else:
        title = source.get("title") or "Bản tin"
        text = source.get("source_text") or source.get("full_text") or source.get("summary") or ""
        subtitles = split_to_scenes(str(text), str(title), target_count)
    subtitles = expand_subtitles_to_target(subtitles, source, target_count)
    duration = round(float(target_duration) / max(1, len(subtitles))) if target_duration else 4
    return normalize_ai_scenes(
        [
            {
                "duration": duration,
                "image": image_urls[index] if index < len(image_urls) else DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)],
                "effect": DEFAULT_EFFECTS[index % len(DEFAULT_EFFECTS)],
                "fit": "contain",
                "subtitle": subtitle,
            }
            for index, subtitle in enumerate(subtitles or [source.get("title") or "Nội dung đang chờ biên tập."])
        ],
        image_urls,
    )



def build_script_scenes_from_parts(parts: Any, target_count: int | None = None) -> list[str]:
    if not isinstance(parts, list):
        return []
    scenes: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        previous_part_recap = part.get("previous_part_recap")
        if previous_part_recap:
            scenes.extend(split_subtitle_candidates(str(previous_part_recap)))

        hook = part.get("hook_direction")
        if hook:
            scenes.extend(split_subtitle_candidates(str(hook)))

        goal = part.get("goal")
        if goal:
            scenes.extend(split_subtitle_candidates(str(goal)))

        beats = part.get("main_beats") or []
        if isinstance(beats, list):
            for beat in beats:
                if beat:
                    scenes.extend(split_subtitle_candidates(str(beat)))

        ending = part.get("ending_direction")
        if ending:
            scenes.extend(split_subtitle_candidates(str(ending)))

        next_part_tease = part.get("next_part_tease")
        if next_part_tease:
            scenes.extend(split_subtitle_candidates(str(next_part_tease)))

    limit = max(6, int(target_count or 6))
    return list(dict.fromkeys(item for item in scenes if item))[:limit]



def normalize_ai_scenes(scenes: Any, image_urls: list[str]) -> list[dict[str, Any]]:
    if not isinstance(scenes, list):
        return []
    normalized = []
    for index, item in enumerate(scenes[:18]):
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
                "fit": normalize_media_fit(item.get("fit")),
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



def split_to_scenes(text: str, title: str, target_count: int | None = None) -> list[str]:
    clean = re.sub(r"\s+", " ", text or "").strip()
    sentences = [part.strip() for part in re.split(r"(?<=[.!?。！？])\s+", clean) if part.strip()]
    if not sentences:
        sentences = [title, "Câu chuyện vẫn còn nhiều điều cần được làm rõ.", "Theo dõi tiếp để nắm các điểm chính."]
    elif len(sentences) < 3:
        sentences = [title, *sentences, "Điểm quan trọng nằm ở bối cảnh, nguyên nhân và cách xử lý đúng."]

    scene_count = target_count or (5 if len(clean) > 1200 else 4 if len(clean) > 650 else 3)
    selected = sentences[: max(scene_count, min(len(sentences), 18))]
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



def split_subtitle_candidates(text: str) -> list[str]:
    clean = re.sub(r"\s+", " ", text or "").strip()
    if not clean:
        return []
    sentences = [part.strip() for part in re.split(r"(?<=[.!?。！？])\s+", clean) if part.strip()]
    if len(sentences) <= 1:
        sentences = [part.strip() for part in re.split(r"\s*[;|•]\s+|\s+-\s+", clean) if part.strip()]
    if not sentences:
        sentences = [clean]

    candidates: list[str] = []
    for sentence in sentences:
        if len(sentence) <= 135:
            candidates.append(sentence)
            continue
        clauses = [part.strip() for part in re.split(r",\s+|:\s+|\s+nhưng\s+|\s+và\s+", sentence) if part.strip()]
        if len(clauses) > 1:
            candidates.extend(to_short_subtitle(clause) for clause in clauses if len(clause) >= 18)
        else:
            candidates.append(to_short_subtitle(sentence))
    return [item for item in candidates if item]



def expand_subtitles_to_target(subtitles: list[str], source: dict[str, Any], target_count: int) -> list[str]:
    unique = list(dict.fromkeys(to_short_subtitle(str(item)) for item in subtitles if str(item or "").strip()))
    if len(unique) >= target_count:
        return unique[:target_count]

    supplemental_text = collect_supplemental_story_text(source)
    for candidate in split_to_scenes(supplemental_text, str(source.get("title") or "Bản tin"), target_count):
        if candidate and candidate not in unique:
            unique.append(candidate)
        if len(unique) >= target_count:
            return unique[:target_count]

    templates = [
        "Bối cảnh lúc này khiến câu chuyện không còn đơn giản như ban đầu.",
        "Điều đáng chú ý là cảm xúc của người trong cuộc bắt đầu thay đổi rõ rệt.",
        "Từ một chi tiết nhỏ, mâu thuẫn dần chuyển thành câu hỏi lớn hơn.",
        "Người nghe cần nhìn lại diễn biến trước đó để hiểu vì sao nút thắt xuất hiện.",
        "Khoảnh khắc này đẩy câu chuyện sang một hướng khó xử hơn.",
        "Vấn đề không chỉ nằm ở sự việc, mà còn ở cách mỗi người chọn đối diện.",
        "Càng về sau, lựa chọn của nhân vật chính càng trở nên nặng nề hơn.",
        "Đây là đoạn chuyển quan trọng trước khi câu chuyện đi tới cao trào.",
        "Những gì xảy ra tiếp theo sẽ quyết định thái độ của các bên liên quan.",
        "Kết lại, câu chuyện để lại một bài học về niềm tin và ranh giới.",
    ]
    for template in templates:
        if template not in unique:
            unique.append(template)
        if len(unique) >= target_count:
            break
    return unique or [str(source.get("title") or "Nội dung đang chờ biên tập.")]



def collect_supplemental_story_text(source: dict[str, Any]) -> str:
    values: list[str] = []
    for key in ["summary", "source_text", "full_text"]:
        if source.get(key):
            values.append(str(source[key]))
    content = source.get("content") if isinstance(source.get("content"), dict) else {}
    for key in ["content_angle", "summary", "target_audience", "tone"]:
        if content.get(key):
            values.append(str(content[key]))
    plan = source.get("plan") if isinstance(source.get("plan"), dict) else {}
    for key in ["content_angle", "target_audience", "tone", "format"]:
        if plan.get(key):
            values.append(str(plan[key]))
    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    source_content = raw_article.get("source_content") if isinstance(raw_article.get("source_content"), dict) else {}
    for key in ["canonical_title", "summary", "full_text"]:
        if source_content.get(key):
            values.append(str(source_content[key]))
    return " ".join(values)



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
