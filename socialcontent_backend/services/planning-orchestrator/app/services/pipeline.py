from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from common.db.content_projects import sync_project_from_plan
from common.db.models import (
    ContentItem,
    ContentMedia,
    ContentPlan,
    ContentSource,
    Episode,
    ProjectArtifact,
    ProjectCandidate,
    ProjectPart,
    ProjectRun,
    ProjectSeries,
    PromptRun,
    SocialProfileStrategy,
    Story,
)
from common.db.mongo import planning_inputs, planning_outputs, series_contexts
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import (
    PLANNING_CONTEXT_COMPLETED,
    PROJECT_RUN_COMPLETED,
    PROJECT_RUN_FAILED,
    PLANNING_SERIES_COMPLETED,
)

from .ai_planner import AIPlannerService
from .context_manager import ContextManagerService
from .series_planner import SeriesPlannerService
from .embeddings import EmbeddingService


class PlanningPipeline:
    consumer_name = "planning-orchestrator"

    def handle_project_run_created(self, db: Session, message: dict[str, Any]) -> None:
        job_id = message.get("job_id") or message.get("payload", {}).get("job_id")
        job = db.get(ProjectRun, uuid.UUID(str(job_id))) if job_id else None
        if not job or job.run_type != "PLANNING":
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
            self._sync_project_from_run(job)
            db.commit()
            publish(
                PROJECT_RUN_FAILED,
                build_event(
                    event_type=PROJECT_RUN_FAILED,
                    source=self.consumer_name,
                    job_id=job.id,
                    payload={"job_id": str(job.id), "error": str(exc)},
                ),
            )

    def _run(self, db: Session, job: ProjectRun) -> None:
        if job.status not in {"PENDING", "QUEUED", "RUNNING", "FAILED", "PARTIAL_SUCCESS", "CANCELLED"}:
            return
        job.status = "RUNNING"
        if not job.started_at:
            job.started_at = datetime.utcnow()

        strategy = db.query(SocialProfileStrategy).filter(SocialProfileStrategy.profile_id == job.profile_id).first()
        if not job.project or not strategy:
            raise ValueError("Missing content project or profile strategy")

        skip_ai_evaluation = self._should_skip_ai_evaluation(job)
        self._stage(db, job, "SELECTING_CANDIDATES", 15)
        candidates = self._direct_candidates(db, job) if skip_ai_evaluation else self._score_candidates(db, job, strategy)
        if not candidates:
            raise ValueError("No eligible project candidates")

        # 1. Thu thập Active Series của profile
        active_series = self._get_active_series(db, job.profile_id)

        # 2. AI Planner: Lặp qua từng candidate, dùng LLM làm màng lọc cuối cùng
        self._stage(db, job, "ANALYZING_CONTENT", 35)

        approved_plans = 0
        input_ref = ""
        min_score = 0 if skip_ai_evaluation else (strategy.min_score if strategy.min_score is not None else 70)

        for candidate in candidates:
            if not skip_ai_evaluation and candidate.candidate_score < min_score:
                # Vì mảng đã được sort giảm dần, nên nếu điểm thấp hơn chuẩn thì dừng luôn.
                break

            title, summary, quality, _, _, _ = self._candidate_facts(db, candidate)

            # Ghi nhận input cho candidate này
            input_ref = self._save_planning_input(job, strategy, [candidate])

            payload, p_name, m_name, lat, confidence = self._build_plan_payload(
                db, job, strategy, candidate, active_series, skip_ai_evaluation=skip_ai_evaluation
            )

            output_ref = self._save_planning_output(job, "AI_PLANNER", payload)

            if not skip_ai_evaluation and not payload.get("is_suitable", True):
                # LLM từ chối bài này
                prompt_run_planner = PromptRun(
                    project_run_id=job.id,
                    step_name="AI_PLANNER_VALIDATION",
                    model_provider=p_name,
                    model_name=m_name,
                    prompt_version="ai-planner-v2",
                    input_reference=input_ref,
                    output_reference=output_ref,
                    input_tokens=0,
                    output_tokens=0,
                    latency_ms=lat,
                    status="FAILED",
                    error_message=payload.get("rejection_reason")
                )
                db.add(prompt_run_planner)
                candidate.eligible = False
                candidate.rejection_reasons = [f"LLM Rejected: {payload.get('rejection_reason')}"]
                db.commit()
                continue # Thử bài tiếp theo!

            # Nếu LLM đồng ý (is_suitable = True)
            primary = candidate
            plan_payload = payload
            self._force_single_part_for_direct_request(job, plan_payload)
            self._force_single_part_for_article(db, job, primary, plan_payload)
            provider_name = p_name
            model_name = m_name
            latency_ms = lat

            prompt_run_planner = PromptRun(
                project_run_id=job.id,
                step_name="AI_PLANNER",
                model_provider=provider_name,
                model_name=model_name,
                prompt_version="ai-planner-direct-v1" if skip_ai_evaluation else "ai-planner-v2",
                input_reference=input_ref,
                output_reference=output_ref,
                input_tokens=0,
                output_tokens=0,
                latency_ms=latency_ms,
                status="SUCCEEDED",
            )
            db.add(prompt_run_planner)
            db.commit()

            # Xử lý tạo Plan, Series, Context
            self._process_approved_candidate(db, job, primary, plan_payload, summary, input_ref)
            approved_plans += 1

        if approved_plans == 0:
            raise ValueError("LLM đã từ chối toàn bộ các Ứng viên vì không phù hợp với chiến lược (Tone/Audience/Topics).")

        # 7. Hoàn tất pipeline
        self._stage(db, job, "VALIDATING_PLAN", 94)
        job.status = "WAITING_REVIEW"
        job.current_stage = "COMPLETED"
        job.progress_percent = 100
        job.completed_at = datetime.utcnow()
        self._sync_project_from_run(job)
        db.commit()

        publish(
            PROJECT_RUN_COMPLETED,
            build_event(
                event_type=PROJECT_RUN_COMPLETED,
                source=self.consumer_name,
                job_id=job.id,
                payload={"job_id": str(job.id), "approved_plans": approved_plans},
            ),
        )


    def _process_approved_candidate(self, db, job, primary, plan_payload, summary, input_ref):
        self._stage(db, job, "CREATING_PLAN", 50)
        plan = self._create_content_plan(db, job, primary, plan_payload)
        project = job.project
        sync_project_from_plan(db, plan)

        self._stage(db, job, "CREATING_SERIES", 68)

        part_count = max(1, plan.recommended_part_count or 1)
        source_refs = self._source_refs(db, primary, part_count)
        use_inline_article_script = self._should_use_inline_article_script(db, job, primary, part_count)
        source_context = self._candidate_source_context(db, primary)
        source_excerpt = source_context["excerpt"]
        use_standalone_part = self._should_use_standalone_part(job, plan_payload, part_count)

        if use_standalone_part:
            parts_payload = [
                self._inline_single_part_payload(
                    plan_payload,
                    part_number=1,
                    target_duration=plan.target_duration_seconds or 60,
                )
            ]
            for idx, p_data in enumerate(parts_payload):
                part = ProjectPart(
                    project_id=project.id,
                    series_id=None,
                    part_number=p_data["part_number"],
                    title=p_data["title"],
                    target_duration_seconds=p_data["target_duration_seconds"],
                    status="DRAFT",
                    payload={
                        "part_type": p_data["part_type"],
                        "goal": p_data["goal"],
                        "hook_direction": p_data["hook_direction"],
                        "ending_direction": p_data["ending_direction"],
                        "previous_part_recap": p_data["previous_part_recap"],
                        "next_part_tease": p_data["next_part_tease"],
                        "target_duration_seconds": p_data["target_duration_seconds"],
                        "source_refs": source_refs[idx] if idx < len(source_refs) else [],
                        "main_beats": p_data["main_beats"],
                        "production_notes": p_data["production_notes"],
                        "risk_notes": p_data["risk_notes"],
                        "content_plan_id": str(plan.id),
                    },
                )
                db.add(part)
            project.series_id = None
            db.flush()
            return

        existing_series = self._find_existing_series(db, job.profile_id, primary.story_id, plan_payload.get("target_series_id"))
        mode = "CONTINUE" if existing_series else "NEW"

        if existing_series:
            series = existing_series
            recent_articles = self._series_recent_articles(db, series, limit=5)
            existing_parts_data = [self._part_context_payload(part) for part in series.parts]
            continuation_from = len(series.parts) + 1
            planner_mode = "CONTINUE"
            planner_title = series.title
        else:
            series = ProjectSeries(
                user_id=job.user_id,
                profile_id=job.profile_id,
                title=plan.title,
                description=plan.content_angle,
                series_type="NARRATIVE" if part_count > 1 else "SINGLE",
                status="ACTIVE",
                current_part=0,
                total_parts=0,
                metadata_json={
                    "content_plan_id": str(plan.id),
                    "project_run_id": str(job.id),
                    "source_story_id": str(primary.story_id) if primary.story_id else None,
                },
            )
            db.add(series)
            db.flush()
            recent_articles = []
            existing_parts_data = []
            continuation_from = 1
            planner_mode = "NEW"
            planner_title = plan.title

        if use_inline_article_script:
            parts_payload = [
                self._inline_single_part_payload(
                    plan_payload,
                    part_number=continuation_from,
                    target_duration=plan.target_duration_seconds or 60,
                )
            ]
        else:
            parts_payload, sp_provider, sp_model, sp_latency = SeriesPlannerService().plan_series(
                mode=planner_mode,
                title=planner_title,
                summary=summary,
                source_excerpt=source_excerpt,
                plan_angle=plan.content_angle or "",
                tone=plan.tone or "",
                part_count=part_count,
                target_duration=plan.target_duration_seconds or 60,
                existing_parts=existing_parts_data,
                recent_articles=recent_articles,
                continuation_from_part=continuation_from,
                instructions=job.instructions,
            )
            sp_output_ref = self._save_planning_output(job, "SERIES_PLANNER", {"parts": parts_payload})
            db.add(
                PromptRun(
                    project_run_id=job.id,
                    step_name="SERIES_PLANNER",
                    model_provider=sp_provider,
                    model_name=sp_model,
                    prompt_version="series-planner-v1",
                    input_reference=input_ref,
                    output_reference=sp_output_ref,
                    input_tokens=0,
                    output_tokens=0,
                    latency_ms=sp_latency,
                    status="SUCCEEDED",
                )
            )

        for idx, p_data in enumerate(parts_payload):
            part = ProjectPart(
                project_id=project.id,
                series_id=series.id,
                part_number=p_data["part_number"],
                title=p_data["title"],
                target_duration_seconds=p_data["target_duration_seconds"],
                status="DRAFT",
                payload={
                    "part_type": p_data["part_type"],
                    "goal": p_data["goal"],
                    "hook_direction": p_data["hook_direction"],
                    "ending_direction": p_data["ending_direction"],
                    "previous_part_recap": p_data["previous_part_recap"],
                    "next_part_tease": p_data["next_part_tease"],
                    "target_duration_seconds": p_data["target_duration_seconds"],
                    "source_refs": source_refs[idx] if idx < len(source_refs) else [],
                    "main_beats": p_data["main_beats"],
                    "production_notes": p_data["production_notes"],
                    "risk_notes": p_data["risk_notes"],
                    "content_plan_id": str(plan.id),
                },
            )
            db.add(part)

        series.total_parts = max(series.total_parts or 0, continuation_from + len(parts_payload) - 1)
        series.metadata_json = {**(series.metadata_json or {}), "content_plan_id": str(plan.id), "last_project_id": str(project.id)}
        project.series_id = series.id
        db.flush()

        publish(
            PLANNING_SERIES_COMPLETED,
            build_event(
                event_type=PLANNING_SERIES_COMPLETED,
                source=self.consumer_name,
                job_id=job.id,
                payload={"series_id": str(series.id), "project_id": str(project.id), "mode": mode},
            ),
        )

        self._stage(db, job, "BUILDING_CONTEXT", 84)
        existing_ctx_doc = self._load_existing_context(series) if mode == "CONTINUE" else None
        ctx_doc, cm_provider, cm_model, cm_latency = ContextManagerService().build_or_update_context(
            mode=mode,
            series_id=str(series.id),
            title=series.title,
            content_angle=plan.content_angle or "",
            tone=plan.tone or "",
            parts=parts_payload,
            existing_context_doc=existing_ctx_doc,
            instructions=job.instructions,
        )

        cm_output_ref = self._save_planning_output(job, "CONTEXT_MANAGER", ctx_doc)
        db.add(
            PromptRun(
                project_run_id=job.id,
                step_name="CONTEXT_MANAGER",
                model_provider=cm_provider,
                model_name=cm_model,
                prompt_version="context-manager-v1",
                input_reference=input_ref,
                output_reference=cm_output_ref,
                input_tokens=0,
                output_tokens=0,
                latency_ms=cm_latency,
                status="SUCCEEDED",
            )
        )

        result = series_contexts().insert_one(ctx_doc)
        checksum = hashlib.sha256(str(ctx_doc).encode("utf-8")).hexdigest()
        series.context_json = {"mongo_document_id": str(result.inserted_id), "checksum": checksum, "version": (series.context_json or {}).get("version", 0) + 1}
        db.add(ProjectArtifact(project_id=project.id, artifact_type="SERIES_CONTEXT", uri=str(result.inserted_id), status="READY", metadata_json={"series_id": str(series.id), "checksum": checksum}))
        db.flush()

        publish(
            PLANNING_CONTEXT_COMPLETED,
            build_event(
                event_type=PLANNING_CONTEXT_COMPLETED,
                source=self.consumer_name,
                job_id=job.id,
                payload={"series_id": str(series.id), "context_id": str(result.inserted_id), "project_id": str(project.id), "mode": mode},
            ),
        )

    def _get_active_series(self, db: Session, profile_id: uuid.UUID) -> list[dict[str, Any]]:
        series_items = (
            db.query(ProjectSeries)
            .filter(ProjectSeries.profile_id == profile_id, ProjectSeries.status.in_(["ACTIVE", "PAUSED"]))
            .order_by(ProjectSeries.updated_at.desc())
            .limit(100)
            .all()
        )
        result = []
        for series in series_items:
            result.append(
                {
                    "series_id": str(series.id),
                    "story_id": (series.metadata_json or {}).get("source_story_id"),
                    "title": series.title,
                    "current_part": series.current_part,
                    "total_parts": series.total_parts,
                    "recent_articles": self._series_recent_articles(db, series, limit=5),
                }
            )
        return result

    def _series_recent_articles(self, db: Session, series: ProjectSeries, limit: int = 5) -> list[dict[str, Any]]:
        parts = (
            db.query(ProjectPart)
            .filter(ProjectPart.series_id == series.id)
            .order_by(ProjectPart.updated_at.desc(), ProjectPart.part_number.desc())
            .limit(limit * 4)
            .all()
        )
        articles: list[dict[str, Any]] = []
        seen_keys: set[str] = set()
        fallback_plan_id = (series.metadata_json or {}).get("content_plan_id")
        fallback_plan = db.get(ContentPlan, uuid.UUID(str(fallback_plan_id))) if fallback_plan_id else None

        for part in parts:
            key, content_id, story_id = self._part_source_identity(db, part)
            if key in seen_keys:
                continue
            seen_keys.add(key)

            plan = self._find_plan_for_source(db, series.profile_id, content_id, story_id) or fallback_plan
            content = db.get(ContentItem, content_id) if content_id else None
            story = db.get(Story, story_id) if story_id else None

            articles.append(
                {
                    "plan_id": str(plan.id) if plan else None,
                    "content_id": str(content_id) if content_id else None,
                    "story_id": str(story_id) if story_id else None,
                    "title": (plan.title if plan else None) or (story.canonical_name if story else None) or (content.canonical_title if content else None) or part.title,
                    "summary": (story.description if story else None) or (content.summary if content else None) or "",
                    "content_angle": plan.content_angle if plan else None,
                    "latest_script_title": part.title,
                    "latest_script_goal": (part.payload or {}).get("goal"),
                    "updated_at": part.updated_at.isoformat() if part.updated_at else None,
                }
            )
            if len(articles) >= limit:
                break

        return articles

    def _part_context_payload(self, part: ProjectPart) -> dict[str, Any]:
        payload = part.payload or {}
        return {
            "part_number": part.part_number,
            "part_type": payload.get("part_type"),
            "title": part.title,
            "goal": payload.get("goal"),
            "hook_direction": payload.get("hook_direction"),
            "ending_direction": payload.get("ending_direction"),
        }

    def _part_source_identity(self, db: Session, part: ProjectPart) -> tuple[str, uuid.UUID | None, uuid.UUID | None]:
        for ref in (part.payload or {}).get("source_refs") or []:
            if not isinstance(ref, dict):
                continue
            if ref.get("content_id"):
                content_id = uuid.UUID(str(ref["content_id"]))
                return f"content:{content_id}", content_id, None
            if ref.get("story_id"):
                story_id = uuid.UUID(str(ref["story_id"]))
                return f"story:{story_id}", None, story_id
            if ref.get("episode_id"):
                episode_id = uuid.UUID(str(ref["episode_id"]))
                episode = db.get(Episode, episode_id)
                if episode and episode.content_id:
                    return f"content:{episode.content_id}", episode.content_id, episode.story_id
                if episode and episode.story_id:
                    return f"story:{episode.story_id}", None, episode.story_id
                return f"episode:{episode_id}", None, None
        return f"part:{part.id}", None, None

    def _find_plan_for_source(
        self,
        db: Session,
        profile_id: uuid.UUID,
        content_id: uuid.UUID | None,
        story_id: uuid.UUID | None,
    ) -> ContentPlan | None:
        query = db.query(ContentPlan).filter(ContentPlan.profile_id == profile_id)
        if content_id:
            plan = query.filter(ContentPlan.primary_content_id == content_id).order_by(ContentPlan.updated_at.desc()).first()
            if plan:
                return plan
        if story_id:
            return query.filter(ContentPlan.primary_story_id == story_id).order_by(ContentPlan.updated_at.desc()).first()
        return None

    def _find_existing_series(
        self,
        db: Session,
        profile_id: uuid.UUID,
        story_id: uuid.UUID | None,
        target_series_id_str: str | None,
    ) -> ProjectSeries | None:
        if target_series_id_str:
            try:
                target_uuid = uuid.UUID(str(target_series_id_str))
                series = db.get(ProjectSeries, target_uuid)
                if series and series.profile_id == profile_id:
                    return series
            except Exception:
                pass
        if story_id:
            story_key = str(story_id)
            for series in db.query(ProjectSeries).filter(ProjectSeries.profile_id == profile_id).order_by(ProjectSeries.updated_at.desc()).limit(100).all():
                if (series.metadata_json or {}).get("source_story_id") == story_key:
                    return series
        return None

    def _load_existing_context(self, series: ProjectSeries) -> dict[str, Any] | None:
        try:
            doc = series_contexts().find_one({"series_id": str(series.id)}, sort=[("version", -1)])
            if doc:
                doc["_id"] = str(doc["_id"])
            return doc
        except Exception:
            return None

    def _stage(self, db: Session, job: ProjectRun, stage: str, progress: int) -> None:
        job.current_stage = stage
        job.progress_percent = progress
        self._sync_project_from_run(job)
        db.commit()

    def _sync_project_from_run(self, run: ProjectRun) -> None:
        project = run.project
        if not project:
            return
        project.current_stage = run.current_stage
        project.progress_percent = run.progress_percent or 0
        if run.status in {"QUEUED", "RUNNING", "PENDING"}:
            project.status = "PLANNING_RUNNING"
        elif run.status == "WAITING_REVIEW":
            project.status = "PLAN_READY"
        elif run.status in {"FAILED", "CANCELLED"}:
            project.status = "FAILED"
        elif run.status in {"SUCCEEDED", "PARTIAL_SUCCESS"}:
            project.status = "PLAN_READY"

    def _should_skip_ai_evaluation(self, job: ProjectRun) -> bool:
        metadata = job.metadata_json if isinstance(job.metadata_json, dict) else {}
        if bool(metadata.get("skip_ai_evaluation")):
            return True
        instructions = (metadata.get("instructions") or "").lower()
        return "manual_direct_script" in instructions or "bỏ qua chấm điểm" in instructions or "bo qua cham diem" in instructions

    def _force_single_part_for_direct_request(self, job: ProjectRun, payload: dict[str, Any]) -> None:
        if job.preferred_part_count and job.preferred_part_count > 1:
            return
        if self._instructions_request_multiple_parts(job.instructions):
            return
        if (job.planning_mode or "").upper() != "SINGLE" and not self._should_skip_ai_evaluation(job):
            return

        payload["planning_mode"] = "SINGLE"
        payload["recommended_part_count"] = 1
        payload["target_series_id"] = None
        requirements = payload.get("production_requirements")
        if isinstance(requirements, dict):
            requirements["requires_character_consistency"] = False
        script_part = payload.get("script_part")
        if isinstance(script_part, dict):
            script_part["part_type"] = "OPENING"
            script_part["previous_part_recap"] = None
            script_part["next_part_tease"] = None

    def _direct_candidates(self, db: Session, job: ProjectRun) -> list[ProjectCandidate]:
        candidates = (
            db.query(ProjectCandidate)
            .filter(
                ProjectCandidate.project_id == job.project_id,
                ProjectCandidate.eligible == True,  # noqa: E712
            )
            .order_by(ProjectCandidate.rank_order.asc().nullslast(), ProjectCandidate.created_at.asc())
            .all()
        )
        for index, candidate in enumerate(candidates, start=1):
            candidate.candidate_score = 100
            candidate.rank_order = index
            candidate.eligible = True
            candidate.score_breakdown = {
                "direct_script": 100,
                "scoring_bypassed": True,
            }
            candidate.selection_reasons = ["Manual direct script request: skipped scoring and suitability evaluation"]
            candidate.rejection_reasons = []
        db.commit()
        return candidates

    def _score_candidates(self, db: Session, job: ProjectRun, strategy: SocialProfileStrategy) -> list[ProjectCandidate]:
        import re as _re
        candidates = db.query(ProjectCandidate).filter(
            ProjectCandidate.project_id == job.project_id,
            ProjectCandidate.eligible == True,  # noqa: E712
        ).all()
        topic_terms = self._split_terms(strategy.content_topics)
        avoid_terms = self._split_terms(strategy.avoid_topics)

        # Neu chua cau hinh topics -> khong the auto chon noi dung phu hop -> skip job
        if not topic_terms:
            raise ValueError(
                "Chua cau hinh 'Content Topics' cho profile nay. "
                "Vui long them chu de noi dung trong phan Config cua profile truoc khi bat Auto Planning."
            )

        # Tao embedding vector cho tung topic
        emb_service = EmbeddingService()
        topic_vectors: list = []
        try:
            topic_vectors = emb_service.create_embeddings(topic_terms, is_query=True)
        except Exception as e:
            print("Loi embedding topics:", e)

        scored: list[ProjectCandidate] = []
        for candidate in candidates:
            content = db.get(ContentItem, candidate.content_id) if candidate.content_id else None

            # Loai Homepage / RSS feed
            if content and content.canonical_url:
                url = content.canonical_url.lower()
                if url.endswith(".rss") or url.endswith(".xml") or bool(_re.match(r"^https?://[^/]+/?$", url)):
                    candidate.eligible = False
                    candidate.rejection_reasons = ["Khong phai bai viet (Homepage hoac RSS)"]
                    continue

            title, summary, quality, language, media_count, episode_count = self._candidate_facts(db, candidate)
            haystack = f"{title} {summary}".lower()

            # Loc avoid_topics
            if any(term in haystack for term in avoid_terms):
                candidate.eligible = False
                candidate.rejection_reasons = ["Khop avoid_topics"]
                continue

            # Tinh Cosine Similarity (0.0 -> 1.0)
            similarity = 0.0
            best_topic = None
            if topic_vectors and content:
                try:
                    content_emb = emb_service.refresh_content_embedding(db, content)
                    content_vector = [float(v) for v in content_emb.embedding]
                    sims = [emb_service.cosine_similarity(t_vec, content_vector) for t_vec in topic_vectors]
                    if sims:
                        similarity = max(sims)
                        best_topic = topic_terms[sims.index(similarity)]
                except Exception as e:
                    print("Loi tinh similarity:", e)

            if similarity > 0:
                topic_score = round(similarity * 100, 1)
                reason = f"Cosine {similarity:.3f} voi chu de '{best_topic}'"
            else:
                hits = sum(1 for t in topic_terms if t in haystack)
                topic_score = round(min(100.0, hits * (100.0 / max(len(topic_terms), 1))), 1) if hits else 0.0
                reason = f"Khop {hits}/{len(topic_terms)} tu khoa" if hits else "Khong khop chu de nao"

            candidate.candidate_score = round(min(100.0, topic_score), 1)
            candidate.score_breakdown = {
                "embedding_relevance": round(topic_score, 1),
                "cosine_similarity": round(similarity, 4),
                "quality_score": float(quality or 0),
                "has_media": bool(media_count),
                "has_summary": bool(summary),
            }
            candidate.selection_reasons = [reason, f"language={language}"]
            scored.append(candidate)

        scored.sort(key=lambda c: float(c.candidate_score), reverse=True)
        for i, c in enumerate(scored, start=1):
            c.rank_order = i
        db.commit()
        return scored

    def _candidate_facts(self, db: Session, candidate: ProjectCandidate) -> tuple[str, str, float, str, int, int]:
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

    def _candidate_source_context(self, db: Session, candidate: ProjectCandidate) -> dict[str, Any]:
        content = db.get(ContentItem, candidate.content_id) if candidate.content_id else None
        story = db.get(Story, candidate.story_id) if candidate.story_id else None
        episode = db.get(Episode, candidate.episode_id) if candidate.episode_id else None
        if story and not content and story.content_id:
            content = db.get(ContentItem, story.content_id)
        if episode and not content:
            content = db.get(ContentItem, episode.content_id)
        if story and not content:
            story_episodes = (
                db.query(Episode)
                .filter(Episode.story_id == story.id, Episode.content_id.isnot(None))
                .order_by(Episode.sequence_order.asc().nullslast(), Episode.episode_number.asc().nullslast())
                .limit(5)
                .all()
            )
            episode_excerpts: list[str] = []
            for story_episode in story_episodes:
                episode_content = db.get(ContentItem, story_episode.content_id)
                if not episode_content:
                    continue
                episode_sources = (
                    db.query(ContentSource)
                    .filter(ContentSource.content_id == episode_content.id)
                    .order_by(ContentSource.is_primary.desc(), ContentSource.first_seen_at.desc())
                    .limit(2)
                    .all()
                )
                episode_text = self._load_content_full_text(episode_sources) or episode_content.summary or ""
                if episode_text:
                    label = story_episode.episode_title or episode_content.canonical_title
                    episode_excerpts.append(f"{label}:\n{self._build_source_excerpt(episode_text, episode_content.summary or '', limit=1300)}")
            if episode_excerpts:
                return {
                    "excerpt": "\n\n".join(episode_excerpts),
                    "full_text_available": True,
                    "source_url": None,
                    "source_type": "STORY_EPISODES",
                }
        if not content:
            return {"excerpt": "", "full_text_available": False, "source_url": None, "source_type": None}

        sources = (
            db.query(ContentSource)
            .filter(ContentSource.content_id == content.id)
            .order_by(ContentSource.is_primary.desc(), ContentSource.first_seen_at.desc())
            .limit(3)
            .all()
        )
        full_text = self._load_content_full_text(sources)
        excerpt = self._build_source_excerpt(full_text or "", content.summary or "")
        primary_source = sources[0] if sources else None
        return {
            "excerpt": excerpt,
            "full_text_available": bool(full_text),
            "source_url": (primary_source.source_url if primary_source else None) or content.canonical_url,
            "source_type": primary_source.source_type if primary_source else None,
        }

    def _load_content_full_text(self, sources: list[ContentSource]) -> str | None:
        try:
            from bson import ObjectId
            from common.db.mongo import processed_documents, raw_documents

            proc_coll = processed_documents()
            raw_coll = raw_documents()
            for source in sources:
                metadata = dict(source.metadata_json or {})
                proc_id_str = metadata.get("processed_document_id")
                if proc_id_str:
                    try:
                        proc_doc = proc_coll.find_one({"_id": ObjectId(proc_id_str)})
                        if proc_doc and "normalized" in proc_doc:
                            full_text = proc_doc["normalized"].get("content") or proc_doc["normalized"].get("description")
                            if full_text:
                                return str(full_text)
                    except Exception:
                        pass
                if source.raw_document_id:
                    try:
                        raw_doc = raw_coll.find_one({"_id": ObjectId(source.raw_document_id)})
                        if raw_doc and "raw" in raw_doc:
                            full_text = raw_doc["raw"].get("text") or raw_doc["raw"].get("raw_text")
                            if full_text:
                                return str(full_text)
                    except Exception:
                        pass
        except Exception as exc:
            print("Error fetching full text for planning:", exc)
        return None

    def _build_source_excerpt(self, full_text: str, summary: str, limit: int = 6500) -> str:
        text = " ".join((full_text or "").split())
        if not text:
            return summary or ""
        if len(text) <= limit:
            return text
        head_size = int(limit * 0.45)
        middle_size = int(limit * 0.35)
        tail_size = limit - head_size - middle_size
        middle_start = max(0, (len(text) // 2) - (middle_size // 2))
        return "\n...\n".join(
            [
                text[:head_size],
                text[middle_start:middle_start + middle_size],
                text[-tail_size:],
            ]
        )

    def _build_plan_payload(
        self,
        db: Session,
        job: ProjectRun,
        strategy: SocialProfileStrategy,
        candidate: ProjectCandidate,
        active_series: list[dict[str, Any]] | None = None,
        skip_ai_evaluation: bool = False,
    ) -> tuple[dict[str, Any], str, str, int, int]:
        title, summary, quality, _, _, episode_count = self._candidate_facts(db, candidate)
        content = db.get(ContentItem, candidate.content_id) if candidate.content_id else None
        content_type = content.content_type if content else ("STORY" if candidate.story_id else "UNKNOWN")
        source_context = self._candidate_source_context(db, candidate)
        return AIPlannerService().generate_plan(
            title=title,
            summary=summary,
            content_type=content_type,
            source_excerpt=source_context["excerpt"],
            source_url=source_context["source_url"],
            source_type=source_context["source_type"],
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
            active_series=active_series,
            instructions=job.instructions,
            skip_ai_evaluation=skip_ai_evaluation,
        )

    def _create_content_plan(self, db: Session, job: ProjectRun, candidate: ProjectCandidate, payload: dict[str, Any]) -> ContentPlan:
        plan = ContentPlan(
            project_id=job.project_id,
            project_run_id=job.id,
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

    def _force_single_part_for_article(self, db: Session, job: ProjectRun, candidate: ProjectCandidate, payload: dict[str, Any]) -> None:
        content = db.get(ContentItem, candidate.content_id) if candidate.content_id else None
        if not content or (content.content_type or "").upper() != "ARTICLE":
            return
        if job.preferred_part_count and job.preferred_part_count > 1:
            return
        if self._instructions_request_multiple_parts(job.instructions):
            return
        payload["planning_mode"] = "SINGLE"
        payload["recommended_part_count"] = 1
        requirements = payload.get("production_requirements")
        if isinstance(requirements, dict):
            requirements["requires_character_consistency"] = False

    def _should_use_inline_article_script(self, db: Session, job: ProjectRun, candidate: ProjectCandidate, part_count: int) -> bool:
        if part_count != 1 or candidate.story_id or candidate.episode_id:
            return False
        if job.preferred_part_count and job.preferred_part_count > 1:
            return False
        if self._instructions_request_multiple_parts(job.instructions):
            return False
        content = db.get(ContentItem, candidate.content_id) if candidate.content_id else None
        return bool(content and (content.content_type or "").upper() == "ARTICLE")

    def _should_use_standalone_part(self, job: ProjectRun, payload: dict[str, Any], part_count: int) -> bool:
        if part_count != 1:
            return False
        if payload.get("target_series_id"):
            return False
        if self._instructions_request_multiple_parts(job.instructions):
            return False
        return (payload.get("planning_mode") or job.planning_mode or "").upper() == "SINGLE"

    def _instructions_request_multiple_parts(self, instructions: str | None) -> bool:
        if not instructions:
            return False
        import re as _re
        text = instructions.lower()
        if any(phrase in text for phrase in ["nhiều part", "nhieu part", "nhiều phần", "nhieu phan", "multi part", "multipart"]):
            return True
        return bool(_re.search(r"(chia|tách|tach|split|part|phần|phan|tập|tap)\D*([2-9]\d*)", text))

    def _inline_single_part_payload(
        self,
        payload: dict[str, Any],
        *,
        part_number: int,
        target_duration: int,
    ) -> dict[str, Any]:
        raw = payload.get("script_part")
        script = raw if isinstance(raw, dict) else {}
        main_beats = script.get("main_beats")
        if not isinstance(main_beats, list) or not main_beats:
            main_beats = [
                "Mở bằng chi tiết gây tò mò nhất của bài",
                "Triển khai các ý chính theo mạch nguồn",
                "Kết lại bằng góc nhìn hoặc câu hỏi tạo tương tác",
            ]
        risk_notes = script.get("risk_notes")
        if not isinstance(risk_notes, list):
            risk_notes = []
        production_notes = script.get("production_notes")
        if not isinstance(production_notes, (dict, list, str)):
            production_notes = {}
        part_type = script.get("part_type")
        if part_type not in {"OPENING", "MIDDLE", "ENDING"}:
            part_type = "OPENING" if part_number == 1 else "MIDDLE"
        return {
            "part_number": part_number,
            "part_type": part_type,
            "title": script.get("title") or payload.get("plan_title") or "Kịch bản bài",
            "goal": script.get("goal") or payload.get("content_angle") or "",
            "hook_direction": script.get("hook_direction") or "Mở bằng chi tiết gây tò mò nhất trong bài.",
            "ending_direction": script.get("ending_direction") or "Kết bằng câu hỏi để kéo bình luận.",
            "previous_part_recap": script.get("previous_part_recap"),
            "next_part_tease": script.get("next_part_tease"),
            "target_duration_seconds": script.get("target_duration_seconds") or target_duration,
            "main_beats": [str(item) for item in main_beats if str(item).strip()],
            "production_notes": production_notes,
            "risk_notes": [str(item) for item in risk_notes if str(item).strip()],
        }

    def _source_refs(self, db: Session, candidate: ProjectCandidate, part_count: int) -> list[list[dict[str, Any]]]:
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

    def _save_planning_input(self, job: ProjectRun, strategy: SocialProfileStrategy, candidates: list[ProjectCandidate]) -> str:
        doc = {
            "project_run_id": str(job.id),
            "project_id": str(job.project_id),
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

    def _save_planning_output(self, job: ProjectRun, step: str, payload: dict[str, Any]) -> str:
        doc = {"project_run_id": str(job.id), "project_id": str(job.project_id), "step": step, "prompt_version": "v1", "raw_response": payload, "parsed_response": payload, "validation_errors": [], "created_at": datetime.now(timezone.utc)}
        return str(planning_outputs().insert_one(doc).inserted_id)

    def _split_terms(self, value: str | None) -> list[str]:
        return [item.strip().lower() for item in (value or "").replace("\n", ",").split(",") if item.strip()]
