"""YouTube Data API v3 — video upload service.

Mirrors tiktok_posting.py in structure.  YouTube uses a resumable upload
protocol (two-step):
  1. POST to initiation endpoint → get upload session URI
  2. PUT video bytes to that URI (chunked for large files)

Reference:
  https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import HTTPException, status

from common.core.config import get_settings
from common.db.models import SocialProfile
from app.services.youtube_oauth import refresh_google_token

logger = logging.getLogger(__name__)

# ── YouTube API endpoints ─────────────────────────────────────────────────────
YOUTUBE_UPLOAD_INIT_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"

# Max chunk size for resumable uploads: 256 KB aligned, we use 8 MB
CHUNK_SIZE = 8 * 1024 * 1024

# Privacy levels supported by YouTube
VALID_PRIVACY_LEVELS = {"public", "private", "unlisted"}
DEFAULT_PRIVACY_LEVEL = "private"  # Safe default – public needs compliance audit


# ── Token helpers ─────────────────────────────────────────────────────────────


def _scope_set(value: Any) -> set[str]:
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = [str(item) for item in value]
    else:
        values = []
    scopes: set[str] = set()
    for item in values:
        scopes.update(part.strip() for part in re.split(r"[\s, ]+", item) if part.strip())
    return scopes


def _ensure_valid_token(profile: SocialProfile) -> str:
    """Return a valid access token, refreshing it if expired."""
    now = datetime.now(timezone.utc)
    expires_at = profile.token_expires_at
    if expires_at:
        # Coerce naive datetime to UTC-aware
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        # Refresh 2 minutes before actual expiry
        if now >= expires_at - timedelta(minutes=2):
            if not profile.refresh_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="YouTube access token đã hết hạn và không có refresh token.",
                )
            # Sync refresh (blocking) – acceptable in a scheduler context
            import asyncio

            try:
                loop = asyncio.get_event_loop()
                new_tokens = loop.run_until_complete(refresh_google_token(profile.refresh_token))
            except RuntimeError:
                # No running event loop (e.g. called from a thread)
                new_tokens = asyncio.run(refresh_google_token(profile.refresh_token))

            profile.access_token = new_tokens["access_token"]
            new_expires_in = int(new_tokens.get("expires_in") or 3600)
            profile.token_expires_at = now + timedelta(seconds=new_expires_in)
            logger.info("YouTube access token refreshed for profile_id=%s", profile.id)

    if not profile.access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="YouTube profile chưa có access token.",
        )
    return profile.access_token


def ensure_youtube_profile(profile: SocialProfile) -> None:
    """Raise 400 if the profile is not an active YouTube profile."""
    if profile.platform != "youtube":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Profile này không phải YouTube.",
        )
    if profile.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="YouTube profile chưa active hoặc đã bị xóa.",
        )
    if not profile.access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="YouTube profile chưa được kết nối (thiếu access token).",
        )


# ── Resumable upload ──────────────────────────────────────────────────────────


async def _initiate_resumable_upload(
    access_token: str,
    title: str,
    description: str,
    privacy_level: str,
    tags: list[str] | None = None,
    category_id: str = "22",  # 22 = People & Blogs
) -> str:
    """
    Step 1 of the resumable upload: send metadata, get back an upload session URI.
    Returns the upload_uri to PUT the video bytes to.
    """
    body: dict[str, Any] = {
        "snippet": {
            "title": title[:100],  # YouTube title limit = 100 chars
            "description": description[:5000],  # description limit = 5000 chars
            "categoryId": category_id,
        },
        "status": {
            "privacyStatus": privacy_level,
            "selfDeclaredMadeForKids": False,
        },
    }
    if tags:
        body["snippet"]["tags"] = tags[:500]

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            YOUTUBE_UPLOAD_INIT_URL,
            params={"uploadType": "resumable", "part": "snippet,status"},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": "video/*",
            },
            json=body,
        )

    if response.status_code not in {200, 201}:
        try:
            err_payload = response.json()
            err_msg = _extract_youtube_error(err_payload)
        except Exception:
            err_msg = None
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=err_msg or f"YouTube upload init thất bại (HTTP {response.status_code})",
        )

    upload_uri = response.headers.get("Location")
    if not upload_uri:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="YouTube không trả về upload URI",
        )
    logger.info("YouTube resumable upload session initiated")
    return upload_uri


async def _upload_video_from_url(upload_uri: str, video_url: str) -> dict[str, Any]:
    """
    Step 2: download the video from *video_url* and stream it to YouTube.
    Returns the completed video resource dict from YouTube.
    """
    # Download the video first so we know the size (required for Content-Length)
    logger.info("Downloading video for YouTube upload: %s", video_url)
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as dl_client:
        dl_response = await dl_client.get(video_url)
        if dl_response.status_code >= 400:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Không tải được video từ URL (HTTP {dl_response.status_code}): {video_url}",
            )
        video_bytes = dl_response.content

    total_size = len(video_bytes)
    logger.info("Uploading %d bytes to YouTube", total_size)

    async with httpx.AsyncClient(timeout=300) as up_client:
        response = await up_client.put(
            upload_uri,
            content=video_bytes,
            headers={
                "Content-Length": str(total_size),
                "Content-Type": "video/*",
            },
        )

    if response.status_code not in {200, 201}:
        try:
            err_payload = response.json()
            err_msg = _extract_youtube_error(err_payload)
        except Exception:
            err_msg = None
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=err_msg or f"YouTube video upload thất bại (HTTP {response.status_code})",
        )

    try:
        video_resource = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="YouTube upload response không hợp lệ",
        ) from exc

    video_id = video_resource.get("id")
    if not video_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="YouTube không trả về video ID sau upload")

    logger.info("YouTube video uploaded successfully video_id=%s", video_id)
    return video_resource


async def upload_video_to_youtube(
    profile: SocialProfile,
    video_url: str,
    title: str,
    description: str,
    privacy_level: str = DEFAULT_PRIVACY_LEVEL,
    tags: list[str] | None = None,
    category_id: str = "22",
) -> dict[str, Any]:
    """
    Full pipeline: validate profile → init resumable upload → stream video → return result.

    Returns a dict with:
      platform_publish_id, video_id, video_url, status, privacy_level, title
    """
    ensure_youtube_profile(profile)
    access_token = _ensure_valid_token(profile)

    # Normalise privacy
    if privacy_level not in VALID_PRIVACY_LEVELS:
        privacy_level = DEFAULT_PRIVACY_LEVEL

    upload_uri = await _initiate_resumable_upload(
        access_token=access_token,
        title=title,
        description=description,
        privacy_level=privacy_level,
        tags=tags,
        category_id=category_id,
    )

    video_resource = await _upload_video_from_url(upload_uri, video_url)
    video_id = video_resource["id"]
    watch_url = f"https://www.youtube.com/watch?v={video_id}"

    return {
        "platform_publish_id": video_id,
        "video_id": video_id,
        "post_url": watch_url,
        "status": "published",
        "privacy_level": privacy_level,
        "title": title,
        "raw": video_resource,
    }


# ── Sync channel stats (used by sync_profile) ────────────────────────────────


async def fetch_youtube_channel_stats(access_token: str) -> dict[str, Any]:
    """Return subscriber_count, video_count, view_count for the authed channel."""
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            YOUTUBE_CHANNELS_URL,
            params={"part": "statistics,snippet", "mine": "true"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="YouTube channels response không hợp lệ",
        ) from exc

    if response.status_code >= 400:
        err = _extract_youtube_error(payload)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=err or "Không lấy được YouTube channel stats",
        )

    items = payload.get("items") or []
    if not items:
        return {"subscriber_count": 0, "video_count": 0, "view_count": 0}

    stats = items[0].get("statistics") or {}
    return {
        "subscriber_count": int(stats.get("subscriberCount") or 0),
        "video_count": int(stats.get("videoCount") or 0),
        "view_count": int(stats.get("viewCount") or 0),
    }


# ── Error helper ──────────────────────────────────────────────────────────────


def _extract_youtube_error(payload: dict[str, Any]) -> str | None:
    error = payload.get("error")
    if isinstance(error, dict):
        errors = error.get("errors") or []
        if errors and isinstance(errors[0], dict):
            return errors[0].get("message") or error.get("message")
        return error.get("message")
    return None
