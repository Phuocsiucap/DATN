from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Callable, Any

from yt_dlp import YoutubeDL

from backend.bilibili_service.app.integrations.bilibili.china_crawler import ChinaVideoCrawler
from backend.bilibili_service.app.integrations.bilibili.render import find_ffmpeg


class VideoDownloader:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.crawler = ChinaVideoCrawler()

    def search_and_download(
        self,
        query: str,
        job_id: int,
        platform: str = "bilibili",
        max_duration_seconds: int = 180,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, str]:
        candidate = self.crawler.search([query], max_duration_seconds)
        result = self.download_url(
            candidate.url,
            job_id,
            max_duration_seconds=max_duration_seconds,
            progress_callback=progress_callback,
        )
        result["search_query"] = query
        result["search_provider"] = candidate.platform
        result["crawler_title"] = candidate.title
        if candidate.duration_seconds:
            result["crawler_duration_seconds"] = str(candidate.duration_seconds)
        return result

    def download_url(
        self,
        url: str,
        job_id: int,
        max_duration_seconds: int = 180,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, str]:
        outtmpl = str(self.cache_dir / f"job-{job_id}.%(ext)s")
        ffmpeg = find_ffmpeg()
        options = {
            "outtmpl": outtmpl,
            "format": "bv*[height<=1080]+ba/b[height<=1080]/best[height<=1080]/best",
            "merge_output_format": "mp4",
            "noplaylist": True,
            "socket_timeout": 20,
            "retries": 2,
            "fragment_retries": 2,
            "extractor_retries": 2,
            "match_filter": duration_filter(max_duration_seconds),
            "concurrent_fragment_downloads": int(os.getenv("ACD_YTDLP_FRAGMENTS", "16")),
            "http_chunk_size": int(os.getenv("ACD_YTDLP_HTTP_CHUNK_SIZE", str(10 * 1024 * 1024))),
            "continuedl": True,
            "noprogress": True,
            "quiet": True,
            "no_warnings": True,
        }
        if progress_callback:
            options["progress_hooks"] = [progress_callback]
        aria2c = shutil.which("aria2c")
        if aria2c:
            options["external_downloader"] = aria2c
            options["external_downloader_args"] = {
                "default": [
                    "-x",
                    os.getenv("ACD_ARIA2_CONNECTIONS", "16"),
                    "-s",
                    os.getenv("ACD_ARIA2_CONNECTIONS", "16"),
                    "-k",
                    "1M",
                ]
            }
        cookiefile = get_cookiefile()
        if cookiefile:
            options["cookiefile"] = cookiefile
        if ffmpeg:
            options["ffmpeg_location"] = ffmpeg
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True)
            path = find_downloaded_file(info, self.cache_dir, job_id, ydl)
        return {
            "raw_video_path": str(path),
            "raw_title": info.get("title") or "",
            "origin_video_url": url,
        }

    def extract_preview_url(self, url: str) -> dict[str, str | int | None]:
        stream = self.extract_preview_stream(url)
        return {
            "url": stream["url"],
            "title": stream["title"],
            "duration_seconds": stream["duration_seconds"],
        }

    def extract_video_metadata(self, url: str) -> dict[str, str | int | None]:
        options = {
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": 20,
            "extractor_retries": 2,
            "skip_download": True,
        }
        cookiefile = get_cookiefile()
        if cookiefile:
            options["cookiefile"] = cookiefile
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)

        duration = info.get("duration")
        webpage_url = str(info.get("webpage_url") or url)
        title = str(info.get("title") or "Bilibili video").strip()
        thumbnail = normalize_external_image(info.get("thumbnail"))
        bvid = extract_bilibili_bvid(url, webpage_url, str(info.get("id") or ""))
        embed_url = (
            f"https://player.bilibili.com/player.html?bvid={bvid}&autoplay=0"
            if bvid
            else webpage_url
        )
        description = str(info.get("description") or "").strip() or None
        return {
            "title": title,
            "url": webpage_url,
            "duration_seconds": int(duration) if isinstance(duration, (int, float)) else None,
            "thumbnail_url": thumbnail,
            "description": description,
            "embed_url": embed_url,
        }

    def extract_preview_stream(self, url: str) -> dict[str, str | int | dict[str, str] | None]:
        options = {
            "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/best[height<=720]/best",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": 20,
            "extractor_retries": 2,
        }
        cookiefile = get_cookiefile()
        if cookiefile:
            options["cookiefile"] = cookiefile
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)

        preview_url = info.get("url")
        if not preview_url and info.get("requested_formats"):
            preview_url = info["requested_formats"][0].get("url")
        if not preview_url and info.get("formats"):
            formats = [item for item in info["formats"] if item.get("url")]
            mp4_formats = [item for item in formats if item.get("ext") == "mp4"]
            selected = (mp4_formats or formats)[-1] if (mp4_formats or formats) else None
            preview_url = selected.get("url") if selected else None
        if not preview_url:
            raise RuntimeError("Could not extract preview stream URL")

        duration = info.get("duration")
        return {
            "url": preview_url,
            "title": info.get("title"),
            "duration_seconds": int(duration) if isinstance(duration, (int, float)) else None,
            "headers": info.get("http_headers") or {},
        }


def duration_filter(max_duration_seconds: int):
    def _filter(info: dict) -> str | None:
        duration = info.get("duration")
        if duration and duration > max_duration_seconds:
            return f"Video duration {duration}s exceeds limit {max_duration_seconds}s"
        return None

    return _filter


def get_cookiefile() -> str | None:
    cookiefile = os.getenv("ACD_YTDLP_COOKIES")
    if cookiefile and Path(cookiefile).exists():
        return cookiefile
    return None


def find_downloaded_file(info: dict, cache_dir: Path, job_id: int, ydl: YoutubeDL) -> Path:
    for download in info.get("requested_downloads") or []:
        filepath = download.get("filepath")
        if filepath and Path(filepath).exists():
            return Path(filepath)

    prepared = Path(ydl.prepare_filename(info))
    candidates = [
        prepared,
        prepared.with_suffix(".mp4"),
        *sorted(cache_dir.glob(f"job-{job_id}.*"), key=lambda path: path.stat().st_mtime, reverse=True),
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate

    raise FileNotFoundError(f"Could not find downloaded file for job {job_id}")


def normalize_external_image(value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith("//"):
        return f"https:{value}"
    return value


def extract_bilibili_bvid(*values: str) -> str | None:
    for value in values:
        match = re.search(r"(BV[0-9A-Za-z]+)", value or "")
        if match:
            return match.group(1)
    return None



