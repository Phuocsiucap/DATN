from __future__ import annotations

import html
import math
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from app.video.services.generate_video_constants import DEFAULT_EFFECTS, DEFAULT_IMAGES
from app.planning.services.auto_draft_links import (
    LINKED_DRAFT_VERSION, build_linked_timeline, linked_draft_issues, normalize_linked_timeline,
)


COMPACT_DRAFT_VERSION = LINKED_DRAFT_VERSION
LEGACY_DRAFT_VERSION = "compact-v1"
ALLOWED_DURATIONS = (25, 40, 60)
FORMAT_ROLES: dict[str, list[str]] = {
    "NEWS_BRIEF": ["HOOK", "EVENT", "IMPACT", "NEXT"],
    "EXPLAINER": ["HOOK", "CONTEXT", "CAUSE", "IMPACT", "SUMMARY"],
    "LISTICLE": ["HOOK", "ITEM", "ITEM", "ITEM", "CTA"],
    "MYTH_VS_FACT": ["MYTH", "CORRECTION", "EVIDENCE", "CONCLUSION"],
    "STORY_ARC": ["HOOK", "SETUP", "CONFLICT", "TURN", "RESOLUTION"],
    "QA": ["QUESTION", "SHORT_ANSWER", "EXPLANATION", "CONCLUSION"],
    "CONTRARIAN": ["POPULAR_BELIEF", "CHALLENGE", "EVIDENCE", "TAKEAWAY"],
    "CASE_STUDY": ["PROBLEM", "ACTION", "RESULT", "LESSON"],
}

_MIN_SCENES = {25: 4, 40: 6, 60: 8}
_MAX_SCENES = {25: 8, 40: 11, 60: 15}
_NON_FACTUAL_ROLES = {"CTA", "QUESTION", "HOOK", "TAKEAWAY", "CONCLUSION", "SUMMARY"}
_FILLER_PREFIXES = (
    "bạn có biết rằng",
    "điều đáng chú ý là",
    "bối cảnh lúc này khiến",
    "câu chuyện không còn đơn giản",
    "khoảnh khắc này đẩy câu chuyện",
    "đây là đoạn chuyển quan trọng",
    "những gì xảy ra tiếp theo sẽ quyết định",
)
_STOPWORDS = {
    "cac",
    "cho",
    "cua",
    "dang",
    "duoc",
    "khi",
    "mot",
    "nhung",
    "nay",
    "thi",
    "trong",
    "voi",
}
_RISK_SEVERITIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
_MAX_VOICE_TEXT_CHARS = 700
MIN_DRAFT_CONFIDENCE = 60
MIN_DRAFT_QUALITY_SCORE = 85
SCENE_REPETITION_THRESHOLD = 0.72


def draft_duration_limits(duration: int) -> dict[str, int]:
    """Single source of length limits for the validator and both LLM prompts."""
    return {
        "min_scenes": _MIN_SCENES[duration],
        "max_scenes": _MAX_SCENES[duration],
        "min_words": round(duration * 1.5),
        "max_words": round(duration * 3.2),
    }


def draft_quality_constraints(*, risk_tolerance: str | None = None, version: str = LEGACY_DRAFT_VERSION) -> dict[str, Any]:
    constraints = {
        "duration_limits": [
            {"duration_seconds": duration, **draft_duration_limits(duration)}
            for duration in ALLOWED_DURATIONS
        ],
        "word_counting": (
            "Count whitespace-separated units across scenes[].voice_text only. "
            "Vietnamese syllables separated by spaces count separately."
        ),
        "max_voice_text_chars_per_scene": _MAX_VOICE_TEXT_CHARS,
        "citation_optional_roles": sorted(_NON_FACTUAL_ROLES),
        "avoid_scene_prefixes": list(_FILLER_PREFIXES),
        "review_policy": {
            "minimum_confidence": MIN_DRAFT_CONFIDENCE,
            "blocking_risk_severities": ["HIGH", "CRITICAL"],
            "medium_risk_requires_review": str(risk_tolerance or "").strip().upper() == "LOW",
        },
    }
    if version == LINKED_DRAFT_VERSION:
        for key in ("duration_limits", "max_voice_text_chars_per_scene", "citation_optional_roles"):
            constraints.pop(key, None)
        constraints.update({
            "word_counting": "Count each timeline.text narration once, regardless of its number of visuals.",
            "timing": "No target duration or start/end required; code estimates timing then aligns to voice.",
            "links": "Unique IDs; every text and visual linked; references exist; links follow playback order.",
            "grounding": "Use the full source document; do not output citation IDs.",
        })
    return constraints


