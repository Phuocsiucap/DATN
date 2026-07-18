from __future__ import annotations

from typing import Mapping

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import Response

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


def _forward_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS and key.lower() != "host"
    }


def _response_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS and key.lower() != "set-cookie"
    }


async def proxy_request(request: Request, target_url: str, service_name: str) -> Response:
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    try:
        async with httpx.AsyncClient(timeout=None, follow_redirects=False) as client:
            upstream = await client.request(
                request.method,
                target_url,
                content=await request.body(),
                headers=_forward_headers(request.headers),
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"{service_name} unavailable: {exc}") from exc

    response = Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=_response_headers(upstream.headers),
        media_type=upstream.headers.get("content-type"),
    )
    for cookie in upstream.headers.get_list("set-cookie"):
        response.headers.append("set-cookie", cookie)
    return response
