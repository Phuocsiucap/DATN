from __future__ import annotations

from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import CRAWL_JOB_CREATED, CRAWL_JOB_PROGRESS, CRAWL_TASK_REQUESTED


class CrawlTaskProducer:
    source = "crawl-orchestrator"

    def job_created(self, *, job_id, payload: dict) -> None:
        publish(
            CRAWL_JOB_CREATED,
            build_event(event_type=CRAWL_JOB_CREATED, source=self.source, job_id=job_id, payload=payload),
        )

    def task_requested(self, *, job_id, correlation_id: str | None, payload: dict) -> None:
        publish(
            CRAWL_TASK_REQUESTED,
            build_event(
                event_type=CRAWL_TASK_REQUESTED,
                source=self.source,
                job_id=job_id,
                correlation_id=correlation_id,
                payload=payload,
            ),
        )

    def job_progress(self, *, job_id, status: str, stage: str, progress: float) -> None:
        publish(
            CRAWL_JOB_PROGRESS,
            build_event(
                event_type=CRAWL_JOB_PROGRESS,
                source=self.source,
                job_id=job_id,
                payload={"status": status, "stage": stage, "progress": progress},
            ),
        )
