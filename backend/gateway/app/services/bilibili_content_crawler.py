from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any

import httpx
from bson import ObjectId

from backend.gateway.app.api.websockets.events import broadcast
from backend.gateway.app.core.database_mongo import articles_col


BILIBILI_SERVICE_URL = os.getenv("BILIBILI_SERVICE_URL", "http://127.0.0.1:8010").rstrip("/")
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")
DEFAULT_BILIBILI_KEYWORDS = [
    item.strip()
    for item in os.getenv("BILIBILI_CRAWL_KEYWORDS", "短剧,霸道总裁 短剧,AI短剧 全集").split(",")
    if item.strip()
]


async def crawl_bilibili_feed(
    *,
    user_id: int = 0,
    keywords: list[str] | None = None,
    limit: int = 10,
    max_duration_seconds: int = 7200,
    evaluate: bool = True,
) -> dict[str, int]:
    queries = [item.strip() for item in (keywords or DEFAULT_BILIBILI_KEYWORDS) if item.strip()]
    if not queries:
        queries = DEFAULT_BILIBILI_KEYWORDS

    inserted = 0
    skipped = 0
    queued = 0
    async with httpx.AsyncClient(timeout=120) as client:
        for keyword in queries:
            candidates = await _search_bilibili(client, keyword, user_id=user_id, limit=limit, max_duration_seconds=max_duration_seconds)
            for candidate in candidates[:limit]:
                link = str(candidate.get("url") or "").strip()
                title = str(candidate.get("title") or "").strip()
                if not link or not title:
                    skipped += 1
                    continue
                if articles_col.find_one({"link": link}) or articles_col.find_one({"title": title, "source_platform": "bilibili"}):
                    skipped += 1
                    continue

                detail = await _fetch_bilibili_detail(client, candidate, user_id=user_id)
                document = _build_bilibili_document(candidate, detail, keyword)
                articles_col.insert_one(document)
                document.pop("_id", None)
                inserted += 1

                if evaluate:
                    queued += await _evaluate_content_for_profiles(client, document)

                await broadcast({
                    "type": "bilibili_video_crawled",
                    "title": document.get("title"),
                    "link": document.get("link"),
                    "episodes": len(document.get("episodes") or []),
                    "queued_for_profiles": queued,
                    "timestamp": datetime.utcnow().isoformat(),
                })

    return {"inserted": inserted, "skipped": skipped, "queued": queued}


def list_bilibili_feed(page: int = 1, limit: int = 20, search: str | None = None) -> dict[str, Any]:
    query: dict[str, Any] = {"source_platform": "bilibili"}
    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"content": {"$regex": search, "$options": "i"}},
        ]
    skip = (page - 1) * limit
    projection = {
        "_id": 0,
        "link": 1,
        "title": 1,
        "description": 1,
        "content": 1,
        "status": 1,
        "crawled_at": 1,
        "source_platform": 1,
        "thumbnail_url": 1,
        "preview_url": 1,
        "duration_seconds": 1,
        "episode_count": 1,
        "episodes": 1,
        "series_source": 1,
        "season_id": 1,
        "season_title": 1,
        "aid": 1,
        "bvid": 1,
        "author": 1,
        "play_count": 1,
        "match_score": 1,
    }
    items = list(
        articles_col.find(query, projection)
        .sort("crawled_at", -1)
        .skip(skip)
        .limit(limit)
    )
    return {"items": items, "total": articles_col.count_documents(query), "page": page, "limit": limit}


async def _search_bilibili(
    client: httpx.AsyncClient,
    keyword: str,
    *,
    user_id: int,
    limit: int,
    max_duration_seconds: int,
) -> list[dict[str, Any]]:
    response = await client.post(
        f"{BILIBILI_SERVICE_URL}/api/bilibili-crawler/search",
        headers={"X-User-Id": str(user_id)},
        json={
            "input_text": keyword,
            "sources": ["bilibili"],
            "max_duration_seconds": max_duration_seconds,
            "limit": max(limit, 12),
            "mode": "keyword",
        },
    )
    response.raise_for_status()
    data = response.json()
    candidates = data.get("candidates")
    return candidates if isinstance(candidates, list) else []


