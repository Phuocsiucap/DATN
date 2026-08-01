import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import Module2Handoff, User
from common.db.session import get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas
from app.services.planning import PlanningService

router = APIRouter()


@router.post("", response_model=schemas.Module2HandoffResponse)
def create_handoff(payload: schemas.Module2HandoffCreateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return PlanningService().create_handoff(db, payload, user)


@router.get("", response_model=list[schemas.Module2HandoffResponse])
def list_handoffs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Module2Handoff)
        .filter(Module2Handoff.user_id == user.id)
        .order_by(Module2Handoff.created_at.desc())
        .limit(100)
        .all()
    )


@router.get("/{handoff_id}", response_model=schemas.Module2HandoffResponse)
def get_handoff(handoff_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    handoff = db.get(Module2Handoff, handoff_id)
    if not handoff or handoff.user_id != user.id:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return handoff
