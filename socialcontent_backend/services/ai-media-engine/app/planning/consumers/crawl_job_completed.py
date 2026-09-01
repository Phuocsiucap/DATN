from __future__ import annotations

import logging
import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import distinct, func
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.content_series import (
    find_active_series_by_title,
    lock_active_series,
    lock_profile_series_scope,
    sync_series_current_part,
)
from common.db.idempotency import claim_event
from common.db.media_workflows import content_category_payload
from common.db.models import (
    ContentItem,
    ContentSeries,
    CrawlJob,
    CrawlJobContent,
    MediaWorkflow,
    PlanningCandidate,
    PlanningRun,
    ProfileContentLink,
    SocialProfile,
    SocialProfileStrategy,
)
from common.db.session import SessionLocal
from common.events.kafka import consumer
from common.events.topics import CRAWL_JOB_COMPLETED, PROFILE_STRATEGY_UPDATED
from common.planning.embedding_matcher import StrategyCandidateScore, StrategyEmbeddingMatcher
from common.planning.auto_draft_policy import draft_script_signature
from app.planning.services.auto_workflow_planner import AutoWorkflowDecision, AutoWorkflowPlanner
from app.video.services.generate_video_jobs import _maybe_enqueue_auto_voice_or_render

logger = logging.getLogger(__name__)
AUTO_SELECTION_ALGORITHM = "production_gate_compact_draft_v3"


def run_crawl_job_completed_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        logger.info("Kafka disabled; crawl_job_completed consumer idle")
        return

    kafka_consumer = consumer(
        [CRAWL_JOB_COMPLETED, PROFILE_STRATEGY_UPDATED],
        group_id="planning-orchestrator-auto-project-queue",
    )
    for record in kafka_consumer:
        try:
            message = record.value
            event_id = message.get("event_id")
            with SessionLocal() as db:
                if event_id and not claim_event(db, event_id, "planning-orchestrator-auto-project-queue"):
                    kafka_consumer.commit()
                    continue
                if message.get("event_type") == PROFILE_STRATEGY_UPDATED:
                    _handle_profile_strategy_updated(db, message)
                else:
                    _handle_crawl_job_completed(db, message)
            kafka_consumer.commit()
        except Exception as exc:
            logger.exception("[planning-orchestrator] Error processing crawl_job_completed record offset %s: %s", record.offset, exc)


def _handle_crawl_job_completed(db: Session, message: dict[str, Any]) -> None:
    job_id = message.get("job_id") or message.get("payload", {}).get("job_id")
    status = message.get("payload", {}).get("status") or "SUCCEEDED"
    print(f"[planning-orchestrator] Received crawl.job.completed for job_id={job_id}, status={status}")

    if status not in {"SUCCEEDED", "PARTIAL_SUCCESS"}:
        print(f"[planning-orchestrator] Skipping auto workflow for non-successful crawl job {job_id} (status={status})")
        return
    if not job_id:
        print("[planning-orchestrator] Skipping auto workflow because crawl job id is missing")
        return

    job_uuid = _as_uuid(job_id)
    job = db.get(CrawlJob, job_uuid) if job_uuid else None
    if not job:
        print(f"[planning-orchestrator] Skipping auto workflow because crawl job {job_id} was not found")
        return
    if str(job.content_scope or "").upper() != "GLOBAL":
        print(
            f"[planning-orchestrator] Skipping crawl job {job_id}; only GLOBAL content can be distributed to creator profiles"
        )
        return

    profiles = _global_receiving_profiles(db)
    if not profiles:
        print(f"[planning-orchestrator] No active profiles are configured to receive GLOBAL content for crawl job {job_id}")
        return

    matcher = StrategyEmbeddingMatcher()
    planner = AutoWorkflowPlanner()
    items = _content_items_for_crawl_job(db, job_uuid)
    if not items:
        print(f"[planning-orchestrator] No READY content found for crawl job {job_id}; recording 0-candidate planning run")

    for profile in profiles:
        strategy = profile.strategy
        if not strategy:
            continue
        if _has_completed_global_job_plan(db, profile.id, job_uuid, items):
            print(f"[planning-orchestrator] GLOBAL planning run already exists for profile {profile.id} and crawl job {job_id}")
            continue
        try:
            _process_profile_auto_workflows(
                db,
                profile=profile,
                strategy=strategy,
                job_id=str(job_id),
                items=items,
                matcher=matcher,
                planner=planner,
                trigger="global_crawl_completed",
            )
        except Exception as exc:
            db.rollback()
            _mark_failed_planning_run(db, profile.id, job_uuid, exc)
            print(f"[planning-orchestrator] Failed auto workflow planning for profile {profile.id} on crawl job {job_id}: {exc}")


