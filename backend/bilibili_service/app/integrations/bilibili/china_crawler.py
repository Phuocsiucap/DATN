from __future__ import annotations

from dataclasses import dataclass, replace
import hashlib
import json
import os
import re
import time
from urllib.parse import parse_qs, quote, quote_plus, urlparse

import httpx


@dataclass(frozen=True)
class CrawlCandidate:
    title: str
    url: str
    platform: str
    duration_seconds: int | None
    aid: int | None = None
    bvid: str | None = None
    query: str = ""
    thumbnail_url: str | None = None
    description: str | None = None
    review_count: int | None = None
    danmaku_count: int | None = None
    episode_count_text: str | None = None
    embed_url: str | None = None
    preview_mode: str = "iframe"
    downloadable: bool = True
    availability_note: str | None = None
    series_key: str | None = None
    series_title: str | None = None
    episode_index: int | None = None
    playlist_size: int | None = None


class ChinaVideoCrawler:
    def search(self, queries: list[str], max_duration_seconds: int) -> CrawlCandidate:
        candidates = self.search_many(queries, ["bilibili"], max_duration_seconds, limit=1)
        if not candidates:
            raise RuntimeError("No Chinese platform video found.")
        return candidates[0]

    def search_many(
        self,
        queries: list[str],
        sources: list[str],
        max_duration_seconds: int,
        limit: int = 12,
    ) -> list[CrawlCandidate]:
        candidates: list[CrawlCandidate] = []
        errors: list[str] = []
        for query in queries:
            if "bilibili" in sources:
                try:
                    candidates.extend(self.search_bilibili_many(query, max_duration_seconds, limit=max(limit, 12)))
                except Exception as exc:
                    errors.append(f"bilibili:{query}: {exc}")
            if len(candidates) >= limit * 2:
                break
        if not candidates and errors:
            raise RuntimeError("No Chinese platform video found. " + " | ".join(errors[-3:]))
        ranked = rank_candidates(dedupe_candidates(candidates))
        expanded = self.expand_series_candidates(ranked[: max(limit, 10)], max_duration_seconds, limit=limit)
        return rank_series_candidates(dedupe_candidates(expanded), limit)

    def search_bilibili(self, query: str, max_duration_seconds: int) -> CrawlCandidate | None:
        candidates = self.search_bilibili_many(query, max_duration_seconds, limit=1)
        return candidates[0] if candidates else None

    def trending_bilibili_many(self, max_duration_seconds: int, limit: int = 30) -> list[CrawlCandidate]:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": "https://www.bilibili.com/",
        }
        cookie_header = os.getenv("ACD_BILIBILI_COOKIE")
        if cookie_header:
            headers["Cookie"] = cookie_header

        candidates: list[CrawlCandidate] = []
        with httpx.Client(timeout=20.0, headers=headers, follow_redirects=True) as client:
            for page in range(1, 4):
                response = client.get(
                    "https://api.bilibili.com/x/web-interface/popular",
                    params={"ps": 20, "pn": page},
                )
                response.raise_for_status()
                payload = response.json()
                items = payload.get("data", {}).get("list") or []
                candidates.extend(parse_bilibili_card_results(items, "Bilibili trending", max_duration_seconds))
                if len(candidates) >= limit:
                    break
        return annotate_playlist_sizes(rank_candidates(dedupe_candidates(candidates)))[:limit]

    def search_bilibili_many(self, query: str, max_duration_seconds: int, limit: int = 12) -> list[CrawlCandidate]:
        candidates: list[CrawlCandidate] = []
        for batch in self.iter_bilibili_search_pages(query, max_duration_seconds, limit=limit):
            candidates.extend(batch)
            if len(candidates) >= limit * 4:
                return rank_candidates(candidates)[:limit]
        return rank_candidates(candidates)[:limit]

    def fetch_bilibili_series_info(
        self,
        *,
        url: str | None = None,
        aid: int | None = None,
        bvid: str | None = None,
    ) -> dict[str, object]:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": url or "https://www.bilibili.com/",
        }
        cookie_header = os.getenv("ACD_BILIBILI_COOKIE")
        if cookie_header:
            headers["Cookie"] = cookie_header

        bvid = bvid or extract_bvid(url or "")
        aid = aid or extract_aid(url or "")
        if not aid and not bvid:
            raise RuntimeError("Missing Bilibili aid/bvid.")

        with httpx.Client(timeout=20.0, headers=headers, follow_redirects=True) as client:
            warm_bilibili_search_session(client, bvid or str(aid or ""))
            mixin_key = get_bilibili_wbi_mixin_key(client)
            payload = fetch_bilibili_view_detail_payload(client, mixin_key, aid=aid, bvid=bvid)
            parsed = parse_bilibili_series_info(payload)
            parsed = enrich_bilibili_series_archives(client, mixin_key, payload, parsed, url or "")
            if int(parsed.get("episode_count") or 0) <= 1:
                fallback_payload = fetch_bilibili_view_payload(client, aid=aid, bvid=bvid)
                fallback_parsed = parse_bilibili_series_info(fallback_payload)
                fallback_parsed = enrich_bilibili_series_archives(client, mixin_key, fallback_payload, fallback_parsed, url or "")
                if int(fallback_parsed.get("episode_count") or 0) > int(parsed.get("episode_count") or 0):
                    parsed = fallback_parsed
            if url and int(parsed.get("episode_count") or 0) <= 1:
                parsed = enrich_bilibili_series_archives_from_page(client, mixin_key, url, parsed)

            query_bvid = extract_query_bvid(url or "")
            if query_bvid and query_bvid != bvid and int(parsed.get("episode_count") or 0) <= 1:
                try:
                    alt_payload = fetch_bilibili_view_detail_payload(client, mixin_key, bvid=query_bvid)
                    alt_parsed = parse_bilibili_series_info(alt_payload)
                    alt_parsed = enrich_bilibili_series_archives(client, mixin_key, alt_payload, alt_parsed, url or "")
                    alt_parsed = enrich_bilibili_series_archives_from_page(client, mixin_key, url or "", alt_parsed)
                    if int(alt_parsed.get("episode_count") or 0) > int(parsed.get("episode_count") or 0):
                        return alt_parsed
                except Exception:
                    pass
            return parsed

    def iter_bilibili_search_pages(self, query: str, max_duration_seconds: int, limit: int = 12):
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Origin": "https://search.bilibili.com",
            "Referer": "https://search.bilibili.com/",
        }
        cookie_header = os.getenv("ACD_BILIBILI_COOKIE")
        if cookie_header:
            headers["Cookie"] = cookie_header
        with httpx.Client(timeout=20.0, headers=headers, follow_redirects=True) as client:
            warm_bilibili_search_session(client, query)
            mixin_key = get_bilibili_wbi_mixin_key(client)
            for page in range(1, 4):
                params = sign_bilibili_wbi_params({
                    "refresh": "true",
                    "_extra": "",
                    "context": "",
                    "page": page,
                    "page_size": 42,
                    "order": "",
                    "pubtime_begin_s": 0,
                    "pubtime_end_s": 0,
                    "duration": "",
                    "from_source": "web_search",
                    "from_spmid": "333.337",
                    "platform": "pc",
                    "highlight": 1,
                    "single_column": 0,
                    "keyword": query,
                    "qv_id": build_bilibili_qv_id(query),
                    "ad_resource": 5646,
                    "source_tag": 3,
                    "web_roll_page": page,
                    "web_location": 1430654,
                }, mixin_key)
                response = client.get(
                    "https://api.bilibili.com/x/web-interface/wbi/search/all/v2",
                    params=params,
                    headers={"Referer": build_bilibili_search_url(query)},
                )
                response.raise_for_status()
                payload = response.json()

                results = extract_bilibili_all_video_results(payload)
                batch = parse_bilibili_search_results(results, query, max_duration_seconds)
                if batch:
                    yield batch

    def expand_series_candidates(
        self,
        seeds: list[CrawlCandidate],
        max_duration_seconds: int,
        *,
        limit: int,
    ) -> list[CrawlCandidate]:
        candidates = list(seeds)
        series_keys = top_series_keys(seeds, max_keys=2)
        for series_key in series_keys:
            for query in build_series_queries(series_key)[:3]:
                try:
                    candidates.extend(self.search_bilibili_many(query, max_duration_seconds, limit=18))
                except Exception:
                    continue
                if len(candidates) >= limit * 3:
                    return candidates
        return candidates

