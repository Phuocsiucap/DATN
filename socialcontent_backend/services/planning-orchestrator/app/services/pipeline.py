from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from common.db.idempotency import claim_event
from common.db.models import (
    ContentContext,
    ContentItem,
    ContentMedia,
    ContentPlan,
    ContentSeries,
    Episode,
    Module2Handoff,
    PlanningCandidate,
    PlanningJob,
    PromptRun,
    SeriesPart,
    SocialProfileStrategy,
    Story,
)
from common.db.mongo import planning_inputs, planning_outputs, series_contexts
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import (
    PLANNING_CONTEXT_COMPLETED,
    PLANNING_JOB_COMPLETED,
    PLANNING_JOB_FAILED,
    PLANNING_SERIES_COMPLETED,
)


from .ai_planner import AIPlannerService


class PlanningPipeline:
    consumer_name = "planning-orchestrator"

    def handle_planning_job_created(self, db: Session, message: dict[str, Any]) -> None:
        event_id = message.get("event_id")
        if event_id and not claim_event(db, event_id, self.consumer_name):
            return

        job_id = message.get("job_id") or message.get("payload", {}).get("job_id")
        job = db.get(PlanningJob, uuid.UUID(str(job_id))) if job_id else None
        if not job:
            return

        try:
            self._run(db, job)
        except Exception as exc:  # noqa: BLE001
            job.status = "FAILED"
            job.current_stage = "COMPLETED"
            job.progress_percent = 100
            job.error_code = exc.__class__.__name__
            job.error_message = str(exc)
            job.completed_at = datetime.utcnow()
            db.commit()
            publish(
                PLANNING_JOB_FAILED,
                build_event(
                    event_type=PLANNING_JOB_FAILED,
                    source=self.consumer_name,
                    job_id=job.id,
                    payload={"job_id": str(job.id), "error": str(exc)},
                ),
            )

    def _run(self, db: Session, job: PlanningJob) -> None:
        if job.status not in {"PENDING", "QUEUED", "FAILED", "PARTIAL_SUCCESS", "CANCELLED"}:
            return
        job.status = "RUNNING"
        job.started_at = datetime.utcnow()
        self._stage(db, job, "SELECTING_CANDIDATES", 15)

        handoff = db.get(Module2Handoff, job.handoff_id)
        strategy = db.query(SocialProfileStrategy).filter(SocialProfileStrategy.profile_id == job.profile_id).first()
        if not handoff or not strategy:
            raise ValueError("Missing handoff or profile strategy")

        candidates = self._score_candidates(db, job, strategy)
        if not candidates:
            raise ValueError("No eligible planning candidates")

        self._stage(db, job, "ANALYZING_CONTENT", 35)
        primary = candidates[0]
        input_ref = self._save_planning_input(job, strategy, candidates)
        plan_payload, provider_name, model_name, latency_ms, confidence = self._build_plan_payload(db, job, strategy, primary)
        output_ref = self._save_planning_output(job, "AI_PLANNER", plan_payload)
        prompt_run = PromptRun(
            planning_job_id=job.id,
            step_name="AI_PLANNER",
            model_provider=provider_name,
            model_name=model_name,
            prompt_version="ai-planner-v1",
            input_reference=input_ref,
            output_reference=output_ref,
            input_tokens=0,
            output_tokens=0,
            latency_ms=latency_ms,
            status="SUCCEEDED",
        )
        db.add(prompt_run)

        self._stage(db, job, "CREATING_PLAN", 50)
        plan = self._create_content_plan(db, job, primary, plan_payload)

        self._stage(db, job, "CREATING_SERIES", 68)
        series, parts = self._create_series(db, plan, primary)
        publish(PLANNING_SERIES_COMPLETED, build_event(event_type=PLANNING_SERIES_COMPLETED, source=self.consumer_name, job_id=job.id, payload={"series_id": str(series.id)}))

        self._stage(db, job, "BUILDING_CONTEXT", 84)
        context_id = self._create_context(db, series, parts, primary, plan)
        publish(PLANNING_CONTEXT_COMPLETED, build_event(event_type=PLANNING_CONTEXT_COMPLETED, source=self.consumer_name, job_id=job.id, payload={"series_id": str(series.id), "context_id": context_id}))

        self._stage(db, job, "VALIDATING_PLAN", 94)
        plan.status = "NEEDS_REVIEW"
        series.status = "NEEDS_REVIEW"
        job.status = "WAITING_REVIEW"
        job.current_stage = "COMPLETED"
        job.progress_percent = 100
        job.completed_at = datetime.utcnow()
        db.commit()
        publish(PLANNING_JOB_COMPLETED, build_event(event_type=PLANNING_JOB_COMPLETED, source=self.consumer_name, job_id=job.id, payload={"job_id": str(job.id), "plan_id": str(plan.id), "series_id": str(series.id)}))

    def _stage(self, db: Session, job: PlanningJob, stage: str, progress: int) -> None:
        job.current_stage = stage
        job.progress_percent = progress
        db.commit()

    def _score_candidates(self, db: Session, job: PlanningJob, strategy: SocialProfileStrategy) -> list[PlanningCandidate]:
        candidates = db.query(PlanningCandidate).filter(PlanningCandidate.planning_job_id == job.id, PlanningCandidate.eligible == True).all()  # noqa: E712
        topic_terms = self._split_terms(strategy.content_topics)
        avoid_terms = self._split_terms(strategy.avoid_topics)
        scored: list[PlanningCandidate] = []
        for candidate in candidates:
            title, summary, quality, language, media_count, episode_count = self._candidate_facts(db, candidate)
            haystack = f"{title} {summary}".lower()
            if any(term in haystack for term in avoid_terms):
                candidate.eligible = False
                candidate.rejection_reasons = ["Matched avoid_topics"]
                continue
            topic_score = 25 if not topic_terms else min(25, sum(8 for term in topic_terms if term in haystack))
            quality_score = min(10, int(float(quality or 0) / 10))
            completeness = 15 if summary else 8
            continuity = 15 if episode_count >= 3 else 8
            media = 5 if media_count else 2
            series_potential = 5 if episode_count >= 3 else 2
            total = topic_score + 12 + completeness + continuity + quality_score + 8 + media + series_potential
            candidate.candidate_score = min(100, total)
            candidate.score_breakdown = {
                "topic_match": topic_score,
                "audience_match": 12,
                "completeness": completeness,
                "continuity": continuity,
                "quality": quality_score,
                "freshness": 8,
                "media": media,
                "series_potential": series_potential,
            }
            candidate.selection_reasons = ["Rule-based score from strategy and canonical metadata", f"language={language}", f"episodes={episode_count}"]
            scored.append(candidate)
        scored.sort(key=lambda item: float(item.candidate_score), reverse=True)
        for index, candidate in enumerate(scored, start=1):
            candidate.rank_order = index
        db.commit()
        return scored

    def _candidate_facts(self, db: Session, candidate: PlanningCandidate) -> tuple[str, str, float, str, int, int]:
        content = db.get(ContentItem, candidate.content_id) if candidate.content_id else None
        story = db.get(Story, candidate.story_id) if candidate.story_id else None
        episode = db.get(Episode, candidate.episode_id) if candidate.episode_id else None
        if story and not content and story.content_id:
            content = db.get(ContentItem, story.content_id)
        if episode and not story:
            story = db.get(Story, episode.story_id)
        if episode and not content:
            content = db.get(ContentItem, episode.content_id)
        title = (story.canonical_name if story else None) or (content.canonical_title if content else None) or (episode.episode_title if episode else None) or "Untitled"
        summary = (story.description if story else None) or (content.summary if content else None) or ""
        quality = float(content.quality_score) if content else float(story.grouping_confidence) if story else 0
        language = (content.language if content else None) or (story.language if story else None) or "vi"
        media_count = db.query(ContentMedia).filter(ContentMedia.content_id == content.id).count() if content else 0
        episode_count = story.total_episodes if story else 1
        return title, summary, quality, language, media_count, episode_count

    def _build_plan_payload(
        self, db: Session, job: PlanningJob, strategy: SocialProfileStrategy, candidate: PlanningCandidate
    ) -> tuple[dict[str, Any], str, str, int, int]:
        title, summary, quality, _, _, episode_count = self._candidate_facts(db, candidate)
        return AIPlannerService().generate_plan(
            title=title,
            summary=summary,
            episode_count=episode_count,
            quality=quality,
            strategy_topics=strategy.content_topics,
            avoid_topics=strategy.avoid_topics,
            tone=strategy.tone,
            target_audience=strategy.target_audience,
            risk_level=strategy.risk_level,
            planning_mode=job.planning_mode,
            preferred_part_count=job.preferred_part_count,
            target_duration=job.target_duration_seconds,
            instructions=job.instructions,
        )

    def _create_content_plan(self, db: Session, job: PlanningJob, candidate: PlanningCandidate, payload: dict[str, Any]) -> ContentPlan:
        plan = ContentPlan(
            planning_job_id=job.id,
            profile_id=job.profile_id,
            primary_content_id=candidate.content_id,
            primary_story_id=candidate.story_id,
            title=payload["plan_title"],
            content_angle=payload["content_angle"],
            target_audience=payload["target_audience"],
            tone=payload["tone"],
            format=payload["format"],
            planning_mode=payload["planning_mode"],
            target_duration_seconds=payload["target_duration_seconds"],
            recommended_part_count=payload["recommended_part_count"],
            confidence_score=payload["confidence_score"],
            risk_level=payload["risk_flags"][0]["severity"],
            status="GENERATED",
            ai_reasoning=payload["reasoning"],
            production_requirements=payload["production_requirements"],
        )
        db.add(plan)
        db.flush()
        return plan

    def _create_series(self, db: Session, plan: ContentPlan, candidate: PlanningCandidate) -> tuple[ContentSeries, list[SeriesPart]]:
        part_count = max(1, plan.recommended_part_count or 1)
        series = ContentSeries(
            content_plan_id=plan.id,
            profile_id=plan.profile_id,
            title=plan.title,
            description=plan.content_angle,
            series_type="NARRATIVE" if part_count > 1 else "SINGLE",
            total_parts=part_count,
            current_part=0,
            status="GENERATED",
        )
        db.add(series)
        db.flush()
        parts: list[SeriesPart] = []
        source_refs = self._source_refs(db, candidate, part_count)
        for index in range(1, part_count + 1):
            part_type = "OPENING" if index == 1 else "ENDING" if index == part_count else "MIDDLE"
            part = SeriesPart(
                series_id=series.id,
                part_number=index,
                part_type=part_type,
                title=f"Phan {index}: {self._part_title(plan.title, index, part_count)}",
                goal=self._part_goal(index, part_count),
                hook_direction="Mo bang mot cau hoi hoac chi tiet gay to mo trong 3 giay dau.",
                ending_direction="Ket bang mot thong tin con bo ngo de dan sang phan tiep theo." if index < part_count else "Ket lai tron ven va nhac diem dang nho nhat.",
                previous_part_recap=None if index == 1 else f"Nhac nhanh diem chinh cua phan {index - 1}.",
                next_part_tease=None if index == part_count else f"Tease bien co quan trong o phan {index + 1}.",
                target_duration_seconds=plan.target_duration_seconds,
                status="READY_FOR_PRODUCTION" if plan.status == "APPROVED" else "DRAFT",
                source_refs=source_refs[index - 1] if index - 1 < len(source_refs) else [],
                main_beats=self._beats(index, part_count),
                production_notes={"voice": "narration", "subtitle": "required", "pace": "fast"},
                risk_notes=[],
            )
            db.add(part)
            parts.append(part)
        db.flush()
        return series, parts

    def _source_refs(self, db: Session, candidate: PlanningCandidate, part_count: int) -> list[list[dict[str, Any]]]:
        if candidate.story_id:
            episodes = db.query(Episode).filter(Episode.story_id == candidate.story_id).order_by(Episode.sequence_order.asc().nullslast(), Episode.episode_number.asc().nullslast()).all()
            if episodes:
                chunks = [[] for _ in range(part_count)]
                for index, episode in enumerate(episodes):
                    chunks[min(part_count - 1, int(index * part_count / max(1, len(episodes))))].append({"episode_id": str(episode.id)})
                return chunks
        ref: dict[str, Any] = {}
        if candidate.content_id:
            ref["content_id"] = str(candidate.content_id)
        if candidate.episode_id:
            ref["episode_id"] = str(candidate.episode_id)
        return [[ref] for _ in range(part_count)]

    def _create_context(self, db: Session, series: ContentSeries, parts: list[SeriesPart], candidate: PlanningCandidate, plan: ContentPlan) -> str:
        doc = {
            "series_id": str(series.id),
            "version": series.context_version,
            "story_summary": {
                "premise": plan.content_angle,
                "beginning": parts[0].goal if parts else "",
                "middle": "Cac phan giua day cao trao va giu continuity.",
                "ending": parts[-1].goal if parts else "",
                "themes": [plan.tone, plan.format],
            },
            "characters": [],
            "relationships": [],
            "story_events": [
                {"event_order": part.part_number, "event_type": part.part_type, "description": part.goal, "source_refs": part.source_refs, "importance": "HIGH" if part.part_type in {"OPENING", "ENDING"} else "MEDIUM"}
                for part in parts
            ],
            "narrative_coverage": [
                {"series_part_id": str(part.id), "covered_event_ids": [part.part_number], "introduced_character_ids": [], "open_questions": [part.next_part_tease] if part.next_part_tease else [], "resolved_questions": []}
                for part in parts
            ],
            "open_questions": [part.next_part_tease for part in parts if part.next_part_tease],
            "consistency_rules": ["Keep names stable", "Do not reveal later events early", "Avoid repeated beats"],
            "created_at": datetime.now(timezone.utc),
        }
        result = series_contexts().insert_one(doc)
        checksum = hashlib.sha256(str(doc).encode("utf-8")).hexdigest()
        db.add(ContentContext(series_id=series.id, context_type="SERIES_CONTEXT", version=series.context_version, mongo_document_id=str(result.inserted_id), checksum=checksum, is_active=True))
        db.flush()
        return str(result.inserted_id)

    def _save_planning_input(self, job: PlanningJob, strategy: SocialProfileStrategy, candidates: list[PlanningCandidate]) -> str:
        doc = {
            "planning_job_id": str(job.id),
            "profile_id": str(job.profile_id),
            "strategy_snapshot": {
                "content_topics": strategy.content_topics,
                "avoid_topics": strategy.avoid_topics,
                "tone": strategy.tone,
                "target_audience": strategy.target_audience,
                "risk_level": strategy.risk_level,
                "min_score": strategy.min_score,
            },
            "candidate_snapshot": [{"candidate_id": str(item.id), "score": float(item.candidate_score), "rank_order": item.rank_order} for item in candidates],
            "requirements": {"planning_mode": job.planning_mode, "target_duration_seconds": job.target_duration_seconds, "preferred_part_count": job.preferred_part_count, "language": job.language},
            "created_at": datetime.now(timezone.utc),
        }
        return str(planning_inputs().insert_one(doc).inserted_id)

    def _save_planning_output(self, job: PlanningJob, step: str, payload: dict[str, Any]) -> str:
        doc = {"planning_job_id": str(job.id), "step": step, "prompt_version": "rule-based-v1", "raw_response": payload, "parsed_response": payload, "validation_errors": [], "created_at": datetime.now(timezone.utc)}
        return str(planning_outputs().insert_one(doc).inserted_id)

    def _split_terms(self, value: str | None) -> list[str]:
        return [item.strip().lower() for item in (value or "").replace("\n", ",").split(",") if item.strip()]

    def _part_title(self, title: str, index: int, total: int) -> str:
        if index == 1:
            return "Mo dau"
        if index == total:
            return "Cao trao va ket"
        return "Bien co tiep theo"

    def _part_goal(self, index: int, total: int) -> str:
        if index == 1:
            return "Gioi thieu boi canh, nhan vat va mau thuan chinh."
        if index == total:
            return "Giai quyet cao trao va de lai an tuong cuoi."
        return "Day mach truyen bang mot bien co moi va giu suspense."

    def _beats(self, index: int, total: int) -> list[str]:
        if index == 1:
            return ["Dat hook", "Gioi thieu boi canh", "Mo ra cau hoi chinh"]
        if index == total:
            return ["Nang cao trao", "Giai thich chi tiet quan trong", "Ket thuc co cam xuc"]
        return ["Recap rat ngan", "Su kien moi", "Ket bang tease"]
