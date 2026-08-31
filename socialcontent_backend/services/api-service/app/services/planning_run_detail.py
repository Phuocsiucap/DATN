"""Normalize historical planning JSON into a compact, non-mutating read model."""

from collections import Counter
from math import isfinite
from typing import Any

from app.schemas.planning_run_detail import CandidateDetail, PlanningRunCompactResponse, PlanningRunDetailResponse
from common.planning.candidate_review import candidate_decision, review_state


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
    # Only unique content-to-workflow mappings are safe as a legacy fallback.
    by_content: dict[str, list] = {}
    for workflow in workflows:
        if workflow.primary_content_id:
            by_content.setdefault(str(workflow.primary_content_id), []).append(workflow)
    items = []
    for row in candidates:
        raw = stored_decision(row, output)
        workflow_id = str(row.workflow_id) if row.workflow_id else raw.get("workflow_id")
        workflow = by_id.get(str(workflow_id)) if workflow_id else None
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
        if decision.production and decision.production.reason:
            return decision.production.reason, decision.production.reason_code
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
            "reason_code": reason_code, "similarity": item.matching.similarity, "workflow_id": item.workflow_id,
            "review": review if review.status or review.can_approve or review.can_reject or review.can_retry else None,
        })
    return PlanningRunCompactResponse.model_validate({
        **detail.model_dump(exclude={"schema_version", "topics", "candidates"}),
        "candidates": candidates,
    })
