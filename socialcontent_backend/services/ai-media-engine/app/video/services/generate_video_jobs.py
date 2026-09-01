from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from common.db.media_workflows import _image_urls, _serialize_source_content
from common.db.content_series import (
    find_active_series_by_title,
    lock_active_series,
    lock_profile_series_scope,
    sync_series_current_part,
)
from common.planning.auto_draft_policy import auto_production_allowed, draft_script_signature, invalidate_draft_media, is_auto_workflow

from app.video.services.generate_video_constants import EDGE_TTS_NAMMINH_PROVIDER
from app.video.services.generate_video_assets import hydrate_source_video_assets
from app.video.services.generate_video_scripting import create_story_from_raw
from app.video.services.generate_video_voice import DEFAULT_VOICE_SPEED
from app.video.services.generate_video_timeline import normalize_story_for_project, public_story_payload


def _update_task_progress(db, task, project, stage: str, percent: float, *, project_status: str | None = None) -> None:
    task.current_stage = stage
    task.progress_percent = percent
    project.current_stage = stage
    project.progress_percent = percent
    if project_status:
        project.status = project_status
    db.add_all([task, project])
    db.commit()


def _mark_video_task_failed(db, task, project, error: Exception) -> None:
    failure_stage = task.current_stage or getattr(project, "current_stage", None) or "ERROR"
    if failure_stage == "FAILED":
        failure_stage = getattr(project, "current_stage", None) or "ERROR"
    if failure_stage == "FAILED":
        failure_stage = "ERROR"

    task.status = "FAILED"
    task.current_stage = failure_stage
    task.error_message = str(error)[-2000:]
    task.completed_at = datetime.now(timezone.utc)
    if project:
        project.status = "FAILED"
        project.current_stage = failure_stage
        db.add(project)
    db.add(task)
    db.commit()


def process_generate_video_script_run(task_id: uuid.UUID | str) -> None:
    from common.db.models import KafkaTask, MediaWorkflow
    from common.db.session import SessionLocal

    db = SessionLocal()
    try:
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if not task or task.task_type != "GENERATE_VIDEO_SCRIPT" or task.status not in {"PENDING", "FAILED"}:
            return

        project = db.get(MediaWorkflow, uuid.UUID(str(task.reference_id)))
        if not project:
            return

        metadata = task.payload_jsonb if isinstance(task.payload_jsonb, dict) else {}
        task.status = "RUNNING"
        task.started_at = datetime.now(timezone.utc)
        task.completed_at = None
        task.error_message = None
        _update_task_progress(db, task, project, "LOADING_SOURCE", 10, project_status="SCRIPTING")

        source = _build_script_source_from_project(db, project, metadata)
        source_video_assets = hydrate_source_video_assets(source)
        if source_video_assets:
            source.setdefault("content", {})["source_video_assets"] = source_video_assets
            source.setdefault("raw_article", {}).setdefault("source_content", {})["source_video_assets"] = source_video_assets
        _update_task_progress(db, task, project, "GENERATING_DRAFT", 30, project_status="SCRIPTING")
        story = create_story_from_raw(source)
        _update_task_progress(db, task, project, "NORMALIZING_DRAFT", 72, project_status="SCRIPTING")
        story = normalize_story_for_project(story)
        story.setdefault("meta", {})
        story["meta"]["workflow_id"] = str(project.id)
        _update_task_progress(db, task, project, "APPLYING_SERIES", 86, project_status="SCRIPTING")
        if is_auto_workflow(project.metadata_json):
            series_decision = _story_series_decision(story)
            project_metadata = dict(project.metadata_json or {})
            if series_decision and series_decision.get("action") in {"CREATE_NEW", "USE_EXISTING"}:
                project_metadata["pending_series_decision"] = series_decision
                project.metadata_json = project_metadata
        else:
            series_decision = _apply_story_series_decision(db, project, story, source)
        if series_decision:
            story["meta"]["series_decision"] = series_decision
        public_story = public_story_payload(story)
        public_story["project_status"] = "DRAFT_READY"
        _update_task_progress(db, task, project, "SAVING_DRAFT", 95, project_status="SCRIPTING")
        _upsert_project_rendered_draft(project, public_story)

        requires_review = _mark_auto_draft_for_human_review(project, public_story, reason="DRAFT_REGENERATED")

        task.status = "COMPLETED"
        task.progress_percent = 100
        task.current_stage = "DRAFT_READY"
        task.result_jsonb = {**metadata, "workflow_id": str(project.id), "draft_saved": True}
        task.completed_at = datetime.now(timezone.utc)
        project.status = "EDITING" if requires_review else "DRAFT_READY"
        project.current_stage = "DRAFT_REVIEW_REQUIRED" if requires_review else "DRAFT_READY"
        project.progress_percent = 80 if requires_review else 100
        db.add_all([task, project])
        db.commit()
        _maybe_enqueue_auto_voice_or_render(db, project, public_story, trigger="script_completed")
    except Exception as error:
        db.rollback()
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if task:
            project = db.get(MediaWorkflow, uuid.UUID(str(task.reference_id))) if task.reference_id else None
            _mark_video_task_failed(db, task, project, error)
    finally:
        db.close()