@dataclass(frozen=True)
class QualityIssue:
    code: str
    message: str
    severity: str = "ERROR"
    scene_indexes: list[int] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "severity": self.severity,
        }
        if self.scene_indexes:
            payload["scene_indexes"] = self.scene_indexes
        if self.details:
            payload["details"] = self.details
        return payload


@dataclass(frozen=True)
class DraftQuality:
    status: str
    score: int
    issues: list[QualityIssue]
    word_count: int
    scene_count: int

    @property
    def passed(self) -> bool:
        return self.status == "PASS"

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "score": self.score,
            "issues": [issue.to_dict() for issue in self.issues],
            "word_count": self.word_count,
            "scene_count": self.scene_count,
        }


def extract_source_facts(
    *,
    title: str | None,
    summary: str | None,
    full_text: str | None,
    max_facts: int = 10,
    max_chars: int = 3500,
) -> list[dict[str, str]]:
    candidates: list[str] = []
    if title:
        candidates.append(_clean_text(title))
    for value in (summary, full_text):
        candidates.extend(_fact_sentences(value))

    facts: list[str] = []
    seen: set[str] = set()
    used_chars = 0
    for candidate in candidates:
        clean = _clean_text(candidate).strip(" -")
        key = _normalized_text(clean)
        if len(clean) < 12 or not key or key in seen:
            continue
        if used_chars + len(clean) > max_chars and facts:
            break
        facts.append(clean[:600])
        seen.add(key)
        used_chars += len(clean)
        if len(facts) >= max_facts:
            break
    return [{"id": f"F{index}", "text": fact} for index, fact in enumerate(facts, start=1)]


def build_draft_source_document(
    *,
    title: str | None,
    description: str | None,
    full_text: str | None,
    fallback_facts: list[dict[str, str]],
) -> dict[str, Any]:
    """Keep the complete article in order; section IDs also serve as evidence IDs.

    Unlike the small production-gate excerpt, this does not select, deduplicate,
    truncate or summarize body paragraphs. HTML block boundaries are retained.
    """
    body = str(full_text or "")
    body = re.sub(r"<(script|style)\b[^>]*>.*?</\1\s*>", "", body, flags=re.IGNORECASE | re.DOTALL)
    body = re.sub(r"</(?:p|div|h[1-6]|li|tr|section|blockquote)\s*>|<br\b[^>]*>", "\n", body, flags=re.IGNORECASE)
    paragraphs = [text for line in re.split(r"[\r\n]+", body) if (text := _clean_text(line))]
    if not paragraphs:
        return {"coverage": "EXCERPT_ONLY", "sections": [dict(fact) for fact in fallback_facts]}

    sections: list[dict[str, str]] = []

    def append_section(text: str, kind: str) -> None:
        if text:
            sections.append({"id": f"F{len(sections) + 1}", "kind": kind, "text": text})

    append_section(_clean_text(title or ""), "TITLE")
    lead = _clean_text(description or "")
    # The crawl description is a lead, not an AI summary. Avoid sending it twice
    # when the stored body already includes exactly this text.
    if lead and lead not in " ".join(paragraphs):
        append_section(lead, "LEAD")
    for paragraph in paragraphs:
        append_section(paragraph, "BODY")
    return {"coverage": "FULL_TEXT", "sections": sections}


