"""TikTok Shop API client with HMAC-SHA256 signing.

This client handles low-level HTTP communication with TikTok Shop Partner API,
including request signing, authentication, and error handling.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

# TikTok Shop API base URL
TIKTOK_SHOP_API_BASE = "https://open-api.tiktokglobalshop.com"


class TikTokShopClient:
    """Low-level HTTP client for TikTok Shop Partner API with HMAC-SHA256 signing."""

    def __init__(self, app_key: str, app_secret: str, access_token: str | None = None):
        """Initialize TikTok Shop API client.

        Args:
            app_key: TikTok Shop app key (client ID)
            app_secret: TikTok Shop app secret for HMAC signing
            access_token: Optional access token for authenticated requests
        """
        self.app_key = app_key
        self.app_secret = app_secret
        self.access_token = access_token
        self.request_count = 0

    def _sign_request(self, query_params: dict[str, Any], body_params: dict[str, Any] | None = None) -> str:
        """Generate HMAC-SHA256 signature per TikTok Shop Partner API spec.

        Algorithm:
          1. Collect all query + body params, exclude 'sign' and 'access_token'
          2. Sort alphabetically by key
          3. Concatenate: {app_secret}{key1}{val1}{key2}{val2}...{app_secret}
          4. HMAC-SHA256 with key=app_secret, output hex digest
        """
        combined: dict[str, Any] = {}
        combined.update(query_params)
        if body_params:
            combined.update(body_params)

        # Exclude sign and access_token from signing
        to_sign = {k: v for k, v in combined.items() if k not in ("sign", "access_token")}

        sorted_pairs = sorted(to_sign.items())
        param_str = "".join(f"{k}{v}" for k, v in sorted_pairs)
        sign_str = f"{self.app_secret}{param_str}{self.app_secret}"

        return hmac.new(
            self.app_secret.encode("utf-8"),
            sign_str.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _prepare_params(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Prepare base query parameters (app_key, timestamp). No access_token here."""
        request_params: dict[str, Any] = params.copy() if params else {}
        request_params["app_key"] = self.app_key
        request_params["timestamp"] = str(int(time.time()))
        # access_token goes in x-tts-access-token header, NOT as a query param
        return request_params

    def _raise_for_error(self, payload: dict[str, Any], response: httpx.Response, fallback: str) -> None:
        """Check TikTok Shop API response for errors and raise HTTPException if found.

        Args:
            payload: Parsed JSON response
            response: HTTP response object
            fallback: Fallback error message if no specific error found

        Raises:
            HTTPException: If API returned an error
        """
        code = payload.get("code")
        message = payload.get("message")

        # code == 0 means success in TikTok Shop API
        if code == 0:
            return

        # Handle error response
        error_detail = message or fallback
        logger.warning(
            "TikTok Shop API error: code=%s, message=%s, status=%s",
            code,
            message,
            response.status_code,
        )

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY if response.status_code < 400 else response.status_code,
            detail=error_detail,
        )

    def _json_payload(self, response: httpx.Response, fallback: str) -> dict[str, Any]:
        """Parse JSON response and validate structure.

        Args:
            response: HTTP response object
            fallback: Fallback error message if parsing fails

        Returns:
            Parsed JSON payload

        Raises:
            HTTPException: If response is not valid JSON
        """
        try:
            payload = response.json()
        except ValueError as exc:
            logger.error("TikTok Shop API returned invalid JSON: %s", response.text[:500])
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=fallback) from exc

        if not isinstance(payload, dict):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=fallback)

        return payload

    async def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Send authenticated GET request to TikTok Shop API.

        Args:
            path: API endpoint path (e.g., "/authorization/202309/shops")
            params: Optional query parameters

        Returns:
            Parsed JSON response data

        Raises:
            HTTPException: If request fails or API returns error
        """
        request_params = self._prepare_params(params)
        request_params["sign"] = self._sign_request(request_params)

        headers = {"Content-Type": "application/json"}
        if self.access_token:
            headers["x-tts-access-token"] = self.access_token

        url = f"{TIKTOK_SHOP_API_BASE}{path}"
        self.request_count += 1

        if self.request_count % 10 == 0:
            logger.info("TikTok Shop API request count: %d", self.request_count)

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, params=request_params, headers=headers)

        payload = self._json_payload(response, f"TikTok Shop GET {path} response không hợp lệ")
        self._raise_for_error(payload, response, f"TikTok Shop GET {path} thất bại")

        logger.info("TikTok Shop GET %s → %s (code=%s)", path, response.status_code, payload.get("code"))
        return payload

    async def post(self, path: str, data: dict[str, Any] | None = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Send authenticated POST request to TikTok Shop API.

        Args:
            path: API endpoint path (e.g., "/affiliate_creator/202405/open_collaborations/products/search")
            data: Optional JSON body
            params: Optional query parameters

        Returns:
            Parsed JSON response data

        Raises:
            HTTPException: If request fails or API returns error
        """
        request_params = self._prepare_params(params)
        body = data or {}
        request_params["sign"] = self._sign_request(request_params, body)

        headers = {"Content-Type": "application/json"}
        if self.access_token:
            headers["x-tts-access-token"] = self.access_token

        url = f"{TIKTOK_SHOP_API_BASE}{path}"
        self.request_count += 1

        if self.request_count % 10 == 0:
            logger.info("TikTok Shop API request count: %d", self.request_count)

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                url,
                params=request_params,
                json=body,
                headers=headers,
            )

        payload = self._json_payload(response, f"TikTok Shop POST {path} response không hợp lệ")
        self._raise_for_error(payload, response, f"TikTok Shop POST {path} thất bại")

        logger.info("TikTok Shop POST %s → %s (code=%s)", path, response.status_code, payload.get("code"))
        return payload

    async def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        """Refresh access token using refresh token.

        Calls TikTok Shop /api/v2/token/refresh endpoint without signing.

        Args:
            refresh_token: Valid refresh token

        Returns:
            dict with new access_token, refresh_token, expires_in, refresh_expires_in

        Raises:
            HTTPException: If token refresh fails
        """
        path = "/api/v2/token/refresh"
        params = {
            "app_key": self.app_key,
            "app_secret": self.app_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }

        url = f"{TIKTOK_SHOP_API_BASE}{path}"

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(url, params=params)

        payload = self._json_payload(response, "TikTok Shop token refresh response không hợp lệ")
        self._raise_for_error(payload, response, "Không refresh được TikTok Shop access token")

        data = payload.get("data", {})
        if not data.get("access_token"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="TikTok Shop token refresh không trả về access_token",
            )

        logger.info("TikTok Shop token refreshed successfully")
        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "expires_in": data.get("access_token_expire_in", 0),
            "refresh_expires_in": data.get("refresh_token_expire_in", 0),
        }
