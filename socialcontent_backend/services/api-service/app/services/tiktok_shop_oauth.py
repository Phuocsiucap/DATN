"""TikTok Shop OAuth 2.0 authorization flow service.

Manages session-based OAuth flow for TikTok Shop Partner API, following the
same pattern as tiktok_oauth.py with in-memory session storage and polling.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode, urlparse, parse_qsl

import httpx
from fastapi import HTTPException, status

from common.core.config import get_settings
from app.services.tiktok_shop_client import TikTokShopClient, TIKTOK_SHOP_API_BASE

logger = logging.getLogger(__name__)

# TikTok Shop OAuth endpoints
TIKTOK_SHOP_AUTHORIZE_URL = "https://services.tiktokshop.com/open/authorize"
TIKTOK_SHOP_TOKEN_PATH = "/api/token/get"

# Required scopes for affiliate functionality
REQUIRED_TIKTOK_SHOP_SCOPES = [
    "product.read",
    "affiliate.apply",
    "affiliate.order.read",
]


@dataclass
class TikTokShopOAuthSession:
    """OAuth session for TikTok Shop authorization flow."""

    session_id: str
    user_id: uuid.UUID
    state: str
    auth_url: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc) + timedelta(minutes=10))
    last_status: str = "pending"
    authorization_code: str | None = None

    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) >= self.expires_at


# In-memory session storage (same pattern as tiktok_oauth.py)
_sessions: dict[str, TikTokShopOAuthSession] = {}
_sessions_lock = asyncio.Lock()


def _require_tiktok_shop_config() -> tuple[str, str, str, str]:
    """Get and validate TikTok Shop OAuth configuration.

    Returns:
        Tuple of (app_key, app_secret, redirect_uri, scopes)

    Raises:
        HTTPException: If required config is missing
    """
    settings = get_settings()
    app_key = settings.tiktok_shop_app_key.strip()
    app_secret = settings.tiktok_shop_app_secret.strip()
    redirect_uri = settings.tiktok_shop_redirect_uri.strip()

    missing = [
        name
        for name, value in {
            "TIKTOK_SHOP_APP_KEY": app_key,
            "TIKTOK_SHOP_APP_SECRET": app_secret,
            "TIKTOK_SHOP_REDIRECT_URI": redirect_uri,
        }.items()
        if not value
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Thiếu cấu hình TikTok Shop OAuth: {', '.join(missing)}",
        )

    scopes = ",".join(REQUIRED_TIKTOK_SHOP_SCOPES)
    return app_key, app_secret, redirect_uri, scopes


async def start_oauth_session(session_id: str, user_id: uuid.UUID) -> dict[str, Any]:
    """Start TikTok Shop OAuth authorization session.

    Creates an in-memory session and returns the authorization URL for the user
    to visit. The user will be redirected back to redirect_uri after authorization.

    Args:
        session_id: Unique session identifier
        user_id: ID of user initiating OAuth

    Returns:
        dict with auth_url, state, session_id, expires_in

    Raises:
        HTTPException: If configuration is invalid
    """
    app_key, _app_secret, redirect_uri, scopes = _require_tiktok_shop_config()
    state = secrets.token_urlsafe(32)

    # Build authorization URL
    auth_params = {
        "app_key": app_key,
        "state": state,
        "redirect_uri": redirect_uri,
        "scope": scopes,
    }
    auth_url = f"{TIKTOK_SHOP_AUTHORIZE_URL}?{urlencode(auth_params)}"

    session = TikTokShopOAuthSession(
        session_id=session_id,
        user_id=user_id,
        state=state,
        auth_url=auth_url,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )

    async with _sessions_lock:
        _sessions[session_id] = session

    logger.info("Started TikTok Shop OAuth session %s for user %s", session_id, user_id)

    return {
        "auth_url": auth_url,
        "state": state,
        "session_id": session_id,
        "expires_in": 600,  # 10 minutes
    }


async def get_oauth_session(session_id: str, user_id: uuid.UUID) -> TikTokShopOAuthSession | None:
    """Retrieve OAuth session by ID and user.

    Args:
        session_id: Session identifier
        user_id: User ID (for security check)

    Returns:
        Session object if found and user matches, None otherwise
    """
    async with _sessions_lock:
        session = _sessions.get(session_id)
    if not session or session.user_id != user_id:
        return None
    return session


async def stop_oauth_session(session_id: str, user_id: uuid.UUID) -> None:
    """Stop and remove OAuth session.

    Args:
        session_id: Session identifier
        user_id: User ID (for security check)
    """
    async with _sessions_lock:
        session = _sessions.get(session_id)
        if session and session.user_id == user_id:
            _sessions.pop(session_id, None)
            logger.info("Stopped TikTok Shop OAuth session %s", session_id)


async def poll_oauth_status(session_id: str, user_id: uuid.UUID) -> dict[str, Any]:
    """Poll OAuth session status.

    Frontend should poll this endpoint while waiting for user to authorize.
    Once authorization_code is set via handle_callback, returns authenticated=True.

    Args:
        session_id: Session identifier
        user_id: User ID

    Returns:
        dict with session_active, authenticated, status, token_data (if authenticated)
    """
    session = await get_oauth_session(session_id, user_id)
    if not session:
        return {"session_active": False, "authenticated": False, "profile": None}

    if session.is_expired():
        session.last_status = "expired"
        return {
            "session_active": False,
            "authenticated": False,
            "profile": None,
            "status": "expired",
        }

    # Check if authorization code has been set
    if session.authorization_code:
        # Exchange code for tokens
        token_data = await exchange_authorization_code(session.authorization_code)
        shop_info = await fetch_shop_info(token_data["access_token"])

        # Clean up session
        await stop_oauth_session(session_id, user_id)

        return {
            "session_active": False,
            "authenticated": True,
            "status": "confirmed",
            "token_data": token_data,
            "shop_info": shop_info,
        }

    return {
        "session_active": True,
        "authenticated": False,
        "status": session.last_status,
        "auth_url": session.auth_url,
    }


async def handle_callback(session_id: str, user_id: uuid.UUID, code: str, state: str) -> None:
    """Handle OAuth callback from TikTok Shop.

    This is called by the callback route handler after redirect.
    Validates state and stores authorization code in session for polling.

    Args:
        session_id: Session identifier
        user_id: User ID
        code: Authorization code from TikTok Shop
        state: State parameter (must match session state)

    Raises:
        HTTPException: If session not found, expired, or state mismatch
    """
    session = await get_oauth_session(session_id, user_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TikTok Shop OAuth session không tồn tại hoặc đã hết hạn",
        )

    if session.is_expired():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TikTok Shop OAuth session đã hết hạn",
        )

    if state != session.state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TikTok Shop OAuth state không khớp",
        )

    session.authorization_code = code
    session.last_status = "confirmed"
    logger.info("TikTok Shop OAuth callback received for session %s", session_id)


async def exchange_authorization_code(code: str) -> dict[str, Any]:
    """Exchange authorization code for access token.

    Calls TikTok Shop /api/token/get endpoint.

    Args:
        code: Authorization code from OAuth callback

    Returns:
        dict with access_token, refresh_token, expires_in, refresh_expires_in, scopes

    Raises:
        HTTPException: If token exchange fails
    """
    app_key, app_secret, _redirect_uri, _scopes = _require_tiktok_shop_config()

    client = TikTokShopClient(app_key, app_secret)
    path = TIKTOK_SHOP_TOKEN_PATH
    params = {
        "app_key": app_key,
        "auth_code": code,
        "grant_type": "authorized_code",
    }

    try:
        response = await client.post(path, params=params)
        data = response.get("data", {})

        if not data.get("access_token"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="TikTok Shop không trả về access_token",
            )

        logger.info("TikTok Shop authorization code exchanged successfully")
        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "expires_in": data.get("access_token_expire_in", 0),
            "refresh_expires_in": data.get("refresh_token_expire_in", 0),
            "scopes": data.get("seller_granted_permissions", []),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to exchange TikTok Shop authorization code: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không đổi được TikTok Shop authorization code",
        ) from exc


async def fetch_shop_info(access_token: str) -> dict[str, Any]:
    """Fetch authorized shop information.

    Calls TikTok Shop /api/shop/get_authorized_shop endpoint.

    Args:
        access_token: Valid access token

    Returns:
        dict with shop_id, shop_name, shop_cipher, region

    Raises:
        HTTPException: If request fails
    """
    app_key, app_secret, _redirect_uri, _scopes = _require_tiktok_shop_config()

    client = TikTokShopClient(app_key, app_secret, access_token)
    path = "/api/shop/get_authorized_shop"

    try:
        response = await client.get(path)
        data = response.get("data", {})

        if not data.get("shop_id"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="TikTok Shop không trả về shop_id",
            )

        logger.info("TikTok Shop info fetched: shop_id=%s", data.get("shop_id"))
        return {
            "shop_id": data["shop_id"],
            "shop_name": data.get("shop_name", ""),
            "shop_cipher": data.get("shop_cipher", ""),
            "region": data.get("region", ""),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to fetch TikTok Shop info: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không lấy được thông tin TikTok Shop",
        ) from exc


def requested_tiktok_shop_scopes() -> list[str]:
    """Get list of requested TikTok Shop scopes.

    Returns:
        List of scope strings
    """
    return REQUIRED_TIKTOK_SHOP_SCOPES.copy()