def parse_bilibili_duration(value: str | None) -> int | None:
    if not value:
        return None
    parts = value.split(":")
    try:
        total = 0
        for part in parts:
            total = total * 60 + int(part)
        return total
    except ValueError:
        return None


def parse_bilibili_search_results(items: list[dict], query: str, max_duration_seconds: int) -> list[CrawlCandidate]:
    candidates: list[CrawlCandidate] = []
    for item in items:
        if item.get("type") and item.get("type") != "video":
            continue
        duration = parse_bilibili_duration(item.get("duration"))
        if duration and duration > max_duration_seconds:
            continue
        bvid = item.get("bvid")
        arcurl = item.get("arcurl")
        video_url = f"https://www.bilibili.com/video/{bvid}" if bvid else arcurl
        if not video_url:
            continue
        title = strip_html(item.get("title") or "")
        if not title:
            continue
        series_key, episode_index = infer_series(title)
        candidates.append(CrawlCandidate(
            title=title,
            url=video_url,
            platform="bilibili",
            duration_seconds=duration,
            aid=parse_int(item.get("aid") or item.get("id")),
            bvid=str(bvid) if bvid else None,
            query=query,
            thumbnail_url=normalize_bilibili_image(item.get("pic")),
            description=strip_html(item.get("description") or ""),
            review_count=parse_int(item.get("video_review") or item.get("review")),
            danmaku_count=parse_int(item.get("danmaku")),
            episode_count_text=str(item.get("episode_count_text") or "") or None,
            embed_url=build_bilibili_embed_url(bvid, video_url),
            preview_mode="iframe",
            downloadable=True,
            series_key=series_key,
            series_title=series_key,
            episode_index=episode_index,
        ))
    return candidates


def extract_bilibili_all_video_results(payload: dict) -> list[dict]:
    result_blocks = payload.get("data", {}).get("result") or []
    videos: list[dict] = []
    for block in result_blocks:
        if not isinstance(block, dict):
            continue
        if block.get("result_type") != "video":
            continue
        block_items = block.get("data") or block.get("result") or []
        if isinstance(block_items, list):
            videos.extend(item for item in block_items if isinstance(item, dict))
    return videos


def parse_bilibili_series_info(payload: dict) -> dict[str, object]:
    data = payload.get("data") or {}
    view = data.get("View") or data.get("view") or {}
    pages = view.get("pages") or []
    related = data.get("Related") or data.get("related") or []
    current = candidate_from_view_detail(view)
    ugc_episodes = parse_bilibili_ugc_season_episodes(view)
    page_episodes = parse_bilibili_detail_pages(view, pages)
    episodes = ugc_episodes if len(ugc_episodes) > len(page_episodes) else page_episodes
    related_candidates = parse_bilibili_detail_related(related)
    ugc_season = view.get("ugc_season") if isinstance(view.get("ugc_season"), dict) else {}
    return {
        "aid": parse_int(view.get("aid")),
        "bvid": str(view.get("bvid") or "") or None,
        "title": strip_html(str(view.get("title") or "")),
        "episode_count": len(episodes),
        "related_count": len(related) if isinstance(related, list) else 0,
        "source": "ugc_season" if ugc_episodes and episodes is ugc_episodes else "view_detail",
        "season_id": parse_int(ugc_season.get("id")) if ugc_season else None,
        "season_title": strip_html(str(ugc_season.get("title") or "")) if ugc_season else None,
        "current": current.__dict__ if current else None,
        "episodes": [candidate.__dict__ for candidate in episodes],
        "related": [candidate.__dict__ for candidate in related_candidates],
    }


def fetch_bilibili_view_detail_payload(
    client: httpx.Client,
    mixin_key: str,
    *,
    aid: int | None = None,
    bvid: str | None = None,
) -> dict:
    params: dict[str, object] = {
        "need_view": 1,
        "isGaiaAvoided": "false",
        "web_location": 1315873,
    }
    if aid:
        params["aid"] = aid
    elif bvid:
        params["bvid"] = bvid
    response = client.get(
        "https://api.bilibili.com/x/web-interface/wbi/view/detail",
        params=sign_bilibili_wbi_params(params, mixin_key),
    )
    response.raise_for_status()
    return response.json()


def fetch_bilibili_view_payload(
    client: httpx.Client,
    *,
    aid: int | None = None,
    bvid: str | None = None,
) -> dict:
    params: dict[str, object] = {}
    if aid:
        params["aid"] = aid
    elif bvid:
        params["bvid"] = bvid
    if not params:
        return {"data": {"View": {}}}
    response = client.get(
        "https://api.bilibili.com/x/web-interface/view",
        params=params,
        headers={"Referer": "https://www.bilibili.com/"},
    )
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data") if isinstance(payload, dict) else {}
    return {"data": {"View": data if isinstance(data, dict) else {}}}


def enrich_bilibili_series_archives(
    client: httpx.Client,
    mixin_key: str,
    payload: dict,
    parsed: dict[str, object],
    referer: str,
) -> dict[str, object]:
    data = payload.get("data") or {}
    view = data.get("View") or data.get("view") or {}
    if not isinstance(view, dict):
        return parsed
    ugc_season = view.get("ugc_season") if isinstance(view.get("ugc_season"), dict) else {}
    owner = view.get("owner") if isinstance(view.get("owner"), dict) else {}
    season_id = parse_int(ugc_season.get("id") or parsed.get("season_id"))
    mid = parse_int(owner.get("mid") or ugc_season.get("mid"))
    if not season_id or not mid:
        return parsed

    season_title = strip_html(str(ugc_season.get("title") or parsed.get("season_title") or view.get("title") or "")).strip()
    base_description = strip_html(str(view.get("desc") or ""))
    fallback_referer = referer
    if not fallback_referer:
        view_bvid = str(view.get("bvid") or "")
        fallback_referer = f"https://www.bilibili.com/video/{view_bvid}" if view_bvid else "https://www.bilibili.com/"
    episodes = fetch_bilibili_ugc_season_archives(
        client,
        mixin_key,
        mid=mid,
        season_id=season_id,
        season_title=season_title,
        base_description=base_description,
        referer=fallback_referer,
    )
    if len(episodes) <= len(parsed.get("episodes") or []):
        return parsed

    enriched = dict(parsed)
    enriched["episode_count"] = len(episodes)
    enriched["source"] = "ugc_season_archives"
    enriched["season_id"] = season_id
    enriched["season_title"] = season_title or parsed.get("season_title")
    enriched["episodes"] = [candidate.__dict__ for candidate in episodes]
    return enriched


def enrich_bilibili_series_archives_from_page(
    client: httpx.Client,
    mixin_key: str,
    url: str,
    parsed: dict[str, object],
) -> dict[str, object]:
    hints = fetch_bilibili_page_series_hints(client, url)
    season_id = parse_int(hints.get("season_id") or parsed.get("season_id"))
    mid = parse_int(hints.get("mid"))
    if not season_id or not mid:
        return parsed
    season_title = strip_html(str(hints.get("season_title") or parsed.get("season_title") or parsed.get("title") or "")).strip()
    episodes = fetch_bilibili_ugc_season_archives(
        client,
        mixin_key,
        mid=mid,
        season_id=season_id,
        season_title=season_title,
        base_description="",
        referer=url,
    )
    if len(episodes) <= len(parsed.get("episodes") or []):
        return parsed
    enriched = dict(parsed)
    enriched["episode_count"] = len(episodes)
    enriched["source"] = "ugc_season_archives"
    enriched["season_id"] = season_id
    enriched["season_title"] = season_title or parsed.get("season_title")
    enriched["episodes"] = [candidate.__dict__ for candidate in episodes]
    return enriched


def fetch_bilibili_page_series_hints(client: httpx.Client, url: str) -> dict[str, object]:
    if not url:
        return {}
    response = client.get(url, headers={"Referer": "https://www.bilibili.com/"})
    response.raise_for_status()
    html = response.text
    initial_match = re.search(r"__INITIAL_STATE__=(\{.*?\});\s*\(function", html, re.S)
    state_text = initial_match.group(1) if initial_match else html
    season_id = first_regex_int(state_text, (
        r'"season_id"\s*:\s*(\d+)',
        r'"seasonId"\s*:\s*(\d+)',
        r'season_id[^0-9]{0,20}(\d+)',
    ))
    mid = first_regex_int(state_text, (
        r'"owner"\s*:\s*\{[^{}]*"mid"\s*:\s*(\d+)',
        r'"upData"\s*:\s*\{[^{}]*"mid"\s*:\s*(\d+)',
        r'"mid"\s*:\s*(\d{5,})',
    ))
    season_title = first_regex_text(state_text, (
        r'"season_title"\s*:\s*"([^"]+)"',
        r'"seasonTitle"\s*:\s*"([^"]+)"',
        r'"title"\s*:\s*"([^"]+)"',
    ))
    return {"season_id": season_id, "mid": mid, "season_title": season_title}


def fetch_bilibili_ugc_season_archives(
    client: httpx.Client,
    mixin_key: str,
    *,
    mid: int,
    season_id: int,
    season_title: str,
    base_description: str,
    referer: str,
) -> list[CrawlCandidate]:
    candidates: list[CrawlCandidate] = []
    page_size = 50
    total: int | None = None
    for page_num in range(1, 21):
        params = sign_bilibili_wbi_params({
            "mid": mid,
            "season_id": season_id,
            "sort_reverse": "false",
            "page_num": page_num,
            "page_size": page_size,
            "web_location": 333.999,
        }, mixin_key)
        response = client.get(
            "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list",
            params=params,
            headers={"Referer": referer or "https://www.bilibili.com/"},
        )
        response.raise_for_status()
        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else {}
        if not isinstance(data, dict):
            break
        archives = data.get("archives")
        if not isinstance(archives, list) or not archives:
            break
        for archive in archives:
            if not isinstance(archive, dict):
                continue
            candidate = candidate_from_ugc_archive(archive, season_title, base_description, len(candidates) + 1)
            if candidate:
                candidates.append(candidate)

        page = data.get("page") if isinstance(data.get("page"), dict) else {}
        total = parse_int(page.get("total")) or total
        returned_page_size = parse_int(page.get("page_size")) or page_size
        if total and page_num * returned_page_size >= total:
            break

    playlist_size = len(candidates)
    if playlist_size <= 0:
        return []
    return [replace(candidate, playlist_size=playlist_size) for candidate in candidates]


def candidate_from_view_detail(view: dict) -> CrawlCandidate | None:
    bvid = str(view.get("bvid") or "") or None
    aid = parse_int(view.get("aid"))
    video_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    if not video_url:
        return None
    title = strip_html(str(view.get("title") or ""))
    duration = parse_int(view.get("duration"))
    pages = view.get("pages") or []
    series_key, episode_index = infer_series(title)
    return CrawlCandidate(
        title=title,
        url=video_url,
        platform="bilibili",
        duration_seconds=duration,
        aid=aid,
        bvid=bvid,
        query="view_detail",
        thumbnail_url=normalize_bilibili_image(view.get("pic")),
        description=strip_html(str(view.get("desc") or "")),
        embed_url=build_bilibili_embed_url(bvid, video_url),
        series_key=series_key,
        series_title=series_key,
        episode_index=episode_index,
        playlist_size=len(pages) if isinstance(pages, list) and pages else None,
    )