def normalize_compact_draft(value: Any) -> dict[str, Any]:
    payload = value if isinstance(value, dict) else {}
    linked = payload.get("version") == LINKED_DRAFT_VERSION or "timeline" in payload
    linked_timeline = normalize_linked_timeline(payload.get("timeline")) if linked else None
    raw_plan = payload.get("plan") if isinstance(payload.get("plan"), dict) else {}
    raw_scenes = payload.get("scenes") if isinstance(payload.get("scenes"), list) else []
    raw_series = payload.get("series_decision") if isinstance(payload.get("series_decision"), dict) else {}
    series_decision = {
        "action": str(raw_series.get("action") or "NONE").strip().upper()[:30],
        "target_series_id": str(raw_series.get("target_series_id") or "")[:60],
        "series_title": _clean_text(raw_series.get("series_title"))[:180],
        "series_description": _clean_text(raw_series.get("series_description"))[:500],
        "series_type": str(raw_series.get("series_type") or "NARRATIVE")[:30],
        "total_parts": _as_int(raw_series.get("total_parts")) or 0,
        "reason": _clean_text(raw_series.get("reason"))[:200],
        "reusable_followup_angles": [str(item)[:240] for item in raw_series.get("reusable_followup_angles", [])[:3]] if isinstance(raw_series.get("reusable_followup_angles"), list) else [],
    } if raw_series else {}

    format_id = str(raw_plan.get("format") or "").strip().upper()
    duration = _as_int(raw_plan.get("duration_seconds"))
    scenes: list[dict[str, Any]] = []
    for raw in raw_scenes[:18]:
        if not isinstance(raw, dict):
            continue
        voice_text = _clean_text(raw.get("voice_text") or raw.get("text") or "")[:_MAX_VOICE_TEXT_CHARS]
        if not voice_text:
            continue
        raw_evidence = raw.get("evidence_ids") if isinstance(raw.get("evidence_ids"), list) else []
        evidence_ids = list(dict.fromkeys(str(item).strip() for item in raw_evidence if str(item).strip()))
        source_media_index = _as_int(raw.get("source_media_index"))
        scenes.append(
            {
                "role": str(raw.get("role") or "BEAT").strip().upper(),
                "voice_text": voice_text,
                "evidence_ids": evidence_ids,
                "visual_query": _clean_text(raw.get("visual_query") or "")[:240],
                **({"source_media_index": source_media_index} if source_media_index is not None else {}),
            }
        )

    raw_risk_flags = payload.get("risk_flags") if isinstance(payload.get("risk_flags"), list) else []
    risk_flags: list[dict[str, str]] = []
    for raw_flag in raw_risk_flags[:10]:
        if not isinstance(raw_flag, dict):
            continue
        severity = str(raw_flag.get("severity") or "MEDIUM").strip().upper()
        risk_flags.append(
            {
                "type": str(raw_flag.get("type") or "GENERAL").strip().upper()[:60],
                "severity": severity if severity in _RISK_SEVERITIES else "MEDIUM",
                **({"note": _clean_text(raw_flag.get("note"))[:240]} if raw_flag.get("note") else {}),
            }
        )

    if linked:
        scenes = [
            {"text_id": raw.get("id"), "role": str(raw.get("role") or "BEAT").strip().upper(),
             "voice_text": _clean_text(raw.get("voice_text") or raw.get("text") or ""),
             "text": _clean_text(raw.get("text") or raw.get("voice_text") or "")}
            for raw in (linked_timeline.get("text") or []) if isinstance(raw, dict)
        ] if isinstance(linked_timeline.get("text"), list) else []

    result = {
        "version": LINKED_DRAFT_VERSION if linked else LEGACY_DRAFT_VERSION,
        "confidence_score": _as_float(payload.get("confidence_score")),
        "risk_flags": risk_flags,
        "plan": {
            "title": _clean_text(raw_plan.get("title") or "")[:240],
            "angle": _clean_text(raw_plan.get("angle") or raw_plan.get("content_angle") or "")[:500],
            "format": format_id,
            "duration_seconds": duration,
            "hook_type": str(raw_plan.get("hook_type") or "").strip().upper(),
            "cta_mode": str(raw_plan.get("cta_mode") or "NONE").strip().upper(),
        },
        "series_decision": series_decision,
        "scenes": scenes,
    }
    if linked:
        result["timeline"] = linked_timeline
        result["plan"].pop("duration_seconds", None)
    return result


