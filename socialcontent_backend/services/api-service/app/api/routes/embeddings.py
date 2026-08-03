import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from common.db.models import ContentItem, User
from common.db.session import get_db
from app.api.deps import get_current_user
from app.services.embeddings import EmbeddingService

router = APIRouter()


class EmbeddingSearchRequest(BaseModel):
    content_id: uuid.UUID
    limit: int = Field(default=10, ge=1, le=50)
    min_similarity: float | None = Field(default=None, ge=0, le=1)


class EmbeddingRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=100)
    is_query: bool = True


@router.post("")
def create_embedding(payload: EmbeddingRequest, _: User = Depends(get_current_user)):
    return EmbeddingService().create_embeddings_payload(payload.texts, is_query=payload.is_query)


@router.post("/content/{content_id}/refresh")
def refresh_content_embedding(content_id: uuid.UUID, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    content = db.get(ContentItem, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    embedding = EmbeddingService().refresh_content_embedding(db, content)
    db.commit()
    return {
        "content_id": content.id,
        "embedding_id": embedding.id,
        "model_name": embedding.model_name,
        "embedding_dim": embedding.embedding_dim,
        "updated_at": embedding.updated_at,
    }


@router.post("/search")
def search_related_content(payload: EmbeddingSearchRequest, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    content = db.get(ContentItem, payload.content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    results = EmbeddingService().search_related_content(
        db,
        content,
        limit=payload.limit,
        min_similarity=payload.min_similarity,
    )
    db.commit()
    return {
        "content_id": payload.content_id,
        "results": [
            {
                "content_id": item.content_id,
                "similarity": item.similarity,
                "reason": "embedding_similarity",
            }
            for item in results
        ],
    }
