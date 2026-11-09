from __future__ import annotations

import hashlib
import html
import re
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote_plus, urlparse

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from common.db.models import ContentItem, KafkaTask, MediaWorkflow, User

BILIBILI_HEADERS = {
    "Referer": "https://www.bilibili.com/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}
BILIBILI_WBI_MIXIN_TABLE = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

def _source_metadata(primary_source: dict) -> dict:
    metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def build_hardsub_story_from_ocr(db: Session, project: MediaWorkflow) -> dict:
    """Build the render story from completed Bilibili OCR tasks for a workflow."""
    tasks = (
        db.query(KafkaTask)
        .filter(
            KafkaTask.reference_id == project.id,
            KafkaTask.task_type == "BILIBILI_OCR_EPISODE",
            KafkaTask.status == "COMPLETED",
        )
        .order_by(KafkaTask.created_at.asc())
        .all()
    )
    story_data: list[dict] = []
    for task in tasks:
        result = task.result_jsonb if isinstance(task.result_jsonb, dict) else {}
        payload = task.payload_jsonb if isinstance(task.payload_jsonb, dict) else {}
        video_url = str(result.get("url") or payload.get("url") or "").strip()
        segments = result.get("translated_segments") or result.get("segments") or []
        if not video_url or not isinstance(segments, list):
            continue
        for segment in segments:
            if not isinstance(segment, dict):
                continue
            start = _safe_float(segment.get("start") or segment.get("start_time"), 0.0)
            end = _safe_float(segment.get("end") or segment.get("end_time"), start + 2.0)
            duration = max(0.5, end - start)
            subtitle = str(
                segment.get("translated_text")
                or segment.get("translation")
                or segment.get("raw_text")
                or segment.get("text")
                or ""
            ).strip()
            if not subtitle:
                continue
            story_data.append({
                "scene_index": len(story_data) + 1,
                "duration": round(duration, 2),
                "subtitle_start": round(start, 2),
                "subtitle_duration": round(duration, 2),
                "image": video_url,
                "media_type": "video",
                "effect": "none",
                "fit": "contain",
                "subtitle": subtitle,
                "voice_text": subtitle,
            })

    if not story_data:
        return {}
    return {
        "title": project.title,
        "meta": {
            "workflow_id": str(project.id),
            "profile_id": str(project.profile_id),
            "source_content_id": str(project.primary_content_id) if project.primary_content_id else None,
            "source": "BILIBILI",
        },
        "video": {"width": 1080, "height": 1920, "fps": 30, "background": "#05070b"},
        "audio": {"voiceVolume": 0, "musicVolume": 0},
        "story_data": story_data,
        "source": {"workflow_id": str(project.id), "type": "BILIBILI"},
    }


def _safe_float(value: object, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback

def _list_source_metadata(metadata: dict) -> dict:
    keys = (
        "article_id",
        "category_id",
        "site_id",
        "category",
        "tags",
        "image_count",
        "video_count",
        "thumbnail_url",
        "embed_url",
        "episode_count",
        "episodes",
        "season_id",
        "season_title",
        "series_title",
    )
    return {key: metadata.get(key) for key in keys if metadata.get(key) not in (None, "", [])}

def _bilibili_episodes_for_queue(content: ContentItem, source_metadata: dict, primary_source: dict) -> list[dict]:
    episodes = source_metadata.get("episodes")
    if isinstance(episodes, list):
        cleaned = [episode for episode in episodes if isinstance(episode, dict)]
        if cleaned:
            normalized = [_normalize_bilibili_episode(content, source_metadata, primary_source, episode, index) for index, episode in enumerate(cleaned, start=1)]
            if all(episode.get("url") and episode.get("embed_url") for episode in normalized):
                return normalized
            live_episodes = _fetch_bilibili_episodes_live(content, source_metadata, primary_source)
            if live_episodes:
                return _merge_bilibili_episode_sources(normalized, live_episodes)
            return normalized

    live_episodes = _fetch_bilibili_episodes_live(content, source_metadata, primary_source)
    if live_episodes:
        return live_episodes

    text_episodes = _bilibili_episodes_from_text(content)
    if text_episodes:
        live_episodes = _fetch_bilibili_episodes_live(content, source_metadata, primary_source)
        if live_episodes:
            return _merge_bilibili_episode_sources(text_episodes, live_episodes)
        return text_episodes

    return [{
        "episode_index": content.episode_order or 1,
        "title": content.canonical_title,
        "url": primary_source.get("source_url") or content.canonical_url,
        "bvid": source_metadata.get("bvid"),
        "aid": source_metadata.get("aid"),
        "cid": source_metadata.get("cid"),
        "thumbnail_url": source_metadata.get("thumbnail_url"),
        "duration_seconds": content.duration_seconds,
        "content_id": str(content.id),
        "current": True,
    }]

def _normalize_bilibili_episode(
    content: ContentItem,
    source_metadata: dict,
    primary_source: dict,
    episode: dict,
    fallback_index: int,
) -> dict:
    episode_index = _safe_int(episode.get("episode_index")) or _extract_bilibili_episode_index(episode.get("title")) or fallback_index
    raw_url = episode.get("url")
    if raw_url:
        url = str(raw_url)
    elif episode.get("current"):
        url = str(primary_source.get("source_url") or content.canonical_url or "")
    else:
        url = ""
    current_url = str(primary_source.get("source_url") or content.canonical_url or "")
    return {
        "episode_index": episode_index,
        "title": episode.get("title") or content.canonical_title,
        "url": url or None,
        "bvid": episode.get("bvid") or source_metadata.get("bvid"),
        "aid": episode.get("aid") or source_metadata.get("aid"),
        "cid": episode.get("cid") or source_metadata.get("cid"),
        "thumbnail_url": episode.get("thumbnail_url") or source_metadata.get("thumbnail_url"),
        "duration_seconds": episode.get("duration_seconds") or content.duration_seconds,
        "embed_url": episode.get("embed_url") or (source_metadata.get("embed_url") if episode.get("current") else None),
        "content_id": str(content.id),
        "current": _same_bilibili_url(url, current_url),
    }

def _merge_bilibili_episode_sources(base_episodes: list[dict], live_episodes: list[dict]) -> list[dict]:
    live_by_index = {
        _safe_int(episode.get("episode_index")): episode
        for episode in live_episodes
        if _safe_int(episode.get("episode_index")) is not None
    }
    live_by_title = {
        re.sub(r"\s+", "", str(episode.get("title") or "")): episode
        for episode in live_episodes
        if episode.get("title")
    }
    merged: list[dict] = []
    used_live_ids: set[int] = set()
    for base in base_episodes:
        episode_index = _safe_int(base.get("episode_index"))
        title_key = re.sub(r"\s+", "", str(base.get("title") or ""))
        live = live_by_index.get(episode_index) or live_by_title.get(title_key)
        if live:
            used_live_ids.add(id(live))
            merged.append({
                **base,
                **{key: value for key, value in live.items() if value not in (None, "", [])},
                "content_id": base.get("content_id") or live.get("content_id"),
                "current": bool(base.get("current") or live.get("current")),
                "metadata_only": False,
            })
        else:
            merged.append(base)
    for live in live_episodes:
        if id(live) not in used_live_ids:
            merged.append(live)
    return sorted(merged, key=lambda episode: _safe_int(episode.get("episode_index")) or 10_000)

def _fetch_bilibili_episodes_live(content: ContentItem, source_metadata: dict, primary_source: dict) -> list[dict]:
    bvid = str(source_metadata.get("bvid") or "").strip()
    aid = _safe_int(source_metadata.get("aid"))
    if not bvid and not aid:
        source_url = str(primary_source.get("source_url") or content.canonical_url or "")
        match = re.search(r"/video/(BV[0-9A-Za-z]+)", source_url)
        if match:
            bvid = match.group(1)
    if not bvid and not aid:
        return []

    params = {"bvid": bvid} if bvid else {"aid": aid}
    headers = {**BILIBILI_HEADERS, "Referer": str(primary_source.get("source_url") or "https://www.bilibili.com/")}
    with httpx.Client(timeout=12, follow_redirects=True, headers=headers) as client:
        try:
            response = client.get(
                "https://api.bilibili.com/x/web-interface/view",
                params=params,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception:
            return _bilibili_episodes_from_page_archives(client, content, source_metadata, primary_source)

        data = payload.get("data") if isinstance(payload, dict) else {}
        if not isinstance(data, dict):
            return _bilibili_episodes_from_page_archives(client, content, source_metadata, primary_source)
        current_url = str(primary_source.get("source_url") or content.canonical_url or "")
        episodes = _bilibili_episodes_from_ugc_season(data, source_metadata, current_url)
        if episodes:
            return episodes
        episodes = _bilibili_episodes_from_season_archives(data, source_metadata, primary_source)
        if episodes:
            return episodes
        episodes = _bilibili_episodes_from_pages(data, source_metadata, current_url)
        return episodes or _bilibili_episodes_from_page_archives(client, content, source_metadata, primary_source)

def _bilibili_episodes_from_page_archives(
    client: httpx.Client,
    content: ContentItem,
    source_metadata: dict,
    primary_source: dict,
) -> list[dict]:
    source_url = str(primary_source.get("source_url") or content.canonical_url or "")
    if not source_url:
        return []
    try:
        hints = _bilibili_page_series_hints(client, source_url)
        season_id = _safe_int(hints.get("season_id") or source_metadata.get("season_id"))
        mid = _safe_int(hints.get("mid"))
        if not season_id or not mid:
            return []
        mixin_key = _bilibili_wbi_mixin_key(client)
        return _bilibili_episodes_from_archive_api(
            client,
            mixin_key,
            mid=mid,
            season_id=season_id,
            source_metadata=source_metadata,
            referer=source_url,
        )
    except Exception:
        return []

def _bilibili_page_series_hints(client: httpx.Client, url: str) -> dict[str, object]:
    response = client.get(url, headers={"Referer": "https://www.bilibili.com/"})
    response.raise_for_status()
    html_text = response.text
    initial_match = re.search(r"__INITIAL_STATE__=(\{.*?\});\s*\(function", html_text, re.S)
    state_text = initial_match.group(1) if initial_match else html_text
    return {
        "season_id": _first_regex_int(state_text, (r'"season_id"\s*:\s*(\d+)', r'"seasonId"\s*:\s*(\d+)', r"season_id[^0-9]{0,20}(\d+)")),
        "mid": _first_regex_int(state_text, (r'"owner"\s*:\s*\{[^{}]*"mid"\s*:\s*(\d+)', r'"upData"\s*:\s*\{[^{}]*"mid"\s*:\s*(\d+)', r'"mid"\s*:\s*(\d{5,})')),
    }

def _first_regex_int(text: str, patterns: tuple[str, ...]) -> int | None:
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return _safe_int(match.group(1))
    return None

def _bilibili_episodes_from_text(content: ContentItem) -> list[dict]:
    text = _load_content_full_text(content.mongo_normalized_id) or content.summary or ""
    if "Danh sách tập" not in text:
        return []
    segment = text.split("Danh sách tập", 1)[1]
    segment = segment.split("\n", 1)[0].lstrip(":：").strip()
    if not segment:
        return []
    rows: list[dict] = []
    for index, part in enumerate(segment.split(";"), start=1):
        item = part.strip()
        if not item:
            continue
        match = re.match(r"(?P<episode>\d+)(?:\s*[-~至到]\s*\d+)?\.\s*(?P<title>.+)", item)
        episode_index = _safe_int(match.group("episode")) if match else None
        title = (match.group("title") if match else item).strip()
        if not title:
            continue
        rows.append({
            "episode_index": episode_index or _extract_bilibili_episode_index(title) or index,
            "title": title,
            "url": None,
            "bvid": None,
            "aid": None,
            "cid": None,
            "thumbnail_url": None,
            "duration_seconds": None,
            "content_id": str(content.id),
            "current": _same_bilibili_title(title, content.canonical_title),
            "metadata_only": True,
        })
    return rows

def _bilibili_episodes_from_ugc_season(data: dict, source_metadata: dict, current_url: str) -> list[dict]:
    ugc_season = data.get("ugc_season")
    if not isinstance(ugc_season, dict):
        return []
    rows: list[dict] = []
    for section in ugc_season.get("sections") or []:
        if not isinstance(section, dict) or not isinstance(section.get("episodes"), list):
            continue
        for fallback_index, episode in enumerate(section["episodes"], start=len(rows) + 1):
            if not isinstance(episode, dict):
                continue
            arc = episode.get("arc") if isinstance(episode.get("arc"), dict) else {}
            bvid = str(episode.get("bvid") or arc.get("bvid") or "").strip()
            aid = _safe_int(episode.get("aid") or arc.get("aid"))
            page_index = _safe_int(episode.get("page") or episode.get("index"))
            url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
            if url and page_index and page_index > 1:
                url = f"{url}?p={page_index}"
            title = str(episode.get("title") or arc.get("title") or f"Tập {fallback_index}").strip()
            rows.append({
                "episode_index": page_index or _extract_bilibili_episode_index(title) or fallback_index,
                "title": title,
                "url": url,
                "bvid": bvid or None,
                "aid": aid,
                "cid": _safe_int(episode.get("cid") or arc.get("cid")),
                "thumbnail_url": episode.get("cover") or arc.get("pic") or source_metadata.get("thumbnail_url"),
                "duration_seconds": _safe_int(episode.get("duration") or arc.get("duration")),
                "embed_url": _bilibili_embed_url(bvid or None, url, page_index),
                "current": _same_bilibili_url(url, current_url),
            })
    return rows

def _bilibili_episodes_from_pages(data: dict, source_metadata: dict, current_url: str) -> list[dict]:
    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        return []
    bvid = str(data.get("bvid") or source_metadata.get("bvid") or "").strip()
    aid = _safe_int(data.get("aid") or source_metadata.get("aid"))
    base_url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else current_url
    base_title = str(data.get("title") or "").strip()
    rows = []
    for index, page in enumerate(pages, start=1):
        if not isinstance(page, dict):
            continue
        page_index = _safe_int(page.get("page")) or index
        url = f"{base_url}?p={page_index}" if page_index > 1 else base_url
        title = str(page.get("part") or "").strip() or f"{base_title} P{page_index}".strip()
        rows.append({
            "episode_index": page_index,
            "title": title or f"Tập {page_index}",
            "url": url,
            "bvid": bvid or None,
            "aid": aid,
            "cid": _safe_int(page.get("cid")),
            "thumbnail_url": source_metadata.get("thumbnail_url") or data.get("pic"),
            "duration_seconds": _safe_int(page.get("duration")),
            "embed_url": _bilibili_embed_url(bvid or None, url, page_index),
            "current": _same_bilibili_url(url, current_url),
        })
    return rows

def _bilibili_episodes_from_season_archives(data: dict, source_metadata: dict, primary_source: dict) -> list[dict]:
    season_id = _safe_int(source_metadata.get("season_id"))
    owner = data.get("owner") if isinstance(data.get("owner"), dict) else {}
    mid = _safe_int(owner.get("mid"))
    if not season_id or not mid:
        return []

    referer = str(primary_source.get("source_url") or "https://www.bilibili.com/")
    try:
        with httpx.Client(timeout=12, follow_redirects=True, headers={**BILIBILI_HEADERS, "Referer": referer}) as client:
            mixin_key = _bilibili_wbi_mixin_key(client)
            return _bilibili_episodes_from_archive_api(
                client,
                mixin_key,
                mid=mid,
                season_id=season_id,
                source_metadata=source_metadata,
                referer=referer,
            )
    except Exception:
        return []

def _bilibili_episodes_from_archive_api(
    client: httpx.Client,
    mixin_key: str,
    *,
    mid: int,
    season_id: int,
    source_metadata: dict,
    referer: str,
) -> list[dict]:
    rows: list[dict] = []
    page_size = 50
    for page_num in range(1, 11):
        params = _sign_bilibili_wbi_params(
            {
                "mid": mid,
                "season_id": season_id,
                "sort_reverse": "false",
                "page_num": page_num,
                "page_size": page_size,
                "web_location": 333.999,
            },
            mixin_key,
        )
        response = client.get(
            "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list",
            params=params,
            headers={"Referer": referer or "https://www.bilibili.com/"},
        )
        response.raise_for_status()
        payload = response.json()
        result = payload.get("data") if isinstance(payload, dict) else {}
        archives = result.get("archives") if isinstance(result, dict) else None
        if not isinstance(archives, list) or not archives:
            break
        for archive in archives:
            if not isinstance(archive, dict):
                continue
            episode = _bilibili_episode_from_archive(archive, source_metadata, len(rows) + 1)
            if episode:
                rows.append(episode)
        page = result.get("page") if isinstance(result.get("page"), dict) else {}
        total = _safe_int(page.get("total"))
        returned_page_size = _safe_int(page.get("page_size")) or page_size
        if total and page_num * returned_page_size >= total:
            break
    return rows

def _bilibili_episode_from_archive(archive: dict, source_metadata: dict, fallback_index: int) -> dict | None:
    arc = archive.get("arc") if isinstance(archive.get("arc"), dict) else {}
    source = arc or archive
    bvid = str(source.get("bvid") or archive.get("bvid") or "").strip()
    aid = _safe_int(source.get("aid") or archive.get("aid"))
    url = f"https://www.bilibili.com/video/{bvid}" if bvid else f"https://www.bilibili.com/video/av{aid}" if aid else ""
    if not url:
        return None
    title = str(source.get("title") or archive.get("title") or f"Tập {fallback_index}").strip()
    return {
        "episode_index": _extract_bilibili_episode_index(title) or fallback_index,
        "title": title,
        "url": url,
        "bvid": bvid or None,
        "aid": aid,
        "cid": _safe_int(source.get("cid") or archive.get("cid")),
        "thumbnail_url": source.get("pic") or archive.get("pic") or archive.get("cover") or source_metadata.get("thumbnail_url"),
        "duration_seconds": _safe_int(source.get("duration") or archive.get("duration")),
        "embed_url": _bilibili_embed_url(bvid or None, url),
        "current": str(source_metadata.get("bvid") or "") == bvid if bvid else str(source_metadata.get("aid") or "") == str(aid or ""),
    }

def _bilibili_wbi_mixin_key(client: httpx.Client) -> str:
    response = client.get("https://api.bilibili.com/x/web-interface/nav")
    response.raise_for_status()
    data = response.json().get("data", {})
    wbi_img = data.get("wbi_img") if isinstance(data, dict) else {}
    raw = _bilibili_wbi_key_part(str((wbi_img or {}).get("img_url") or "")) + _bilibili_wbi_key_part(str((wbi_img or {}).get("sub_url") or ""))
    if len(raw) < 64:
        raise RuntimeError("Bilibili WBI keys are unavailable")
    return "".join(raw[index] for index in BILIBILI_WBI_MIXIN_TABLE)[:32]

def _bilibili_wbi_key_part(value: str) -> str:
    return urlparse(value).path.rsplit("/", 1)[-1].split(".", 1)[0]

def _sign_bilibili_wbi_params(params: dict[str, object], mixin_key: str) -> dict[str, object]:
    signed: dict[str, object] = {**params, "wts": int(time.time())}
    filtered = {key: re.sub(r"[!'()*]", "", str(value)) for key, value in signed.items()}
    query = "&".join(f"{quote_plus(key)}={quote_plus(filtered[key])}" for key in sorted(filtered))
    filtered["w_rid"] = hashlib.md5((query + mixin_key).encode("utf-8")).hexdigest()
    return filtered

def _bilibili_embed_url(bvid: str | None, url: str, page: int | None = None) -> str | None:
    if not bvid:
        match = re.search(r"/video/(BV[0-9A-Za-z]+)", str(url or ""))
        bvid = match.group(1) if match else None
    if not bvid:
        return None
    page_part = f"&p={page}" if page and page > 1 else ""
    return f"https://player.bilibili.com/player.html?bvid={bvid}{page_part}&autoplay=0"

def _same_bilibili_url(left: str, right: str) -> bool:
    def clean(value: str) -> str:
        return str(value or "").split("#", 1)[0].rstrip("/")
    return bool(clean(left) and clean(left) == clean(right))

def _same_bilibili_title(left: str, right: str) -> bool:
    return re.sub(r"\s+", "", str(left or "")) == re.sub(r"\s+", "", str(right or ""))

def _extract_bilibili_episode_index(value: object) -> int | None:
    text = str(value or "")
    match = re.search(r"第\s*(\d+)(?:\s*[-~至到]\s*\d+)?\s*[集话話]", text)
    if match:
        return _safe_int(match.group(1))
    match = re.search(r"\b(?:ep|episode|tập|p)\s*(\d+)\b", text, re.IGNORECASE)
    return _safe_int(match.group(1)) if match else None

def _queue_bilibili_ocr_for_content(
    db: Session,
    content: ContentItem,
    user: User,
    episode_indices: list[int] | None = None,
    workflow: MediaWorkflow | None = None,
) -> dict:
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources and isinstance(sources[0], dict) else {}
    if str(primary_source.get("source_type") or "").upper() != "BILIBILI":
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ đưa Bilibili vào hàng đợi OCR")

    source_metadata = _source_metadata(primary_source)
    episodes = _bilibili_episodes_for_queue(content, source_metadata, primary_source)
    requested_indices = {int(value) for value in (episode_indices or []) if int(value) > 0}
    if requested_indices:
        episodes = [
            episode
            for index, episode in enumerate(episodes, start=1)
            if (_safe_int(episode.get("episode_index")) or index) in requested_indices
        ]
    if not episodes:
        raise HTTPException(status_code=400, detail="Video Bilibili chưa có tập phù hợp để OCR")

    created = 0
    reused = 0
    task_ids: list[str] = []
    reference_id = workflow.id if workflow else content.id
    reference_type = "media_workflow" if workflow else "content_item"
    prepared_episodes = []
    for index, episode in enumerate(episodes, start=1):
        episode_index = _safe_int(episode.get("episode_index")) or index
        episode_url = str(episode.get("url") or content.canonical_url or primary_source.get("source_url") or "")
        if episode.get("metadata_only") and not episode.get("url"):
            reused += 1
            continue
        idempotency_key = f"bilibili-ocr:{reference_id}:{episode_index}:{episode.get('bvid') or episode_url}"
        prepared_episodes.append((episode, episode_index, episode_url, idempotency_key))

    idempotency_keys = list(dict.fromkeys(item[3] for item in prepared_episodes))
    existing_tasks = (
        db.query(KafkaTask)
        .filter(KafkaTask.idempotency_key.in_(idempotency_keys))
        .all()
        if idempotency_keys
        else []
    )
    tasks_by_idempotency_key = {task.idempotency_key: task for task in existing_tasks}
    for episode, episode_index, episode_url, idempotency_key in prepared_episodes:
        existing = tasks_by_idempotency_key.get(idempotency_key)
        if existing:
            reused += 1
            task_ids.append(str(existing.id))
            continue
        task = KafkaTask(
            reference_id=reference_id,
            reference_type=reference_type,
            task_type="BILIBILI_OCR_EPISODE",
            status="PENDING",
            current_stage="QUEUED_OCR",
            progress_percent=0,
            idempotency_key=idempotency_key,
            payload_jsonb={
                "content_id": str(content.id),
                "source_type": "BILIBILI",
                "episode_index": episode_index,
                "title": episode.get("title") or content.canonical_title,
                "url": episode_url,
                "bvid": episode.get("bvid"),
                "aid": episode.get("aid"),
                "cid": episode.get("cid"),
                "thumbnail_url": episode.get("thumbnail_url") or source_metadata.get("thumbnail_url"),
                "queued_by": str(user.id),
                "workflow_id": str(workflow.id) if workflow else None,
            },
        )
        db.add(task)
        db.flush()
        tasks_by_idempotency_key[idempotency_key] = task
        created += 1
        task_ids.append(str(task.id))

    metadata = dict(source_metadata)
    metadata["ocr_queue"] = {
        "status": "QUEUED",
        "task_count": len(task_ids),
        "created_count": created,
        "reused_count": reused,
        "queued_at": datetime.now(timezone.utc).isoformat(),
        "episode_indices": sorted(requested_indices) if requested_indices else None,
    }
    primary_source["metadata_json"] = metadata
    content.sources_jsonb = [primary_source, *sources[1:]]
    db.add(content)
    if workflow:
        workflow.current_stage = "QUEUED_OCR"
        workflow.progress_percent = 10 if task_ids else workflow.progress_percent
        workflow.status = "PROCESSING" if task_ids else workflow.status
        workflow.metadata_json = {
            **(workflow.metadata_json if isinstance(workflow.metadata_json, dict) else {}),
            "ocr_queue": metadata["ocr_queue"],
        }
        db.add(workflow)
    return {"content_id": str(content.id), "queued": created, "reused": reused, "task_ids": task_ids}

def _safe_int(value) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None
