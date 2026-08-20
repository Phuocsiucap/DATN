import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import AuditLog, ProjectPart, ProjectSeries, SocialProfile, User
from common.db.mongo import series_contexts
from common.db.session import get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


@router.get("", response_model=list[schemas.ProjectSeriesResponse])
def list_project_series(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(ProjectSeries)
        .filter(ProjectSeries.user_id == user.id)
        .order_by(ProjectSeries.updated_at.desc())
        .limit(100)
        .all()
    )
    return [_serialize_series(row) for row in rows]


@router.get("/{series_id}", response_model=schemas.ProjectSeriesResponse)
def get_project_series(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _serialize_series(_get_owned_series(db, series_id, user))


@router.patch("/{series_id}", response_model=schemas.ProjectSeriesResponse)
def update_project_series(series_id: uuid.UUID, payload: schemas.ProjectSeriesUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "context_version":
            continue
        setattr(series, field, value)
    db.add(AuditLog(actor_id=user.id, action="project_series.updated", target_type="project_series", target_id=str(series.id)))
    db.commit()
    db.refresh(series)
    return _serialize_series(series)


@router.post("/{series_id}/regenerate", response_model=schemas.ProjectRunResponse)
def regenerate_project_series(series_id: uuid.UUID, payload: schemas.ProjectSeriesRegenerateRequest | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_series(db, series_id, user)
    raise HTTPException(status_code=410, detail="Series regeneration must create a new project_run from project_sources.")


@router.get("/{series_id}/parts", response_model=list[schemas.ProjectPartResponse])
def list_project_parts(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    parts = db.query(ProjectPart).filter(ProjectPart.series_id == series.id).order_by(ProjectPart.part_number.asc()).all()
    return [_serialize_part(part) for part in parts]


@router.post("/{series_id}/parts", response_model=schemas.ProjectPartResponse)
def create_project_part(series_id: uuid.UUID, payload: schemas.ProjectPartCreateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    project = series.projects[0] if series.projects else None
    if not project:
        raise HTTPException(status_code=400, detail="Project series has no owning content project")
    next_number = payload.part_number
    if next_number is None:
        max_part = db.query(ProjectPart).filter(ProjectPart.series_id == series.id).order_by(ProjectPart.part_number.desc()).first()
        next_number = (max_part.part_number if max_part else 0) + 1
    data = payload.model_dump(exclude={"part_number"})
    target_duration_seconds = data.get("target_duration_seconds")
    part = ProjectPart(
        project_id=project.id,
        series_id=series.id,
        part_number=next_number,
        title=data.pop("title"),
        target_duration_seconds=target_duration_seconds,
        status=data.pop("status", "DRAFT") or "DRAFT",
        payload=data,
    )
    series.total_parts = max(series.total_parts or 0, next_number)
    db.add(part)
    db.add(AuditLog(actor_id=user.id, action="project_part.created", target_type="project_series", target_id=str(series.id)))
    db.commit()
    db.refresh(part)
    return _serialize_part(part)


@router.patch("/{series_id}/parts/{part_id}", response_model=schemas.ProjectPartResponse)
def update_project_part(series_id: uuid.UUID, part_id: uuid.UUID, payload: schemas.ProjectPartUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    part = db.get(ProjectPart, part_id)
    if not part or part.series_id != series.id:
        raise HTTPException(status_code=404, detail="Series part not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "title":
            part.title = value
        elif field == "status":
            part.status = value
        elif field == "part_number":
            part.part_number = value
        elif field == "target_duration_seconds":
            part.target_duration_seconds = value
            part.payload = {**(part.payload or {}), field: value}
        else:
            part.payload = {**(part.payload or {}), field: value}
    db.add(AuditLog(actor_id=user.id, action="project_part.updated", target_type="project_part", target_id=str(part.id)))
    db.commit()
    db.refresh(part)
    return _serialize_part(part)


@router.delete("/{series_id}/parts/{part_id}")
def delete_project_part(series_id: uuid.UUID, part_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    part = db.get(ProjectPart, part_id)
    if not part or part.series_id != series.id:
        raise HTTPException(status_code=404, detail="Series part not found")
    db.delete(part)
    series.total_parts = max((series.total_parts or 1) - 1, 0)
    db.add(AuditLog(actor_id=user.id, action="project_part.deleted", target_type="project_part", target_id=str(part.id)))
    db.commit()
    return {"status": "deleted", "part_id": part_id}


@router.post("/{series_id}/parts/reorder", response_model=list[schemas.ProjectPartResponse])
def reorder_project_parts(series_id: uuid.UUID, payload: schemas.ProjectPartReorderRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    parts = db.query(ProjectPart).filter(ProjectPart.series_id == series.id).all()
    by_id = {part.id: part for part in parts}
    if set(by_id) != set(payload.part_ids):
        raise HTTPException(status_code=400, detail="part_ids must include every part in the series")
    for index, part_id in enumerate(payload.part_ids, start=1):
        by_id[part_id].part_number = index
    db.add(AuditLog(actor_id=user.id, action="project_part.reordered", target_type="project_series", target_id=str(series.id)))
    db.commit()
    return [_serialize_part(part) for part in db.query(ProjectPart).filter(ProjectPart.series_id == series.id).order_by(ProjectPart.part_number.asc()).all()]


@router.get("/{series_id}/context")
def get_series_context(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    contexts = []
    doc_id = (series.context_json or {}).get("mongo_document_id")
    if doc_id:
        doc = series_contexts().find_one({"series_id": str(series.id)}, sort=[("version", -1)])
        if doc:
            doc["_id"] = str(doc["_id"])
            contexts.append(doc)
    return {"series_id": series.id, "context_version": (series.context_json or {}).get("version", 1), "contexts": contexts}


@router.post("/{series_id}/context/rebuild")
def rebuild_series_context(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    parts = db.query(ProjectPart).filter(ProjectPart.series_id == series.id).order_by(ProjectPart.part_number.asc()).all()
    next_version = int((series.context_json or {}).get("version") or 0) + 1
    doc = {
        "series_id": str(series.id),
        "version": next_version,
        "rebuilt_by": str(user.id),
        "rebuilt_at": datetime.utcnow().isoformat(),
        "continuity": {
            "series_title": series.title,
            "part_titles": [part.title for part in parts],
            "open_threads": [(part.payload or {}).get("next_part_tease") for part in parts if (part.payload or {}).get("next_part_tease")],
            "risk_notes": [note for part in parts for note in ((part.payload or {}).get("risk_notes") or [])],
        },
    }
    result = series_contexts().insert_one(doc)
    series.context_json = {"mongo_document_id": str(result.inserted_id), "version": next_version}
    db.add(AuditLog(actor_id=user.id, action="project_series.context_rebuilt", target_type="project_series", target_id=str(series.id)))
    db.commit()
    return {"series_id": series.id, "context_version": next_version, "mongo_document_id": str(result.inserted_id)}


@router.get("/{series_id}/consistency-check")
def consistency_check(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    parts = db.query(ProjectPart).filter(ProjectPart.series_id == series.id).order_by(ProjectPart.part_number.asc()).all()
    warnings = []
    expected_numbers = list(range(1, len(parts) + 1))
    actual_numbers = [part.part_number for part in parts]
    if actual_numbers != expected_numbers:
        warnings.append({"type": "PART_NUMBER_GAP", "severity": "HIGH", "message": "Part numbers must be continuous from 1."})
    for part in parts:
        payload = part.payload or {}
        if not payload.get("main_beats"):
            warnings.append({"type": "EMPTY_BEATS", "severity": "HIGH", "part_id": str(part.id), "message": "Part has no main beats."})
    return {"series_id": series.id, "passed": not warnings, "warning_count": len(warnings), "warnings": warnings}


def _get_owned_series(db: Session, series_id: uuid.UUID, user: User) -> ProjectSeries:
    series = db.get(ProjectSeries, series_id)
    if not series or series.user_id != user.id:
        raise HTTPException(status_code=404, detail="Project series not found")
    return series


def _serialize_series(series: ProjectSeries) -> dict:
    metadata = series.metadata_json or {}
    return {
        "id": series.id,
        "content_plan_id": uuid.UUID(str(metadata["content_plan_id"])) if metadata.get("content_plan_id") else series.id,
        "profile_id": series.profile_id,
        "title": series.title,
        "description": series.description,
        "series_type": series.series_type,
        "total_parts": series.total_parts,
        "current_part": series.current_part,
        "status": series.status,
        "context_version": int((series.context_json or {}).get("version") or 1),
        "created_at": series.created_at,
        "updated_at": series.updated_at,
    }


def _serialize_part(part: ProjectPart) -> dict:
    payload = part.payload or {}
    return {
        "id": part.id,
        "series_id": part.series_id,
        "part_number": part.part_number,
        "part_type": payload.get("part_type") or "MIDDLE",
        "title": part.title,
        "goal": payload.get("goal"),
        "hook_direction": payload.get("hook_direction"),
        "ending_direction": payload.get("ending_direction"),
        "previous_part_recap": payload.get("previous_part_recap"),
        "next_part_tease": payload.get("next_part_tease"),
        "target_duration_seconds": part.target_duration_seconds if part.target_duration_seconds is not None else payload.get("target_duration_seconds"),
        "status": part.status,
        "source_refs": payload.get("source_refs") or [],
        "main_beats": payload.get("main_beats") or [],
        "production_notes": payload.get("production_notes") or {},
        "risk_notes": payload.get("risk_notes") or [],
        "created_at": part.created_at,
        "updated_at": part.updated_at,
    }
