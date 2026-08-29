from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.bootstrap import ensure_schema_compatibility
from common.db.models import Base, ContentItem
from common.db.session import SessionLocal, engine, get_db
from common.workers import run_thread_worker_forever
from app.consumer import run_content_embedding_requested_consumer
from app.service import embed_texts, ensure_content_embeddings


class EmbedRequest(BaseModel):
    texts: list[str] = Field(default_factory=list)
    run_type: str = "CREATE_EMBEDDING"
    step_name: str = "create_embedding_batch"
    user_id: str | None = None
    reference_id: str | None = None


class EnsureContentEmbeddingsRequest(BaseModel):
    content_ids: list[uuid.UUID] = Field(default_factory=list)


@asynccontextmanager
async def lifespan(app: FastAPI):
    with SessionLocal() as db:
        ensure_schema_compatibility(db)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        print(f"[embedding-service] Base.metadata.create_all warning: {exc}")
    tasks = []
    if get_settings().enable_workers:
        tasks.append(asyncio.create_task(run_thread_worker_forever("embedding-service:content-embedding-requested", run_content_embedding_requested_consumer)))
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Embedding Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "embedding-service"}


@app.post("/embeddings/embed")
def create_embeddings(payload: EmbedRequest) -> dict[str, Any]:
    result = embed_texts(
        payload.texts,
        user_id=payload.user_id,
        reference_id=payload.reference_id,
        run_type=payload.run_type,
        step_name=payload.step_name,
    )
    return {
        "model_name": result.model_name,
        "embeddings": result.embeddings,
        "input_tokens": result.input_tokens,
        "latency_ms": result.latency_ms,
    }


@app.post("/content-embeddings/ensure")
def ensure_content_embeddings_endpoint(payload: EnsureContentEmbeddingsRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    items = []
    if payload.content_ids:
        items = db.query(ContentItem).filter(ContentItem.id.in_(payload.content_ids)).all()
    result = ensure_content_embeddings(db, items)
    db.commit()
    return result
