import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.gateway.app.api.routes import admin_settings, admin_users, articles, auth, bilibili, bilibili_events, bilibili_feed, proxy, publish, social_profiles, stats, video_localization
from backend.gateway.app.api.websockets.events import router as ws_router
from backend.gateway.app.services.scheduler import start_scheduler, stop_scheduler
from backend.gateway.app.services.publisher_event_consumer import start_publisher_event_consumer
from backend.gateway.app.services.vnexpress_event_consumer import start_vnexpress_event_consumer


@asynccontextmanager
async def lifespan(app: FastAPI):
    await start_vnexpress_event_consumer()
    await start_publisher_event_consumer()
    await start_scheduler()
    yield
    await stop_scheduler()


app = FastAPI(title="AutoCrawl Gateway", lifespan=lifespan)

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

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin_users.router, prefix="/api/admin/users", tags=["admin-users"])
app.include_router(admin_settings.router, prefix="/api/admin/settings", tags=["admin-settings"])
app.include_router(articles.router, prefix="/api/articles", tags=["articles"])
app.include_router(publish.router, prefix="/api/publish", tags=["publish"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(proxy.router, prefix="/api/proxy", tags=["proxy"])
app.include_router(social_profiles.router, prefix="/api/social-profiles", tags=["social-profiles"])
app.include_router(bilibili.router, prefix="/api/bilibili-crawler", tags=["bilibili-crawler"])
app.include_router(bilibili_feed.router, prefix="/api/bilibili-feed", tags=["bilibili-feed"])
app.include_router(bilibili_events.router, prefix="/api/internal/bilibili", tags=["bilibili-events"])
app.include_router(video_localization.router, prefix="/api/video-localization", tags=["video-localization"])
app.include_router(ws_router)


@app.get("/")
async def root():
    return {"status": "ok", "message": "AutoCrawl Gateway running"}
