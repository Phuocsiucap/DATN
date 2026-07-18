from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import html
import urllib.parse
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import imageio_ffmpeg
import httpx
from openai import AsyncOpenAI
import yt_dlp

from backend.gateway.app.core.database_mongo import video_localization_jobs_col

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
WORK_ROOT = PROJECT_ROOT / "storage" / "video_localization"
_openai_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set")
        _openai_client = AsyncOpenAI(api_key=api_key)
    return _openai_client


def _now() -> datetime:
    return datetime.utcnow()


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_.-]+", "-", value).strip("-")
    return cleaned[:80] or "video"


def _strip_html(value: str | None) -> str:
    if not value:
        return ""
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def _normalize_duration(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    raw = str(value).strip()
    if raw.isdigit():
        return int(raw)
    parts = raw.split(":")
    if not all(part.isdigit() for part in parts):
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds


def _bilibili_headers() -> dict[str, str]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.bilibili.com/",
        "Origin": "https://www.bilibili.com",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,vi;q=0.7",
    }
    cookie = os.getenv("BILIBILI_COOKIE", "").strip()
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _soft_bilibili_http_error(exc: httpx.HTTPStatusError) -> bool:
    return exc.response.status_code in {403, 412, 429}


def _bilibili_unavailable_payload(exc: Exception, source: str) -> dict[str, Any]:
    status_code = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
    message = f"Bilibili tạm chặn request {source}"
    if status_code:
        message = f"{message} ({status_code})"
    return {
        "items": [],
        "warning": message,
        "detail": str(exc),
    }


def _ffmpeg() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def _run_ffmpeg(args: list[str]) -> None:
    command = [_ffmpeg(), "-y", *args]
    subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def _serialize_job(job: dict[str, Any] | None) -> dict[str, Any] | None:
    if not job:
        return None
    job = dict(job)
    job.pop("_id", None)
    return job


def search_bilibili_videos(query: str, limit: int = 10) -> dict[str, Any]:
    query = query.strip()
    limit = max(1, min(limit, 20))
    if not query:
        return {"items": []}

    try:
        response = httpx.get(
            "https://api.bilibili.com/x/web-interface/search/type",
            params={
                "search_type": "video",
                "keyword": query,
                "page": 1,
                "page_size": limit,
            },
            headers=_bilibili_headers(),
            timeout=15,
            follow_redirects=True,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if _soft_bilibili_http_error(exc):
            return _bilibili_unavailable_payload(exc, "video search")
        raise
    payload = response.json()
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("message") or "Bilibili API search failed")

    entries = (payload.get("data") or {}).get("result") or []
    items = []
    for entry in entries[:limit]:
        if not entry:
            continue
        bvid = entry.get("bvid")
        aid = entry.get("aid")
        url = entry.get("arcurl") or entry.get("url")
        if not url and bvid:
            url = f"https://www.bilibili.com/video/{bvid}"
        if url and str(url).startswith("//"):
            url = f"https:{url}"
        thumbnail = f"https:{entry.get('pic')}" if str(entry.get("pic", "")).startswith("//") else entry.get("pic")
        items.append(
            {
                "id": bvid or aid,
                "bvid": bvid,
                "aid": aid,
                "title": _strip_html(entry.get("title")) or "Untitled",
                "url": url,
                "duration": _normalize_duration(entry.get("duration")),
                "thumbnail": thumbnail,
                "thumbnail_proxy": f"/api/video-localization/bilibili/thumbnail?url={urllib.parse.quote(thumbnail or '')}" if thumbnail else None,
                "uploader": _strip_html(entry.get("author")),
                "play": entry.get("play"),
                "favorites": entry.get("favorites"),
                "description": _strip_html(entry.get("description")),
            }
        )
    return {"items": items}


def _thumbnail_payload(url: str | None) -> tuple[str | None, str | None]:
    if not url:
        return None, None
    thumbnail = f"https:{url}" if str(url).startswith("//") else str(url)
    proxy = f"/api/video-localization/bilibili/thumbnail?url={urllib.parse.quote(thumbnail)}"
    return thumbnail, proxy


