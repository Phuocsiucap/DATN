from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.bootstrap import ensure_schema_compatibility
from common.db.models import Base
from common.db.session import SessionLocal, engine
from common.http.responses import configure_api_responses
from common.workers import run_thread_worker_forever
from app.planning.worker_runtime import start_planning_workers
from app.video.consumers.generate_video_requested import run_generate_video_requested_consumer
from app.video.services.bilibili_ocr_jobs import BILIBILI_OCR_TASK_TYPE
from app.video.workers.generate_video_worker import start_health_server

DEFAULT_VIDEO_TASK_TYPES = {
    "GENERATE_VIDEO_SCRIPT",
    "GENERATE_VIDEO_EDIT",
    "GENERATE_VIDEO_REVIEW",
    "GENERATE_VIDEO_VOICE",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    with SessionLocal() as db:
        ensure_schema_compatibility(db)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        print(f"[ai-media-engine] Base.metadata.create_all warning: {exc}")

    tasks = []
    health_servers = []
    if get_settings().enable_workers:
        tasks.extend(start_planning_workers())

        configured_video_types = os.getenv("GENERATE_VIDEO_WORKER_TASK_TYPES")
        video_task_types = (
            {task_type.strip() for task_type in configured_video_types.split(",") if task_type.strip()}
            if configured_video_types
            else DEFAULT_VIDEO_TASK_TYPES
        )
        video_group_id = os.getenv("GENERATE_VIDEO_WORKER_GROUP_ID", "generate-video-workers")
        ocr_group_id = os.getenv("BILIBILI_OCR_WORKER_GROUP_ID", "bilibili-ocr-workers")

        health_servers.extend([
            start_health_server(video_task_types, port=8060),
            start_health_server({BILIBILI_OCR_TASK_TYPE}, service_name="ai-media-ocr-worker", port=8061),
        ])
        tasks.extend([
            asyncio.create_task(run_thread_worker_forever(
                "ai-media:video-generation",
                lambda: run_generate_video_requested_consumer(task_types=video_task_types, group_id=video_group_id),
            )),
            asyncio.create_task(run_thread_worker_forever(
                "ai-media:bilibili-ocr",
                lambda: run_generate_video_requested_consumer(task_types={BILIBILI_OCR_TASK_TYPE}, group_id=ocr_group_id),
            )),
        ])

    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for server in health_servers:
            server.shutdown()
            server.server_close()


app = FastAPI(title="AI Media Engine", lifespan=lifespan)
configure_api_responses(app)


@app.get("/health")
def health():
    return {"status": "ok", "service": "planning-orchestrator"}
