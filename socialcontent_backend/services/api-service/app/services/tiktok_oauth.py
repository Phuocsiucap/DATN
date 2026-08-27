from __future__ import annotations

import asyncio
import logging
import re
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qsl, unquote, urlencode, urlparse, urlunparse

import httpx
from fastapi import HTTPException, status

from common.core.config import get_settings

GET_QRCODE_URL = "https://open.tiktokapis.com/v2/oauth/get_qrcode/"
CHECK_QRCODE_URL = "https://open.tiktokapis.com/v2/oauth/check_qrcode/"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/"
logger = logging.getLogger(__name__)

FULL_USER_FIELDS = (
    "open_id,union_id,avatar_url,avatar_url_100,avatar_large_url,display_name,"
    "bio_description,profile_deep_link,profile_web_link,is_verified,username,"
    "follower_count,following_count,likes_count,video_count"
)
BASIC_USER_FIELDS = "open_id,union_id,avatar_url,avatar_url_100,avatar_large_url,display_name"
REQUIRED_TIKTOK_SCOPES = ("user.info.basic", "video.upload", "video.publish")


@dataclass
class TikTokOAuthQrSession:
    session_id: str
    user_id: uuid.UUID
    profile_name: str
    username: str | None
    state: str
    client_ticket: str
    token: str
    qr_url: str
    qr_image: str | None = None
    target_profile_id: uuid.UUID | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc) + timedelta(minutes=5))
    last_status: str = "new"

    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) >= self.expires_at


_sessions: dict[str, TikTokOAuthQrSession] = {}
_sessions_lock = asyncio.Lock()


def _require_tiktok_config() -> tuple[str, str, str, str]:
    settings = get_settings()
    client_key = settings.tiktok_client_key.strip()
    client_secret = settings.tiktok_client_secret.strip()
    redirect_uri = settings.tiktok_redirect_uri.strip()
    scopes = ",".join(_merge_required_scopes(_scope_list(settings.tiktok_oauth_scopes)))
    missing = [
        name
        for name, value in {
            "TIKTOK_CLIENT_KEY": client_key,
            "TIKTOK_CLIENT_SECRET": client_secret,
            "TIKTOK_REDIRECT_URI": redirect_uri,
        }.items()
        if not value
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Thiếu cấu hình TikTok OAuth: {', '.join(missing)}",
        )
    return client_key, client_secret, redirect_uri, scopes


def _raise_for_tiktok_error(payload: dict[str, Any], fallback: str) -> None:
    error = payload.get("error")
    if isinstance(error, dict):
        code = error.get("code")
        if code and code != "ok":
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=error.get("message") or fallback,
            )
        return
    if error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=payload.get("error_description") or str(error) or fallback,
        )


def _json_payload(response: httpx.Response, fallback: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=fallback) from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=fallback)
    return payload


