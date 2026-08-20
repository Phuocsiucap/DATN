import asyncio
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import ContentProject, ProjectRun, User
from common.db.session import SessionLocal, get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


def _orchestrator_url() -> str:
    return get_settings().planning_orchestrator_url.rstrip("/")


@router.post("", response_model=schemas.ProjectRunResponse)
def create_project_run(payload: schemas.ProjectRunCreateRequest, user: User = Depends(get_current_user)):
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{_orchestrator_url()}/api/v1/project-runs",
                params={"user_id": str(user.id)},
                json=payload.model_dump(mode="json"),
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.json().get("detail", "Error from planning orchestrator"))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Planning Orchestrator unavailable: {exc}")


@router.get("", response_model=list[schemas.ProjectRunResponse])
def list_project_runs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    runs_query = db.query(ProjectRun).join(ContentProject, ContentProject.id == ProjectRun.project_id).filter(ProjectRun.run_type == "PLANNING")
    if not user.is_system_admin:
        runs_query = runs_query.filter(ContentProject.user_id == user.id)
    runs = runs_query.order_by(ProjectRun.created_at.desc()).limit(100).all()
    return [_serialize_project_run(run) for run in runs]


@router.get("/{run_id}", response_model=schemas.ProjectRunResponse)
def get_project_run(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_project_run(db, run_id, user)
    if run:
        return _serialize_project_run(run)
    raise HTTPException(status_code=404, detail="Planning run not found")


@router.post("/{run_id}/cancel", response_model=schemas.ProjectRunResponse)
def cancel_project_run(run_id: uuid.UUID, user: User = Depends(get_current_user)):
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{_orchestrator_url()}/api/v1/project-runs/{run_id}/cancel",
                params={"user_id": str(user.id)},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.json().get("detail", "Error from planning orchestrator"))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Planning Orchestrator unavailable: {exc}")


@router.post("/{run_id}/retry", response_model=schemas.ProjectRunResponse)
def retry_project_run(run_id: uuid.UUID, user: User = Depends(get_current_user)):
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{_orchestrator_url()}/api/v1/project-runs/{run_id}/retry",
                params={"user_id": str(user.id)},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.json().get("detail", "Error from planning orchestrator"))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Planning Orchestrator unavailable: {exc}")


@router.get("/{run_id}/candidates", response_model=list[schemas.ProjectCandidateResponse])
def project_run_candidates(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_project_run(db, run_id, user)
    if run:
        return [_serialize_project_candidate(run_id, candidate) for candidate in run.project.candidates]
    raise HTTPException(status_code=404, detail="Planning run not found")


@router.patch("/{run_id}/candidates/{candidate_id}", response_model=schemas.ProjectCandidateResponse)
def update_project_candidate(
    run_id: uuid.UUID,
    candidate_id: uuid.UUID,
    payload: schemas.ProjectCandidateUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=410, detail="Legacy project candidate mutation was removed. Update project_candidates instead.")


@router.post("/{run_id}/candidates/reselect", response_model=list[schemas.ProjectCandidateResponse])
def reselect_project_candidates(
    run_id: uuid.UUID,
    payload: schemas.ProjectCandidateReselectRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=410, detail="Legacy project candidate reselection was removed. Update project_candidates instead.")


@router.get("/{run_id}/events")
async def project_run_events(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_project_run(db, run_id, user)
    if run:
        async def project_stream():
            for _ in range(90):
                with SessionLocal() as session:
                    current = session.get(ProjectRun, run_id)
                    if not current:
                        break
                    yield (
                        "event: progress\n"
                        f"data: {{\"run_id\":\"{current.id}\",\"status\":\"{current.status}\",\"stage\":\"{current.current_stage}\","
                        f"\"progress\":{float(current.progress_percent or 0)},\"attempt_count\":{current.attempt_count}}}\n\n"
                    )
                    if current.status in {"SUCCEEDED", "WAITING_REVIEW", "FAILED", "CANCELLED"}:
                        break
                await asyncio.sleep(2)

        return StreamingResponse(project_stream(), media_type="text/event-stream")
    raise HTTPException(status_code=404, detail="Planning run not found")


@router.get("/{run_id}/logs")
def project_run_logs(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_project_run(db, run_id, user)
    if run:
        return [_serialize_project_run_log(run)]
    raise HTTPException(status_code=404, detail="Planning run not found")


def _get_owned_project_run(db: Session, run_id: uuid.UUID, user: User) -> ProjectRun | None:
    run = db.get(ProjectRun, run_id)
    if not run or run.run_type != "PLANNING":
        return None
    if not user.is_system_admin and run.project.user_id != user.id:
        raise HTTPException(status_code=404, detail="Project run not found")
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
        "current_stage": run.current_stage or project.current_stage or "",
        "progress_percent": float(run.progress_percent or 0),
        "target_duration_seconds": metadata.get("target_duration_seconds"),
        "preferred_part_count": metadata.get("preferred_part_count"),
        "language": metadata.get("language") or "vi",
        "instructions": metadata.get("instructions"),
        "attempt_count": run.attempt_count,
        "error_code": run.error_code,
        "error_message": run.error_message,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }


def _serialize_project_candidate(job_id: uuid.UUID, candidate) -> dict:
    metadata = candidate.metadata_json if isinstance(candidate.metadata_json, dict) else {}
    return {
        "id": candidate.id,
        "project_run_id": job_id,
        "content_id": candidate.content_id,
        "story_id": candidate.story_id,
        "episode_id": candidate.episode_id,
        "candidate_score": float(candidate.score or 0),
        "eligible": bool(candidate.eligible),
        "rank_order": candidate.rank_order,
        "score_breakdown": metadata.get("score_breakdown") or {},
        "selection_reasons": metadata.get("selection_reasons") or [],
        "rejection_reasons": metadata.get("rejection_reasons") or [],
        "content_title": candidate.content_title,
        "content_url": candidate.content_url,
        "created_at": candidate.created_at,
    }


def _serialize_project_run_log(run: ProjectRun) -> dict:
    return {
        "id": run.id,
        "project_run_id": run.id,
        "step_name": run.current_stage or "PROJECT_RUN",
        "model_provider": None,
        "model_name": None,
        "prompt_version": "project-run",
        "input_tokens": None,
        "output_tokens": None,
        "latency_ms": None,
        "status": run.status,
        "error_message": run.error_message,
        "created_at": run.created_at,
    }
