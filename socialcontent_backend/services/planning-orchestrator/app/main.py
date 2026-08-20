import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from common.workers import run_thread_worker_forever
from app.api.routes import project_runs
from app.consumers.crawl_job_completed import run_crawl_job_completed_consumer
from app.consumers.project_run_created import run_project_run_created_consumer


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[planning-orchestrator] Base.metadata.create_all warning: {e}")
    tasks = []
    if get_settings().enable_workers:
        tasks.append(asyncio.create_task(run_thread_worker_forever("planning-orchestrator:project-run-created", run_project_run_created_consumer)))
        tasks.append(asyncio.create_task(run_thread_worker_forever("planning-orchestrator:crawl-job-completed", run_crawl_job_completed_consumer)))
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Planning Orchestrator", lifespan=lifespan)

app.include_router(project_runs.router, prefix="/api/v1/project-runs", tags=["project-runs"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "planning-orchestrator"}
