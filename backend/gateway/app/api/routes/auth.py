from __future__ import annotations

import os
from types import SimpleNamespace

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from backend.gateway.app.api.proxy import proxy_request

router = APIRouter()

USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")


def _user_from_payload(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(
        id=payload.get("id"),
        email=payload.get("email"),
        roles=[SimpleNamespace(name=role) for role in payload.get("roles", [])],
        is_active=payload.get("is_active", True),
        created_at=payload.get("created_at"),
    )


async def _fetch_current_user(request: Request) -> dict:
    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in {"host", "connection", "content-length"}
    }
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.get(f"{USER_SERVICE_URL}/api/auth/me", headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"User service unavailable: {exc}") from exc

    if response.status_code >= 400:
        detail = "Không xác thực được người dùng"
        try:
            detail = response.json().get("detail", detail)
        except ValueError:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)
    return response.json()


async def get_current_user(request: Request):
    return _user_from_payload(await _fetch_current_user(request))


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_auth(path: str, request: Request) -> Response:
    return await proxy_request(request, f"{USER_SERVICE_URL}/api/auth/{path}", "User service")


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_auth_root(request: Request) -> Response:
    return await proxy_request(request, f"{USER_SERVICE_URL}/api/auth", "User service")
