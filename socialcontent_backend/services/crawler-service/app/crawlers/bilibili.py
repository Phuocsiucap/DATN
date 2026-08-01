from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, quote, quote_plus, urlparse

import httpx

from app.crawlers.base import BaseCrawler


@dataclass(frozen=True)
class BilibiliCandidate:
    title: str
    url: str
    platform: str = "bilibili"
    duration_seconds: int | None = None
    aid: int | None = None
    bvid: str | None = None
    cid: int | None = None
    query: str = ""
    thumbnail_url: str | None = None
    description: str | None = None
    review_count: int | None = None
    danmaku_count: int | None = None
    embed_url: str | None = None
    series_key: str | None = None
    series_title: str | None = None
    episode_index: int | None = None
    playlist_size: int | None = None


class BilibiliCrawler(BaseCrawler):
    name = "bilibili-metadata-crawler"
    content_type = "VIDEO"

    def __init__(self) -> None:
        self.last_errors: list[dict[str, Any]] = []

    def build_search_url(self, keywords: list[str]) -> str:
        return f"https://search.bilibili.com/all?keyword={quote_plus(' '.join(keywords))}"

    def fetch_many(
        self,
        *,
        job_id: str,
        task_id: str,
        source_type: str,
        source_url: str | None,
        keywords: list[str],
        configuration: dict[str, Any],
    ) -> list[dict[str, Any]]:
        self.last_errors = []
        limit = max(1, min(int(configuration.get("max_items", configuration.get("limit", 10)) or 10), 50))
        max_duration_seconds = int(configuration.get("max_duration_seconds", 7200) or 7200)
        queries = self._queries(source_url, keywords, configuration)
        headers = self._headers(configuration)

        documents: list[dict[str, Any]] = []
        seen_keys: set[str] = set()
        with httpx.Client(timeout=float(configuration.get("timeout_seconds", 20)), headers=headers, follow_redirects=True) as client:
            warm_bilibili_search_session(client, " ".join(queries) or "bilibili")
            mixin_key = get_bilibili_wbi_mixin_key(client)

            if source_url and (extract_bvid(source_url) or extract_aid(source_url) or extract_query_bvid(source_url)):
                info = self.fetch_series_info(client, mixin_key, url=source_url)
                return [self.to_raw_document(job_id, task_id, source_type, info, source_url=source_url, keyword=None)]

            candidates = self.search_many(client, mixin_key, queries, max_duration_seconds=max_duration_seconds, limit=limit)
            for candidate in candidates:
                key = candidate.bvid or str(candidate.aid or "") or candidate.url
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                try:
                    info = self.fetch_series_info(client, mixin_key, url=candidate.url, aid=candidate.aid, bvid=candidate.bvid)
                except Exception as exc:
                    self.last_errors.append({"url": candidate.url, "stage": "FETCH_SERIES_INFO", "error": str(exc)})
                    info = self.series_info_from_candidate(candidate)
                documents.append(self.to_raw_document(job_id, task_id, source_type, info, source_url=candidate.url, keyword=candidate.query))
                if len(documents) >= limit:
                    break
        return documents

    def search_many(
        self,
        client: httpx.Client,
        mixin_key: str,
        queries: list[str],
        *,
        max_duration_seconds: int,
        limit: int,
    ) -> list[BilibiliCandidate]:
        candidates: list[BilibiliCandidate] = []
        for query in queries:
            try:
                candidates.extend(self.search_bilibili_many(client, mixin_key, query, max_duration_seconds, limit=max(limit, 12)))
            except Exception as exc:
                self.last_errors.append({"query": query, "stage": "SEARCH", "error": str(exc)})
            if len(candidates) >= limit * 3:
                break
        ranked = rank_candidates(dedupe_candidates(candidates))
        expanded = self.expand_series_candidates(client, mixin_key, ranked[: max(limit, 10)], max_duration_seconds, limit=limit)
        return rank_series_candidates(dedupe_candidates(expanded), limit)

    def search_bilibili_many(
        self,
        client: httpx.Client,
        mixin_key: str,
        query: str,
        max_duration_seconds: int,
        limit: int,
    ) -> list[BilibiliCandidate]:
        candidates: list[BilibiliCandidate] = []
        for page in range(1, 4):
            params = sign_bilibili_wbi_params(
                {
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
                },
                mixin_key,
            )
            response = client.get(
                "https://api.bilibili.com/x/web-interface/wbi/search/all/v2",
                params=params,
                headers={"Referer": build_bilibili_search_url(query)},
            )
            response.raise_for_status()
            results = extract_bilibili_all_video_results(response.json())
            candidates.extend(parse_bilibili_search_results(results, query, max_duration_seconds))
            if len(candidates) >= limit * 2:
                break
        return rank_candidates(candidates)[:limit]

    def expand_series_candidates(
        self,
        client: httpx.Client,
        mixin_key: str,
        seeds: list[BilibiliCandidate],
        max_duration_seconds: int,
        *,
        limit: int,
    ) -> list[BilibiliCandidate]:
        candidates = list(seeds)
        for series_key in top_series_keys(seeds, max_keys=2):
            for query in build_series_queries(series_key)[:3]:
                try:
                    candidates.extend(self.search_bilibili_many(client, mixin_key, query, max_duration_seconds, limit=18))
                except Exception as exc:
                    self.last_errors.append({"query": query, "stage": "EXPAND_SERIES", "error": str(exc)})
                    continue
                if len(candidates) >= limit * 3:
                    return candidates
        return candidates

    def fetch_series_info(
        self,
        client: httpx.Client,
        mixin_key: str,
        *,
        url: str | None = None,
        aid: int | None = None,
        bvid: str | None = None,
    ) -> dict[str, Any]:
        bvid = bvid or extract_bvid(url or "")
        aid = aid or extract_aid(url or "")
        query_bvid = extract_query_bvid(url or "")
        if not aid and not bvid and query_bvid:
            bvid = query_bvid
        if not aid and not bvid:
            raise RuntimeError("Missing Bilibili aid/bvid.")

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
        if query_bvid and query_bvid != bvid and int(parsed.get("episode_count") or 0) <= 1:
            try:
                alt_payload = fetch_bilibili_view_detail_payload(client, mixin_key, bvid=query_bvid)
                alt_parsed = parse_bilibili_series_info(alt_payload)
                alt_parsed = enrich_bilibili_series_archives(client, mixin_key, alt_payload, alt_parsed, url or "")
                alt_parsed = enrich_bilibili_series_archives_from_page(client, mixin_key, url or "", alt_parsed)
                if int(alt_parsed.get("episode_count") or 0) > int(parsed.get("episode_count") or 0):
                    parsed = alt_parsed
            except Exception as exc:
                self.last_errors.append({"url": url, "stage": "ALT_QUERY_BVID", "error": str(exc)})
        return parsed

    def series_info_from_candidate(self, candidate: BilibiliCandidate) -> dict[str, Any]:
        current = candidate_to_dict(candidate)
        return {
            "aid": candidate.aid,
            "bvid": candidate.bvid,
            "title": candidate.title,
            "episode_count": candidate.playlist_size or 1,
            "related_count": 0,
            "source": "search_candidate",
            "season_id": None,
            "season_title": candidate.series_title,
            "current": current,
            "episodes": [current],
            "related": [],
        }

    def to_raw_document(self, job_id: str, task_id: str, source_type: str, info: dict[str, Any], *, source_url: str | None, keyword: str | None) -> dict[str, Any]:
        current = info.get("current") if isinstance(info.get("current"), dict) else {}
        episodes = info.get("episodes") if isinstance(info.get("episodes"), list) else []
        title = str(current.get("title") or info.get("title") or source_url or "Bilibili metadata").strip()
        description = str(current.get("description") or "").strip()
        episode_count = int(info.get("episode_count") or len(episodes) or 1)
        url = str(current.get("url") or source_url or "").strip()
        content_lines = [title, description, f"Số tập: {episode_count}"]
        if keyword:
            content_lines.append(f"Từ khóa crawl: {keyword}")
        if episodes:
            content_lines.append(
                "Danh sách tập: "
                + "; ".join(
                    f"{episode.get('episode_index') or index + 1}. {episode.get('title') or 'Episode'}"
                    for index, episode in enumerate(episodes[:50])
                    if isinstance(episode, dict)
                )
            )

        raw_json = {
            "title": title,
            "description": description,
            "author": "",
            "url": url,
            "text": "\n".join(part for part in content_lines if part),
            "aid": info.get("aid") or current.get("aid"),
            "bvid": info.get("bvid") or current.get("bvid"),
            "thumbnail_url": current.get("thumbnail_url"),
            "embed_url": current.get("embed_url"),
            "duration_seconds": current.get("duration_seconds"),
            "review_count": current.get("review_count"),
            "danmaku_count": current.get("danmaku_count"),
            "season_id": info.get("season_id"),
            "season_title": info.get("season_title"),
            "series_title": info.get("season_title") or current.get("series_title"),
            "series_source": info.get("source"),
            "episode_count": episode_count,
            "episodes": episodes,
            "related": info.get("related") if isinstance(info.get("related"), list) else [],
            "crawl_keyword": keyword,
            "metadata_only": True,
        }
        media = []
        if current.get("thumbnail_url"):
            media.append({"media_type": "IMAGE", "source_url": current["thumbnail_url"], "role": "thumbnail"})
        if url:
            media.append({"media_type": "VIDEO_REFERENCE", "source_url": url, "role": "source_reference"})
        content_type = "PLAYLIST" if episode_count > 1 else "VIDEO"
        source_external_id = bilibili_source_external_id(raw_json, url, content_type)
        return {
            "job_id": job_id,
            "task_id": task_id,
            "source_type": source_type,
            "source_external_id": source_external_id,
            "source_url": url,
            "content_type": content_type,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "http": {"status_code": 200, "headers": {}, "response_time_ms": None},
            "raw": {"html": None, "json": raw_json, "text": raw_json["text"]},
            "media": media,
            "crawler": {"name": self.name, "version": self.version, "metadata_only": True},
            "checksum": self.checksum(raw_json),
            "status": "RAW",
        }

    def _queries(self, source_url: str | None, keywords: list[str], configuration: dict[str, Any]) -> list[str]:
        if source_url and (extract_bvid(source_url) or extract_aid(source_url) or extract_query_bvid(source_url)):
            return [source_url]
        configured = configuration.get("queries")
        if isinstance(configured, str):
            queries = [item.strip() for item in configured.split(",") if item.strip()]
        elif isinstance(configured, list):
            queries = [str(item).strip() for item in configured if str(item).strip()]
        else:
            queries = []
        queries.extend(str(item).strip() for item in keywords if str(item).strip())
        return dedupe_terms(queries or ["短剧", "霸道总裁 短剧", "短剧 全集"])

    def _headers(self, configuration: dict[str, Any]) -> dict[str, str]:
        headers = {
            "User-Agent": configuration.get(
                "user_agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            ),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": "https://www.bilibili.com/",
        }
        cookie_header = configuration.get("cookie") or os.getenv("ACD_BILIBILI_COOKIE")
        if cookie_header:
            headers["Cookie"] = str(cookie_header)
        return headers


def parse_bilibili_series_info(payload: dict) -> dict[str, Any]:
    data = payload.get("data") or {}
    view = data.get("View") or data.get("view") or {}
    pages = view.get("pages") or []
    related = data.get("Related") or data.get("related") or []
    current = candidate_from_view_detail(view)
    ugc_episodes = parse_bilibili_ugc_season_episodes(view)
    page_episodes = parse_bilibili_detail_pages(view, pages)
    episodes = ugc_episodes if len(ugc_episodes) > len(page_episodes) else page_episodes
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
        "current": candidate_to_dict(current) if current else None,
        "episodes": [candidate_to_dict(candidate) for candidate in episodes],
        "related": [candidate_to_dict(candidate) for candidate in parse_bilibili_detail_related(related)],
    }