async def _fetch_bilibili_detail(client: httpx.AsyncClient, candidate: dict[str, Any], *, user_id: int) -> dict[str, Any]:
    payload = _series_info_payload(candidate)
    try:
        response = await client.post(
            f"{BILIBILI_SERVICE_URL}/api/bilibili-crawler/series-info",
            headers={"X-User-Id": str(user_id)},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        print(f"Bilibili detail fallback for {candidate.get('url')}: {exc}")
        return {}


def _series_info_payload(candidate: dict[str, Any]) -> dict[str, Any]:
    aid = candidate.get("aid")
    if aid:
        return {"aid": aid}
    bvid = candidate.get("bvid") or _extract_bvid(str(candidate.get("url") or ""))
    if bvid:
        return {"bvid": bvid}
    return {"url": candidate.get("url")}


def _extract_bvid(value: str) -> str | None:
    match = re.search(r"(BV[0-9A-Za-z]+)", value)
    return match.group(1) if match else None


async def _evaluate_content_for_profiles(client: httpx.AsyncClient, document: dict[str, Any]) -> int:
    try:
        response = await client.post(
            f"{USER_SERVICE_URL}/api/internal/articles/evaluate",
            json={"article": _json_ready(document)},
        )
        response.raise_for_status()
        return int(response.json().get("queued", 0))
    except Exception as exc:
        error = str(exc)
        if isinstance(exc, httpx.HTTPStatusError):
            error = f"{exc.response.status_code}: {exc.response.text[:500]}"
        await broadcast({
            "type": "bilibili_evaluate_error",
            "title": document.get("title"),
            "link": document.get("link"),
            "error": error,
            "timestamp": datetime.utcnow().isoformat(),
        })
        return 0


def _build_bilibili_document(candidate: dict[str, Any], detail: dict[str, Any], keyword: str) -> dict[str, Any]:
    current = detail.get("current") if isinstance(detail.get("current"), dict) else {}
    episodes = detail.get("episodes") if isinstance(detail.get("episodes"), list) else []
    normalized_episodes = [_episode_summary(item) for item in episodes if isinstance(item, dict)]
    title = str(current.get("title") or candidate.get("title") or "").strip()
    description = str(current.get("description") or candidate.get("description") or "").strip()
    link = str(current.get("url") or candidate.get("url") or "").strip()
    duration_seconds = _first_number(current.get("duration_seconds"), candidate.get("duration_seconds"))

    content_lines = [
        title,
        description,
        f"Từ khóa crawl: {keyword}",
        f"Số tập: {len(normalized_episodes) or candidate.get('playlist_size') or 1}",
    ]
    if normalized_episodes:
        content_lines.append(
            "Danh sách tập: "
            + "; ".join(
                f"{item['episode_index']}. {item['title']} ({_format_duration(item.get('duration_seconds'))})"
                for item in normalized_episodes[:20]
            )
        )

    return {
        "link": link,
        "title": title,
        "description": description,
        "content": "\n".join(part for part in content_lines if part),
        "videos": [link],
        "images": [candidate.get("thumbnail_url")] if candidate.get("thumbnail_url") else [],
        "image": candidate.get("thumbnail_url"),
        "thumbnail_url": candidate.get("thumbnail_url"),
        "preview_url": candidate.get("preview_url") or _build_player_url(candidate),
        "source_platform": "bilibili",
        "crawl_source": "bilibili_scheduler",
        "requested_topics": [keyword],
        "status": "crawled",
        "crawled_at": datetime.utcnow(),
        "author": candidate.get("author"),
        "play_count": candidate.get("play_count"),
        "duration_seconds": duration_seconds,
        "episode_count": len(normalized_episodes) or candidate.get("playlist_size") or 1,
        "episodes": normalized_episodes,
        "series_source": detail.get("source"),
        "season_id": detail.get("season_id"),
        "season_title": detail.get("season_title"),
        "bvid": current.get("bvid") or candidate.get("bvid"),
        "aid": current.get("aid") or candidate.get("aid"),
    }


def _episode_summary(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "episode_index": item.get("episode_index"),
        "title": item.get("title") or f"Part {item.get('episode_index') or ''}".strip(),
        "url": item.get("url"),
        "duration_seconds": _first_number(item.get("duration_seconds")),
        "bvid": item.get("bvid"),
        "aid": item.get("aid"),
        "cid": item.get("cid"),
    }


def _first_number(*values: object) -> int | None:
    for value in values:
        if isinstance(value, bool) or value is None:
            continue
        try:
            return int(float(value))
        except (TypeError, ValueError):
            continue
    return None


def _build_player_url(candidate: dict[str, Any]) -> str | None:
    bvid = candidate.get("bvid")
    if bvid:
        return f"https://player.bilibili.com/player.html?bvid={bvid}&autoplay=0"
    return None


def _format_duration(value: object) -> str:
    seconds = _first_number(value)
    if seconds is None:
        return "-"
    return f"{seconds // 60}:{seconds % 60:02d}"


def _json_ready(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_ready(item) for key, item in value.items() if key != "_id"}
    if isinstance(value, list):
        return [_json_ready(item) for item in value]
    return value
