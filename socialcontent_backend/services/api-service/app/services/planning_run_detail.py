"""Normalize historical planning JSON into a compact, non-mutating read model."""

from collections import Counter
import html
from math import isfinite
from typing import Any
import uuid

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.schemas.planning_run_detail import CandidateDetail, PlanningRunCompactResponse, PlanningRunDetailResponse
from app.schemas.planning_run_detail import PlanningCandidateDiagnosticsResponse
from app.services.planning_candidate_review import owned_candidate
from common.db.media_workflows import _load_content_full_text
from common.db.models import (
    ContentItem,
    ContentSeries,
    CrawlJob,
    MediaWorkflow,
    PlanningCandidate,
    PlanningRun,
    SocialProfile,
    User,
)
from common.planning.candidate_review import candidate_decision, review_state
from common.planning.candidate_review import content_available_to_profile

REASON_CODE_LABELS: dict[str, str] = {
    "HIGH_CONFIDENCE_MATCH": "Bài phù hợp rõ ràng với chủ đề kênh, đủ dữ kiện và chất lượng để sản xuất tự động.",
    "BORDERLINE_MATCH": "Bài nằm ở ranh giới phù hợp; hệ thống cần thêm đánh giá.",
    "BELOW_SIMILARITY_THRESHOLD": "Nội dung bài không đủ liên quan đến chủ đề kênh.",
    "AVOID_TOPIC": "Bài chứa chủ đề bị cấm hoặc cần tránh theo cấu hình kênh.",
    "LOW_TOPIC_SIMILARITY": "Nội dung bài không khớp với bất kỳ chủ đề nào của kênh.",
    "VIDEO_REQUIRED": "Kênh yêu cầu bài có video nguồn, nhưng bài này không có.",
    "CONTENT_NOT_READY": "Bài nguồn chưa sẵn sàng để sử dụng (đang chờ xử lý hoặc có lỗi).",
    "INSUFFICIENT_SOURCE": "Bài nguồn có ít hơn 3 dữ kiện xác minh được, chưa đủ cơ sở để tự động sản xuất.",
    "FIT_JUDGE_ERROR": "Hệ thống gặp lỗi khi đánh giá bài; cần người dùng xem lại.",
    "FIT_JUDGE_UNCERTAIN": "Hệ thống chưa đủ chắc chắn để tự quyết định; cần người dùng xem lại.",
    "CONFLICTING_INFO": "Bài chứa thông tin mâu thuẫn giữa các nguồn; cần người dùng kiểm tra tính xác thực.",
    "CONFLICTING_CONTENT": "Nội dung bài có các thông tin đối lập nhau; cần người dùng xác minh trước khi sản xuất.",
    "SENSITIVE_CONTENT": "Bài chứa nội dung nhạy cảm (y tế, pháp luật, tài chính...); cần người dùng duyệt.",
    "HUMAN_APPROVED": "Người dùng đã cho phép sản xuất bài này.",
    "HUMAN_REJECTED": "Người dùng đã quyết định không sản xuất bài này.",
    "MISSING_REQUIRED_VIDEO": "Bài nguồn thiếu video bắt buộc theo cấu hình kênh.",
}
TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "CANCELLED", "WAITING_REVIEW"}


def as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def strings(value: Any) -> list[str]:
    return list(dict.fromkeys(str(item) for item in value if item not in (None, ""))) if isinstance(value, list) else []


def number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if isfinite(result) else None
    except (TypeError, ValueError):
        return None


def stored_decision(row: Any, output: dict) -> dict:
    """Candidate snapshots take precedence; output is a legacy fallback only."""
    return candidate_decision(row, output)


