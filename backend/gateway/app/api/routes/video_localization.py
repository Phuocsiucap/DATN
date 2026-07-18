from __future__ import annotations

import asyncio
import html
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from fastapi.responses import Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from urllib.parse import quote

from backend.gateway.app.api.routes.auth import get_current_user
from backend.gateway.app.services.video_localization_service import (
    PROJECT_ROOT,
    create_video_localization_job,
    fetch_bilibili_image,
    get_bilibili_season_detail,
    get_bilibili_direct_stream_url,
    get_bilibili_preview_source,
    get_bilibili_video_detail,
    get_video_localization_job,
    list_video_localization_jobs,
    process_video_localization_job,
    search_bilibili_series,
    search_bilibili_videos,
    _bilibili_headers,
)

router = APIRouter()
TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)


class VideoLocalizationJobRequest(BaseModel):
    source_url: str
    title: Optional[str] = None
    rights_confirmed: bool = False


@router.get("/bilibili/search")
def search_bilibili(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=20),
    current_user = Depends(get_current_user),
):
    _ = current_user
    return search_bilibili_videos(q, limit)


@router.get("/bilibili/series/search")
def search_bilibili_series_route(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=20),
    current_user = Depends(get_current_user),
):
    _ = current_user
    return search_bilibili_series(q, limit)


@router.get("/bilibili/series/{season_id}")
def bilibili_series_detail(
    season_id: str,
    current_user = Depends(get_current_user),
):
    _ = current_user
    return get_bilibili_season_detail(season_id)


@router.get("/bilibili/detail")
def bilibili_detail(
    bvid: Optional[str] = None,
    aid: Optional[int] = None,
    current_user = Depends(get_current_user),
):
    _ = current_user
    if not bvid and not aid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cần truyền bvid hoặc aid")
    return get_bilibili_video_detail(bvid=bvid, aid=aid)


@router.get("/bilibili/thumbnail")
def bilibili_thumbnail(
    url: str,
):
    content, content_type = fetch_bilibili_image(url)
    return Response(content=content, media_type=content_type)


@router.get("/bilibili/preview-source")
def bilibili_preview_source(
    url: str,
    current_user = Depends(get_current_user),
):
    _ = current_user
    try:
        return get_bilibili_preview_source(url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/bilibili/dash-manifest")
def bilibili_dash_manifest(
    request: Request,
    video_url: str,
    audio_url: str,
    video_mime: str = "video/mp4",
    audio_mime: str = "audio/mp4",
    video_codecs: str = "",
    audio_codecs: str = "",
    video_init: str = "0-0",
    audio_init: str = "0-0",
    video_index: str = "0-0",
    audio_index: str = "0-0",
    video_bandwidth: int = 0,
    audio_bandwidth: int = 0,
    width: int = 1280,
    height: int = 720,
    duration_ms: int = 0,
):
    base = str(request.base_url).rstrip("/")
    video_proxy = f"{base}/api/video-localization/bilibili/media-proxy?url={quote(video_url, safe='')}"
    audio_proxy = f"{base}/api/video-localization/bilibili/media-proxy?url={quote(audio_url, safe='')}"
    duration_seconds = max(1, int(duration_ms / 1000)) if duration_ms else 3600
    mpd = f"""<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT{duration_seconds}S" minBufferTime="PT1.5S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
  <Period id="0" duration="PT{duration_seconds}S">
    <AdaptationSet id="0" contentType="video" mimeType="{html.escape(video_mime)}" codecs="{html.escape(video_codecs)}" width="{width}" height="{height}" segmentAlignment="true">
      <Representation id="video" bandwidth="{video_bandwidth or 1000000}">
        <BaseURL>{html.escape(video_proxy)}</BaseURL>
        <SegmentBase indexRange="{html.escape(video_index)}">
          <Initialization range="{html.escape(video_init)}" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
    <AdaptationSet id="1" contentType="audio" mimeType="{html.escape(audio_mime)}" codecs="{html.escape(audio_codecs)}" segmentAlignment="true">
      <Representation id="audio" bandwidth="{audio_bandwidth or 128000}">
        <BaseURL>{html.escape(audio_proxy)}</BaseURL>
        <SegmentBase indexRange="{html.escape(audio_index)}">
          <Initialization range="{html.escape(audio_init)}" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>"""
    return Response(content=mpd, media_type="application/dash+xml")


@router.get("/bilibili/media-proxy")
async def bilibili_media_proxy(
    request: Request,
    url: str,
):
    if not url.startswith(("https://", "http://")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL media không hợp lệ")
    headers = _bilibili_headers()
    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header

    client = httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True)
    try:
        req = client.build_request("GET", url, headers=headers)
        upstream = await client.send(req, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxy media lỗi: {exc}") from exc

    response_headers = {}
    for key in ("content-length", "content-range", "accept-ranges"):
        if upstream.headers.get(key):
            response_headers[key] = upstream.headers[key]

    async def iterator():
        try:
            async for chunk in upstream.aiter_raw():
                if chunk:
                    yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        iterator(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/octet-stream"),
        headers=response_headers,
    )


@router.get("/bilibili/stream")
def bilibili_stream(
    url: str,
    range_header: Optional[str] = Header(default=None, alias="Range"),
    current_user = Depends(get_current_user),
):
    _ = current_user
    try:
        direct_url = get_bilibili_direct_stream_url(url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    headers = _bilibili_headers()
    if range_header:
        headers["Range"] = range_header

    client = httpx.Client(timeout=None, follow_redirects=True)
    request = client.build_request("GET", direct_url, headers=headers)
    upstream = client.send(request, stream=True)

    response_headers = {}
    for key in ("content-length", "content-range", "accept-ranges"):
        if upstream.headers.get(key):
            response_headers[key] = upstream.headers[key]

    def iterator():
        try:
            for chunk in upstream.iter_bytes():
                if chunk:
                    yield chunk
        finally:
            upstream.close()
            client.close()

    return StreamingResponse(
        iterator(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "video/mp4"),
        headers=response_headers,
    )


@router.get("/jobs")
def list_jobs(
    current_user = Depends(get_current_user),
):
    return list_video_localization_jobs(current_user.id)


@router.post("/jobs")
def create_job(
    request: VideoLocalizationJobRequest,
    background_tasks: BackgroundTasks,
    current_user = Depends(get_current_user),
):
    if not request.rights_confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bạn cần xác nhận video có quyền tải/xử lý/dịch trước khi tạo job.",
        )
    if not request.source_url.strip().startswith("http"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="source_url không hợp lệ")

    job = create_video_localization_job(current_user.id, request.source_url, request.title)
    background_tasks.add_task(lambda: asyncio.run(process_video_localization_job(job["id"])))
    return job


@router.get("/jobs/{job_id}")
def get_job(
    job_id: str,
    current_user = Depends(get_current_user),
):
    job = get_video_localization_job(current_user.id, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy job")
    return job


@router.get("/jobs/{job_id}/download")
def download_job_output(
    job_id: str,
    current_user = Depends(get_current_user),
):
    job = get_video_localization_job(current_user.id, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy job")
    output_video = job.get("output_video")
    if not output_video:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job chưa có video kết quả")

    path = (PROJECT_ROOT / output_video).resolve()
    allowed_root = (PROJECT_ROOT / "storage" / "video_localization").resolve()
    if not path.is_relative_to(allowed_root) or not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File kết quả không tồn tại")
    return FileResponse(path, media_type="video/mp4", filename=Path(path).name)
