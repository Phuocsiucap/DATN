from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Iterable

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import ContentEmbedding, ContentItem, ContentSource


@dataclass
class EmbeddingSearchResult:
    content_id: object
    similarity: float


class EmbeddingService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.base_url = self.settings.embedding_service_url.rstrip("/")

    def refresh_content_embedding(self, db: Session, content: ContentItem) -> ContentEmbedding:
        text = self.build_embedding_text(db, content)
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        model_name = self._model_name()
        existing = (
            db.query(ContentEmbedding)
            .filter(ContentEmbedding.content_id == content.id, ContentEmbedding.model_name == model_name)
            .first()
        )
        if existing and existing.embedding_text_hash == text_hash:
            return existing

        vector = self.create_embedding(text, is_query=False)
        if existing:
            existing.embedding = vector
            existing.embedding_text = text
            existing.embedding_text_hash = text_hash
            existing.embedding_dim = len(vector)
            existing.source_language = content.language
            db.add(existing)
            db.flush()
            return existing

        embedding = ContentEmbedding(
            content_id=content.id,
            embedding=vector,
            embedding_text=text,
            embedding_text_hash=text_hash,
            model_name=model_name,
            embedding_dim=len(vector),
            source_language=content.language,
        )
        db.add(embedding)
        db.flush()
        return embedding

    def search_related_content(
        self,
        db: Session,
        content: ContentItem,
        *,
        limit: int = 10,
        exclude_ids: set | None = None,
        min_similarity: float | None = None,
    ) -> list[EmbeddingSearchResult]:
        exclude_ids = exclude_ids or set()
        min_similarity = min_similarity if min_similarity is not None else self.settings.embedding_similarity_threshold
        query_vector = self.create_embedding(self.build_embedding_text(db, content), is_query=True)
        model_name = self._model_name()

        rows = (
            db.query(ContentEmbedding)
            .filter(ContentEmbedding.model_name == model_name, ContentEmbedding.content_id != content.id)
            .order_by(ContentEmbedding.embedding.cosine_distance(query_vector))
            .limit(limit * 3)
            .all()
        )

        results: list[EmbeddingSearchResult] = []
        for row in rows:
            if row.content_id in exclude_ids:
                continue
            # pgvector returns ndarray or list, we can just use it
            similarity = self.cosine_similarity(query_vector, row.embedding)
            if similarity >= min_similarity:
                results.append(EmbeddingSearchResult(content_id=row.content_id, similarity=similarity))
            if len(results) >= limit:
                break

        results.sort(key=lambda item: item.similarity, reverse=True)
        return results

    def create_embedding(self, text: str, *, is_query: bool = True) -> list[float]:
        embeddings = self.create_embeddings([text], is_query=is_query)
        return embeddings[0]

    def create_embeddings(self, texts: list[str], *, is_query: bool = True) -> list[list[float]]:
        payload = self.create_embeddings_payload(texts, is_query=is_query)
        if "embeddings" in payload:
            return [[float(value) for value in vector] for vector in payload["embeddings"]]
        return [
            [float(value) for value in item["embedding"]]
            for item in sorted(payload.get("data", []), key=lambda item: item["index"])
        ]

    def create_embeddings_payload(self, texts: list[str], *, is_query: bool = True) -> dict:
        clean_texts = [text.strip() for text in texts if text.strip()]
        if not clean_texts:
            raise HTTPException(status_code=400, detail="Danh sách văn bản không được để trống")

        try:
            with httpx.Client(timeout=120) as client:
                response = client.post(f"{self.base_url}/embed", json={"texts": clean_texts, "is_query": is_query})
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500] if exc.response is not None else str(exc)
            raise HTTPException(status_code=502, detail=f"Embedding service failed: {detail}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Embedding service unavailable: {exc}") from exc
        return response.json()

    def _model_name(self) -> str:
        try:
            with httpx.Client(timeout=10) as client:
                response = client.get(f"{self.base_url}/health")
                response.raise_for_status()
                data = response.json()
                return str(data.get("model") or self.settings.embedding_model_name)
        except httpx.HTTPError:
            return self.settings.embedding_model_name

    def build_embedding_text(self, db: Session, content: ContentItem) -> str:
        sources = db.query(ContentSource).filter(ContentSource.content_id == content.id).limit(3).all()
        source_bits = []
        keywords: list[str] = []
        for source in sources:
            source_bits.append(source.source_type)
            metadata = source.metadata_json or {}
            for key in ("category", "keywords", "tags", "entities"):
                value = metadata.get(key)
                if isinstance(value, list):
                    keywords.extend(str(item) for item in value)
                elif value:
                    keywords.append(str(value))

        parts = [
            f"Title: {content.canonical_title or ''}",
            f"Normalized title: {content.normalized_title or ''}",
            f"Summary: {content.summary or ''}",
            f"Content type: {content.content_type or ''}",
            f"Language: {content.language or ''}",
            f"Sources: {', '.join(source_bits)}",
            f"Keywords/entities/category: {', '.join(dict.fromkeys(keywords))}",
        ]
        
        try:
            from bson import ObjectId
            from common.db.mongo import processed_documents, raw_documents
            proc_coll = processed_documents()
            raw_coll = raw_documents()
            
            full_text = None
            for source in sources:
                metadata = dict(source.metadata_json or {})
                proc_id_str = metadata.get("processed_document_id")
                if proc_id_str:
                    try:
                        proc_doc = proc_coll.find_one({"_id": ObjectId(proc_id_str)})
                        if proc_doc and "normalized" in proc_doc:
                            full_text = proc_doc["normalized"].get("content") or proc_doc["normalized"].get("description")
                    except Exception:
                        pass

                if not full_text and source.raw_document_id:
                    try:
                        raw_doc = raw_coll.find_one({"_id": ObjectId(source.raw_document_id)})
                        if raw_doc and "raw" in raw_doc:
                            full_text = raw_doc["raw"].get("text") or raw_doc["raw"].get("raw_text")
                    except Exception:
                        pass
                
                if full_text:
                    # Cắt ngắn văn bản để tránh vượt quá giới hạn token của mô hình Embedding (thường là 512-8192 tokens)
                    # Lấy 2500 ký tự đầu tiên thường đủ để mô hình hiểu được ngữ nghĩa cốt lõi của bài báo.
                    truncated_text = full_text[:2500] + ("..." if len(full_text) > 2500 else "")
                    parts.append(f"Full Text Snippet: {truncated_text}")
                    break
        except Exception as e:
            print("Error fetching full text for embedding:", e)
            
        return "\n".join(part for part in parts if part.strip())

    @staticmethod
    def cosine_similarity(left: Iterable[float], right: Iterable[float]) -> float:
        left_values = list(left)
        right_values = list(right)
        if len(left_values) != len(right_values) or not left_values:
            return 0.0
        dot = sum(a * b for a, b in zip(left_values, right_values))
        left_norm = math.sqrt(sum(a * a for a in left_values))
        right_norm = math.sqrt(sum(b * b for b in right_values))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return dot / (left_norm * right_norm)