class TopicCatalog:
    def __init__(self) -> None:
        self.definitions: list[dict] = []
        self.ids: dict[tuple, str] = {}

    def score(self, raw: dict, kind: str, *, matched: bool = False) -> dict | None:
        name = str(raw.get("topic") or "").strip()
        if not name:
            return None
        key = raw.get("topic_key") or None
        description = raw.get("description") or None
        identity = (kind, name, key, description)
        if identity not in self.ids:
            topic_id = f"t{len(self.definitions) + 1}"
            self.ids[identity] = topic_id
            self.definitions.append({"id": topic_id, "kind": kind, "name": name, "key": key, "description": description})
        return {
            "topic_id": self.ids[identity],
            "similarity": number(raw.get("similarity")),
            "threshold": number(raw.get("threshold")),
            "matched": raw.get("matched") if isinstance(raw.get("matched"), bool) else matched,
            "source": raw.get("match_source"),
        }


def _matching(row: Any, catalog: TopicCatalog) -> dict:
    metadata = as_dict(row.metadata_json)
    breakdown = as_dict(metadata.get("score_breakdown"))
    reason = as_dict(row.reason_jsonb)

    def value(key: str, fallback: Any = None) -> Any:
        item = metadata.get(key)
        return breakdown.get(key, fallback) if item is None else item

    def scores(kind: str) -> list[dict]:
        raw = value("topic_scores") if kind == "CONTENT" else value("avoid_topic_matches")
        matches_only = kind == "AVOID" or not isinstance(raw, list)
        if not isinstance(raw, list):
            raw = value("topic_matches", []) if kind == "CONTENT" else []
        result = [item for entry in raw if isinstance(entry, dict) and (item := catalog.score(entry, kind, matched=matches_only))] if isinstance(raw, list) else []
        names = {str(entry.get("topic")) for entry in raw if isinstance(entry, dict)} if isinstance(raw, list) else set()
        # Keyword-only legacy gates still need to explain why a topic blocked an item.
        for name in strings(value("matched_topics" if kind == "CONTENT" else "avoided_topics")):
            if name not in names:
                result.append(catalog.score({"topic": name}, kind, matched=True))
                names.add(name)
        return result

    return {
        "eligible": bool(row.eligible),
        "score": number(row.score) or 0,
        "source_quality_score": number(value("quality_score")),
        "similarity": number(value("embedding_similarity", value("cosine_similarity"))),
        "similarity_threshold": number(value("similarity_threshold")),
        "avoid_threshold": number(value("avoid_similarity_threshold")),
        "passed_similarity_gate": value("passed_similarity_gate"),
        "blocked_by_avoid_topics": value("blocked_by_avoid_topics"),
        "require_video": value("require_video"),
        "has_required_video": value("has_required_video"),
        "embedding_model": value("embedding_model"),
        "source": value("similarity_source", value("vector_source")),
        "topics": scores("CONTENT"),
        "avoid_topics": scores("AVOID"),
        "selection_reasons": strings(reason.get("selection_reasons")),
        "rejection_reasons": strings(reason.get("rejection_reasons")),
    }


def _decision(raw: dict) -> dict | None:
    if not raw:
        return None
    production = as_dict(raw.get("production_gate"))
    quality = as_dict(raw.get("quality"))
    series = as_dict(raw.get("series_decision"))
    has_draft = bool(quality or raw.get("plan_title") or raw.get("content_angle"))
    return {
        "status": raw.get("status"),
        "production": production or None,
        "draft": {
            "title": raw.get("plan_title"),
            "angle": raw.get("content_angle"),
            "format": raw.get("format"),
            "hook_type": raw.get("hook_type"),
            "cta_mode": raw.get("cta_mode"),
            "tone": raw.get("tone"),
            "target_audience": raw.get("target_audience"),
            "confidence_score": number(raw.get("confidence_score")),
            "quality": quality or None,
            "risk_flags": [flag if isinstance(flag, dict) else {"type": str(flag)} for flag in (raw.get("risk_flags") or [])],
        } if has_draft else None,
        "series": {
            "action": series.get("action"),
            "target_series_id": series.get("target_series_id"),
            "title": series.get("series_title"),
            "description": series.get("series_description"),
            "series_type": series.get("series_type"),
            "total_parts": series.get("total_parts"),
            "reason": series.get("reason"),
            "followup_angles": strings(series.get("reusable_followup_angles")),
        } if series else None,
        "provider": raw.get("provider"),
        "model": raw.get("model"),
        # Missing accounting is unknown, not zero calls/tokens.
        "token_usage": as_dict(raw.get("token_usage")) or None,
        "error_message": raw.get("error_message"),
        "legacy_reason": raw.get("reason") if not production else None,
        "notes": [note for note in strings(raw.get("reasoning")) if note not in (production.get("reason_code"), production.get("reason"), raw.get("reason"))],
    }