def parse_bilibili_detail_related(items: object) -> list[CrawlCandidate]:
    if not isinstance(items, list):
        return []
    candidates: list[CrawlCandidate] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        bvid = str(item.get("bvid") or "") or None
        aid = parse_int(item.get("aid"))
        video_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
        title = strip_html(str(item.get("title") or ""))
        if not video_url or not title:
            continue
        series_key, episode_index = infer_series(title)
        candidates.append(CrawlCandidate(
            title=title,
            url=video_url,
            platform="bilibili",
            duration_seconds=parse_int(item.get("duration")),
            aid=aid,
            bvid=bvid,
            query="related",
            thumbnail_url=normalize_bilibili_image(item.get("pic")),
            description=strip_html(str(item.get("desc") or "")),
            review_count=parse_int(item.get("stat", {}).get("danmaku") if isinstance(item.get("stat"), dict) else None),
            embed_url=build_bilibili_embed_url(bvid, video_url),
            series_key=series_key,
            series_title=series_key,
            episode_index=episode_index,
        ))
    return candidates


def parse_bilibili_detail_pages(view: dict, pages: object) -> list[CrawlCandidate]:
    if not isinstance(pages, list) or not pages:
        current = candidate_from_view_detail(view)
        return [current] if current else []

    bvid = str(view.get("bvid") or "") or None
    aid = parse_int(view.get("aid"))
    base_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    if not base_url:
        return []

    base_title = strip_html(str(view.get("title") or "")) or "Bilibili video"
    series_key, _episode_index = infer_series(base_title)
    playlist_size = len(pages)
    candidates: list[CrawlCandidate] = []
    for index, page in enumerate(pages, start=1):
        if not isinstance(page, dict):
            continue
        page_index = parse_int(page.get("page")) or index
        part = strip_html(str(page.get("part") or "")).strip()
        title = part if part and part != base_title else f"{base_title} P{page_index}"
        page_url = f"{base_url}?p={page_index}" if page_index > 1 else base_url
        candidates.append(CrawlCandidate(
            title=title,
            url=page_url,
            platform="bilibili",
            duration_seconds=parse_int(page.get("duration")),
            aid=aid,
            bvid=bvid,
            query="view_detail_pages",
            thumbnail_url=normalize_bilibili_image(view.get("pic")),
            description=strip_html(str(view.get("desc") or "")),
            embed_url=build_bilibili_embed_url(bvid, page_url, page_index),
            series_key=series_key or base_title,
            series_title=series_key or base_title,
            episode_index=page_index,
            playlist_size=playlist_size,
        ))
    return candidates


def parse_bilibili_ugc_season_episodes(view: dict) -> list[CrawlCandidate]:
    ugc_season = view.get("ugc_season")
    if not isinstance(ugc_season, dict):
        return []

    sections = ugc_season.get("sections")
    if not isinstance(sections, list):
        return []

    season_title = strip_html(str(ugc_season.get("title") or view.get("title") or "")).strip()
    base_description = strip_html(str(view.get("desc") or ""))
    candidates: list[CrawlCandidate] = []

    for section in sections:
        if not isinstance(section, dict):
            continue
        episodes = section.get("episodes")
        if not isinstance(episodes, list):
            continue
        for episode in episodes:
            if not isinstance(episode, dict):
                continue
            candidate = candidate_from_ugc_episode(episode, season_title, base_description, len(candidates) + 1)
            if candidate:
                candidates.append(candidate)

    playlist_size = len(candidates)
    if playlist_size <= 0:
        return []
    return [replace(candidate, playlist_size=playlist_size) for candidate in candidates]


def candidate_from_ugc_episode(
    episode: dict,
    season_title: str,
    base_description: str,
    fallback_index: int,
) -> CrawlCandidate | None:
    bvid = str(episode.get("bvid") or "") or None
    aid = parse_int(episode.get("aid"))
    arc = episode.get("arc") if isinstance(episode.get("arc"), dict) else {}
    page_index = parse_int(episode.get("page")) or parse_int(episode.get("index")) or None
    title = strip_html(str(episode.get("title") or arc.get("title") or "")).strip()
    if not title:
        title = f"{season_title} P{page_index}" if page_index else season_title
    video_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    if not video_url:
        return None
    if page_index and page_index > 1:
        video_url = f"{video_url}?p={page_index}"

    duration = parse_int(episode.get("duration")) or parse_int(arc.get("duration"))
    stat = arc.get("stat") if isinstance(arc.get("stat"), dict) else {}
    series_key, inferred_index = infer_series(title)
    episode_index = page_index or inferred_index or fallback_index
    return CrawlCandidate(
        title=title,
        url=video_url,
        platform="bilibili",
        duration_seconds=duration,
        aid=aid,
        bvid=bvid,
        query="ugc_season",
        thumbnail_url=normalize_bilibili_image(str(episode.get("cover") or arc.get("pic") or "")),
        description=strip_html(str(arc.get("desc") or base_description)),
        review_count=parse_int(stat.get("view")),
        danmaku_count=parse_int(stat.get("danmaku")),
        embed_url=build_bilibili_embed_url(bvid, video_url, page_index),
        series_key=series_key or season_title,
        series_title=season_title or series_key,
        episode_index=episode_index,
    )


