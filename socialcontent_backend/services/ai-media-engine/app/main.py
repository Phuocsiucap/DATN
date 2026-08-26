import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from common.workers import run_thread_worker_forever

from app.planning.consumers.crawl_job_completed import run_crawl_job_completed_consumer
from app.video.consumers.generate_video_requested import run_generate_video_requested_consumer
from app.embeddings import app as embeddings_app

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[ai-media-engine] Base.metadata.create_all warning: {e}")
    tasks = []
    if get_settings().enable_workers:
        print("[ai-media-engine] Starting planning and video workers...")
        tasks.append(asyncio.create_task(run_thread_worker_forever("planning-orchestrator:crawl-job-completed", run_crawl_job_completed_consumer)))
        tasks.append(asyncio.create_task(run_thread_worker_forever("generate-video:requested", run_generate_video_requested_consumer)))
    yield
    for task in tasks:
        task.cancel()

app = FastAPI(title="AI Media Engine", lifespan=lifespan)

app.mount("/embeddings", embeddings_app)

@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-media-engine"}