def _workflow_decision(workflow: Any) -> dict:
    metadata = as_dict(workflow.metadata_json)
    stored = as_dict(metadata.get("ai_decision"))
    result = {
        "status": "WORKFLOW_CREATED",
        "plan_title": workflow.title,
        "quality": metadata.get("draft_quality"),
        "series_decision": metadata.get("series_decision") or metadata.get("pending_series_decision"),
        "reasoning": metadata.get("ai_reasoning"),
        **{key: metadata.get(key) for key in ("production_gate", "token_usage", "content_angle", "tone", "format", "target_audience", "risk_flags", "confidence_score")},
    }
    result.update({key: value for key, value in stored.items() if value is not None})
    return result


def build_planning_run_detail(run: Any, profile: Any, crawl_job: Any, candidates: list, workflows: list) -> PlanningRunDetailResponse:
    output = as_dict(run.output_jsonb)
    metadata = as_dict(run.metadata_json)
    reason = as_dict(run.reason_jsonb)
    inputs = as_dict(run.input_jsonb)
    catalog = TopicCatalog()
    by_id = {str(item.id): item for item in workflows}
    by_candidate_id = {str(item.planning_candidate_id): item for item in workflows if getattr(item, "planning_candidate_id", None)}
    # Only unique content-to-workflow mappings are safe as a legacy fallback.
    by_content: dict[str, list] = {}
    for workflow in workflows:
        if workflow.primary_content_id:
            by_content.setdefault(str(workflow.primary_content_id), []).append(workflow)
    items = []
    for row in candidates:
        raw = stored_decision(row, output)
        workflow = by_candidate_id.get(str(row.id))
        workflow_id = str(workflow.id) if workflow else raw.get("workflow_id")
        workflow = workflow or (by_id.get(str(workflow_id)) if workflow_id else None)
        if not workflow_id and row.content_id:
            matches = by_content.get(str(row.content_id), [])
            if len(matches) == 1:
                workflow = matches[0]
                workflow_id = str(workflow.id)
        if not raw and workflow:
            raw = _workflow_decision(workflow)
        review = review_state(row, raw, auto=run.planning_mode == "AUTO")
        current_decision = as_dict(as_dict(row.metadata_json).get("review_decision")) or raw
        if review["status"] in {"QUEUED", "FAILED"}:
            current_decision = {"status": "DRAFT_QUEUED" if review["status"] == "QUEUED" else "DRAFT_FAILED",
                                "error_message": review.get("error_message"), "production_gate": {
                "status": "PRODUCE", "source": "HUMAN", "reason_code": "HUMAN_APPROVED",
                "reason": "Người dùng đã cho phép sinh draft; chưa phải phê duyệt chất lượng draft.",
            }}
        if review["status"] == "REJECTED":
            current_decision = {"status": "PRODUCTION_REJECTED", "production_gate": {
                "status": "SKIP", "source": "HUMAN", "reason_code": "HUMAN_REJECTED",
                "reason": review.get("reason") or "Người dùng quyết định không sản xuất bài này.",
            }}
        items.append({
            "id": str(row.id), "content_id": str(row.content_id) if row.content_id else None,
            "title": row.canonical_title, "summary": row.summary, "rank": row.rank_order,
            "selected": bool(row.selected), "workflow_id": str(workflow_id) if workflow_id else None,
            "matching": _matching(row, catalog), "decision": _decision(current_decision), "review": review,
        })

    return PlanningRunDetailResponse.model_validate({
        "id": str(run.id),
        "profile": {"id": str(profile.id), "name": profile.profile_name} if profile else None,
        "crawl_job": {"id": str(crawl_job.id), "name": crawl_job.name} if crawl_job else None,
        "planning_mode": run.planning_mode, "status": run.status,
        "trigger": metadata.get("trigger") or reason.get("trigger"),
        "algorithm": metadata.get("selection_algorithm"),
        "similarity_threshold": number(inputs.get("strategy_similarity_threshold")),
        "error_code": metadata.get("error_code"), "error_message": metadata.get("error_message"),
        **{key: getattr(run, key) for key in ("started_at", "completed_at", "created_at", "updated_at")},
        "summary": {
            "candidate_count": len(items),
            "eligible_count": sum(item["matching"]["eligible"] for item in items),
            "filtered_count": sum(not item["matching"]["eligible"] for item in items),
            "selected_count": sum(item["selected"] for item in items),
            "workflow_count": len(workflows),
            "production": dict(Counter(production["status"] for item in items if (production := as_dict(as_dict(item["decision"]).get("production"))).get("status"))),
            "draft_quality": dict(Counter(quality["status"] for item in items if (quality := as_dict(as_dict(as_dict(item["decision"]).get("draft")).get("quality"))).get("status"))),
        },
        "topics": catalog.definitions,
        "candidates": items,
        "workflows": [{
            "id": str(workflow.id), "title": workflow.title, "status": workflow.status,
            "current_stage": workflow.current_stage, "updated_at": workflow.updated_at,
            "series": {"id": str(workflow.series_id), "name": workflow.series_title} if workflow.series_id else None,
            "pending_series": bool(as_dict(workflow.metadata_json).get("pending_series_decision")),
            "series_error": as_dict(workflow.metadata_json).get("series_decision_error"),
        } for workflow in workflows],
    })


