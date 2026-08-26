from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, status

from common.core.config import get_settings
from common.db.models import SocialProfile

INBOX_VIDEO_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
PUBLISH_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
MAX_CHUNK_SIZE = 64 * 1024 * 1024


def _raise_for_tiktok_error(payload: dict[str, Any], fallback: str) -> None:
    error = payload.get("error")
    if isinstance(error, dict):
        code = error.get("code")
        if code and code != "ok":
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=error.get("message") or fallback)
        return
    if error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error) or fallback)


def _json_payload(response: httpx.Response, fallback: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=fallback) from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=fallback)
    return payload


def ensure_tiktok_access_token(profile: SocialProfile) -> str:
    token = (profile.access_token or "").strip()
    expires_at = profile.token_expires_at
    needs_refresh = not token
    if expires_at:
        needs_refresh = needs_refresh or expires_at <= datetime.utcnow() + timedelta(minutes=5)
    if not needs_refresh:
        return token

    refresh_token = (profile.refresh_token or "").strip()
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TikTok profile chưa có refresh token. Hãy kết nối lại tài khoản.")

    settings = get_settings()
    with httpx.Client(timeout=20) as client:
        response = client.post(
            TOKEN_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache"},
            data={
                "client_key": settings.tiktok_client_key,
                "client_secret": settings.tiktok_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
        )
    payload = _json_payload(response, "TikTok refresh token response không hợp lệ")
    if response.status_code >= 400:
        _raise_for_tiktok_error(payload, "Không refresh được TikTok access token")
        raise HTTPException(status_code=response.status_code, detail="Không refresh được TikTok access token")
    _raise_for_tiktok_error(payload, "Không refresh được TikTok access token")

    next_access_token = payload.get("access_token")
    if not next_access_token:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TikTok refresh response thiếu access_token")

    profile.access_token = next_access_token
    profile.refresh_token = payload.get("refresh_token") or profile.refresh_token
    profile.token_expires_at = datetime.utcnow() + timedelta(seconds=int(payload.get("expires_in") or 0))
    if payload.get("refresh_expires_in"):
        profile.refresh_expires_at = datetime.utcnow() + timedelta(seconds=int(payload["refresh_expires_in"]))
    if payload.get("scope"):
        profile.scopes_jsonb = [item.strip() for item in str(payload["scope"]).split(",") if item.strip()]
    metadata = dict(profile.metadata_json or {})
    metadata["last_token_refresh_at"] = datetime.utcnow().isoformat()
    metadata["token_type"] = payload.get("token_type") or metadata.get("token_type")
    profile.metadata_json = metadata
    return next_access_token


def upload_video_to_tiktok_inbox(profile: SocialProfile, video_path: Path) -> dict[str, Any]:
    if profile.platform != "tiktok":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile này không phải TikTok")
    scopes = set(profile.scopes_jsonb or [])
    if "video.upload" not in scopes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TikTok profile chưa cấp scope video.upload. Hãy kết nối lại với scope này.")
    video_path = video_path.resolve()
    if not video_path.exists() or not video_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy file video để upload TikTok")

    token = ensure_tiktok_access_token(profile)
    video_size = video_path.stat().st_size
    if video_size <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File video rỗng")

    chunk_size = min(video_size, MAX_CHUNK_SIZE)
    total_chunk_count = (video_size + chunk_size - 1) // chunk_size
    with httpx.Client(timeout=30) as client:
        response = client.post(
            INBOX_VIDEO_INIT_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"},
            json={
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": video_size,
                    "chunk_size": chunk_size,
                    "total_chunk_count": total_chunk_count,
                }
            },
        )
    payload = _json_payload(response, "TikTok video init response không hợp lệ")
    if response.status_code >= 400:
        _raise_for_tiktok_error(payload, "Không khởi tạo được TikTok video upload")
        raise HTTPException(status_code=response.status_code, detail="Không khởi tạo được TikTok video upload")
    _raise_for_tiktok_error(payload, "Không khởi tạo được TikTok video upload")

    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    upload_url = data.get("upload_url")
    publish_id = data.get("publish_id")
    if not upload_url or not publish_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TikTok init response thiếu upload_url/publish_id")

    _upload_file_chunks(upload_url, video_path, video_size, chunk_size)
    status_data = fetch_tiktok_publish_status(token, publish_id)
    return {"publish_id": publish_id, "upload_url": upload_url, "status": status_data, "video_size": video_size}


def _upload_file_chunks(upload_url: str, video_path: Path, video_size: int, chunk_size: int) -> None:
    with httpx.Client(timeout=120) as client, video_path.open("rb") as handle:
        start = 0
        while start < video_size:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            end = start + len(chunk) - 1
            response = client.put(
                upload_url,
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {start}-{end}/{video_size}",
                },
                content=chunk,
            )
            if response.status_code not in {200, 201, 206}:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"TikTok upload chunk thất bại: HTTP {response.status_code}",
                )
            start = end + 1


def fetch_tiktok_publish_status(access_token: str, publish_id: str) -> dict[str, Any]:
    with httpx.Client(timeout=20) as client:
        response = client.post(
            PUBLISH_STATUS_URL,
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json; charset=UTF-8"},
            json={"publish_id": publish_id},
        )
    payload = _json_payload(response, "TikTok publish status response không hợp lệ")
    if response.status_code >= 400:
        _raise_for_tiktok_error(payload, "Không lấy được TikTok publish status")
        raise HTTPException(status_code=response.status_code, detail="Không lấy được TikTok publish status")
    _raise_for_tiktok_error(payload, "Không lấy được TikTok publish status")
    return payload.get("data") if isinstance(payload.get("data"), dict) else {}