def _build_script_source_from_project(db: Any, project: Any, metadata: dict[str, Any]) -> dict[str, Any]:
    from common.db.models import ContentItem

    content_id = _resolve_script_content_id(project, metadata)
    if not content_id:
        raise RuntimeError("Missing content_id for generate-video script run")

    content = db.get(ContentItem, content_id)
    if not content:
        raise RuntimeError(f"ContentItem not found for generate-video script run: {content_id}")

    project_meta = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    media = content.media_jsonb if isinstance(content.media_jsonb, list) else []
    source_content = _serialize_source_content(content) or {"id": str(content.id)}
    source_content["media"] = media
    full_text = source_content.get("full_text")
    category_id = source_content.get("category_id") or source_content.get("categoryId")
    article_id = source_content.get("article_id") or source_content.get("articleId")
    site_id = source_content.get("site_id") or source_content.get("siteId")

    content_context = {
        "content_id": str(content.id),
        "crawl_job_id": str(content.crawl_job_id) if getattr(content, "crawl_job_id", None) else None,
        "content_type": content.content_type,
        "source_scope": content.content_scope,
        "quality_score": float(content.quality_score or 0),
        "article_id": article_id,
        "articleId": article_id,
        "category_id": category_id,
        "categoryId": category_id,
        "category": source_content.get("category"),
        "site_id": site_id,
        "siteId": site_id,
        "workflow_metadata": project_meta,
    }

    instructions = metadata.get("instructions") or project_meta.get("instructions")
    source = {
        "id": str(project.id),
        "workflow_id": str(project.id),
        "user_id": str(project.user_id),
        "title": content.canonical_title or content.normalized_title or project.title,
        "summary": content.summary or project_meta.get("note") or "",
        "full_text": full_text,
        "content": content_context,
        "target_duration_seconds": (metadata.get("target_duration_seconds") or project_meta.get("target_duration_seconds")
                                    or (None if project_meta.get("draft_generation_mode") == "compact-v2" else 60)),
        "images": _image_urls(media),
        "media": media,
        "series": _current_series_context(project),
        "active_series": _active_series_for_script(db, project),
        "raw_article": {"source_content": source_content},
        "source_content": source_content,
    }
    if instructions:
        source["instructions"] = instructions
    return source


def _current_series_context(project: Any) -> dict[str, Any]:
    series = getattr(project, "series", None)
    return _series_context_payload(series) if series else {}


def _active_series_for_script(db: Any, project: Any) -> list[dict[str, Any]]:
    from common.db.models import ContentSeries

    rows = (
        db.query(ContentSeries)
        .filter(
            ContentSeries.profile_id == project.profile_id,
            ContentSeries.status == "ACTIVE",
        )
        .order_by(ContentSeries.updated_at.desc())
        .limit(20)
        .all()
    )
    return [
        {
            **_series_context_payload(series),
            "recent_items": _recent_series_items(db, series.id, project.id),
        }
        for series in rows
    ]


def _recent_series_items(db: Any, series_id: uuid.UUID, current_workflow_id: uuid.UUID) -> list[dict[str, Any]]:
    from common.db.models import ContentItem, MediaWorkflow

    rows = (
        db.query(MediaWorkflow)
        .filter(
            MediaWorkflow.series_id == series_id,
            MediaWorkflow.id != current_workflow_id,
        )
        .order_by(MediaWorkflow.updated_at.desc())
        .limit(5)
        .all()
    )
    result: list[dict[str, Any]] = []
    for workflow in rows:
        content = db.get(ContentItem, workflow.primary_content_id) if workflow.primary_content_id else None
        result.append({
            "workflow_id": str(workflow.id),
            "title": workflow.title,
            "summary": _content_summary(content),
            **_content_category_context(content),
            "voice_text": _workflow_voice_text(workflow),
            "status": workflow.status,
            "primary_content_id": str(workflow.primary_content_id) if workflow.primary_content_id else None,
            "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
        })
    return result


def _content_summary(content: Any) -> str | None:
    if not content:
        return None
    for value in (content.summary, content.canonical_title, content.normalized_title):
        if value:
            return str(value)[:700]
    return None


def _workflow_voice_text(workflow: Any) -> str | None:
    draft = workflow.draft_json if isinstance(workflow.draft_json, dict) else {}
    story_data = draft.get("story_data") if isinstance(draft.get("story_data"), list) else []
    snippets = [
        str(scene.get("voice_text") or scene.get("subtitle") or "").strip()
        for scene in story_data
        if isinstance(scene, dict) and str(scene.get("voice_text") or scene.get("subtitle") or "").strip()
    ]
    if snippets:
        return " ".join(snippets[:5])[:700]

    timeline = draft.get("timeline") if isinstance(draft.get("timeline"), dict) else {}
    text = timeline.get("text") if isinstance(timeline.get("text"), list) else []
    snippets = [
        str(clip.get("voice_text") or clip.get("text") or "").strip()
        for clip in text
        if isinstance(clip, dict) and str(clip.get("voice_text") or clip.get("text") or "").strip()
    ]
    if snippets:
        return " ".join(snippets[:5])[:700]
    return None


