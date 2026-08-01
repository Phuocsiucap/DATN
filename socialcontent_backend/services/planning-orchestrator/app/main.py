import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from app.consumers.job_created import run_planning_job_created_consumer


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    tasks = []
    if get_settings().enable_workers:
        tasks.append(asyncio.create_task(asyncio.to_thread(run_planning_job_created_consumer)))
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Planning Orchestrator", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "planning-orchestrator"}
