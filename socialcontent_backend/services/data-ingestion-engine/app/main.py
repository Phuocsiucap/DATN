import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from common.workers import run_thread_worker_forever

from app.orchestrator.consumers.job_created import run_job_created_consumer
from app.orchestrator.scheduler.periodic_sources import run_periodic_source_scheduler
from app.crawler.consumers.task_requested import run_task_requested_consumer
from app.normalization.consumers.raw_created import run_raw_created_consumer
from app.story_processing.consumers.content_normalized import run_content_normalized_consumer

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[data-ingestion-engine] Base.metadata.create_all warning: {e}")
    
    settings = get_settings()
    tasks = []
    
    if settings.enable_workers:
        print("[data-ingestion-engine] Starting all pipeline consumers & schedulers...")
        # 1. Orchestrator
        tasks.append(asyncio.create_task(run_thread_worker_forever("orchestrator:job-created", run_job_created_consumer)))
        tasks.append(asyncio.create_task(run_thread_worker_forever("orchestrator:scheduler", run_periodic_source_scheduler)))
        
        # 2. Crawler
        tasks.append(asyncio.create_task(run_thread_worker_forever("crawler:task-requested", run_task_requested_consumer)))
        
        # 3. Normalization
        tasks.append(asyncio.create_task(run_thread_worker_forever("normalization:raw-created", run_raw_created_consumer)))
        
        # 4. Story Processing
        tasks.append(asyncio.create_task(run_thread_worker_forever("story-processing:content-normalized", run_content_normalized_consumer)))
        
    yield
    
    for task in tasks:
        task.cancel()

app = FastAPI(title="Data Ingestion Engine", lifespan=lifespan)

@app.get("/health")
def health():
    return {"status": "ok", "service": "data-ingestion-engine"}
