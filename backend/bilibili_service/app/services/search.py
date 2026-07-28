from __future__ import annotations

import asyncio
import re
import time
from functools import lru_cache
from urllib.parse import urlparse

from fastapi import WebSocket

from backend.bilibili_service.app.schemas.domain import Niche
from backend.bilibili_service.app.services.runtime import crawler, downloader, keywords
from backend.bilibili_service.app.schemas.api import (
    KeywordPlanResponse,
    SearchCandidateResponse,
    SearchRequest,
    SearchResponse,
    TranslateTitleResponse,
)
from backend.bilibili_service.app.integrations.bilibili.subtitles import translate_text
from backend.bilibili_service.app.integrations.bilibili.china_crawler import dedupe_candidates


SEARCH_CACHE_TTL_SECONDS = 300
search_cache: dict[tuple[object, ...], tuple[float, SearchResponse]] = {}


def search_for_candidates(req: SearchRequest) -> SearchResponse:
    cached = get_cached_search_response(req)
    if cached:
        return cached

    if req.mode == "trending":
        plan = build_trending_plan()
        candidates = crawler.trending_bilibili_many(req.max_duration_seconds, limit=req.limit)
        response = SearchResponse(
            keyword_plan=plan,
            candidates=[SearchCandidateResponse(**{**candidate.__dict__, "title_vi": None}) for candidate in candidates],
        )
        set_cached_search_response(req, response)
        return response

    if req.mode == "link":
        url = normalize_bilibili_video_input(req.input_text)
        if not url:
            raise ValueError("Nhập link Bilibili hoặc mã BV hợp lệ.")
        candidate = resolve_link_candidate(url)
        response = SearchResponse(keyword_plan=build_link_plan(url), candidates=[candidate])
        set_cached_search_response(req, response)
        return response

    if not req.input_text.strip():
        raise ValueError("input_text is required for keyword search.")

    raw_plan = keywords.build_plan(req.input_text, Niche.generic)
    query = raw_plan.keyword_zh or req.input_text
    candidates = crawler.search_bilibili_many(query, req.max_duration_seconds, limit=req.limit)
    response = SearchResponse(
        keyword_plan=KeywordPlanResponse(**raw_plan.to_dict()),
        candidates=[SearchCandidateResponse(**{**candidate.__dict__, "title_vi": None}) for candidate in candidates],
    )
    set_cached_search_response(req, response)
    return response


async def handle_dashboard_ws_message(websocket: WebSocket, payload: dict) -> None:
    if payload.get("action") != "search":
        return
    request_id = str(payload.get("request_id") or "")
    try:
        req = SearchRequest(**(payload.get("payload") or {}))
        cached = get_cached_search_response(req)
        if cached:
            await websocket.send_json({
                "channel": "bilibili_crawler",
                "request_id": request_id,
                "type": "search_cached",
                "response": cached.model_dump(mode="json"),
            })
            await websocket.send_json({
                "channel": "bilibili_crawler",
                "request_id": request_id,
                "type": "search_done",
                "count": len(cached.candidates),
            })
            return

        loop = asyncio.get_running_loop()
        plan, candidates = await asyncio.to_thread(run_streamable_search, req, websocket, loop, request_id)
        response = SearchResponse(keyword_plan=plan, candidates=candidates)
        set_cached_search_response(req, response)
        await websocket.send_json({
            "channel": "bilibili_crawler",
            "request_id": request_id,
            "type": "search_done",
            "count": len(candidates),
        })
    except Exception as exc:
        await websocket.send_json({
            "channel": "bilibili_crawler",
            "request_id": request_id,
            "type": "search_error",
            "detail": str(exc),
        })


