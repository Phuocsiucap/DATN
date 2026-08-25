import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from common.db.models import ContentItem, MediaWorkflow, PlanningCandidate, PlanningRun, SocialProfile, User
from common.db.session import get_db


router = APIRouter()
TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "CANCELLED", "WAITING_REVIEW"}


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
            MediaWorkflow.title.label("workflow_title"),
        )
        .join(SocialProfile, SocialProfile.id == PlanningRun.profile_id)
        .join(MediaWorkflow, MediaWorkflow.id == PlanningRun.workflow_id)
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


@router.get("/{run_id:uuid}")
def get_planning_run(
    run_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = db.get(PlanningRun, run_id)
    if not run or (not user.is_system_admin and run.user_id != user.id):
        raise HTTPException(status_code=404, detail="Planning run not found")

    profile = db.query(SocialProfile.id, SocialProfile.profile_name).filter(SocialProfile.id == run.profile_id).first()
    workflow = db.query(MediaWorkflow.id, MediaWorkflow.title).filter(MediaWorkflow.id == run.workflow_id).first()
    candidates = (
        db.query(
            PlanningCandidate.id,
            PlanningCandidate.content_id,
            PlanningCandidate.rank_order,
            PlanningCandidate.score,
            PlanningCandidate.selected,
            PlanningCandidate.eligible,
            PlanningCandidate.reason_jsonb,
            PlanningCandidate.metadata_json,
            PlanningCandidate.created_at,
            ContentItem.canonical_title,
            ContentItem.summary,
        )
        .outerjoin(ContentItem, ContentItem.id == PlanningCandidate.content_id)
        .filter(PlanningCandidate.planning_run_id == run.id)
        .order_by(PlanningCandidate.rank_order.asc().nullslast(), PlanningCandidate.created_at.asc())
        .all()
    )
    return {
        "id": str(run.id),
        "profile": {"id": str(profile.id), "name": profile.profile_name} if profile else None,
        "workflow": {"id": str(workflow.id), "title": workflow.title} if workflow else None,
        "crawl_job_id": str(run.crawl_job_id) if run.crawl_job_id else None,
        "planning_mode": run.planning_mode,
        "status": run.status,
        "input": run.input_jsonb or {},
        "output": run.output_jsonb or {},
        "reason": run.reason_jsonb or {},
        "metadata": run.metadata_json or {},
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "candidates": [
            {
                "id": str(row.id),
                "content_id": str(row.content_id) if row.content_id else None,
                "title": row.canonical_title,
                "summary": row.summary,
                "rank_order": row.rank_order,
                "score": float(row.score or 0),
                "selected": row.selected,
                "eligible": row.eligible,
                "reason": row.reason_jsonb or {},
                "metadata": row.metadata_json or {},
                "created_at": row.created_at,
            }
            for row in candidates
        ],
    }


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
        "workflow_id": str(row.workflow_id),
        "workflow_title": row.workflow_title,
        "crawl_job_id": str(row.crawl_job_id) if row.crawl_job_id else None,
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