def _series_context_payload(series: Any) -> dict[str, Any]:
    metadata = series.metadata_json if isinstance(getattr(series, "metadata_json", None), dict) else {}
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


def _apply_story_series_decision(db: Any, project: Any, story: dict[str, Any], source: dict[str, Any]) -> dict[str, Any] | None:
    from common.db.models import ContentSeries

    decision = _story_series_decision(story)
    series = None
    category_id = _source_category_id(source)
    if category_id and not getattr(project, "series_id", None):
        series = _find_active_series_by_category_id(db, project.profile_id, category_id)
        if series:
            series = lock_active_series(db, series.id, profile_id=project.profile_id, workflow_id=project.id)
        if series:
            action = "USE_EXISTING"
            decision = {
                "action": action,
                "target_series_id": str(series.id),
                "series_title": series.title,
                "reason": f"Matched source categoryId {category_id}",
            }

    if not decision:
        return None

    action = str(decision.get("action") or "NONE").upper()
    if action == "USE_EXISTING":
        if not series:
            target_series_id = _as_uuid(decision.get("target_series_id"))
            if target_series_id:
                series = lock_active_series(db, target_series_id, profile_id=project.profile_id, workflow_id=project.id)
    elif action == "CREATE_NEW":
        title = _clean_series_title(decision.get("series_title"))
        if title:
            lock_profile_series_scope(db, project.profile_id)
            series = find_active_series_by_title(db, project.profile_id, title)
            if not series:
                content_context = source.get("content") if isinstance(source.get("content"), dict) else {}
                source_content = source.get("source_content") if isinstance(source.get("source_content"), dict) else {}
                desc = decision.get("series_description") or decision.get("reason") or source.get("summary")
                series_type = str(decision.get("series_type") or "NARRATIVE").upper()
                try:
                    total_parts = max(0, int(decision.get("total_parts") or 0))
                except (TypeError, ValueError):
                    total_parts = 0

                series = ContentSeries(
                    user_id=project.user_id,
                    profile_id=project.profile_id,
                    title=title,
                    description=str(desc)[:1000] if desc else None,
                    series_type=series_type,
                    status="ACTIVE",
                    current_part=0,
                    total_parts=total_parts,
                    context_json={"version": 1, "created_from": "generate_video_script"},
                    metadata_json={
                        "created_from": "generate_video_script",
                        "source": "llm_series_decision",
                        "source_content_id": content_context.get("content_id"),
                        "crawl_job_id": content_context.get("crawl_job_id"),
                        "article_id": content_context.get("article_id") or source_content.get("article_id"),
                        "articleId": content_context.get("articleId") or source_content.get("articleId"),
                        "category_id": content_context.get("category_id") or source_content.get("category_id"),
                        "categoryId": content_context.get("categoryId") or source_content.get("categoryId"),
                        "category": content_context.get("category") or source_content.get("category"),
                        "site_id": content_context.get("site_id") or source_content.get("site_id"),
                        "siteId": content_context.get("siteId") or source_content.get("siteId"),
                        "reason": decision.get("reason"),
                    },
                )
                db.add(series)
                db.flush()
            else:
                series = lock_active_series(db, series.id, profile_id=project.profile_id, workflow_id=project.id)

    normalized_decision = {
        "action": action if action in {"USE_EXISTING", "CREATE_NEW", "NONE"} else "NONE",
        "target_series_id": str(series.id) if series else None,
        "series_title": series.title if series else _clean_series_title(decision.get("series_title")),
        "reason": decision.get("reason"),
    }
    metadata = dict(project.metadata_json or {})
    metadata["series_decision"] = normalized_decision
    project.metadata_json = metadata

    if series:
        old_series_id = project.series_id
        project.series_id = series.id
        project.planning_mode = "SERIES"
        db.flush()
        sync_series_current_part(db, series)
        if old_series_id and old_series_id != series.id:
            sync_series_current_part(db, old_series_id)
        story.setdefault("meta", {})
        story["meta"]["series"] = _series_context_payload(series)
    return normalized_decision


def _story_series_decision(story: dict[str, Any]) -> dict[str, Any] | None:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    decision = meta.get("series_decision") if isinstance(meta.get("series_decision"), dict) else None
    if decision:
        return decision
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    timeline_meta = timeline.get("metadata") if isinstance(timeline.get("metadata"), dict) else {}
    decision = timeline_meta.get("series_decision")
    return decision if isinstance(decision, dict) else None


def _clean_series_title(value: Any) -> str | None:
    title = str(value or "").strip()
    if not title:
        return None
    return " ".join(title.split())[:180]


def _find_active_series_by_title(db: Any, profile_id: uuid.UUID, title: str):
    from common.db.models import ContentSeries

    normalized = title.casefold()
    rows = (
        db.query(ContentSeries)
        .filter(
            ContentSeries.profile_id == profile_id,
            ContentSeries.status == "ACTIVE",
        )
        .limit(100)
        .all()
    )
    return next((series for series in rows if str(series.title or "").strip().casefold() == normalized), None)


