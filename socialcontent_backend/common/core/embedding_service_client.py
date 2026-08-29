from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from common.core.config import get_settings


class EmbeddingServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class EmbeddingServiceBatchResult:
    model_name: str
    embeddings: list[list[float]]
    input_tokens: int = 0
    latency_ms: int = 0


def embedding_model_storage_name() -> str:
    settings = get_settings()
    return f"{settings.embedding_model_name}:{settings.embedding_dimensions}"


def create_embedding(text: str, *, run_type: str = "PLANNING", step_name: str = "create_embedding") -> list[float]:
    result = create_embeddings([text], run_type=run_type, step_name=step_name)
    return result.embeddings[0] if result.embeddings else []


def create_embeddings(
    texts: list[str],
    *,
    run_type: str = "PLANNING",
    step_name: str = "create_embedding_batch",
) -> EmbeddingServiceBatchResult:
    clean_texts = [text.strip() for text in texts if text and text.strip()]
    if not clean_texts:
        return EmbeddingServiceBatchResult(model_name=embedding_model_storage_name(), embeddings=[])
    payload = _post_json(
        "/embeddings/embed",
        {"texts": clean_texts, "run_type": run_type, "step_name": step_name},
    )
    return EmbeddingServiceBatchResult(
        model_name=str(payload.get("model_name") or embedding_model_storage_name()),
        embeddings=[[float(value) for value in vector] for vector in payload.get("embeddings", []) if isinstance(vector, list)],
        input_tokens=int(payload.get("input_tokens") or 0),
        latency_ms=int(payload.get("latency_ms") or 0),
    )


def ensure_content_embeddings(content_ids: list[str]) -> dict[str, Any]:
    ids = [str(value) for value in content_ids if value]
    if not ids:
        return {"count": 0, "model_name": embedding_model_storage_name()}
    return _post_json("/content-embeddings/ensure", {"content_ids": ids})


def _post_json(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    url = f"{settings.embedding_service_url.rstrip('/')}/{path.lstrip('/')}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.embedding_request_timeout_seconds) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data if isinstance(data, dict) else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise EmbeddingServiceError(f"Embedding service returned {error.code}: {body}") from error
    except Exception as exc:
        raise EmbeddingServiceError(f"Embedding service request failed: {exc}") from exc
