import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import PlanningCandidate, PlanningJob, User
from common.db.session import get_db
from app.schemas import planning as schemas
from app.services.planning import PlanningService

router = APIRouter()


@router.post("", response_model=schemas.PlanningJobResponse)
def create_planning_job(payload: schemas.PlanningJobCreateRequest, user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return PlanningService().create_job(db, payload, user)


@router.get("", response_model=list[schemas.PlanningJobResponse])
def list_planning_jobs(user_id: uuid.UUID, db: Session = Depends(get_db)):
    return (
        db.query(PlanningJob)
        .filter(PlanningJob.user_id == user_id)
        .order_by(PlanningJob.created_at.desc())
        .limit(100)
        .all()
    )


@router.get("/{job_id}", response_model=schemas.PlanningJobResponse)
def get_planning_job(job_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    job = db.get(PlanningJob, job_id)
    if not job or job.user_id != user_id:
        raise HTTPException(status_code=404, detail="Planning job not found")
    return job


@router.post("/{job_id}/cancel", response_model=schemas.PlanningJobResponse)
def cancel_planning_job(job_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    job = db.get(PlanningJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Planning job not found")
    return PlanningService().cancel_job(db, job, user)


@router.post("/{job_id}/retry", response_model=schemas.PlanningJobResponse)
def retry_planning_job(job_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    job = db.get(PlanningJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Planning job not found")
    return PlanningService().retry_job(db, job, user)