def _find_active_series_by_category_id(db: Any, profile_id: uuid.UUID, category_id: str):
    from common.db.models import ContentSeries

    target = str(category_id or "").strip()
    if not target:
        return None
    rows = (
        db.query(ContentSeries)
        .filter(
            ContentSeries.profile_id == profile_id,
            ContentSeries.status == "ACTIVE",
        )
        .order_by(ContentSeries.updated_at.desc())
        .limit(100)
        .all()
    )
    for series in rows:
        metadata = series.metadata_json if isinstance(series.metadata_json, dict) else {}
        if str(metadata.get("category_id") or metadata.get("categoryId") or "").strip() == target:
            return series
    return None


def _source_category_id(source: dict[str, Any]) -> str | None:
    candidates = []
    content = source.get("content") if isinstance(source.get("content"), dict) else {}
    source_content = source.get("source_content") if isinstance(source.get("source_content"), dict) else {}
    raw_article = source.get("raw_article") if isinstance(source.get("raw_article"), dict) else {}
    raw_source_content = raw_article.get("source_content") if isinstance(raw_article.get("source_content"), dict) else {}
    candidates.extend([
        content.get("category_id"),
        content.get("categoryId"),
        source_content.get("category_id"),
        source_content.get("categoryId"),
        raw_source_content.get("category_id"),
        raw_source_content.get("categoryId"),
    ])
    for value in candidates:
        if value not in (None, "", []):
            return str(value)
    return None


def _content_category_context(content: Any) -> dict[str, Any]:
    if not content:
        return {}
    sources = content.sources_jsonb if isinstance(getattr(content, "sources_jsonb", None), list) else []
    primary_source = sources[0] if sources else {}
    metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    if not isinstance(metadata, dict):
        metadata = {}
    article_id = metadata.get("article_id")
    category_id = metadata.get("category_id")
    site_id = metadata.get("site_id")
    return {
        "article_id": article_id,
        "articleId": article_id,
        "category_id": category_id,
        "categoryId": category_id,
        "category": metadata.get("category"),
        "site_id": site_id,
        "siteId": site_id,
    }


def _resolve_script_content_id(project: Any, metadata: dict[str, Any]) -> uuid.UUID | None:
    for value in (metadata.get("content_id"), getattr(project, "primary_content_id", None)):
        resolved = _as_uuid(value)
        if resolved:
            return resolved
    return None


