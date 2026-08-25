import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from common.db.models import KafkaTask


def claim_event(db: Session, event_id: str | uuid.UUID, consumer_name: str) -> bool:
    event_value = str(event_id)
    try:
        reference_id = uuid.UUID(event_value)
    except ValueError:
        reference_id = None

    row = KafkaTask(
        task_type="IDEMPOTENCY",
        status="COMPLETED",
        current_stage="CLAIMED",
        progress_percent=100,
        idempotency_key=f"{consumer_name}:{event_value}",
        reference_id=reference_id,
        reference_type="event",
        payload_jsonb={"event_id": event_value, "consumer_name": consumer_name},
        result_jsonb={},
    )
    db.add(row)
    try:
        db.flush()
        return True
    except IntegrityError:
        db.rollback()
        return False
