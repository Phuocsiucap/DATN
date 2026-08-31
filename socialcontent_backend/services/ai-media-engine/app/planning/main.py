import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.bootstrap import ensure_schema_compatibility
from common.db.models import Base
from common.db.session import SessionLocal, engine
from common.workers import run_thread_worker_forever
from app.planning.consumers.crawl_job_completed import run_crawl_job_completed_consumer
from app.planning.consumers.candidate_review import run_candidate_review_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    with SessionLocal() as db:
        ensure_schema_compatibility(db)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[planning-orchestrator] Base.metadata.create_all warning: {e}")
    tasks = []
    if get_settings().enable_workers:
        tasks.append(asyncio.create_task(run_thread_worker_forever("planning:reviewed-candidates", run_candidate_review_worker)))
        tasks.append(asyncio.create_task(run_thread_worker_forever("planning-orchestrator:crawl-job-completed", run_crawl_job_completed_consumer)))
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Planning Orchestrator", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "planning-orchestrator"}