def evaluate_compact_draft(
    compact: dict[str, Any],
    source_facts: list[dict[str, str]],
    *,
    risk_tolerance: str | None = None,
    available_media: list[dict[str, Any]] | None = None,
) -> DraftQuality:
    issues: list[QualityIssue] = []
    score = 100
    plan = compact.get("plan") if isinstance(compact.get("plan"), dict) else {}
    scenes = compact.get("scenes") if isinstance(compact.get("scenes"), list) else []
    format_id = str(plan.get("format") or "").upper()
    duration = _as_int(plan.get("duration_seconds")) or 0
    linked = compact.get("version") == LINKED_DRAFT_VERSION
    if linked:
        graph_issues = linked_draft_issues(compact.get("timeline") or {}, available_media)
        issues.extend(QualityIssue(**issue) for issue in graph_issues)
        score -= min(50, 20 * len(graph_issues))

    confidence = _as_float(compact.get("confidence_score"))
    if confidence < MIN_DRAFT_CONFIDENCE:
        issues.append(
            QualityIssue(
                "LOW_MODEL_CONFIDENCE",
                "Draft confidence is below the automatic-production threshold",
                "CRITICAL",
                details={"confidence_score": confidence, "minimum": MIN_DRAFT_CONFIDENCE},
            )
        )
        score -= 20

    risk_flags = compact.get("risk_flags") if isinstance(compact.get("risk_flags"), list) else []
    high_risks = [
        flag
        for flag in risk_flags
        if isinstance(flag, dict) and str(flag.get("severity") or "").upper() in {"HIGH", "CRITICAL"}
    ]
    medium_risks = [
        flag
        for flag in risk_flags
        if isinstance(flag, dict) and str(flag.get("severity") or "").upper() == "MEDIUM"
    ]
    if high_risks:
        issues.append(
            QualityIssue(
                "HIGH_RISK_FLAG",
                "Draft reported a high-risk factual or sensitive-content concern",
                "CRITICAL",
                details={"risk_flags": high_risks},
            )
        )
        score -= 30
    elif medium_risks and str(risk_tolerance or "").strip().upper() == "LOW":
        issues.append(
            QualityIssue(
                "RISK_EXCEEDS_PROFILE_TOLERANCE",
                "Draft risk exceeds the profile's configured tolerance",
                "CRITICAL",
                details={"risk_flags": medium_risks},
            )
        )
        score -= 20

    if not str(plan.get("title") or "").strip():
        issues.append(QualityIssue("MISSING_TITLE", "Draft is missing a video title", "CRITICAL"))
        score -= 25
    if format_id not in FORMAT_ROLES:
        issues.append(QualityIssue("INVALID_FORMAT", "Draft format is not in the allowed catalog", "CRITICAL"))
        score -= 25
    if not linked and duration not in ALLOWED_DURATIONS:
        issues.append(QualityIssue("INVALID_DURATION", "Duration must be 25, 40, or 60 seconds", "CRITICAL"))
        score -= 20
    if not scenes:
        issues.append(QualityIssue("MISSING_SCENES", "Draft contains no usable scenes", "CRITICAL"))
        score -= 50

    if not linked and format_id in FORMAT_ROLES:
        allowed_roles = set(FORMAT_ROLES[format_id])
        invalid_role_indexes = [
            index
            for index, scene in enumerate(scenes)
            if isinstance(scene, dict) and str(scene.get("role") or "").upper() not in allowed_roles
        ]
        if invalid_role_indexes:
            issues.append(
                QualityIssue(
                    "INVALID_SCENE_ROLE",
                    "One or more scene roles do not belong to the selected format",
                    "CRITICAL",
                    scene_indexes=invalid_role_indexes,
                    details={"allowed_roles": sorted(allowed_roles)},
                )
            )
            score -= 20

    word_count = sum(_word_count(str(scene.get("voice_text") or "")) for scene in scenes if isinstance(scene, dict))
    if not linked and duration in ALLOWED_DURATIONS:
        limits = draft_duration_limits(duration)
        minimum_scenes = limits["min_scenes"]
        maximum_scenes = limits["max_scenes"]
        if len(scenes) < minimum_scenes:
            issues.append(
                QualityIssue(
                    "TOO_FEW_SCENES",
                    f"Draft has {len(scenes)} scenes; at least {minimum_scenes} are needed",
                    details={"actual": len(scenes), "minimum": minimum_scenes},
                )
            )
            score -= 12
        elif len(scenes) > maximum_scenes:
            issues.append(
                QualityIssue(
                    "TOO_MANY_SCENES",
                    f"Draft has {len(scenes)} scenes; at most {maximum_scenes} are expected",
                    details={"actual": len(scenes), "maximum": maximum_scenes},
                )
            )
            score -= 8

        minimum_words = limits["min_words"]
        maximum_words = limits["max_words"]
        if word_count < minimum_words:
            issues.append(
                QualityIssue(
                    "NARRATION_TOO_SHORT",
                    f"Narration has {word_count} words; target at least {minimum_words}",
                    details={"actual_words": word_count, "minimum_words": minimum_words},
                )
            )
            score -= 15
        elif word_count > maximum_words:
            issues.append(
                QualityIssue(
                    "NARRATION_TOO_LONG",
                    f"Narration has {word_count} words; target at most {maximum_words}",
                    details={"actual_words": word_count, "maximum_words": maximum_words},
                )
            )
            score -= 12

    duplicate_pairs: list[list[int]] = []
    for left_index, left in enumerate(scenes):
        for right_index in range(left_index + 1, len(scenes)):
            similarity = lexical_similarity(
                str(left.get("voice_text") or ""),
                str(scenes[right_index].get("voice_text") or ""),
            )
            if similarity >= SCENE_REPETITION_THRESHOLD:
                duplicate_pairs.append([left_index, right_index])
    if duplicate_pairs:
        indexes = sorted({index for pair in duplicate_pairs for index in pair})
        issues.append(
            QualityIssue(
                "SCENE_REPETITION",
                "Two or more scenes repeat substantially the same wording",
                scene_indexes=indexes,
                details={"pairs": duplicate_pairs[:5]},
            )
        )
        score -= min(30, 12 + 5 * len(duplicate_pairs))

    fact_ids = {str(fact.get("id")) for fact in source_facts if fact.get("id")}
    fact_text = " ".join(str(fact.get("text") or "") for fact in source_facts)
    invalid_evidence_indexes: list[int] = []
    missing_evidence_indexes: list[int] = []
    unsupported_number_indexes: list[int] = []
    unsupported_entity_indexes: list[int] = []
    unsupported_number_details: list[dict[str, Any]] = []
    unsupported_entity_details: list[dict[str, Any]] = []
    filler_indexes: list[int] = []
    for index, scene in enumerate(scenes):
        role = str(scene.get("role") or "").upper()
        voice_text = str(scene.get("voice_text") or "")
        if linked and scene.get("text") != voice_text:
            voice_text += " " + str(scene.get("text") or "")
        evidence_ids = [] if linked else [str(item) for item in scene.get("evidence_ids") or []]
        if any(evidence_id not in fact_ids for evidence_id in evidence_ids):
            invalid_evidence_indexes.append(index)
        if not linked and role not in _NON_FACTUAL_ROLES:
            if not evidence_ids:
                missing_evidence_indexes.append(index)
        cited_text = " ".join(
            str(fact.get("text") or "")
            for fact in source_facts
            if str(fact.get("id") or "") in evidence_ids
        ) if evidence_ids else fact_text
        unsupported_entities = _unsupported_entities(voice_text, cited_text)
        if unsupported_entities:
            unsupported_entity_indexes.append(index)
            unsupported_entity_details.append({
                "scene_index": index,
                "evidence_ids": evidence_ids,
                "unsupported_entities": sorted(unsupported_entities),
            })
        unsupported_numbers = _unsupported_numbers(voice_text, cited_text)
        if unsupported_numbers:
            unsupported_number_indexes.append(index)
            unsupported_number_details.append({
                "scene_index": index,
                "evidence_ids": evidence_ids,
                "unsupported_numbers": sorted(unsupported_numbers),
            })
        normalized_voice = _normalized_text(voice_text)
        if any(normalized_voice.startswith(_normalized_text(prefix)) for prefix in _FILLER_PREFIXES):
            filler_indexes.append(index)

    if invalid_evidence_indexes:
        issues.append(
            QualityIssue(
                "INVALID_EVIDENCE_ID",
                "One or more scenes reference evidence IDs that were not supplied",
                "CRITICAL",
                scene_indexes=invalid_evidence_indexes,
            )
        )
        score -= 25
    if missing_evidence_indexes:
        issues.append(
            QualityIssue(
                "MISSING_EVIDENCE",
                "Every factual scene must identify its supporting source facts",
                "CRITICAL",
                scene_indexes=missing_evidence_indexes,
            )
        )
        score -= min(30, 15 + 5 * len(missing_evidence_indexes))
    if unsupported_entity_indexes:
        issues.append(
            QualityIssue(
                "UNSUPPORTED_ENTITY",
                "A named entity used in narration does not appear in the cited source facts",
                "CRITICAL",
                scene_indexes=unsupported_entity_indexes,
                details={"scenes": unsupported_entity_details},
            )
        )
        score -= min(35, 20 + 5 * len(unsupported_entity_indexes))
    if unsupported_number_indexes:
        issues.append(
            QualityIssue(
                "UNSUPPORTED_NUMBER",
                "A number used in narration does not appear in the cited source facts",
                "CRITICAL",
                scene_indexes=unsupported_number_indexes,
                details={"scenes": unsupported_number_details},
            )
        )
        score -= 25
    if filler_indexes:
        issues.append(
            QualityIssue(
                "GENERIC_FILLER",
                "Draft contains generic phrases that should be replaced with source-specific narration",
                scene_indexes=filler_indexes,
            )
        )
        score -= min(18, 6 * len(filler_indexes))

    score = max(0, min(100, score))
    has_critical = any(issue.severity == "CRITICAL" for issue in issues)
    status = "PASS" if score >= MIN_DRAFT_QUALITY_SCORE and not has_critical else "REPAIR"
    return DraftQuality(status=status, score=score, issues=issues, word_count=word_count, scene_count=len(scenes))


