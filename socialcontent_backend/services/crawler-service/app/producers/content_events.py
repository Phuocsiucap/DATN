from __future__ import annotations

from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import CONTENT_RAW_CREATED, CRAWL_JOB_COMPLETED, CRAWL_TASK_COMPLETED, CRAWL_TASK_FAILED, CRAWL_TASK_REQUESTED, DEAD_LETTER_CONTENT


class CrawlerEventProducer:
    source = "crawler-service"

    def raw_created(self, *, job_id, correlation_id: str | None, payload: dict) -> None:
        publish(
            CONTENT_RAW_CREATED,
            build_event(event_type=CONTENT_RAW_CREATED, source=self.source, job_id=job_id, correlation_id=correlation_id, payload=payload),
        )

    def task_completed(self, *, job_id, task_id: str) -> None:
        publish(
            CRAWL_TASK_COMPLETED,
            build_event(event_type=CRAWL_TASK_COMPLETED, source=self.source, job_id=job_id, payload={"task_id": task_id}),
        )

    def task_retry_requested(self, *, job_id, correlation_id: str | None, payload: dict) -> None:
        publish(
            CRAWL_TASK_REQUESTED,
            build_event(event_type=CRAWL_TASK_REQUESTED, source=self.source, job_id=job_id, correlation_id=correlation_id, payload=payload),
        )

    def task_failed(self, *, job_id, task_id: str, error: str) -> None:
        publish(
            CRAWL_TASK_FAILED,
            build_event(event_type=CRAWL_TASK_FAILED, source=self.source, job_id=job_id, payload={"task_id": task_id, "error": error}),
        )

    def dead_letter(self, *, job_id, task_id: str, error: str, payload: dict) -> None:
        publish(
            DEAD_LETTER_CONTENT,
            build_event(
                event_type=DEAD_LETTER_CONTENT,
                source=self.source,
                job_id=job_id,
                payload={"task_id": task_id, "error": error, "original_payload": payload},
            ),
        )

    def job_completed(self, *, job_id, status: str) -> None:
        publish(
            CRAWL_JOB_COMPLETED,
            build_event(event_type=CRAWL_JOB_COMPLETED, source=self.source, job_id=job_id, payload={"status": status}),
        )
