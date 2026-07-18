from fastapi import APIRouter

from backend.publisher_service.app.api.routes import health, publish

router = APIRouter()
router.include_router(health.router, prefix="/health", tags=["health"])
router.include_router(publish.router, prefix="/api/publish", tags=["publish"])
