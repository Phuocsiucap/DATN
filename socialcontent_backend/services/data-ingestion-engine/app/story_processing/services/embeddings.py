from __future__ import annotations

import logging
from typing import Any

import httpx
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import ContentEmbedding, ContentItem

logger = logging.getLogger(__name__)


class ContentEmbeddingWriter:
    def upsert_for_content(self, db: Session, content: ContentItem, normalized: dict[str, Any]) -> ContentEmbedding | None:
        text = self._embedding_text(content, normalized)
        if not text:
            return None

        settings = get_settings()
        model_name, vector = self._embed_text(settings.embedding_service_url, text)
        if not vector:
            return None

        existing = (
            db.query(ContentEmbedding)
            .filter(ContentEmbedding.content_id == content.id, ContentEmbedding.model_name == model_name)
            .first()
        )
        if existing:
            existing.embedding = vector
            existing.embedding_text = text
            existing.embedding_dim = len(vector)
            db.add(existing)
            return existing

        embedding = ContentEmbedding(
            content_id=content.id,
            model_name=model_name,
            embedding=vector,
            embedding_text=text,
            embedding_dim=len(vector),
        )
        db.add(embedding)
        return embedding

    def _embed_text(self, service_url: str, text: str) -> tuple[str, list[float]]:
        url = service_url.rstrip("/") + "/embeddings/embed"
        try:
            with httpx.Client(timeout=30) as client:
                response = client.post(url, json={"texts": [text], "is_query": False})
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            logger.warning("Content embedding skipped; embedding service unavailable: %s", exc)
            return "", []

        model_name = str(payload.get("model") or get_settings().embedding_model_name)
        vector = self._first_vector(payload)
        return model_name, vector

    def _first_vector(self, payload: dict[str, Any]) -> list[float]:
        embeddings = payload.get("embeddings")
        if isinstance(embeddings, list) and embeddings and isinstance(embeddings[0], list):
            return [float(value) for value in embeddings[0]]

        data = payload.get("data")
        if isinstance(data, list) and data and isinstance(data[0], dict):
            vector = data[0].get("embedding")
            if isinstance(vector, list):
                return [float(value) for value in vector]
        return []

    def _embedding_text(self, content: ContentItem, normalized: dict[str, Any]) -> str:
        parts = [
            normalized.get("title") or content.canonical_title,
            normalized.get("description") or content.summary,
            normalized.get("category"),
            " ".join(str(tag) for tag in normalized.get("tags") or []),
            normalized.get("content"),
            normalized.get("transcript"),
        ]
        text = "\n\n".join(str(part).strip() for part in parts if str(part or "").strip())
        return text[:8000]