def _payload_data(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    return data if isinstance(data, dict) else payload


def _redacted_payload(payload: dict[str, Any]) -> dict[str, Any]:
    hidden = {"access_token", "refresh_token", "client_secret", "token", "code"}

    def redact(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: ("***" if key in hidden else redact(inner)) for key, inner in value.items()}
        if isinstance(value, list):
            return [redact(item) for item in value]
        return value

    return redact(payload)


def _log_tiktok_response(label: str, response: httpx.Response, payload: dict[str, Any]) -> None:
    logger.info("TikTok %s response status=%s payload=%s", label, response.status_code, _redacted_payload(payload))


def _with_client_ticket(scan_qrcode_url: str, client_ticket: str) -> str:
    parsed = urlparse(scan_qrcode_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["client_ticket"] = client_ticket
    return urlunparse(parsed._replace(query=urlencode(query)))


def _extract_code(redirect_uri: str | None, explicit_code: str | None = None) -> str | None:
    candidate = explicit_code or redirect_uri
    if not candidate:
        return None
    decoded_candidate = unquote(str(candidate))
    if not decoded_candidate.startswith("http"):
        return decoded_candidate
    parsed = urlparse(decoded_candidate)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    code = params.get("code")
    return unquote(code) if code else None


def _scope_list(scope: str | None) -> list[str]:
    if not scope:
        return []
    values: list[str] = []
    for item in re.split(r"[\s,]+", str(scope)):
        normalized = item.strip()
        if normalized and normalized not in values:
            values.append(normalized)
    return values


def _merge_required_scopes(scopes: list[str]) -> list[str]:
    merged = list(scopes)
    for scope in REQUIRED_TIKTOK_SCOPES:
        if scope not in merged:
            merged.append(scope)
    return merged


def requested_tiktok_scopes() -> list[str]:
    _client_key, _client_secret, _redirect_uri, scopes = _require_tiktok_config()
    return scopes.split(",")


async def start_tiktok_oauth_qr_session(
    session_id: str,
    user_id: uuid.UUID,
    profile_name: str,
    username: str | None = None,
    target_profile_id: uuid.UUID | None = None,
) -> TikTokOAuthQrSession:
    client_key, _client_secret, _redirect_uri, scopes = _require_tiktok_config()
    state = secrets.token_urlsafe(32)
    client_ticket = secrets.token_urlsafe(24)

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            GET_QRCODE_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"client_key": client_key, "scope": scopes, "state": state},
        )
    payload = _json_payload(response, "TikTok QR response không hợp lệ")
    _log_tiktok_response("get_qrcode", response, payload)
    if response.status_code >= 400:
        _raise_for_tiktok_error(payload, "Không lấy được TikTok QR")
        raise HTTPException(status_code=response.status_code, detail="Không lấy được TikTok QR")
    _raise_for_tiktok_error(payload, "Không lấy được TikTok QR")

    data = _payload_data(payload)
    scan_qrcode_url = data.get("scan_qrcode_url")
    token = data.get("token")
    if not scan_qrcode_url or not token:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TikTok không trả về QR token hợp lệ")

    qr_url = _with_client_ticket(scan_qrcode_url, client_ticket)
    session = TikTokOAuthQrSession(
        session_id=session_id,
        user_id=user_id,
        profile_name=profile_name,
        username=username.strip() if username else None,
        state=state,
        client_ticket=client_ticket,
        token=token,
        qr_url=qr_url,
        qr_image=None,
        target_profile_id=target_profile_id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    async with _sessions_lock:
        _sessions[session_id] = session
    return session


async def get_tiktok_oauth_qr_session(session_id: str, user_id: uuid.UUID) -> TikTokOAuthQrSession | None:
    async with _sessions_lock:
        session = _sessions.get(session_id)
    if not session or session.user_id != user_id:
        return None
    return session


async def stop_tiktok_oauth_qr_session(session_id: str, user_id: uuid.UUID) -> None:
    async with _sessions_lock:
        session = _sessions.get(session_id)
        if session and session.user_id == user_id:
            _sessions.pop(session_id, None)


async def poll_tiktok_oauth_qr_session(session_id: str, user_id: uuid.UUID) -> dict[str, Any]:
    session = await get_tiktok_oauth_qr_session(session_id, user_id)
    if not session:
        return {"session_active": False, "authenticated": False, "profile": None}
    if session.is_expired():
        session.last_status = "expired"
        return {
            "session_active": False,
            "authenticated": False,
            "profile": None,
            "status": "expired",
            "qr_url": session.qr_url,
            "qr_image": session.qr_image,
        }

    client_key, client_secret, _redirect_uri, _scopes = _require_tiktok_config()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            CHECK_QRCODE_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"client_key": client_key, "client_secret": client_secret, "token": session.token},
        )
    payload = _json_payload(response, "TikTok QR status response không hợp lệ")
    _log_tiktok_response("check_qrcode", response, payload)
    if response.status_code >= 400:
        _raise_for_tiktok_error(payload, "Không kiểm tra được trạng thái TikTok QR")
        raise HTTPException(status_code=response.status_code, detail="Không kiểm tra được trạng thái TikTok QR")
    _raise_for_tiktok_error(payload, "Không kiểm tra được trạng thái TikTok QR")

    data = _payload_data(payload)
    qr_status = str(data.get("status") or "new").lower()
    session.last_status = qr_status
    if qr_status != "confirmed":
        return {
            "session_active": qr_status not in {"expired", "utilised"},
            "authenticated": False,
            "profile": None,
            "status": qr_status,
            "qr_url": session.qr_url,
            "qr_image": session.qr_image,
        }

    returned_ticket = data.get("client_ticket")
    if returned_ticket and returned_ticket != session.client_ticket:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TikTok client_ticket không khớp")

    returned_state = data.get("state")
    redirect_uri_value = data.get("redirect_uri") or data.get("redirect_url")
    if not returned_state and redirect_uri_value:
        returned_state = dict(parse_qsl(urlparse(str(redirect_uri_value)).query, keep_blank_values=True)).get("state")
    if returned_state and returned_state != session.state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TikTok state không khớp")

    code = _extract_code(str(redirect_uri_value) if redirect_uri_value else None, data.get("code"))
    if not code:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TikTok xác nhận nhưng không trả về authorization code")

    token_data = await exchange_tiktok_authorization_code(code)
    user_info = await fetch_tiktok_user_info(token_data["access_token"])
    return {
        "session_active": False,
        "authenticated": True,
        "profile": None,
        "status": "confirmed",
        "qr_url": session.qr_url,
        "qr_image": session.qr_image,
        "session": session,
        "token_data": token_data,
        "user_info": user_info,
    }


