import os
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel

from backend.gateway.app.api.proxy import proxy_request
from backend.gateway.app.api.routes.auth import get_current_user
from backend.gateway.app.services.scheduler import get_scheduler_status_payload, start_scheduler, stop_scheduler
from backend.gateway.app.services.scheduler import run_crawl_cycle

router = APIRouter()

USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")
BILIBILI_SERVICE_URL = os.getenv("BILIBILI_SERVICE_URL", "http://127.0.0.1:8010").rstrip("/")
PUBLISHER_SERVICE_URL = os.getenv("PUBLISHER_SERVICE_URL", "http://127.0.0.1:8040").rstrip("/")


@router.post("/crawl-now")
async def trigger_crawl():
    await run_crawl_cycle()
    return {"message": "Crawl cycle queued"}


class SchedulerStartRequest(BaseModel):
    interval_minutes: int = 30


class BilibiliTikTokPublishRequest(BaseModel):
    profile_ids: list[int]
    caption: str | None = None
    segment_indexes: list[int] | None = None


@router.post("/scheduler/start")
async def start_scheduler_api(req: SchedulerStartRequest | None = None):
    interval = req.interval_minutes if req else 30
    await start_scheduler(interval)
    return {"message": f"Scheduler started/resumed every {interval} minutes", "status": "running"}


@router.post("/scheduler/stop")
async def stop_scheduler_api():
    await stop_scheduler()
    return {"message": "Scheduler paused", "status": "paused"}


@router.get("/scheduler/status")
async def get_scheduler_status():
    return get_scheduler_status_payload()


@router.post("/bilibili/jobs/{job_id}/tiktok")
async def publish_bilibili_job_to_tiktok(
    job_id: int,
    request_body: BilibiliTikTokPublishRequest,
    current_user = Depends(get_current_user),
) -> dict:
    if not request_body.profile_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chọn ít nhất 1 tài khoản TikTok")

    async with httpx.AsyncClient(timeout=None) as client:
        try:
            job_response = await client.get(
                f"{BILIBILI_SERVICE_URL}/api/bilibili-crawler/jobs/{job_id}",
                headers={"X-User-Id": str(current_user.id)},
            )
            job_response.raise_for_status()
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Bilibili service unavailable: {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text) from exc

        job = job_response.json()
        video_paths = resolve_bilibili_publish_video_paths(job, request_body.segment_indexes)
        caption = (request_body.caption or build_default_bilibili_tiktok_caption(job)).strip()
        if not caption:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Caption không được để trống")

        results = []
        for profile_id in request_body.profile_ids:
            for video_path in video_paths:
                try:
                    publish_response = await client.post(
                        f"{PUBLISHER_SERVICE_URL}/api/publish/tiktok/local-video",
                        json={
                            "profile_id": profile_id,
                            "user_id": current_user.id,
                            "caption": caption,
                            "video_path": video_path,
                        },
                    )
                    publish_response.raise_for_status()
                    results.append({
                        "profile_id": profile_id,
                        "video_path": video_path,
                        "success": True,
                        "result": publish_response.json()
                    })
                except httpx.RequestError as exc:
                    results.append({
                        "profile_id": profile_id,
                        "video_path": video_path,
                        "success": False,
                        "error": f"Publisher service unavailable: {exc}"
                    })
                except httpx.HTTPStatusError as exc:
                    results.append({
                        "profile_id": profile_id,
                        "video_path": video_path,
                        "success": False,
                        "error": exc.response.text
                    })

    # Nếu tất cả thất bại, raise 500 hoặc 400. Hoặc chỉ return status.
    all_success = all(r["success"] for r in results)
    
    return {
        "success": all_success and len(results) > 0,
        "results": results,
        "profiles": request_body.profile_ids,
        "published_at": datetime.utcnow().isoformat(),
    }


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_publish(path: str, request: Request) -> Response:
    return await proxy_request(request, f"{USER_SERVICE_URL}/api/publish/{path}", "User service")


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_publish_root(request: Request) -> Response:
    return await proxy_request(request, f"{USER_SERVICE_URL}/api/publish", "User service")


def resolve_bilibili_publish_video_paths(job: dict, segment_indexes: list[int] | None = None) -> list[str]:
    artifacts = job.get("artifacts") if isinstance(job.get("artifacts"), dict) else {}
    valid_paths: list[str] = []

    if segment_indexes:
        segments = artifacts.get("segments")
        if isinstance(segments, list):
            for item in segments:
                if isinstance(item, dict) and item.get("index") in segment_indexes and isinstance(item.get("path"), str):
                    path = Path(item["path"]).resolve()
                    if path.exists() and path.is_file():
                        valid_paths.append(str(path))
        if valid_paths:
            return valid_paths
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy các part đã chọn để đăng")

    candidates: list[str] = []
    for key in ("output_video_path", "master_video_path"):
        value = artifacts.get(key)
        if isinstance(value, str) and value:
            candidates.append(value)

    segments = artifacts.get("segments")
    if isinstance(segments, list):
        for item in segments:
            if isinstance(item, dict) and isinstance(item.get("path"), str):
                candidates.append(item["path"])
                break

    for value in candidates:
        path = Path(value).resolve()
        if path.exists() and path.is_file():
            return [str(path)]
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chưa có video thành phẩm để đăng")


def build_default_bilibili_tiktok_caption(job: dict) -> str:
    artifacts = job.get("artifacts") if isinstance(job.get("artifacts"), dict) else {}
    metadata = artifacts.get("tiktok_metadata")
    if isinstance(metadata, dict):
        title = str(metadata.get("title") or "").strip()
        description = str(metadata.get("description") or "").strip()
        hashtags = metadata.get("hashtags")
        hashtag_text = " ".join(str(item).strip() for item in hashtags if str(item).strip()) if isinstance(hashtags, list) else ""
        return "\n\n".join(part for part in [title, description, hashtag_text] if part)

    title = str(artifacts.get("crawler_title") or artifacts.get("raw_title") or job.get("input_text") or "").strip()
    return f"{title}\n\n#phimngan #shortdrama #vietsub" if title else ""
