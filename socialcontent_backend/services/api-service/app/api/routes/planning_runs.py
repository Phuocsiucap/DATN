import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.schemas.planning_run_detail import (
    PlanningCandidateDiagnosticsResponse,
    PlanningRunCompactResponse,
    PlanningRunDetailResponse,
)
from app.services.planning_candidate_review import review_candidate
from app.services.planning_run_detail import (
    get_planning_candidate_diagnostics as get_planning_candidate_diagnostics_service,
    get_planning_candidate_source,
    get_planning_run_detail,
    list_planning_runs as list_planning_runs_service,
)
from common.db.models import User
from common.db.session import get_db


router = APIRouter()


class CandidateReviewRequest(BaseModel):
    action: Literal["APPROVE", "REJECT", "RETRY"]
    reason: str = Field(default="", max_length=1000)


@router.post("/{run_id:uuid}/candidates/{candidate_id:uuid}/review")
def review_planning_candidate(
    run_id: uuid.UUID,
    candidate_id: uuid.UUID,
    payload: CandidateReviewRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return review_candidate(db, user, run_id, candidate_id, payload.action, payload.reason)


@router.get("/{run_id:uuid}/candidates/{candidate_id:uuid}/source")
def get_candidate_source(
    run_id: uuid.UUID,
    candidate_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_planning_candidate_source(db, run_id, candidate_id, user)


@router.get("")
def list_planning_runs(
    profile_id: uuid.UUID | None = None,
    run_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_planning_runs_service(
        db,
        user,
        profile_id=profile_id,
        run_status=run_status,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{run_id:uuid}",
    response_model=PlanningRunCompactResponse | PlanningRunDetailResponse,
    response_model_exclude_none=True,
)
def get_planning_run(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    view: Literal["compact", "diagnostic"] = "compact",
):
    return get_planning_run_detail(db, run_id, user, diagnostic=view == "diagnostic")


@router.get(
    "/{run_id:uuid}/candidates/{candidate_id:uuid}/diagnostics",
    response_model=PlanningCandidateDiagnosticsResponse,
)
def get_planning_candidate_diagnostics(
    run_id: uuid.UUID,
    candidate_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_planning_candidate_diagnostics_service(db, run_id, candidate_id, user)