def _as_uuid(value: Any) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _draft_with_source_context(db: Any, project: Any, story: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(story, dict):
        return story
    if isinstance(story.get("source"), dict) and story["source"]:
        return story
    try:
        source = _build_script_source_from_project(db, project, {})
    except RuntimeError:
        return story
    next_story = dict(story)
    next_story["source"] = source
    return next_story


def _preserve_compact_scenes(original: dict[str, Any], updated: dict[str, Any]) -> None:
    compact = original.get("compact_scenes") if isinstance(original.get("compact_scenes"), list) else None
    if compact is not None and not isinstance(updated.get("compact_scenes"), list):
        updated["compact_scenes"] = compact
    if compact is not None:
        for key in ("draft_generation_mode", "prompt_version", "creative_plan", "source_facts", "source_coverage"):
            if key in (original.get("meta") or {}):
                updated.setdefault("meta", {})[key] = original["meta"][key]


def _mark_auto_draft_for_human_review(project: Any, story: dict[str, Any], *, reason: str) -> bool:
    metadata = dict(project.metadata_json or {})
    if not is_auto_workflow(metadata):
        return False
    metadata["draft_review_approved"] = False
    metadata.pop("approved_script_signature", None)
    metadata["draft_review"] = {
        "status": "REVIEW_REQUIRED",
        "reason": reason,
        "script_signature": draft_script_signature(story),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    project.metadata_json = metadata
    return True


def _recheck_auto_compact_quality(project: Any, story: dict[str, Any]) -> None:
    metadata = dict(project.metadata_json or {})
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    linked = meta.get("draft_generation_mode") == "compact-v2"
    if not is_auto_workflow(metadata) or (not linked and not isinstance(story.get("compact_scenes"), list)):
        return
    from app.planning.services.auto_draft_compact import evaluate_compact_draft, normalize_compact_draft

    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    source_facts = meta.get("source_facts") if isinstance(meta.get("source_facts"), list) else []
    compact = normalize_compact_draft(
        {
            "confidence_score": metadata.get("confidence_score"),
            "risk_flags": metadata.get("risk_flags") or meta.get("risk_flags") or [],
            "plan": meta.get("creative_plan") or {},
            "series_decision": metadata.get("pending_series_decision") or metadata.get("series_decision") or {},
            "scenes": story.get("compact_scenes") or [],
            **({"version": "compact-v2", "timeline": story.get("timeline") or {}} if linked else {}),
        }
    )
    recheck = evaluate_compact_draft(compact, source_facts, risk_tolerance=str(metadata.get("risk_level") or "")).to_dict()
    metadata["draft_quality_recheck"] = recheck
    review = dict(metadata.get("draft_review") or {})
    review["automated_recheck_status"] = recheck.get("status")
    review["automated_recheck_score"] = recheck.get("score")
    metadata["draft_review"] = review
    project.metadata_json = metadata


def _cancel_blocked_auto_production(db: Any, task: Any, project: Any) -> bool:
    story = project.draft_json if isinstance(project.draft_json, dict) else {}
    metadata = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    if auto_production_allowed(metadata, story):
        return False
    task.status = "CANCELLED"
    task.current_stage = "DRAFT_REVIEW_REQUIRED"
    task.error_message = "Auto production blocked until the current draft is explicitly approved"
    task.completed_at = datetime.now(timezone.utc)
    project.status = "EDITING"
    project.current_stage = "DRAFT_REVIEW_REQUIRED"
    project.progress_percent = 80
    db.add_all([task, project])
    db.commit()
    return True


def process_generate_video_edit_run(task_id: uuid.UUID | str) -> None:
    from common.db.models import KafkaTask, MediaWorkflow
    from common.db.session import SessionLocal
    from app.video.services.generate_video_scripting import edit_story_with_ai

    db = SessionLocal()
    try:
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if not task or task.task_type != "GENERATE_VIDEO_EDIT" or task.status not in {"PENDING", "FAILED"}:
            return

        project = db.get(MediaWorkflow, uuid.UUID(str(task.reference_id)))
        if not project:
            return

        metadata = task.payload_jsonb if isinstance(task.payload_jsonb, dict) else {}
        story = deepcopy(project.draft_json)
        prompt = metadata.get("prompt") or ""
        if not isinstance(story, dict):
            raise RuntimeError("Missing story payload for generate-video edit run")

        story.setdefault("meta", {})
        story["meta"]["user_id"] = str(project.user_id)
        story["meta"]["workflow_id"] = str(project.id)

        task.status = "RUNNING"
        task.started_at = datetime.now(timezone.utc)
        task.completed_at = None
        task.error_message = None
        _update_task_progress(db, task, project, "LOADING_DRAFT", 10, project_status="EDITING")

        _update_task_progress(db, task, project, "EDITING_DRAFT", 30, project_status="EDITING")
        edited = edit_story_with_ai(_draft_with_source_context(db, project, story), prompt)
        _update_task_progress(db, task, project, "NORMALIZING_DRAFT", 82, project_status="EDITING")
        edited = normalize_story_for_project(edited)
        _preserve_compact_scenes(story, edited)
        edited.setdefault("meta", {})
        edited["meta"]["workflow_id"] = str(project.id)
        public_story = public_story_payload(edited)
        public_story["project_status"] = "EDITING"
        _update_task_progress(db, task, project, "SAVING_DRAFT", 95, project_status="EDITING")
        _upsert_project_rendered_draft(project, public_story)
        requires_review = _mark_auto_draft_for_human_review(project, public_story, reason="AI_EDIT_COMPLETED")

        task.status = "COMPLETED"
        task.progress_percent = 100
        task.current_stage = "DRAFT_READY"
        task.result_jsonb = {"workflow_id": str(project.id), "draft_saved": True}
        task.completed_at = datetime.now(timezone.utc)
        project.status = "EDITING"
        project.current_stage = "DRAFT_REVIEW_REQUIRED" if requires_review else "DRAFT_READY"
        project.progress_percent = 80 if requires_review else 100
        db.add_all([task, project])
        db.commit()
    except Exception as error:
        db.rollback()
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if task:
            project = db.get(MediaWorkflow, uuid.UUID(str(task.reference_id))) if task.reference_id else None
            _mark_video_task_failed(db, task, project, error)
    finally:
        db.close()


def process_generate_video_review_run(task_id: uuid.UUID | str) -> None:
    from common.db.models import KafkaTask, MediaWorkflow
    from common.db.session import SessionLocal
    from app.video.services.generate_video_scripting import review_story_with_ai

    db = SessionLocal()
    try:
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if not task or task.task_type != "GENERATE_VIDEO_REVIEW" or task.status not in {"PENDING", "FAILED"}:
            return

        project = db.get(MediaWorkflow, uuid.UUID(str(task.reference_id)))
        if not project:
            return

        metadata = task.payload_jsonb if isinstance(task.payload_jsonb, dict) else {}
        story = deepcopy(project.draft_json)
        instructions = metadata.get("instructions")
        if not isinstance(story, dict):
            raise RuntimeError("Missing story payload for generate-video review run")

        story.setdefault("meta", {})
        story["meta"]["user_id"] = str(project.user_id)
        story["meta"]["workflow_id"] = str(project.id)

        task.status = "RUNNING"
        task.started_at = datetime.now(timezone.utc)
        task.completed_at = None
        task.error_message = None
        _update_task_progress(db, task, project, "LOADING_DRAFT", 10, project_status="REVIEWING")

        _update_task_progress(db, task, project, "REVIEWING_DRAFT", 30, project_status="REVIEWING")
        reviewed = review_story_with_ai(_draft_with_source_context(db, project, story), instructions)
        _update_task_progress(db, task, project, "NORMALIZING_DRAFT", 82, project_status="REVIEWING")
        reviewed = normalize_story_for_project(reviewed)
        _preserve_compact_scenes(story, reviewed)
        reviewed.setdefault("meta", {})
        reviewed["meta"]["workflow_id"] = str(project.id)
        public_story = public_story_payload(reviewed)
        public_story["project_status"] = "REVIEWING"
        _update_task_progress(db, task, project, "SAVING_DRAFT", 95, project_status="REVIEWING")
        _upsert_project_rendered_draft(project, public_story)
        requires_review = _mark_auto_draft_for_human_review(project, public_story, reason="AI_REVIEW_COMPLETED")
        _recheck_auto_compact_quality(project, public_story)

        task.status = "COMPLETED"
        task.progress_percent = 100
        task.current_stage = "REVIEW_COMPLETE"
        task.result_jsonb = {
            "workflow_id": str(project.id),
            "draft_saved": True,
            "review": (public_story.get("meta") or {}).get("ai_story_review"),
        }
        task.completed_at = datetime.now(timezone.utc)
        project.status = "EDITING" if requires_review else "REVIEWING"
        project.current_stage = "DRAFT_REVIEW_REQUIRED" if requires_review else "REVIEW_COMPLETE"
        project.progress_percent = 80 if requires_review else 100
        db.add_all([task, project])
        db.commit()
    except Exception as error:
        db.rollback()
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if task:
            project = db.get(MediaWorkflow, uuid.UUID(str(task.reference_id))) if task.reference_id else None
            _mark_video_task_failed(db, task, project, error)
    finally:
        db.close()



def process_generate_video_voice_run(task_id: uuid.UUID | str) -> None:
    from common.db.models import KafkaTask, MediaWorkflow
    from common.db.session import SessionLocal
    from app.video.services.generate_video_voice import enhance_emotion_and_generate_voice
    from app.video.services.generate_video_alignment import fit_frames_with_whisper

    db = SessionLocal()
    try:
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if not task or task.task_type != "GENERATE_VIDEO_VOICE" or task.status not in {"PENDING", "FAILED"}:
            return

        project = db.get(MediaWorkflow, uuid.UUID(str(task.reference_id)))
        if not project:
            return
        if _cancel_blocked_auto_production(db, task, project):
            return

        metadata = task.payload_jsonb if isinstance(task.payload_jsonb, dict) else {}
        story = deepcopy(project.draft_json)
        voice_id = metadata.get("voice_id")
        voice_speed = float(metadata.get("voice_speed") or DEFAULT_VOICE_SPEED)
        voice_provider = metadata.get("voice_provider")
        if not isinstance(story, dict):
            raise RuntimeError("Missing story payload for generate-video voice run")

        story.setdefault("meta", {})
        story["meta"]["user_id"] = str(project.user_id)
        story["meta"]["workflow_id"] = str(project.id)

        task.status = "RUNNING"
        task.started_at = datetime.now(timezone.utc)
        task.completed_at = None
        task.error_message = None
        _update_task_progress(db, task, project, "PREPARING_VOICE", 10, project_status="EDITING")

        _update_task_progress(db, task, project, "GENERATING_VOICE", 30, project_status="EDITING")
        result = enhance_emotion_and_generate_voice(story, voice_id, voice_speed, voice_provider)
        result_story = result.get("story") or {}
        fit_error = None
        try:
            _update_task_progress(db, task, project, "ALIGNING_VOICE", 76, project_status="EDITING")
            fit_result = fit_frames_with_whisper(result_story)
            result_story = fit_result.get("story") or result_story
        except Exception as error:
            fit_error = str(error)

        result_story = normalize_story_for_project(result_story)
        _preserve_compact_scenes(story, result_story)
        result_story.setdefault("meta", {})
        result_story["meta"]["workflow_id"] = str(project.id)
        public_story = public_story_payload(result_story)
        _update_task_progress(db, task, project, "SAVING_VOICE", 95, project_status="EDITING")
        _upsert_project_rendered_draft(project, public_story)

        task.status = "COMPLETED"
        task.progress_percent = 100
        task.current_stage = "VOICE_READY"
        task.result_jsonb = {
            "workflow_id": str(project.id),
            "draft_saved": True,
            "voice_id": result.get("voice_id"),
            "voice_provider": result.get("voice_provider"),
            "voice_speed": result.get("voice_speed"),
            "voice_text": result.get("voice_text"),
            "audio_url": result.get("audio_url"),
            "fit_frame_error": fit_error,
        }
        task.completed_at = datetime.now(timezone.utc)
        ready = auto_production_allowed(project.metadata_json, public_story)
        project.status = "VOICE_READY" if ready else "EDITING"
        project.current_stage = "VOICE_READY" if ready else "DRAFT_REVIEW_REQUIRED"
        project.progress_percent = 100 if ready else 80
        db.add_all([task, project])
        db.commit()
        _maybe_enqueue_auto_generate_video_render(db, project, public_story, trigger="voice_completed")
    except Exception as error:
        db.rollback()
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if task:
            project = db.get(MediaWorkflow, uuid.UUID(str(task.reference_id))) if task.reference_id else None
            _mark_video_task_failed(db, task, project, error)
    finally:
        db.close()



def _maybe_enqueue_auto_voice_or_render(db, project, story: dict[str, Any], *, trigger: str) -> None:
    metadata = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    if not auto_production_allowed(metadata, story):
        return
    if _story_has_voice(story):
        _maybe_enqueue_auto_generate_video_render(db, project, story, trigger=trigger)
        return
    _maybe_enqueue_auto_generate_video_voice(db, project, trigger=trigger)


def _story_has_voice(story: dict[str, Any]) -> bool:
    audio = story.get("audio") if isinstance(story.get("audio"), dict) else {}
    if audio.get("voice"):
        return True
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    audio_clips = timeline.get("audio") if isinstance(timeline.get("audio"), list) else []
    return any(isinstance(clip, dict) and str(clip.get("type") or "").lower() == "voice" and clip.get("src") for clip in audio_clips)


def _maybe_enqueue_auto_generate_video_voice(db, project, *, trigger: str) -> None:
    from common.db.models import KafkaTask, SocialProfile
    from common.events.envelope import build_event
    from common.events.kafka import publish
    from common.events.topics import GENERATE_VIDEO_VOICE_REQUESTED

    profile = db.get(SocialProfile, project.profile_id)
    strategy = getattr(profile, "strategy", None) if profile else None
    if getattr(strategy, "video_render_mode", "manual") != "auto":
        return
    story = project.draft_json if isinstance(project.draft_json, dict) else {}
    metadata = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    if not auto_production_allowed(metadata, story):
        return

    existing = (
        db.query(KafkaTask)
        .filter(
            KafkaTask.reference_id == project.id,
            KafkaTask.task_type == "GENERATE_VIDEO_VOICE",
            KafkaTask.status.in_(["PENDING", "RUNNING", "PROCESSING"]),
        )
        .order_by(KafkaTask.created_at.desc())
        .first()
    )
    if existing:
        return

    task = KafkaTask(
        reference_id=project.id,
        reference_type="media_workflow",
        task_type="GENERATE_VIDEO_VOICE",
        status="PENDING",
        progress_percent=0,
        current_stage="QUEUED_VOICE",
        payload_jsonb={
            "trigger": trigger,
            "voice_provider": EDGE_TTS_NAMMINH_PROVIDER,
            "voice_speed": DEFAULT_VOICE_SPEED,
        },
    )
    project.status = "EDITING"
    project.current_stage = "QUEUED_VOICE"
    project.progress_percent = 0
    db.add_all([task, project])
    db.commit()
    db.refresh(task)
    publish(
        GENERATE_VIDEO_VOICE_REQUESTED,
        build_event(
            event_type=GENERATE_VIDEO_VOICE_REQUESTED,
            source="generate-video-worker",
            job_id=task.id,
            payload={
                "workflow_id": str(project.id),
                "run_type": task.task_type,
                "task_id": str(task.id),
                "trigger": trigger,
                "voice_provider": EDGE_TTS_NAMMINH_PROVIDER,
            },
            correlation_id=project.id,
        ),
    )



def _maybe_enqueue_auto_generate_video_render(db, project, story: dict[str, Any], *, trigger: str) -> None:
    from common.db.models import KafkaTask, SocialProfile
    from common.events.envelope import build_event
    from common.events.kafka import publish
    from common.events.topics import GENERATE_VIDEO_RENDER_REQUESTED

    profile = db.get(SocialProfile, project.profile_id)
    strategy = getattr(profile, "strategy", None) if profile else None
    if getattr(strategy, "video_render_mode", "manual") != "auto":
        return
    metadata = project.metadata_json if isinstance(project.metadata_json, dict) else {}
    if not auto_production_allowed(metadata, story):
        return

    existing = (
        db.query(KafkaTask)
        .filter(
            KafkaTask.reference_id == project.id,
            KafkaTask.task_type == "GENERATE_VIDEO_RENDER",
            KafkaTask.status.in_(["PENDING", "RUNNING", "PROCESSING"]),
        )
        .order_by(KafkaTask.created_at.desc())
        .first()
    )
    if existing:
        return

    job = KafkaTask(
        reference_id=project.id,
        reference_type="media_workflow",
        task_type="GENERATE_VIDEO_RENDER",
        status="PENDING",
        progress_percent=0,
        current_stage="QUEUED_RENDER",
        payload_jsonb={"trigger": trigger, "video_render_mode": "auto"},
    )
    project.status = "RENDERING"
    project.current_stage = "QUEUED_RENDER"
    project.progress_percent = 0
    db.add_all([job, project])
    db.commit()
    db.refresh(job)
    publish(
        GENERATE_VIDEO_RENDER_REQUESTED,
        build_event(
            event_type=GENERATE_VIDEO_RENDER_REQUESTED,
            source="generate-video-worker",
            job_id=job.id,
            payload={"workflow_id": str(project.id), "run_type": job.task_type, "trigger": trigger, "task_id": str(job.id)},
            correlation_id=project.id,
        ),
    )





def _apply_module4_policy_after_render(db, project, rendered_video: str, story: dict[str, Any]) -> None:
    from common.db.models import PublishingQueueItem, SocialProfile
    from common.planning.publishing_schedule import choose_publish_schedule, lock_schedule_profile, utc_datetime

    profile = db.get(SocialProfile, project.profile_id)
    strategy = getattr(profile, "strategy", None) if profile else None
    metadata = dict(project.metadata_json or {})
    metadata["module4_quality"] = {
        "status": "passed_basic_render_check",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "checks": ["final_video_exists", "render_task_completed"],
    }

    if not auto_production_allowed(metadata, story):
        metadata["video_approved"] = False
        metadata["module4_review"] = {"decision": "waiting_human_review", "reason": "DRAFT_REVIEW_REQUIRED"}
        project.metadata_json = metadata
        project.status = "EDITING"
        project.current_stage = "DRAFT_REVIEW_REQUIRED"
        return

    if not strategy or getattr(strategy, "approval_mode", "manual") != "auto":
        metadata["module4_review"] = {
            "decision": "waiting_human_review",
            "mode": "manual",
            "reason": "Social profile strategy requires manual approval",
        }
        project.metadata_json = metadata
        project.status = "RENDERED"
        project.current_stage = "WAITING_HUMAN_REVIEW"
        return

    metadata["video_approved"] = True
    metadata["video_approved_at"] = datetime.now(timezone.utc).isoformat()
    metadata["module4_review"] = {
        "decision": "approved",
        "mode": "auto",
        "reason": "Social profile strategy approval_mode=auto",
    }

    if not getattr(strategy, "auto_queue_enabled", True):
        project.metadata_json = metadata
        project.status = "VIDEO_APPROVED"
        project.current_stage = "AUTO_APPROVED"
        return

    queued_status = "approved"
    queued_reason = "Module 4 auto queue từ video render đã được duyệt tự động"
    lock_schedule_profile(db, profile.id)
    existing_id = metadata.get("queued_post_id")
    item = None
    if existing_id:
        try:
            item = db.get(PublishingQueueItem, uuid.UUID(str(existing_id)))
        except ValueError:
            item = None
    if item is None:
        item = PublishingQueueItem(
            user_id=project.user_id,
            profile_id=project.profile_id,
            content_id=project.primary_content_id,
            article_link=rendered_video,
            article_title=project.title,
            platform=profile.platform if profile else "tiktok",
            generated_content=_default_module4_caption(project, story),
            ai_reason=queued_reason,
            status=queued_status,
        )
    else:
        item.article_link = rendered_video
        item.article_title = project.title
        item.generated_content = item.generated_content or _default_module4_caption(project, story)
        item.ai_reason = queued_reason
        item.status = queued_status
        item.error = None

    if not item.scheduled_at or utc_datetime(item.scheduled_at) <= datetime.now(timezone.utc):
        try:
            decision = choose_publish_schedule(db, profile, item)
            item.scheduled_at = decision.scheduled_at
            queued_reason = f"{queued_reason}. {decision.reason}"
        except ValueError as exc:
            # A full calendar must not mark a successfully rendered video as
            # failed, nor cause it to publish at an invented fallback time.
            item.scheduled_at = None
            item.status = "approved"
            queued_reason = f"{queued_reason}. Cần chọn lịch: {exc}"
    item.ai_reason = queued_reason
    db.add(item)
    db.flush()

    metadata["queued_post_id"] = str(item.id)
    metadata["queued_at"] = datetime.now(timezone.utc).isoformat()
    metadata["module4_queue"] = {
        "status": item.status,
        "scheduled_at": item.scheduled_at.isoformat() if item.scheduled_at else None,
        "auto_publish_enabled": bool(getattr(strategy, "auto_publish_enabled", False)),
        "reason": queued_reason,
    }
    project.metadata_json = metadata
    project.status = "QUEUED_FOR_PUBLISHING" if item.scheduled_at else "VIDEO_APPROVED"
    project.current_stage = project.status


def _default_module4_caption(project, story: dict[str, Any]) -> str:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    title = str(meta.get("title") or project.title or "").strip()
    return title or "Video mới đã sẵn sàng đăng"


def _upsert_project_rendered_draft(project, story: dict[str, Any]) -> None:
    previous = project.draft_json if isinstance(project.draft_json, dict) else {}
    if previous and is_auto_workflow(project.metadata_json) and draft_script_signature(previous) != draft_script_signature(story):
        invalidate_draft_media(project, story)
        _mark_auto_draft_for_human_review(project, story, reason="DRAFT_CHANGED")
    story.setdefault("meta", {})
    story["meta"]["workflow_id"] = str(project.id)

    # ensure global tracks and local tracks
    if "global_tracks" not in story:
        story["global_tracks"] = []

    scenes = story.get("scenes") if isinstance(story.get("scenes"), list) else []
    for scene in scenes:
        if isinstance(scene, dict) and "local_tracks" not in scene:
            scene["local_tracks"] = []

    project.draft_json = story
