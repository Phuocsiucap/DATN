from __future__ import annotations

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CRAWL_TASK_REQUESTED
from app.crawler.services.crawler_runner import CrawlerRunner


def _payload_for_task(db, task) -> dict:
    payload = dict(task.payload_jsonb or {}) if isinstance(task.payload_jsonb, dict) else {}
    source = None
    if not payload.get("source_type") or "configuration" not in payload:
        from common.db.models import CrawlJobSource

        source_id = payload.get("job_source_id")
        if source_id:
            source = db.get(CrawlJobSource, source_id)
    if source:
        payload.update(
            {
                "job_source_id": str(source.id),
                "source_type": source.source_type,
                "source_url": source.source_url,
                "keywords": source.keywords,
                "configuration": source.configuration,
            }
        )
    payload.setdefault("job_id", str(task.reference_id))
    payload.setdefault("task_id", str(task.id))
    payload.setdefault("source_type", "BILIBILI")
    payload.setdefault("source_url", None)
    payload.setdefault("keywords", [])
    payload.setdefault("configuration", {})
    return payload


def _run_recoverable_tasks(db, runner: CrawlerRunner) -> int:
    from common.db.models import KafkaTask

    tasks = (
        db.query(KafkaTask)
        .filter(KafkaTask.status.in_(["QUEUED", "RETRYING"]), KafkaTask.task_type == "CRAWL_URL")
        .all()
    )
    for task in tasks:
        runner.handle_task_requested(db, {"payload": _payload_for_task(db, task)})
    return len(tasks)


def run_task_requested_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("[crawler-service] Kafka disabled; running DB polling loop...")
        runner = CrawlerRunner()
        import time
        from common.db.models import KafkaTask
        while True:
            try:
                with SessionLocal() as db:
                    _run_recoverable_tasks(db, runner)
            except Exception as e:
                print(f"[crawler-service] Error in polling loop: {e}")
            time.sleep(2)
        return

    kafka_consumer = consumer([CRAWL_TASK_REQUESTED], group_id="crawler-service")
    runner = CrawlerRunner()
    try:
        with SessionLocal() as db:
            recovered = _run_recoverable_tasks(db, runner)
            if recovered:
                print(f"[crawler-service] Recovered {recovered} queued crawl task(s) on startup.")
    except Exception as e:
        print(f"[crawler-service] Error recovering queued tasks: {e}")

    for record in kafka_consumer:
        try:
            print(f"[crawler-service] Received task record offset: {record.offset}")
            with SessionLocal() as db:
                runner.handle_task_requested(db, record.value)
            kafka_consumer.commit()
        except Exception as e:
            print(f"[crawler-service] Error processing record offset {record.offset}: {e}")
