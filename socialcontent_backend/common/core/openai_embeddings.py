from __future__ import annotations

import time
from dataclasses import dataclass

from common.core.config import get_settings
from common.core.llm import post_json
from common.db.prompt_runs import log_prompt_run


class OpenAIEmbeddingError(RuntimeError):
    pass


@dataclass(frozen=True)
class EmbeddingBatchResult:
    model_name: str
    embeddings: list[list[float]]
    input_tokens: int
    latency_ms: int
    raw_response: dict


def embedding_model_storage_name() -> str:
    settings = get_settings()
    return f"{settings.embedding_model_name}:{settings.embedding_dimensions}"


def create_embeddings(
    texts: list[str],
    *,
    user_id: str | None = None,
    reference_id: str | None = None,
    run_type: str = "CREATE_EMBEDDING",
    step_name: str = "create_content_embedding",
) -> EmbeddingBatchResult:
    clean_texts = [text.strip() for text in texts if text and text.strip()]
    if not clean_texts:
        return EmbeddingBatchResult(embedding_model_storage_name(), [], 0, 0, {})

    settings = get_settings()
    if not settings.openai_api_key:
        raise OpenAIEmbeddingError("OPENAI_API_KEY is required for embeddings")

    payload = {
        "model": settings.embedding_model_name,
        "input": clean_texts,
        "dimensions": settings.embedding_dimensions,
    }
    started_at = time.perf_counter()
    raw_response = None
    last_exc = None
    for attempt in range(3):
        try:
            raw_response = post_json(
                "https://api.openai.com/v1/embeddings",
                payload,
                settings.openai_api_key,
                timeout=settings.embedding_request_timeout_seconds,
            )
            break
        except Exception as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))

    if raw_response is None:
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        log_prompt_run(
            user_id=user_id,
            reference_id=reference_id,
            run_type=run_type,
            step_name=step_name,
            model_provider="openai",
            model_name=embedding_model_storage_name(),
            latency_ms=latency_ms,
            status="FAILED",
            error_message=str(last_exc)[:2000] if last_exc else "Failed to get embedding",
        )
        raise OpenAIEmbeddingError(f"OpenAI embedding request failed: {last_exc}") from last_exc

    latency_ms = int((time.perf_counter() - started_at) * 1000)
    embeddings = _parse_embeddings(raw_response)
    usage = raw_response.get("usage") if isinstance(raw_response.get("usage"), dict) else {}
    input_tokens = int(usage.get("prompt_tokens") or usage.get("total_tokens") or 0)
    response_model = str(raw_response.get("model") or settings.embedding_model_name)
    model_name = f"{response_model}:{settings.embedding_dimensions}"

    log_prompt_run(
        user_id=user_id,
        reference_id=reference_id,
        run_type=run_type,
        step_name=step_name,
        model_provider="openai",
        model_name=model_name,
        input_tokens=input_tokens,
        output_tokens=0,
        latency_ms=latency_ms,
        status="COMPLETED",
    )
    return EmbeddingBatchResult(model_name, embeddings, input_tokens, latency_ms, raw_response)


def _parse_embeddings(payload: dict) -> list[list[float]]:
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    vectors: list[list[float]] = []
    for item in sorted((entry for entry in data if isinstance(entry, dict)), key=lambda entry: entry.get("index", 0)):
        vector = item.get("embedding")
        if isinstance(vector, list):
            vectors.append([float(value) for value in vector])
    return vectors
