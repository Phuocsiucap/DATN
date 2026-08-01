from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class EventEnvelope(BaseModel):
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    event_type: str
    event_version: int = 1
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    correlation_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    job_id: uuid.UUID | None = None
    source: str
    payload: dict[str, Any] = Field(default_factory=dict)

    def kafka_key(self) -> str:
        return str(self.job_id or self.correlation_id)

    def to_message(self) -> dict[str, Any]:
        data = self.model_dump(mode="json")
        data["event_id"] = str(self.event_id)
        data["correlation_id"] = str(self.correlation_id)
        if self.job_id:
            data["job_id"] = str(self.job_id)
        return data


def build_event(
    *,
    event_type: str,
    source: str,
    payload: dict[str, Any] | None = None,
    job_id: uuid.UUID | str | None = None,
    correlation_id: uuid.UUID | str | None = None,
) -> EventEnvelope:
    return EventEnvelope(
        event_type=event_type,
        source=source,
        payload=payload or {},
        job_id=uuid.UUID(str(job_id)) if job_id else None,
        correlation_id=uuid.UUID(str(correlation_id)) if correlation_id else uuid.uuid4(),
    )
