from __future__ import annotations

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CRAWL_JOB_CREATED
from app.orchestrator.services.orchestrator import CrawlOrchestrator


def run_job_created_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("[crawl-orchestrator] Kafka disabled; running DB polling loop...")
        orchestrator = CrawlOrchestrator()
        import time
        from common.db.models import CrawlJob
        while True:
            try:
                with SessionLocal() as db:
                    pending_jobs = db.query(CrawlJob).filter(CrawlJob.status == "PENDING").all()
                    for job in pending_jobs:
                        orchestrator.handle_crawl_job_created(db, {"job_id": str(job.id)})
            except Exception as e:
                print(f"[crawl-orchestrator] Error in polling loop: {e}")
            time.sleep(2)
        return

    kafka_consumer = consumer([CRAWL_JOB_CREATED], group_id="crawl-orchestrator")
    orchestrator = CrawlOrchestrator()

    # Recovery check on consumer start for any PENDING jobs that missed events
    try:
        from common.db.models import CrawlJob
        with SessionLocal() as db:
            pending_jobs = db.query(CrawlJob).filter(CrawlJob.status == "PENDING").all()
            if pending_jobs:
                print(f"[crawl-orchestrator] Found {len(pending_jobs)} PENDING job(s) on startup, triggering orchestrator...")
                for job in pending_jobs:
                    orchestrator.handle_crawl_job_created(db, {"job_id": str(job.id)})
    except Exception as e:
        print(f"[crawl-orchestrator] Error recovering pending jobs: {e}")

    for record in kafka_consumer:
        try:
            print(f"[crawl-orchestrator] Received event record offset: {record.offset}")
            with SessionLocal() as db:
                orchestrator.handle_crawl_job_created(db, record.value)
            kafka_consumer.commit()
        except Exception as e:
            print(f"[crawl-orchestrator] Error processing record offset {record.offset}: {e}")
