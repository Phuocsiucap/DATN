from __future__ import annotations

from datetime import datetime
import logging

from sqlalchemy.orm import Session

from common.db.models import AuditLog, CrawlJob, CrawlJobSource, KafkaTask, User
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import CRAWL_JOB_CREATED
from app.schemas import api as schemas


logger = logging.getLogger(__name__)


class CrawlJobService:
    def create(self, db: Session, payload: schemas.CrawlJobCreateRequest, user: User) -> CrawlJob:
        # If user is not system admin, force PRIVATE scope and USER created_by_type
        scope = payload.content_scope if user.is_system_admin else "PRIVATE"
        created_by = payload.created_by_type if user.is_system_admin else "USER"
        job = CrawlJob(
            name=payload.name,
            crawl_mode=payload.crawl_mode,
            content_scope=scope,
            created_by_type=created_by,
            priority=payload.priority,
            requested_by=user.id,
            status="PENDING",
            current_stage="DISCOVERING",
        )
        for source in payload.sources:
            job.sources.append(
                CrawlJobSource(
                    source_type=source.source_type.upper(),
                    source_url=source.source_url,
                    keywords=source.keywords,
                    configuration=source.configuration,
                )
            )
        db.add(job)
        db.add(AuditLog(actor_id=user.id, action="crawl_job.created", target_type="crawl_job", metadata_json={"name": job.name}))
        db.commit()
        db.refresh(job)
        try:
            self.publish_created(job, {"job_id": str(job.id), "source_count": len(job.sources), "requested_by": str(user.id)})
        except Exception as exc:
            logger.exception("Failed to publish crawl job created event for %s", job.id)
            db.add(
                AuditLog(
                    actor_id=user.id,
                    action="crawl_job.publish_failed",
                    target_type="crawl_job",
                    target_id=str(job.id),
                    metadata_json={"error": str(exc)},
                )
            )
            db.commit()
        return job

    def cancel(self, db: Session, job: CrawlJob, user: User) -> CrawlJob:
        job.status = "CANCELLED"
        job.current_stage = "COMPLETED"
        job.completed_at = datetime.utcnow()
        for task in job.tasks:
            if task.status in {"PENDING", "QUEUED", "RUNNING", "RETRYING"}:
                task.status = "CANCELLED"
                task.completed_at = datetime.utcnow()
        db.add(AuditLog(actor_id=user.id, action="crawl_job.cancelled", target_type="crawl_job", target_id=str(job.id)))
        db.commit()
        db.refresh(job)
        return job

    def retry(self, db: Session, job: CrawlJob, user: User) -> CrawlJob:
        job.status = "QUEUED"
        job.current_stage = "DISCOVERING"
        job.total_discovered = 0
        job.total_crawled = 0
        job.total_normalized = 0
        job.total_failed = 0
        job.total_duplicates = 0
        job.progress_percent = 0
        job.started_at = None
        job.completed_at = None
        db.query(KafkaTask).filter(KafkaTask.reference_id == str(job.id), KafkaTask.task_type.startswith("CRAWL")).delete(synchronize_session=False)
        db.add(AuditLog(actor_id=user.id, action="crawl_job.retry", target_type="crawl_job", target_id=str(job.id)))
        db.commit()
        db.refresh(job)
        self.publish_created(job, {"job_id": str(job.id), "retry": True})
        return job

    def publish_created(self, job: CrawlJob, payload: dict) -> None:
        publish(CRAWL_JOB_CREATED, build_event(event_type=CRAWL_JOB_CREATED, source="api-service", job_id=job.id, payload=payload))
