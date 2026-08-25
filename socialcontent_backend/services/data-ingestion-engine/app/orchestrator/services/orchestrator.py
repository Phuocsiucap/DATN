import logging
from datetime import datetime

from sqlalchemy.orm import Session

from common.db.crawl_status import add_crawl_log
from common.db.idempotency import claim_event
from common.db.models import CrawlJob, KafkaTask
from app.orchestrator.producers.tasks import CrawlTaskProducer

logger = logging.getLogger(__name__)


class CrawlOrchestrator:
    consumer_name = "crawl-orchestrator"

    def __init__(self, producer: CrawlTaskProducer | None = None) -> None:
        self.producer = producer or CrawlTaskProducer()

    def handle_crawl_job_created(self, db: Session, message: dict) -> None:
        event_id = message.get("event_id")
        if event_id and not claim_event(db, event_id, self.consumer_name):
            logger.info(f"[CrawlOrchestrator] Event {event_id} already processed, skipping.")
            return
        job_id = message.get("job_id") or message.get("payload", {}).get("job_id")
        if not job_id:
            return
        job = db.get(CrawlJob, job_id)
        if not job or job.status == "CANCELLED":
            logger.info(f"[CrawlOrchestrator] Job {job_id} not found or cancelled.")
            return
        if not job.sources:
            job.status = "FAILED"
            job.current_stage = "COMPLETED"
            job.completed_at = datetime.utcnow()
            job.progress_percent = 100
            add_crawl_log(
                db,
                job_id=job.id,
                stage="DISCOVERING",
                level="ERROR",
                message="Crawl job has no sources",
            )
            db.commit()
            return
        existing_task_count = (
            db.query(KafkaTask)
            .filter(
                KafkaTask.reference_id == job.id,
                KafkaTask.reference_type == "crawl_job",
                KafkaTask.task_type == "CRAWL_URL",
            )
            .count()
        )
        if existing_task_count:
            add_crawl_log(
                db,
                job_id=job.id,
                stage="DISCOVERING",
                level="INFO",
                message="Crawl job already has tasks; duplicate creation event ignored",
                metadata={"task_count": existing_task_count},
            )
            db.commit()
            return
        logger.info(f"[CrawlOrchestrator] Starting crawl job {job_id} with {len(job.sources)} sources")

        job.status = "QUEUED"
        job.current_stage = "DISCOVERING"
        job.started_at = job.started_at or datetime.utcnow()
        job.total_discovered = len(job.sources)
        task_messages = []
        add_crawl_log(
            db,
            job_id=job.id,
            stage="DISCOVERING",
            message="Crawl job accepted by orchestrator",
            metadata={"source_count": len(job.sources)},
        )

        for source in job.sources:
            task = KafkaTask(
                reference_id=job.id,
                reference_type="crawl_job",
                task_type="CRAWL_URL",
                status="QUEUED",
                max_attempts=max(int((source.configuration or {}).get("max_attempts", 4)), 1),
                payload_jsonb={
                    "job_source_id": str(source.id),
                    "external_reference": source.source_url or ",".join(source.keywords)
                }
            )
            db.add(task)
            db.flush()
            add_crawl_log(
                db,
                job_id=job.id,
                task_id=task.id,
                source_type=source.source_type,
                stage="DISCOVERING",
                message="Crawl task requested",
                metadata={"source_url": source.source_url, "keywords": source.keywords, "max_attempts": task.max_attempts},
            )
            task_messages.append(
                {
                    "task_id": str(task.id),
                    "job_id": str(job.id),
                    "job_source_id": str(source.id),
                    "source_type": source.source_type,
                    "source_url": source.source_url,
                    "keywords": source.keywords,
                    "configuration": source.configuration,
                }
            )

        job.progress_percent = 10
        db.commit()
        for payload in task_messages:
            self.producer.task_requested(job_id=job.id, correlation_id=message.get("correlation_id"), payload=payload)
        self.producer.job_progress(job_id=job.id, status=job.status, stage=job.current_stage, progress=10)
