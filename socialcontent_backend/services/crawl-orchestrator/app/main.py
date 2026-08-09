import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from common.workers import run_thread_worker_forever
from app.consumers.job_created import run_job_created_consumer
from app.scheduler.periodic_sources import run_periodic_source_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[crawl-orchestrator] Base.metadata.create_all warning: {e}")
    settings = get_settings()
    tasks = []
    if settings.enable_workers:
        tasks.append(asyncio.create_task(run_thread_worker_forever("crawl-orchestrator:job-created", run_job_created_consumer)))
        tasks.append(asyncio.create_task(run_thread_worker_forever("crawl-orchestrator:scheduler", run_periodic_source_scheduler)))
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Crawl Orchestrator", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "crawl-orchestrator"}
