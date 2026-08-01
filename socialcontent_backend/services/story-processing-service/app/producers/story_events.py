from __future__ import annotations

from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import CONTENT_CANONICAL_SAVED, CRAWL_JOB_COMPLETED, STORY_GROUPED


class StoryEventProducer:
    source = "story-processing-service"

    def story_grouped(self, *, job_id, story_id: str, content_id: str) -> None:
        publish(
            STORY_GROUPED,
            build_event(event_type=STORY_GROUPED, source=self.source, job_id=job_id, payload={"story_id": story_id, "content_id": content_id}),
        )

    def canonical_saved(self, *, job_id, content_id: str, duplicate: bool) -> None:
        publish(
            CONTENT_CANONICAL_SAVED,
            build_event(event_type=CONTENT_CANONICAL_SAVED, source=self.source, job_id=job_id, payload={"content_id": content_id, "duplicate": duplicate}),
        )

    def job_completed(self, *, job_id, status: str) -> None:
        publish(
            CRAWL_JOB_COMPLETED,
            build_event(event_type=CRAWL_JOB_COMPLETED, source=self.source, job_id=job_id, payload={"status": status}),
        )
