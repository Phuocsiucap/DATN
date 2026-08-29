import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from common.db.models import ContentItem, CrawlJob, MediaWorkflow, PlanningCandidate, PlanningRun, SocialProfile, User
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
    crawl_job = db.query(CrawlJob.id, CrawlJob.name).filter(CrawlJob.id == run.crawl_job_id).first() if run.crawl_job_id else None
    candidates = (
        db.query(
            PlanningCandidate.id,
            PlanningCandidate.planning_run_id,
            PlanningCandidate.content_id,
            PlanningCandidate.workflow_id,
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
    output = dict(run.output_jsonb or {})
    workflow_ids = {
        str(value)
        for value in (output.get("workflows_created") or [])
        if value
    }
    if run.workflow_id:
        workflow_ids.add(str(run.workflow_id))
    workflow_ids.update(str(row.workflow_id) for row in candidates if row.workflow_id)
    workflow_decisions = _workflow_decisions_by_id(db, workflow_ids)
    if not output.get("ai_decisions") and workflow_decisions:
        output["ai_decisions"] = list(workflow_decisions.values())
    if not output.get("ai_decision") and output.get("ai_decisions"):
        output["ai_decision"] = output["ai_decisions"][0]
    if not output.get("selected_content_ids"):
        selected_content_ids = [
            str(row.content_id)
            for row in candidates
            if row.selected and row.content_id
        ]
        if selected_content_ids:
            output["selected_content_ids"] = selected_content_ids
            output.setdefault("selected_content_id", selected_content_ids[0])
    workflow_decisions_by_content_id = {
        str(decision["content_id"]): decision
        for decision in workflow_decisions.values()
        if decision.get("content_id")
    }

    return {
        "id": str(run.id),
        "profile": {"id": str(profile.id), "name": profile.profile_name} if profile else None,
        "workflow": {"id": str(workflow.id), "title": workflow.title} if workflow else None,
        "crawl_job_id": str(run.crawl_job_id) if run.crawl_job_id else None,
        "crawl_job_name": crawl_job.name if crawl_job else None,
        "planning_mode": run.planning_mode,
        "status": run.status,
        "input": run.input_jsonb or {},
        "output": output,
        "reason": run.reason_jsonb or {},
        "metadata": run.metadata_json or {},
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "candidates": [
            _serialize_candidate_detail(row, workflow_decisions, workflow_decisions_by_content_id)
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


def _serialize_candidate_detail(
    row,
    workflow_decisions: dict[str, dict[str, Any]],
    workflow_decisions_by_content_id: dict[str, dict[str, Any]],
) -> dict:
    metadata = dict(row.metadata_json) if isinstance(row.metadata_json, dict) else {}
    reason = dict(row.reason_jsonb) if isinstance(row.reason_jsonb, dict) else {}
    workflow_id = str(row.workflow_id) if row.workflow_id else None
    ai_decision = _as_dict(reason.get("ai_decision")) or _as_dict(metadata.get("ai_decision"))
    if not ai_decision and workflow_id:
        ai_decision = workflow_decisions.get(workflow_id)
    if not ai_decision and row.content_id:
        ai_decision = workflow_decisions_by_content_id.get(str(row.content_id))
    if ai_decision:
        decision_workflow_id = ai_decision.get("workflow_id")
        workflow_id = workflow_id or (str(decision_workflow_id) if decision_workflow_id else None)
        metadata.setdefault("ai_decision", ai_decision)
        reason.setdefault("ai_decision", ai_decision)

    return {
        "id": str(row.id),
        "planning_run_id": str(row.planning_run_id),
        "workflow_id": workflow_id,
        "media_workflow_id": workflow_id,
        "content_id": str(row.content_id) if row.content_id else None,
        "title": row.canonical_title,
        "summary": row.summary,
        "rank_order": row.rank_order,
        "score": float(row.score or 0),
        "selected": bool(row.selected),
        "eligible": bool(row.eligible),
        "reason": reason,
        "metadata": metadata,
        "ai_decision": ai_decision,
        "created_at": row.created_at,
    }


def _workflow_decisions_by_id(db: Session, workflow_ids: set[str]) -> dict[str, dict[str, Any]]:
    ids = [_uuid_or_none(value) for value in workflow_ids]
    ids = [value for value in ids if value]
    if not ids:
        return {}

    rows = (
        db.query(
            MediaWorkflow.id,
            MediaWorkflow.title,
            MediaWorkflow.primary_content_id,
            MediaWorkflow.metadata_json,
        )
        .filter(MediaWorkflow.id.in_(ids))
        .all()
    )
    return {str(row.id): _workflow_ai_decision_payload(row) for row in rows}


def _workflow_ai_decision_payload(row) -> dict[str, Any]:
    metadata = dict(row.metadata_json) if isinstance(row.metadata_json, dict) else {}
    decision = _as_dict(metadata.get("ai_decision")) or {}
    reasoning = _as_string_list(decision.get("reasoning")) or _as_string_list(metadata.get("ai_reasoning"))
    reason = str(decision.get("reason") or "").strip()
    if not reason and reasoning:
        reason = reasoning[0]
    if not reason:
        reason = str(decision.get("error_message") or "").strip()

    content_id = decision.get("content_id")
    if not content_id and row.primary_content_id:
        content_id = str(row.primary_content_id)

    return {
        **decision,
        "status": decision.get("status") or "WORKFLOW_CREATED",
        "should_create_workflow": bool(decision.get("should_create_workflow", True)),
        "reason": reason or None,
        "confidence_score": decision.get("confidence_score") or metadata.get("confidence_score"),
        "provider": decision.get("provider"),
        "model": decision.get("model"),
        "workflow_id": str(row.id),
        "content_id": str(content_id) if content_id else None,
        "plan_title": decision.get("plan_title") or row.title,
        "content_angle": decision.get("content_angle") or metadata.get("content_angle"),
        "target_audience": decision.get("target_audience") or metadata.get("target_audience"),
        "tone": decision.get("tone") or metadata.get("tone"),
        "planning_mode": decision.get("planning_mode") or metadata.get("planning_mode"),
        "risk_flags": decision.get("risk_flags") or metadata.get("risk_flags") or [],
        "reasoning": reasoning,
        "series_decision": decision.get("series_decision") or metadata.get("series_decision"),
        "error_message": decision.get("error_message"),
    }


def _as_dict(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _as_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item not in (None, "")]


def _uuid_or_none(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None
