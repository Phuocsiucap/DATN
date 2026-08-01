import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from app.consumers.job_created import run_job_created_consumer
from app.scheduler.periodic_sources import run_periodic_source_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    settings = get_settings()
    tasks = []
    if settings.enable_workers:
        tasks.append(asyncio.create_task(asyncio.to_thread(run_job_created_consumer)))
        tasks.append(asyncio.create_task(asyncio.to_thread(run_periodic_source_scheduler)))
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Crawl Orchestrator", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "crawl-orchestrator"}
