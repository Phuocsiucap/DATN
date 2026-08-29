from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, status

from common.core.config import get_settings
from common.db.models import SocialProfile

INBOX_VIDEO_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
DIRECT_VIDEO_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/"
CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/"
PUBLISH_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
MAX_CHUNK_SIZE = 64 * 1024 * 1024
DEFAULT_DIRECT_PRIVACY_LEVEL = "SELF_ONLY"
TIKTOK_PUBLISH_COMPLETE_STATUS = "PUBLISH_COMPLETE"
TIKTOK_PUBLISH_FAILED_STATUSES = {"FAILED", "PUBLISH_FAILED"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc_aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _scope_set(value: Any) -> set[str]:
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = [str(item) for item in value]
    else:
        values = []
    scopes: set[str] = set()
    for item in values:
        scopes.update(part.strip() for part in re.split(r"[\s,]+", item) if part.strip())
    return scopes


def _raise_for_tiktok_error(payload: dict[str, Any], fallback: str) -> None:
    error = payload.get("error")
    if isinstance(error, dict):
        code = error.get("code")
        if code and code != "ok":
            message = error.get("message") or fallback
            if code == "unaudited_client_can_only_post_to_private_accounts":
                message = "TikTok Direct Post client chưa audit chỉ đăng được vào tài khoản TikTok đang để private và privacy SELF_ONLY."
            elif code == "privacy_level_option_mismatch":
                message = "Privacy level không nằm trong privacy_level_options TikTok trả về cho creator này."
            elif "content-sharing-guidelines" in str(message):
                message = (
                    "TikTok chặn Direct Post theo Content Sharing Guidelines. "
                    "Với app chưa audit, hãy để tài khoản TikTok ở chế độ private và dùng privacy SELF_ONLY; "
                    "nếu vẫn lỗi, app cần qua TikTok audit."
                )
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message)
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


def tiktok_publish_status_value(status_data: dict[str, Any] | None) -> str:
    if not isinstance(status_data, dict):
        return ""
    return str(status_data.get("status") or "").strip().upper()


def tiktok_publish_is_complete(status_data: dict[str, Any] | None) -> bool:
    return tiktok_publish_status_value(status_data) == TIKTOK_PUBLISH_COMPLETE_STATUS


def tiktok_publish_is_failed(status_data: dict[str, Any] | None) -> bool:
    return tiktok_publish_status_value(status_data) in TIKTOK_PUBLISH_FAILED_STATUSES


def extract_tiktok_public_post_id(status_data: dict[str, Any] | None) -> str | None:
    if not isinstance(status_data, dict):
        return None
    candidate_keys = (
        "publicaly_available_post_id",
        "publicly_available_post_id",
        "post_id",
        "video_id",
    )
    for key in candidate_keys:
        value = status_data.get(key)
        if value:
            return str(value).strip()
    public_posts = status_data.get("publicaly_available_post_ids") or status_data.get("publicly_available_post_ids")
    if isinstance(public_posts, list):
        for value in public_posts:
            if value:
                return str(value).strip()
    return None


def tiktok_publish_failure_reason(status_data: dict[str, Any] | None) -> str | None:
    if not isinstance(status_data, dict):
        return None
    for key in ("fail_reason", "failure_reason", "error_message", "message"):
        value = status_data.get(key)
        if value:
            return str(value)
    return None


def poll_tiktok_publish_status(
    access_token: str,
    publish_id: str,
    *,
    max_attempts: int = 12,
    interval_seconds: float = 10,
) -> dict[str, Any]:
    last_status: dict[str, Any] = {}
    for attempt in range(max(max_attempts, 1)):
        if attempt > 0:
            time.sleep(max(interval_seconds, 0))
        last_status = fetch_tiktok_publish_status(access_token, publish_id)
        if tiktok_publish_is_complete(last_status) or tiktok_publish_is_failed(last_status):
            break
    return last_status


def ensure_tiktok_access_token(profile: SocialProfile) -> str:
    token = (profile.access_token or "").strip()
    expires_at = profile.token_expires_at
    needs_refresh = not token
    if expires_at:
        needs_refresh = needs_refresh or _as_utc_aware(expires_at) <= _utc_now() + timedelta(minutes=5)
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
    profile.token_expires_at = _utc_now() + timedelta(seconds=int(payload.get("expires_in") or 0))
    if payload.get("refresh_expires_in"):
        profile.refresh_expires_at = _utc_now() + timedelta(seconds=int(payload["refresh_expires_in"]))
    if payload.get("scope"):
        profile.scopes_jsonb = sorted(_scope_set(payload["scope"]))
    metadata = dict(profile.metadata_json or {})
    metadata["last_token_refresh_at"] = _utc_now().isoformat()
    metadata["token_type"] = payload.get("token_type") or metadata.get("token_type")
    profile.metadata_json = metadata
    return next_access_token