def bilibili_source_external_id(raw_json: dict[str, Any], url: str, content_type: str) -> str:
    if content_type == "PLAYLIST":
        season_id = raw_json.get("season_id")
        if season_id:
            return f"season:{season_id}"
        series_title = str(raw_json.get("series_title") or raw_json.get("season_title") or "").strip()
        if series_title:
            return "series:" + hashlib.sha256(series_title.encode("utf-8")).hexdigest()
    return str(raw_json.get("bvid") or raw_json.get("aid") or hashlib.sha256(url.encode("utf-8")).hexdigest())


def fetch_bilibili_view_detail_payload(client: httpx.Client, mixin_key: str, *, aid: int | None = None, bvid: str | None = None) -> dict:
    params: dict[str, object] = {"need_view": 1, "isGaiaAvoided": "false", "web_location": 1315873}
    if aid:
        params["aid"] = aid
    elif bvid:
        params["bvid"] = bvid
    response = client.get("https://api.bilibili.com/x/web-interface/wbi/view/detail", params=sign_bilibili_wbi_params(params, mixin_key))
    response.raise_for_status()
    return response.json()


def fetch_bilibili_view_payload(client: httpx.Client, *, aid: int | None = None, bvid: str | None = None) -> dict:
    params: dict[str, object] = {}
    if aid:
        params["aid"] = aid
    elif bvid:
        params["bvid"] = bvid
    if not params:
        return {"data": {"View": {}}}
    response = client.get("https://api.bilibili.com/x/web-interface/view", params=params, headers={"Referer": "https://www.bilibili.com/"})
    response.raise_for_status()
    data = response.json().get("data") or {}
    return {"data": {"View": data if isinstance(data, dict) else {}}}


