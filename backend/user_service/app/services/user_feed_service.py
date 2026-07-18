import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.user_service.app.core.database_mongo import articles_col, user_article_feeds_col, user_crawl_settings_col
from backend.user_service.app.services.ai_rewriter import get_client

DEFAULT_SETTINGS = {
    "keywords": [],
    "exclude_keywords": [],
    "min_score": 70,
    "include_low_suggestions": True,
    "use_ai_scoring": True,
    "recent_limit": 50,
}


def _clean_keywords(value: List[str] | None) -> List[str]:
    if not value:
        return []
    cleaned = []
    for item in value:
        keyword = item.strip().lower()
        if keyword and keyword not in cleaned:
            cleaned.append(keyword)
    return cleaned


def get_user_crawl_settings(user_id: int) -> Dict[str, Any]:
    settings = user_crawl_settings_col.find_one({"user_id": user_id}, {"_id": 0})
    if not settings:
        return {"user_id": user_id, **DEFAULT_SETTINGS}
    return {**DEFAULT_SETTINGS, **settings}


def save_user_crawl_settings(user_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    settings = {
        **get_user_crawl_settings(user_id),
        "keywords": _clean_keywords(payload.get("keywords")),
        "exclude_keywords": _clean_keywords(payload.get("exclude_keywords")),
        "min_score": int(payload.get("min_score", DEFAULT_SETTINGS["min_score"])),
        "include_low_suggestions": bool(payload.get("include_low_suggestions", True)),
        "use_ai_scoring": bool(payload.get("use_ai_scoring", True)),
        "recent_limit": int(payload.get("recent_limit", DEFAULT_SETTINGS["recent_limit"])),
        "updated_at": datetime.utcnow(),
    }
    settings["min_score"] = max(0, min(settings["min_score"], 100))
    settings["recent_limit"] = max(1, min(settings["recent_limit"], 200))

    user_crawl_settings_col.update_one(
        {"user_id": user_id},
        {"$set": settings},
        upsert=True,
    )
    settings.pop("_id", None)
    return settings


def _article_text(article: Dict[str, Any]) -> str:
    content = article.get("content", "")
    if isinstance(content, list):
        content = " ".join(str(item) for item in content)
    return f"{article.get('title', '')}\n{content}".lower()


def keyword_score(article: Dict[str, Any], settings: Dict[str, Any]) -> tuple[int, List[str]]:
    text = _article_text(article)
    exclude_keywords = settings.get("exclude_keywords", [])
    if any(keyword in text for keyword in exclude_keywords):
        return 0, []

    keywords = settings.get("keywords", [])
    if not keywords:
        return 50, []

    matched = [keyword for keyword in keywords if keyword in text]
    if not matched:
        return 0, []

    title = str(article.get("title", "")).lower()
    title_hits = sum(1 for keyword in matched if keyword in title)
    coverage_score = min(70, round(len(matched) / len(keywords) * 70))
    title_score = min(30, title_hits * 15)
    return min(100, coverage_score + title_score), matched


def _parse_ai_score(content: str) -> tuple[Optional[int], str]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\b(\d{1,3})\b", content)
        if not match:
            return None, content[:240]
        return max(0, min(100, int(match.group(1)))), content[:240]

    score = data.get("score")
    reason = data.get("reason", "")
    if score is None:
        return None, reason
    return max(0, min(100, int(score))), str(reason)[:240]


async def ai_score_article(article: Dict[str, Any], settings: Dict[str, Any], keyword_base_score: int) -> tuple[int, str]:
    keywords = ", ".join(settings.get("keywords", [])) or "không có keyword cụ thể"
    exclude_keywords = ", ".join(settings.get("exclude_keywords", [])) or "không có"
    content = article.get("content", "")
    if isinstance(content, list):
        content = " ".join(str(item) for item in content)

    prompt = f"""
Chấm độ phù hợp của bài viết cho người dùng theo thang 0-100.
Keyword quan tâm: {keywords}
Keyword loại trừ: {exclude_keywords}
Điểm keyword matching ban đầu: {keyword_base_score}

Chỉ trả JSON hợp lệ dạng:
{{"score": 0-100, "reason": "lý do ngắn"}}
""".strip()

    try:
        response = await get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": f"Tiêu đề: {article.get('title', '')}\nNội dung: {str(content)[:1800]}",
                },
            ],
            max_tokens=120,
            temperature=0,
        )
        score, reason = _parse_ai_score(response.choices[0].message.content or "")
        return (score if score is not None else keyword_base_score), reason
    except Exception as exc:
        return keyword_base_score, f"AI scoring fallback: {exc}"


def _serialize_feed_item(feed_item: Dict[str, Any]) -> Dict[str, Any]:
    article = feed_item.get("article") or {}
    return {
        **article,
        "match_score": feed_item.get("score", 0),
        "match_status": feed_item.get("match_status", "low_suggestion"),
        "match_reason": feed_item.get("reason", ""),
        "matched_keywords": feed_item.get("matched_keywords", []),
        "matched_at": feed_item.get("matched_at"),
    }


async def match_recent_articles_for_user(user_id: int, force_ai: Optional[bool] = None) -> Dict[str, Any]:
    settings = get_user_crawl_settings(user_id)
    use_ai = settings.get("use_ai_scoring", True) if force_ai is None else force_ai
    min_score = settings.get("min_score", 70)
    limit = settings.get("recent_limit", 50)
    projection = {
        "_id": 0,
        "link": 1,
        "title": 1,
        "content": 1,
        "status": 1,
        "crawled_at": 1,
        "videos": 1,
        "image": 1,
        "images": 1,
    }
    articles = list(articles_col.find({}, projection).sort("crawled_at", -1).limit(limit))
    matched_count = 0
    low_count = 0

    for article in articles:
        base_score, matched_keywords = keyword_score(article, settings)
        if base_score <= 0 and not settings.get("include_low_suggestions", True):
            continue

        score = base_score
        reason = "Keyword matching"
        if use_ai and base_score > 0:
            score, reason = await ai_score_article(article, settings, base_score)

        match_status = "matched" if score >= min_score else "low_suggestion"
        if match_status == "matched":
            matched_count += 1
        else:
            low_count += 1

        user_article_feeds_col.update_one(
            {"user_id": user_id, "link": article.get("link")},
            {
                "$set": {
                    "user_id": user_id,
                    "link": article.get("link"),
                    "article": article,
                    "score": score,
                    "match_status": match_status,
                    "reason": reason,
                    "matched_keywords": matched_keywords,
                    "matched_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )

    return {
        "processed": len(articles),
        "matched": matched_count,
        "low_suggestions": low_count,
        "min_score": min_score,
        "use_ai_scoring": use_ai,
    }


def get_user_article_feed(
    user_id: int,
    page: int = 1,
    limit: int = 20,
    include_low: bool = False,
) -> Dict[str, Any]:
    query: Dict[str, Any] = {"user_id": user_id}
    if not include_low:
        query["match_status"] = "matched"

    skip = (page - 1) * limit
    cursor = (
        user_article_feeds_col.find(query, {"_id": 0})
        .sort([("score", -1), ("matched_at", -1)])
        .skip(skip)
        .limit(limit)
    )
    items = [_serialize_feed_item(item) for item in cursor]
    total = user_article_feeds_col.count_documents(query)
    return {"items": items, "total": total, "page": page, "limit": limit}