def _brief_reason(candidate: CandidateDetail, topics: dict[str, str]) -> tuple[str, str | None]:
    """Explain stored results with deterministic text, never another AI call."""
    matching, decision, review = candidate.matching, candidate.decision, candidate.review
    if review.status == "REJECTED":
        return review.reason or "Người dùng quyết định không sản xuất bài này.", "HUMAN_REJECTED"
    if review.status == "QUEUED":
        return "Đã duyệt bài nguồn; job đang chờ hoặc đang sinh draft.", "HUMAN_APPROVED"
    if review.status == "FAILED":
        return review.error_message or "Sinh draft sau khi duyệt bị lỗi; có thể thử lại.", "DRAFT_FAILED"
    if not matching.eligible:
        reasons, codes = [], []
        if matching.blocked_by_avoid_topics:
            names = [topics[score.topic_id] for score in matching.avoid_topics if score.matched and score.topic_id in topics]
            reasons.append("Khớp chủ đề tránh" + (": " + ", ".join(names) if names else "") + ".")
            codes.append("AVOID_TOPIC")
        if matching.require_video and matching.has_required_video is False:
            reasons.append("Bài nguồn thiếu video bắt buộc.")
            codes.append("MISSING_REQUIRED_VIDEO")
        if matching.similarity is not None and matching.similarity_threshold is not None and matching.similarity < matching.similarity_threshold:
            reasons.append(f"Độ khớp {matching.similarity:.4f} dưới ngưỡng {matching.similarity_threshold:g}.")
            codes.append("BELOW_SIMILARITY_THRESHOLD")
        if reasons:
            return " ".join(reasons), "+".join(codes)
        return next(iter(matching.rejection_reasons), "Không qua bộ lọc đầu vào; mở chi tiết để xem dữ liệu đã ghi nhận."), "FILTERED"
    if decision:
        if decision.error_message:
            return decision.error_message, decision.status
        quality = decision.draft.quality if decision.draft else None
        if quality and quality.status == "REVIEW_REQUIRED":
            issues = [issue.message or issue.code for issue in quality.issues]
            return "Draft cần duyệt: " + ("; ".join(issues) if issues else "chưa đạt điều kiện chạy tiếp."), "DRAFT_REVIEW_REQUIRED"
        if quality and quality.status == "PASS":
            score = f" ({quality.score:g}/100)" if quality.score is not None else ""
            retry = f"; đã sửa {quality.retry_count:g} lần" if quality.retry_count is not None else ""
            return f"Draft đạt kiểm tra{score}{retry}. Trạng thái sản xuất xem ở workflow.", "DRAFT_PASSED"
        if decision.production:
            code = decision.production.reason_code
            human_reason = REASON_CODE_LABELS.get(code or "") or decision.production.reason
            if human_reason:
                return human_reason, code
        if decision.legacy_reason:
            return decision.legacy_reason, decision.status
    return "Qua bộ lọc đầu vào; chưa có kết quả quyết định sản xuất được lưu.", None


