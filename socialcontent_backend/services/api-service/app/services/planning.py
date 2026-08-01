from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from common.db.models import (
    AuditLog,
    ContentDuplicate,
    ContentItem,
    Episode,
    Module2Handoff,
    Module2HandoffItem,
    PlanningCandidate,
    PlanningJob,
    SocialProfile,
    Story,
    User,
)
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import MODULE2_HANDOFF_CREATED, PLANNING_JOB_CREATED
from app.schemas import api as schemas


READY_CONTENT_STATUSES = {"READY", "NORMALIZED", "APPROVED", "PUBLISHED"}
TERMINAL_PLANNING_STATUSES = {"SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"}


class PlanningService:
    def create_handoff(self, db: Session, payload: schemas.Module2HandoffCreateRequest, user: User) -> Module2Handoff:
        profile = self._get_owned_profile(db, payload.profile_id, user)
        strategy = profile.strategy
        if not strategy:
            raise HTTPException(status_code=400, detail="Profile strategy is required before planning")

        handoff = Module2Handoff(
            user_id=user.id,
            profile_id=profile.id,
            selection_mode=payload.selection_mode.upper(),
            status="READY",
            handoff_note=payload.handoff_note,
            filters=payload.filters,
        )

        if handoff.selection_mode == "AUTO":
            limit = payload.candidate_limit or 20
            self._add_auto_candidates(db, handoff, strategy.min_score, limit, payload.filters)
        else:
            self._add_manual_items(db, handoff, payload)

        handoff.eligible_count = sum(1 for item in handoff.items if item.status == "ELIGIBLE")
        handoff.rejected_count = sum(1 for item in handoff.items if item.status != "ELIGIBLE")
        if handoff.eligible_count == 0:
            handoff.status = "NEEDS_REVIEW"

        db.add(handoff)
        db.add(
            AuditLog(
                actor_id=user.id,
                action="module2.handoff.created",
                target_type="module2_handoff",
                metadata_json={"profile_id": str(profile.id), "eligible_count": handoff.eligible_count},
            )
        )
        db.commit()
        db.refresh(handoff)
        self._publish_handoff_created(handoff)
        return handoff

    def create_job(self, db: Session, payload: schemas.PlanningJobCreateRequest, user: User) -> PlanningJob:
        profile = self._get_owned_profile(db, payload.profile_id, user)
        if not profile.strategy:
            raise HTTPException(status_code=400, detail="Profile strategy is required before planning")
        handoff = db.get(Module2Handoff, payload.handoff_id)
        if not handoff or handoff.user_id != user.id or handoff.profile_id != profile.id:
            raise HTTPException(status_code=404, detail="Handoff not found")
        if handoff.status not in {"READY", "NEEDS_REVIEW"}:
            raise HTTPException(status_code=400, detail="Handoff is not ready for planning")
        if handoff.eligible_count <= 0:
            raise HTTPException(status_code=400, detail="Handoff has no eligible items")

        job = PlanningJob(
            user_id=user.id,
            profile_id=profile.id,
            handoff_id=handoff.id,
            planning_mode=payload.planning_mode.upper(),
            status="QUEUED",
            current_stage="SELECTING_CANDIDATES",
            progress_percent=5,
            target_duration_seconds=payload.target_duration_seconds,
            preferred_part_count=payload.preferred_part_count,
            language=payload.language,
            instructions=payload.instructions,
        )
        for index, item in enumerate([item for item in handoff.items if item.status == "ELIGIBLE"], start=1):
            job.candidates.append(
                PlanningCandidate(
                    content_id=item.content_id,
                    story_id=item.story_id,
                    episode_id=item.episode_id,
                    eligible=True,
                    candidate_score=0,
                    rank_order=index,
                    score_breakdown={},
                    selection_reasons=["Included from Module 2 handoff"],
                    rejection_reasons=[],
                )
            )

        db.add(job)
        db.add(AuditLog(actor_id=user.id, action="planning_job.created", target_type="planning_job", metadata_json={"handoff_id": str(handoff.id)}))
        db.commit()
        db.refresh(job)
        self._publish_job_created(job)
        return job

    def cancel_job(self, db: Session, job: PlanningJob, user: User) -> PlanningJob:
        self._ensure_job_owner(job, user)
        if job.status not in TERMINAL_PLANNING_STATUSES:
            job.status = "CANCELLED"
            job.current_stage = "COMPLETED"
            job.completed_at = datetime.utcnow()
            db.add(AuditLog(actor_id=user.id, action="planning_job.cancelled", target_type="planning_job", target_id=str(job.id)))
            db.commit()
            db.refresh(job)
        return job

    def retry_job(self, db: Session, job: PlanningJob, user: User) -> PlanningJob:
        self._ensure_job_owner(job, user)
        if job.status not in {"FAILED", "PARTIAL_SUCCESS", "CANCELLED"}:
            raise HTTPException(status_code=400, detail="Only failed, partial, or cancelled jobs can be retried")
        job.status = "QUEUED"
        job.current_stage = "SELECTING_CANDIDATES"
        job.progress_percent = 5
        job.attempt_count += 1
        job.error_code = None
        job.error_message = None
        job.started_at = None
        job.completed_at = None
        db.add(AuditLog(actor_id=user.id, action="planning_job.retry", target_type="planning_job", target_id=str(job.id)))
        db.commit()
        db.refresh(job)
        self._publish_job_created(job)
        return job

    def _add_manual_items(self, db: Session, handoff: Module2Handoff, payload: schemas.Module2HandoffCreateRequest) -> None:
        for content_id in payload.content_ids:
            content = db.get(ContentItem, content_id)
            handoff.items.append(self._handoff_item(content_id=content_id, status="ELIGIBLE" if content else "REJECTED", reason=None if content else "Content not found"))
        for story_id in payload.story_ids:
            story = db.get(Story, story_id)
            handoff.items.append(self._handoff_item(story_id=story_id, status="ELIGIBLE" if story else "REJECTED", reason=None if story else "Story not found"))
        for episode_id in payload.episode_ids:
            episode = db.get(Episode, episode_id)
            handoff.items.append(self._handoff_item(episode_id=episode_id, status="ELIGIBLE" if episode else "REJECTED", reason=None if episode else "Episode not found"))

    def _add_auto_candidates(self, db: Session, handoff: Module2Handoff, min_score: float, limit: int, filters: dict) -> None:
        query = db.query(ContentItem).filter(ContentItem.quality_score >= min_score)
        languages = filters.get("languages")
        if languages:
            query = query.filter(ContentItem.language.in_(languages))
        content_types = filters.get("content_types")
        if content_types:
            query = query.filter(ContentItem.content_type.in_([value.upper() for value in content_types]))
        min_quality = filters.get("min_quality_score")
        if min_quality is not None:
            query = query.filter(ContentItem.quality_score >= min_quality)
        published_after = filters.get("published_after")
        if published_after:
            query = query.filter(or_(ContentItem.published_at == None, ContentItem.published_at >= published_after))  # noqa: E711

        duplicate_ids = {row.duplicate_content_id for row in db.query(ContentDuplicate.duplicate_content_id).filter(ContentDuplicate.decision.in_(["DUPLICATE", "MERGED"])).all()}
        for content in query.order_by(ContentItem.quality_score.desc(), ContentItem.updated_at.desc()).limit(limit * 2).all():
            if content.id in duplicate_ids:
                handoff.items.append(self._handoff_item(content_id=content.id, status="REJECTED", reason="Duplicate content"))
                continue
            if content.status.upper() not in READY_CONTENT_STATUSES:
                handoff.items.append(self._handoff_item(content_id=content.id, status="REJECTED", reason="Content is not ready"))
                continue
            if not content.canonical_title:
                handoff.items.append(self._handoff_item(content_id=content.id, status="REJECTED", reason="Missing title"))
                continue
            handoff.items.append(self._handoff_item(content_id=content.id, status="ELIGIBLE"))
            if sum(1 for item in handoff.items if item.status == "ELIGIBLE") >= limit:
                break

    def _handoff_item(self, *, content_id=None, story_id=None, episode_id=None, status="ELIGIBLE", reason=None) -> Module2HandoffItem:
        return Module2HandoffItem(content_id=content_id, story_id=story_id, episode_id=episode_id, status=status, rejection_reason=reason)

    def _get_owned_profile(self, db: Session, profile_id, user: User) -> SocialProfile:
        profile = db.get(SocialProfile, profile_id)
        if not profile or profile.user_id != user.id:
            raise HTTPException(status_code=404, detail="Social profile not found")
        return profile

    def _ensure_job_owner(self, job: PlanningJob, user: User) -> None:
        if job.user_id != user.id:
            raise HTTPException(status_code=404, detail="Planning job not found")

    def _publish_handoff_created(self, handoff: Module2Handoff) -> None:
        publish(
            MODULE2_HANDOFF_CREATED,
            build_event(
                event_type=MODULE2_HANDOFF_CREATED,
                source="api-service",
                payload={"handoff_id": str(handoff.id), "profile_id": str(handoff.profile_id), "eligible_items": handoff.eligible_count},
            ),
        )

    def _publish_job_created(self, job: PlanningJob) -> None:
        publish(
            PLANNING_JOB_CREATED,
            build_event(
                event_type=PLANNING_JOB_CREATED,
                source="api-service",
                job_id=job.id,
                payload={"job_id": str(job.id), "profile_id": str(job.profile_id), "handoff_id": str(job.handoff_id)},
            ),
        )
