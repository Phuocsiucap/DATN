from __future__ import annotations

import asyncio
import os
from functools import lru_cache
from typing import Literal

from fastapi import FastAPI, HTTPException
from openai import OpenAI, OpenAIError
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    embedding_provider: Literal["openai", "fastembed"] = "fastembed"
    openai_api_key: str | None = None
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dimensions: int = 512
    fastembed_model_name: str = "intfloat/multilingual-e5-large"
    fastembed_threads: int = 2

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=100)
    is_query: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_openai_client() -> OpenAI:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is required for OpenAI embeddings")
    return OpenAI(api_key=settings.openai_api_key)


@lru_cache
def get_fastembed_model():
    try:
        from fastembed import TextEmbedding

        settings = get_settings()
        return TextEmbedding(
            model_name=settings.fastembed_model_name,
            threads=settings.fastembed_threads,
        )
    except Exception as exc:
        raise RuntimeError(f"Lỗi khởi tạo model ONNX: {str(exc)}") from exc


app = FastAPI(title="Embedding Service", version="1.0")


@app.post("/embed")
async def create_embeddings(payload: EmbedRequest):
    texts = [text.strip() for text in payload.texts if text.strip()]
    if not texts:
        raise HTTPException(status_code=400, detail="Danh sách texts không được rỗng.")

    settings = get_settings()
    if settings.embedding_provider == "openai":
        return await asyncio.to_thread(create_openai_embeddings, texts)
    return await create_fastembed_embeddings(texts, is_query=payload.is_query)


def create_openai_embeddings(texts: list[str]) -> dict:
    settings = get_settings()
    try:
        response = get_openai_client().embeddings.create(
            model=settings.openai_embedding_model,
            input=texts,
            dimensions=settings.openai_embedding_dimensions,
        )
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail="Không thể tạo embedding") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Không thể tạo embedding") from exc

    return {
        "provider": "openai",
        "model": response.model,
        "dimension": len(response.data[0].embedding) if response.data else 0,
        "data": [
            {
                "index": item.index,
                "embedding": item.embedding,
            }
            for item in response.data
        ],
        "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "total_tokens": response.usage.total_tokens,
        } if response.usage else None,
    }


async def create_fastembed_embeddings(texts: list[str], *, is_query: bool) -> dict:
    settings = get_settings()
    prefix = "query: " if is_query else "passage: "
    formatted_texts = [f"{prefix}{text}" for text in texts]

    def run_inference():
        return [vec.tolist() for vec in get_fastembed_model().embed(formatted_texts)]

    try:
        embeddings = await asyncio.to_thread(run_inference)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi suy luận: {str(exc)}") from exc

    return {
        "provider": "fastembed",
        "model": f"fastembed:{settings.fastembed_model_name}",
        "dimension": len(embeddings[0]) if embeddings else 0,
        "embeddings": embeddings,
        "usage": None,
    }


@app.get("/health")
def health_check():
    settings = get_settings()
    model = settings.openai_embedding_model if settings.embedding_provider == "openai" else f"fastembed:{settings.fastembed_model_name}"
    return {
        "status": "ok",
        "provider": settings.embedding_provider,
        "model": model,
        "pid": os.getpid(),
    }
