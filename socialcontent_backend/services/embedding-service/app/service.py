from __future__ import annotations

import uuid
import re
from datetime import datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.core.openai_embeddings import create_embeddings as create_openai_embeddings
from common.db.media_workflows import _load_content_full_text
from common.db.models import ContentEmbedding, ContentItem


def embed_texts(
    texts: list[str],
    *,
    user_id: str | None = None,
    reference_id: str | None = None,
    run_type: str = "CREATE_EMBEDDING",
    step_name: str = "create_embedding_batch",
):
    return create_openai_embeddings(
        texts,
        user_id=user_id,
        reference_id=reference_id,
        run_type=run_type,
        step_name=step_name,
    )


def ensure_content_embeddings(db: Session, contents: list[ContentItem]) -> dict[str, Any]:
    if not contents:
        return {"count": 0, "model_name": model_name()}

    preferred_model_name = model_name()
    content_by_id = {content.id: content for content in contents}
    existing_rows = (
        db.query(ContentEmbedding)
        .filter(ContentEmbedding.content_id.in_(list(content_by_id)), ContentEmbedding.model_name == preferred_model_name)
        .all()
    )
    rows_to_embed: list[tuple[ContentItem, str]] = []
    existing_by_content_id = {row.content_id: row for row in existing_rows}
    for content in contents:
        text = content_embedding_text(content)
        existing = existing_by_content_id.get(content.id)
        if text and (not existing or not vector_values(existing.embedding) or (existing.embedding_text or "") != text):
            rows_to_embed.append((content, text))

    reembed_ids = {content.id for content, _ in rows_to_embed}
    stored = sum(1 for row in existing_rows if row.content_id not in reembed_ids and vector_values(row.embedding))
    for batch in embedding_batches(rows_to_embed):
        texts = [text for _, text in batch]
        first_content = batch[0][0]
        result = embed_texts(
            texts,
            user_id=str(first_content.owner_user_id) if first_content.owner_user_id else None,
            reference_id=str(first_content.crawl_job_id or first_content.id),
            run_type="CREATE_EMBEDDING",
            step_name="content_embedding_batch",
        )
        upsert_rows = []
        for (content, text), vector in zip(batch, result.embeddings):
            if not vector:
                continue
            now = datetime.utcnow()
            upsert_rows.append(
                {
                    "id": uuid.uuid4(),
                    "content_id": content.id,
                    "embedding": vector,
                    "embedding_text": text,
                    "model_name": result.model_name,
                    "embedding_dim": len(vector),
                    "created_at": now,
                    "updated_at": now,
                }
            )

        if not upsert_rows:
            continue
        stmt = pg_insert(ContentEmbedding.__table__).values(upsert_rows)
        db.execute(
            stmt.on_conflict_do_update(
                constraint="uq_content_embedding_model",
                set_={
                    "embedding": stmt.excluded.embedding,
                    "embedding_text": stmt.excluded.embedding_text,
                    "embedding_dim": stmt.excluded.embedding_dim,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
        )
        db.flush()
        stored += len(upsert_rows)

    return {"count": stored, "model_name": preferred_model_name}


def content_embedding_text(content: ContentItem) -> str:
    metadata = source_metadata(content)
    tags = normalize_tags(metadata.get("tags"))
    full_text = _load_content_full_text(content.mongo_normalized_id)
    parts = [
        labeled_text("Title", content.canonical_title or content.normalized_title),
        labeled_text("Summary", content.summary),
        labeled_text("Category", metadata.get("category")),
        labeled_text("Tags", ", ".join(tags)),
        labeled_text("Opening content", first_n_sentences(full_text or "", 4, max_chars=1800)),
    ]
    return "\n\n".join(part for part in parts if part)[:4000]


def labeled_text(label: str, value: Any) -> str:
    text = str(value or "").strip()
    return f"{label}:\n{text}" if text else ""


def normalize_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    if isinstance(value, str):
        return [part.strip() for part in re.split(r"[,;\n]+", value) if part.strip()]
    return []


def first_n_sentences(text: str, count: int, *, max_chars: int) -> str:
    clean_text = re.sub(r"\s+", " ", str(text or "")).strip()
    if not clean_text:
        return ""

    sentences = re.findall(r".+?(?:[.!?。！？]+(?=\s|$)|$)", clean_text)
    opening = " ".join(sentence.strip() for sentence in sentences[:count] if sentence.strip())
    if not opening:
        opening = clean_text
    return opening[:max_chars].strip()


def source_metadata(content: ContentItem) -> dict[str, Any]:
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources else {}
    metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def embedding_batches(rows: list[tuple[ContentItem, str]]) -> list[list[tuple[ContentItem, str]]]:
    settings = get_settings()
    max_items = max(1, int(settings.embedding_batch_size or 64))
    max_chars = max(1, int(settings.embedding_batch_max_chars or 240_000))
    batches: list[list[tuple[ContentItem, str]]] = []
    current: list[tuple[ContentItem, str]] = []
    current_chars = 0
    for row in rows:
        text_len = len(row[1])
        if current and (len(current) >= max_items or current_chars + text_len > max_chars):
            batches.append(current)
            current = []
            current_chars = 0
        current.append(row)
        current_chars += text_len
    if current:
        batches.append(current)
    return batches


def vector_values(value: Any) -> list[float]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, str):
        raw = value.strip().strip("[]")
        if not raw:
            return []
        return [float(part.strip()) for part in raw.split(",") if part.strip()]
    if isinstance(value, list):
        return [float(item) for item in value]
    return []


def model_name() -> str:
    settings = get_settings()
    return f"{settings.embedding_model_name}:{settings.embedding_dimensions}"
