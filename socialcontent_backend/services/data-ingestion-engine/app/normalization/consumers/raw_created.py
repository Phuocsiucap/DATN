from __future__ import annotations

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CONTENT_RAW_CREATED
from app.normalization.services.normalization_runner import NormalizationRunner


def run_raw_created_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("[normalization-service] Kafka disabled; running Mongo polling loop...")
        runner = NormalizationRunner()
        import time
        from common.db.mongo import raw_documents, processed_documents
        while True:
            try:
                with SessionLocal() as db:
                    # Find raw documents that don't have a corresponding processed document yet
                    proc_raw_ids = set(doc.get("raw_document_id") for doc in processed_documents().find({}, {"raw_document_id": 1}))
                    unprocessed_raws = list(raw_documents().find())
                    for rdoc in unprocessed_raws:
                        rdoc_id = str(rdoc["_id"])
                        if rdoc_id not in proc_raw_ids:
                            runner.handle_raw_created(db, {"job_id": rdoc.get("job_id"), "payload": {"raw_document_id": rdoc_id}})
            except Exception as e:
                print(f"[normalization-service] Error in polling loop: {e}")
            time.sleep(2)
        return

    kafka_consumer = consumer([CONTENT_RAW_CREATED], group_id="normalization-service")
    runner = NormalizationRunner()
    for record in kafka_consumer:
        try:
            print(f"[normalization-service] Received raw created record offset: {record.offset}")
            with SessionLocal() as db:
                runner.handle_raw_created(db, record.value)
            kafka_consumer.commit()
        except Exception as e:
            print(f"[normalization-service] Error processing record offset {record.offset}: {e}")
