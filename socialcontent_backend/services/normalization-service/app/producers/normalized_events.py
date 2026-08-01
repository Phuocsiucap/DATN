from __future__ import annotations

from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import CONTENT_NORMALIZATION_FAILED, CONTENT_NORMALIZED, CRAWL_JOB_COMPLETED, DEAD_LETTER_CONTENT


class NormalizationEventProducer:
    source = "normalization-service"

    def normalized(self, *, job_id, correlation_id: str | None, payload: dict) -> None:
        publish(
            CONTENT_NORMALIZED,
            build_event(event_type=CONTENT_NORMALIZED, source=self.source, job_id=job_id, correlation_id=correlation_id, payload=payload),
        )

    def failed(self, *, job_id, raw_document_id: str, error: str) -> None:
        publish(
            CONTENT_NORMALIZATION_FAILED,
            build_event(event_type=CONTENT_NORMALIZATION_FAILED, source=self.source, job_id=job_id, payload={"raw_document_id": raw_document_id, "error": error}),
        )

    def dead_letter(self, *, job_id, raw_document_id: str, error: str) -> None:
        publish(
            DEAD_LETTER_CONTENT,
            build_event(event_type=DEAD_LETTER_CONTENT, source=self.source, job_id=job_id, payload={"raw_document_id": raw_document_id, "error": error}),
        )

    def job_completed(self, *, job_id, status: str) -> None:
        publish(
            CRAWL_JOB_COMPLETED,
            build_event(event_type=CRAWL_JOB_COMPLETED, source=self.source, job_id=job_id, payload={"status": status}),
        )
