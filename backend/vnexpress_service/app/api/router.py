from fastapi import APIRouter

from backend.vnexpress_service.app.api.routes import health


api_router = APIRouter()
api_router.include_router(health.router)