def _normalize_episode(entry: dict[str, Any], fallback_title: str = "Tập") -> dict[str, Any]:
    title = _strip_html(entry.get("title") or entry.get("long_title") or entry.get("index_title")) or fallback_title
    url = entry.get("url") or entry.get("link")
    bvid = entry.get("bvid")
    if url and str(url).startswith("//"):
        url = f"https:{url}"
    if not url and bvid:
        url = f"https://www.bilibili.com/bangumi/play/{entry.get('ep_id')}" if entry.get("ep_id") else f"https://www.bilibili.com/video/{bvid}"
    cover, cover_proxy = _thumbnail_payload(entry.get("cover") or entry.get("badge_info", {}).get("img"))
    return {
        "id": entry.get("id") or entry.get("ep_id") or bvid,
        "ep_id": entry.get("ep_id") or entry.get("id"),
        "aid": entry.get("aid"),
        "bvid": bvid,
        "cid": entry.get("cid"),
        "title": title,
        "long_title": _strip_html(entry.get("long_title")),
        "url": url,
        "duration": _normalize_duration(entry.get("duration")),
        "thumbnail": cover,
        "thumbnail_proxy": cover_proxy,
    }


def search_bilibili_series(query: str, limit: int = 10) -> dict[str, Any]:
    query = query.strip()
    limit = max(1, min(limit, 20))
    if not query:
        return {"items": []}

    try:
        response = httpx.get(
            "https://api.bilibili.com/x/web-interface/search/type",
            params={
                "search_type": "media_bangumi",
                "keyword": query,
                "page": 1,
                "page_size": limit,
            },
            headers=_bilibili_headers(),
            timeout=15,
            follow_redirects=True,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if _soft_bilibili_http_error(exc):
            return _bilibili_unavailable_payload(exc, "series search")
        raise
    payload = response.json()
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("message") or "Bilibili API series search failed")

    entries = (payload.get("data") or {}).get("result") or []
    items = []
    for entry in entries[:limit]:
        cover, cover_proxy = _thumbnail_payload(entry.get("cover") or entry.get("pic"))
        episodes = [_normalize_episode(ep, f"Tập {index + 1}") for index, ep in enumerate(entry.get("eps") or [])]
        items.append(
            {
                "id": entry.get("season_id") or entry.get("media_id") or entry.get("season_type"),
                "media_id": entry.get("media_id"),
                "season_id": entry.get("season_id"),
                "season_type": entry.get("season_type"),
                "title": _strip_html(entry.get("title")) or "Untitled",
                "url": entry.get("url") or (f"https://www.bilibili.com/bangumi/media/md{entry.get('media_id')}" if entry.get("media_id") else None),
                "thumbnail": cover,
                "thumbnail_proxy": cover_proxy,
                "description": _strip_html(entry.get("desc") or entry.get("description")),
                "areas": entry.get("areas") or "",
                "styles": entry.get("styles") or "",
                "pubtime": entry.get("pubtime"),
                "episode_count": entry.get("eps_count") or len(episodes),
                "episodes": episodes,
            }
        )
    return {"items": items}


def get_bilibili_season_detail(season_id: int | str) -> dict[str, Any]:
    try:
        response = httpx.get(
            "https://api.bilibili.com/pgc/view/web/season",
            params={"season_id": season_id},
            headers=_bilibili_headers(),
            timeout=15,
            follow_redirects=True,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if _soft_bilibili_http_error(exc):
            return {
                "id": season_id,
                "season_id": season_id,
                "title": "Bilibili series",
                "episode_count": 0,
                "episodes": [],
                "warning": _bilibili_unavailable_payload(exc, "season detail")["warning"],
            }
        raise
    payload = response.json()
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("message") or "Bilibili season detail failed")
    data = payload.get("result") or {}
    cover, cover_proxy = _thumbnail_payload(data.get("cover"))
    episodes = [_normalize_episode(ep, f"Tập {index + 1}") for index, ep in enumerate(data.get("episodes") or [])]
    return {
        "id": data.get("season_id"),
        "media_id": data.get("media_id"),
        "season_id": data.get("season_id"),
        "title": data.get("title"),
        "url": data.get("share_url") or (f"https://www.bilibili.com/bangumi/media/md{data.get('media_id')}" if data.get("media_id") else None),
        "thumbnail": cover,
        "thumbnail_proxy": cover_proxy,
        "description": data.get("evaluate"),
        "areas": ", ".join(item.get("name", "") for item in data.get("areas", []) if item.get("name")),
        "styles": ", ".join(item.get("name", "") for item in data.get("styles", []) if item.get("name")),
        "episode_count": len(episodes),
        "episodes": episodes,
    }


