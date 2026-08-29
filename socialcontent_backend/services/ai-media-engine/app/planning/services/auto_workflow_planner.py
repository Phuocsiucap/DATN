from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.core.llm import ChatCompletionResult, deepseek_chat_completion, openai_chat_completion
from common.db.media_workflows import _image_urls, _load_content_full_text, _serialize_source_content, content_category_payload
from common.db.models import ContentItem, ContentSeries, MediaWorkflow, SocialProfile, SocialProfileStrategy
from common.db.prompt_runs import log_prompt_run
from app.video.services.generate_video_constants import DEFAULT_IMAGES
from app.video.services.generate_video_scripting import (
    build_fallback_timeline,
    enforce_timeline_target_duration,
    ensure_timeline_density,
    normalize_ai_timeline,
    resolve_target_duration_seconds,
    sanitize_series_decision,
)
from app.video.services.generate_video_timeline import normalize_story_for_project, public_story_payload


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
    ) -> AutoWorkflowDecision:
        settings = get_settings()
        provider = "openai" if settings.openai_api_key else ("deepseek" if settings.deepseek_api_key else "")
        if not provider:
            return AutoWorkflowDecision(
                should_create_workflow=False,
                reason="Missing LLM API key; auto workflow creation requires an AI decision.",
                metadata={"status": "SKIPPED_NO_API_KEY"},
            )

        source = self.script_source(db, profile=profile, strategy=strategy, content=content, candidate_metadata=candidate_metadata)
        image_urls = list(dict.fromkeys(_image_urls(content.media_jsonb if isinstance(content.media_jsonb, list) else [])))
        target_duration = resolve_target_duration_seconds(source) or 60
        fallback = enforce_timeline_target_duration(build_fallback_timeline(source, image_urls), target_duration, image_urls)
        active_series = source.get("active_series") if isinstance(source.get("active_series"), list) else []
        prompt_payload = {
            "task": "Auto planning gate and draft generation for one crawled content item.",
            "required_output": {
                "should_create_workflow": "boolean; true only if this content should become an automatic video workflow for the profile",
                "rejection_reason": "Vietnamese reason when should_create_workflow=false; otherwise null",
                "plan_title": "Vietnamese workflow/video title",
                "content_angle": "Vietnamese content angle",
                "target_audience": "Vietnamese target audience",
                "tone": "Vietnamese tone",
                "planning_mode": "SINGLE or SERIES",
                "confidence_score": "number 0-100",
                "risk_flags": [{"type": "GENERAL/SENSITIVE/FACTUAL", "severity": "LOW/MEDIUM/HIGH", "note": "Vietnamese note"}],
                "reasoning": ["Vietnamese reason 1", "Vietnamese reason 2"],
                "series_decision": {
                    "action": "USE_EXISTING, CREATE_NEW, or NONE",
                    "target_series_id": "existing active series id when action is USE_EXISTING; otherwise null",
                    "series_title": "broad reusable Vietnamese title when creating a new series; otherwise existing title or null",
                    "reason": "short Vietnamese reason",
                },
                "timeline": {
                    "version": 1,
                    "duration": "number seconds",
                    "metadata": {
                        "script_outline": {
                            "hook": "Vietnamese hook",
                            "main_beats": ["Vietnamese beat 1", "Vietnamese beat 2"],
                            "ending": "Vietnamese ending/CTA",
                        },
                        "full_script": "Full Vietnamese narration assembled from all voice_text values",
                    },
                    "video": [{"id": "video-1", "type": "image", "start": 0, "end": 4, "src": "image URL/path", "effect": "slow-zoom"}],
                    "text": [{"id": "text-1", "type": "subtitle", "start": 0, "end": 4, "text": "subtitle", "voice_text": "spoken text"}],
                    "audio": [],
                },
            },
            "rules": [
                "Return only valid JSON object, no markdown.",
                "This is the only LLM call for this auto planning article. Decide gate, series, story script, and draft timeline together.",
                "Reject if the content is weakly related to the strategy, conflicts with avoid_topics, is too risky for the configured risk_level, or lacks enough grounded detail.",
                "Use candidate.embedding_similarity, candidate.similarity_threshold, candidate.passed_similarity_gate, candidate.similarity_source, and candidate.top_topic_match as hard evidence. If top topic cosine is barely above threshold, be conservative.",
                "candidate.passed_similarity_gate must already be true before this LLM step runs. It means at least one configured content topic cosine reached Embedding Similarity Threshold. Avoid-topic matches were already used as a hard retrieval gate.",
                "Do not invent facts outside source_content.full_text, title, summary, category, or tags.",
                "If creating a workflow, timeline must be production-ready for a vertical Vietnamese short video.",
                "Also decide series in the same JSON response. Use active_series and their 5 recent_items.",
                "Prefer an active series with the same categoryId/category_id before comparing title or story content.",
                "If the content naturally continues one active series, set series_decision.action=USE_EXISTING and target_series_id to that exact id.",
                "If it should become a reusable topic but matches no active series, set action=CREATE_NEW with a broad long-lived Vietnamese series_title.",
                "Do not create a series_title from the exact one-off article title.",
                "For a 60 second target, create enough text/video clips for natural pacing; avoid sparse timelines.",
            ],
            "profile": {
                "id": str(profile.id),
                "name": profile.profile_name,
                "platform": profile.platform,
                "strategy": self.strategy_payload(strategy),
            },
            "candidate": {
                "content_id": str(content.id),
                "embedding_similarity": candidate_metadata.get("embedding_similarity"),
                "similarity_threshold": candidate_metadata.get("similarity_threshold"),
                "passed_similarity_gate": candidate_metadata.get("passed_similarity_gate"),
                "similarity_source": candidate_metadata.get("similarity_source"),
                "top_topic_match": candidate_metadata.get("top_topic_match"),
                "strategy_score": candidate_metadata.get("score_breakdown", {}).get("strategy_score") if isinstance(candidate_metadata.get("score_breakdown"), dict) else None,
                "quality_score": float(content.quality_score or 0),
                "matched_topics": candidate_metadata.get("matched_topics") or [],
                "topic_matches": candidate_metadata.get("topic_matches") or [],
                "avoided_topics": candidate_metadata.get("avoided_topics") or [],
                "avoid_topic_matches": candidate_metadata.get("avoid_topic_matches") or [],
                "blocked_by_avoid_topics": bool(candidate_metadata.get("blocked_by_avoid_topics")),
                "category": content_category_payload(content).get("category"),
            },
            "source_content": source.get("source_content"),
            "active_series": active_series,
            "target_duration_seconds": target_duration,
            "available_images": image_urls,
            "default_images": DEFAULT_IMAGES,
        }
        try:
            result = self.call_llm(settings, provider, prompt_payload)
            log_prompt_run(
                db=db,
                user_id=profile.user_id,
                reference_id=content.id,
                run_type="PLANNING",
                step_name="auto_workflow_gate_and_draft",
                result=result,
            )
            parsed = result.parsed_json()
            if not isinstance(parsed, dict):
                raise RuntimeError("Auto workflow planner did not return a JSON object")

            should_create = bool(parsed.get("should_create_workflow"))
            if not should_create:
                return AutoWorkflowDecision(
                    should_create_workflow=False,
                    provider=result.provider,
                    model=result.model,
                    confidence_score=self.as_float(parsed.get("confidence_score")),
                    reason=str(parsed.get("rejection_reason") or parsed.get("reason") or "AI rejected this content for auto workflow creation."),
                    metadata={"status": "AI_REJECTED", "raw_decision": self.compact_raw_decision(parsed)},
                )

            timeline = normalize_ai_timeline(parsed.get("timeline"), image_urls)
            timeline = enforce_timeline_target_duration(timeline, target_duration, image_urls)
            timeline = ensure_timeline_density(timeline, fallback, target_duration)
            series_decision = sanitize_series_decision(parsed.get("series_decision"), active_series)
            if series_decision:
                timeline_metadata = timeline.get("metadata") if isinstance(timeline.get("metadata"), dict) else {}
                timeline["metadata"] = {**timeline_metadata, "series_decision": series_decision}

            story = normalize_story_for_project(
                {
                    "meta": {
                        "title": str(parsed.get("plan_title") or content.canonical_title or "Auto workflow"),
                        "source": "auto_planning",
                        "draft_generation_mode": "single_pass_auto_gate_series_timeline",
                        "target_duration_seconds": target_duration,
                        "llm_calls": 1,
                        "user_id": str(profile.user_id),
                        "content_id": str(content.id),
                    },
                    "video": {"width": 1080, "height": 1920, "fps": 30, "background": "#05070b"},
                    "audio": {"voiceVolume": 1, "musicVolume": 0},
                    "source": source,
                    "timeline": timeline,
                }
            )
            public_story = public_story_payload(story)
            public_story["story_data"] = story.get("story_data") or []
            public_story["project_status"] = "EDITING"
            return AutoWorkflowDecision(
                should_create_workflow=True,
                provider=result.provider,
                model=result.model,
                confidence_score=self.as_float(parsed.get("confidence_score"), 85.0),
                reason=str(parsed.get("reason") or parsed.get("rejection_reason") or "AI approved auto workflow creation."),
                timeline=timeline,
                story=public_story,
                series_decision=series_decision,
                metadata={
                    "status": "AI_APPROVED",
                    "plan_title": parsed.get("plan_title"),
                    "content_angle": parsed.get("content_angle"),
                    "target_audience": parsed.get("target_audience"),
                    "tone": parsed.get("tone"),
                    "planning_mode": parsed.get("planning_mode"),
                    "risk_flags": parsed.get("risk_flags") if isinstance(parsed.get("risk_flags"), list) else [],
                    "reasoning": parsed.get("reasoning") if isinstance(parsed.get("reasoning"), list) else [],
                    "raw_decision": self.compact_raw_decision(parsed),
                },
            )
        except Exception as exc:
            log_prompt_run(
                db=db,
                user_id=profile.user_id,
                reference_id=content.id,
                run_type="PLANNING",
                step_name="auto_workflow_gate_and_draft",
                model_provider=provider,
                model_name=settings.openai_model if provider == "openai" else "deepseek-v4-flash",
                status="FAILED",
                error_message=str(exc),
            )
            return AutoWorkflowDecision(
                should_create_workflow=False,
                reason=f"AI auto workflow decision failed: {exc}",
                metadata={"status": "AI_ERROR"},
                error_message=str(exc),
            )

    def call_llm(self, settings: Any, provider: str, prompt_payload: dict[str, Any]) -> ChatCompletionResult:
        messages = [
            {
                "role": "system",
                "content": (
                    "Bạn là AI Auto Planner cho video ngắn tiếng Việt. "
                    "Bạn phải quyết định có tạo workflow không, chọn/tạo series, và sinh timeline draft trong cùng một JSON."
                ),
            },
            {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False, default=str)},
        ]
        if provider == "openai":
            return openai_chat_completion(
                api_key=settings.openai_api_key,
                model=settings.openai_model or "gpt-4o-mini",
                messages=messages,
                temperature=0.35,
                response_format={"type": "json_object"},
                timeout=60,
            )
        return deepseek_chat_completion(
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            model="deepseek-v4-flash",
            messages=messages,
            temperature=0.35,
            response_format={"type": "json_object"},
            timeout=60,
        )

    def script_source(
        self,
        db: Session,
        *,
        profile: SocialProfile,
        strategy: SocialProfileStrategy,
        content: ContentItem,
        candidate_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        source_content = _serialize_source_content(content) or {"id": str(content.id)}
        source_content["media"] = content.media_jsonb if isinstance(content.media_jsonb, list) else []
        full_text = source_content.get("full_text") or _load_content_full_text(content.mongo_normalized_id)
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
                "target_duration_seconds": 60,
                "production_requirements": {"requires_voice": True, "requires_subtitles": True, "requires_background_media": True},
            },
            "source_content": source_content,
            "raw_article": {"source_content": source_content},
            "active_series": self.active_series_for_profile(db, profile.id),
            "target_duration_seconds": 60,
        }

    def active_series_for_profile(self, db: Session, profile_id: uuid.UUID) -> list[dict[str, Any]]:
        rows = (
            db.query(ContentSeries)
            .filter(ContentSeries.profile_id == profile_id, ContentSeries.status == "ACTIVE")
            .order_by(ContentSeries.updated_at.desc())
            .limit(20)
            .all()
        )
        return [
            {
                **self.series_context_payload(series),
                "recent_items": self.recent_series_items(db, series.id),
            }
            for series in rows
        ]

    def recent_series_items(self, db: Session, series_id: uuid.UUID) -> list[dict[str, Any]]:
        rows = (
            db.query(MediaWorkflow)
            .filter(MediaWorkflow.series_id == series_id)
            .order_by(MediaWorkflow.updated_at.desc())
            .limit(5)
            .all()
        )
        result: list[dict[str, Any]] = []
        for workflow in rows:
            content = db.get(ContentItem, workflow.primary_content_id) if workflow.primary_content_id else None
            result.append(
                {
                    "workflow_id": str(workflow.id),
                    "title": workflow.title,
                    "summary": content.summary if content else None,
                    "primary_content_id": str(workflow.primary_content_id) if workflow.primary_content_id else None,
                    "status": workflow.status,
                    "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
                    **content_category_payload(content),
                }
            )
        return result

    def series_context_payload(self, series: ContentSeries) -> dict[str, Any]:
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

    def compact_raw_decision(self, value: dict[str, Any]) -> dict[str, Any]:
        return {
            key: value.get(key)
            for key in (
                "should_create_workflow",
                "rejection_reason",
                "plan_title",
                "content_angle",
                "planning_mode",
                "confidence_score",
                "risk_flags",
                "reasoning",
                "series_decision",
            )
            if key in value
        }

    @staticmethod
    def as_float(value: Any, fallback: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback
