from datetime import datetime, timezone
import uuid

from fastapi import HTTPException

from common.db.models import ContentItem, KafkaTask, PlanningCandidate, PlanningRun, SocialProfile
from common.planning.candidate_review import (
    REVIEW_TASK_TYPE, as_dict, candidate_decision, content_available_to_profile, review_state,
    sync_review_recommendation,
)


def owned_candidate(db, user, run_id, candidate_id, *, lock=False):
    run = db.get(PlanningRun, run_id)
    if not run or (not user.is_system_admin and run.user_id != user.id):
        raise HTTPException(404, "Planning run not found")
    query = db.query(PlanningCandidate).filter(
        PlanningCandidate.id == candidate_id, PlanningCandidate.planning_run_id == run.id,
    )
    candidate = (query.with_for_update() if lock else query).first()
    if not candidate:
        raise HTTPException(404, "Planning candidate not found")
    return run, candidate


def review_candidate(db, user, run_id, candidate_id, action, reason):
    run, candidate = owned_candidate(db, user, run_id, candidate_id, lock=True)
    decision = candidate_decision(candidate, run.output_jsonb)
    state = review_state(candidate, decision, auto=run.planning_mode == "AUTO")
    metadata = dict(candidate.metadata_json or {})
    previous = as_dict(metadata.get("production_review"))
    # Network retries/double-clicks return the previous operation, never enqueue again.
    if action == previous.get("action") and previous.get("status"):
        return {"candidate_id": str(candidate.id), "workflow_id": str(candidate.workflow_id) if candidate.workflow_id else None, "review": state}
    if action == "RETRY" and previous.get("status") in {"QUEUED", "COMPLETED"} and previous.get("action") == "APPROVE":
        return {"candidate_id": str(candidate.id), "workflow_id": str(candidate.workflow_id) if candidate.workflow_id else None, "review": state}
    if not state.get({"APPROVE": "can_approve", "REJECT": "can_reject", "RETRY": "can_retry"}[action]):
        raise HTTPException(409, "Bài không còn chờ duyệt sản xuất, đang xử lý hoặc đã có workflow. Hãy tải lại plan.")

    now = datetime.now(timezone.utc)
    review = {**previous, "action": "REJECT" if action == "REJECT" else "APPROVE",
              "status": "REJECTED" if action == "REJECT" else "QUEUED",
              "reviewed_by": str(user.id), "reviewed_at": now.isoformat(),
              "reason": reason.strip(), "error_message": None}
    if previous:
        metadata["production_review_history"] = [*(metadata.get("production_review_history") or []), previous]
    if action != "REJECT":
        profile = db.get(SocialProfile, run.profile_id)
        content = db.get(ContentItem, candidate.content_id)
        if not profile or profile.user_id != run.user_id or profile.status != "active" or not profile.strategy:
            raise HTTPException(409, "Profile không còn hoạt động hoặc chưa có chiến lược.")
        if not content_available_to_profile(content, run.user_id):
            raise HTTPException(404, "Nội dung nguồn không còn khả dụng cho profile này.")
        if content.status not in {"READY", "USABLE_WITH_WARNING"}:
            raise HTTPException(409, "Nội dung nguồn không còn sẵn sàng để sinh draft.")
        task = db.query(KafkaTask).filter(KafkaTask.idempotency_key == f"candidate-review:{candidate.id}").first()
        if task and (action != "RETRY" or task.status != "FAILED"):
            raise HTTPException(409, "Job của ứng viên đã tồn tại. Hãy tải lại plan.")
        if not task:
            task = KafkaTask(id=uuid.uuid4(), task_type=REVIEW_TASK_TYPE,
                             reference_type="planning_candidate", reference_id=candidate.id,
                             profile_id=run.profile_id, idempotency_key=f"candidate-review:{candidate.id}",
                             attempt_count=0, max_attempts=1)
        task.status = "PENDING"
        task.current_stage = "QUEUED_DRAFT"
        task.started_at = task.completed_at = task.error_message = None
        task.progress_percent = 0
        task.result_jsonb = {}
        review["task_id"] = str(task.id)
        task.payload_jsonb = {"planning_run_id": str(run.id), "candidate_id": str(candidate.id), "review": review.copy()}
        db.add(task)
    metadata["production_review"] = review
    candidate.metadata_json = metadata
    sync_review_recommendation(db, candidate, run, review)
    db.add(candidate)
    db.commit()
    return {"candidate_id": str(candidate.id), "workflow_id": None,
            "review": review_state(candidate, decision, auto=True)}
