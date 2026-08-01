import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from common.db.models import ProcessedEvent


def claim_event(db: Session, event_id: str | uuid.UUID, consumer_name: str) -> bool:
    row = ProcessedEvent(event_id=uuid.UUID(str(event_id)), consumer_name=consumer_name)
    db.add(row)
    try:
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False