def build_timeline_from_compact_scenes(
    compact: dict[str, Any],
    image_urls: list[str] | None = None,
    *, available_media: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if compact.get("version") == LINKED_DRAFT_VERSION:
        catalog = available_media if available_media is not None else [
            {"index": index, "type": "image", "src": src} for index, src in enumerate(image_urls or [])
        ]
        return build_linked_timeline(compact, catalog)
    image_urls = list(dict.fromkeys(str(item) for item in (image_urls or []) if str(item).strip()))
    plan = compact.get("plan") if isinstance(compact.get("plan"), dict) else {}
    scenes = compact.get("scenes") if isinstance(compact.get("scenes"), list) else []
    target_duration = _as_int(plan.get("duration_seconds")) or 40
    if target_duration not in ALLOWED_DURATIONS:
        target_duration = 40
    fps = 30

    weights = [max(2.5, _word_count(str(scene.get("voice_text") or "")) / 2.5) for scene in scenes]
    total_weight = sum(weights) or 1.0
    cursor = 0.0
    video: list[dict[str, Any]] = []
    text: list[dict[str, Any]] = []
    for index, scene in enumerate(scenes):
        start = _round_to_frame(cursor, fps)
        raw_end = float(target_duration) if index == len(scenes) - 1 else cursor + target_duration * weights[index] / total_weight
        end = _round_to_frame(max(start + 1 / fps, raw_end), fps)
        text_id = f"text-{index + 1}"
        video_id = f"video-{index + 1}"
        source_index = _as_int(scene.get("source_media_index"))
        if source_index is not None and 0 <= source_index < len(image_urls):
            source = image_urls[source_index]
        elif image_urls:
            source = image_urls[index % len(image_urls)]
        else:
            source = DEFAULT_IMAGES[index % len(DEFAULT_IMAGES)]

        video.append(
            {
                "id": video_id,
                "scene_index": index,
                "text_id": text_id,
                "text_ids": [text_id],
                "type": "image",
                "start": start,
                "end": end,
                "src": source,
                "effect": DEFAULT_EFFECTS[index % len(DEFAULT_EFFECTS)],
                "fit": "contain",
                **({"visual_direction": scene.get("visual_query")} if scene.get("visual_query") else {}),
            }
        )
        voice_text = str(scene.get("voice_text") or "").strip()
        text.append(
            {
                "id": text_id,
                "scene_index": index,
                "video_id": video_id,
                "video_ids": [video_id],
                "type": "subtitle",
                "start": start,
                "end": end,
                "text": voice_text,
                "voice_text": voice_text,
                "style": {},
                "role": scene.get("role"),
                "evidence_ids": scene.get("evidence_ids") or [],
            }
        )
        cursor = end

    return {
        "version": 1,
        "duration": _round_to_frame(cursor, fps),
        "video": video,
        "text": text,
        "audio": [],
        "metadata": {
            "draft_generation_mode": LEGACY_DRAFT_VERSION,
            "target_duration_seconds": target_duration,
            "creative_plan": plan,
            "full_script": " ".join(str(scene.get("voice_text") or "").strip() for scene in scenes).strip(),
        },
    }


def lexical_similarity(left: str, right: str) -> float:
    left_tokens = _meaningful_tokens(left)
    right_tokens = _meaningful_tokens(right)
    if not left_tokens or not right_tokens:
        return 0.0
    intersection = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    return intersection / union if union else 0.0


def _fact_sentences(value: str | None) -> list[str]:
    clean = _clean_text(value or "")
    if not clean:
        return []
    sentences = [part.strip() for part in re.split(r"(?<=[.!?…])\s+|\n+", clean) if part.strip()]
    result: list[str] = []
    for sentence in sentences:
        if len(sentence) <= 600:
            result.append(sentence)
            continue
        clauses = [part.strip() for part in re.split(r"(?<=[,;:])\s+", sentence) if part.strip()]
        buffer = ""
        for clause in clauses:
            next_value = f"{buffer} {clause}".strip()
            if len(next_value) > 500 and buffer:
                result.append(buffer)
                buffer = clause
            else:
                buffer = next_value
        if buffer:
            result.append(buffer)
    return result


def _clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _normalized_text(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "").lower())
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    normalized = normalized.replace("đ", "d")
    return re.sub(r"[^a-z0-9%]+", " ", normalized).strip()


