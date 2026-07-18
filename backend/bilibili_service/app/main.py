from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.bilibili_service.app.api.router import api_router
from backend.bilibili_service.app.services.runtime import job_ws_hub, recover_interrupted_jobs


@asynccontextmanager
async def lifespan(app: FastAPI):
    job_ws_hub.set_loop(asyncio.get_running_loop())
    recover_interrupted_jobs()
    yield


app = FastAPI(title="Bilibili Crawler Service", lifespan=lifespan)

frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/bilibili-crawler")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "bilibili-crawler"}

