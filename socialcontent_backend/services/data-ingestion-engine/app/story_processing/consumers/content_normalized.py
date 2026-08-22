import logging

from common.core.config import get_settings
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CONTENT_NORMALIZED
from app.story_processing.services.canonical_writer import CanonicalWriter

logger = logging.getLogger(__name__)


def run_content_normalized_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("[story-processing-service] Kafka disabled; running Mongo polling loop...")
        writer = CanonicalWriter()
        import time
        from common.db.mongo import processed_documents
        from common.db.models import ProcessingRun
        while True:
            try:
                with SessionLocal() as db:
                    canonical_input_refs = set(
                        r[0] for r in db.query(ProcessingRun.input_reference).filter(ProcessingRun.processing_type == "CANONICAL_SAVE").all()
                    )
                    all_procs = list(processed_documents().find())
                    for pdoc in all_procs:
                        pdoc_id = str(pdoc["_id"])
                        if pdoc_id not in canonical_input_refs:
                            writer.handle_content_normalized(db, {"job_id": pdoc.get("job_id"), "payload": {"processed_document_id": pdoc_id}})
            except Exception as e:
                print(f"[story-processing-service] Error in polling loop: {e}")
            time.sleep(2)
        return

    kafka_consumer = consumer([CONTENT_NORMALIZED], group_id="story-processing-service")
    writer = CanonicalWriter()
    print("[story-processing-service] Consumer started listening on CONTENT_NORMALIZED")
    for record in kafka_consumer:
        try:
            print(f"[story-processing-service] Received normalized record offset: {record.offset}")
            with SessionLocal() as db:
                writer.handle_content_normalized(db, record.value)
            kafka_consumer.commit()
        except Exception as exc:
            print(f"[story-processing-service] Error handling content.normalized event: {exc}")