def _handle_profile_strategy_updated(db: Session, message: dict[str, Any]) -> None:
    payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
    profile_id = _as_uuid(payload.get("profile_id"))
    if not profile_id:
        print("[planning-orchestrator] Skipping strategy update because profile_id is missing or invalid")
        return

    profile = _global_receiving_profiles(db, profile_id=profile_id)
    profile = profile[0] if profile else None
    if not profile or not profile.strategy:
        print(f"[planning-orchestrator] Profile {profile_id} is not enabled to receive GLOBAL content")
        return

    items = _recent_global_content(db, limit=500)
    if not items:
        print(f"[planning-orchestrator] No GLOBAL content is available to score for profile {profile_id}")

    try:
        _process_profile_auto_workflows(
            db,
            profile=profile,
            strategy=profile.strategy,
            job_id=None,
            items=items,
            matcher=StrategyEmbeddingMatcher(),
            planner=AutoWorkflowPlanner(),
            trigger="profile_strategy_updated",
        )
    except Exception as exc:
        db.rollback()
        _mark_failed_planning_run(db, profile.id, None, exc)
        print(f"[planning-orchestrator] Failed strategy-triggered GLOBAL planning for profile {profile_id}: {exc}")


def _global_receiving_profiles(db: Session, *, profile_id: uuid.UUID | None = None) -> list[SocialProfile]:
    query = (
        db.query(SocialProfile)
        .join(SocialProfileStrategy, SocialProfileStrategy.profile_id == SocialProfile.id)
        .filter(
            SocialProfile.status == "active",
            SocialProfileStrategy.receive_system_content.is_(True),
        )
    )
    if profile_id:
        query = query.filter(SocialProfile.id == profile_id)
    return query.all()


def _has_completed_global_job_plan(
    db: Session,
    profile_id: uuid.UUID,
    crawl_job_id: uuid.UUID,
    items: list[ContentItem],
) -> bool:
    existing = (
        db.query(PlanningRun)
        .filter(
            PlanningRun.profile_id == profile_id,
            PlanningRun.crawl_job_id == crawl_job_id,
            PlanningRun.planning_mode == "AUTO",
            PlanningRun.status.in_(["RUNNING", "SUCCEEDED", "WAITING_REVIEW"]),
        )
        .order_by(PlanningRun.created_at.desc())
        .first()
    )
    if not existing:
        return False
    candidate_count = int((existing.input_jsonb or {}).get("candidate_count") or 0)
    return candidate_count > 0 or not items


def _mark_failed_planning_run(
    db: Session,
    profile_id: uuid.UUID,
    crawl_job_id: uuid.UUID | None,
    error: Exception,
) -> None:
    run = (
        db.query(PlanningRun)
        .filter(
            PlanningRun.profile_id == profile_id,
            PlanningRun.crawl_job_id == crawl_job_id,
            PlanningRun.planning_mode == "AUTO",
            PlanningRun.status == "RUNNING",
        )
        .order_by(PlanningRun.created_at.desc())
        .first()
    )
    if not run:
        return
    run.status = "FAILED"
    run.completed_at = datetime.now(timezone.utc)
    run.metadata_json = {
        **(run.metadata_json if isinstance(run.metadata_json, dict) else {}),
        "error_code": "GLOBAL_PLANNING_FAILED",
        "error_message": str(error)[:2000],
    }
    db.add(run)
    db.commit()


def _content_items_for_crawl_job(db: Session, crawl_job_id: uuid.UUID) -> list[ContentItem]:
    return (
        db.query(ContentItem)
        .join(CrawlJobContent, CrawlJobContent.content_id == ContentItem.id)
        .filter(
            CrawlJobContent.job_id == crawl_job_id,
            ContentItem.content_scope == "GLOBAL",
            ContentItem.status.in_(["READY", "USABLE_WITH_WARNING"]),
        )
        .order_by(ContentItem.updated_at.desc(), ContentItem.quality_score.desc())
        .limit(500)
        .all()
    )


def _recent_global_content(db: Session, *, limit: int) -> list[ContentItem]:
    return (
        db.query(ContentItem)
        .filter(
            ContentItem.content_scope == "GLOBAL",
            ContentItem.status.in_(["READY", "USABLE_WITH_WARNING"]),
        )
        .order_by(ContentItem.updated_at.desc(), ContentItem.quality_score.desc())
        .limit(limit)
        .all()
    )


def _daily_recommendation_limit(strategy: SocialProfileStrategy) -> int:
    try:
        return max(1, min(500, int(strategy.max_system_recommendations or 20)))
    except (TypeError, ValueError):
        return 20


