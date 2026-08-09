import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import AuditLog, ContentItem, ContentPlan, Module2Handoff, Module2HandoffItem, PlanningFeedback, PlanningJob, SocialProfile, User
from common.db.session import get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import PLANNING_JOB_CREATED, PLANNING_PLAN_APPROVED, PLANNING_PLAN_REJECTED
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


@router.get("", response_model=list[schemas.ContentPlanResponse])
def list_content_plans(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(ContentPlan)
        .join(SocialProfile, SocialProfile.id == ContentPlan.profile_id)
        .filter(SocialProfile.user_id == user.id)
        .order_by(ContentPlan.updated_at.desc())
        .limit(100)
        .all()
    )


@router.get("/{plan_id}", response_model=schemas.ContentPlanResponse)
def get_content_plan(plan_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_owned_plan(db, plan_id, user)


@router.patch("/{plan_id}", response_model=schemas.ContentPlanResponse)
def update_content_plan(plan_id: uuid.UUID, payload: schemas.ContentPlanUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = _get_owned_plan(db, plan_id, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    plan.version += 1
    if plan.status == "APPROVED":
        plan.status = "NEEDS_REVIEW"
        plan.approved_by = None
        plan.approved_at = None
    db.add(AuditLog(actor_id=user.id, action="content_plan.updated", target_type="content_plan", target_id=str(plan.id)))
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/{plan_id}/approve", response_model=schemas.ContentPlanResponse)
def approve_content_plan(plan_id: uuid.UUID, payload: schemas.ContentPlanReviewRequest | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = _get_owned_plan(db, plan_id, user)
    plan.status = "APPROVED"
    plan.approved_by = user.id
    plan.approved_at = datetime.utcnow()

    # Duyệt Cả Cụm (Approve Plan + Series)
    from common.db.models import ContentSeries, SeriesPart
    series_list = db.query(ContentSeries).filter(ContentSeries.content_plan_id == plan.id).all()
    for series in series_list:
        series.status = "APPROVED"
        parts = db.query(SeriesPart).filter(SeriesPart.series_id == series.id).all()
        for part in parts:
            part.status = "READY_FOR_PRODUCTION"

    if payload and payload.feedback_text:
        db.add(PlanningFeedback(content_plan_id=plan.id, feedback_type="APPROVAL", feedback_text=payload.feedback_text, created_by=user.id))
    db.add(AuditLog(actor_id=user.id, action="content_plan.approved", target_type="content_plan", target_id=str(plan.id)))
    db.commit()
    db.refresh(plan)
    publish(PLANNING_PLAN_APPROVED, build_event(event_type=PLANNING_PLAN_APPROVED, source="api-service", job_id=plan.planning_job_id, payload={"plan_id": str(plan.id)}))
    return plan


@router.post("/{plan_id}/reject", response_model=schemas.ContentPlanResponse)
def reject_content_plan(plan_id: uuid.UUID, payload: schemas.ContentPlanReviewRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = _get_owned_plan(db, plan_id, user)
    plan.status = "REJECTED"
    if payload.feedback_text:
        db.add(PlanningFeedback(content_plan_id=plan.id, feedback_type="REJECTION", feedback_text=payload.feedback_text, created_by=user.id))
    db.add(AuditLog(actor_id=user.id, action="content_plan.rejected", target_type="content_plan", target_id=str(plan.id)))
    db.commit()
    db.refresh(plan)
    publish(PLANNING_PLAN_REJECTED, build_event(event_type=PLANNING_PLAN_REJECTED, source="api-service", job_id=plan.planning_job_id, payload={"plan_id": str(plan.id)}))
    return plan


@router.post("/{plan_id}/regenerate", response_model=schemas.PlanningJobResponse)
def regenerate_content_plan(
    plan_id: uuid.UUID,
    payload: schemas.ContentPlanRegenerateRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, user)
    original_job = db.get(PlanningJob, plan.planning_job_id)
    if not original_job:
        raise HTTPException(status_code=404, detail="Planning job not found")
    if not plan.primary_content_id and not plan.primary_story_id:
        raise HTTPException(status_code=400, detail="Content plan has no source to regenerate")

    content = db.get(ContentItem, plan.primary_content_id) if plan.primary_content_id else None
    is_article = bool(content and (content.content_type or "").upper() == "ARTICLE")

    plan.status = "SUPERSEDED"
    handoff = Module2Handoff(
        user_id=user.id,
        profile_id=plan.profile_id,
        selection_mode="MANUAL",
        status="READY",
        handoff_note=f"Regenerate bài: {plan.title}",
        eligible_count=1,
        rejected_count=0,
        filters={"regenerated_from_plan_id": str(plan.id)},
        strategy_snapshot={},
    )
    handoff.items.append(
        Module2HandoffItem(
            content_id=plan.primary_content_id,
            story_id=plan.primary_story_id,
            item_role="MANUAL_INCLUDED",
            relation_reason="regenerate_plan",
            candidate_score=100,
            status="ELIGIBLE",
            metadata_json={"regenerated_from_plan_id": str(plan.id)},
        )
    )
    db.add(handoff)
    db.flush()

    next_job = PlanningJob(
        user_id=user.id,
        profile_id=plan.profile_id,
        handoff_id=handoff.id,
        planning_mode=plan.planning_mode,
        status="PENDING",
        current_stage="VALIDATING_INPUT",
        target_duration_seconds=plan.target_duration_seconds or original_job.target_duration_seconds,
        preferred_part_count=None if is_article else original_job.preferred_part_count,
        language=original_job.language,
        instructions=payload.instructions if payload and payload.instructions else original_job.instructions,
    )
    db.add(next_job)
    db.add(AuditLog(actor_id=user.id, action="content_plan.regenerate_requested", target_type="content_plan", target_id=str(plan.id)))
    db.commit()
    db.refresh(next_job)
    publish(PLANNING_JOB_CREATED, build_event(event_type=PLANNING_JOB_CREATED, source="api-service", job_id=next_job.id, payload={"job_id": str(next_job.id), "regenerated_from_plan_id": str(plan.id)}))
    return next_job


def _get_owned_plan(db: Session, plan_id: uuid.UUID, user: User) -> ContentPlan:
    plan = db.get(ContentPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Content plan not found")
    profile = db.get(SocialProfile, plan.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content plan not found")
    return plan
