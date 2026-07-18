import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

import httpx
from fastapi import WebSocket

from backend.bilibili_service.app.core.config import get_settings
from backend.bilibili_service.app.repositories.jobs import Database
from backend.bilibili_service.app.services.pipeline import DemoPipeline
from backend.bilibili_service.app.schemas.api import JobRecord
from backend.bilibili_service.app.integrations.bilibili.china_crawler import ChinaVideoCrawler
from backend.bilibili_service.app.integrations.bilibili.downloader import VideoDownloader
from backend.bilibili_service.app.integrations.bilibili.keywords import KeywordProvider
from backend.bilibili_service.app.integrations.bilibili.render import VideoRenderer
from backend.bilibili_service.app.integrations.bilibili.subtitles import SubtitleTranslator


class JobWebSocketHub:
    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.clients: set[WebSocket] = set()
        self.gateway_events_url = os.getenv("GATEWAY_INTERNAL_EVENTS_URL", "http://127.0.0.1:8000/api/internal/bilibili/events")

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.clients.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.clients.discard(websocket)

    async def send_snapshot(self, websocket: WebSocket, user_id: int | None = None) -> None:
        jobs = db.list_jobs(user_id)
        await websocket.send_json({
            "channel": "bilibili_crawler",
            "type": "jobs_snapshot",
            "jobs": [job.model_dump(mode="json") for job in jobs],
        })

    def publish_job(self, event_type: str, job: JobRecord) -> None:
        if not self.loop:
            return
        payload = {
            "channel": "bilibili_crawler",
            "type": event_type,
            "job": job.model_dump(mode="json"),
            "user_id": job.user_id,
        }
        asyncio.run_coroutine_threadsafe(self.publish(payload), self.loop)

    async def publish(self, payload: dict) -> None:
        await self.post_to_gateway(payload)
        if self.clients:
            await self.broadcast(payload)

    async def post_to_gateway(self, payload: dict) -> None:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(self.gateway_events_url, json={"event": payload})
        except Exception as exc:
            print(f"Bilibili gateway event publish failed: {exc}")

    async def broadcast(self, payload: dict) -> None:
        dead: set[WebSocket] = set()
        target_user_id = payload.get("user_id")
        for websocket in list(self.clients):
            websocket_user_id = getattr(websocket.state, "user_id", None)
            if target_user_id is not None and websocket_user_id is not None and websocket_user_id != target_user_id:
                continue
            try:
                await websocket.send_json(payload)
            except Exception:
                dead.add(websocket)
        for websocket in dead:
            self.disconnect(websocket)


settings = get_settings()
job_ws_hub = JobWebSocketHub()
db = Database()
db.on_change = job_ws_hub.publish_job
pipeline = DemoPipeline(db, settings)
keywords = KeywordProvider()
crawler = ChinaVideoCrawler()
downloader = VideoDownloader(settings.cache_dir)
subtitle_translator = SubtitleTranslator()
video_renderer = VideoRenderer()
executor = ThreadPoolExecutor(max_workers=settings.max_concurrent_jobs)


def recover_interrupted_jobs() -> None:
    for job in db.list_recoverable_jobs():
        executor.submit(pipeline.run, job.id)