def candidate_from_ugc_archive(
    archive: dict,
    season_title: str,
    base_description: str,
    fallback_index: int,
) -> CrawlCandidate | None:
    arc = archive.get("arc") if isinstance(archive.get("arc"), dict) else {}
    source = arc or archive
    bvid = str(source.get("bvid") or archive.get("bvid") or "") or None
    aid = parse_int(source.get("aid") or archive.get("aid"))
    video_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    if not video_url:
        return None
    title = strip_html(str(source.get("title") or archive.get("title") or "")).strip()
    if not title:
        title = f"{season_title} EP {fallback_index}".strip()
    duration = parse_int(source.get("duration") or archive.get("duration"))
    stat = source.get("stat") if isinstance(source.get("stat"), dict) else {}
    series_key, inferred_index = infer_series(title)
    return CrawlCandidate(
        title=title,
        url=video_url,
        platform="bilibili",
        duration_seconds=duration,
        aid=aid,
        bvid=bvid,
        query="ugc_season_archives",
        thumbnail_url=normalize_bilibili_image(str(source.get("pic") or archive.get("pic") or archive.get("cover") or "")),
        description=strip_html(str(source.get("desc") or archive.get("desc") or base_description)),
        review_count=parse_int(stat.get("view") or source.get("play") or archive.get("play")),
        danmaku_count=parse_int(stat.get("danmaku") or source.get("danmaku") or archive.get("danmaku")),
        embed_url=build_bilibili_embed_url(bvid, video_url),
        series_key=series_key or season_title,
        series_title=season_title or series_key,
        episode_index=inferred_index or fallback_index,
    )


def first_regex_int(value: str, patterns: tuple[str, ...]) -> int | None:
    for pattern in patterns:
        match = re.search(pattern, value, re.S)
        if match:
            return parse_int(match.group(1))
    return None


def first_regex_text(value: str, patterns: tuple[str, ...]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, value, re.S)
        if match:
            return decode_jsonish_text(match.group(1))
    return None


def decode_jsonish_text(value: str) -> str:
    try:
        return str(json.loads(f'"{value}"'))
    except (TypeError, ValueError, json.JSONDecodeError):
        return value


def parse_int(value: object) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_bilibili_card_results(items: list[dict], query: str, max_duration_seconds: int) -> list[CrawlCandidate]:
    candidates: list[CrawlCandidate] = []
    for item in items:
        duration_value = item.get("duration")
        duration = int(duration_value) if isinstance(duration_value, (int, float)) else parse_bilibili_duration(str(duration_value or ""))
        if duration and duration > max_duration_seconds:
            continue
        bvid = item.get("bvid")
        video_url = f"https://www.bilibili.com/video/{bvid}" if bvid else item.get("short_link_v2") or item.get("uri")
        if not video_url:
            continue
        title = strip_html(str(item.get("title") or ""))
        series_key, episode_index = infer_series(title)
        candidates.append(CrawlCandidate(
            title=title,
            url=str(video_url),
            platform="bilibili",
            duration_seconds=duration,
            aid=parse_int(item.get("aid")),
            bvid=str(bvid) if bvid else None,
            query=query,
            thumbnail_url=normalize_bilibili_image(item.get("pic")),
            description=strip_html(str(item.get("desc") or item.get("description") or "")),
            review_count=parse_int(item.get("video_review") or item.get("review")),
            danmaku_count=parse_int(item.get("danmaku")),
            episode_count_text=str(item.get("episode_count_text") or "") or None,
            embed_url=build_bilibili_embed_url(str(bvid) if bvid else None, str(video_url)),
            preview_mode="iframe",
            downloadable=True,
            series_key=series_key,
            series_title=series_key,
            episode_index=episode_index,
        ))
    return candidates


def strip_html(value: str) -> str:
    return value.replace("<em class=\"keyword\">", "").replace("</em>", "")


