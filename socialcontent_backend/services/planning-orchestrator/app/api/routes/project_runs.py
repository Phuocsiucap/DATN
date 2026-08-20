import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import ContentProject, ProjectRun, User
from common.db.session import get_db
from app.schemas import planning as schemas
from app.services.planning import PlanningService

router = APIRouter()


@router.post("", response_model=schemas.ProjectRunResponse)
def create_project_run(payload: schemas.ProjectRunCreateRequest, user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize_project_run(PlanningService().create_job(db, payload, user))


@router.get("", response_model=list[schemas.ProjectRunResponse])
def list_project_runs(user_id: uuid.UUID, db: Session = Depends(get_db)):
    return [
        _serialize_project_run(run)
        for run in (
            db.query(ProjectRun)
            .join(ContentProject, ContentProject.id == ProjectRun.project_id)
            .filter(ProjectRun.run_type == "PLANNING", ContentProject.user_id == user_id)
            .order_by(ProjectRun.created_at.desc())
            .limit(100)
            .all()
        )
    ]


@router.get("/{run_id}", response_model=schemas.ProjectRunResponse)
def get_project_run(run_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    return _serialize_project_run(_get_owned_project_run(db, run_id, user_id))


@router.post("/{run_id}/cancel", response_model=schemas.ProjectRunResponse)
def cancel_project_run(run_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    run = _get_owned_project_run(db, run_id, user.id)
    return _serialize_project_run(PlanningService().cancel_job(db, run, user))


@router.post("/{run_id}/retry", response_model=schemas.ProjectRunResponse)
def retry_project_run(run_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    run = _get_owned_project_run(db, run_id, user.id)
    return _serialize_project_run(PlanningService().retry_job(db, run, user))


def _get_owned_project_run(db: Session, run_id: uuid.UUID, user_id: uuid.UUID) -> ProjectRun:
    run = db.get(ProjectRun, run_id)
    if not run or run.run_type != "PLANNING" or not run.project or run.project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Planning run not found")
    return run


def _serialize_project_run(run: ProjectRun) -> dict:
    metadata = run.metadata_json if isinstance(run.metadata_json, dict) else {}
    project = run.project
    return {
        "id": run.id,
        "user_id": project.user_id,
        "profile_id": project.profile_id,
        "project_id": project.id,
        "planning_mode": metadata.get("planning_mode") or project.planning_mode or "SERIES",
        "status": run.status,
        "current_stage": run.current_stage or "",
        "progress_percent": float(run.progress_percent or 0),
        "target_duration_seconds": metadata.get("target_duration_seconds"),
        "preferred_part_count": metadata.get("preferred_part_count"),
        "language": metadata.get("language") or "vi",
        "instructions": metadata.get("instructions"),
        "attempt_count": int(metadata.get("attempt_count") or 1),
        "error_code": metadata.get("error_code"),
        "error_message": run.error_message,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }
