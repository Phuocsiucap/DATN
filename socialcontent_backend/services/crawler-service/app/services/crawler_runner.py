import logging
import time
from datetime import datetime

from sqlalchemy.orm import Session

from common.db.crawl_status import add_crawl_log, finalize_job_if_ready
from common.db.idempotency import claim_event
from common.db.models import CrawlJob, CrawlTask
from app.crawlers.bilibili import BilibiliCrawler
from app.crawlers.vnexpress import VNExpressCrawler
from app.producers.content_events import CrawlerEventProducer
from app.repositories.raw_documents import RawDocumentRepository

logger = logging.getLogger(__name__)


class CrawlerRunner:
    consumer_name = "crawler-service"

    def __init__(
        self,
        repository: RawDocumentRepository | None = None,
        producer: CrawlerEventProducer | None = None,
    ) -> None:
        self.repository = repository or RawDocumentRepository()
        self.producer = producer or CrawlerEventProducer()

    def pick_crawler(self, source_type: str):
        if source_type.upper() == "BILIBILI":
            return BilibiliCrawler()
        return VNExpressCrawler()

    def handle_task_requested(self, db: Session, message: dict) -> None:
        event_id = message.get("event_id")
        if event_id and not claim_event(db, event_id, self.consumer_name):
            logger.info(f"[CrawlerRunner] Event {event_id} already processed, skipping.")
            return

        payload = message.get("payload", {})
        task_id = payload.get("task_id")
        job_id = message.get("job_id") or payload.get("job_id")
        source_type = payload.get("source_type", "BILIBILI").upper()
        logger.info(f"[CrawlerRunner] Executing task {task_id} for job {job_id} ({source_type})")

        task = db.get(CrawlTask, task_id)
        job = db.get(CrawlJob, job_id)
        if not task or not job:
            return
        if job.status == "CANCELLED":
            task.status = "CANCELLED"
            task.completed_at = datetime.utcnow()
            add_crawl_log(
                db,
                job_id=job.id,
                task_id=task.id,
                source_type=source_type,
                stage="CRAWLING",
                level="INFO",
                message="Crawler task skipped because job was cancelled",
                metadata={"source_url": payload.get("source_url"), "keywords": payload.get("keywords") or []},
            )
            db.commit()
            return

        try:
            task.status = "RUNNING"
            task.started_at = datetime.utcnow()
            task.attempt_count += 1
            crawler = self.pick_crawler(source_type)
            add_crawl_log(
                db,
                job_id=job.id,
                task_id=task.id,
                source_type=source_type,
                stage="CRAWLING",
                message="Crawler task started",
                metadata={"attempt": task.attempt_count, "source_url": payload.get("source_url"), "keywords": payload.get("keywords") or []},
            )
            documents = crawler.fetch_many(
                job_id=str(job.id),
                task_id=str(task.id),
                source_type=source_type,
                source_url=payload.get("source_url"),
                keywords=payload.get("keywords") or [],
                configuration=payload.get("configuration") or {},
            )
            for error in getattr(crawler, "last_errors", []):
                add_crawl_log(
                    db,
                    job_id=job.id,
                    task_id=task.id,
                    source_type=source_type,
                    stage=error.get("stage") or "CRAWLING",
                    level="WARNING",
                    message="Crawler item failed and was skipped",
                    metadata=error,
                )
            raw_document_ids = self.repository.insert_many(documents)

            task.status = "SUCCEEDED"
            task.completed_at = datetime.utcnow()
            job.status = "RUNNING"
            job.current_stage = "CRAWLING"
            job.total_discovered = max(job.total_discovered, job.total_crawled + len(raw_document_ids))
            job.total_crawled += len(raw_document_ids)
            job.progress_percent = max(float(job.progress_percent), 35)
            add_crawl_log(
                db,
                job_id=job.id,
                task_id=task.id,
                source_type=source_type,
                stage="CRAWLING",
                message="Crawler task completed",
                metadata={"raw_document_count": len(raw_document_ids), "skipped_count": len(getattr(crawler, "last_errors", []))},
            )
            finalized = finalize_job_if_ready(db, job) if len(raw_document_ids) == 0 else False
            db.commit()

            for raw_document_id, document in zip(raw_document_ids, documents):
                self.producer.raw_created(
                    job_id=job.id,
                    correlation_id=message.get("correlation_id"),
                    payload={
                        "raw_document_id": raw_document_id,
                        "task_id": str(task.id),
                        "source_type": source_type,
                        "content_type": document["content_type"],
                    },
                )
            self.producer.task_completed(job_id=job.id, task_id=str(task.id))
            if finalized:
                self.producer.job_completed(job_id=job.id, status=job.status)
        except Exception as exc:
            task.error_message = str(exc)
            task.error_code = exc.__class__.__name__
            if task.attempt_count < task.max_attempts:
                task.status = "RETRYING"
                retry_delay = self.retry_delay_seconds(task, payload.get("configuration") or {})
                add_crawl_log(
                    db,
                    job_id=job.id,
                    task_id=task.id,
                    source_type=source_type,
                    stage="CRAWLING",
                    level="WARNING",
                    message="Crawler task failed; retry scheduled",
                    metadata={"attempt": task.attempt_count, "max_attempts": task.max_attempts, "retry_delay_seconds": retry_delay, "error": str(exc)},
                )
                db.commit()
                if retry_delay > 0:
                    time.sleep(retry_delay)
                self.producer.task_retry_requested(job_id=job.id, correlation_id=message.get("correlation_id"), payload=payload)
                return

            task.status = "FAILED"
            job.total_failed += 1
            add_crawl_log(
                db,
                job_id=job.id,
                task_id=task.id,
                source_type=source_type,
                stage="CRAWLING",
                level="ERROR",
                message="Crawler task failed permanently",
                metadata={"attempt": task.attempt_count, "max_attempts": task.max_attempts, "error": str(exc)},
            )
            finalized = finalize_job_if_ready(db, job)
            db.commit()
            self.producer.task_failed(job_id=job.id, task_id=str(task.id), error=str(exc))
            self.producer.dead_letter(job_id=job.id, task_id=str(task.id), error=str(exc), payload=payload)
            if finalized:
                self.producer.job_completed(job_id=job.id, status=job.status)

    def retry_delay_seconds(self, task: CrawlTask, configuration: dict) -> int:
        if "retry_backoff_seconds" in configuration:
            return max(0, min(int(configuration["retry_backoff_seconds"]), 300))
        return min(2 ** max(task.attempt_count - 1, 0) * 2, 30)
