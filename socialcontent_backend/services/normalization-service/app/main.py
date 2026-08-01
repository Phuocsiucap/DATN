import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.models import Base
from common.db.session import engine
from app.consumers.raw_created import run_raw_created_consumer


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    settings = get_settings()
    task = asyncio.create_task(asyncio.to_thread(run_raw_created_consumer)) if settings.enable_workers else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="Normalization Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "normalization-service"}
