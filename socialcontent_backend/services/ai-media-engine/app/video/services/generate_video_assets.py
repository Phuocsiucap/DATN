from __future__ import annotations

import hashlib
import os
import re
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import httpx

from app.video.services.generate_video_constants import VIDEO_ASSET_DIR


VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v"}
STREAM_EXTENSIONS = {".m3u8"}
MAX_SOURCE_VIDEO_BYTES = int(os.getenv("GENERATE_VIDEO_MAX_SOURCE_VIDEO_BYTES") or str(250 * 1024 * 1024))


def hydrate_source_video_assets(source: dict[str, Any], *, max_videos: int = 1) -> list[str]:
    if not isinstance(source, dict):
        return []

    saved_urls: list[str] = []
    notes: list[dict[str, Any]] = []
    for item in collect_source_video_items(source):
        if len(saved_urls) >= max_videos:
            break

        existing = _existing_storage_url(item)
        if existing:
            saved_urls.append(existing)
            continue

        result = _download_video_item(source, item)
        if result.get("asset_path"):
            item["storage_url"] = result["asset_path"]
            item["download_status"] = "SAVED"
            item["download_source_url"] = result.get("source_url")
            saved_urls.append(str(result["asset_path"]))
        else:
            item["download_status"] = "SKIPPED"
            item["download_error"] = result.get("error") or "No directly downloadable video URL found."
        notes.append({key: value for key, value in result.items() if key != "asset_path"})

    source.setdefault("asset_capture", {})
    source["asset_capture"]["source_videos"] = notes
    source["source_video_assets"] = saved_urls
    return saved_urls