def normalize_bilibili_image(value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith("//"):
        return f"https:{value}"
    return value


def build_bilibili_embed_url(bvid: str | None, fallback_url: str | None, page: int | None = None) -> str | None:
    if bvid:
        page_param = f"&page={page}" if page and page > 1 else ""
        return f"https://player.bilibili.com/player.html?bvid={quote(bvid)}{page_param}&autoplay=0"
    if fallback_url:
        match = re.search(r"/video/(BV[0-9A-Za-z]+)", fallback_url)
        if match:
            return f"https://player.bilibili.com/player.html?bvid={quote(match.group(1))}&autoplay=0"
    return fallback_url


def extract_aid(url: str) -> int | None:
    match = re.search(r"/video/av(\d+)", url)
    return int(match.group(1)) if match else None


def extract_bvid(url: str) -> str | None:
    match = re.search(r"(BV[0-9A-Za-z]+)", url)
    return match.group(1) if match else None


def extract_query_bvid(url: str) -> str | None:
    query_bvid = parse_qs(urlparse(url).query).get("bvid")
    if query_bvid and query_bvid[0].startswith("BV"):
        return query_bvid[0]
    return None


def build_bilibili_search_url(query: str) -> str:
    return f"https://search.bilibili.com/all?keyword={quote_plus(query)}"


def build_bilibili_qv_id(query: str) -> str:
    raw = f"{query}:{time.time_ns()}".encode("utf-8")
    return hashlib.md5(raw).hexdigest()


def warm_bilibili_search_session(client: httpx.Client, query: str, *, force: bool = False) -> None:
    if client.cookies and not force:
        return
    for url in ("https://www.bilibili.com/", build_bilibili_search_url(query)):
        try:
            client.get(url)
        except httpx.HTTPError:
            continue


WBI_MIXIN_TABLE = [
    46, 47, 18, 2, 53, 8, 23, 32,
    15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19,
    29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61,
    26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63,
    57, 62, 11, 36, 20, 34, 44, 52,
]


def get_bilibili_wbi_mixin_key(client: httpx.Client) -> str:
    response = client.get("https://api.bilibili.com/x/web-interface/nav")
    response.raise_for_status()
    data = response.json().get("data", {})
    wbi_img = data.get("wbi_img") or {}
    img_key = extract_bilibili_wbi_key(str(wbi_img.get("img_url") or ""))
    sub_key = extract_bilibili_wbi_key(str(wbi_img.get("sub_url") or ""))
    raw = img_key + sub_key
    if len(raw) < 64:
        raise RuntimeError("Bilibili WBI keys are unavailable.")
    return "".join(raw[index] for index in WBI_MIXIN_TABLE)[:32]


def extract_bilibili_wbi_key(url: str) -> str:
    filename = urlparse(url).path.rsplit("/", 1)[-1]
    return filename.split(".", 1)[0]


def sign_bilibili_wbi_params(params: dict[str, object], mixin_key: str) -> dict[str, object]:
    signed: dict[str, object] = {**params, "wts": int(time.time())}
    filtered: dict[str, str] = {}
    for key, value in signed.items():
        text = re.sub(r"[!'()*]", "", str(value))
        filtered[key] = text
    query = "&".join(f"{quote_plus(key)}={quote_plus(filtered[key])}" for key in sorted(filtered))
    filtered["w_rid"] = hashlib.md5((query + mixin_key).encode("utf-8")).hexdigest()
    return filtered


def infer_series(title: str) -> tuple[str | None, int | None]:
    normalized = re.sub(r"\s+", "", title)
    episode = infer_episode_index(normalized)

    series = normalize_series_title(normalized)
    return (series or None), episode


def infer_episode_index(normalized_title: str) -> int | None:
    patterns = [
        r"(?:第|EP\.?|ep|集|part|Part|P)(\d{1,4})(?:集|话|話|期|部|$)",
        r"(?:^|[^0-9])(\d{1,4})[/-](\d{1,4})(?:[^0-9]|$)",
        r"(?:上|中|下)(?:集|部|篇)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized_title, re.I)
        if match:
            if match.group(0).startswith("上"):
                return 1
            if match.group(0).startswith("中"):
                return 2
            if match.group(0).startswith("下"):
                return 3
            return int(match.group(1))
    return None


def normalize_series_title(normalized: str) -> str:
    series = re.sub(r"【.*?】|\[.*?\]|（.*?）|\(.*?\)", "", normalized)
    series = re.sub(r"(?:第|EP\.?|ep|集|part|Part|P)?\d{1,4}(?:集|话|話|期|部)?", "", series)
    series = re.sub(r"\d{1,4}[/-]\d{1,4}", "", series)
    series = re.sub(r"(完整版|全集|合集|大结局|大結局|一口气看完|短剧|短劇|电视剧|電影|电影|高清|超清|解说|剪辑|上集|中集|下集|上部|中部|下部|上|中|下|完结|完結)", "", series)
    series = re.sub(r"[：:，,。！!？?《》“”\"'、]+", "", series)
    return series[:32].strip(" -_·|")


def dedupe_candidates(candidates: list[CrawlCandidate]) -> list[CrawlCandidate]:
    seen = set()
    out = []
    for candidate in candidates:
        if candidate.url in seen:
            continue
        seen.add(candidate.url)
        out.append(candidate)
    return out


def rank_candidates(candidates: list[CrawlCandidate]) -> list[CrawlCandidate]:
    scored = [(candidate_relevance(candidate), index, candidate) for index, candidate in enumerate(candidates)]
    positive = [item for item in scored if item[0] > 0]
    if not positive:
        return candidates
    positive.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    return [candidate for _score, _index, candidate in positive]


def candidate_relevance(candidate: CrawlCandidate) -> int:
    query_terms = query_core_terms(candidate.query)
    if not query_terms:
        return 1
    haystack = f"{candidate.title} {candidate.description or ''} {candidate.series_title or ''}".lower()
    score = 0
    for term in query_terms:
        term_lower = term.lower()
        if term_lower in haystack:
            score += 10 if len(term) >= 3 else 4
    if candidate.series_key:
        score += 4
    if candidate.episode_index is not None:
        score += 3
    if candidate.playlist_size and candidate.playlist_size > 1:
        score += min(candidate.playlist_size, 12)
    if candidate.duration_seconds and 20 <= candidate.duration_seconds <= 900:
        score += 1
    return score


def top_series_keys(candidates: list[CrawlCandidate], max_keys: int) -> list[str]:
    counts: dict[str, int] = {}
    for candidate in candidates:
        if not candidate.series_key or len(candidate.series_key) < 4:
            continue
        counts[candidate.series_key] = counts.get(candidate.series_key, 0) + 1
    keys = sorted(counts, key=lambda key: (counts[key], len(key)), reverse=True)
    if not keys:
        keys = []
        for candidate in candidates[:max_keys]:
            if candidate.series_key and candidate.series_key not in keys and len(candidate.series_key) >= 4:
                keys.append(candidate.series_key)
    return keys[:max_keys]


def build_series_queries(series_key: str) -> list[str]:
    base = series_key.strip()
    return dedupe_terms([
        base,
        f"{base} 全集",
        f"{base} 合集",
        f"{base} 第1集",
        f"{base} 第2集",
        f"{base} 第3集",
        f"{base} 第4集",
        f"{base} 连续剧",
        f"{base} 短剧",
        f"{base} 大结局",
        f"{base} 完整版",
    ])


def annotate_playlist_sizes(candidates: list[CrawlCandidate]) -> list[CrawlCandidate]:
    counts: dict[str, int] = {}
    for candidate in candidates:
        if candidate.series_key:
            counts[candidate.series_key] = counts.get(candidate.series_key, 0) + 1
    return [
        replace(candidate, playlist_size=counts.get(candidate.series_key) if candidate.series_key else None)
        for candidate in candidates
    ]


def rank_series_candidates(candidates: list[CrawlCandidate], limit: int) -> list[CrawlCandidate]:
    annotated = annotate_playlist_sizes(rank_candidates(dedupe_candidates(candidates)))
    grouped: dict[str, list[CrawlCandidate]] = {}
    singles: list[CrawlCandidate] = []
    for candidate in annotated:
        if candidate.series_key and candidate.playlist_size and candidate.playlist_size > 1:
            grouped.setdefault(candidate.series_key, []).append(candidate)
        else:
            singles.append(candidate)

    if not grouped:
        return annotated[:limit]

    def episode_sort_key(candidate: CrawlCandidate) -> tuple[int, int, str]:
        episode = candidate.episode_index if candidate.episode_index is not None else 9999
        return episode, candidate.duration_seconds or 0, candidate.title

    def group_score(items: list[CrawlCandidate]) -> tuple[int, int, int]:
        playlist_size = max((item.playlist_size or 0) for item in items)
        episodes = len({item.episode_index for item in items if item.episode_index is not None})
        relevance = sum(candidate_relevance(item) for item in items)
        return playlist_size, episodes, relevance

    selected: list[CrawlCandidate] = []
    for group in sorted(grouped.values(), key=group_score, reverse=True):
        selected.extend(sorted(group, key=episode_sort_key))
        if len(selected) >= limit:
            return selected[:limit]

    selected.extend(singles)
    return selected[:limit]


def query_core_terms(query: str) -> list[str]:
    stopwords = {
        "短视频", "热门", "合集", "完整版", "测评", "开箱", "好物", "体验", "教程",
        "推荐", "安装", "使用", "技巧", "游戏集锦", "精彩操作", "教学", "手游",
        "家居", "家用", "生活", "数码", "B站",
    }
    raw_terms = re.findall(r"[A-Za-z0-9+#.]+|[\u4e00-\u9fff]{2,}", query)
    terms: list[str] = []
    for term in raw_terms:
        if term in stopwords:
            continue
        if len(term) > 12 and all("\u4e00" <= char <= "\u9fff" for char in term):
            terms.extend(split_chinese_compound(term))
            continue
        terms.append(term)
    return dedupe_terms(terms)


def split_chinese_compound(term: str) -> list[str]:
    known = [
        "绝地求生", "和平精英", "吃鸡", "苹果手机", "木质置物架", "置物架",
        "收纳架", "家居好物", "小家电", "家用电器", "霸道总裁", "短剧",
    ]
    hits = [item for item in known if item in term]
    return hits or [term]


def dedupe_terms(values: list[str]) -> list[str]:
    seen = set()
    out = []
    for value in values:
        if value not in seen:
            out.append(value)
            seen.add(value)
    return out
