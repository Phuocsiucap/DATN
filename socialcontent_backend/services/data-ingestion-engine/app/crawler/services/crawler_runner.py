import logging
import time
from datetime import datetime

from sqlalchemy.orm import Session

from common.db.crawl_status import add_crawl_log, finalize_job_if_ready
from common.db.content_history import processed_source_identities_for_user
from common.db.idempotency import claim_event
from common.db.models import CrawlJob, KafkaTask
from app.crawler.crawlers.bilibili import BilibiliCrawler
from app.crawler.crawlers.vnexpress import VNExpressCrawler
from app.crawler.producers.content_events import CrawlerEventProducer
from app.normalization.normalizers.document import normalize_raw_document
from app.normalization.producers.normalized_events import NormalizationEventProducer
from app.normalization.repositories.documents import NormalizationDocumentRepository

logger = logging.getLogger(__name__)


class CrawlerRunner:
    consumer_name = "crawler-service"

    def __init__(
        self,
        repository: NormalizationDocumentRepository | None = None,
        producer: CrawlerEventProducer | None = None,
        normalization_producer: NormalizationEventProducer | None = None,
    ) -> None:
        self.repository = repository or NormalizationDocumentRepository()
        self.producer = producer or CrawlerEventProducer()
        self.normalization_producer = normalization_producer or NormalizationEventProducer()

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

        task = db.get(KafkaTask, task_id)
        job = db.get(CrawlJob, job_id)
        if not task or not job or task.task_type != "CRAWL_URL":
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
            configuration = dict(payload.get("configuration") or {})
            if str(job.content_scope or "").upper() == "PRIVATE" and job.requested_by:
                excluded_urls, excluded_external_ids = processed_source_identities_for_user(
                    db,
                    job.requested_by,
                    source_type=source_type,
                    current_crawl_job_id=job.id,
                )
                configuration["excluded_source_urls"] = sorted(excluded_urls)
                configuration["excluded_source_external_ids"] = sorted(excluded_external_ids)
            add_crawl_log(
                db,
                job_id=job.id,
                task_id=task.id,
                source_type=source_type,
                stage="CRAWLING",
                message="Crawler task started",
                metadata={
                    "attempt": task.attempt_count,
                    "source_url": payload.get("source_url"),
                    "keywords": payload.get("keywords") or [],
                    "excluded_previous_source_count": len(configuration.get("excluded_source_urls") or []),
                },
            )
            documents = crawler.fetch_many(
                job_id=str(job.id),
                task_id=str(task.id),
                source_type=source_type,
                source_url=payload.get("source_url"),
                keywords=payload.get("keywords") or [],
                configuration=configuration,
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
            processed_documents = self.to_processed_documents(crawler, documents)
            processed_document_ids = self.repository.insert_processed_many(processed_documents)

            task.status = "SUCCEEDED"
            task.completed_at = datetime.utcnow()
            job.status = "RUNNING"
            job.current_stage = "NORMALIZING"
            job.total_discovered = max(job.total_discovered, job.total_crawled + len(processed_document_ids))
            job.total_crawled += len(processed_document_ids)
            job.total_normalized += len(processed_document_ids)
            job.progress_percent = max(float(job.progress_percent), 60)
            add_crawl_log(
                db,
                job_id=job.id,
                task_id=task.id,
                source_type=source_type,
                stage="CRAWLING",
                message="Crawler task completed",
                metadata={
                    "processed_document_count": len(processed_document_ids),
                    "skipped_count": len(getattr(crawler, "last_errors", [])),
                    "skipped_previous_content_count": len(getattr(crawler, "last_skipped_existing", [])),
                },
            )
            finalized = finalize_job_if_ready(db, job) if len(processed_document_ids) == 0 else False
            db.commit()

            for processed_document_id, document in zip(processed_document_ids, processed_documents):
                self.normalization_producer.normalized(
                    job_id=job.id,
                    correlation_id=message.get("correlation_id"),
                    payload={
                        "processed_document_id": processed_document_id,
                        "task_id": str(task.id),
                        "quality": document.get("quality"),
                    },
                )
            self.producer.task_completed(job_id=job.id, task_id=str(task.id))
            if finalized:
                self.producer.job_completed(job_id=job.id, status=job.status)
        except Exception as exc:
            task.error_message = str(exc)
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

    def retry_delay_seconds(self, task: KafkaTask, configuration: dict) -> int:
        if "retry_backoff_seconds" in configuration:
            return max(0, min(int(configuration["retry_backoff_seconds"]), 300))
        return min(2 ** max(task.attempt_count - 1, 0) * 2, 30)

    def to_processed_documents(self, crawler, documents: list[dict]) -> list[dict]:
        if getattr(crawler, "outputs_normalized", False):
            return documents
        return [normalize_raw_document(document) for document in documents]
