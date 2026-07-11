import asyncio
import os
import sys
from pathlib import Path
from contextlib import asynccontextmanager

# Windows: dùng ProactorEventLoop để Playwright/subprocess hoạt động
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.api.routes import articles, publish, stats, proxy
from backend.api.websockets.events import router as ws_router
from backend.services.scheduler import start_scheduler, stop_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    await start_scheduler()
    yield
    await stop_scheduler()

app = FastAPI(title="AutoCrawl API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(articles.router, prefix="/api/articles", tags=["articles"])
app.include_router(publish.router, prefix="/api/publish", tags=["publish"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(proxy.router, prefix="/api/proxy", tags=["proxy"])
app.include_router(ws_router)

@app.get("/")
async def root():
    return {"status": "ok", "message": "AutoCrawl API running"}
