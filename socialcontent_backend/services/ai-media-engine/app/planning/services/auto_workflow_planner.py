from __future__ import annotations

import json
import math
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.core.llm import ChatCompletionResult, deepseek_chat_completion, openai_chat_completion
from common.db.content_series import series_part_count
from common.db.media_workflows import _image_urls, _serialize_source_content, content_category_payload
from common.db.models import ContentEmbedding, ContentItem, ContentSeries, MediaWorkflow, SocialProfile, SocialProfileStrategy
from common.db.prompt_runs import log_prompt_run
from common.planning.embedding_matcher import StrategyEmbeddingMatcher
from common.planning.auto_draft_policy import sync_compact_scenes
from app.planning.services.auto_draft_compact import (
    ALLOWED_DURATIONS,
    COMPACT_DRAFT_VERSION,
    FORMAT_ROLES,
    build_draft_source_document,
    build_timeline_from_compact_scenes,
    draft_quality_constraints,
    evaluate_compact_draft,
    extract_source_facts,
    lexical_similarity,
    normalize_compact_draft,
)
from app.planning.services.auto_draft_prompts import (
    SOURCE_DATA_POLICY,
    compact_draft_output_contract,
    compact_draft_rules,
)
from app.planning.services.auto_draft_links import media_prompt_catalog, source_media_catalog
from app.video.services.generate_video_timeline import normalize_story_for_project, public_story_payload


PROMPT_VERSION = "auto-draft-compact-2.0"
FIT_MARGIN_AUTO_ACCEPT = 0.08
FIT_MIN_QUALITY_AUTO_ACCEPT = 65.0
SERIES_AUTO_MATCH_THRESHOLD = 0.75
SERIES_AUTO_MATCH_MARGIN = 0.08


@dataclass(frozen=True)
class ProductionGateResult:
    status: str
    reason_code: str
    reason: str
    confidence_score: float
    source: str = "RULE"

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reason_code": self.reason_code,
            "reason": self.reason,
            "confidence_score": self.confidence_score,
            "source": self.source,
        }


@dataclass
class AutoWorkflowDecision:
    should_create_workflow: bool
    reason: str
    confidence_score: float = 0.0
    provider: str | None = None
    model: str | None = None
    timeline: dict[str, Any] = field(default_factory=dict)
    story: dict[str, Any] = field(default_factory=dict)
    series_decision: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    error_message: str | None = None