def compact_planning_run_detail(detail: PlanningRunDetailResponse) -> PlanningRunCompactResponse:
    """Lossless diagnostics remain opt-in; the overview keeps every candidate."""
    topics = {topic.id: topic.name for topic in detail.topics}
    candidates = []
    for item in detail.candidates:
        reason, reason_code = _brief_reason(item, topics)
        status = item.decision.status if item.decision and item.decision.status else "ELIGIBLE" if item.matching.eligible else "FILTERED"
        review = item.review
        candidates.append({
            "id": item.id, "content_id": item.content_id, "title": item.title, "rank": item.rank,
            "status": status, "reason": reason[:397] + "..." if len(reason) > 400 else reason,
            "reason_code": reason_code, "reason_code_label": REASON_CODE_LABELS.get(reason_code or "", None),
            "similarity": item.matching.similarity, "workflow_id": item.workflow_id,
            "review": review if review.status or review.can_approve or review.can_reject or review.can_retry else None,
        })
    return PlanningRunCompactResponse.model_validate({
        **detail.model_dump(exclude={"schema_version", "topics", "candidates"}),
        "candidates": candidates,
    })


def list_planning_runs(
    db: Session,
    user: User,
    *,
    profile_id,
    run_status: str | None,
    limit: int,
    offset: int,
) -> dict:
    filters = []
    if not user.is_system_admin:
        filters.append(SocialProfile.user_id == user.id)
    if profile_id:
        filters.append(PlanningRun.profile_id == profile_id)
    if run_status:
        filters.append(PlanningRun.status == run_status.strip().upper())

    total = (
        db.query(PlanningRun.id)
        .join(SocialProfile, SocialProfile.id == PlanningRun.profile_id)
        .filter(*filters)
        .count()
    )
    rows = (
        db.query(
            PlanningRun.id,
            PlanningRun.profile_id,
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
            SocialProfile.username.label("profile_username"),
            SocialProfile.platform.label("profile_platform"),
            SocialProfile.avatar_url.label("profile_avatar_url"),
            CrawlJob.name.label("crawl_job_name"),
        )
        .join(SocialProfile, SocialProfile.id == PlanningRun.profile_id)
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


def get_owned_planning_run(db: Session, run_id, user: User):
    query = db.query(PlanningRun).options(joinedload(PlanningRun.profile)).join(
        SocialProfile, SocialProfile.id == PlanningRun.profile_id
    )
    if not user.is_system_admin:
        query = query.filter(SocialProfile.user_id == user.id)
    run = query.filter(PlanningRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Planning run not found")
    return run


def _candidate_rows(db: Session, run, candidate_id=None):
    filters = [PlanningCandidate.planning_run_id == run.id]
    if candidate_id:
        filters.append(PlanningCandidate.id == candidate_id)
    return (
        db.query(
            PlanningCandidate.id,
            PlanningCandidate.content_id,
            PlanningCandidate.rank_order,
            PlanningCandidate.score,
            PlanningCandidate.selected,
            PlanningCandidate.eligible,
            PlanningCandidate.reason_jsonb,
            PlanningCandidate.metadata_json,
            ContentItem.canonical_title,
            ContentItem.summary,
        )
        .outerjoin(ContentItem, ContentItem.id == PlanningCandidate.content_id)
        .filter(*filters)
        .order_by(PlanningCandidate.rank_order.asc().nullslast(), PlanningCandidate.created_at.asc())
        .all()
    )


def _workflow_rows(db: Session, run, candidates):
    output = as_dict(run.output_jsonb)
    workflow_ids = {str(value) for value in (output.get("workflows_created") or []) if value}
    candidate_ids = [row.id for row in candidates]
    for row in candidates:
        decision_workflow_id = stored_decision(row, output).get("workflow_id")
        if decision_workflow_id:
            workflow_ids.add(str(decision_workflow_id))
    ids = [_uuid_or_none(value) for value in workflow_ids]
    ids = [value for value in ids if value]
    if not ids and not candidate_ids:
        return []
    return (
        db.query(
            MediaWorkflow.id,
            MediaWorkflow.title,
            MediaWorkflow.primary_content_id,
            MediaWorkflow.status,
            MediaWorkflow.current_stage,
            MediaWorkflow.updated_at,
            MediaWorkflow.series_id,
            MediaWorkflow.planning_candidate_id,
            MediaWorkflow.metadata_json,
            ContentSeries.title.label("series_title"),
        )
        .join(SocialProfile, SocialProfile.id == MediaWorkflow.profile_id)
        .outerjoin(ContentSeries, ContentSeries.id == MediaWorkflow.series_id)
        .filter(
            or_(MediaWorkflow.id.in_(ids), MediaWorkflow.planning_candidate_id.in_(candidate_ids)),
            SocialProfile.user_id == run.profile.user_id,
            MediaWorkflow.profile_id == run.profile_id,
        )
        .order_by(MediaWorkflow.created_at, MediaWorkflow.id)
        .all()
    )


def get_planning_run_detail(db: Session, run_id, user: User, *, diagnostic: bool = False):
    run = get_owned_planning_run(db, run_id, user)
    profile = db.query(SocialProfile.id, SocialProfile.profile_name).filter(SocialProfile.id == run.profile_id).first()
    crawl_job = db.query(CrawlJob.id, CrawlJob.name).filter(CrawlJob.id == run.crawl_job_id).first() if run.crawl_job_id else None
    candidates = _candidate_rows(db, run)
    workflows = _workflow_rows(db, run, candidates)
    detail = build_planning_run_detail(run, profile, crawl_job, candidates, workflows)
    return detail if diagnostic else compact_planning_run_detail(detail)


def get_planning_candidate_diagnostics(db: Session, run_id, candidate_id, user: User):
    run = get_owned_planning_run(db, run_id, user)
    candidates = _candidate_rows(db, run, candidate_id)
    if not candidates:
        raise HTTPException(status_code=404, detail="Planning candidate not found")
    workflows = _workflow_rows(db, run, candidates)
    detail = build_planning_run_detail(run, None, None, candidates, workflows)
    candidate = detail.candidates[0]
    return PlanningCandidateDiagnosticsResponse(
        run_id=str(run.id),
        candidate=candidate,
        topics=detail.topics,
        workflow=next((item for item in detail.workflows if item.id == candidate.workflow_id), None),
    )


def get_planning_candidate_source(db: Session, run_id, candidate_id, user: User) -> dict:
    run, candidate = owned_candidate(db, user, run_id, candidate_id)
    content = db.get(ContentItem, candidate.content_id) if candidate.content_id else None
    owner_id = run.profile.user_id if run.profile else None
    if not content_available_to_profile(db, content, owner_id):
        raise HTTPException(status_code=404, detail="Nội dung nguồn không còn khả dụng cho profile này.")
    full_text = _load_content_full_text(content.mongo_normalized_id) or ""
    return {
        "id": str(content.id),
        "title": content.canonical_title,
        "summary": content.summary,
        "full_text": html.unescape(full_text),
        "source_url": content.canonical_url,
    }


def _candidate_counts(db: Session, run_ids: list) -> dict:
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
        "profile": {
            "profile_id": str(row.profile_id),
            "profile_name": row.profile_name,
            "profile_username": row.profile_username,
            "profile_platform": row.profile_platform,
            "profile_avatar_url": row.profile_avatar_url,
        },
        "crawl_job": {"id": str(row.crawl_job_id), "name": row.crawl_job_name} if row.crawl_job_id else None,
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


def _uuid_or_none(value: Any):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None
