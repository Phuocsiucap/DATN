import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from urllib.parse import urljoin, quote
from typing import AsyncIterator

router = APIRouter()

TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)


def _build_headers(request: Request) -> dict[str, str]:
    headers = {
        "Referer": "https://vnexpress.net/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/115.0.0.0 Safari/537.36"
        ),
        "Accept": "*/*",
        "Accept-Encoding": "identity",
    }

    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header

    return headers


async def _stream_response(
    client: httpx.AsyncClient,
    res: httpx.Response,
) -> AsyncIterator[bytes]:
    try:
        async for chunk in res.aiter_raw():
            if chunk:
                yield chunk
    except (httpx.ReadError, httpx.RemoteProtocolError) as exc:
        print(f"Video proxy upstream stream ended early: {exc}")
    finally:
        await res.aclose()
        await client.aclose()

@router.get("")
async def video_proxy(request: Request, url: str = Query(..., description="The video URL to proxy")):
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")

    headers = _build_headers(request)

    base_proxy_url = str(request.base_url).rstrip("/") + "/api/proxy?url="

    if ".m3u8" in url:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
                res = await client.get(url, headers=headers)
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Proxy request failed: {e}") from e

        if res.status_code >= 400:
            raise HTTPException(status_code=res.status_code, detail="Proxy failed")

        rewritten_lines = []
        for line in res.text.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                absolute_uri = urljoin(url, stripped)
                rewritten_lines.append(f"{base_proxy_url}{quote(absolute_uri, safe='')}")
            else:
                rewritten_lines.append(line)

        return Response(
            content="\n".join(rewritten_lines),
            media_type="application/vnd.apple.mpegurl",
        )

    client = httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True)
    try:
        req = client.build_request("GET", url, headers=headers)
        res = await client.send(req, stream=True)
    except httpx.RequestError as e:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"Proxy request failed: {e}") from e

    if res.status_code >= 400:
        detail = await res.aread()
        await res.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=res.status_code,
            detail=detail[:200].decode("utf-8", errors="ignore") or "Proxy failed",
        )

    response_headers = {}
    for header in ("content-length", "content-range", "accept-ranges"):
        if header in res.headers:
            response_headers[header] = res.headers[header]

    return StreamingResponse(
        _stream_response(client, res),
        status_code=res.status_code,
        headers=response_headers,
        media_type=res.headers.get("content-type", "application/octet-stream"),
    )