def enrich_bilibili_series_archives(client: httpx.Client, mixin_key: str, payload: dict, parsed: dict[str, Any], referer: str) -> dict[str, Any]:
    view = (payload.get("data") or {}).get("View") or (payload.get("data") or {}).get("view") or {}
    if not isinstance(view, dict):
        return parsed
    ugc_season = view.get("ugc_season") if isinstance(view.get("ugc_season"), dict) else {}
    owner = view.get("owner") if isinstance(view.get("owner"), dict) else {}
    season_id = parse_int(ugc_season.get("id") or parsed.get("season_id"))
    mid = parse_int(owner.get("mid") or ugc_season.get("mid"))
    if not season_id or not mid:
        return parsed
    season_title = strip_html(str(ugc_season.get("title") or parsed.get("season_title") or view.get("title") or "")).strip()
    episodes = fetch_bilibili_ugc_season_archives(
        client,
        mixin_key,
        mid=mid,
        season_id=season_id,
        season_title=season_title,
        base_description=strip_html(str(view.get("desc") or "")),
        referer=referer or f"https://www.bilibili.com/video/{view.get('bvid') or ''}",
    )
    if len(episodes) <= len(parsed.get("episodes") or []):
        return parsed
    enriched = dict(parsed)
    enriched.update({"episode_count": len(episodes), "source": "ugc_season_archives", "season_id": season_id, "season_title": season_title, "episodes": [candidate_to_dict(item) for item in episodes]})
    return enriched


def enrich_bilibili_series_archives_from_page(client: httpx.Client, mixin_key: str, url: str, parsed: dict[str, Any]) -> dict[str, Any]:
    hints = fetch_bilibili_page_series_hints(client, url)
    season_id = parse_int(hints.get("season_id") or parsed.get("season_id"))
    mid = parse_int(hints.get("mid"))
    if not season_id or not mid:
        return parsed
    season_title = strip_html(str(hints.get("season_title") or parsed.get("season_title") or parsed.get("title") or "")).strip()
    episodes = fetch_bilibili_ugc_season_archives(client, mixin_key, mid=mid, season_id=season_id, season_title=season_title, base_description="", referer=url)
    if len(episodes) <= len(parsed.get("episodes") or []):
        return parsed
    enriched = dict(parsed)
    enriched.update({"episode_count": len(episodes), "source": "ugc_season_archives", "season_id": season_id, "season_title": season_title, "episodes": [candidate_to_dict(item) for item in episodes]})
    return enriched


def fetch_bilibili_page_series_hints(client: httpx.Client, url: str) -> dict[str, object]:
    if not url:
        return {}
    response = client.get(url, headers={"Referer": "https://www.bilibili.com/"})
    response.raise_for_status()
    html = response.text
    initial_match = re.search(r"__INITIAL_STATE__=(\{.*?\});\s*\(function", html, re.S)
    state_text = initial_match.group(1) if initial_match else html
    return {
        "season_id": first_regex_int(state_text, (r'"season_id"\s*:\s*(\d+)', r'"seasonId"\s*:\s*(\d+)', r"season_id[^0-9]{0,20}(\d+)")),
        "mid": first_regex_int(state_text, (r'"owner"\s*:\s*\{[^{}]*"mid"\s*:\s*(\d+)', r'"upData"\s*:\s*\{[^{}]*"mid"\s*:\s*(\d+)', r'"mid"\s*:\s*(\d{5,})')),
        "season_title": first_regex_text(state_text, (r'"season_title"\s*:\s*"([^"]+)"', r'"seasonTitle"\s*:\s*"([^"]+)"', r'"title"\s*:\s*"([^"]+)"')),
    }


