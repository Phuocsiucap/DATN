import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import ContentContext, ContentPlan, ContentSeries, Module3Handoff, Module3HandoffPart, SeriesPart, SocialProfile, User
from common.db.session import get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import MODULE3_HANDOFF_CREATED
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


@router.post("", response_model=schemas.Module3HandoffResponse)
def create_module3_handoff(payload: schemas.Module3HandoffCreateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = db.get(ContentSeries, payload.content_series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Content series not found")
    profile = db.get(SocialProfile, series.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content series not found")
    plan = db.get(ContentPlan, series.content_plan_id)
    if not plan or plan.status != "APPROVED":
        raise HTTPException(status_code=400, detail="Content plan must be approved before module 3 handoff")

    context = (
        db.query(ContentContext)
        .filter(ContentContext.series_id == series.id, ContentContext.is_active == True)  # noqa: E712
        .order_by(ContentContext.version.desc())
        .first()
    )
    parts_query = db.query(SeriesPart).filter(SeriesPart.series_id == series.id)
    if payload.part_ids:
        parts_query = parts_query.filter(SeriesPart.id.in_(payload.part_ids))
    parts = parts_query.order_by(SeriesPart.part_number.asc()).all()
    if payload.part_ids and len(parts) != len(set(payload.part_ids)):
        raise HTTPException(status_code=400, detail="All part_ids must belong to the selected series")
    if not parts:
        raise HTTPException(status_code=400, detail="Content series must have at least one part")

    handoff = Module3Handoff(
        user_id=user.id,
        profile_id=series.profile_id,
        content_plan_id=plan.id,
        content_series_id=series.id,
        context_id=context.id if context else None,
        handoff_note=payload.handoff_note,
        payload={
            "series_title": series.title,
            "plan_title": plan.title,
            "context_version": series.context_version,
            "part_count": len(parts),
            "priority": payload.priority,
        },
    )
    db.add(handoff)
    db.flush()
    for part in parts:
        db.add(
            Module3HandoffPart(
                handoff_id=handoff.id,
                series_part_id=part.id,
                part_number=part.part_number,
                payload={
                    "title": part.title,
                    "goal": part.goal,
                    "main_beats": part.main_beats,
                    "source_refs": part.source_refs,
                    "production_notes": part.production_notes,
                },
            )
        )
    series.status = "HANDED_OFF"
    db.commit()
    db.refresh(handoff)
    publish(
        MODULE3_HANDOFF_CREATED,
        build_event(
            event_type=MODULE3_HANDOFF_CREATED,
            source="api-service",
            payload={"handoff_id": str(handoff.id), "series_id": str(series.id), "plan_id": str(plan.id)},
        ),
    )
    return handoff


@router.get("", response_model=list[schemas.Module3HandoffResponse])
def list_module3_handoffs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Module3Handoff)
        .filter(Module3Handoff.user_id == user.id)
        .order_by(Module3Handoff.created_at.desc())
        .limit(100)
        .all()
    )


@router.get("/{handoff_id}", response_model=schemas.Module3HandoffResponse)
def get_module3_handoff(handoff_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    handoff = db.get(Module3Handoff, handoff_id)
    if not handoff or handoff.user_id != user.id:
        raise HTTPException(status_code=404, detail="Module 3 handoff not found")
    return handoff
