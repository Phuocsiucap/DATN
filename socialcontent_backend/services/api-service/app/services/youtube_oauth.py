"""YouTube (Google OAuth 2.0) authentication service.

Mirrors the structure of tiktok_oauth.py — one in-memory session dict,
same popup-and-poll pattern used on the frontend.

Flow:
  1. POST /social-profiles/youtube/oauth/init
     → build_google_auth_url() → return {auth_url, state}
  2. User opens popup, logs in, Google redirects to /auth/youtube/callback
  3. Callback handler stores (state → code) in _pending_codes
  4. GET /social-profiles/youtube/oauth/{state}/status
     → poll until code arrives → exchange_google_code() → fetch_youtube_channel_info()
     → upsert SocialProfile → return {authenticated: true}
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status

from common.core.config import get_settings

logger = logging.getLogger(__name__)

# ── Google OAuth 2.0 endpoints ────────────────────────────────────────────────
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"

# Session TTL – same as TikTok QR (5 min is enough for a browser redirect)
_SESSION_TTL_MINUTES = 10


# ── In-memory session store ───────────────────────────────────────────────────

@dataclass
class GoogleOAuthSession:
    """Tracks one pending Google OAuth round-trip."""

    state: str
    user_id: uuid.UUID
    profile_name: str
    target_profile_id: uuid.UUID | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc) + timedelta(minutes=_SESSION_TTL_MINUTES)
    )
    # Filled in by the callback route when Google redirects back
    code: str | None = None
    error: str | None = None

    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) >= self.expires_at


# state → session
_sessions: dict[str, GoogleOAuthSession] = {}
_sessions_lock = asyncio.Lock()

# ── Config helper ─────────────────────────────────────────────────────────────


def _require_google_config() -> tuple[str, str, str, str]:
    """Return (client_id, client_secret, redirect_uri, scopes) or raise 400."""
    s = get_settings()
    client_id = s.google_client_id.strip()
    client_secret = s.google_client_secret.strip()
    redirect_uri = s.google_redirect_uri.strip()
    scopes = s.google_oauth_scopes.strip()

    missing = [
        name
        for name, value in {
            "GOOGLE_CLIENT_ID": client_id,
            "GOOGLE_CLIENT_SECRET": client_secret,
            "GOOGLE_REDIRECT_URI": redirect_uri,
        }.items()
        if not value
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Thiếu cấu hình YouTube OAuth: {', '.join(missing)}",
        )
    return client_id, client_secret, redirect_uri, scopes


# ── URL builder ───────────────────────────────────────────────────────────────


def build_google_auth_url(state: str, client_id: str, redirect_uri: str, scopes: str) -> str:
    """Construct the Google consent-screen URL."""
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scopes,
        "state": state,
        # Force the consent screen to always show so we always get a refresh_token
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


# ── Session management ────────────────────────────────────────────────────────


async def init_youtube_oauth_session(
    user_id: uuid.UUID,
    profile_name: str,
    target_profile_id: uuid.UUID | None = None,
) -> dict[str, str]:
    """
    Create a pending OAuth session and return {auth_url, state}.
    Called by POST /social-profiles/youtube/oauth/init.
    """
    client_id, _secret, redirect_uri, scopes = _require_google_config()
    state = secrets.token_urlsafe(32)

    session = GoogleOAuthSession(
        state=state,
        user_id=user_id,
        profile_name=profile_name,
        target_profile_id=target_profile_id,
    )
    async with _sessions_lock:
        _sessions[state] = session

    auth_url = build_google_auth_url(state, client_id, redirect_uri, scopes)
    logger.info("YouTube OAuth session created user_id=%s state=%s", user_id, state)
    return {"auth_url": auth_url, "state": state}


async def receive_youtube_oauth_callback(state: str, code: str | None, error: str | None) -> None:
    """
    Store the authorization code (or error) received from Google's redirect.
    Called by GET /auth/youtube/callback.
    """
    async with _sessions_lock:
        session = _sessions.get(state)
    if not session:
        logger.warning("YouTube OAuth callback for unknown state=%s", state)
        return
    session.code = code
    session.error = error
    logger.info("YouTube OAuth callback received state=%s ok=%s", state, bool(code))


async def poll_youtube_oauth_session(
    state: str,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """
    Poll the session status.
    Returns a dict compatible with the TikTok web-OAuth poll shape so the
    frontend polling logic can be reused without modification:
      {session_active, authenticated, profile?, status, ...}
    Called by GET /social-profiles/youtube/oauth/{state}/status.
    """
    async with _sessions_lock:
        session = _sessions.get(state)

    if not session or session.user_id != user_id:
        return {"session_active": False, "authenticated": False, "profile": None, "status": "not_found"}

    if session.is_expired():
        return {"session_active": False, "authenticated": False, "profile": None, "status": "expired"}

    if session.error:
        return {
            "session_active": False,
            "authenticated": False,
            "profile": None,
            "status": "error",
            "error": session.error,
        }

    if not session.code:
        # Still waiting for the user to finish the Google consent screen
        return {"session_active": True, "authenticated": False, "profile": None, "status": "pending"}

    # Code arrived – exchange it
    _client_id, client_secret, redirect_uri, _scopes = _require_google_config()
    client_id = get_settings().google_client_id.strip()
    try:
        token_data = await exchange_google_code(session.code, client_id, client_secret, redirect_uri)
        channel_info = await fetch_youtube_channel_info(token_data["access_token"])
    except HTTPException as exc:
        async with _sessions_lock:
            _sessions.pop(state, None)
        return {
            "session_active": False,
            "authenticated": False,
            "profile": None,
            "status": "error",
            "error": exc.detail,
        }

    async with _sessions_lock:
        _sessions.pop(state, None)

    return {
        "session_active": False,
        "authenticated": True,
        "profile": None,
        "status": "confirmed",
        "session": session,
        "token_data": token_data,
        "channel_info": channel_info,
    }


async def cancel_youtube_oauth_session(state: str, user_id: uuid.UUID) -> None:
    """Remove the pending session. Called by POST /social-profiles/youtube/oauth/{state}/cancel."""
    async with _sessions_lock:
        session = _sessions.get(state)
        if session and session.user_id == user_id:
            _sessions.pop(state, None)


# ── Google token exchange ─────────────────────────────────────────────────────


async def exchange_google_code(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """Exchange authorization code for access + refresh tokens."""
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google token response không hợp lệ") from exc

    if response.status_code >= 400 or "error" in payload:
        err = payload.get("error_description") or payload.get("error") or "Không đổi được Google authorization code"
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(err))

    if not payload.get("access_token"):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google token response thiếu access_token")

    logger.info("Google token exchange OK token_type=%s", payload.get("token_type"))
    return payload


async def refresh_google_token(refresh_token: str) -> dict[str, Any]:
    """Use a refresh_token to get a new access_token."""
    client_id, client_secret, _redirect, _scopes = _require_google_config()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google refresh token response không hợp lệ") from exc

    if response.status_code >= 400 or "error" in payload:
        err = payload.get("error_description") or payload.get("error") or "Không refresh được Google token"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(err))

    if not payload.get("access_token"):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google refresh response thiếu access_token")

    return payload


# ── YouTube channel info ──────────────────────────────────────────────────────


async def fetch_youtube_channel_info(access_token: str) -> dict[str, Any]:
    """
    Fetch the authenticated user's YouTube channel info.
    Returns a normalized dict with keys: channel_id, title, description,
    custom_url, thumbnail_url, subscriber_count, video_count, view_count.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            YOUTUBE_CHANNELS_URL,
            params={"part": "snippet,statistics,brandingSettings", "mine": "true"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="YouTube channel info response không hợp lệ") from exc

    if response.status_code >= 400:
        err = _extract_google_error(payload)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=err or "Không lấy được thông tin YouTube channel")

    items = payload.get("items") or []
    if not items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tài khoản Google này chưa có YouTube channel. Hãy tạo channel trước.",
        )

    channel = items[0]
    snippet = channel.get("snippet") or {}
    statistics = channel.get("statistics") or {}
    thumbnails = snippet.get("thumbnails") or {}
    thumbnail_url = (
        (thumbnails.get("high") or thumbnails.get("medium") or thumbnails.get("default") or {}).get("url")
    )

    return {
        "channel_id": channel.get("id"),
        "title": snippet.get("title"),
        "description": snippet.get("description"),
        "custom_url": snippet.get("customUrl"),
        "thumbnail_url": thumbnail_url,
        "subscriber_count": int(statistics.get("subscriberCount") or 0),
        "video_count": int(statistics.get("videoCount") or 0),
        "view_count": int(statistics.get("viewCount") or 0),
        "raw": channel,  # keep full payload for metadata_json
    }


# ── Metadata builder (mirrors build_tiktok_token_metadata) ───────────────────


def build_youtube_token_metadata(token_data: dict[str, Any], channel_info: dict[str, Any]) -> dict[str, Any]:
    """Build the dict stored in SocialProfile.metadata_json."""
    return {
        "provider": "youtube",
        "token_type": token_data.get("token_type"),
        "scope": token_data.get("scope"),
        "channel": {k: v for k, v in channel_info.items() if k != "raw"},
    }


def _extract_google_error(payload: dict[str, Any]) -> str | None:
    """Extract a human-readable error message from a Google API error response."""
    error = payload.get("error")
    if isinstance(error, dict):
        return error.get("message")
    if isinstance(error, str):
        return payload.get("error_description") or error
    return None
