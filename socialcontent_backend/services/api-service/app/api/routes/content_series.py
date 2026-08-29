import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.schemas import api as schemas
from common.db.models import AuditLog, ContentSeries, MediaWorkflow, SocialProfile, User
from common.db.mongo import series_contexts
from common.db.session import get_db

router = APIRouter()


@router.get("", response_model=list[schemas.ContentSeriesResponse])
def list_content_series(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(ContentSeries)
        .filter(ContentSeries.user_id == user.id)
        .order_by(ContentSeries.updated_at.desc())
        .limit(100)
        .all()
    )
    return [_serialize_series(row) for row in rows]


@router.post("", response_model=schemas.ContentSeriesResponse)
def create_content_series(
    payload: schemas.ContentSeriesCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile_id = payload.profile_id
    if not profile_id:
        first_profile = (
            db.query(SocialProfile)
            .filter(SocialProfile.user_id == user.id)
            .first()
        )
        if not first_profile:
            raise HTTPException(status_code=400, detail="Cần ít nhất một Social Profile để tạo Series")
        profile_id = first_profile.id
    else:
        profile = db.get(SocialProfile, profile_id)
        if not profile or profile.user_id != user.id:
            raise HTTPException(status_code=404, detail="Social Profile không tồn tại hoặc không thuộc về người dùng")

    series = ContentSeries(
        user_id=user.id,
        profile_id=profile_id,
        title=payload.title,
        description=payload.description,
        series_type=payload.series_type or "NARRATIVE",
        status=payload.status or "ACTIVE",
        current_part=0,
        total_parts=payload.total_parts or 0,
        context_json={"version": 1},
        metadata_json={},
    )
    db.add(series)
    db.commit()
    db.refresh(series)

    db.add(AuditLog(actor_id=user.id, action="content_series.created", target_type="content_series", target_id=str(series.id)))
    db.commit()
    return _serialize_series(series)


@router.get("/{series_id}", response_model=schemas.ContentSeriesResponse)
def get_content_series(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _serialize_series(_get_owned_series(db, series_id, user))


@router.patch("/{series_id}", response_model=schemas.ContentSeriesResponse)
def update_content_series(series_id: uuid.UUID, payload: schemas.ContentSeriesUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "context_version":
            continue
        setattr(series, field, value)
    db.add(AuditLog(actor_id=user.id, action="content_series.updated", target_type="content_series", target_id=str(series.id)))
    db.commit()
    db.refresh(series)
    return _serialize_series(series)


@router.delete("/{series_id}")
def delete_content_series(
    series_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    series = _get_owned_series(db, series_id, user)
    workflows = db.query(MediaWorkflow).filter(MediaWorkflow.series_id == series.id).all()
    for wf in workflows:
        wf.series_id = None
    db.delete(series)
    db.add(AuditLog(actor_id=user.id, action="content_series.deleted", target_type="content_series", target_id=str(series_id)))
    db.commit()
    return {"message": "Xóa series thành công", "id": series_id}


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
    scenes = _series_story_data(db, series)
    next_version = int((series.context_json or {}).get("version") or 0) + 1
    doc = {
        "series_id": str(series.id),
        "version": next_version,
        "rebuilt_by": str(user.id),
        "rebuilt_at": datetime.utcnow().isoformat(),
        "continuity": {
            "series_title": series.title,
            "scene_count": len(scenes),
            "recent_voiceover": [scene.get("voice_text") or scene.get("subtitle") for scene in scenes[-8:]],
            "visual_directions": [scene.get("visual_direction") for scene in scenes[-8:] if scene.get("visual_direction")],
        },
    }
    result = series_contexts().insert_one(doc)
    series.context_json = {"mongo_document_id": str(result.inserted_id), "version": next_version}
    db.add(AuditLog(actor_id=user.id, action="content_series.context_rebuilt", target_type="content_series", target_id=str(series.id)))
    db.commit()
    return {"series_id": series.id, "context_version": next_version, "mongo_document_id": str(result.inserted_id)}


@router.get("/{series_id}/consistency-check")
def consistency_check(series_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = _get_owned_series(db, series_id, user)
    scenes = _series_story_data(db, series)
    warnings = []
    expected_numbers = list(range(1, len(scenes) + 1))
    actual_numbers = [int(scene.get("scene_number") or 0) for scene in scenes]
    if actual_numbers != expected_numbers:
        warnings.append({"type": "SCENE_NUMBER_GAP", "severity": "HIGH", "message": "Scene numbers must be continuous from 1."})
    for scene in scenes:
        if not scene.get("voice_text") and not scene.get("subtitle"):
            warnings.append({"type": "EMPTY_SCENE", "severity": "HIGH", "scene_number": scene.get("scene_number"), "message": "Scene has no voice_text or subtitle."})
    return {"series_id": series.id, "passed": not warnings, "warning_count": len(warnings), "warnings": warnings}


def _get_owned_series(db: Session, series_id: uuid.UUID, user: User) -> ContentSeries:
    series = db.get(ContentSeries, series_id)
    if not series or series.user_id != user.id:
        raise HTTPException(status_code=404, detail="Project series not found")
    return series


def _serialize_series(series: ContentSeries) -> dict:
    metadata = series.metadata_json if isinstance(series.metadata_json, dict) else {}
    category_id = metadata.get("category_id") or metadata.get("categoryId")
    return {
        "id": series.id,
        "profile_id": series.profile_id,
        "profileId": series.profile_id,
        "title": series.title,
        "description": series.description,
        "series_type": series.series_type,
        "total_parts": series.total_parts,
        "current_part": series.current_part,
        "status": series.status,
        "context_version": int((series.context_json or {}).get("version") or 1),
        "category_id": category_id,
        "categoryId": category_id,
        "category": metadata.get("category"),
        "metadata": metadata,
        "created_at": series.created_at,
        "updated_at": series.updated_at,
    }


def _series_story_data(db: Session, series: ContentSeries) -> list[dict]:
    workflows = (
        db.query(MediaWorkflow)
        .filter(MediaWorkflow.series_id == series.id)
        .order_by(MediaWorkflow.updated_at.asc())
        .all()
    )
    result: list[dict] = []
    for workflow in workflows:
        draft = workflow.draft_json if isinstance(workflow.draft_json, dict) else {}
        for raw in draft.get("story_data") or []:
            if isinstance(raw, dict):
                result.append(raw)
    return result
