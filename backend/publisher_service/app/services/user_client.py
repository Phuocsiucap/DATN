from __future__ import annotations

from typing import Any

import httpx

from backend.publisher_service.app.core.config import settings


async def get_article_by_link(link: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(f"{settings.user_service_url}/api/internal/articles/by-link", params={"link": link})
        response.raise_for_status()
        return response.json()


async def get_profile(profile_id: int) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(f"{settings.user_service_url}/api/internal/social-profiles/{profile_id}")
        response.raise_for_status()
        return response.json()


async def get_queue_item(queue_item_id: int) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(f"{settings.user_service_url}/api/internal/publishing/queue/{queue_item_id}")
        response.raise_for_status()
        return response.json()


async def mark_queue_item_publishing(queue_item_id: int) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{settings.user_service_url}/api/internal/publishing/queue/{queue_item_id}/publishing")
        response.raise_for_status()
        return response.json()


async def complete_queue_item(queue_item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{settings.user_service_url}/api/internal/publishing/queue/{queue_item_id}/completed",
            json=payload,
        )
        response.raise_for_status()
        return response.json()


async def create_publish_log(payload: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{settings.user_service_url}/api/internal/publish-log", json=payload)
        response.raise_for_status()
