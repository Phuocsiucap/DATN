"""Shared policy for reviewing a production decision, NOT approving a draft."""
from typing import Any

REVIEW_TASK_TYPE = "PLANNING_REVIEW_DRAFT"


def as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def candidate_decision(candidate: Any, output: dict | None = None) -> dict:
    for parent in (candidate.reason_jsonb, candidate.metadata_json):
        decision = as_dict(as_dict(parent).get("ai_decision"))
        if decision:
            return decision
    output = as_dict(output)
    values = output.get("ai_decisions")
    for value in [*(values if isinstance(values, list) else []), output.get("ai_decision")]:
        decision = as_dict(value)
        if decision.get("candidate_id"):
            if str(decision["candidate_id"]) == str(candidate.id):
                return decision
        elif candidate.content_id and str(decision.get("content_id")) == str(candidate.content_id):
            return decision
    return {}


def needs_production_review(candidate: Any, decision: dict) -> bool:
    return bool(
        candidate.eligible and not candidate.selected
        and not candidate.workflow_id and not decision.get("workflow_id")
        and not decision.get("should_create_workflow") and not decision.get("quality")
        and as_dict(decision.get("production_gate")).get("status") == "REVIEW_REQUIRED"
    )


def review_state(candidate: Any, decision: dict, *, auto: bool = True) -> dict:
    review = as_dict(as_dict(candidate.metadata_json).get("production_review"))
    status = review.get("status")
    eligible = auto and needs_production_review(candidate, decision)
    return {
        **{key: review.get(key) for key in (
            "status", "action", "reviewed_by", "reviewed_at", "reason", "task_id", "error_message",
        )},
        "can_approve": eligible and bool(candidate.content_id) and not status,
        "can_reject": eligible and status in (None, "FAILED"),
        "can_retry": eligible and bool(candidate.content_id) and status == "FAILED" and review.get("action") == "APPROVE",
        "original_production": (as_dict(decision.get("production_gate")) or None) if review else None,
    }


def content_available_to_profile(content: Any, owner_id: Any) -> bool:
    return bool(content and (
        content.content_scope == "GLOBAL"
        or (content.content_scope == "PRIVATE" and content.owner_user_id == owner_id)
    ))


def sync_review_recommendation(db, candidate, run, review):
    from common.db.models import ProfileContentLink

    if not candidate.content_id:
        return
    link = db.query(ProfileContentLink).filter(
        ProfileContentLink.user_id == run.user_id, ProfileContentLink.profile_id == run.profile_id,
        ProfileContentLink.content_id == candidate.content_id,
        ProfileContentLink.relation_type == "CONTENT_RECOMMENDATION",
    ).first()
    if not link or as_dict(as_dict(link.metadata_json).get("ai_decision")).get("should_create_workflow"):
        return  # Do not overwrite the outcome of a newer, already-produced run.
    statuses = {"QUEUED": "DRAFT_QUEUED", "FAILED": "DRAFT_FAILED", "REJECTED": "HUMAN_REJECTED"}
    if review.get("status") in statuses:
        link.recommendation_status = statuses[review["status"]]
        link.metadata_json = {**as_dict(link.metadata_json), "production_review": review}
        db.add(link)
