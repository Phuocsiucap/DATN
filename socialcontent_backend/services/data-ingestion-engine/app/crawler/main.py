import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from common.workers import run_thread_worker_forever
from app.crawler.consumers.task_requested import run_task_requested_consumer


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[crawler-service] Base.metadata.create_all warning: {e}")
    settings = get_settings()
    task = (
        asyncio.create_task(run_thread_worker_forever("crawler-service:task-requested", run_task_requested_consumer))
        if settings.enable_workers
        else None
    )
    yield
    if task:
        task.cancel()


app = FastAPI(title="Crawler Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "crawler-service"}
