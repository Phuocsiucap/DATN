from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from common.db.models import ContentItem
from common.db.session import get_db
from app.embedding.service import embed_texts, ensure_content_embeddings


router = APIRouter()


class EmbedRequest(BaseModel):
    texts: list[str] = Field(default_factory=list)
    run_type: str = "CREATE_EMBEDDING"
    step_name: str = "create_embedding_batch"
    user_id: str | None = None
    reference_id: str | None = None


class EnsureContentEmbeddingsRequest(BaseModel):
    content_ids: list[uuid.UUID] = Field(default_factory=list)


@router.post("/embeddings/embed")
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


@router.post("/content-embeddings/ensure")
def ensure_content_embeddings_endpoint(
    payload: EnsureContentEmbeddingsRequest,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    items = []
    if payload.content_ids:
        items = db.query(ContentItem).filter(ContentItem.id.in_(payload.content_ids)).all()
    result = ensure_content_embeddings(db, items)
    db.commit()
    return result