class AutoWorkflowPlanner:
    def decide_and_build_draft(
        self,
        db: Session,
        *,
        profile: SocialProfile,
        strategy: SocialProfileStrategy,
        content: ContentItem,
        candidate_metadata: dict[str, Any],
        production_review: dict[str, Any] | None = None,
    ) -> AutoWorkflowDecision:
        source = self.script_source(
            db,
            profile=profile,
            strategy=strategy,
            content=content,
            candidate_metadata=candidate_metadata,
        )
        source_content = source.get("source_content") if isinstance(source.get("source_content"), dict) else {}
        full_text = str(source_content.get("full_text") or source.get("full_text") or "")
        source_facts = extract_source_facts(
            title=str(source.get("title") or ""),
            summary=str(source.get("summary") or ""),
            full_text=full_text,
        )
        production_gate = self.deterministic_production_gate(
            content=content,
            strategy=strategy,
            candidate_metadata=candidate_metadata,
            source_fact_count=len(source_facts),
            source_facts=source_facts,
        )
        # Only the trusted review worker supplies this argument. A human may
        # resolve fit uncertainty, but cannot override unavailable/blocked input.
        if production_review and production_review.get("action") == "APPROVE" and production_review.get("reviewed_by") and production_gate.status != "SKIP":
            production_gate = ProductionGateResult(
                "PRODUCE", "HUMAN_APPROVED", "Người dùng đã duyệt bài để sinh draft; draft vẫn phải qua kiểm tra chất lượng.",
                100.0, "HUMAN",
            )
        if production_gate.status in {"SKIP", "REVIEW_REQUIRED"}:
            return self.production_gate_stop(production_gate)

        settings = get_settings()
        provider = "openai" if settings.openai_api_key else ("deepseek" if settings.deepseek_api_key else "")
        if not provider:
            return AutoWorkflowDecision(
                should_create_workflow=False,
                reason="Thiếu API key LLM nên hệ thống chưa thể sinh compact draft.",
                metadata={
                    "status": "SKIPPED_NO_API_KEY",
                    "production_gate": production_gate.to_dict(),
                    "draft_generation_mode": COMPACT_DRAFT_VERSION,
                },
            )

        fit_result: ChatCompletionResult | None = None
        if production_gate.status == "BORDERLINE":
            try:
                production_gate, fit_result = self.run_fit_judge(
                    db,
                    settings=settings,
                    provider=provider,
                    profile=profile,
                    strategy=strategy,
                    content=content,
                    candidate_metadata=candidate_metadata,
                    source_facts=source_facts,
                )
            except Exception as exc:
                self.log_failed_prompt(
                    db,
                    profile=profile,
                    content=content,
                    provider=provider,
                    settings=settings,
                    step_name="auto_production_fit_judge",
                    error=exc,
                )
                return AutoWorkflowDecision(
                    should_create_workflow=False,
                    reason="Không xác định chắc chắn được độ phù hợp của bài; cần người dùng xem lại.",
                    metadata={
                        "status": "REVIEW_REQUIRED",
                        "production_gate": {
                            **production_gate.to_dict(),
                            "status": "REVIEW_REQUIRED",
                            "reason_code": "FIT_JUDGE_ERROR",
                        },
                        "draft_generation_mode": COMPACT_DRAFT_VERSION,
                    },
                    error_message=str(exc),
                )
            if production_gate.status != "PRODUCE":
                decision = self.production_gate_stop(production_gate)
                decision.provider = fit_result.provider
                decision.model = fit_result.model
                return decision

        source_document = build_draft_source_document(
            title=str(source.get("title") or ""),
            description=str(source.get("summary") or ""),
            full_text=full_text,
            fallback_facts=source_facts,
        )
        # The draft and its validator must see the same full set of evidence.
        # Keep the earlier production gate / Fit Judge on their existing budget.
        source_facts = source_document["sections"]
        series_candidates = self.rank_series_candidates(
            db,
            profile_id=profile.id,
            content=content,
            candidate_metadata=candidate_metadata,
        )
        fixed_series_decision = self.resolve_clear_series_match(series_candidates)
        image_urls = list(dict.fromkeys(_image_urls(content.media_jsonb if isinstance(content.media_jsonb, list) else [])))
        available_media = source_media_catalog(content.media_jsonb if isinstance(content.media_jsonb, list) else [])
        prompt_payload = self.compact_prompt_payload(
            profile=profile,
            strategy=strategy,
            content=content,
            candidate_metadata=candidate_metadata,
            source_document=source_document,
            series_candidates=series_candidates,
            fixed_series_decision=fixed_series_decision,
            available_media_count=len(available_media),
            available_media=media_prompt_catalog(available_media),
        )

        creative_results: list[ChatCompletionResult] = []
        retry_error: str | None = None
        try:
            initial_result = self.call_llm(
                settings,
                provider,
                prompt_payload,
                system_prompt=(
                    "Bạn là biên kịch video ngắn tiếng Việt. Hãy chọn một cấu trúc phù hợp với nội dung nguồn "
                    "và trả đúng compact JSON; tuyệt đối không tạo timeline kỹ thuật hay thông tin ngoài nguồn."
                    f" {SOURCE_DATA_POLICY}"
                ),
                temperature=0.55,
            )
            creative_results.append(initial_result)
            log_prompt_run(
                user_id=profile.user_id,
                reference_id=content.id,
                run_type="GENERATE_VIDEO_SCRIPT",
                step_name="auto_compact_draft",
                prompt_version=PROMPT_VERSION,
                result=initial_result,
            )
            initial_parse_error: str | None = None
            try:
                compact = self.normalize_generated_draft(initial_result.parsed_json())
            except Exception as exc:
                initial_parse_error = str(exc)
                compact = self.normalize_generated_draft({})
            quality = evaluate_compact_draft(compact, source_facts, risk_tolerance=str(strategy.risk_level or ""), available_media=available_media)

            human_only_codes = {"HIGH_RISK_FLAG", "RISK_EXCEEDS_PROFILE_TOLERANCE", "LOW_MODEL_CONFIDENCE"}
            if not quality.passed and any(issue.code not in human_only_codes for issue in quality.issues):
                quality_issues = [issue.to_dict() for issue in quality.issues]
                if initial_parse_error:
                    quality_issues.insert(
                        0,
                        {
                            "code": "INVALID_JSON",
                            "message": "Initial completion was not valid JSON",
                            "severity": "CRITICAL",
                            "details": {"parse_error": initial_parse_error[:500]},
                        },
                    )
                repair_payload = self.repair_prompt_payload(
                    profile=profile,
                    strategy=strategy,
                    source_document=source_document,
                    current_draft=compact,
                    quality_issues=quality_issues,
                    series_candidates=series_candidates,
                    fixed_series_decision=fixed_series_decision,
                    available_media_count=len(available_media),
                    available_media=media_prompt_catalog(available_media),
                )
                try:
                    repair_result = self.call_llm(
                        settings,
                        provider,
                        repair_payload,
                        system_prompt=(
                            "Bạn sửa compact draft video tiếng Việt theo đúng danh sách lỗi. Giữ nguyên phần hợp lệ, "
                            "không thêm sự kiện, số liệu hoặc tên riêng ngoài source_document, và chỉ trả JSON."
                            f" {SOURCE_DATA_POLICY}"
                        ),
                        temperature=0.3,
                    )
                    creative_results.append(repair_result)
                    log_prompt_run(
                        user_id=profile.user_id,
                        reference_id=content.id,
                        run_type="GENERATE_VIDEO_SCRIPT",
                        step_name="auto_compact_draft_repair",
                        prompt_version=PROMPT_VERSION,
                        result=repair_result,
                    )
                    repaired = self.normalize_generated_draft(repair_result.parsed_json())
                    # A creative retry may repair wording, but cannot clear a
                    # reported safety concern without human review.
                    retained_risks = [
                        flag for flag in compact.get("risk_flags") or []
                        if str(flag.get("severity") or "").upper() in {"HIGH", "CRITICAL"}
                        or (str(strategy.risk_level or "").upper() == "LOW" and flag.get("severity") == "MEDIUM")
                    ]
                    repaired["risk_flags"] = retained_risks + [flag for flag in repaired.get("risk_flags") or [] if flag not in retained_risks]
                    if not repaired.get("series_decision"):
                        repaired["series_decision"] = compact.get("series_decision") or {}
                    repaired_quality = evaluate_compact_draft(repaired, source_facts, risk_tolerance=str(strategy.risk_level or ""), available_media=available_media)
                    if repaired_quality.passed or (not quality.passed and repaired_quality.score >= quality.score):
                        compact = repaired
                        quality = repaired_quality
                except Exception as exc:
                    retry_error = str(exc)
                    self.log_failed_prompt(
                        db,
                        profile=profile,
                        content=content,
                        provider=provider,
                        settings=settings,
                        step_name="auto_compact_draft_repair",
                        error=exc,
                    )

            scenes = compact.get("scenes") if isinstance(compact.get("scenes"), list) else []
            if not scenes:
                raise RuntimeError("Compact draft did not contain any usable scenes after one repair attempt")

            series_decision = self.validate_series_decision(
                fixed=fixed_series_decision,
                value=compact.get("series_decision"),
                candidates=series_candidates,
                content_title=str(content.canonical_title or content.normalized_title or ""),
            )
            plan = compact.get("plan") if isinstance(compact.get("plan"), dict) else {}
            draft_version = compact["version"]
            target_duration = None if draft_version == COMPACT_DRAFT_VERSION else int(plan.get("duration_seconds") or 40)
            if target_duration is not None and target_duration not in ALLOWED_DURATIONS:
                target_duration = 40
            if target_duration is not None:
                source["target_duration_seconds"] = target_duration
            else:
                source.pop("target_duration_seconds", None)
            source_plan = dict(source.get("plan") or {})
            source_plan.update(
                {
                    "title": plan.get("title"),
                    "content_angle": plan.get("angle"),
                    "format": plan.get("format"),
                    "target_duration_seconds": target_duration,
                }
            )
            source["plan"] = source_plan

            quality_payload = quality.to_dict()
            if not quality.passed:
                quality_payload["status"] = "REVIEW_REQUIRED"
            quality_payload["retry_count"] = max(0, len(creative_results) - 1)
            if retry_error:
                quality_payload["retry_error"] = retry_error

            timeline = build_timeline_from_compact_scenes(compact, image_urls, available_media=available_media)
            timeline_metadata = timeline.get("metadata") if isinstance(timeline.get("metadata"), dict) else {}
            timeline["metadata"] = {
                **timeline_metadata,
                "quality": quality_payload,
                "series_decision": series_decision,
            }
            story = normalize_story_for_project(
                {
                    "meta": {
                        "title": str(plan.get("title") or content.canonical_title or "Auto workflow"),
                        "source": "auto_planning",
                        "draft_generation_mode": draft_version,
                        "prompt_version": PROMPT_VERSION,
                        **({"target_duration_seconds": target_duration} if target_duration is not None else {}),
                        "timing_mode": "narration_estimate" if target_duration is None else "target_duration",
                        "llm_calls": len(creative_results) + (1 if fit_result else 0),
                        "user_id": str(profile.user_id),
                        "content_id": str(content.id),
                        "quality": quality_payload,
                        "risk_flags": compact.get("risk_flags") or [],
                        "source_facts": source_facts,
                        "source_coverage": source_document["coverage"],
                        "creative_plan": plan,
                        "production_gate": production_gate.to_dict(),
                    },
                    "video": {"width": 1080, "height": 1920, "fps": 30, "background": "#05070b"},
                    "audio": {"voiceVolume": 1, "musicVolume": 0},
                    "source": source,
                    "timeline": timeline,
                }
            )
            public_story = public_story_payload(story)
            public_story["story_data"] = story.get("story_data") or []
            public_story["compact_scenes"] = [{**scene, "text_id": scene.get("text_id") or f"text-{index + 1}"} for index, scene in enumerate(scenes)]
            sync_compact_scenes(public_story)
            public_story["project_status"] = "EDITING" if quality.passed else "REVIEW_REQUIRED"

            token_usage = {
                "input_tokens": sum(result.input_tokens for result in creative_results) + (fit_result.input_tokens if fit_result else 0),
                "output_tokens": sum(result.output_tokens for result in creative_results) + (fit_result.output_tokens if fit_result else 0),
                "creative_call_count": len(creative_results),
                "fit_judge_call_count": 1 if fit_result else 0,
            }
            final_result = creative_results[-1]
            confidence = self.as_float(compact.get("confidence_score"), production_gate.confidence_score)
            planning_mode = "SERIES" if series_decision and series_decision.get("action") in {"USE_EXISTING", "CREATE_NEW"} else "SINGLE"
            status = "AI_APPROVED" if quality.passed else "DRAFT_REVIEW_REQUIRED"
            return AutoWorkflowDecision(
                should_create_workflow=True,
                provider=final_result.provider,
                model=final_result.model,
                confidence_score=confidence,
                reason=production_gate.reason,
                timeline=timeline,
                story=public_story,
                series_decision=series_decision,
                metadata={
                    "status": status,
                    "plan_title": plan.get("title"),
                    "content_angle": plan.get("angle"),
                    "target_audience": strategy.target_audience,
                    "tone": strategy.tone,
                    "format": plan.get("format"),
                    "hook_type": plan.get("hook_type"),
                    "cta_mode": plan.get("cta_mode"),
                    "planning_mode": planning_mode,
                    "risk_flags": compact.get("risk_flags") or [],
                    "reasoning": [production_gate.reason_code],
                    "production_gate": production_gate.to_dict(),
                    "quality": quality_payload,
                    "source_coverage": source_document["coverage"],
                    "series_candidates": series_candidates,
                    "token_usage": token_usage,
                    "draft_generation_mode": draft_version,
                    "prompt_version": PROMPT_VERSION,
                    "raw_decision": self.compact_raw_decision(compact, production_gate, series_decision),
                },
            )
        except Exception as exc:
            self.log_failed_prompt(
                db,
                profile=profile,
                content=content,
                provider=provider,
                settings=settings,
                step_name="auto_compact_draft",
                error=exc,
            )
            return AutoWorkflowDecision(
                should_create_workflow=False,
                reason=f"Compact draft generation failed: {exc}",
                provider=creative_results[-1].provider if creative_results else provider,
                model=creative_results[-1].model if creative_results else None,
                metadata={
                    "status": "AI_ERROR",
                    "production_gate": production_gate.to_dict(),
                    "series_candidates": series_candidates,
                    "draft_generation_mode": COMPACT_DRAFT_VERSION,
                    "prompt_version": PROMPT_VERSION,
                },
                error_message=str(exc),
            )

    @staticmethod
    def normalize_generated_draft(value: Any) -> dict[str, Any]:
        # New LLM calls must satisfy the active contract. Legacy support is for
        # reading existing drafts, not silently accepting old 1:1 output again.
        payload = value if isinstance(value, dict) else {}
        return normalize_compact_draft({**payload, "version": COMPACT_DRAFT_VERSION})

    def deterministic_production_gate(
        self,
        *,
        content: ContentItem,
        strategy: SocialProfileStrategy,
        candidate_metadata: dict[str, Any],
        source_fact_count: int,
        source_facts: list[dict[str, str]] | None = None,
    ) -> ProductionGateResult:
        if str(getattr(content, "status", "") or "").upper() not in {"READY", "USABLE_WITH_WARNING"}:
            return ProductionGateResult(
                "SKIP",
                "CONTENT_NOT_READY",
                "Bài chưa ở trạng thái sẵn sàng để sản xuất tự động.",
                100.0,
            )
        blocked_by_avoid = bool(self.candidate_value(candidate_metadata, "blocked_by_avoid_topics", False))
        avoided_topics = self.candidate_value(candidate_metadata, "avoided_topics", []) or []
        if blocked_by_avoid or avoided_topics:
            return ProductionGateResult("SKIP", "AVOID_TOPIC", "Bài bị chặn vì khớp chủ đề cần tránh của profile.", 100.0)

        passed_similarity = self.candidate_value(candidate_metadata, "passed_similarity_gate")
        if passed_similarity is False:
            return ProductionGateResult("SKIP", "LOW_TOPIC_SIMILARITY", "Bài không đạt ngưỡng tương đồng chủ đề của profile.", 100.0)

        has_required_video = self.candidate_value(candidate_metadata, "has_required_video")
        if bool(getattr(strategy, "require_video", False)) and has_required_video is False:
            return ProductionGateResult("SKIP", "VIDEO_REQUIRED", "Profile yêu cầu nguồn có video nhưng bài này không có tín hiệu video.", 100.0)

        if source_fact_count < 3:
            return ProductionGateResult("REVIEW_REQUIRED", "INSUFFICIENT_SOURCE", "Nguồn có quá ít dữ kiện để sản xuất tự động mà không suy diễn.", 95.0)

        similarity = self.as_float(self.candidate_value(candidate_metadata, "embedding_similarity"))
        threshold = self.as_float(
            self.candidate_value(candidate_metadata, "similarity_threshold"),
            self.as_float(getattr(strategy, "min_similarity", None), 0.62),
        )
        quality = float(content.quality_score or 0)
        if (
            similarity >= threshold + FIT_MARGIN_AUTO_ACCEPT
            and quality >= FIT_MIN_QUALITY_AUTO_ACCEPT
            and str(getattr(content, "status", "")).upper() == "READY"
            and str(getattr(strategy, "risk_level", "MEDIUM") or "MEDIUM").strip().upper() != "LOW"
            and not self.source_requires_fit_judge(content, source_facts)
        ):
            confidence = min(99.0, 82.0 + max(0.0, similarity - threshold) * 100.0)
            return ProductionGateResult(
                "PRODUCE",
                "HIGH_CONFIDENCE_MATCH",
                "Bài vượt rõ ngưỡng chủ đề, đủ dữ kiện và chất lượng để sản xuất tự động.",
                round(confidence, 1),
            )

        return ProductionGateResult(
            "BORDERLINE",
            "BORDERLINE_MATCH",
            "Bài đã qua hard gate nhưng cần kiểm tra thêm độ phù hợp với audience và rủi ro nội dung.",
            60.0,
        )

    def run_fit_judge(
        self,
        db: Session,
        *,
        settings: Any,
        provider: str,
        profile: SocialProfile,
        strategy: SocialProfileStrategy,
        content: ContentItem,
        candidate_metadata: dict[str, Any],
        source_facts: list[dict[str, str]],
    ) -> tuple[ProductionGateResult, ChatCompletionResult]:
        payload = {
            "task": "Decide whether this candidate should be produced for the profile. Return compact JSON only.",
            "required_output": {
                "decision": "PRODUCE, SKIP, or REVIEW_REQUIRED",
                "confidence_score": "number 0-100",
                "reason_code": "short uppercase code",
                "risk": "LOW, MEDIUM, or HIGH",
            },
            "rules": [
                "Judge profile fit and factual/safety risk only; do not write a script.",
                "Use only supplied facts and signals.",
                "Choose REVIEW_REQUIRED when evidence is conflicting or confidence is below 65.",
            ],
            "profile": {
                "platform": profile.platform,
                "topics": str(strategy.content_topics or "")[:1200],
                "avoid_topics": str(strategy.avoid_topics or "")[:600],
                "audience": str(strategy.target_audience or "")[:400],
                "risk_level": strategy.risk_level,
            },
            "content": {
                "title": content.canonical_title,
                "summary": str(content.summary or "")[:700],
                "facts": source_facts[:5],
            },
            "signals": {
                "similarity": self.candidate_value(candidate_metadata, "embedding_similarity"),
                "threshold": self.candidate_value(candidate_metadata, "similarity_threshold"),
                "quality_score": float(content.quality_score or 0),
                "matched_topics": self.candidate_value(candidate_metadata, "matched_topics", []) or [],
            },
        }
        result = self.call_llm(
            settings,
            provider,
            payload,
            system_prompt="Bạn là production gate cho hệ thống video tự động. Chỉ trả JSON ngắn, không viết kịch bản.",
            temperature=0.1,
            max_tokens=300,
        )
        log_prompt_run(
            user_id=profile.user_id,
            reference_id=content.id,
            run_type="PLANNING",
            step_name="auto_production_fit_judge",
            prompt_version=PROMPT_VERSION,
            result=result,
        )
        parsed = result.parsed_json()
        if not isinstance(parsed, dict):
            raise RuntimeError("Production fit judge did not return a JSON object")
        decision = str(parsed.get("decision") or "REVIEW_REQUIRED").strip().upper()
        if decision not in {"PRODUCE", "SKIP", "REVIEW_REQUIRED"}:
            decision = "REVIEW_REQUIRED"
        confidence = self.as_float(parsed.get("confidence_score"))
        if decision == "PRODUCE" and confidence < 65:
            decision = "REVIEW_REQUIRED"
        risk = str(parsed.get("risk") or "MEDIUM").strip().upper()
        profile_risk = str(getattr(strategy, "risk_level", "MEDIUM") or "MEDIUM").strip().upper()
        if risk not in {"LOW", "MEDIUM"} or (risk == "MEDIUM" and profile_risk == "LOW"):
            decision = "REVIEW_REQUIRED"
        reason_code = str(parsed.get("reason_code") or "FIT_JUDGE_UNCERTAIN").strip().upper()[:80]
        reasons = {
            "PRODUCE": "Fit Judge xác nhận bài phù hợp với profile và có thể sản xuất.",
            "SKIP": "Fit Judge xác nhận bài chưa đủ phù hợp để sản xuất cho profile này.",
            "REVIEW_REQUIRED": "Fit Judge chưa đủ chắc chắn; bài cần được người dùng xem lại.",
        }
        return ProductionGateResult(decision, reason_code, reasons[decision], confidence, "LLM"), result

    def compact_prompt_payload(
        self,
        *,
        profile: SocialProfile,
        strategy: SocialProfileStrategy,
        content: ContentItem,
        candidate_metadata: dict[str, Any],
        source_document: dict[str, Any],
        series_candidates: list[dict[str, Any]],
        fixed_series_decision: dict[str, Any] | None,
        available_media_count: int,
        available_media: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return {
            "task": "Create one grounded Vietnamese video draft with independent visual and text tracks.",
            "required_output": compact_draft_output_contract(),
            "format_catalog": FORMAT_ROLES,
            "draft_constraints": draft_quality_constraints(risk_tolerance=str(strategy.risk_level or ""), version=COMPACT_DRAFT_VERSION),
            "rules": compact_draft_rules(),
            "profile": {
                "id": str(profile.id),
                "platform": profile.platform,
                "tone": str(strategy.tone or "")[:400],
                "target_audience": str(strategy.target_audience or "")[:500],
                "content_topics": str(strategy.content_topics or "")[:1200],
                "avoid_topics": str(strategy.avoid_topics or "")[:600],
                "risk_level": strategy.risk_level,
            },
            "content": {
                "id": str(content.id),
                "title": content.canonical_title,
                "quality_score": float(content.quality_score or 0),
                "matched_topics": self.candidate_value(candidate_metadata, "matched_topics", []) or [],
                "source_document": source_document,
            },
            "fixed_series_decision": fixed_series_decision,
            "series_candidates": [] if fixed_series_decision else series_candidates,
            "available_media_count": available_media_count,
            "available_media": available_media or [],
        }

    def repair_prompt_payload(
        self,
        *,
        profile: SocialProfile,
        strategy: SocialProfileStrategy,
        source_document: dict[str, Any],
        current_draft: dict[str, Any],
        quality_issues: list[dict[str, Any]],
        series_candidates: list[dict[str, Any]],
        fixed_series_decision: dict[str, Any] | None,
        available_media_count: int = 0,
        available_media: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return {
            "task": "Repair this compact draft once and return the complete compact JSON.",
            "required_output": compact_draft_output_contract(),
            "draft_constraints": draft_quality_constraints(risk_tolerance=str(strategy.risk_level or ""), version=COMPACT_DRAFT_VERSION),
            "rules": [
                *compact_draft_rules(),
                "Fix each quality_issues entry; scene_indexes refer to zero-based text positions. Preserve valid text IDs, media IDs and links unless a listed issue requires changing them. Return compact-v2 even when repairing an older draft.",
                "For unsupported facts, find support for the entire claim in source_document. If none supports it, remove or rewrite the claim; matching a name or number alone is insufficient. Do not add citation IDs.",
                "Recheck the entire returned draft against draft_constraints after editing, including unchanged scenes. Do not suppress risk flags or inflate confidence to remove review-only issues.",
            ],
            "profile_style": {
                "platform": profile.platform,
                "tone": strategy.tone,
                "target_audience": strategy.target_audience,
            },
            "quality_issues": quality_issues,
            # Do not filter out uncited sections: the repair may need the end of
            # the article just as much as the initial draft does.
            "source_document": source_document,
            "fixed_series_decision": fixed_series_decision,
            "allowed_series_candidates": [] if fixed_series_decision else series_candidates,
            "current_draft": {key: value for key, value in current_draft.items() if key != "scenes" or current_draft.get("version") != COMPACT_DRAFT_VERSION},
            "format_catalog": FORMAT_ROLES,
            "available_media_count": available_media_count,
            "available_media": available_media or [],
        }

    def rank_series_candidates(
        self,
        db: Session,
        *,
        profile_id: uuid.UUID,
        content: ContentItem,
        candidate_metadata: dict[str, Any],
    ) -> list[dict[str, Any]]:
        series_rows = (
            db.query(ContentSeries)
            .filter(ContentSeries.profile_id == profile_id, ContentSeries.status == "ACTIVE")
            .order_by(ContentSeries.updated_at.desc())
            .all()
        )
        part_counts = {series.id: series_part_count(db, series.id) for series in series_rows}
        series_rows = [series for series in series_rows if int(series.total_parts or 0) == 0 or part_counts[series.id] < series.total_parts]
        if not series_rows:
            return []

        model_name = str(self.candidate_value(candidate_metadata, "embedding_model", "") or "")
        candidate_embedding = self.content_embedding(db, content.id, model_name=model_name or None)
        candidate_vector = StrategyEmbeddingMatcher.vector_values(candidate_embedding.embedding) if candidate_embedding else []
        if candidate_embedding:
            model_name = candidate_embedding.model_name

        series_ids = [series.id for series in series_rows]
        ranked_workflows = (
            db.query(
                MediaWorkflow.id.label("workflow_id"),
                func.row_number()
                .over(partition_by=MediaWorkflow.series_id, order_by=MediaWorkflow.updated_at.desc())
                .label("series_rank"),
            )
            .filter(MediaWorkflow.series_id.in_(series_ids), MediaWorkflow.primary_content_id.is_not(None))
            .filter(~MediaWorkflow.status.in_(["FAILED", "REJECTED"]))
            .subquery()
        )
        workflows = (
            db.query(MediaWorkflow)
            .join(ranked_workflows, ranked_workflows.c.workflow_id == MediaWorkflow.id)
            .filter(ranked_workflows.c.series_rank <= 5)
            .order_by(MediaWorkflow.updated_at.desc())
            .all()
        )
        recent_by_series: dict[uuid.UUID, list[MediaWorkflow]] = {series_id: [] for series_id in series_ids}
        for workflow in workflows:
            rows = recent_by_series.setdefault(workflow.series_id, [])
            if len(rows) < 5:
                rows.append(workflow)

        recent_content_ids = list(
            {
                workflow.primary_content_id
                for rows in recent_by_series.values()
                for workflow in rows
                if workflow.primary_content_id
            }
        )
        embeddings_by_content: dict[uuid.UUID, ContentEmbedding] = {}
        if recent_content_ids:
            query = db.query(ContentEmbedding).filter(ContentEmbedding.content_id.in_(recent_content_ids))
            if model_name:
                query = query.filter(ContentEmbedding.model_name == model_name)
            embedding_rows = query.order_by(ContentEmbedding.updated_at.desc()).all()
            for row in embedding_rows:
                embeddings_by_content.setdefault(row.content_id, row)

        matched_topics = self.candidate_value(candidate_metadata, "matched_topics", []) or []
        content_text = " ".join(
            [
                str(content.canonical_title or ""),
                str(content.summary or ""),
                " ".join(str(item) for item in matched_topics),
            ]
        )
        candidates: list[dict[str, Any]] = []
        for series in series_rows:
            recent_workflows = recent_by_series.get(series.id, [])
            representative_vectors: list[list[float]] = []
            vector_content_ids: set[uuid.UUID] = set()
            recent_items: list[dict[str, Any]] = []
            for workflow in recent_workflows:
                recent_content = db.get(ContentItem, workflow.primary_content_id) if workflow.primary_content_id else None
                embedding = embeddings_by_content.get(workflow.primary_content_id)
                vector = StrategyEmbeddingMatcher.vector_values(embedding.embedding) if embedding else []
                if candidate_vector and vector and len(vector) == len(candidate_vector) and workflow.primary_content_id not in vector_content_ids:
                    representative_vectors.append(vector)
                    vector_content_ids.add(workflow.primary_content_id)
                recent_items.append(
                    {
                        "workflow_id": str(workflow.id),
                        "title": str(workflow.title or "")[:180],
                        "summary": str(recent_content.summary or "")[:350] if recent_content else None,
                        "status": workflow.status,
                    }
                )

            semantic_score = 0.0
            if representative_vectors:
                representative = [
                    sum(vector[index] for vector in representative_vectors) / len(representative_vectors)
                    for index in range(len(candidate_vector))
                ]
                semantic_score = StrategyEmbeddingMatcher.cosine_similarity(candidate_vector, representative)
            series_context = series.context_json if isinstance(series.context_json, dict) else {}
            followup_angles = series_context.get("reusable_followup_angles") if isinstance(series_context.get("reusable_followup_angles"), list) else []
            followup_text = " ".join(str(item) for item in followup_angles[:3])
            lexical_score = lexical_similarity(
                content_text,
                f"{series.title} {series.description or ''} {series_context.get('core_theme') or ''} {followup_text}",
            )
            if representative_vectors:
                final_score = 0.85 * semantic_score + 0.15 * lexical_score
                match_source = "recent_content_centroid"
            else:
                final_score = min(0.54, lexical_score * 0.7)
                match_source = "title_description_lexical"

            payload = self.series_context_payload(series)
            payload["current_part"] = part_counts[series.id]
            payload.update(
                {
                    "score": round(max(0.0, min(1.0, final_score)), 4),
                    "semantic_score": round(max(0.0, min(1.0, semantic_score)), 4),
                    "lexical_score": round(max(0.0, min(1.0, lexical_score)), 4),
                    "match_source": match_source,
                    "recent_vector_count": len(representative_vectors),
                    "recent_items": recent_items[:2],
                }
            )
            candidates.append(payload)
        candidates.sort(key=lambda item: (float(item.get("score") or 0), int(item.get("recent_vector_count") or 0)), reverse=True)
        return candidates[:3]

    def resolve_clear_series_match(self, candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not candidates:
            return None
        best = candidates[0]
        best_score = self.as_float(best.get("score"))
        second_score = self.as_float(candidates[1].get("score")) if len(candidates) > 1 else 0.0
        if (
            best_score >= SERIES_AUTO_MATCH_THRESHOLD
            and best_score - second_score >= SERIES_AUTO_MATCH_MARGIN
            and int(best.get("recent_vector_count") or 0) >= 3
        ):
            return {
                "action": "USE_EXISTING",
                "target_series_id": str(best.get("id")),
                "series_title": best.get("title"),
                "series_description": best.get("description"),
                "series_type": best.get("series_type"),
                "total_parts": int(best.get("total_parts") or 0),
                "reason": "HIGH_CONFIDENCE_SERIES_MATCH",
                "series_context": {
                    "title": best.get("title"),
                    "description": best.get("description"),
                    "current_part": int(best.get("current_part") or 0),
                    "total_parts": int(best.get("total_parts") or 0),
                    "recent_items": best.get("recent_items") or [],
                    "match_score": best_score,
                },
            }
        return None

    def validate_series_decision(
        self,
        *,
        fixed: dict[str, Any] | None,
        value: Any,
        candidates: list[dict[str, Any]],
        content_title: str,
    ) -> dict[str, Any]:
        if fixed:
            return dict(fixed)
        raw = value if isinstance(value, dict) else {}
        action = str(raw.get("action") or "NONE").strip().upper()
        if action not in {"USE_EXISTING", "CREATE_NEW", "NONE"}:
            action = "NONE"
        candidate_ids = {str(item.get("id")) for item in candidates if item.get("id")}
        target_series_id = str(raw.get("target_series_id") or "").strip() or None
        if action == "USE_EXISTING" and target_series_id not in candidate_ids:
            action = "NONE"
            target_series_id = None

        followup_angles = [
            str(item).strip()[:240]
            for item in (raw.get("reusable_followup_angles") or [])[:3]
            if str(item).strip()
        ] if isinstance(raw.get("reusable_followup_angles"), list) else []
        series_title = " ".join(str(raw.get("series_title") or "").split()).strip()[:180]
        if action == "CREATE_NEW":
            if (
                not series_title
                or self.normalized_key(series_title) == self.normalized_key(content_title)
                or len(followup_angles) < 3
            ):
                action = "NONE"
                series_title = ""
        if action != "USE_EXISTING":
            target_series_id = None
        if action != "CREATE_NEW":
            series_title = series_title if action == "USE_EXISTING" else ""

        series_type = str(raw.get("series_type") or "NARRATIVE").strip().upper()
        if series_type not in {"NARRATIVE", "EDUCATIONAL", "NEWS", "REVIEWS", "ENTERTAINMENT"}:
            series_type = "NARRATIVE"
        try:
            total_parts = max(0, int(raw.get("total_parts") or 0))
        except (TypeError, ValueError):
            total_parts = 0
        return {
            "action": action,
            "target_series_id": target_series_id,
            "series_title": series_title or None,
            "series_description": str(raw.get("series_description") or "").strip()[:1000] or None,
            "series_type": series_type,
            "total_parts": total_parts,
            "reason": str(raw.get("reason") or "").strip()[:200] or None,
            "reusable_followup_angles": followup_angles if action == "CREATE_NEW" else [],
        }

    def script_source(
        self,
        db: Session,
        *,
        profile: SocialProfile,
        strategy: SocialProfileStrategy,
        content: ContentItem,
        candidate_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        source_content = _serialize_source_content(content, allow_description_fallback=False) or {"id": str(content.id)}
        source_content["media"] = content.media_jsonb if isinstance(content.media_jsonb, list) else []
        full_text = source_content.get("full_text")
        if full_text:
            source_content["full_text"] = full_text
        return {
            "id": str(content.id),
            "user_id": str(profile.user_id),
            "title": content.canonical_title or content.normalized_title,
            "summary": content.summary or "",
            "full_text": full_text,
            "content": {
                "content_id": str(content.id),
                "crawl_job_id": str(content.crawl_job_id) if content.crawl_job_id else None,
                "content_type": content.content_type,
                "quality_score": float(content.quality_score or 0),
                **content_category_payload(content),
                "candidate_metadata": candidate_metadata,
            },
            "plan": {
                "target_audience": strategy.target_audience,
                "tone": strategy.tone,
                "risk_level": strategy.risk_level,
                "production_requirements": {
                    "requires_voice": True,
                    "requires_subtitles": True,
                    "requires_background_media": True,
                },
            },
            "source_content": source_content,
            "raw_article": {"source_content": source_content},
        }

    def series_context_payload(self, series: ContentSeries) -> dict[str, Any]:
        metadata = series.metadata_json if isinstance(series.metadata_json, dict) else {}
        context = series.context_json if isinstance(series.context_json, dict) else {}
        followup_angles = context.get("reusable_followup_angles") if isinstance(context.get("reusable_followup_angles"), list) else []
        category_id = metadata.get("category_id") or metadata.get("categoryId")
        return {
            "id": str(series.id),
            "title": str(series.title or "")[:180],
            "description": str(series.description or "")[:500] or None,
            "series_type": series.series_type,
            "status": series.status,
            "current_part": int(series.current_part or 0),
            "total_parts": int(series.total_parts or 0),
            "category_id": category_id,
            "category": metadata.get("category"),
            "core_theme": str(context.get("core_theme") or "")[:400] or None,
            "reusable_followup_angles": [str(item)[:240] for item in followup_angles[:3]],
        }

    def strategy_payload(self, strategy: SocialProfileStrategy) -> dict[str, Any]:
        return {
            "content_topics": strategy.content_topics,
            "avoid_topics": strategy.avoid_topics,
            "tone": strategy.tone,
            "target_audience": strategy.target_audience,
            "risk_level": strategy.risk_level,
            "min_similarity": getattr(strategy, "min_similarity", None),
            "require_video": bool(strategy.require_video),
        }

    def call_llm(
        self,
        settings: Any,
        provider: str,
        prompt_payload: dict[str, Any],
        *,
        system_prompt: str,
        temperature: float,
        max_tokens: int = 3200,
    ) -> ChatCompletionResult:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False, default=str)},
        ]
        if provider == "openai":
            return openai_chat_completion(
                api_key=settings.openai_api_key,
                model=settings.openai_model or "gpt-4o-mini",
                messages=messages,
                temperature=temperature,
                response_format={"type": "json_object"},
                max_tokens=max_tokens,
                timeout=60,
            )
        return deepseek_chat_completion(
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            model="deepseek-v4-flash",
            messages=messages,
            temperature=temperature,
            response_format={"type": "json_object"},
            max_tokens=max_tokens,
            timeout=60,
        )

    @staticmethod
    def source_requires_fit_judge(content: ContentItem, source_facts: list[dict[str, str]] | None = None) -> bool:
        text = " ".join([
            str(getattr(content, "canonical_title", "") or ""),
            str(getattr(content, "summary", "") or ""),
            *[str(fact.get("text") or "") for fact in source_facts or []],
        ]).casefold()
        sensitive_terms = (
            "sức khỏe", "y tế", "thuốc", "điều trị", "pháp luật", "luật", "đầu tư", "chứng khoán",
            "tiền điện tử", "tự tử", "bạo lực", "tình dục", "trẻ em", "health", "medical", "legal",
            "investment", "crypto", "suicide", "violence",
        )
        return any(term in text for term in sensitive_terms)

    def production_gate_stop(self, gate: ProductionGateResult) -> AutoWorkflowDecision:
        status = "PRODUCTION_REJECTED" if gate.status == "SKIP" else "REVIEW_REQUIRED"
        return AutoWorkflowDecision(
            should_create_workflow=False,
            reason=gate.reason,
            confidence_score=gate.confidence_score,
            metadata={
                "status": status,
                "production_gate": gate.to_dict(),
                "reasoning": [gate.reason_code],
                "draft_generation_mode": COMPACT_DRAFT_VERSION,
                "prompt_version": PROMPT_VERSION,
            },
        )

    def content_embedding(
        self,
        db: Session,
        content_id: uuid.UUID,
        *,
        model_name: str | None,
    ) -> ContentEmbedding | None:
        query = db.query(ContentEmbedding).filter(ContentEmbedding.content_id == content_id)
        if model_name:
            matching = query.filter(ContentEmbedding.model_name == model_name).first()
            if matching:
                return matching
        return query.order_by(ContentEmbedding.updated_at.desc()).first()

    def compact_raw_decision(
        self,
        compact: dict[str, Any],
        production_gate: ProductionGateResult,
        series_decision: dict[str, Any],
    ) -> dict[str, Any]:
        plan = compact.get("plan") if isinstance(compact.get("plan"), dict) else {}
        return {
            "should_create_workflow": True,
            "production_gate": production_gate.to_dict(),
            "plan_title": plan.get("title"),
            "content_angle": plan.get("angle"),
            "format": plan.get("format"),
            "duration_seconds": plan.get("duration_seconds"),
            "confidence_score": compact.get("confidence_score"),
            "risk_flags": compact.get("risk_flags") or [],
            "series_decision": series_decision,
        }

    def log_failed_prompt(
        self,
        db: Session,
        *,
        profile: SocialProfile,
        content: ContentItem,
        provider: str,
        settings: Any,
        step_name: str,
        error: Exception,
    ) -> None:
        log_prompt_run(
            user_id=profile.user_id,
            reference_id=content.id,
            run_type="GENERATE_VIDEO_SCRIPT" if "draft" in step_name else "PLANNING",
            step_name=step_name,
            model_provider=provider,
            model_name=settings.openai_model if provider == "openai" else "deepseek-v4-flash",
            prompt_version=PROMPT_VERSION,
            status="FAILED",
            error_message=str(error),
        )

    @staticmethod
    def candidate_value(metadata: dict[str, Any], key: str, fallback: Any = None) -> Any:
        if not isinstance(metadata, dict):
            return fallback
        if key in metadata:
            return metadata.get(key)
        breakdown = metadata.get("score_breakdown") if isinstance(metadata.get("score_breakdown"), dict) else {}
        return breakdown.get(key, fallback)

    @staticmethod
    def normalized_key(value: str) -> str:
        normalized = unicodedata.normalize("NFD", str(value or "").strip().lower())
        normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
        normalized = normalized.replace("đ", "d")
        return re.sub(r"[^a-z0-9]+", " ", normalized).strip()

    @staticmethod
    def as_float(value: Any, fallback: float = 0.0) -> float:
        try:
            result = float(value)
            return result if math.isfinite(result) else fallback
        except (TypeError, ValueError):
            return fallback
