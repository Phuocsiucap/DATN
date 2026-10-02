from typing import AsyncIterator
import re
from urllib.parse import quote, urljoin

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

router = APIRouter()

TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
HLS_URI_ATTR_RE = re.compile(r'URI=(["\'])(?P<uri>[^"\']+)\1', re.IGNORECASE)


def _build_headers(request: Request, original_url: str = "") -> dict[str, str]:
    headers = {
        "Referer": "https://www.bilibili.com/" if "bilibili" in original_url or "hdslb" in original_url else "https://vnexpress.net/",
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


async def _stream_response(client: httpx.AsyncClient, res: httpx.Response) -> AsyncIterator[bytes]:
    try:
        async for chunk in res.aiter_raw():
            if chunk:
                yield chunk
    except (httpx.ReadError, httpx.RemoteProtocolError) as exc:
        print(f"Media proxy upstream stream ended early: {exc}")
    finally:
        await res.aclose()
        await client.aclose()


def _proxied_media_url(base_proxy_url: str, media_url: str) -> str:
    return f"{base_proxy_url}{quote(media_url, safe='')}"


def _rewrite_hls_tag_uris(line: str, playlist_url: str, base_proxy_url: str) -> str:
    def replace(match: re.Match[str]) -> str:
        uri = match.group("uri").strip()
        if not uri or uri.startswith("data:"):
            return match.group(0)
        absolute_uri = urljoin(playlist_url, uri)
        return f'URI={match.group(1)}{_proxied_media_url(base_proxy_url, absolute_uri)}{match.group(1)}'

    return HLS_URI_ATTR_RE.sub(replace, line)


def _rewrite_hls_playlist(body: str, playlist_url: str, base_proxy_url: str) -> str:
    rewritten_lines = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            absolute_uri = urljoin(playlist_url, stripped)
            rewritten_lines.append(_proxied_media_url(base_proxy_url, absolute_uri))
        elif stripped.startswith("#"):
            rewritten_lines.append(_rewrite_hls_tag_uris(line, playlist_url, base_proxy_url))
        else:
            rewritten_lines.append(line)
    return "\n".join(rewritten_lines)


async def _resolve_bilibili_direct_url(url: str, kind: str = "video") -> str:
    import asyncio
    format_selector = (
        "ba/bestaudio"
        if kind == "audio"
        else "bv*[vcodec^=avc1][height<=720]/bv*[height<=720]/bv*"
    )
    cmd = [
        "python",
        "-m",
        "yt_dlp",
        "-f",
        format_selector,
        "-g",
        url,
    ]
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode == 0 and stdout:
            direct_url = stdout.decode("utf-8").strip().split('\n')[0]
            if direct_url.startswith("http"):
                return direct_url
        detail = stderr.decode("utf-8", errors="ignore").strip().splitlines()[-1:] or ["yt-dlp did not return a playable video URL"]
        raise HTTPException(status_code=502, detail=detail[0])
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        print(f"Failed to resolve bilibili url: {exc}")
        raise HTTPException(status_code=502, detail=f"Failed to resolve Bilibili preview URL: {exc}") from exc


@router.get("")
async def media_proxy(
    request: Request,
    url: str = Query(..., description="Media URL to proxy"),
    kind: str = Query("video", pattern="^(video|audio)$"),
):
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")

    headers = _build_headers(request, url)
    base_proxy_url = str(request.base_url).rstrip("/") + "/api/v1/media-proxy?url="

    if "bilibili.com/video/" in url:
        proxy_target_url = await _resolve_bilibili_direct_url(url, kind=kind)
    else:
        proxy_target_url = url

    if ".m3u8" in proxy_target_url.lower():
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
                res = await client.get(proxy_target_url, headers=headers)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Proxy request failed: {exc}") from exc

        if res.status_code >= 400:
            raise HTTPException(status_code=res.status_code, detail="Proxy failed")

        return Response(content=_rewrite_hls_playlist(res.text, proxy_target_url, base_proxy_url), media_type="application/vnd.apple.mpegurl")

    client = httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True)
    try:
        req = client.build_request("GET", proxy_target_url, headers=headers)
        res = await client.send(req, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"Proxy request failed: {exc}") from exc

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
