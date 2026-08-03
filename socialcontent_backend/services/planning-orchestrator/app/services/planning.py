from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from common.db.models import (
    AuditLog,
    ContentDuplicate,
    ContentItem,
    ContentSource,
    Episode,
    Module2Handoff,
    Module2HandoffItem,
    PlanningCandidate,
    PlanningJob,
    ProcessingRun,
    ProfileContentLink,
    ProfileSeriesTrack,
    SocialProfile,
    Story,
    User,
)
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import MODULE2_HANDOFF_CREATED, PLANNING_JOB_CREATED
from app.schemas import planning as schemas
from app.services.embeddings import EmbeddingService


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
            strategy_snapshot=self._strategy_snapshot(strategy),
        )

        if handoff.selection_mode == "AUTO":
            limit = payload.candidate_limit or 20
            self._add_auto_candidates(db, handoff, strategy.min_score, limit, payload.filters, payload.crawl_job_id)
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

    def create_auto_handoff_from_crawl(self, db: Session, payload: schemas.Module2AutoHandoffRequest, user: User) -> tuple[Module2Handoff, PlanningJob | None]:
        profile = self._get_owned_profile(db, payload.profile_id, user)
        strategy = profile.strategy
        if not strategy:
            raise HTTPException(status_code=400, detail="Profile strategy is required before planning")

        min_quality_score = payload.min_quality_score if payload.min_quality_score is not None else strategy.min_score
        handoff_payload = schemas.Module2HandoffCreateRequest(
            profile_id=profile.id,
            crawl_job_id=payload.crawl_job_id,
            selection_mode="AUTO",
            candidate_limit=payload.candidate_limit,
            handoff_note="Auto dataset from Module 1 crawl completion",
            filters={
                "source_crawl_job_id": str(payload.crawl_job_id),
                "content_types": ["STORY", "ARTICLE", "PLAYLIST"],
                "min_quality_score": min_quality_score,
                "languages": ["vi"],
                "max_related_items_per_primary": payload.max_related_items_per_primary,
            },
        )
        handoff = self.create_handoff(db, handoff_payload, user)

        job = None
        if payload.create_planning_job and handoff.eligible_count > 0:
            job = self.create_job(
                db,
                schemas.PlanningJobCreateRequest(
                    profile_id=profile.id,
                    handoff_id=handoff.id,
                    planning_mode=payload.planning_mode,
                    target_duration_seconds=payload.target_duration_seconds,
                    preferred_part_count=payload.preferred_part_count,
                    language=payload.language,
                    instructions=payload.instructions,
                ),
                user,
            )
        return handoff, job

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

    def _add_auto_candidates(self, db: Session, handoff: Module2Handoff, min_score: float, limit: int, filters: dict, crawl_job_id=None) -> None:
        query = db.query(ContentItem).filter(ContentItem.quality_score >= min_score)
        if crawl_job_id:
            query = query.join(ProcessingRun, ProcessingRun.content_id == ContentItem.id).filter(ProcessingRun.job_id == crawl_job_id).distinct()
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
        primary_contents: list[ContentItem] = []
        for content in query.order_by(ContentItem.quality_score.desc(), ContentItem.updated_at.desc()).limit(limit * 2).all():
            if content.id in duplicate_ids:
                handoff.items.append(self._handoff_item(content_id=content.id, source_crawl_job_id=crawl_job_id, item_role="NEW_PRIMARY", relation_reason="source_crawl_job", status="REJECTED", reason="Duplicate content"))
                continue
            if content.status.upper() not in READY_CONTENT_STATUSES:
                handoff.items.append(self._handoff_item(content_id=content.id, source_crawl_job_id=crawl_job_id, item_role="NEW_PRIMARY", relation_reason="source_crawl_job", status="REJECTED", reason="Content is not ready"))
                continue
            if not content.canonical_title:
                handoff.items.append(self._handoff_item(content_id=content.id, source_crawl_job_id=crawl_job_id, item_role="NEW_PRIMARY", relation_reason="source_crawl_job", status="REJECTED", reason="Missing title"))
                continue
            handoff.items.append(self._handoff_item(content_id=content.id, source_crawl_job_id=crawl_job_id, item_role="NEW_PRIMARY" if crawl_job_id else "AUTO_SELECTED", relation_reason="source_crawl_job" if crawl_job_id else "strategy_match", status="ELIGIBLE", candidate_score=float(content.quality_score or 0)))
            primary_contents.append(content)
            self._remember_profile_content(db, handoff, content.id, "RELATED", "source_crawl_job" if crawl_job_id else "strategy_match", float(content.quality_score or 0))
            if sum(1 for item in handoff.items if item.status == "ELIGIBLE") >= limit:
                break

        if crawl_job_id and primary_contents:
            self._add_related_context_items(db, handoff, primary_contents, filters)

    def _add_related_context_items(self, db: Session, handoff: Module2Handoff, primary_contents: list[ContentItem], filters: dict) -> None:
        max_related = int(filters.get("max_related_items_per_primary") or 5)
        if max_related <= 0:
            return
        existing_ids = {item.content_id for item in handoff.items if item.content_id}
        active_story_ids = {
            row.story_id
            for row in db.query(ProfileSeriesTrack.story_id)
            .filter(ProfileSeriesTrack.profile_id == handoff.profile_id, ProfileSeriesTrack.status.in_(["ACTIVE", "PAUSED"]), ProfileSeriesTrack.story_id != None)  # noqa: E711
            .all()
        }

        for content in primary_contents:
            related = self._find_rule_related_content(db, content, max_related, existing_ids)
            for related_content, reason, score in related:
                handoff.items.append(
                    self._handoff_item(
                        content_id=related_content.id,
                        item_role="RELATED_CONTEXT",
                        relation_reason=reason,
                        status="ELIGIBLE",
                        candidate_score=score,
                        metadata={"primary_content_id": str(content.id)},
                    )
                )
                existing_ids.add(related_content.id)
                self._remember_profile_content(db, handoff, related_content.id, "RELATED", reason, score)

            remaining = max_related - len(related)
            if remaining > 0:
                for result in self._find_embedding_related_content(db, content, remaining, existing_ids):
                    related_content = db.get(ContentItem, result.content_id)
                    if not related_content:
                        continue
                    score = round(result.similarity * 100, 2)
                    handoff.items.append(
                        self._handoff_item(
                            content_id=related_content.id,
                            item_role="RELATED_CONTEXT",
                            relation_reason="embedding_similarity",
                            similarity_score=result.similarity,
                            status="ELIGIBLE",
                            candidate_score=score,
                            metadata={"primary_content_id": str(content.id)},
                        )
                    )
                    existing_ids.add(related_content.id)
                    self._remember_profile_content(db, handoff, related_content.id, "RELATED", "embedding_similarity", score)

        if active_story_ids:
            for story in db.query(Story).filter(Story.id.in_(active_story_ids)).limit(10).all():
                if any(item.story_id == story.id for item in handoff.items):
                    continue
                handoff.items.append(self._handoff_item(story_id=story.id, item_role="ACTIVE_SERIES_CONTEXT", relation_reason="active_series_context", status="ELIGIBLE", candidate_score=80))

    def _find_rule_related_content(self, db: Session, content: ContentItem, limit: int, exclude_ids: set) -> list[tuple[ContentItem, str, float]]:
        reasons: list[tuple[ContentItem, str, float]] = []
        source = db.query(ContentSource).filter(ContentSource.content_id == content.id).first()
        if source:
            siblings = (
                db.query(ContentItem)
                .join(ContentSource, ContentSource.content_id == ContentItem.id)
                .filter(ContentSource.source_type == source.source_type, ContentItem.id != content.id, ContentItem.id.notin_(exclude_ids))
                .order_by(ContentItem.updated_at.desc())
                .limit(limit)
                .all()
            )
            reasons.extend((item, "same_source", 68.0) for item in siblings)

        title_tokens = {token.lower() for token in (content.normalized_title or content.canonical_title or "").split() if len(token) >= 4}
        if title_tokens and len(reasons) < limit:
            candidates = (
                db.query(ContentItem)
                .filter(ContentItem.id != content.id, ContentItem.id.notin_(exclude_ids))
                .order_by(ContentItem.updated_at.desc())
                .limit(80)
                .all()
            )
            seen = {item.id for item, _, _ in reasons}
            for candidate in candidates:
                if candidate.id in seen:
                    continue
                candidate_tokens = {token.lower() for token in (candidate.normalized_title or candidate.canonical_title or "").split() if len(token) >= 4}
                overlap = title_tokens.intersection(candidate_tokens)
                if overlap:
                    score = min(75.0, 55.0 + len(overlap) * 5)
                    reasons.append((candidate, "same_keyword", score))
                    seen.add(candidate.id)
                if len(reasons) >= limit:
                    break
        return reasons[:limit]

    def _find_embedding_related_content(self, db: Session, content: ContentItem, limit: int, exclude_ids: set):
        try:
            return EmbeddingService().search_related_content(db, content, limit=limit, exclude_ids=exclude_ids)
        except Exception:
            return []

    def _handoff_item(
        self,
        *,
        content_id=None,
        story_id=None,
        episode_id=None,
        source_crawl_job_id=None,
        item_role="MANUAL_INCLUDED",
        relation_reason=None,
        similarity_score=None,
        candidate_score=None,
        status="ELIGIBLE",
        reason=None,
        metadata=None,
    ) -> Module2HandoffItem:
        return Module2HandoffItem(
            content_id=content_id,
            story_id=story_id,
            episode_id=episode_id,
            source_crawl_job_id=source_crawl_job_id,
            item_role=item_role,
            relation_reason=relation_reason,
            similarity_score=similarity_score,
            candidate_score=candidate_score,
            status=status,
            rejection_reason=reason,
            metadata_json=metadata or {},
        )

    def _remember_profile_content(self, db: Session, handoff: Module2Handoff, content_id, relation_type: str, relation_reason: str, score: float) -> None:
        link = (
            db.query(ProfileContentLink)
            .filter(ProfileContentLink.profile_id == handoff.profile_id, ProfileContentLink.content_id == content_id, ProfileContentLink.relation_type == relation_type)
            .first()
        )
        if link:
            link.relation_reason = relation_reason
            link.score = max(float(link.score or 0), score)
            link.status = "ACTIVE"
            return
        db.add(
            ProfileContentLink(
                user_id=handoff.user_id,
                profile_id=handoff.profile_id,
                content_id=content_id,
                relation_type=relation_type,
                relation_reason=relation_reason,
                score=score,
                status="ACTIVE",
            )
        )

    def _strategy_snapshot(self, strategy) -> dict:
        return {
            "content_topics": strategy.content_topics,
            "avoid_topics": strategy.avoid_topics,
            "tone": strategy.tone,
            "target_audience": strategy.target_audience,
            "risk_level": strategy.risk_level,
            "min_score": strategy.min_score,
            "require_video": strategy.require_video,
            "auto_queue_enabled": strategy.auto_queue_enabled,
            "auto_publish_enabled": strategy.auto_publish_enabled,
        }

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
                source="planning-orchestrator",
                payload={"handoff_id": str(handoff.id), "profile_id": str(handoff.profile_id), "eligible_items": handoff.eligible_count},
            ),
        )

    def _publish_job_created(self, job: PlanningJob) -> None:
        publish(
            PLANNING_JOB_CREATED,
            build_event(
                event_type=PLANNING_JOB_CREATED,
                source="planning-orchestrator",
                job_id=job.id,
                payload={"job_id": str(job.id), "profile_id": str(job.profile_id), "handoff_id": str(job.handoff_id)},
            ),
        )