def _strategy_day_window(
    strategy: SocialProfileStrategy,
    *,
    now: datetime | None = None,
) -> tuple[datetime, datetime]:
    timezone_name = str(getattr(strategy, "schedule_timezone", None) or "Asia/Bangkok").strip()
    try:
        strategy_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        strategy_timezone = timezone.utc

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    local_date = current.astimezone(strategy_timezone).date()
    local_start = datetime.combine(local_date, time.min, tzinfo=strategy_timezone)
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)


def _daily_recommendation_count(
    db: Session,
    profile_id: uuid.UUID,
    strategy: SocialProfileStrategy,
    *,
    now: datetime | None = None,
) -> int:
    day_start, day_end = _strategy_day_window(strategy, now=now)
    value = (
        db.query(func.count(distinct(ProfileContentLink.content_id)))
        .filter(
            ProfileContentLink.profile_id == profile_id,
            ProfileContentLink.source_scope == "GLOBAL",
            ProfileContentLink.relation_type == "CONTENT_RECOMMENDATION",
            ProfileContentLink.recommended_at >= day_start,
            ProfileContentLink.recommended_at < day_end,
        )
        .scalar()
    )
    return max(0, int(value or 0))


def _existing_recommendation_content_ids(
    db: Session,
    profile_id: uuid.UUID,
    content_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    if not content_ids:
        return set()
    rows = (
        db.query(ProfileContentLink.content_id)
        .filter(
            ProfileContentLink.profile_id == profile_id,
            ProfileContentLink.source_scope == "GLOBAL",
            ProfileContentLink.relation_type == "CONTENT_RECOMMENDATION",
            ProfileContentLink.recommended_at.is_not(None),
            ProfileContentLink.content_id.in_(content_ids),
        )
        .all()
    )
    return {row[0] for row in rows if row[0] is not None}


def _lock_profile_recommendation_quota(db: Session, profile_id: uuid.UUID) -> None:
    # Serialize quota reservation for one profile. The lock is released by the
    # commit immediately after links are created, before any creative AI call.
    (
        db.query(SocialProfileStrategy.id)
        .filter(SocialProfileStrategy.profile_id == profile_id)
        .with_for_update()
        .first()
    )


def _process_profile_auto_workflows(
    db: Session,
    *,
    profile: SocialProfile,
    strategy: SocialProfileStrategy,
    job_id: str | None,
    items: list[ContentItem],
    matcher: StrategyEmbeddingMatcher,
    planner: AutoWorkflowPlanner,
    trigger: str = "global_crawl_completed",
) -> None:
    ranked = matcher.rank_candidates(db, items, strategy, limit=len(items))
    db.commit()

    eligible = [score for score in ranked if score.eligible]
    _lock_profile_recommendation_quota(db, profile.id)
    daily_limit = _daily_recommendation_limit(strategy)
    received_today = _daily_recommendation_count(db, profile.id, strategy)
    remaining_quota = max(0, daily_limit - received_today)
    existing_content_ids = _existing_recommendation_content_ids(
        db,
        profile.id,
        [score.content.id for score in ranked],
    )
    new_recommendations = [
        score for score in eligible if score.content.id not in existing_content_ids
    ][:remaining_quota]
    recommendation_ids = {score.content.id for score in new_recommendations}
    existing_scores = [score for score in ranked if score.content.id in existing_content_ids]
    for score in existing_scores:
        _upsert_profile_content_link(db, profile, score, decision=None)
    for score in new_recommendations:
        _upsert_profile_content_link(db, profile, score, decision=None, assigned_now=True)
    db.commit()

    avoid_blocked_count = sum(1 for score in ranked if score.avoided_topics)
    print(
        f"[planning-orchestrator] Profile {profile.id}: {len(eligible)}/{len(ranked)} GLOBAL candidates passed; "
        f"assigned={len(new_recommendations)}, daily_quota={daily_limit}, already_received_today={received_today}; "
        f"trigger={trigger}; crawl_job={job_id}; avoid_blocked={avoid_blocked_count}"
    )

    now = datetime.now(timezone.utc)
    planning_run = PlanningRun(
        user_id=profile.user_id,
        profile_id=profile.id,
        workflow_id=None,
        crawl_job_id=_as_uuid(job_id),
        planning_mode="AUTO",
        status="RUNNING",
        input_jsonb={
            "crawl_job_id": str(job_id) if job_id else None,
            "source_scope": "GLOBAL",
            "candidate_count": len(ranked),
            "eligible_count": len(eligible),
            "avoid_blocked_count": avoid_blocked_count,
            "strategy_similarity_threshold": matcher.strategy_similarity_threshold(strategy),
            "daily_recommendation_limit": daily_limit,
            "received_before_run": received_today,
            "remaining_quota_before_run": remaining_quota,
        },
        output_jsonb={
            "candidate_count": len(ranked),
            "eligible_count": len(eligible),
            "recommendations_assigned": len(new_recommendations),
            "recommended_content_ids": [str(score.content.id) for score in new_recommendations],
            "daily_recommendation_limit": daily_limit,
            "daily_quota_exhausted": len(new_recommendations) >= remaining_quota,
            "workflows_created": [],
            "auto_workflow_enabled": bool(strategy.auto_project_queue_enabled),
        },
        reason_jsonb={
            "trigger": trigger,
            "selection_reasons": [
                f"Evaluated {len(ranked)} GLOBAL candidate items for profile {profile.id} with topic cosine threshold scoring.",
                f"{len(eligible)} candidates passed similarity threshold and avoid-topic filters.",
                f"Assigned {len(new_recommendations)} new recommendations within the daily limit of {daily_limit}.",
            ],
        },
        metadata_json={
            "trigger": trigger,
            "source_scope": "GLOBAL",
            "selection_algorithm": AUTO_SELECTION_ALGORITHM,
        },
        started_at=now,
        completed_at=None,
    )
    db.add(planning_run)
    db.flush()

    candidate_records: dict[uuid.UUID, PlanningCandidate] = {}
    for rank_idx, score in enumerate(ranked, start=1):
        cand = PlanningCandidate(
            planning_run_id=planning_run.id,
            workflow_id=None,
            content_id=score.content.id,
            rank_order=rank_idx,
            score=Decimal(str(score.score)),
            selected=False,
            eligible=score.eligible,
            reason_jsonb={
                "crawl_job_id": str(job_id) if job_id else None,
                "source_scope": "GLOBAL",
                "selection_reasons": score.selection_reasons,
                "rejection_reasons": score.rejection_reasons,
            },
            metadata_json={
                **score.metadata,
                "recommended_to_profile": score.content.id in recommendation_ids,
                "daily_recommendation_limit": daily_limit,
            },
        )
        db.add(cand)
        candidate_records[score.content.id] = cand
    db.flush()
    # Persist the scored plan before any paid/remote creative call. If draft
    # generation fails later, the creator still sees the candidates and error.
    db.commit()

    created_workflows: list[str] = []
    selected_content_ids: list[str] = []
    ai_decisions: list[dict[str, Any]] = []
    if not strategy.auto_project_queue_enabled:
        output_info = dict(planning_run.output_jsonb or {})
        output_info["workflows_created"] = []
        output_info["selected_content_ids"] = []
        output_info["ai_decisions"] = []
        output_info["auto_creation_skipped_reason"] = "AUTO_PROJECT_QUEUE_DISABLED"
        planning_run.output_jsonb = output_info
        planning_run.status = "SUCCEEDED"
        planning_run.completed_at = datetime.now(timezone.utc)
        db.commit()
        return

    for score in new_recommendations:
        existing = _existing_auto_workflow(db, profile.id, score.content.id, job_id)
        if existing:
            _mark_existing_auto_workflow_link(db, profile, score, existing)
            cand = candidate_records.get(score.content.id)
            decision_payload = _workflow_ai_decision_payload(existing, score.content.id)
            if cand:
                cand.selected = True
                cand.workflow_id = existing.id
                _record_candidate_ai_decision(cand, decision_payload)
            created_workflows.append(str(existing.id))
            selected_content_ids.append(str(score.content.id))
            ai_decisions.append(decision_payload)
            db.commit()
            print(
                f"[planning-orchestrator] Skipping content {score.content.id}; auto workflow {existing.id} already exists for profile {profile.id}"
            )
            continue

        decision = planner.decide_and_build_draft(
            db,
            profile=profile,
            strategy=strategy,
            content=score.content,
            candidate_metadata=score.metadata,
        )
        _upsert_profile_content_link(db, profile, score, decision=decision)
        cand = candidate_records.get(score.content.id)
        decision_payload = {
            **_decision_payload(decision),
            "content_id": str(score.content.id),
            "candidate_id": str(cand.id) if cand else None,
        }
        if not decision.should_create_workflow:
            if cand:
                _record_candidate_ai_decision(cand, decision_payload)
            ai_decisions.append(decision_payload)
            db.commit()
            print(
                f"[planning-orchestrator] Production gate stopped auto workflow for content {score.content.id} profile {profile.id}: {decision.reason}"
            )
            continue

        workflow = _create_auto_workflow_from_decision(db, profile, strategy, score, decision, job_id)
        if not planning_run.workflow_id:
            planning_run.workflow_id = workflow.id

        created_workflows.append(str(workflow.id))
        selected_content_ids.append(str(score.content.id))
        decision_payload["workflow_id"] = str(workflow.id)
        ai_decisions.append(decision_payload)

        if cand:
            cand.selected = True
            cand.workflow_id = workflow.id
            _record_candidate_ai_decision(cand, decision_payload)

        db.commit()
        db.refresh(workflow)
        decision_quality = decision.metadata.get("quality") if isinstance(decision.metadata, dict) else {}
        if isinstance(decision_quality, dict) and decision_quality.get("status") == "PASS":
            _maybe_enqueue_auto_voice_or_render(db, workflow, workflow.draft_json or {}, trigger="auto_planning_draft_ready")
        else:
            print(
                f"[planning-orchestrator] Kept workflow {workflow.id} for review; compact draft quality did not pass"
            )
        print(
            f"[planning-orchestrator] Created auto workflow {workflow.id} for content {score.content.id} profile {profile.id}"
        )

    output_info = dict(planning_run.output_jsonb or {})
    output_info["workflows_created"] = created_workflows
    output_info["selected_content_ids"] = selected_content_ids
    output_info["ai_decisions"] = ai_decisions
    approved_decisions = [item for item in ai_decisions if item.get("should_create_workflow")]
    if approved_decisions:
        output_info["ai_decision"] = approved_decisions[0]
    elif ai_decisions:
        output_info["ai_decision"] = ai_decisions[0]
    if selected_content_ids:
        output_info["selected_content_id"] = selected_content_ids[0]
    planning_run.output_jsonb = output_info
    planning_run.status = "SUCCEEDED"
    planning_run.completed_at = datetime.now(timezone.utc)
    db.commit()


def _existing_auto_workflow(
    db: Session,
    profile_id: uuid.UUID,
    content_id: uuid.UUID,
    job_id: str | None,
) -> MediaWorkflow | None:
    rows = (
        db.query(MediaWorkflow)
        .filter(MediaWorkflow.profile_id == profile_id, MediaWorkflow.primary_content_id == content_id)
        .order_by(MediaWorkflow.created_at.desc())
        .all()
    )
    for workflow in rows:
        metadata = workflow.metadata_json if isinstance(workflow.metadata_json, dict) else {}
        if metadata.get("selection_mode") != "AUTO":
            continue
        if job_id is None or str(metadata.get("crawl_job_id") or "") == str(job_id):
            return workflow
    return None


def _create_auto_workflow_from_decision(
    db: Session,
    profile: SocialProfile,
    strategy: SocialProfileStrategy,
    score: StrategyCandidateScore,
    decision: AutoWorkflowDecision,
    job_id: str | None,
) -> MediaWorkflow:
    content = score.content
    decision_meta = decision.metadata if isinstance(decision.metadata, dict) else {}
    plan_title = str(decision_meta.get("plan_title") or content.canonical_title or "Auto workflow").strip()
    story = dict(decision.story or {})
    story.setdefault("meta", {})
    quality = decision_meta.get("quality") if isinstance(decision_meta.get("quality"), dict) else {}
    quality_passed = quality.get("status") == "PASS"
    source_job_id = str(job_id or content.crawl_job_id or "") or None
    metadata = {
        "selection_mode": "AUTO",
        "selection_algorithm": AUTO_SELECTION_ALGORITHM,
        "crawl_job_id": source_job_id,
        "content_angle": decision_meta.get("content_angle"),
        "target_audience": decision_meta.get("target_audience") or strategy.target_audience,
        "tone": decision_meta.get("tone") or strategy.tone,
        "format": decision_meta.get("format") or "EXPLAINER",
        "hook_type": decision_meta.get("hook_type"),
        "cta_mode": decision_meta.get("cta_mode"),
        "planning_mode": decision_meta.get("planning_mode") or "SINGLE",
        "target_duration_seconds": (None if story.get("meta", {}).get("draft_generation_mode") == "compact-v2"
                                    else story.get("meta", {}).get("target_duration_seconds") or 60),
        "recommended_part_count": 1,
        "confidence_score": decision.confidence_score,
        "risk_level": strategy.risk_level,
        "risk_flags": decision_meta.get("risk_flags") or [],
        "ai_reasoning": decision_meta.get("reasoning") or [decision.reason],
        "production_requirements": {"requires_voice": True, "requires_subtitles": True, "requires_background_media": True},
        "ai_decision": _decision_payload(decision),
        "production_gate": decision_meta.get("production_gate"),
        "draft_quality": quality,
        "draft_generation_mode": decision_meta.get("draft_generation_mode"),
        "prompt_version": decision_meta.get("prompt_version"),
        "token_usage": decision_meta.get("token_usage"),
        "candidate": score.metadata,
        **content_category_payload(content),
    }
    workflow = MediaWorkflow(
        user_id=profile.user_id,
        profile_id=profile.id,
        title=plan_title,
        status="EDITING",
        planning_mode=str(metadata["planning_mode"]).upper(),
        primary_content_id=content.id,
        current_stage="DRAFT_READY" if quality_passed else "DRAFT_REVIEW_REQUIRED",
        progress_percent=100 if quality_passed else 80,
        metadata_json={key: value for key, value in metadata.items() if value not in (None, "", [])},
        inputs_jsonb=[
            {
                "type": "content",
                "id": str(content.id),
                "role": "primary",
                "score": score.score,
                "embedding_similarity": score.similarity,
                "similarity_threshold": score.threshold,
                "passed_similarity_gate": score.metadata.get("passed_similarity_gate"),
                "similarity_source": score.metadata.get("similarity_source"),
                "top_topic_match": score.metadata.get("top_topic_match"),
                "eligible": score.eligible,
                **content_category_payload(content),
            }
        ],
    )
    db.add(workflow)
    db.flush()

    proposed_series_decision = decision.series_decision if isinstance(decision.series_decision, dict) else None
    series_action = str((proposed_series_decision or {}).get("action") or "NONE").upper()
    series_decision_to_apply = proposed_series_decision
    if not quality_passed and series_action in {"USE_EXISTING", "CREATE_NEW"}:
        series_decision_to_apply = None
        pending_metadata = dict(workflow.metadata_json or {})
        pending_metadata["pending_series_decision"] = proposed_series_decision
        workflow.metadata_json = pending_metadata
    series = _apply_series_decision(db, workflow, series_decision_to_apply, content)
    if series:
        workflow.series_id = series.id
        db.flush()
        sync_series_current_part(db, series)
        workflow.planning_mode = "SERIES"
        metadata = dict(workflow.metadata_json or {})
        metadata["planning_mode"] = "SERIES"
        metadata["series_decision"] = _normalized_series_decision(decision.series_decision, series)
        workflow.metadata_json = metadata
        story.setdefault("meta", {})
        story["meta"]["series_decision"] = metadata["series_decision"]
        story["meta"]["series"] = _series_context_payload(series)
    else:
        workflow.planning_mode = "SINGLE"
        metadata = dict(workflow.metadata_json or {})
        metadata["planning_mode"] = "SINGLE"
        if quality_passed and series_action in {"CREATE_NEW", "USE_EXISTING"}:
            metadata["series_decision_error"] = "SERIES_UNAVAILABLE_OR_FULL"
        workflow.metadata_json = metadata

    story.setdefault("meta", {})
    story["meta"]["workflow_id"] = str(workflow.id)
    story["meta"]["content_id"] = str(content.id)
    workflow.draft_json = story
    metadata = dict(workflow.metadata_json or {})
    if quality_passed:
        metadata["quality_script_signature"] = draft_script_signature(story)
    workflow.metadata_json = metadata
    db.add(workflow)
    return workflow


def _apply_series_decision(
    db: Session,
    workflow: MediaWorkflow,
    decision: dict[str, Any] | None,
    content: ContentItem,
) -> ContentSeries | None:
    if not decision:
        return None
    action = str(decision.get("action") or "NONE").upper()
    if action == "USE_EXISTING":
        series_id = _as_uuid(decision.get("target_series_id"))
        if not series_id:
            return None
        return lock_active_series(db, series_id, profile_id=workflow.profile_id)
    if action != "CREATE_NEW":
        return None

    title = _clean_series_title(decision.get("series_title"))
    if not title:
        return None
    lock_profile_series_scope(db, workflow.profile_id)
    existing = find_active_series_by_title(db, workflow.profile_id, title)
    if existing:
        return lock_active_series(db, existing.id, profile_id=workflow.profile_id)

    category_payload = content_category_payload(content)
    desc = decision.get("series_description") or decision.get("reason") or content.summary
    series_type = str(decision.get("series_type") or "NARRATIVE").upper()
    try:
        total_parts = max(0, int(decision.get("total_parts") or 0))
    except (TypeError, ValueError):
        total_parts = 0

    series = ContentSeries(
        user_id=workflow.user_id,
        profile_id=workflow.profile_id,
        title=title,
        description=str(desc)[:1000] if desc else None,
        series_type=series_type,
        status="ACTIVE",
        current_part=0,
        total_parts=total_parts,
        context_json={
            "version": 1,
            "created_from": "auto_planning",
            "core_theme": str(desc)[:1000] if desc else None,
            "reusable_followup_angles": decision.get("reusable_followup_angles") or [],
        },
        metadata_json={
            "created_from": "auto_planning",
            "source": "llm_series_decision",
            "source_content_id": str(content.id),
            "crawl_job_id": str(content.crawl_job_id) if content.crawl_job_id else None,
            "reason": decision.get("reason"),
            **category_payload,
        },
    )
    db.add(series)
    db.flush()
    return series





def _upsert_profile_content_link(
    db: Session,
    profile: SocialProfile,
    score: StrategyCandidateScore,
    decision: AutoWorkflowDecision | None,
    *,
    assigned_now: bool = False,
) -> ProfileContentLink:
    link = (
        db.query(ProfileContentLink)
        .filter(
            ProfileContentLink.user_id == profile.user_id,
            ProfileContentLink.profile_id == profile.id,
            ProfileContentLink.content_id == score.content.id,
            ProfileContentLink.relation_type == "CONTENT_RECOMMENDATION",
        )
        .first()
    )
    if not link:
        link = ProfileContentLink(
            user_id=profile.user_id,
            profile_id=profile.id,
            content_id=score.content.id,
            relation_type="CONTENT_RECOMMENDATION",
            source_scope=score.content.content_scope,
            status="ACTIVE",
        )
    link.status = "ACTIVE"
    link.source_scope = score.content.content_scope
    if assigned_now and link.recommended_at is None:
        link.recommended_at = datetime.now(timezone.utc)
    if score.eligible:
        link.relation_reason = "EMBEDDING_STRATEGY_MATCH"
    elif score.avoided_topics:
        link.relation_reason = "EMBEDDING_AVOID_TOPIC_MATCH"
    else:
        link.relation_reason = "EMBEDDING_LOW_MATCH"
    link.recommendation_status = _recommendation_status(score, decision)
    link.score = Decimal(str(score.score))
    link.metadata_json = {
        **(link.metadata_json if isinstance(link.metadata_json, dict) else {}),
        **score.metadata,
        "eligible_for_auto_workflow": score.eligible,
        "selection_reasons": score.selection_reasons,
        "rejection_reasons": score.rejection_reasons,
        **({"ai_decision": _decision_payload(decision)} if decision else {}),
    }
    db.add(link)
    return link


def _mark_existing_auto_workflow_link(
    db: Session,
    profile: SocialProfile,
    score: StrategyCandidateScore,
    workflow: MediaWorkflow,
) -> ProfileContentLink:
    link = _upsert_profile_content_link(db, profile, score, decision=None)
    skip_reason = f"Auto workflow already exists for this crawl job: {workflow.id}"
    existing_metadata = link.metadata_json if isinstance(link.metadata_json, dict) else {}
    selection_reasons = list(existing_metadata.get("selection_reasons") or score.selection_reasons)
    if skip_reason not in selection_reasons:
        selection_reasons.append(skip_reason)
    link.recommendation_status = (
        "REVIEW_REQUIRED" if str(workflow.current_stage or "").upper() == "DRAFT_REVIEW_REQUIRED" else "WORKFLOW_CREATED"
    )
    link.relation_reason = "AUTO_WORKFLOW_ALREADY_EXISTS"
    link.metadata_json = {
        **existing_metadata,
        "eligible_for_auto_workflow": score.eligible,
        "skipped_existing_auto_workflow_id": str(workflow.id),
        "skip_reason": skip_reason,
        "selection_reasons": selection_reasons,
        "rejection_reasons": score.rejection_reasons,
    }
    db.add(link)
    return link


def _recommendation_status(score: StrategyCandidateScore, decision: AutoWorkflowDecision | None) -> str:
    if decision and decision.should_create_workflow:
        metadata = decision.metadata if isinstance(decision.metadata, dict) else {}
        return "WORKFLOW_CREATED" if metadata.get("status") == "AI_APPROVED" else "REVIEW_REQUIRED"
    if decision and not decision.should_create_workflow:
        metadata = decision.metadata if isinstance(decision.metadata, dict) else {}
        return "REVIEW_REQUIRED" if metadata.get("status") == "REVIEW_REQUIRED" else "AI_REJECTED"
    if score.avoided_topics:
        return "AVOID_TOPIC_MATCH"
    return "RECOMMENDED" if score.eligible else "LOW_MATCH"


def _record_candidate_ai_decision(candidate: PlanningCandidate, decision_payload: dict[str, Any]) -> None:
    metadata = dict(candidate.metadata_json or {})
    metadata["ai_decision"] = decision_payload
    candidate.metadata_json = metadata

    reason = dict(candidate.reason_jsonb or {})
    reason["ai_decision"] = decision_payload
    selection_reasons = list(reason.get("selection_reasons") or [])
    rejection_reasons = list(reason.get("rejection_reasons") or [])
    llm_reason = str(decision_payload.get("reason") or decision_payload.get("error_message") or "").strip()
    if decision_payload.get("should_create_workflow"):
        note = f"Production gate approved auto workflow: {llm_reason}" if llm_reason else "Production gate approved auto workflow."
        if note not in selection_reasons:
            selection_reasons.append(note)
    else:
        note = f"Production gate stopped auto workflow: {llm_reason}" if llm_reason else "Production gate stopped auto workflow."
        if note not in rejection_reasons:
            rejection_reasons.append(note)
    reason["selection_reasons"] = selection_reasons
    reason["rejection_reasons"] = rejection_reasons
    candidate.reason_jsonb = reason


def _workflow_ai_decision_payload(workflow: MediaWorkflow, content_id: uuid.UUID | None = None) -> dict[str, Any]:
    metadata = workflow.metadata_json if isinstance(workflow.metadata_json, dict) else {}
    decision = metadata.get("ai_decision") if isinstance(metadata.get("ai_decision"), dict) else {}
    return {
        **decision,
        "status": decision.get("status") or "WORKFLOW_ALREADY_EXISTS",
        "should_create_workflow": bool(decision.get("should_create_workflow", True)),
        "reason": decision.get("reason") or "Auto workflow already exists for this content and crawl job.",
        "confidence_score": decision.get("confidence_score") or metadata.get("confidence_score"),
        "provider": decision.get("provider"),
        "model": decision.get("model"),
        "workflow_id": str(workflow.id),
        "content_id": str(content_id or workflow.primary_content_id) if (content_id or workflow.primary_content_id) else None,
        "plan_title": decision.get("plan_title") or workflow.title,
        "content_angle": decision.get("content_angle") or metadata.get("content_angle"),
        "planning_mode": decision.get("planning_mode") or metadata.get("planning_mode"),
        "risk_flags": decision.get("risk_flags") or metadata.get("risk_flags") or [],
        "reasoning": decision.get("reasoning") or metadata.get("ai_reasoning") or [],
        "series_decision": decision.get("series_decision") or metadata.get("series_decision"),
        "production_gate": decision.get("production_gate") or metadata.get("production_gate"),
        "quality": decision.get("quality") or metadata.get("draft_quality"),
        "format": decision.get("format") or metadata.get("format"),
        "token_usage": decision.get("token_usage") or metadata.get("token_usage"),
        "error_message": decision.get("error_message"),
    }


def _decision_payload(decision: AutoWorkflowDecision | None) -> dict[str, Any]:
    if not decision:
        return {}
    metadata = decision.metadata if isinstance(decision.metadata, dict) else {}
    return {
        "status": metadata.get("status"),
        "should_create_workflow": decision.should_create_workflow,
        "reason": decision.reason,
        "confidence_score": decision.confidence_score,
        "provider": decision.provider,
        "model": decision.model,
        "plan_title": metadata.get("plan_title"),
        "content_angle": metadata.get("content_angle"),
        "target_audience": metadata.get("target_audience"),
        "tone": metadata.get("tone"),
        "planning_mode": metadata.get("planning_mode"),
        "risk_flags": metadata.get("risk_flags") or [],
        "reasoning": metadata.get("reasoning") or [],
        "series_decision": decision.series_decision,
        "production_gate": metadata.get("production_gate"),
        "quality": metadata.get("quality"),
        "format": metadata.get("format"),
        "hook_type": metadata.get("hook_type"),
        "cta_mode": metadata.get("cta_mode"),
        "token_usage": metadata.get("token_usage"),
        "error_message": decision.error_message,
    }


def _normalized_series_decision(decision: dict[str, Any] | None, series: ContentSeries) -> dict[str, Any]:
    raw = decision if isinstance(decision, dict) else {}
    return {
        "action": str(raw.get("action") or "USE_EXISTING").upper(),
        "target_series_id": str(series.id),
        "series_title": series.title,
        "reason": raw.get("reason"),
    }


def _series_context_payload(series: ContentSeries) -> dict[str, Any]:
    metadata = series.metadata_json if isinstance(series.metadata_json, dict) else {}
    category_id = metadata.get("category_id") or metadata.get("categoryId")
    return {
        "id": str(series.id),
        "title": series.title,
        "description": series.description,
        "series_type": series.series_type,
        "status": series.status,
        "current_part": int(series.current_part or 0),
        "total_parts": int(series.total_parts or 0),
        "category_id": category_id,
        "categoryId": category_id,
        "category": metadata.get("category"),
        "context_json": series.context_json or {},
    }


def _clean_series_title(value: Any) -> str | None:
    title = " ".join(str(value or "").split()).strip()
    return title[:180] if title else None


def _as_uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None