def upload_video_to_tiktok_inbox(profile: SocialProfile, video_path: Path) -> dict[str, Any]:
    if profile.platform != "tiktok":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile này không phải TikTok")
    scopes = _scope_set(profile.scopes_jsonb)
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


def direct_post_video_to_tiktok(
    profile: SocialProfile,
    video_path: Path,
    *,
    caption: str | None = None,
    privacy_level: str | None = None,
    disable_comment: bool = False,
    disable_duet: bool = False,
    disable_stitch: bool = False,
    is_aigc: bool = True,
    brand_content_toggle: bool = False,
    brand_organic_toggle: bool = False,
) -> dict[str, Any]:
    if profile.platform != "tiktok":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile này không phải TikTok")
    scopes = _scope_set(profile.scopes_jsonb)
    if "video.publish" not in scopes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TikTok profile chưa cấp scope video.publish. Hãy kết nối lại tài khoản để dùng đăng trực tiếp.")
    video_path = video_path.resolve()
    if not video_path.exists() or not video_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy file video để đăng TikTok")

    token = ensure_tiktok_access_token(profile)
    creator_info = query_tiktok_creator_info(token)
    privacy_options = creator_info.get("privacy_level_options") if isinstance(creator_info, dict) else None
    resolved_privacy = _resolve_privacy_level(privacy_level, privacy_options)

    video_size = video_path.stat().st_size
    if video_size <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File video rỗng")

    chunk_size = min(video_size, MAX_CHUNK_SIZE)
    total_chunk_count = (video_size + chunk_size - 1) // chunk_size
    post_info = {
        "title": _caption_for_tiktok(caption),
        "privacy_level": resolved_privacy,
        "disable_comment": disable_comment,
        "disable_duet": disable_duet,
        "disable_stitch": disable_stitch,
        "is_aigc": is_aigc,
        "brand_content_toggle": brand_content_toggle,
        "brand_organic_toggle": brand_organic_toggle,
    }
    with httpx.Client(timeout=30) as client:
        response = client.post(
            DIRECT_VIDEO_INIT_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"},
            json={
                "post_info": post_info,
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": video_size,
                    "chunk_size": chunk_size,
                    "total_chunk_count": total_chunk_count,
                },
            },
        )
    payload = _json_payload(response, "TikTok direct post init response không hợp lệ")
    if response.status_code >= 400:
        _raise_for_tiktok_error(payload, "Không khởi tạo được TikTok Direct Post")
        raise HTTPException(status_code=response.status_code, detail="Không khởi tạo được TikTok Direct Post")
    _raise_for_tiktok_error(payload, "Không khởi tạo được TikTok Direct Post")

    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    upload_url = data.get("upload_url")
    publish_id = data.get("publish_id")
    if not upload_url or not publish_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TikTok Direct Post response thiếu upload_url/publish_id")

    _upload_file_chunks(upload_url, video_path, video_size, chunk_size)
    status_data = fetch_tiktok_publish_status(token, publish_id)
    return {
        "publish_id": publish_id,
        "upload_url": upload_url,
        "status": status_data,
        "video_size": video_size,
        "privacy_level": resolved_privacy,
        "creator_info": creator_info,
    }


def query_tiktok_creator_info(access_token: str) -> dict[str, Any]:
    with httpx.Client(timeout=20) as client:
        response = client.post(
            CREATOR_INFO_URL,
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json; charset=UTF-8"},
        )
    payload = _json_payload(response, "TikTok creator info response không hợp lệ")
    if response.status_code >= 400:
        _raise_for_tiktok_error(payload, "Không lấy được TikTok creator info")
        raise HTTPException(status_code=response.status_code, detail="Không lấy được TikTok creator info")
    _raise_for_tiktok_error(payload, "Không lấy được TikTok creator info")
    return payload.get("data") if isinstance(payload.get("data"), dict) else {}


def _resolve_privacy_level(requested: str | None, options: Any) -> str:
    candidates = [str(item) for item in options] if isinstance(options, list) else []
    value = (requested or DEFAULT_DIRECT_PRIVACY_LEVEL).strip() or DEFAULT_DIRECT_PRIVACY_LEVEL
    if not candidates or value in candidates:
        return value
    if DEFAULT_DIRECT_PRIVACY_LEVEL in candidates:
        return DEFAULT_DIRECT_PRIVACY_LEVEL
    return candidates[0]


def _caption_for_tiktok(caption: str | None) -> str:
    return (caption or "").strip()[:2200]


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
