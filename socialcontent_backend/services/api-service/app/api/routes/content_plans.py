import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import AuditLog, ContentPlan, ContentProject, PlanningFeedback, ProjectPart, SocialProfile, User
from common.db.content_projects import sync_project_from_plan
from common.db.session import get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import PLANNING_PLAN_APPROVED, PLANNING_PLAN_REJECTED
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
    sync_project_from_plan(db, plan)
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/{plan_id}/approve")
def approve_content_plan(plan_id: uuid.UUID, payload: schemas.ContentPlanReviewRequest | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = _get_owned_plan(db, plan_id, user)
    plan.status = "APPROVED"
    plan.approved_by = user.id
    plan.approved_at = datetime.utcnow()

    content_projects = []
    if plan.project_id:
        project = db.get(ContentProject, plan.project_id)
        parts = db.query(ProjectPart).filter(ProjectPart.project_id == plan.project_id).all()
        for part in parts:
            part.status = "READY_FOR_PRODUCTION"
        if project:
            project.status = "APPROVED"
            content_projects.append(project)

    if payload and payload.feedback_text:
        db.add(PlanningFeedback(content_plan_id=plan.id, feedback_type="APPROVAL", feedback_text=payload.feedback_text, created_by=user.id))
    db.add(AuditLog(actor_id=user.id, action="content_plan.approved", target_type="content_plan", target_id=str(plan.id)))
    project = sync_project_from_plan(db, plan)
    if project not in content_projects:
        content_projects.append(project)
    db.commit()
    db.refresh(plan)
    event_job_id = plan.project_run_id or plan.project_id or plan.id
    publish(PLANNING_PLAN_APPROVED, build_event(event_type=PLANNING_PLAN_APPROVED, source="api-service", job_id=event_job_id, payload={"plan_id": str(plan.id), "project_id": str(plan.project_id) if plan.project_id else None, "project_run_id": str(plan.project_run_id) if plan.project_run_id else None}))
    return {
        "plan": plan,
        "content_projects": [
            {
                "project_id": project.id,
                "id": project.id,
                "user_id": project.user_id,
                "profile_id": project.profile_id,
                "status": project.status,
                "series_id": project.series_id,
                "content_plan_id": project.content_plan_id,
                "title": project.title,
                "timeline_duration": (project.metadata_json or {}).get("timeline_duration"),
                "rendered_video": next((artifact.uri for artifact in project.artifacts if artifact.artifact_type == "FINAL_VIDEO" and artifact.uri), None),
                "payload": {"project_id": str(project.id), "source": "content_projects"},
                "created_at": project.created_at,
                "updated_at": project.updated_at,
            }
            for project in content_projects
        ],
    }


@router.post("/{plan_id}/reject", response_model=schemas.ContentPlanResponse)
def reject_content_plan(plan_id: uuid.UUID, payload: schemas.ContentPlanReviewRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = _get_owned_plan(db, plan_id, user)
    plan.status = "REJECTED"
    if payload.feedback_text:
        db.add(PlanningFeedback(content_plan_id=plan.id, feedback_type="REJECTION", feedback_text=payload.feedback_text, created_by=user.id))
    db.add(AuditLog(actor_id=user.id, action="content_plan.rejected", target_type="content_plan", target_id=str(plan.id)))
    sync_project_from_plan(db, plan)
    db.commit()
    db.refresh(plan)
    event_job_id = plan.project_run_id or plan.project_id or plan.id
    publish(PLANNING_PLAN_REJECTED, build_event(event_type=PLANNING_PLAN_REJECTED, source="api-service", job_id=event_job_id, payload={"plan_id": str(plan.id), "project_id": str(plan.project_id) if plan.project_id else None, "project_run_id": str(plan.project_run_id) if plan.project_run_id else None}))
    return plan


@router.post("/{plan_id}/regenerate", response_model=schemas.ProjectRunResponse)
def regenerate_content_plan(
    plan_id: uuid.UUID,
    payload: schemas.ContentPlanRegenerateRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_plan(db, plan_id, user)
    raise HTTPException(status_code=410, detail="Legacy plan regeneration was removed. Create a new content project run from project_sources.")


def _get_owned_plan(db: Session, plan_id: uuid.UUID, user: User) -> ContentPlan:
    plan = db.get(ContentPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Content plan not found")
    profile = db.get(SocialProfile, plan.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content plan not found")
    return plan
