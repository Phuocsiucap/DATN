from __future__ import annotations

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CRAWL_TASK_REQUESTED
from app.crawler.services.crawler_runner import CrawlerRunner


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
                    queued_tasks = db.query(KafkaTask).filter(KafkaTask.status == "QUEUED", KafkaTask.task_type == "CRAWL_URL").all()
                    for task in queued_tasks:
                        runner.handle_task_requested(
                            db,
                            {
                                "payload": {
                                    "task_id": str(task.id),
                                    "job_id": str(task.reference_id),
                                    "source_type": task.payload_jsonb.get("source_type") if isinstance(task.payload_jsonb, dict) else "BILIBILI",
                                    "source_url": task.payload_jsonb.get("source_url") if isinstance(task.payload_jsonb, dict) else None,
                                    "keywords": task.payload_jsonb.get("keywords") if isinstance(task.payload_jsonb, dict) else [],
                                    "configuration": task.payload_jsonb.get("configuration") if isinstance(task.payload_jsonb, dict) else {},
                                }
                            },
                        )
            except Exception as e:
                print(f"[crawler-service] Error in polling loop: {e}")
            time.sleep(2)
        return

    kafka_consumer = consumer([CRAWL_TASK_REQUESTED], group_id="crawler-service")
    runner = CrawlerRunner()
    for record in kafka_consumer:
        try:
            print(f"[crawler-service] Received task record offset: {record.offset}")
            with SessionLocal() as db:
                runner.handle_task_requested(db, record.value)
            kafka_consumer.commit()
        except Exception as e:
            print(f"[crawler-service] Error processing record offset {record.offset}: {e}")
