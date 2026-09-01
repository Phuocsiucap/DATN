"""Durable DB queue for approved candidates; no Kafka delivery is required.

A row lock spans generation and saving, so another worker skips the same job.
A process crash rolls the transaction back to PENDING. A handled failure is
FAILED and needs an explicit user retry, never an automatic paid retry loop.
"""
import logging
import time
from datetime import datetime, timezone

from common.db.content_series import lock_profile_series_scope
from common.db.models import ContentItem, KafkaTask, MediaWorkflow, PlanningCandidate, PlanningRun, SocialProfile
from common.db.session import SessionLocal
from common.planning.candidate_review import REVIEW_TASK_TYPE, as_dict, content_available_to_profile, sync_review_recommendation
from common.planning.embedding_matcher import StrategyEmbeddingMatcher
from app.planning.services.auto_workflow_planner import AutoWorkflowPlanner
from app.planning.consumers.crawl_job_completed import (
    _create_auto_workflow_from_decision, _existing_auto_workflow,
    _mark_existing_auto_workflow_link, _workflow_ai_decision_payload,
)
from app.video.services.generate_video_jobs import _maybe_enqueue_auto_voice_or_render

logger = logging.getLogger(__name__)


def _save_review(candidate, **changes):
    metadata = dict(candidate.metadata_json or {})
    metadata["production_review"] = {**as_dict(metadata.get("production_review")), **changes}
    candidate.metadata_json = metadata


def _generate_reviewed_draft(db, task, candidate):
    run = db.get(PlanningRun, candidate.planning_run_id)
    profile = db.get(SocialProfile, run.profile_id) if run else None
    content = db.get(ContentItem, candidate.content_id) if candidate.content_id else None
    review = as_dict(as_dict(candidate.metadata_json).get("production_review"))
    if not run or run.planning_mode != "AUTO" or not profile or profile.user_id != run.user_id or profile.status != "active" or not profile.strategy:
        raise ValueError("Profile hoặc planning run không còn khả dụng.")
    if not content_available_to_profile(content, run.user_id):
        raise ValueError("Nội dung nguồn không còn khả dụng cho profile này.")
    if review.get("action") != "APPROVE" or review.get("status") != "QUEUED" or review.get("task_id") != str(task.id):
        raise ValueError("Quyết định duyệt không khớp job hiện tại.")
    if task.profile_id != run.profile_id or str(as_dict(task.payload_jsonb).get("planning_run_id")) != str(run.id):
        raise ValueError("Job không thuộc planning run/profile này.")
    score = StrategyEmbeddingMatcher().score_candidate(db, content, profile.strategy)
    if not score.eligible:
        raise ValueError("Nguồn không còn vượt bộ lọc chủ đề/video hiện tại. Hãy kiểm tra lại cấu hình và nguồn.")
    source_job_id = str(run.crawl_job_id) if run.crawl_job_id else None
    workflow = db.get(MediaWorkflow, candidate.workflow_id) if candidate.workflow_id else _existing_auto_workflow(db, profile.id, content.id, source_job_id)
    decision = None
    if not workflow:
        decision = AutoWorkflowPlanner().decide_and_build_draft(
            db, profile=profile, strategy=profile.strategy, content=content,
            candidate_metadata=score.metadata, production_review=review,
        )
        if not decision.should_create_workflow:
            raise ValueError(decision.error_message or decision.reason or "Không sinh được draft.")
        # Serialize saving for the same profile, including series allocation.
        lock_profile_series_scope(db, profile.id)
        workflow = _existing_auto_workflow(db, profile.id, content.id, source_job_id)
        if not workflow:
            workflow = _create_auto_workflow_from_decision(db, profile, profile.strategy, score, decision, source_job_id)
            workflow.metadata_json = {**as_dict(workflow.metadata_json), "production_review": review,
                                      "planning_candidate_id": str(candidate.id)}
    if workflow.user_id != run.user_id or workflow.profile_id != run.profile_id or workflow.primary_content_id != content.id:
        raise ValueError("Workflow liên kết không thuộc ứng viên này.")
    candidate.workflow_id = workflow.id
    candidate.selected = True
    metadata = dict(candidate.metadata_json or {})
    metadata["review_decision"] = _workflow_ai_decision_payload(workflow, content.id)
    candidate.metadata_json = metadata
    _save_review(candidate, status="COMPLETED", error_message=None)
    link = _mark_existing_auto_workflow_link(db, profile, score, workflow)
    link.metadata_json = {**as_dict(link.metadata_json), "ai_decision": metadata["review_decision"], "production_review": as_dict(candidate.metadata_json).get("production_review")}
    locked_run = db.query(PlanningRun).filter(PlanningRun.id == run.id).with_for_update().first()
    if not locked_run.workflow_id:
        locked_run.workflow_id = workflow.id
    locked_run.updated_at = datetime.now(timezone.utc)
    # Keep the original planning decision/output intact; the read API joins the
    # candidate's current workflow and exposes the separate human review.
    db.add_all([candidate, workflow])
    task.result_jsonb = {"workflow_id": str(workflow.id)}
    task.current_stage = "DRAFT_SAVED"
    task.status = "PENDING"
    task.progress_percent = 90


def process_next_candidate_review(db) -> bool:
    task = (db.query(KafkaTask).filter(KafkaTask.task_type == REVIEW_TASK_TYPE, KafkaTask.status == "PENDING")
            .order_by(KafkaTask.created_at).with_for_update(skip_locked=True).first())
    if not task:
        return False
    candidate = db.get(PlanningCandidate, task.reference_id)
    try:
        if not candidate:
            raise ValueError("Ứng viên không còn tồn tại.")
        if task.current_stage == "DRAFT_SAVED":
            workflow = db.query(MediaWorkflow).filter(MediaWorkflow.id == candidate.workflow_id).with_for_update().first()
            if not workflow:
                raise ValueError("Workflow vừa sinh không còn khả dụng.")
            task.status, task.current_stage = "COMPLETED", "COMPLETED"
            task.completed_at = datetime.now(timezone.utc)
            task.progress_percent = 100
            # This continuation is durable: a crash after saving the draft does
            # not require generating it again. The existing quality guard applies.
            if as_dict(as_dict(workflow.metadata_json).get("draft_quality")).get("status") == "PASS":
                _maybe_enqueue_auto_voice_or_render(db, workflow, workflow.draft_json or {}, trigger="candidate_review_draft_ready")
        else:
            task.attempt_count = int(task.attempt_count or 0) + 1
            task.started_at = datetime.now(timezone.utc)
            # Roll back any partially created series/workflow on a handled error,
            # while retaining the job lock for recording its failure atomically.
            with db.begin_nested():
                _generate_reviewed_draft(db, task, candidate)
        db.add(task)
        db.commit()
    except Exception as exc:
        logger.exception("Candidate review job %s failed", task.id)
        message = str(exc)[:2000]
        task.status, task.current_stage = "FAILED", "FAILED"
        task.error_message = message
        task.completed_at = datetime.now(timezone.utc)
        if candidate:
            _save_review(candidate, status="COMPLETED" if candidate.workflow_id else "FAILED", error_message=message)
            run = db.get(PlanningRun, candidate.planning_run_id)
            if run:
                sync_review_recommendation(db, candidate, run, as_dict(candidate.metadata_json).get("production_review", {}))
            db.add(candidate)
        db.add(task)
        db.commit()
    return True


def run_candidate_review_worker():
    while True:
        with SessionLocal() as db:
            processed = process_next_candidate_review(db)
        if not processed:
            time.sleep(2)
