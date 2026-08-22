import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from common.workers import run_thread_worker_forever
from app.story_processing.consumers.content_normalized import run_content_normalized_consumer


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[story-processing-service] Base.metadata.create_all warning: {e}")
    settings = get_settings()
    task = (
        asyncio.create_task(run_thread_worker_forever("story-processing-service:content-normalized", run_content_normalized_consumer))
        if settings.enable_workers
        else None
    )
    yield
    if task:
        task.cancel()


app = FastAPI(title="Story Processing Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "story-processing-service"}
