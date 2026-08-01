from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from common.db.bootstrap import ensure_roles
from common.db.models import Base
from common.db.session import SessionLocal, engine
from app.api.routes import (
    admin,
    auth,
    content_plans,
    content_series,
    contents,
    crawl_jobs,
    data_quality,
    handoffs,
    module3_handoffs,
    planning_jobs,
    social_profiles,
    sources,
    stories,
    users,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        ensure_roles(db)
    yield


app = FastAPI(title="SocialContent API Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin-system"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(social_profiles.router, prefix="/api/v1/social-profiles", tags=["social-profiles"])
app.include_router(crawl_jobs.router, prefix="/api/v1/crawl-jobs", tags=["crawl-jobs"])
app.include_router(sources.router, prefix="/api/v1", tags=["sources"])
app.include_router(contents.router, prefix="/api/v1/contents", tags=["contents"])
app.include_router(stories.router, prefix="/api/v1", tags=["stories"])
app.include_router(data_quality.router, prefix="/api/v1/data-quality", tags=["data-quality"])
app.include_router(handoffs.router, prefix="/api/v1/module2/handoffs", tags=["module2-handoffs"])
app.include_router(planning_jobs.router, prefix="/api/v1/planning-jobs", tags=["planning-jobs"])
app.include_router(content_plans.router, prefix="/api/v1/content-plans", tags=["content-plans"])
app.include_router(content_series.router, prefix="/api/v1/content-series", tags=["content-series"])
app.include_router(module3_handoffs.router, prefix="/api/v1/module3/handoffs", tags=["module3-handoffs"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "api-service"}
