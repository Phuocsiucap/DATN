from __future__ import annotations

from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import CONTENT_NORMALIZED, CRAWL_JOB_COMPLETED


class NormalizationEventProducer:
    source = "normalization-service"

    def normalized(self, *, job_id, correlation_id: str | None, payload: dict) -> None:
        publish(
            CONTENT_NORMALIZED,
            build_event(event_type=CONTENT_NORMALIZED, source=self.source, job_id=job_id, correlation_id=correlation_id, payload=payload),
        )

    def job_completed(self, *, job_id, status: str) -> None:
        publish(
            CRAWL_JOB_COMPLETED,
            build_event(event_type=CRAWL_JOB_COMPLETED, source=self.source, job_id=job_id, payload={"status": status}),
        )
