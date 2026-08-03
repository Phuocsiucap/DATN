import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from app.api.routes import handoffs, planning_jobs
from app.consumers.crawl_job_completed import run_crawl_job_completed_consumer
from app.consumers.job_created import run_planning_job_created_consumer


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    tasks = []
    if get_settings().enable_workers:
        tasks.append(asyncio.create_task(asyncio.to_thread(run_planning_job_created_consumer)))
        tasks.append(asyncio.create_task(asyncio.to_thread(run_crawl_job_completed_consumer)))
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Planning Orchestrator", lifespan=lifespan)

app.include_router(handoffs.router, prefix="/api/v1/handoffs", tags=["handoffs"])
app.include_router(planning_jobs.router, prefix="/api/v1/planning-jobs", tags=["planning-jobs"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "planning-orchestrator"}
