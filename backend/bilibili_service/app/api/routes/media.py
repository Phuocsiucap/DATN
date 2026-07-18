from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from backend.bilibili_service.app.api.deps import CurrentUser, get_current_user
from backend.bilibili_service.app.schemas.api import PreviewUrlRequest, PreviewUrlResponse
from backend.bilibili_service.app.services.runtime import downloader


router = APIRouter()


@router.post("/preview-url", response_model=PreviewUrlResponse)
def preview_url(req: PreviewUrlRequest, request: Request, current_user: CurrentUser = Depends(get_current_user)) -> PreviewUrlResponse:
    _ = current_user
    info = downloader.extract_preview_url(str(req.url))
    base_url = str(request.base_url).rstrip("/")
    info["url"] = f"{base_url}/preview-media?url={quote(str(req.url), safe='')}"
    return PreviewUrlResponse(**info)


@router.get("/preview-media")
def preview_media(url: str, request: Request, current_user: CurrentUser = Depends(get_current_user)) -> StreamingResponse:
    _ = current_user
    if not url.startswith(("https://", "http://")):
        raise HTTPException(status_code=400, detail="Invalid video URL")

    stream = downloader.extract_preview_stream(url)
    stream_url = stream.get("url")
    if not isinstance(stream_url, str):
        raise HTTPException(status_code=404, detail="Preview stream not found")

    upstream_headers = {
        **{key: str(value) for key, value in dict(stream.get("headers") or {}).items()},
        "Referer": "https://www.bilibili.com/",
    }
    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header

    def body():
        with httpx.Client(timeout=None, headers=upstream_headers, follow_redirects=True) as client:
            with client.stream("GET", stream_url) as response:
                response.raise_for_status()
                for chunk in response.iter_bytes():
                    yield chunk

    with httpx.Client(timeout=20.0, headers=upstream_headers, follow_redirects=True) as client:
        head = client.build_request("GET", stream_url, headers={"Range": range_header or "bytes=0-1"})
        probe = client.send(head, stream=True)
        probe.close()

    headers = {"Accept-Ranges": "bytes"}
    for key in ("content-length", "content-range"):
        value = probe.headers.get(key)
        if value:
            headers[key.title()] = value
    media_type = probe.headers.get("content-type", "video/mp4")
    status_code = 206 if probe.status_code == 206 else 200
    return StreamingResponse(body(), status_code=status_code, media_type=media_type, headers=headers)


@router.get("/image-proxy")
def image_proxy(url: str, current_user: CurrentUser = Depends(get_current_user)) -> Response:
    _ = current_user
    if not url.startswith(("https://", "http://")):
        raise HTTPException(status_code=400, detail="Invalid image URL")
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        ),
        "Referer": "https://www.bilibili.com/",
    }
    with httpx.Client(timeout=20.0, headers=headers, follow_redirects=True) as client:
        response = client.get(url)
        response.raise_for_status()
    media_type = response.headers.get("content-type", "image/jpeg")
    return Response(content=response.content, media_type=media_type)