def fetch_bilibili_image(url: str) -> tuple[bytes, str]:
    if not url.startswith(("https://", "http://")):
        raise ValueError("URL ảnh không hợp lệ")
    response = httpx.get(url, headers=_bilibili_headers(), timeout=15)
    response.raise_for_status()
    return response.content, response.headers.get("content-type", "image/jpeg")


def _ensure_bilibili_url(url: str) -> str:
    cleaned = url.strip()
    parsed = urllib.parse.urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc.endswith("bilibili.com"):
        raise ValueError("Chỉ hỗ trợ URL video Bilibili")
    return cleaned


def get_bilibili_preview_source(source_url: str) -> dict[str, Any]:
    try:
        return capture_bilibili_media_source(source_url)
    except Exception:
        pass

    source_url = _ensure_bilibili_url(source_url)
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "http_headers": _bilibili_headers(),
        "extractor_args": {"bilibili": {"prefer_multi_flv": False}},
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=False)
    except Exception as exc:
        raise RuntimeError(f"Không lấy được stream preview từ Bilibili: {exc}") from exc

    formats = info.get("formats") or []
    playable = [item for item in formats if item.get("url") and item.get("vcodec") != "none"]
    selected = next((item for item in playable if item.get("ext") == "mp4" and item.get("acodec") != "none"), None)
    selected = selected or next((item for item in playable if item.get("protocol") in {"m3u8", "m3u8_native"}), None)
    if not selected:
        direct_url = info.get("url")
        selected = {"url": direct_url, "ext": info.get("ext"), "protocol": info.get("protocol")}
    if not selected.get("url"):
        raise RuntimeError("Bilibili chỉ trả về DASH video/audio tách rời, chưa thể preview bằng video HTML thuần")

    return {
        "title": info.get("title"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "ext": selected.get("ext"),
        "protocol": selected.get("protocol"),
        "format_id": selected.get("format_id"),
        "stream_url": f"/api/video-localization/bilibili/stream?url={urllib.parse.quote(source_url)}",
    }


def _pick_dash_stream(streams: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not streams:
        return None
    usable = [item for item in streams if item.get("baseUrl") or item.get("base_url")]
    if not usable:
        return None
    return sorted(usable, key=lambda item: item.get("bandwidth") or 0, reverse=True)[0]


def _dash_stream_url(stream: dict[str, Any]) -> str | None:
    return stream.get("baseUrl") or stream.get("base_url")


def capture_bilibili_media_source(source_url: str) -> dict[str, Any]:
    source_url = _ensure_bilibili_url(source_url)
    from playwright.sync_api import sync_playwright

    captured_media: list[str] = []
    captured_dash: dict[str, Any] | None = None
    title = "Bilibili preview"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(extra_http_headers=_bilibili_headers())
        page = context.new_page()

        def capture_response(response):
            nonlocal captured_dash
            response_url = response.url
            lowered = response_url.lower()
            if any(token in lowered for token in (".m3u8", ".mp4")):
                captured_media.append(response_url)
                return
            if "/playurl" not in lowered:
                return
            try:
                payload = response.json()
            except Exception:
                return
            data = payload.get("data") or payload.get("result") or {}
            dash = data.get("dash") or {}
            video = _pick_dash_stream(dash.get("video") or [])
            audio = _pick_dash_stream(dash.get("audio") or [])
            if video and audio:
                captured_dash = {
                    "duration": data.get("timelength"),
                    "video": video,
                    "audio": audio,
                }

        page.on("response", capture_response)
        page.goto(source_url, wait_until="domcontentloaded", timeout=30000)
        try:
            title = page.title(timeout=5000) or title
        except Exception:
            pass
        try:
            page.locator("video").first.click(timeout=3000)
        except Exception:
            pass
        page.wait_for_timeout(7000)
        context.close()
        browser.close()

    for media_url in captured_media:
        if ".m3u8" in media_url.lower():
            return {
                "title": title,
                "type": "hls",
                "stream_url": f"/api/video-localization/bilibili/media-proxy?url={urllib.parse.quote(media_url)}",
            }
        if ".mp4" in media_url.lower():
            return {
                "title": title,
                "type": "mp4",
                "stream_url": f"/api/video-localization/bilibili/media-proxy?url={urllib.parse.quote(media_url)}",
            }

    if captured_dash:
        video = captured_dash["video"]
        audio = captured_dash["audio"]
        video_url = _dash_stream_url(video)
        audio_url = _dash_stream_url(audio)
        if video_url and audio_url:
            manifest = (
                "/api/video-localization/bilibili/dash-manifest"
                f"?video_url={urllib.parse.quote(video_url)}"
                f"&audio_url={urllib.parse.quote(audio_url)}"
                f"&video_mime={urllib.parse.quote(video.get('mimeType') or 'video/mp4')}"
                f"&audio_mime={urllib.parse.quote(audio.get('mimeType') or 'audio/mp4')}"
                f"&video_codecs={urllib.parse.quote(video.get('codecs') or '')}"
                f"&audio_codecs={urllib.parse.quote(audio.get('codecs') or '')}"
                f"&video_init={urllib.parse.quote(((video.get('SegmentBase') or video.get('segment_base') or {}).get('Initialization') or (video.get('SegmentBase') or video.get('segment_base') or {}).get('initialization') or '0-0'))}"
                f"&audio_init={urllib.parse.quote(((audio.get('SegmentBase') or audio.get('segment_base') or {}).get('Initialization') or (audio.get('SegmentBase') or audio.get('segment_base') or {}).get('initialization') or '0-0'))}"
                f"&video_index={urllib.parse.quote(((video.get('SegmentBase') or video.get('segment_base') or {}).get('indexRange') or (video.get('SegmentBase') or video.get('segment_base') or {}).get('index_range') or '0-0'))}"
                f"&audio_index={urllib.parse.quote(((audio.get('SegmentBase') or audio.get('segment_base') or {}).get('indexRange') or (audio.get('SegmentBase') or audio.get('segment_base') or {}).get('index_range') or '0-0'))}"
                f"&video_bandwidth={video.get('bandwidth') or 0}"
                f"&audio_bandwidth={audio.get('bandwidth') or 0}"
                f"&width={video.get('width') or 1280}"
                f"&height={video.get('height') or 720}"
                f"&duration_ms={captured_dash.get('duration') or 0}"
            )
            return {
                "title": title,
                "type": "dash",
                "stream_url": manifest,
            }

    raise RuntimeError("Không bắt được gói media Bilibili có thể phát")


def get_bilibili_direct_stream_url(source_url: str) -> str:
    preview = get_bilibili_preview_source(source_url)
    source_url = _ensure_bilibili_url(source_url)
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "http_headers": _bilibili_headers(),
        "extractor_args": {"bilibili": {"prefer_multi_flv": False}},
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(source_url, download=False)
    formats = info.get("formats") or []
    candidates = [
        item for item in formats
        if item.get("url") and item.get("vcodec") != "none"
    ]
    selected = next((item for item in candidates if item.get("ext") == preview.get("ext") and item.get("format_id") == preview.get("format_id")), None)
    selected = selected or next((item for item in candidates if item.get("ext") == "mp4" and item.get("acodec") != "none"), None)
    selected = selected or next((item for item in candidates if item.get("protocol") in {"m3u8", "m3u8_native"}), None)
    direct_url = (selected or {}).get("url") or info.get("url")
    if not direct_url:
        raise RuntimeError("Không lấy được direct stream URL")
    return direct_url


def get_bilibili_video_detail(bvid: str | None = None, aid: int | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if bvid:
        params["bvid"] = bvid
    elif aid:
        params["aid"] = aid
    else:
        raise ValueError("bvid hoặc aid là bắt buộc")

    response = httpx.get(
        "https://api.bilibili.com/x/web-interface/view",
        params=params,
        headers=_bilibili_headers(),
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("message") or "Bilibili API detail failed")
    data = payload.get("data") or {}
    return {
        "id": data.get("bvid") or data.get("aid"),
        "bvid": data.get("bvid"),
        "aid": data.get("aid"),
        "cid": data.get("cid"),
        "title": data.get("title"),
        "url": f"https://www.bilibili.com/video/{data.get('bvid')}" if data.get("bvid") else None,
        "duration": data.get("duration"),
        "thumbnail": data.get("pic"),
        "uploader": (data.get("owner") or {}).get("name"),
        "description": data.get("desc"),
        "pages": data.get("pages") or [],
    }


def create_video_localization_job(user_id: int, source_url: str, title: str | None = None) -> dict[str, Any]:
    job_id = uuid4().hex
    work_dir = WORK_ROOT / f"user_{user_id}" / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    job = {
        "id": job_id,
        "user_id": user_id,
        "source": "bilibili",
        "source_url": source_url.strip(),
        "title": (title or "Bilibili video").strip(),
        "status": "queued",
        "progress": 0,
        "step": "queued",
        "error": None,
        "work_dir": str(work_dir.relative_to(PROJECT_ROOT)),
        "source_video": None,
        "subtitle_path": None,
        "output_video": None,
        "segments": [],
        "parts": [],
        "total_parts": 0,
        "created_at": _now(),
        "updated_at": _now(),
    }
    video_localization_jobs_col.insert_one(job)
    return _serialize_job(job) or job


def get_video_localization_job(user_id: int, job_id: str) -> dict[str, Any] | None:
    return _serialize_job(video_localization_jobs_col.find_one({"id": job_id, "user_id": user_id}))


def list_video_localization_jobs(user_id: int, limit: int = 20) -> dict[str, Any]:
    cursor = (
        video_localization_jobs_col.find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(max(1, min(limit, 100)))
    )
    return {"items": list(cursor)}


def _update_job(job_id: str, **fields: Any) -> None:
    fields["updated_at"] = _now()
    video_localization_jobs_col.update_one({"id": job_id}, {"$set": fields})


def _download_video(source_url: str, output_dir: Path) -> Path:
    output_template = str(output_dir / "source.%(ext)s")
    ydl_opts = {
        "format": "bestvideo+bestaudio/best",
        "outtmpl": output_template,
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": _ffmpeg(),
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([source_url])
    mp4 = output_dir / "source.mp4"
    if mp4.exists():
        return mp4
    candidates = list(output_dir.glob("source.*"))
    if not candidates:
        raise RuntimeError("Không tải được video nguồn")
    return candidates[0]


def _split_video(video_path: Path, segments_dir: Path, seconds: int = 60) -> list[Path]:
    segments_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(segments_dir / "part_%03d.mp4")
    _run_ffmpeg([
        "-i",
        str(video_path),
        "-map",
        "0",
        "-c",
        "copy",
        "-f",
        "segment",
        "-segment_time",
        str(seconds),
        "-reset_timestamps",
        "1",
        pattern,
    ])
    return sorted(segments_dir.glob("part_*.mp4"))


def _extract_frames(segment_path: Path, frames_dir: Path) -> list[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(frames_dir / "frame_%04d.jpg")
    _run_ffmpeg(["-i", str(segment_path), "-vf", "fps=1/2", "-q:v", "2", pattern])
    return sorted(frames_dir.glob("frame_*.jpg"))


def _video_ocr_workers() -> int:
    raw = os.getenv("VIDEO_OCR_WORKERS", "").strip()
    if raw.isdigit():
        return max(1, int(raw))
    return min(4, max(1, (os.cpu_count() or 2) - 1))


def _recognize_frame_text_worker(payload: tuple[int, str, str]) -> tuple[int, str]:
    index, frame_path, lang = payload
    try:
        from PIL import Image
        import pytesseract
    except Exception as exc:
        raise RuntimeError("Thiếu pillow/pytesseract hoặc Tesseract OCR local chưa được cài") from exc

    with Image.open(frame_path) as image:
        text = pytesseract.image_to_string(image, lang=lang).strip()
    return index, re.sub(r"\s+", " ", text)


def _ocr_frames(frames: list[Path]) -> list[dict[str, Any]]:
    workers = _video_ocr_workers()
    lang = os.getenv("OCR_LANG", "chi_sim+eng")
    payloads = [(index, str(frame), lang) for index, frame in enumerate(frames)]
    if workers <= 1 or len(frames) < 8:
        recognized = [_recognize_frame_text_worker(payload) for payload in payloads]
    else:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            recognized = list(executor.map(_recognize_frame_text_worker, payloads, chunksize=4))

    results = []
    last_text = ""
    for index, text in sorted(recognized, key=lambda item: item[0]):
        if not text or text == last_text:
            continue
        start = index * 2
        results.append({"start": start, "end": start + 2, "text": text})
        last_text = text
    return results


async def _translate_labels(labels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not labels:
        return []
    response = await get_client().chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "Bạn dịch phụ đề tiếng Trung/Anh sang tiếng Việt tự nhiên. "
                    "Giữ nguyên start/end. Trả về JSON array, mỗi item có start, end, source_text, translated_text."
                ),
            },
            {"role": "user", "content": json.dumps(labels, ensure_ascii=False)},
        ],
        temperature=0.2,
        max_tokens=2000,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    data = json.loads(content)
    translated = data.get("items") if isinstance(data, dict) else data
    if not isinstance(translated, list):
        return []
    return translated


async def _process_localization_part(
    job_id: str,
    index: int,
    total: int,
    segment_path: Path,
    frames_root: Path,
    concurrency: asyncio.Semaphore,
) -> list[dict[str, Any]]:
    async with concurrency:
        segment_offset = index * 60
        video_localization_jobs_col.update_one(
            {"id": job_id},
            {
                "$set": {
                    "step": f"ocr_part_{index + 1}",
                    f"parts.{index}.status": "running",
                    "updated_at": _now(),
                }
            },
        )
        frames_dir = frames_root / segment_path.stem
        frames = await asyncio.to_thread(_extract_frames, segment_path, frames_dir)
        labels = await asyncio.to_thread(_ocr_frames, frames)
        for label in labels:
            label["start"] = float(label["start"]) + segment_offset
            label["end"] = float(label["end"]) + segment_offset

        video_localization_jobs_col.update_one(
            {"id": job_id},
            {
                "$set": {
                    "step": f"translate_part_{index + 1}",
                    f"parts.{index}.status": "translating",
                    "updated_at": _now(),
                }
            },
        )
        translated = await _translate_labels(labels)
        part_labels = translated or labels
        part_summary = {
            "index": index,
            "title": f"Part {index + 1}",
            "start": segment_offset,
            "end": segment_offset + 60,
            "status": "completed",
            "label_count": len(part_labels),
            "updated_at": _now(),
        }
        progress = 35 + int(((index + 1) / max(total, 1)) * 45)
        video_localization_jobs_col.update_one(
            {"id": job_id},
            {
                "$set": {
                    f"parts.{index}": part_summary,
                    "updated_at": _now(),
                },
                "$max": {"progress": min(progress, 80)},
                "$push": {"segments": {"$each": part_labels}},
            },
        )
        return part_labels


def _srt_time(seconds: float) -> str:
    total_ms = int(seconds * 1000)
    ms = total_ms % 1000
    total_seconds = total_ms // 1000
    second = total_seconds % 60
    minute = (total_seconds // 60) % 60
    hour = total_seconds // 3600
    return f"{hour:02d}:{minute:02d}:{second:02d},{ms:03d}"


def _write_srt(labels: list[dict[str, Any]], output_path: Path) -> None:
    lines: list[str] = []
    for index, label in enumerate(labels, start=1):
        text = label.get("translated_text") or label.get("text") or label.get("source_text") or ""
        if not text:
            continue
        lines.extend([
            str(index),
            f"{_srt_time(float(label['start']))} --> {_srt_time(float(label['end']))}",
            str(text).strip(),
            "",
        ])
    output_path.write_text("\n".join(lines), encoding="utf-8")


def _burn_subtitles(video_path: Path, srt_path: Path, output_path: Path) -> None:
    subtitle_path = str(srt_path).replace("\\", "/").replace(":", "\\:")
    _run_ffmpeg([
        "-i",
        str(video_path),
        "-vf",
        f"subtitles='{subtitle_path}':force_style='FontName=Arial,FontSize=22,Outline=1,Shadow=1'",
        "-c:a",
        "copy",
        str(output_path),
    ])


async def process_video_localization_job(job_id: str) -> None:
    job = video_localization_jobs_col.find_one({"id": job_id})
    if not job:
        return
    work_dir = PROJECT_ROOT / job["work_dir"]
    segments_dir = work_dir / "segments"
    frames_root = work_dir / "frames"

    try:
        _update_job(job_id, status="running", step="download", progress=5)
        video_path = await asyncio.to_thread(_download_video, job["source_url"], work_dir)
        _update_job(job_id, source_video=str(video_path.relative_to(PROJECT_ROOT)), progress=20)

        _update_job(job_id, step="split", progress=25)
        segment_paths = await asyncio.to_thread(_split_video, video_path, segments_dir)
        if not segment_paths:
            raise RuntimeError("Không tách được video thành segment")

        pending_parts = [
            {
                "index": index,
                "title": f"Part {index + 1}",
                "start": index * 60,
                "end": (index + 1) * 60,
                "status": "pending",
                "label_count": 0,
            }
            for index, _ in enumerate(segment_paths)
        ]
        _update_job(
            job_id,
            step="process_parts",
            progress=30,
            segments=[],
            parts=pending_parts,
            total_parts=len(segment_paths),
        )

        max_parallel_parts = max(1, int(os.getenv("VIDEO_LOCALIZATION_PARALLEL_PARTS", "3")))
        concurrency = asyncio.Semaphore(max_parallel_parts)
        part_results = await asyncio.gather(*[
            _process_localization_part(job_id, index, len(segment_paths), segment_path, frames_root, concurrency)
            for index, segment_path in enumerate(segment_paths)
        ])
        all_labels = [label for labels in part_results for label in labels]
        all_labels.sort(key=lambda item: (float(item.get("start", 0)), float(item.get("end", 0))))
        video_localization_jobs_col.update_one(
            {"id": job_id},
            {"$set": {"segments": all_labels, "updated_at": _now()}},
        )

        _update_job(job_id, step="render_subtitle", progress=85)
        srt_path = work_dir / "translated.srt"
        output_path = work_dir / f"{_safe_filename(job.get('title') or job_id)}_vi.mp4"
        await asyncio.to_thread(_write_srt, all_labels, srt_path)
        await asyncio.to_thread(_burn_subtitles, video_path, srt_path, output_path)
        shutil.rmtree(frames_root, ignore_errors=True)

        _update_job(
            job_id,
            status="completed",
            step="completed",
            progress=100,
            subtitle_path=str(srt_path.relative_to(PROJECT_ROOT)),
            output_video=str(output_path.relative_to(PROJECT_ROOT)),
            completed_at=_now(),
        )
    except Exception as exc:
        _update_job(job_id, status="failed", step="failed", error=str(exc), progress=100)
