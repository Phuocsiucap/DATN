from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.vnexpress_service.app.api.router import api_router
from backend.vnexpress_service.app.services.worker import start_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    await start_worker()
    yield


app = FastAPI(title="VNExpress Crawler Service", lifespan=lifespan)
app.include_router(api_router)