def fetch_bilibili_ugc_season_archives(client: httpx.Client, mixin_key: str, *, mid: int, season_id: int, season_title: str, base_description: str, referer: str) -> list[BilibiliCandidate]:
    candidates: list[BilibiliCandidate] = []
    page_size = 50
    total: int | None = None
    for page_num in range(1, 21):
        params = sign_bilibili_wbi_params({"mid": mid, "season_id": season_id, "sort_reverse": "false", "page_num": page_num, "page_size": page_size, "web_location": 333.999}, mixin_key)
        response = client.get("https://api.bilibili.com/x/polymer/web-space/seasons_archives_list", params=params, headers={"Referer": referer or "https://www.bilibili.com/"})
        response.raise_for_status()
        data = response.json().get("data") or {}
        archives = data.get("archives")
        if not isinstance(archives, list) or not archives:
            break
        for archive in archives:
            if isinstance(archive, dict):
                candidate = candidate_from_ugc_archive(archive, season_title, base_description, len(candidates) + 1)
                if candidate:
                    candidates.append(candidate)
        page = data.get("page") if isinstance(data.get("page"), dict) else {}
        total = parse_int(page.get("total")) or total
        returned_page_size = parse_int(page.get("page_size")) or page_size
        if total and page_num * returned_page_size >= total:
            break
    return [replace(candidate, playlist_size=len(candidates)) for candidate in candidates] if candidates else []


def candidate_from_view_detail(view: dict) -> BilibiliCandidate | None:
    bvid = str(view.get("bvid") or "") or None
    aid = parse_int(view.get("aid"))
    video_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    if not video_url:
        return None
    title = strip_html(str(view.get("title") or ""))
    series_key, episode_index = infer_series(title)
    stat = view.get("stat") if isinstance(view.get("stat"), dict) else {}
    pages = view.get("pages") or []
    return BilibiliCandidate(
        title=title,
        url=video_url,
        duration_seconds=parse_int(view.get("duration")),
        aid=aid,
        bvid=bvid,
        cid=parse_int(view.get("cid")),
        query="view_detail",
        thumbnail_url=normalize_bilibili_image(view.get("pic")),
        description=strip_html(str(view.get("desc") or "")),
        review_count=parse_int(stat.get("view")),
        danmaku_count=parse_int(stat.get("danmaku")),
        embed_url=build_bilibili_embed_url(bvid, video_url),
        series_key=series_key,
        series_title=series_key,
        episode_index=episode_index,
        playlist_size=len(pages) if isinstance(pages, list) and pages else None,
    )


def parse_bilibili_detail_pages(view: dict, pages: object) -> list[BilibiliCandidate]:
    if not isinstance(pages, list) or not pages:
        current = candidate_from_view_detail(view)
        return [current] if current else []
    bvid = str(view.get("bvid") or "") or None
    aid = parse_int(view.get("aid"))
    base_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    base_title = strip_html(str(view.get("title") or "")) or "Bilibili video"
    series_key, _episode_index = infer_series(base_title)
    candidates: list[BilibiliCandidate] = []
    for index, page in enumerate(pages, start=1):
        if not isinstance(page, dict):
            continue
        page_index = parse_int(page.get("page")) or index
        part = strip_html(str(page.get("part") or "")).strip()
        title = part if part and part != base_title else f"{base_title} P{page_index}"
        page_url = f"{base_url}?p={page_index}" if page_index > 1 else base_url
        candidates.append(
            BilibiliCandidate(
                title=title,
                url=page_url,
                duration_seconds=parse_int(page.get("duration")),
                aid=aid,
                bvid=bvid,
                cid=parse_int(page.get("cid")),
                query="view_detail_pages",
                thumbnail_url=normalize_bilibili_image(view.get("pic")),
                description=strip_html(str(view.get("desc") or "")),
                embed_url=build_bilibili_embed_url(bvid, page_url, page_index),
                series_key=series_key or base_title,
                series_title=series_key or base_title,
                episode_index=page_index,
                playlist_size=len(pages),
            )
        )
    return candidates


def parse_bilibili_ugc_season_episodes(view: dict) -> list[BilibiliCandidate]:
    ugc_season = view.get("ugc_season")
    if not isinstance(ugc_season, dict) or not isinstance(ugc_season.get("sections"), list):
        return []
    season_title = strip_html(str(ugc_season.get("title") or view.get("title") or "")).strip()
    base_description = strip_html(str(view.get("desc") or ""))
    candidates: list[BilibiliCandidate] = []
    for section in ugc_season["sections"]:
        episodes = section.get("episodes") if isinstance(section, dict) else None
        if not isinstance(episodes, list):
            continue
        for episode in episodes:
            candidate = candidate_from_ugc_episode(episode, season_title, base_description, len(candidates) + 1) if isinstance(episode, dict) else None
            if candidate:
                candidates.append(candidate)
    return [replace(candidate, playlist_size=len(candidates)) for candidate in candidates] if candidates else []


