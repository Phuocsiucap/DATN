from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass

from backend.bilibili_service.app.schemas.domain import Niche
from backend.bilibili_service.app.integrations.bilibili.deepseek_client import deepseek_chat_json
from backend.bilibili_service.app.core.config import get_settings


@dataclass(frozen=True)
class KeywordPlan:
    source_text_vi: str
    keyword_zh: str
    queries: list[str]
    platform_priority: list[str]
    provider: str
    inferred_niche: str
    confidence: float
    reasoning: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


PLATFORM_PRIORITY: dict[Niche, list[str]] = {
    Niche.generic: ["bilibili"],
    Niche.short_film: ["bilibili"],
    Niche.cooking: ["bilibili"],
    Niche.smart_home: ["bilibili"],
    Niche.gadgets: ["bilibili"],
}


class KeywordProvider:
    def build_plan(self, text_vi: str, niche: Niche) -> KeywordPlan:
        provider = get_settings().keyword_provider.lower().strip()
        if provider == "deepseek":
            return build_plan_with_deepseek(text_vi, niche)
        raise RuntimeError(f"Unsupported keyword provider: {provider}. Set ACD_KEYWORD_PROVIDER=deepseek.")


KEYWORD_LLM_SYSTEM_PROMPT = """You are a search strategist for a Vietnamese web app that finds Chinese videos on Bilibili.
Task: infer the user's Vietnamese search intent, translate it into Chinese search keywords, and produce Bilibili-ready Chinese query variants.

Return ONLY one valid JSON object, no markdown:
{
  "niche": "generic|short_film|cooking|smart_home|gadgets",
  "keyword_zh": "...",
  "queries": ["...", "...", "...", "...", "..."],
  "confidence": 0.0,
  "reasoning": "short Vietnamese explanation"
}

Rules:
- Understand Vietnamese with or without accents.
- Do not translate literally if that hurts search quality.
- Use the domain glossary below as mandatory meaning guidance, but still return only JSON.
- cặp đôi/cap doi/cặp đôi yêu nhau => 情侣甜宠短剧, 情侣恋爱短剧, 情侣日常, 甜宠短剧
- kệ gỗ/ke go/kệ để đồ => 木质置物架, 木质收纳架, 家居收纳
- gia dụng/do gia dung => 家居好物, 小家电, 家用电器
- pubg => PUBG 吃鸡, 绝地求生, 和平精英
- iphone => iPhone 苹果手机, iPhone 测评, iPhone 开箱
- If input looks like a Vietnamese transliteration of a Chinese person/character name, reconstruct likely Chinese names and search by name, not by meaning.
- Tiểu Kiều/Tieu Kieu/Xiao Qiao => 小乔. Use queries like 小乔 短剧, 小乔 剧情, 小乔 合集. Never use 小聊 for this name.
- Hạo Kiệt/Hao Kiet => 浩杰 / 昊杰 / 皓杰 are possible names. Put the most likely in keyword_zh and include variants in queries.
- For proper-name searches, use short_film if the context is video/drama/person clips; include 短剧, 剧情, 合集, 完整版 only when helpful.
- For romance/relationship/drama intent, use short_film and Chinese short-drama terms like 情侣, 甜宠, 恋爱, 短剧, 合集, 完整版.
- For product intent, use Chinese commerce/video terms like 测评, 开箱, 好物, 使用, 推荐.
- For gaming, keep game names like PUBG/iPhone in Latin when Chinese users search that way.
- queries must be useful Bilibili search strings, not sentences.
- keyword_zh should be the compact core Chinese keyword.
- Avoid obscure terms unless user asks for them.
- Do not invent rare Chinese words. Prefer common search terms.
"""


def build_plan_with_deepseek(text_vi: str, fallback_niche: Niche) -> KeywordPlan:
    normalized = normalize_vietnamese_query(text_vi)
    data = deepseek_chat_json(
        model=get_settings().deepseek_keyword_model,
        system_prompt=KEYWORD_LLM_SYSTEM_PROMPT,
        user_payload={"input_vi": text_vi, "normalized_no_accent": normalized, "fallback_niche": fallback_niche.value},
        max_tokens=512,
        temperature=0.0,
    )
    niche = parse_niche(str(data.get("niche") or fallback_niche.value), fallback_niche)
    keyword_zh = sanitize_query(str(data.get("keyword_zh") or ""))
    raw_queries = data.get("queries")
    queries = [sanitize_query(str(item)) for item in raw_queries] if isinstance(raw_queries, list) else []
    queries = [query for query in queries if is_valid_search_query(query)]
    if not is_valid_search_query(keyword_zh):
        raise RuntimeError("DeepSeek keyword planner returned an invalid keyword.")
    if len(queries) < 3:
        raise RuntimeError("DeepSeek keyword planner returned too few query variants.")
    return KeywordPlan(
        source_text_vi=text_vi,
        keyword_zh=keyword_zh,
        queries=dedupe(queries)[:8],
        platform_priority=PLATFORM_PRIORITY[niche],
        provider=f"deepseek:{get_settings().deepseek_keyword_model}",
        inferred_niche=niche.value,
        confidence=parse_confidence(data.get("confidence")),
        reasoning=str(data.get("reasoning") or "DeepSeek inferred Chinese search intent"),
    )


def normalize_vietnamese_query(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text.lower())
    return "".join(char for char in normalized if not unicodedata.combining(char)).strip()


def parse_niche(value: str, fallback: Niche) -> Niche:
    try:
        return Niche(value)
    except ValueError:
        return fallback


def sanitize_query(value: str) -> str:
    text = re.sub(r"\s+", " ", value).strip()
    text = re.sub(r"[\"'`]+", "", text)
    return text[:80]


def is_valid_search_query(value: str) -> bool:
    if len(value.strip()) < 2:
        return False
    return bool(re.search(r"[\u3400-\u9fffA-Za-z0-9]", value))


def parse_confidence(value: object) -> float:
    try:
        return max(0.0, min(0.99, round(float(value), 2)))
    except (TypeError, ValueError):
        return 0.85


def dedupe(values: list[str]) -> list[str]:
    seen = set()
    out = []
    for value in values:
        if value not in seen:
            out.append(value)
            seen.add(value)
    return out



