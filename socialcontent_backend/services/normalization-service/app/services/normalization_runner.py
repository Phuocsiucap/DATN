from __future__ import annotations

from sqlalchemy.orm import Session

from common.db.crawl_status import add_crawl_log, finalize_job_if_ready
from common.db.idempotency import claim_event
from common.db.models import CrawlJob
from app.normalizers.document import normalize_raw_document
from app.producers.normalized_events import NormalizationEventProducer
from app.repositories.documents import NormalizationDocumentRepository


class NormalizationRunner:
    consumer_name = "normalization-service"

    def __init__(
        self,
        repository: NormalizationDocumentRepository | None = None,
        producer: NormalizationEventProducer | None = None,
    ) -> None:
        self.repository = repository or NormalizationDocumentRepository()
        self.producer = producer or NormalizationEventProducer()

    def handle_raw_created(self, db: Session, message: dict) -> None:
        event_id = message.get("event_id")
        if event_id and not claim_event(db, event_id, self.consumer_name):
            return

        payload = message.get("payload", {})
        raw_document_id = payload.get("raw_document_id")
        if not raw_document_id:
            return

        try:
            raw_doc = self.repository.get_raw(raw_document_id)
            if not raw_doc:
                raise ValueError(f"Raw document not found: {raw_document_id}")
            job = db.get(CrawlJob, message.get("job_id") or raw_doc.get("job_id"))
            if job and job.status == "CANCELLED":
                add_crawl_log(
                    db,
                    job_id=job.id,
                    stage="NORMALIZING",
                    level="INFO",
                    message="Raw document normalization skipped because job was cancelled",
                    metadata={"raw_document_id": raw_document_id},
                )
                db.commit()
                return
            processed = normalize_raw_document(raw_doc)
            processed_document_id = self.repository.insert_processed(processed)

            if job:
                job.current_stage = "NORMALIZING"
                job.total_normalized += 1
                job.progress_percent = max(float(job.progress_percent), 60)
                add_crawl_log(
                    db,
                    job_id=job.id,
                    stage="NORMALIZING",
                    message="Raw document normalized",
                    metadata={"raw_document_id": raw_document_id, "processed_document_id": processed_document_id, "quality": processed["quality"]},
                )
                db.commit()

            self.producer.normalized(
                job_id=message.get("job_id") or raw_doc.get("job_id"),
                correlation_id=message.get("correlation_id"),
                payload={
                    "processed_document_id": processed_document_id,
                    "raw_document_id": raw_document_id,
                    "quality": processed["quality"],
                },
            )
        except Exception as exc:
            job = db.get(CrawlJob, message.get("job_id")) if message.get("job_id") else None
            if job:
                job.total_failed += 1
                add_crawl_log(
                    db,
                    job_id=job.id,
                    stage="NORMALIZING",
                    level="ERROR",
                    message="Raw document normalization failed",
                    metadata={"raw_document_id": raw_document_id, "error": str(exc)},
                )
                finalized = finalize_job_if_ready(db, job)
                db.commit()
                if finalized:
                    self.producer.job_completed(job_id=job.id, status=job.status)
            self.producer.failed(job_id=message.get("job_id"), raw_document_id=raw_document_id, error=str(exc))
            self.producer.dead_letter(job_id=message.get("job_id"), raw_document_id=raw_document_id, error=str(exc))