def candidate_from_ugc_episode(episode: dict, season_title: str, base_description: str, fallback_index: int) -> BilibiliCandidate | None:
    bvid = str(episode.get("bvid") or "") or None
    aid = parse_int(episode.get("aid"))
    arc = episode.get("arc") if isinstance(episode.get("arc"), dict) else {}
    page_index = parse_int(episode.get("page")) or parse_int(episode.get("index"))
    title = strip_html(str(episode.get("title") or arc.get("title") or "")).strip() or f"{season_title} P{page_index or fallback_index}"
    video_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    if not video_url:
        return None
    if page_index and page_index > 1:
        video_url = f"{video_url}?p={page_index}"
    stat = arc.get("stat") if isinstance(arc.get("stat"), dict) else {}
    series_key, inferred_index = infer_series(title)
    return BilibiliCandidate(
        title=title,
        url=video_url,
        duration_seconds=parse_int(episode.get("duration")) or parse_int(arc.get("duration")),
        aid=aid,
        bvid=bvid,
        cid=parse_int(episode.get("cid") or arc.get("cid")),
        query="ugc_season",
        thumbnail_url=normalize_bilibili_image(str(episode.get("cover") or arc.get("pic") or "")),
        description=strip_html(str(arc.get("desc") or base_description)),
        review_count=parse_int(stat.get("view")),
        danmaku_count=parse_int(stat.get("danmaku")),
        embed_url=build_bilibili_embed_url(bvid, video_url, page_index),
        series_key=series_key or season_title,
        series_title=season_title or series_key,
        episode_index=page_index or inferred_index or fallback_index,
    )


def candidate_from_ugc_archive(archive: dict, season_title: str, base_description: str, fallback_index: int) -> BilibiliCandidate | None:
    arc = archive.get("arc") if isinstance(archive.get("arc"), dict) else {}
    source = arc or archive
    bvid = str(source.get("bvid") or archive.get("bvid") or "") or None
    aid = parse_int(source.get("aid") or archive.get("aid"))
    video_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    if not video_url:
        return None
    title = strip_html(str(source.get("title") or archive.get("title") or "")).strip() or f"{season_title} EP {fallback_index}"
    stat = source.get("stat") if isinstance(source.get("stat"), dict) else {}
    series_key, inferred_index = infer_series(title)
    return BilibiliCandidate(
        title=title,
        url=video_url,
        duration_seconds=parse_int(source.get("duration") or archive.get("duration")),
        aid=aid,
        bvid=bvid,
        cid=parse_int(source.get("cid") or archive.get("cid")),
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


def parse_bilibili_detail_related(items: object) -> list[BilibiliCandidate]:
    if not isinstance(items, list):
        return []
    candidates: list[BilibiliCandidate] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        bvid = str(item.get("bvid") or "") or None
        aid = parse_int(item.get("aid"))
        url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
        title = strip_html(str(item.get("title") or ""))
        if not url or not title:
            continue
        series_key, episode_index = infer_series(title)
        stat = item.get("stat") if isinstance(item.get("stat"), dict) else {}
        candidates.append(
            BilibiliCandidate(
                title=title,
                url=url,
                duration_seconds=parse_int(item.get("duration")),
                aid=aid,
                bvid=bvid,
                query="related",
                thumbnail_url=normalize_bilibili_image(item.get("pic")),
                description=strip_html(str(item.get("desc") or "")),
                review_count=parse_int(stat.get("view")),
                danmaku_count=parse_int(stat.get("danmaku")),
                embed_url=build_bilibili_embed_url(bvid, url),
                series_key=series_key,
                series_title=series_key,
                episode_index=episode_index,
            )
        )
    return candidates


def parse_bilibili_search_results(items: list[dict], query: str, max_duration_seconds: int) -> list[BilibiliCandidate]:
    candidates: list[BilibiliCandidate] = []
    for item in items:
        if item.get("type") and item.get("type") != "video":
            continue
        duration = parse_bilibili_duration(item.get("duration"))
        if duration and duration > max_duration_seconds:
            continue
        bvid = item.get("bvid")
        url = f"https://www.bilibili.com/video/{bvid}" if bvid else item.get("arcurl")
        title = strip_html(str(item.get("title") or ""))
        if not url or not title:
            continue
        series_key, episode_index = infer_series(title)
        candidates.append(
            BilibiliCandidate(
                title=title,
                url=str(url),
                duration_seconds=duration,
                aid=parse_int(item.get("aid") or item.get("id")),
                bvid=str(bvid) if bvid else None,
                query=query,
                thumbnail_url=normalize_bilibili_image(item.get("pic")),
                description=strip_html(str(item.get("description") or "")),
                review_count=parse_int(item.get("play") or item.get("video_review")),
                danmaku_count=parse_int(item.get("danmaku")),
                embed_url=build_bilibili_embed_url(str(bvid) if bvid else None, str(url)),
                series_key=series_key,
                series_title=series_key,
                episode_index=episode_index,
            )
        )
    return candidates


def extract_bilibili_all_video_results(payload: dict) -> list[dict]:
    data = payload.get("data") if isinstance(payload, dict) else {}
    result = data.get("result") if isinstance(data, dict) else []
    items: list[dict] = []
    if isinstance(result, list):
        for block in result:
            if not isinstance(block, dict):
                continue
            if block.get("result_type") == "video" and isinstance(block.get("data"), list):
                items.extend(item for item in block["data"] if isinstance(item, dict))
            elif isinstance(block.get("data"), list):
                items.extend(item for item in block["data"] if isinstance(item, dict) and item.get("type") == "video")
    return items


def parse_bilibili_duration(value: object) -> int | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    parts = str(value).split(":")
    try:
        total = 0
        for part in parts:
            total = total * 60 + int(part)
        return total
    except ValueError:
        return None


def candidate_to_dict(candidate: BilibiliCandidate | None) -> dict[str, Any]:
    return dict(candidate.__dict__) if candidate else {}


def strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", "", value.replace("<em class=\"keyword\">", "").replace("</em>", "")).strip()


