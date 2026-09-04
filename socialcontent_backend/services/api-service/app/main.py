from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from common.db.bootstrap import ensure_roles, ensure_schema_compatibility
from common.db.models import Base
from common.db.session import SessionLocal, engine
from common.http.responses import configure_api_responses
from app.api.routes import (
    admin,
    analytics,
    auth,
    media_workflows,
    content_series,
    contents,
    creator_dashboard,
    crawl_jobs,
    media_proxy,
    generate_video,
    planning_runs,
    profile_planning,
    social_profiles,
    sources,
    stories,
    users,
)
from app.services.publish_scheduler import start_publish_queue_scheduler, stop_publish_queue_scheduler

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    with SessionLocal() as db:
        ensure_schema_compatibility(db)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[api-service] Base.metadata.create_all warning: {e}")
    with SessionLocal() as db:
        ensure_schema_compatibility(db)
        ensure_roles(db)
    await start_publish_queue_scheduler()
    yield
    await stop_publish_queue_scheduler()


app = FastAPI(title="SocialContent API Service", lifespan=lifespan)
configure_api_responses(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin-system"])
app.include_router(creator_dashboard.router, prefix="/api/v1/creator/dashboard", tags=["creator-dashboard"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["analytics"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(social_profiles.router, prefix="/api/v1/social-profiles", tags=["social-profiles"])
app.include_router(crawl_jobs.router, prefix="/api/v1/crawl-jobs", tags=["crawl-jobs"])
app.include_router(sources.router, prefix="/api/v1", tags=["sources"])
app.include_router(contents.router, prefix="/api/v1/contents", tags=["contents"])
app.include_router(media_proxy.router, prefix="/api/v1/media-proxy", tags=["media-proxy"])
app.include_router(stories.router, prefix="/api/v1", tags=["stories"])
app.include_router(planning_runs.router, prefix="/api/v1/planning-runs", tags=["planning-runs"])
app.include_router(profile_planning.router, prefix="/api/v1/profile", tags=["profile-planning"])
app.include_router(media_workflows.router, prefix="/api/v1/media-workflows", tags=["media-workflows"])
app.include_router(content_series.router, prefix="/api/v1/content-series", tags=["content-series"])
app.include_router(generate_video.router, prefix="/api/v1/generate-video", tags=["generate-video"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "api-service"}
