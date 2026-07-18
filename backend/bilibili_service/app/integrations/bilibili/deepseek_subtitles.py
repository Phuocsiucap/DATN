from __future__ import annotations

import json
from typing import Any

from backend.bilibili_service.app.core.config import get_settings
from backend.bilibili_service.app.integrations.bilibili.deepseek_client import deepseek_chat_json
DEEPSEEK_SUBTITLE_SYSTEM_PROMPT = """You are a professional Chinese-to-Vietnamese subtitle translator for Chinese short drama videos.
Return ONLY a valid JSON object in this exact shape:
{"translations":{"1":"...","2":"..."}}

Rules:
- Translate into Vietnamese only.
- Input subtitles are objects with stable id and text. Return one translation for every id. Do not omit, merge, split, renumber, or reorder ids.
- Each source text is one subtitle cue; translate the whole cue, including every sentence inside that cue.
- The input comes from OCR hard-subtitles; repair obvious OCR mistakes by context, but do not invent new plot.
- Use natural TikTok short-drama Vietnamese, not literal machine translation.
- Preserve character names consistently.
- Prefer pronouns anh/em/cô/tôi depending on context.
- Never output Chinese, pinyin, explanations, markdown, or numbering.
"""


def translate_subtitle_window_with_deepseek(
    source_texts: list[str],
    *,
    context: dict[str, Any] | None = None,
    previous_vi: list[str] | None = None,
) -> list[str]:
    if not source_texts:
        return []
    cues = [{"id": str(index + 1), "text": text} for index, text in enumerate(source_texts)]
    payload = {
        "context": {
            "summary": (context or {}).get("summary_vi", ""),
            "story_type": (context or {}).get("story_type", ""),
            "names": (context or {}).get("names", []),
            "glossary": (context or {}).get("glossary", {}),
            "previous_vi": (previous_vi or [])[-10:],
        },
        "subtitles_zh": cues,
    }
    data = deepseek_chat_json(
        model=get_settings().deepseek_subtitle_model,
        system_prompt=DEEPSEEK_SUBTITLE_SYSTEM_PROMPT,
        user_payload=payload,
        max_tokens=max(1024, len(json.dumps(source_texts, ensure_ascii=False)) * 4),
        temperature=0.0,
    )
    values = normalize_deepseek_translations(data.get("translations"))
    missing_ids = [cue["id"] for cue in cues if not values.get(cue["id"])]
    if missing_ids:
        values.update(retry_missing_translations(cues, missing_ids, context=context, previous_vi=previous_vi))
    remaining_missing = [cue_id for cue_id in (cue["id"] for cue in cues) if not values.get(cue_id)]
    if remaining_missing:
        raise RuntimeError(
            "DeepSeek subtitle translator missed ids "
            f"{', '.join(remaining_missing)} for {len(source_texts)} inputs."
        )
    return [str(values[cue["id"]]).strip() for cue in cues]


def normalize_deepseek_translations(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        return {str(key): str(item).strip() for key, item in value.items() if str(item).strip()}
    if isinstance(value, list):
        return {str(index + 1): str(item).strip() for index, item in enumerate(value) if str(item).strip()}
    raise RuntimeError("DeepSeek subtitle translator did not return translations as an object.")


def retry_missing_translations(
    cues: list[dict[str, str]],
    missing_ids: list[str],
    *,
    context: dict[str, Any] | None,
    previous_vi: list[str] | None,
) -> dict[str, str]:
    missing = [cue for cue in cues if cue["id"] in set(missing_ids)]
    payload = {
        "context": {
            "summary": (context or {}).get("summary_vi", ""),
            "story_type": (context or {}).get("story_type", ""),
            "names": (context or {}).get("names", []),
            "glossary": (context or {}).get("glossary", {}),
            "previous_vi": (previous_vi or [])[-10:],
            "neighboring_subtitles_zh": cues,
        },
        "subtitles_zh": missing,
        "required_ids": missing_ids,
    }
    data = deepseek_chat_json(
        model=get_settings().deepseek_subtitle_model,
        system_prompt=DEEPSEEK_SUBTITLE_SYSTEM_PROMPT
        + "\nThis is a repair pass. Return translations for required_ids only.",
        user_payload=payload,
        max_tokens=max(512, len(json.dumps(missing, ensure_ascii=False)) * 6),
        temperature=0.0,
    )
    raw = data.get("translations")
    if isinstance(raw, list):
        return {
            cue_id: str(item).strip()
            for cue_id, item in zip(missing_ids, raw)
            if str(item).strip()
        }
    return normalize_deepseek_translations(raw)