def normalize_bilibili_image(value: str | None) -> str | None:
    if not value:
        return None
    return f"https:{value}" if value.startswith("//") else value


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
    match = re.search(r"/video/av(\d+)", url) or re.search(r"[?&]aid=(\d+)", url)
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
    return hashlib.md5(f"{query}:{time.time_ns()}".encode("utf-8")).hexdigest()


def warm_bilibili_search_session(client: httpx.Client, query: str, *, force: bool = False) -> None:
    if client.cookies and not force:
        return
    for url in ("https://www.bilibili.com/", build_bilibili_search_url(query)):
        try:
            client.get(url)
        except httpx.HTTPError:
            continue


WBI_MIXIN_TABLE = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]


def get_bilibili_wbi_mixin_key(client: httpx.Client) -> str:
    response = client.get("https://api.bilibili.com/x/web-interface/nav")
    response.raise_for_status()
    data = response.json().get("data", {})
    wbi_img = data.get("wbi_img") or {}
    raw = extract_bilibili_wbi_key(str(wbi_img.get("img_url") or "")) + extract_bilibili_wbi_key(str(wbi_img.get("sub_url") or ""))
    if len(raw) < 64:
        raise RuntimeError("Bilibili WBI keys are unavailable.")
    return "".join(raw[index] for index in WBI_MIXIN_TABLE)[:32]


def extract_bilibili_wbi_key(url: str) -> str:
    return urlparse(url).path.rsplit("/", 1)[-1].split(".", 1)[0]


def sign_bilibili_wbi_params(params: dict[str, object], mixin_key: str) -> dict[str, object]:
    signed: dict[str, object] = {**params, "wts": int(time.time())}
    filtered = {key: re.sub(r"[!'()*]", "", str(value)) for key, value in signed.items()}
    query = "&".join(f"{quote_plus(key)}={quote_plus(filtered[key])}" for key in sorted(filtered))
    filtered["w_rid"] = hashlib.md5((query + mixin_key).encode("utf-8")).hexdigest()
    return filtered


def infer_series(title: str) -> tuple[str | None, int | None]:
    normalized = re.sub(r"\s+", "", title)
    return normalize_series_title(normalized) or None, infer_episode_index(normalized)