def collect_source_video_items(source: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    def add_many(value: Any) -> None:
        if isinstance(value, list):
            for entry in value:
                if isinstance(entry, dict):
                    items.append(entry)
                elif entry:
                    items.append({"media_type": "VIDEO", "source_url": str(entry)})

    add_many(source.get("media"))
    add_many(source.get("videos"))

    source_content = source.get("source_content") if isinstance(source.get("source_content"), dict) else {}
    add_many(source_content.get("media"))
    add_many(source_content.get("videos"))

    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    raw_source_content = raw_article.get("source_content") if isinstance(raw_article.get("source_content"), dict) else {}
    add_many(raw_source_content.get("media"))
    add_many(raw_source_content.get("videos"))

    raw_source = raw_article.get("raw_source") if isinstance(raw_article.get("raw_source"), dict) else {}
    add_many(raw_source.get("media"))
    add_many(raw_source.get("videos"))

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        if not _is_video_item(item):
            continue
        key = _first_video_url(item)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _download_video_item(source: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    candidates = _candidate_video_urls(item)
    referer = _source_referer(source, item)
    headers = _download_headers(referer)
    errors: list[str] = []

    with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(30.0, read=60.0), headers=headers) as client:
        for candidate in candidates:
            media_url = _resolve_direct_media_url(client, candidate, referer)
            if not media_url:
                errors.append(f"No media request found for {candidate}")
                continue
            if _is_stream_url(media_url):
                errors.append(f"HLS stream is not saved without a transmux step: {media_url}")
                continue
            try:
                asset_path = _download_direct_video(client, media_url, source)
            except Exception as exc:
                errors.append(str(exc))
                continue
            return {"asset_path": asset_path, "source_url": media_url, "discovery_url": candidate}

    return {"source_url": candidates[0] if candidates else None, "error": "; ".join(errors[-3:])}


def _resolve_direct_media_url(client: httpx.Client, url: str, referer: str | None) -> str | None:
    if _is_direct_video_url(url):
        return url

    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    for key in ("file", "src", "url", "video", "video_url"):
        nested = _first_query_value(params.get(key))
        if nested and _is_media_url(nested):
            return nested

    if parsed.scheme not in {"http", "https"}:
        return None

    try:
        response = client.get(url, headers=_download_headers(referer or url))
        response.raise_for_status()
    except Exception:
        return None

    content_type = response.headers.get("content-type", "").lower()
    final_url = str(response.url)
    if content_type.startswith("video/"):
        return final_url
    if not _looks_like_html(content_type, response.text[:256]):
        return final_url if _is_media_url(final_url) else None

    return _discover_media_url_from_html(response.text, final_url)


def _discover_media_url_from_html(body: str, base_url: str) -> str | None:
    candidates: list[str] = []
    for match in re.finditer(r'https?:\\?/\\?/[^"\'\s<>]+?\.(?:mp4|webm|mov|m4v|m3u8)(?:[^"\'\s<>]*)?', body, flags=re.IGNORECASE):
        candidates.append(_clean_url(match.group(0)))

    for match in re.finditer(r'\b(?:src|data-src|data-video-src|data-file|file)\s*[:=]\s*["\']([^"\']+)["\']', body, flags=re.IGNORECASE):
        value = _clean_url(match.group(1))
        if value and _is_media_url(value):
            candidates.append(urljoin(base_url, value))

    for candidate in candidates:
        if _is_direct_video_url(candidate):
            return candidate
    return next((candidate for candidate in candidates if _is_stream_url(candidate)), None)


def _download_direct_video(client: httpx.Client, url: str, source: dict[str, Any]) -> str:
    VIDEO_ASSET_DIR.mkdir(parents=True, exist_ok=True)
    suffix = _video_suffix(url)
    filename = f"source-video-{_owner_key(source)}-{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}{suffix}"
    target = VIDEO_ASSET_DIR / filename
    if target.exists() and target.stat().st_size > 0:
        return f"assets/videos/{filename}"

    tmp_target = target.with_suffix(f"{target.suffix}.tmp")
    downloaded = 0
    with client.stream("GET", url) as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").lower()
        if content_type and not (content_type.startswith("video/") or "octet-stream" in content_type):
            raise RuntimeError(f"URL is not a downloadable video asset: {url}")
        content_length = int(response.headers.get("content-length") or 0)
        if content_length > MAX_SOURCE_VIDEO_BYTES:
            raise RuntimeError(f"Source video is too large to cache locally: {content_length} bytes")

        with tmp_target.open("wb") as file:
            for chunk in response.iter_bytes():
                if not chunk:
                    continue
                downloaded += len(chunk)
                if downloaded > MAX_SOURCE_VIDEO_BYTES:
                    raise RuntimeError(f"Source video exceeded local cache limit: {MAX_SOURCE_VIDEO_BYTES} bytes")
                file.write(chunk)

    if downloaded <= 0:
        raise RuntimeError(f"Downloaded video is empty: {url}")
    shutil.move(str(tmp_target), str(target))
    return f"assets/videos/{filename}"


def _candidate_video_urls(item: dict[str, Any]) -> list[str]:
    urls = []
    for key in ("storage_url", "source_url", "url", "contentUrl", "content_url", "embed_url", "embedUrl"):
        value = item.get(key)
        if value:
            urls.append(str(value))
    return list(dict.fromkeys(_clean_url(url) for url in urls if _clean_url(url)))


def _first_video_url(item: dict[str, Any]) -> str:
    urls = _candidate_video_urls(item)
    return urls[0] if urls else ""


def _existing_storage_url(item: dict[str, Any]) -> str | None:
    storage_url = str(item.get("storage_url") or "").strip()
    if storage_url.startswith("assets/videos/"):
        return storage_url
    return None


def _is_video_item(item: dict[str, Any]) -> bool:
    media_type = str(item.get("media_type") or item.get("type") or "").upper()
    mime_type = str(item.get("mime_type") or item.get("mimeType") or "").lower()
    url = _first_video_url(item)
    return "VIDEO" in media_type or mime_type.startswith("video/") or _is_media_url(url)


def _is_media_url(url: str) -> bool:
    return _is_direct_video_url(url) or _is_stream_url(url)


def _is_direct_video_url(url: str) -> bool:
    return _url_suffix(url) in VIDEO_EXTENSIONS


def _is_stream_url(url: str) -> bool:
    return _url_suffix(url) in STREAM_EXTENSIONS


def _url_suffix(url: str) -> str:
    return Path(urlparse(str(url)).path).suffix.lower()


def _video_suffix(url: str) -> str:
    suffix = _url_suffix(url)
    return suffix if suffix in VIDEO_EXTENSIONS else ".mp4"


def _source_referer(source: dict[str, Any], item: dict[str, Any]) -> str | None:
    for value in (
        item.get("referer"),
        source.get("source_url"),
        source.get("canonical_url"),
        (source.get("source_content") or {}).get("source_url") if isinstance(source.get("source_content"), dict) else None,
        (source.get("source_content") or {}).get("canonical_url") if isinstance(source.get("source_content"), dict) else None,
    ):
        if value:
            return str(value)
    return None


def _download_headers(referer: str | None) -> dict[str, str]:
    headers = {
        "Accept": "video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        ),
    }
    if referer:
        headers["Referer"] = referer
    return headers


def _owner_key(source: dict[str, Any]) -> str:
    value = str(source.get("workflow_id") or source.get("id") or "source").strip()
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", value)[:80] or "source"


def _first_query_value(value: Any) -> str:
    if isinstance(value, list):
        value = value[0] if value else ""
    return _clean_url(unquote(str(value or "")))


def _clean_url(value: Any) -> str:
    if not value:
        return ""
    url = str(value).replace("\\/", "/").strip()
    if url.startswith("//"):
        return f"https:{url}"
    return url


def _looks_like_html(content_type: str, prefix: str) -> bool:
    return "html" in content_type or prefix.lstrip().startswith(("<!doctype", "<html", "<"))