def run_streamable_search(
    req: SearchRequest,
    websocket: WebSocket,
    loop: asyncio.AbstractEventLoop,
    request_id: str = "",
) -> tuple[KeywordPlanResponse, list[SearchCandidateResponse]]:
    def send(payload: dict) -> None:
        payload = {"channel": "bilibili_crawler", "request_id": request_id, **payload}
        asyncio.run_coroutine_threadsafe(websocket.send_json(payload), loop).result(timeout=30)

    if req.mode == "trending":
        plan = build_trending_plan()
        send({"type": "search_plan", "plan": plan.model_dump(mode="json")})
        candidates = [
            SearchCandidateResponse(**{**candidate.__dict__, "title_vi": None})
            for candidate in crawler.trending_bilibili_many(req.max_duration_seconds, limit=req.limit)
        ]
        send({"type": "search_results", "candidates": [candidate.model_dump(mode="json") for candidate in candidates], "done": False})
        return plan, candidates

    if req.mode == "link":
        url = normalize_bilibili_video_input(req.input_text)
        if not url:
            raise RuntimeError("Nhập link Bilibili hoặc mã BV hợp lệ.")
        plan = build_link_plan(url)
        candidate = resolve_link_candidate(url)
        send({"type": "search_plan", "plan": plan.model_dump(mode="json")})
        send({"type": "search_results", "candidates": [candidate.model_dump(mode="json")], "done": False})
        return plan, [candidate]

    if not req.input_text.strip():
        raise RuntimeError("input_text is required for keyword search.")

    raw_plan = keywords.build_plan(req.input_text, Niche.generic)
    query = raw_plan.keyword_zh or req.input_text
    plan = KeywordPlanResponse(**raw_plan.to_dict())
    send({"type": "search_plan", "plan": plan.model_dump(mode="json")})

    found: list = []
    sent_urls: set[str] = set()
    errors: list[str] = []
    try:
        batches = crawler.iter_bilibili_search_pages(query, req.max_duration_seconds, limit=max(req.limit, 12))
        for batch in batches:
            found.extend(batch)
            candidates = [SearchCandidateResponse(**{**candidate.__dict__, "title_vi": None}) for candidate in dedupe_candidates(found)[:req.limit]]
            new_candidates = [candidate for candidate in candidates if candidate.url not in sent_urls]
            if new_candidates:
                sent_urls.update(candidate.url for candidate in new_candidates)
                send({
                    "type": "search_results",
                    "query": query,
                    "candidates": [candidate.model_dump(mode="json") for candidate in new_candidates],
                    "done": False,
                })
            if len(sent_urls) >= req.limit:
                break
    except Exception as exc:
        errors.append(f"{query}: {exc}")

    ranked = [SearchCandidateResponse(**{**candidate.__dict__, "title_vi": None}) for candidate in dedupe_candidates(found)[:req.limit]]
    if not ranked and errors:
        raise RuntimeError("No Chinese platform video found. " + " | ".join(errors[-3:]))
    return plan, ranked


def annotate_search_candidates(candidates: list, limit: int) -> list[SearchCandidateResponse]:
    from backend.bilibili_service.app.integrations.bilibili.china_crawler import rank_series_candidates

    ranked = rank_series_candidates(candidates, limit)
    return [SearchCandidateResponse(**{**candidate.__dict__, "title_vi": None}) for candidate in ranked]


def get_cached_search_response(req: SearchRequest) -> SearchResponse | None:
    key = build_search_cache_key(req)
    cached = search_cache.get(key)
    if not cached:
        return None
    cached_at, response = cached
    if time.time() - cached_at > SEARCH_CACHE_TTL_SECONDS:
        search_cache.pop(key, None)
        return None
    return response.model_copy(deep=True)


def set_cached_search_response(req: SearchRequest, response: SearchResponse) -> None:
    search_cache[build_search_cache_key(req)] = (time.time(), response.model_copy(deep=True))


def build_search_cache_key(req: SearchRequest) -> tuple[object, ...]:
    return (
        req.mode,
        req.input_text.strip().lower(),
        tuple(sorted(req.sources)),
        req.max_duration_seconds,
        req.limit,
    )


def normalize_bilibili_video_input(value: str) -> str | None:
    text = value.strip()
    if not text:
        return None
    if re.fullmatch(r"BV[0-9A-Za-z]+", text):
        return f"https://www.bilibili.com/video/{text}"
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"}:
        return None
    hostname = (parsed.hostname or "").lower()
    allowed_hosts = {
        "bilibili.com",
        "www.bilibili.com",
        "m.bilibili.com",
        "b23.tv",
    }
    if hostname in allowed_hosts or hostname.endswith(".bilibili.com"):
        return text
    return None


@lru_cache(maxsize=512)
def translate_title_cached(title: str) -> str:
    return translate_text(title)


def translate_title_to_vi(title: str) -> TranslateTitleResponse:
    return TranslateTitleResponse(title=title, title_vi=translate_title_cached(title))


def build_search_queries(keyword_zh: str, niche: Niche, base_queries: list[str]) -> list[str]:
    if niche == Niche.short_film:
        queries = [
            *base_queries,
            f"{keyword_zh} B站 短剧",
            f"{keyword_zh} 短剧 完整版",
            f"{keyword_zh} 短剧 大结局",
            f"{keyword_zh} 全集",
            f"{keyword_zh} 合集",
            f"{keyword_zh} 一口气看完",
        ]
        if "霸道总裁" in keyword_zh and keyword_zh != "霸道总裁短剧":
            queries.extend([
                "霸道总裁短剧",
                "霸道总裁短剧 完整版",
                "霸道总裁短剧 大结局",
            ])
        return queries
    return [
        *base_queries,
        f"{keyword_zh} 短视频",
        f"{keyword_zh} 体验",
    ]