def infer_episode_index(normalized_title: str) -> int | None:
    for pattern in [r"(?:第|EP\.?|ep|集|part|Part|P)(\d{1,4})(?:集|话|話|期|部|$)", r"(?:^|[^0-9])(\d{1,4})[/-](\d{1,4})(?:[^0-9]|$)", r"(?:上|中|下)(?:集|部|篇)$"]:
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


def dedupe_candidates(candidates: list[BilibiliCandidate]) -> list[BilibiliCandidate]:
    seen = set()
    out = []
    for candidate in candidates:
        key = candidate.bvid or candidate.url
        if key in seen:
            continue
        seen.add(key)
        out.append(candidate)
    return out


def rank_candidates(candidates: list[BilibiliCandidate]) -> list[BilibiliCandidate]:
    scored = [(candidate_relevance(candidate), index, candidate) for index, candidate in enumerate(candidates)]
    positive = [item for item in scored if item[0] > 0]
    if not positive:
        return candidates
    positive.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    return [candidate for _score, _index, candidate in positive]


def candidate_relevance(candidate: BilibiliCandidate) -> int:
    query_terms = query_core_terms(candidate.query)
    score = 1 if not query_terms else 0
    haystack = f"{candidate.title} {candidate.description or ''} {candidate.series_title or ''}".lower()
    for term in query_terms:
        if term.lower() in haystack:
            score += 10 if len(term) >= 3 else 4
    if candidate.series_key:
        score += 4
    if candidate.episode_index is not None:
        score += 3
    if candidate.playlist_size and candidate.playlist_size > 1:
        score += min(candidate.playlist_size, 12)
    return score


def top_series_keys(candidates: list[BilibiliCandidate], max_keys: int) -> list[str]:
    counts: dict[str, int] = {}
    for candidate in candidates:
        if candidate.series_key and len(candidate.series_key) >= 4:
            counts[candidate.series_key] = counts.get(candidate.series_key, 0) + 1
    return sorted(counts, key=lambda key: (counts[key], len(key)), reverse=True)[:max_keys]


def build_series_queries(series_key: str) -> list[str]:
    base = series_key.strip()
    return dedupe_terms([base, f"{base} 全集", f"{base} 合集", f"{base} 第1集", f"{base} 第2集", f"{base} 第3集", f"{base} 第4集", f"{base} 短剧", f"{base} 大结局", f"{base} 完整版"])


def rank_series_candidates(candidates: list[BilibiliCandidate], limit: int) -> list[BilibiliCandidate]:
    annotated = annotate_playlist_sizes(rank_candidates(dedupe_candidates(candidates)))
    grouped: dict[str, list[BilibiliCandidate]] = {}
    singles: list[BilibiliCandidate] = []
    for candidate in annotated:
        if candidate.series_key and candidate.playlist_size and candidate.playlist_size > 1:
            grouped.setdefault(candidate.series_key, []).append(candidate)
        else:
            singles.append(candidate)
    if not grouped:
        return annotated[:limit]
    selected: list[BilibiliCandidate] = []
    for group in sorted(grouped.values(), key=lambda items: (max(item.playlist_size or 0 for item in items), len({item.episode_index for item in items if item.episode_index is not None}), sum(candidate_relevance(item) for item in items)), reverse=True):
        selected.extend(sorted(group, key=lambda item: (item.episode_index if item.episode_index is not None else 9999, item.duration_seconds or 0, item.title)))
        if len(selected) >= limit:
            return selected[:limit]
    selected.extend(singles)
    return selected[:limit]


def annotate_playlist_sizes(candidates: list[BilibiliCandidate]) -> list[BilibiliCandidate]:
    counts: dict[str, int] = {}
    for candidate in candidates:
        if candidate.series_key:
            counts[candidate.series_key] = counts.get(candidate.series_key, 0) + 1
    return [replace(candidate, playlist_size=counts.get(candidate.series_key) if candidate.series_key else candidate.playlist_size) for candidate in candidates]


def query_core_terms(query: str) -> list[str]:
    stopwords = {"短视频", "热门", "合集", "完整版", "测评", "开箱", "好物", "体验", "教程", "推荐", "短剧", "B站"}
    return [term for term in re.findall(r"[A-Za-z0-9+#.]+|[\u4e00-\u9fff]{2,}", query) if term not in stopwords]


def dedupe_terms(values: list[str]) -> list[str]:
    seen = set()
    out = []
    for value in values:
        if value not in seen:
            out.append(value)
            seen.add(value)
    return out


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
