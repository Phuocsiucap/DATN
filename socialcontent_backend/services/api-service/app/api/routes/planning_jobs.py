import asyncio
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import PlanningCandidate, PlanningJob, PromptRun, User
from common.db.session import SessionLocal, get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


def _orchestrator_url() -> str:
    return get_settings().planning_orchestrator_url.rstrip("/")


@router.post("", response_model=schemas.PlanningJobResponse)
def create_planning_job(payload: schemas.PlanningJobCreateRequest, user: User = Depends(get_current_user)):
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{_orchestrator_url()}/api/v1/planning-jobs",
                params={"user_id": str(user.id)},
                json=payload.model_dump(mode="json"),
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.json().get("detail", "Error from planning orchestrator"))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Planning Orchestrator unavailable: {exc}")


@router.get("", response_model=list[schemas.PlanningJobResponse])
def list_planning_jobs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(PlanningJob)
        .filter(PlanningJob.user_id == user.id)
        .order_by(PlanningJob.created_at.desc())
        .limit(100)
        .all()
    )


@router.get("/{job_id}", response_model=schemas.PlanningJobResponse)
def get_planning_job(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(PlanningJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Planning job not found")
    return job


@router.post("/{job_id}/cancel", response_model=schemas.PlanningJobResponse)
def cancel_planning_job(job_id: uuid.UUID, user: User = Depends(get_current_user)):
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{_orchestrator_url()}/api/v1/planning-jobs/{job_id}/cancel",
                params={"user_id": str(user.id)},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.json().get("detail", "Error from planning orchestrator"))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Planning Orchestrator unavailable: {exc}")


@router.post("/{job_id}/retry", response_model=schemas.PlanningJobResponse)
def retry_planning_job(job_id: uuid.UUID, user: User = Depends(get_current_user)):
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{_orchestrator_url()}/api/v1/planning-jobs/{job_id}/retry",
                params={"user_id": str(user.id)},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.json().get("detail", "Error from planning orchestrator"))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Planning Orchestrator unavailable: {exc}")


@router.get("/{job_id}/candidates", response_model=list[schemas.PlanningCandidateResponse])
def planning_job_candidates(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(PlanningJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Planning job not found")
    return (
        db.query(PlanningCandidate)
        .filter(PlanningCandidate.planning_job_id == job.id)
        .order_by(PlanningCandidate.rank_order.asc().nullslast(), PlanningCandidate.created_at.asc())
        .all()
    )


@router.patch("/{job_id}/candidates/{candidate_id}", response_model=schemas.PlanningCandidateResponse)
def update_planning_candidate(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    payload: schemas.PlanningCandidateUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = db.get(PlanningJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Planning job not found")
    candidate = db.get(PlanningCandidate, candidate_id)
    if not candidate or candidate.planning_job_id != job.id:
        raise HTTPException(status_code=404, detail="Planning candidate not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(candidate, field, value)
    db.commit()
    db.refresh(candidate)
    return candidate


@router.post("/{job_id}/candidates/reselect", response_model=list[schemas.PlanningCandidateResponse])
def reselect_planning_candidates(
    job_id: uuid.UUID,
    payload: schemas.PlanningCandidateReselectRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = db.get(PlanningJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Planning job not found")
    candidates = (
        db.query(PlanningCandidate)
        .filter(PlanningCandidate.planning_job_id == job.id)
        .order_by(PlanningCandidate.candidate_score.desc(), PlanningCandidate.created_at.asc())
        .all()
    )
    selected = []
    for candidate in candidates:
        passes_score = payload.min_score is None or float(candidate.candidate_score) >= payload.min_score
        candidate.eligible = passes_score and len(selected) < payload.candidate_limit
        if candidate.eligible:
            selected.append(candidate)
            candidate.rank_order = len(selected)
        else:
            candidate.rank_order = None
    db.commit()
    return (
        db.query(PlanningCandidate)
        .filter(PlanningCandidate.planning_job_id == job.id)
        .order_by(PlanningCandidate.rank_order.asc().nullslast(), PlanningCandidate.candidate_score.desc())
        .all()
    )


@router.get("/{job_id}/events")
async def planning_job_events(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(PlanningJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Planning job not found")

    async def stream():
        for _ in range(90):
            with SessionLocal() as session:
                current = session.get(PlanningJob, job_id)
                if not current:
                    break
                yield (
                    "event: progress\n"
                    f"data: {{\"job_id\":\"{current.id}\",\"status\":\"{current.status}\",\"stage\":\"{current.current_stage}\","
                    f"\"progress\":{float(current.progress_percent)},\"attempt_count\":{current.attempt_count}}}\n\n"
                )
                if current.status in {"SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"}:
                    break
            await asyncio.sleep(2)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.get("/{job_id}/logs")
def planning_job_logs(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(PlanningJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Planning job not found")
    return (
        db.query(PromptRun)
        .filter(PromptRun.planning_job_id == job.id)
        .order_by(PromptRun.created_at.asc())
        .limit(500)
        .all()
    )
