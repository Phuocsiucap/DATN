import uuid
from typing import Any
import html

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Literal

from app.api.deps import get_current_user
from common.db.models import ContentItem, ContentSeries, CrawlJob, MediaWorkflow, PlanningCandidate, PlanningRun, SocialProfile, User
from common.db.session import get_db
from app.schemas.planning_run_detail import PlanningCandidateDiagnosticsResponse, PlanningRunCompactResponse, PlanningRunDetailResponse
from app.services.planning_run_detail import as_dict, build_planning_run_detail, compact_planning_run_detail, stored_decision
from app.services.planning_candidate_review import owned_candidate, review_candidate
from common.db.media_workflows import _load_content_full_text
from common.planning.candidate_review import content_available_to_profile


router = APIRouter()
TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "CANCELLED", "WAITING_REVIEW"}


class CandidateReviewRequest(BaseModel):
    action: Literal["APPROVE", "REJECT", "RETRY"]
    reason: str = Field(default="", max_length=1000)


@router.post("/{run_id:uuid}/candidates/{candidate_id:uuid}/review")
def review_planning_candidate(run_id: uuid.UUID, candidate_id: uuid.UUID, payload: CandidateReviewRequest,
                             user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return review_candidate(db, user, run_id, candidate_id, payload.action, payload.reason)


@router.get("/{run_id:uuid}/candidates/{candidate_id:uuid}/source")
def get_candidate_source(run_id: uuid.UUID, candidate_id: uuid.UUID,
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run, candidate = owned_candidate(db, user, run_id, candidate_id)
    content = db.get(ContentItem, candidate.content_id) if candidate.content_id else None
    if not content_available_to_profile(content, run.user_id):
        raise HTTPException(404, "Nội dung nguồn không còn khả dụng cho profile này.")
    full_text = _load_content_full_text(content.mongo_normalized_id) or ""
    return {"id": str(content.id), "title": content.canonical_title, "summary": content.summary,
            "full_text": html.unescape(full_text), "source_url": content.canonical_url}


@router.get("")
def list_planning_runs(
    profile_id: uuid.UUID | None = None,
    run_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    filters = []
    if not user.is_system_admin:
        filters.append(PlanningRun.user_id == user.id)
    if profile_id:
        filters.append(PlanningRun.profile_id == profile_id)
    if run_status:
        filters.append(PlanningRun.status == run_status.strip().upper())

    total = db.query(PlanningRun.id).filter(*filters).count()
    rows = (
        db.query(
            PlanningRun.id,
            PlanningRun.profile_id,
            PlanningRun.workflow_id,
            PlanningRun.crawl_job_id,
            PlanningRun.planning_mode,
            PlanningRun.status,
            PlanningRun.output_jsonb,
            PlanningRun.reason_jsonb,
            PlanningRun.metadata_json,
            PlanningRun.started_at,
            PlanningRun.completed_at,
            PlanningRun.created_at,
            PlanningRun.updated_at,
            SocialProfile.profile_name,
            SocialProfile.username.label("profile_username"),
            SocialProfile.platform.label("profile_platform"),
            SocialProfile.avatar_url.label("profile_avatar_url"),
            MediaWorkflow.title.label("workflow_title"),
            CrawlJob.name.label("crawl_job_name"),
        )
        .join(SocialProfile, SocialProfile.id == PlanningRun.profile_id)
        .outerjoin(MediaWorkflow, MediaWorkflow.id == PlanningRun.workflow_id)
        .outerjoin(CrawlJob, CrawlJob.id == PlanningRun.crawl_job_id)
        .filter(*filters)
        .order_by(PlanningRun.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    counts = _candidate_counts(db, [row.id for row in rows])
    return {
        "items": [_serialize_run_summary(row, counts.get(row.id, {})) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def _owned_run(db: Session, run_id: uuid.UUID, user: User):
    run = db.get(PlanningRun, run_id)
    if not run or (not user.is_system_admin and run.user_id != user.id):
        raise HTTPException(status_code=404, detail="Planning run not found")
    return run


@router.get("/{run_id:uuid}", response_model=PlanningRunCompactResponse | PlanningRunDetailResponse, response_model_exclude_none=True)
def get_planning_run(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    view: Literal["compact", "diagnostic"] = "compact",
):
    run = _owned_run(db, run_id, user)
    profile = db.query(SocialProfile.id, SocialProfile.profile_name).filter(SocialProfile.id == run.profile_id).first()
    crawl_job = db.query(CrawlJob.id, CrawlJob.name).filter(CrawlJob.id == run.crawl_job_id).first() if run.crawl_job_id else None
    candidates = _candidate_rows(db, run)
    workflows = _workflow_rows(db, run, candidates)
    detail = build_planning_run_detail(run, profile, crawl_job, candidates, workflows)
    return detail if view == "diagnostic" else compact_planning_run_detail(detail)


@router.get("/{run_id:uuid}/candidates/{candidate_id:uuid}/diagnostics", response_model=PlanningCandidateDiagnosticsResponse)
def get_planning_candidate_diagnostics(
    run_id: uuid.UUID, candidate_id: uuid.UUID,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    run = _owned_run(db, run_id, user)
    candidates = _candidate_rows(db, run, candidate_id)
    if not candidates:
        raise HTTPException(status_code=404, detail="Planning candidate not found")
    workflows = _workflow_rows(db, run, candidates)
    detail = build_planning_run_detail(run, None, None, candidates, workflows)
    candidate = detail.candidates[0]
    return PlanningCandidateDiagnosticsResponse(
        run_id=str(run.id), candidate=candidate, topics=detail.topics,
        workflow=next((item for item in detail.workflows if item.id == candidate.workflow_id), None),
    )


def _candidate_rows(db: Session, run, candidate_id: uuid.UUID | None = None):
    filters = [PlanningCandidate.planning_run_id == run.id]
    if candidate_id:
        filters.append(PlanningCandidate.id == candidate_id)
    return (
        db.query(
            PlanningCandidate.id,
            PlanningCandidate.content_id,
            PlanningCandidate.workflow_id,
            PlanningCandidate.rank_order,
            PlanningCandidate.score,
            PlanningCandidate.selected,
            PlanningCandidate.eligible,
            PlanningCandidate.reason_jsonb,
            PlanningCandidate.metadata_json,
            ContentItem.canonical_title,
            ContentItem.summary,
        )
        .outerjoin(ContentItem, ContentItem.id == PlanningCandidate.content_id)
        .filter(*filters)
        .order_by(PlanningCandidate.rank_order.asc().nullslast(), PlanningCandidate.created_at.asc())
        .all()
    )


def _workflow_rows(db: Session, run, candidates):
    output = as_dict(run.output_jsonb)
    workflow_ids = {
        str(value)
        for value in (output.get("workflows_created") or [])
        if value
    }
    if run.workflow_id:
        workflow_ids.add(str(run.workflow_id))
    workflow_ids.update(str(row.workflow_id) for row in candidates if row.workflow_id)
    for row in candidates:
        decision_workflow_id = stored_decision(row, output).get("workflow_id")
        if decision_workflow_id:
            workflow_ids.add(str(decision_workflow_id))
    ids = [parsed for value in workflow_ids if (parsed := _uuid_or_none(value))]
    # One batched lookup, scoped to this run's owner/profile. Never load drafts,
    # artifacts or credentials just to render planning detail.
    workflows = (
        db.query(
            MediaWorkflow.id, MediaWorkflow.title, MediaWorkflow.primary_content_id,
            MediaWorkflow.status, MediaWorkflow.current_stage, MediaWorkflow.updated_at,
            MediaWorkflow.series_id, MediaWorkflow.metadata_json,
            ContentSeries.title.label("series_title"),
        )
        .outerjoin(ContentSeries, ContentSeries.id == MediaWorkflow.series_id)
        .filter(
            MediaWorkflow.id.in_(ids),
            MediaWorkflow.user_id == run.user_id,
            MediaWorkflow.profile_id == run.profile_id,
        )
        .order_by(MediaWorkflow.created_at, MediaWorkflow.id)
        .all()
    ) if ids else []
    return workflows


def _candidate_counts(db: Session, run_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    if not run_ids:
        return {}
    rows = (
        db.query(
            PlanningCandidate.planning_run_id,
            func.count(PlanningCandidate.id).label("candidate_count"),
            func.count(PlanningCandidate.id).filter(PlanningCandidate.selected.is_(True)).label("selected_count"),
            func.count(PlanningCandidate.id).filter(PlanningCandidate.eligible.is_(True)).label("eligible_count"),
        )
        .filter(PlanningCandidate.planning_run_id.in_(run_ids))
        .group_by(PlanningCandidate.planning_run_id)
        .all()
    )
    return {
        row.planning_run_id: {
            "candidate_count": int(row.candidate_count or 0),
            "selected_count": int(row.selected_count or 0),
            "eligible_count": int(row.eligible_count or 0),
        }
        for row in rows
    }


def _serialize_run_summary(row, counts: dict) -> dict:
    terminal = row.status in TERMINAL_STATUSES
    metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
    output = row.output_jsonb if isinstance(row.output_jsonb, dict) else {}
    reason = row.reason_jsonb if isinstance(row.reason_jsonb, dict) else {}
    return {
        "id": str(row.id),
        "profile_id": str(row.profile_id),
        "profile_name": row.profile_name,
        "profile_username": row.profile_username,
        "profile_platform": row.profile_platform,
        "profile_avatar_url": row.profile_avatar_url,
        "workflow_id": str(row.workflow_id) if row.workflow_id else None,
        "workflow_title": row.workflow_title,
        "crawl_job_id": str(row.crawl_job_id) if row.crawl_job_id else None,
        "crawl_job_name": row.crawl_job_name,
        "planning_mode": row.planning_mode,
        "status": row.status,
        "current_stage": "COMPLETED" if terminal else "SELECTING_CANDIDATES",
        "progress_percent": 100.0 if terminal else 5.0,
        "candidate_count": counts.get("candidate_count", 0),
        "selected_count": counts.get("selected_count", 0),
        "eligible_count": counts.get("eligible_count", 0),
        "selected_content_id": output.get("selected_content_id"),
        "selection_reasons": reason.get("selection_reasons") or [],
        "trigger": metadata.get("trigger") or reason.get("trigger"),
        "error_message": metadata.get("error_message"),
        "started_at": row.started_at,
        "completed_at": row.completed_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _uuid_or_none(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None
