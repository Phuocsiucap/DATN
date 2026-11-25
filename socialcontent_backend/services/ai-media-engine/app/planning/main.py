import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from common.core.config import get_settings
from common.db.bootstrap import ensure_schema_compatibility
from common.db.models import Base
from common.db.session import SessionLocal, engine
from common.http.responses import configure_api_responses
from app.planning.worker_runtime import start_planning_workers


@asynccontextmanager
async def lifespan(app: FastAPI):
    with SessionLocal() as db:
        ensure_schema_compatibility(db)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        print(f"[planning-orchestrator] Base.metadata.create_all warning: {exc}")

    tasks = start_planning_workers() if get_settings().enable_workers else []
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()


app = FastAPI(title="Planning Orchestrator", lifespan=lifespan)
configure_api_responses(app)


@app.get("/health")
def health():
    return {"status": "ok", "service": "planning-orchestrator"}