def _meaningful_tokens(value: str) -> set[str]:
    return {
        token
        for token in _normalized_text(value).split()
        if len(token) >= 3 and token not in _STOPWORDS
    }


def _unsupported_numbers(voice_text: str, fact_text: str) -> set[str]:
    fact_numbers = {_normalize_number(item) for item in re.findall(r"(?<!\w)\d+(?:[.,]\d+)?%?", fact_text)}
    voice_numbers = {_normalize_number(item) for item in re.findall(r"(?<!\w)\d+(?:[.,]\d+)?%?", voice_text)}
    return voice_numbers - fact_numbers


def _unsupported_entities(voice_text: str, cited_fact_text: str) -> set[str]:
    cited_normalized = _normalized_text(cited_fact_text)
    unsupported: set[str] = set()
    for entity in _named_entities(voice_text):
        if _normalized_text(entity) not in cited_normalized:
            unsupported.add(entity)
    return unsupported


def _named_entities(value: str) -> set[str]:
    text = str(value or "")
    entities: set[str] = set()
    entities.update(re.findall(r"\b[A-ZĐ][\wÀ-ỹ]+(?:\s+[A-ZĐ][\wÀ-ỹ]+)+\b", text))
    entities.update(re.findall(r"\b[A-Z]{2,}\b", text))
    entities.update(re.findall(r"\b[A-ZĐ][a-zà-ỹ]+[A-ZĐ][\wÀ-ỹ]*\b", text))
    for match in re.finditer(r"\b[A-ZĐ][\wÀ-ỹ]{2,}\b", text):
        prefix = text[: match.start()].rstrip()
        if not prefix or prefix[-1:] in ".!?…:;":
            continue
        entities.add(match.group(0))
    return {entity for entity in entities if _normalized_text(entity) not in {"ai"}}


def _normalize_number(value: str) -> str:
    return str(value or "").replace(",", ".").strip()


def _word_count(value: str) -> int:
    return len([item for item in re.split(r"\s+", str(value or "").strip()) if item])


def _round_to_frame(seconds: float, fps: int) -> float:
    return max(0.0, round(float(seconds) * fps) / fps)


def _as_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError, OverflowError):
        return None


def _as_float(value: Any) -> float:
    try:
        result = float(value)
        return result if math.isfinite(result) else 0.0
    except (TypeError, ValueError):
        return 0.0
