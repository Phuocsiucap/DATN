import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import AuditLog, ContentContext, ContentPlan, ContentSeries, PlanningJob, SeriesPart, SocialProfile, User
from common.db.mongo import series_contexts
from common.db.session import get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import PLANNING_JOB_CREATED
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


@router.get("", response_model=list[schemas.ContentSeriesResponse])
def list_content_series(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(ContentSeries)
        .join(SocialProfile, SocialProfile.id == ContentSeries.profile_id)
        .filter(SocialProfile.user_id == user.id)
        .order_by(ContentSeries.updated_at.desc())
        .limit(100)
        .all()
    )


@router.get("/{series_id}", response_model=schemas.ContentSeriesResponse)
def get_content_series(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_owned_series(db, series_id, user)


@router.patch("/{series_id}", response_model=schemas.ContentSeriesResponse)
def update_content_series(
    series_id: uuid.UUID,
    payload: schemas.SeriesUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    series = _get_owned_series(db, series_id, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(series, field, value)
    db.add(AuditLog(actor_id=user.id, action="content_series.updated", target_type="content_series", target_id=str(series.id)))
    db.commit()
    db.refresh(series)
    return series


@router.post("/{series_id}/regenerate", response_model=schemas.PlanningJobResponse)
def regenerate_content_series(
    series_id: uuid.UUID,
    payload: schemas.SeriesRegenerateRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    series = _get_owned_series(db, series_id, user)
    plan = db.get(ContentPlan, series.content_plan_id)
    original_job = db.get(PlanningJob, plan.planning_job_id) if plan else None
    if not plan or not original_job:
        raise HTTPException(status_code=404, detail="Planning source not found")
    series.status = "SUPERSEDED"
    next_job = PlanningJob(
        user_id=user.id,
        profile_id=series.profile_id,
        handoff_id=original_job.handoff_id,
        planning_mode=original_job.planning_mode,
        status="PENDING",
        current_stage="VALIDATING_INPUT",
        target_duration_seconds=original_job.target_duration_seconds,
        preferred_part_count=original_job.preferred_part_count,
        language=original_job.language,
        instructions=payload.instructions if payload and payload.instructions else original_job.instructions,
    )
    db.add(next_job)
    db.add(AuditLog(actor_id=user.id, action="content_series.regenerate_requested", target_type="content_series", target_id=str(series.id)))
    db.commit()
    db.refresh(next_job)
    publish(PLANNING_JOB_CREATED, build_event(event_type=PLANNING_JOB_CREATED, source="api-service", job_id=next_job.id, payload={"job_id": str(next_job.id), "regenerated_from_series_id": str(series.id)}))
    return next_job


@router.get("/{series_id}/parts", response_model=list[schemas.SeriesPartResponse])
def list_series_parts(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    return db.query(SeriesPart).filter(SeriesPart.series_id == series.id).order_by(SeriesPart.part_number.asc()).all()


@router.post("/{series_id}/parts", response_model=schemas.SeriesPartResponse)
def create_series_part(
    series_id: uuid.UUID,
    payload: schemas.SeriesPartCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    series = _get_owned_series(db, series_id, user)
    next_number = payload.part_number
    if next_number is None:
        max_part = db.query(SeriesPart).filter(SeriesPart.series_id == series.id).order_by(SeriesPart.part_number.desc()).first()
        next_number = (max_part.part_number if max_part else 0) + 1
    part = SeriesPart(series_id=series.id, **payload.model_dump(exclude={"part_number"}), part_number=next_number)
    series.total_parts += 1
    series.status = "NEEDS_REVIEW" if series.status == "APPROVED" else series.status
    db.add(part)
    db.add(AuditLog(actor_id=user.id, action="series_part.created", target_type="content_series", target_id=str(series.id)))
    db.commit()
    db.refresh(part)
    return part


@router.patch("/{series_id}/parts/{part_id}", response_model=schemas.SeriesPartResponse)
def update_series_part(
    series_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: schemas.SeriesPartUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    series = _get_owned_series(db, series_id, user)
    part = db.get(SeriesPart, part_id)
    if not part or part.series_id != series.id:
        raise HTTPException(status_code=404, detail="Series part not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(part, field, value)
    db.add(AuditLog(actor_id=user.id, action="series_part.updated", target_type="series_part", target_id=str(part.id)))
    db.commit()
    db.refresh(part)
    return part


@router.delete("/{series_id}/parts/{part_id}")
def delete_series_part(series_id: uuid.UUID, part_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    part = db.get(SeriesPart, part_id)
    if not part or part.series_id != series.id:
        raise HTTPException(status_code=404, detail="Series part not found")
    db.delete(part)
    series.total_parts = max(series.total_parts - 1, 0)
    db.add(AuditLog(actor_id=user.id, action="series_part.deleted", target_type="series_part", target_id=str(part.id)))
    db.commit()
    return {"status": "deleted", "part_id": part_id}


@router.post("/{series_id}/parts/reorder", response_model=list[schemas.SeriesPartResponse])
def reorder_series_parts(
    series_id: uuid.UUID,
    payload: schemas.SeriesPartReorderRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    series = _get_owned_series(db, series_id, user)
    parts = db.query(SeriesPart).filter(SeriesPart.series_id == series.id).all()
    by_id = {part.id: part for part in parts}
    if set(by_id) != set(payload.part_ids):
        raise HTTPException(status_code=400, detail="part_ids must include every part in the series")
    for index, part_id in enumerate(payload.part_ids, start=1):
        by_id[part_id].part_number = -index
    db.flush()
    for index, part_id in enumerate(payload.part_ids, start=1):
        by_id[part_id].part_number = index
    db.add(AuditLog(actor_id=user.id, action="series_part.reordered", target_type="content_series", target_id=str(series.id)))
    db.commit()
    return db.query(SeriesPart).filter(SeriesPart.series_id == series.id).order_by(SeriesPart.part_number.asc()).all()


@router.get("/{series_id}/context")
def get_series_context(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    contexts = (
        db.query(ContentContext)
        .filter(ContentContext.series_id == series.id, ContentContext.is_active == True)  # noqa: E712
        .order_by(ContentContext.version.desc())
        .all()
    )
    return {"series_id": series.id, "context_version": series.context_version, "contexts": contexts}


@router.post("/{series_id}/context/rebuild")
def rebuild_series_context(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    parts = db.query(SeriesPart).filter(SeriesPart.series_id == series.id).order_by(SeriesPart.part_number.asc()).all()
    for context in db.query(ContentContext).filter(ContentContext.series_id == series.id, ContentContext.is_active == True).all():  # noqa: E712
        context.is_active = False
    doc = {
        "series_id": str(series.id),
        "version": series.context_version + 1,
        "rebuilt_by": str(user.id),
        "rebuilt_at": datetime.utcnow().isoformat(),
        "continuity": {
            "series_title": series.title,
            "part_titles": [part.title for part in parts],
            "open_threads": [part.next_part_tease for part in parts if part.next_part_tease],
            "risk_notes": [note for part in parts for note in (part.risk_notes or [])],
        },
    }
    result = series_contexts().insert_one(doc)
    series.context_version += 1
    context = ContentContext(series_id=series.id, context_type="SERIES_CONTINUITY", version=series.context_version, mongo_document_id=str(result.inserted_id), is_active=True)
    db.add(context)
    db.add(AuditLog(actor_id=user.id, action="content_context.rebuilt", target_type="content_series", target_id=str(series.id)))
    db.commit()
    db.refresh(context)
    return {"series_id": series.id, "context_id": context.id, "context_version": series.context_version, "mongo_document_id": context.mongo_document_id}


@router.get("/{series_id}/consistency-check")
def consistency_check(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    parts = db.query(SeriesPart).filter(SeriesPart.series_id == series.id).order_by(SeriesPart.part_number.asc()).all()
    warnings = []
    expected_numbers = list(range(1, len(parts) + 1))
    actual_numbers = [part.part_number for part in parts]
    if actual_numbers != expected_numbers:
        warnings.append({"type": "PART_NUMBER_GAP", "severity": "HIGH", "message": "Part numbers must be continuous from 1."})
    if parts and parts[0].part_type != "OPENING":
        warnings.append({"type": "MISSING_OPENING", "severity": "MEDIUM", "message": "First part should be OPENING."})
    if parts and parts[-1].part_type != "ENDING":
        warnings.append({"type": "MISSING_ENDING", "severity": "MEDIUM", "message": "Last part should be ENDING."})
    for part in parts:
        if not part.main_beats:
            warnings.append({"type": "EMPTY_BEATS", "severity": "HIGH", "part_id": str(part.id), "message": "Part has no main beats."})
        if part.part_number > 1 and not part.previous_part_recap:
            warnings.append({"type": "MISSING_RECAP", "severity": "LOW", "part_id": str(part.id), "message": "Part has no previous recap."})
        if part.part_number < len(parts) and not part.next_part_tease:
            warnings.append({"type": "MISSING_TEASE", "severity": "LOW", "part_id": str(part.id), "message": "Part has no next tease."})
    return {"series_id": series.id, "passed": not warnings, "warning_count": len(warnings), "warnings": warnings}


def _get_owned_series(db: Session, series_id: uuid.UUID, user: User) -> ContentSeries:
    series = db.get(ContentSeries, series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Content series not found")
    profile = db.get(SocialProfile, series.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content series not found")
    return series