async def exchange_tiktok_authorization_code(code: str) -> dict[str, Any]:
    client_key, client_secret, _configured_redirect_uri, _scopes = _require_tiktok_config()
    request_body = {
        "client_key": client_key,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            TOKEN_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache"},
            data=request_body,
        )
    payload = _json_payload(response, "TikTok token response không hợp lệ")
    _log_tiktok_response("oauth_token", response, payload)
    if response.status_code >= 400:
        _raise_for_tiktok_error(payload, "Không đổi được TikTok authorization code")
        raise HTTPException(status_code=response.status_code, detail="Không đổi được TikTok authorization code")
    _raise_for_tiktok_error(payload, "Không đổi được TikTok authorization code")
    if not payload.get("access_token") or not payload.get("open_id"):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TikTok token response thiếu access_token/open_id")
    return payload


async def fetch_tiktok_user_info(access_token: str) -> dict[str, Any]:
    try:
        return await _fetch_tiktok_user_info(access_token, FULL_USER_FIELDS)
    except HTTPException:
        return await _fetch_tiktok_user_info(access_token, BASIC_USER_FIELDS)


async def _fetch_tiktok_user_info(access_token: str, fields: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            USER_INFO_URL,
            params={"fields": fields},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    payload = _json_payload(response, "TikTok user info response không hợp lệ")
    _log_tiktok_response("user_info", response, payload)
    if response.status_code >= 400:
        _raise_for_tiktok_error(payload, "Không lấy được thông tin TikTok user")
        raise HTTPException(status_code=response.status_code, detail="Không lấy được thông tin TikTok user")
    _raise_for_tiktok_error(payload, "Không lấy được thông tin TikTok user")
    user = (payload.get("data") or {}).get("user")
    if not isinstance(user, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TikTok user info response không hợp lệ")
    return user


def build_tiktok_token_metadata(token_data: dict[str, Any], user_info: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider": "tiktok",
        "token_type": token_data.get("token_type"),
        "scope": token_data.get("scope"),
        "granted_scopes": granted_scopes(token_data),
        "user": user_info,
    }


def granted_scopes(token_data: dict[str, Any]) -> list[str]:
    return _scope_list(token_data.get("scope"))
