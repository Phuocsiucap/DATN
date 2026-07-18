from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from backend.gateway.app.api.routes.auth import get_current_user


router = APIRouter()

BILIBILI_SERVICE_URL = os.getenv("BILIBILI_SERVICE_URL", "http://127.0.0.1:8010").rstrip("/")
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_bilibili_service(
    path: str,
    request: Request,
    current_user = Depends(get_current_user),
) -> Response:
    target_url = f"{BILIBILI_SERVICE_URL}/api/bilibili-crawler/{path}"
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS and key.lower() != "host"
    }
    headers["X-User-Id"] = str(current_user.id)

    try:
        async with httpx.AsyncClient(timeout=None, follow_redirects=False) as client:
            upstream = await client.request(
                request.method,
                target_url,
                content=await request.body(),
                headers=headers,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Bilibili service unavailable: {exc}") from exc

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )
