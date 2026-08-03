import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import Module2Handoff, User
from common.db.session import get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


def _orchestrator_url() -> str:
    return get_settings().planning_orchestrator_url.rstrip("/")


@router.post("", response_model=schemas.Module2HandoffResponse)
def create_handoff(payload: schemas.Module2HandoffCreateRequest, user: User = Depends(get_current_user)):
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{_orchestrator_url()}/api/v1/handoffs",
                params={"user_id": str(user.id)},
                json=payload.model_dump(mode="json"),
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.json().get("detail", "Error from planning orchestrator"))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Planning Orchestrator unavailable: {exc}")


@router.post("/auto-from-crawl", response_model=schemas.Module2AutoHandoffResponse)
def create_auto_handoff_from_crawl(payload: schemas.Module2AutoHandoffRequest, user: User = Depends(get_current_user)):
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{_orchestrator_url()}/api/v1/handoffs/auto-from-crawl",
                params={"user_id": str(user.id)},
                json=payload.model_dump(mode="json"),
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.json().get("detail", "Error from planning orchestrator"))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Planning Orchestrator unavailable: {exc}")


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
