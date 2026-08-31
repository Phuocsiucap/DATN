from __future__ import annotations

import hashlib
import json
import re
from typing import Any


AUTO_SELECTION_MODE = "AUTO"
HIGH_RISK_LEVELS = {"HIGH", "CRITICAL"}


def draft_script_signature(story: dict[str, Any] | None) -> str:
    """Return a stable signature for the spoken script, excluding timing and audio changes."""
    payload = story if isinstance(story, dict) else {}
    compact = payload.get("compact_scenes") if isinstance(payload.get("compact_scenes"), list) else []
    timeline = payload.get("timeline") if isinstance(payload.get("timeline"), dict) else {}
    text_clips = timeline.get("text") if isinstance(timeline.get("text"), list) else []
    story_data = payload.get("story_data") if isinstance(payload.get("story_data"), list) else []

    if text_clips:
        # These are the actual inputs consumed by rendering/TTS. Never trust a
        # stale compact copy in preference to the editable timeline.
        script = [
            {
                "text": _clean_script_text(clip.get("text")),
                "voice": _clean_script_text(clip.get("voice_text") or clip.get("text")),
            }
            for clip in text_clips
            if isinstance(clip, dict)
        ]
    elif compact:
        script = [
            {
                "role": str(scene.get("role") or "").strip().upper(),
                "voice_text": _clean_script_text(scene.get("voice_text") or scene.get("text")),
                "evidence_ids": sorted({str(item).strip() for item in scene.get("evidence_ids") or [] if str(item).strip()}),
            }
            for scene in compact
            if isinstance(scene, dict)
        ]
    else:
        script = [
            _clean_script_text(scene.get("voice_text") or scene.get("subtitle"))
            for scene in story_data
            if isinstance(scene, dict)
        ]
    encoded = json.dumps(script, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def is_auto_workflow(metadata: dict[str, Any] | None) -> bool:
    value = metadata if isinstance(metadata, dict) else {}
    return str(value.get("selection_mode") or "").strip().upper() == AUTO_SELECTION_MODE


def draft_quality_payload(metadata: dict[str, Any] | None, story: dict[str, Any] | None) -> dict[str, Any]:
    value = metadata if isinstance(metadata, dict) else {}
    quality = value.get("draft_quality")
    if isinstance(quality, dict):
        return quality
    payload = story if isinstance(story, dict) else {}
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    quality = meta.get("quality")
    return quality if isinstance(quality, dict) else {}


def high_risk_flags(metadata: dict[str, Any] | None, story: dict[str, Any] | None) -> list[dict[str, Any]]:
    value = metadata if isinstance(metadata, dict) else {}
    raw_flags = value.get("risk_flags")
    if not isinstance(raw_flags, list):
        payload = story if isinstance(story, dict) else {}
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        raw_flags = meta.get("risk_flags") if isinstance(meta.get("risk_flags"), list) else []
    return [
        flag
        for flag in raw_flags
        if isinstance(flag, dict) and str(flag.get("severity") or "").strip().upper() in HIGH_RISK_LEVELS
    ]


def auto_production_allowed(metadata: dict[str, Any] | None, story: dict[str, Any] | None) -> bool:
    """Guard every automatic/manual production entry for AUTO-selected drafts."""
    value = metadata if isinstance(metadata, dict) else {}
    payload = story if isinstance(story, dict) else {}
    if not is_auto_workflow(value):
        return True
    if not draft_has_script(payload):
        return False

    signature = draft_script_signature(payload)
    approved = bool(value.get("draft_review_approved"))
    approved_signature = str(value.get("approved_script_signature") or "")
    if approved and approved_signature and approved_signature == signature:
        return True

    review = value.get("draft_review") if isinstance(value.get("draft_review"), dict) else {}
    if review.get("status") == "REVIEW_REQUIRED":
        return False

    quality = draft_quality_payload(value, payload)
    if str(quality.get("status") or "").strip().upper() != "PASS":
        return False
    if high_risk_flags(value, payload):
        return False
    quality_signature = str(value.get("quality_script_signature") or "")
    return bool(quality_signature) and quality_signature == signature


def draft_has_script(story: dict[str, Any]) -> bool:
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    scenes = timeline.get("text") if isinstance(timeline.get("text"), list) else (story.get("story_data") or story.get("compact_scenes") or [])
    return any(isinstance(scene, dict) and _clean_script_text(scene.get("voice_text") or scene.get("text") or scene.get("subtitle")) for scene in scenes)


def sync_compact_scenes(story: dict[str, Any]) -> None:
    compact = story.get("compact_scenes")
    if not isinstance(compact, list):
        return
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    clips = timeline.get("text")
    if not isinstance(clips, list):
        return
    by_id = {str(scene.get("text_id") or f"text-{index + 1}"): scene for index, scene in enumerate(compact) if isinstance(scene, dict)}
    linked = (story.get("meta") or {}).get("draft_generation_mode") == "compact-v2"
    synchronized = []
    for index, clip in enumerate(clips):
        if not isinstance(clip, dict):
            continue
        text_id = str(clip.get("id") or f"text-{index + 1}")
        original = by_id.get(text_id, {})
        voice = str(clip.get("voice_text") or clip.get("text") or "").strip()
        synchronized.append({
            **original,
            "text_id": text_id,
            "role": clip.get("role") or original.get("role") or "BEAT",
            "voice_text": voice,
            "evidence_ids": clip.get("evidence_ids") if isinstance(clip.get("evidence_ids"), list) else original.get("evidence_ids") or [],
            **({"evidence_needs_review": True} if _clean_script_text(original.get("voice_text")) != _clean_script_text(voice) else {}),
        })
        if linked:
            synchronized[-1].update(text=str(clip.get("text") or voice), video_ids=list(clip.get("video_ids") or []))
            synchronized[-1].pop("evidence_ids", None)
            synchronized[-1].pop("evidence_needs_review", None)
    story["compact_scenes"] = synchronized


def auto_production_block_reason(metadata: dict[str, Any] | None, story: dict[str, Any] | None) -> str:
    value = metadata if isinstance(metadata, dict) else {}
    payload = story if isinstance(story, dict) else {}
    if high_risk_flags(value, payload):
        return "Draft có cờ rủi ro cao và cần người dùng duyệt trước khi tạo voice hoặc render."
    quality = draft_quality_payload(value, payload)
    if str(quality.get("status") or "").strip().upper() != "PASS":
        return "Draft chưa đạt quality gate và cần người dùng duyệt trước khi tạo voice hoặc render."
    return "Nội dung lời thoại đã thay đổi sau lần kiểm tra gần nhất; hãy duyệt lại draft trước khi tiếp tục."


def _clean_script_text(value: Any) -> str:
    text = re.sub(r"\[[^\]]+\]\s*", "", str(value or ""))
    return " ".join(re.findall(r"\w+", text.casefold()))


def invalidate_draft_media(project: Any, story: dict[str, Any]) -> None:
    """Retain files on disk but detach media generated from an older script."""
    audio = dict(story.get("audio") or {})
    for key in ("voice", "voiceDuration", "voice_duration", "voiceStart", "voice_start"):
        audio.pop(key, None)
    if isinstance(audio.get("tracks"), list):
        audio["tracks"] = [track for track in audio["tracks"] if not isinstance(track, dict) or str(track.get("type") or "").lower() != "voice"]
    story["audio"] = audio
    timeline = dict(story.get("timeline") or {})
    if isinstance(timeline.get("audio"), list):
        timeline["audio"] = [clip for clip in timeline["audio"] if not isinstance(clip, dict) or str(clip.get("type") or "").lower() != "voice"]
    story["timeline"] = timeline
    artifacts = dict(story.get("video_artifacts") or {})
    artifacts.pop("final", None)
    story["video_artifacts"] = artifacts
    project.artifacts_jsonb = [
        {**item, "status": "STALE"} if isinstance(item, dict) and (item.get("artifact_type") or item.get("type")) == "FINAL_VIDEO" else item
        for item in (getattr(project, "artifacts_jsonb", None) or [])
    ]
    metadata = dict(project.metadata_json or {})
    for key in ("rendered_video", "final_video", "video_approved", "video_approved_at", "video_approved_by"):
        metadata.pop(key, None)
    project.metadata_json = metadata
