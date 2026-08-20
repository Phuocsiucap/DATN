from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from common.db.models import (
    AuditLog,
    ContentItem,
    ContentProject,
    ProjectCandidate,
    ProjectRun,
    ProjectSource,
    SocialProfile,
    User,
)
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import PROJECT_RUN_CREATED
from app.schemas import planning as schemas


TERMINAL_PLANNING_STATUSES = {"SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED", "WAITING_REVIEW"}
PLANNABLE_CONTENT_STATUSES = {"READY", "USABLE_WITH_WARNING"}


class PlanningService:
    def create_job(self, db: Session, payload: schemas.ProjectRunCreateRequest, user: User) -> ProjectRun:
        profile = self._get_owned_profile(db, payload.profile_id, user)
        if not profile.strategy:
            raise HTTPException(status_code=400, detail="Profile strategy is required before planning")
        if not payload.project_id:
            raise HTTPException(status_code=400, detail="project_id is required")

        project = db.get(ContentProject, payload.project_id)
        if not project or project.user_id != user.id or project.profile_id != profile.id:
            raise HTTPException(status_code=404, detail="Content project not found")

        planning_sources = [source for source in project.sources if source.status == "ACTIVE" and self._source_is_plannable(db, source)]
        if not planning_sources:
            raise HTTPException(status_code=400, detail="Content project has no plannable active sources")

        run = ProjectRun(
            project_id=project.id,
            run_type="PLANNING",
            status="QUEUED",
            current_stage="SELECTING_CANDIDATES",
            progress_percent=5,
            metadata_json={
                "planning_mode": payload.planning_mode.upper(),
                "target_duration_seconds": payload.target_duration_seconds,
                "preferred_part_count": payload.preferred_part_count,
                "language": payload.language,
                "instructions": payload.instructions,
                "skip_ai_evaluation": payload.skip_ai_evaluation,
                "attempt_count": 1,
            },
        )
        db.add(run)

        project.status = "PLANNING_RUNNING"
        project.planning_mode = payload.planning_mode.upper()
        project.current_stage = "SELECTING_CANDIDATES"
        project.progress_percent = 5

        for index, source in enumerate(planning_sources, start=1):
            candidate = self._candidate_for_source(db, project, source)
            candidate.rank_order = index
            candidate.score = 0
            candidate.eligible = True
            candidate.metadata_json = {
                "project_source_id": str(source.id),
                "score_breakdown": {
                    "initial_quality_score": float(source.score or 0),
                    "status": "PENDING_EMBEDDING_RELEVANCE_SCORE",
                },
                "selection_reasons": ["Included from project_sources; embedding relevance scoring pending"],
                "rejection_reasons": [],
            }
            db.add(candidate)

        db.add(project)
        db.add(AuditLog(actor_id=user.id, action="project_run.planning.created", target_type="content_project", target_id=str(project.id), metadata_json={"run_id": str(run.id)}))
        db.commit()
        db.refresh(run)
        self._publish_job_created(run)
        return run

    def cancel_job(self, db: Session, run: ProjectRun, user: User) -> ProjectRun:
        self._ensure_run_owner(run, user)
        if run.status not in TERMINAL_PLANNING_STATUSES:
            run.status = "CANCELLED"
            run.current_stage = "COMPLETED"
            run.progress_percent = 100
            run.completed_at = datetime.utcnow()
            run.project.status = "FAILED"
            run.project.current_stage = "COMPLETED"
            run.project.progress_percent = 100
            db.add(AuditLog(actor_id=user.id, action="project_run.planning.cancelled", target_type="project_run", target_id=str(run.id)))
            db.commit()
            db.refresh(run)
        return run

    def retry_job(self, db: Session, run: ProjectRun, user: User) -> ProjectRun:
        self._ensure_run_owner(run, user)
        if run.status not in {"FAILED", "PARTIAL_SUCCESS", "CANCELLED"}:
            raise HTTPException(status_code=400, detail="Only failed, partial, or cancelled planning runs can be retried")
        run.status = "QUEUED"
        run.current_stage = "SELECTING_CANDIDATES"
        run.progress_percent = 5
        run.error_message = None
        run.started_at = None
        run.completed_at = None
        run.attempt_count = run.attempt_count + 1
        run.project.status = "PLANNING_RUNNING"
        run.project.current_stage = "SELECTING_CANDIDATES"
        run.project.progress_percent = 5
        db.add(AuditLog(actor_id=user.id, action="project_run.planning.retry", target_type="project_run", target_id=str(run.id)))
        db.commit()
        db.refresh(run)
        self._publish_job_created(run)
        return run

    def _candidate_for_source(self, db: Session, project: ContentProject, source: ProjectSource) -> ProjectCandidate:
        query = db.query(ProjectCandidate).filter(ProjectCandidate.project_id == project.id)
        query = query.filter(ProjectCandidate.content_id == source.content_id) if source.content_id else query.filter(ProjectCandidate.content_id.is_(None))
        query = query.filter(ProjectCandidate.story_id == source.story_id) if source.story_id else query.filter(ProjectCandidate.story_id.is_(None))
        query = query.filter(ProjectCandidate.episode_id == source.episode_id) if source.episode_id else query.filter(ProjectCandidate.episode_id.is_(None))
        candidate = query.first()
        if candidate:
            return candidate
        return ProjectCandidate(
            project_id=project.id,
            content_id=source.content_id,
            story_id=source.story_id,
            episode_id=source.episode_id,
        )

    def _source_is_plannable(self, db: Session, source: ProjectSource) -> bool:
        if source.content_id:
            content = db.get(ContentItem, source.content_id)
            return bool(content and content.status in PLANNABLE_CONTENT_STATUSES)
        return True

    def _get_owned_profile(self, db: Session, profile_id, user: User) -> SocialProfile:
        profile = db.get(SocialProfile, profile_id)
        if not profile or profile.user_id != user.id:
            raise HTTPException(status_code=404, detail="Social profile not found")
        return profile

    def _ensure_run_owner(self, run: ProjectRun, user: User) -> None:
        if run.run_type != "PLANNING" or not run.project or run.project.user_id != user.id:
            raise HTTPException(status_code=404, detail="Planning run not found")

    def _publish_job_created(self, run: ProjectRun) -> None:
        publish(
            PROJECT_RUN_CREATED,
            build_event(
                event_type=PROJECT_RUN_CREATED,
                source="planning-orchestrator",
                job_id=run.id,
                payload={"run_id": str(run.id), "project_id": str(run.project_id), "profile_id": str(run.project.profile_id)},
            ),
        )
