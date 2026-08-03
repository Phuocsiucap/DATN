import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import Module2Handoff, User
from common.db.session import get_db
from app.schemas import planning as schemas
from app.services.planning import PlanningService

router = APIRouter()


@router.post("", response_model=schemas.Module2HandoffResponse)
def create_handoff(payload: schemas.Module2HandoffCreateRequest, user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return PlanningService().create_handoff(db, payload, user)


@router.post("/auto-from-crawl", response_model=schemas.Module2AutoHandoffResponse)
def create_auto_handoff_from_crawl(payload: schemas.Module2AutoHandoffRequest, user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    handoff, planning_job = PlanningService().create_auto_handoff_from_crawl(db, payload, user)
    return {"handoff": handoff, "planning_job": planning_job}


@router.get("", response_model=list[schemas.Module2HandoffResponse])
def list_handoffs(user_id: uuid.UUID, db: Session = Depends(get_db)):
    return (
        db.query(Module2Handoff)
        .filter(Module2Handoff.user_id == user_id)
        .order_by(Module2Handoff.created_at.desc())
        .limit(100)
        .all()
    )


@router.get("/{handoff_id}", response_model=schemas.Module2HandoffResponse)
def get_handoff(handoff_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    handoff = db.get(Module2Handoff, handoff_id)
    if not handoff or handoff.user_id != user_id:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return handoff
