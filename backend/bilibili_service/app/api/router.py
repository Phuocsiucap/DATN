from fastapi import APIRouter

from backend.bilibili_service.app.api.routes import config, health, jobs, media, publish, search, ws


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(config.router, prefix="/config", tags=["config"])
api_router.include_router(search.router, tags=["search"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(media.router, tags=["media"])
api_router.include_router(publish.router, prefix="/jobs", tags=["publish"])
api_router.include_router(ws.router, tags=["websocket"])