def build_trending_plan() -> KeywordPlanResponse:
    return KeywordPlanResponse(
        source_text_vi="Bilibili trending",
        keyword_zh="热门",
        queries=["Bilibili trending"],
        platform_priority=["bilibili"],
        provider="bilibili:popular",
        inferred_niche="generic",
        confidence=1.0,
        reasoning="Lấy danh sách video đang thịnh hành trực tiếp từ Bilibili.",
    )


def build_link_plan(url: str) -> KeywordPlanResponse:
    return KeywordPlanResponse(
        source_text_vi=url,
        keyword_zh="",
        queries=[url],
        platform_priority=["bilibili"],
        provider="bilibili:link",
        inferred_niche="generic",
        confidence=1.0,
        reasoning="Resolve metadata trực tiếp từ link Bilibili; chưa tải video.",
    )


def candidate_from_metadata(metadata: dict, fallback_url: str) -> SearchCandidateResponse:
    bvid = extract_bvid_from_metadata(metadata, fallback_url)
    aid = extract_aid_from_metadata(metadata, fallback_url)
    return SearchCandidateResponse(
        title=str(metadata["title"]),
        title_vi=None,
        url=str(metadata["url"] or fallback_url),
        aid=aid,
        bvid=bvid,
        platform="bilibili",
        duration_seconds=metadata["duration_seconds"] if isinstance(metadata["duration_seconds"], int) else None,
        query="Bilibili link",
        thumbnail_url=metadata["thumbnail_url"] if isinstance(metadata["thumbnail_url"], str) else None,
        description=metadata["description"] if isinstance(metadata["description"], str) else None,
        embed_url=metadata["embed_url"] if isinstance(metadata["embed_url"], str) else None,
        preview_mode="iframe",
        downloadable=True,
    )


def resolve_link_candidate(url: str) -> SearchCandidateResponse:
    metadata: dict | None = None
    series_input = build_series_info_input_from_link(url)
    try:
        data = crawler.fetch_bilibili_series_info(**series_input)
        if data.get("current"):
            current = dict(data["current"])
            return SearchCandidateResponse(**{**current, "title_vi": None})
    except Exception:
        metadata = downloader.extract_video_metadata(url)
        series_input = build_series_info_input_from_metadata(metadata, url)
        if series_input:
            try:
                data = crawler.fetch_bilibili_series_info(**series_input)
                if data.get("current"):
                    current = dict(data["current"])
                    return SearchCandidateResponse(**{**current, "title_vi": None})
            except Exception:
                pass
    if metadata is None:
        metadata = downloader.extract_video_metadata(url)
    return candidate_from_metadata(metadata, url)


def build_series_info_input_from_link(url: str) -> dict[str, object]:
    aid = extract_aid_from_url(url)
    if aid:
        return {"aid": aid}
    bvid = extract_bvid_from_url(url)
    if bvid:
        return {"bvid": bvid}
    return {"url": url}


def build_series_info_input_from_metadata(metadata: dict, fallback_url: str) -> dict[str, object] | None:
    aid = extract_aid_from_metadata(metadata, fallback_url)
    if aid:
        return {"aid": aid}
    bvid = extract_bvid_from_metadata(metadata, fallback_url)
    if bvid:
        return {"bvid": bvid}
    url = metadata.get("url") or fallback_url
    return {"url": str(url)} if url else None


def extract_bvid_from_metadata(metadata: dict, fallback_url: str) -> str | None:
    for value in (metadata.get("url"), metadata.get("embed_url"), fallback_url):
        if not isinstance(value, str):
            continue
        bvid = extract_bvid_from_url(value)
        if bvid:
            return bvid
    return None


def extract_aid_from_metadata(metadata: dict, fallback_url: str) -> int | None:
    for value in (metadata.get("aid"), metadata.get("id"), metadata.get("url"), metadata.get("embed_url"), fallback_url):
        if isinstance(value, int):
            return value if value > 0 else None
        if not isinstance(value, str):
            continue
        aid = extract_aid_from_url(value)
        if aid:
            return aid
    return None


def extract_bvid_from_url(value: str) -> str | None:
    parsed = urlparse(value)
    path_match = re.search(r"(BV[0-9A-Za-z]+)", parsed.path)
    if path_match:
        return path_match.group(1)
    query_match = re.search(r"[?&]bvid=(BV[0-9A-Za-z]+)", value)
    if query_match:
        return query_match.group(1)
    any_match = re.search(r"(BV[0-9A-Za-z]+)", value)
    return any_match.group(1) if any_match else None


def extract_aid_from_url(value: str) -> int | None:
    match = re.search(r"/video/av(\d+)", value, re.I) or re.search(r"[?&]aid=(\d+)", value, re.I)
    return int(match.group(1)) if match else None

