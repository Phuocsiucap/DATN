from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from common.db.models import (
    ContentItem,
    ContentMedia,
    
    ContentSource,
    MediaWorkflow,
    Episode,
    WorkflowArtifact,
    WorkflowCandidate,
    WorkflowRun,
    ContentSeries,
    WorkflowSource,
    SocialProfile,
    Story,
    VideoDraft,
)


DEFAULT_STORY_IMAGES = [
    "assets/images/001-signal-room.png",
    "assets/images/002-alien-tower.png",
    "assets/images/003-final-light.png",
]
DEFAULT_STORY_EFFECTS = ["slow-zoom", "pan-right", "pan-left", "push-in"]


def sync_workflow_from_plan(db: Session, plan: MediaWorkflow) -> MediaWorkflow:
    workflow = db.get(MediaWorkflow, plan.workflow_id) if plan.workflow_id else None
    if not workflow:
        workflow = _find_workflow(db, content_plan_id=plan.id, user_id=_profile_user_id(db, plan.profile_id), profile_id=plan.profile_id)
    plan.workflow_id = workflow.id
    workflow.content_plan_id = plan.id
    workflow.profile_id = plan.profile_id
    workflow.planning_mode = plan.planning_mode
    workflow.primary_content_id = plan.primary_content_id
    workflow.primary_story_id = plan.primary_story_id
    workflow.title = plan.title or workflow.title
    workflow.status = _status_from_plan(plan.status)
    workflow.metadata_json = {
        **(workflow.metadata_json or {}),
        "content_angle": plan.content_angle,
        "target_audience": plan.target_audience,
        "tone": plan.tone,
        "format": plan.format,
        "risk_level": plan.risk_level,
        "confidence_score": float(plan.confidence_score or 0),
        "production_requirements": plan.production_requirements or {},
    }
    db.add(workflow)
    db.flush()
    return workflow


def serialize_workflow(workflow: MediaWorkflow, db: Session | None = None) -> dict[str, Any]:
    final_artifact = next((item for item in workflow.artifacts if item.artifact_type == "FINAL_VIDEO" and item.uri), None)
    source_context = _workflow_source_context(workflow, db) if db else {"source_content": None, "media": [], "images": []}
    draft_json = _normalized_workflow_draft_json(workflow)
    metadata = workflow.metadata_json or {}
    raw_meta = workflow.metadata_json or {}
    story_data = _serialize_story_data(draft_json, workflow)
    draft_json["story_data"] = story_data
    story = None
    if db and getattr(workflow, "video_draft_id", None):
        draft_obj = db.get(VideoDraft, workflow.video_draft_id)
        if draft_obj and isinstance(draft_obj.draft_json, dict):
            story = draft_obj.draft_json

    return {
        "id": str(workflow.id),
        "user_id": str(workflow.user_id),
        "profile_id": str(workflow.profile_id),
        "series_id": str(workflow.series_id) if workflow.series_id else None,
        "title": workflow.title,
        "status": workflow.status,
        "planning_mode": workflow.planning_mode or "SINGLE",
        "primary_content_id": str(workflow.primary_content_id) if workflow.primary_content_id else None,
        "primary_story_id": str(workflow.primary_story_id) if workflow.primary_story_id else None,
        "content_plan_id": str(workflow.id),
        "video_draft_id": str(getattr(workflow, "video_draft_id", None)) if getattr(workflow, "video_draft_id", None) else None,
        "current_stage": workflow.current_stage,
        "progress_percent": float(workflow.progress_percent or 0),
        "timeline_duration": raw_meta.get("timeline_duration"),
        "rendered_video": final_artifact.uri if final_artifact else None,
        "metadata": metadata,
        "source_content": source_context["source_content"],
        "media": source_context["media"],
        "images": source_context["images"],
        "series": serialize_content_series(workflow.series) if getattr(workflow, "series", None) else None,
        "story_data": story_data,
        "artifacts": [_serialize_artifact(item) for item in getattr(workflow, "artifacts", [])],
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at or workflow.created_at,
        # Required fields from metadata for MediaWorkflowResponse
        "content_angle": raw_meta.get("content_angle"),
        "target_audience": raw_meta.get("target_audience"),
        "tone": raw_meta.get("tone"),
        "format": raw_meta.get("format"),
        "target_duration_seconds": raw_meta.get("target_duration_seconds"),
        "recommended_part_count": raw_meta.get("recommended_part_count"),
        "confidence_score": float(raw_meta.get("confidence_score") or 0.0),
        "risk_level": raw_meta.get("risk_level"),
        "version": 1,
        "ai_reasoning": raw_meta.get("ai_reasoning") or [],
        "production_requirements": raw_meta.get("production_requirements") or {},
        "draft_json": draft_json,
        "story": story,
        "approved_at": raw_meta.get("approved_at") or (workflow.updated_at if workflow.status == "APPROVED" else None),
    }

# Backward compatibility alias



def _workflow_source_context(workflow: MediaWorkflow, db: Session) -> dict[str, Any]:
    content_ids = _workflow_content_ids(workflow, db)
    if not content_ids:
        return {"source_content": None, "media": [], "images": []}

    contents = db.query(ContentItem).filter(ContentItem.id.in_(content_ids)).all()
    sources = (
        db.query(ContentSource)
        .filter(ContentSource.content_id.in_(content_ids))
        .order_by(ContentSource.is_primary.desc(), ContentSource.first_seen_at.desc())
        .all()
    )
    media_rows = (
        db.query(ContentMedia)
        .filter(ContentMedia.content_id.in_(content_ids))
        .order_by(ContentMedia.created_at.asc())
        .all()
    )
    media = [_serialize_content_media(item) for item in media_rows]
    source_content = _serialize_source_content(_primary_workflow_content(workflow, contents), sources, media)
    images = _image_urls(media)
    return {"source_content": source_content, "media": media, "images": images}


def _workflow_content_ids(workflow: MediaWorkflow, db: Session) -> list[Any]:
    ids: list[Any] = []

    def add(value: Any) -> None:
        if value and value not in ids:
            ids.append(value)

    def add_story(story_id: Any) -> None:
        if not story_id:
            return
        story = db.get(Story, story_id)
        if story and story.content_id:
            add(story.content_id)

    def add_episode(episode_id: Any) -> None:
        if not episode_id:
            return
        episode = db.get(Episode, episode_id)
        if episode and episode.content_id:
            add(episode.content_id)

    add(workflow.primary_content_id)
    add_story(workflow.primary_story_id)

    plan_id = getattr(workflow, "content_plan_id", None)
    if plan_id:
        plan = db.get(MediaWorkflow, plan_id)
        if plan:
            add(plan.primary_content_id)
            add_story(plan.primary_story_id)

    for source in workflow.sources:
        add(source.content_id)
        add_story(source.story_id)
        add_episode(source.episode_id)

    for candidate in workflow.candidates:
        add(candidate.content_id)
        add_story(candidate.story_id)
        add_episode(candidate.episode_id)

    draft = _workflow_draft_json(workflow)
    for scene in (draft.get("story_data") or draft.get("scenes") or []):
        if not isinstance(scene, dict):
            continue
        for ref in _source_refs_from_payload(scene):
            if not isinstance(ref, dict):
                continue
            add(ref.get("content_id"))
            add_story(ref.get("story_id"))
            add_episode(ref.get("episode_id"))

    return ids


def _primary_workflow_content(workflow: MediaWorkflow, contents: list[ContentItem]) -> ContentItem | None:
    if not contents:
        return None
    if workflow.primary_content_id:
        match = next((item for item in contents if item.id == workflow.primary_content_id), None)
        if match:
            return match
    return contents[0]


def _source_refs_from_payload(payload: dict[str, Any]) -> list[Any]:
    refs = payload.get("source_refs")
    if isinstance(refs, list):
        return refs
    nested = payload.get("payload")
    if isinstance(nested, dict):
        nested_refs = nested.get("source_refs")
        if isinstance(nested_refs, list):
            return nested_refs
    return []


_primary_workflow_content = _primary_workflow_content


def _serialize_source_content(content: ContentItem | None, sources: list[ContentSource], media: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not content:
        return None
    content_sources = [source for source in sources if source.content_id == content.id]
    primary_source = next((source for source in content_sources if source.is_primary), None) or (content_sources[0] if content_sources else None)
    full_text = _load_content_full_text(content_sources)
    return {
        "id": str(content.id),
        "content_type": content.content_type,
        "canonical_title": content.canonical_title,
        "summary": content.summary,
        "full_text": full_text,
        "language": content.language,
        "status": content.status,
        "canonical_url": content.canonical_url,
        "source_type": primary_source.source_type if primary_source else None,
        "source_url": primary_source.source_url if primary_source else content.canonical_url,
        "source_author": primary_source.source_author if primary_source else None,
        "source_published_at": primary_source.source_published_at.isoformat() if primary_source and primary_source.source_published_at else None,
        "quality_score": float(content.quality_score or 0),
        "published_at": content.published_at.isoformat() if content.published_at else None,
        "created_at": content.created_at.isoformat() if content.created_at else None,
        "updated_at": content.updated_at.isoformat() if content.updated_at else None,
    }


def _load_content_full_text(sources: list[ContentSource]) -> str | None:
    try:
        from bson import ObjectId
        from common.db.mongo import processed_documents, raw_documents

        proc_coll = processed_documents()
        raw_coll = raw_documents()
        for source in sources:
            metadata = dict(source.metadata_json or {})
            proc_id_str = source.processed_document_id or metadata.get("processed_document_id")
            if proc_id_str:
                try:
                    proc_doc = proc_coll.find_one({"_id": ObjectId(proc_id_str)})
                    normalized = proc_doc.get("normalized") if isinstance(proc_doc, dict) else None
                    if isinstance(normalized, dict):
                        full_text = normalized.get("content") or normalized.get("description")
                        if full_text:
                            return str(full_text)
                except Exception:
                    pass
            if source.raw_document_id:
                try:
                    raw_doc = raw_coll.find_one({"_id": ObjectId(source.raw_document_id)})
                    raw = raw_doc.get("raw") if isinstance(raw_doc, dict) else None
                    if isinstance(raw, dict):
                        full_text = raw.get("text") or raw.get("raw_text")
                        if full_text:
                            return str(full_text)
                except Exception:
                    pass
    except Exception as exc:
        print("Error fetching full text for content workflow:", exc)
    return None


def _serialize_content_source(source: ContentSource) -> dict[str, Any]:
    meta = dict(source.metadata_json or {})
    meta.pop("processed_document_id", None)
    return {
        "id": str(source.id),
        "content_id": str(source.content_id),
        "source_type": source.source_type,
        "source_external_id": source.source_external_id,
        "source_url": source.source_url,
        "raw_document_id": source.raw_document_id,
        "processed_document_id": source.processed_document_id,
        "source_title": source.source_title,
        "source_author": source.source_author,
        "source_published_at": source.source_published_at.isoformat() if source.source_published_at else None,
        "first_seen_at": source.first_seen_at.isoformat() if source.first_seen_at else None,
        "last_seen_at": source.last_seen_at.isoformat() if source.last_seen_at else None,
        "is_primary": source.is_primary,
        "metadata": meta,
        "created_at": source.created_at.isoformat() if source.created_at else None,
        "updated_at": source.updated_at.isoformat() if source.updated_at else None,
    }


def _serialize_content_media(item: ContentMedia) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "content_id": str(item.content_id),
        "media_type": item.media_type,
        "source_url": item.source_url,
        "storage_url": item.storage_url,
        "thumbnail_url": item.thumbnail_url,
        "mime_type": item.mime_type,
        "width": item.width,
        "height": item.height,
        "duration_seconds": item.duration_seconds,
        "checksum": item.checksum,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def _image_urls(media: list[dict[str, Any]]) -> list[str]:
    urls = []
    for item in media:
        media_type = str(item.get("media_type") or "").upper()
        if media_type and "IMAGE" not in media_type and "THUMBNAIL" not in media_type:
            continue
        url = item.get("storage_url") or item.get("source_url") or item.get("thumbnail_url")
        if url:
            urls.append(str(url))
    return list(dict.fromkeys(urls))


def serialize_content_series(series: ContentSeries) -> dict[str, Any]:
    return {
        "id": str(series.id),
        "user_id": str(series.user_id),
        "profile_id": str(series.profile_id),
        "title": series.title,
        "description": series.description,
        "series_type": series.series_type,
        "status": series.status,
        "current_part": series.current_part,
        "total_parts": series.total_parts,
        "context_json": series.context_json or {},
        "metadata": series.metadata_json or {},
        "created_at": series.created_at,
        "updated_at": series.updated_at,
    }


def _find_workflow(db: Session, *, user_id, profile_id, **refs) -> MediaWorkflow:
    for field, value in refs.items():
        if value is None:
            continue
        workflow = db.query(MediaWorkflow).filter(getattr(MediaWorkflow, field) == value).first()
        if workflow:
            return workflow
    workflow = MediaWorkflow(
        user_id=user_id,
        profile_id=profile_id,
        title="Untitled workflow",
        status="DRAFT",
    )
    db.add(workflow)
    db.flush()
    return workflow


def _profile_user_id(db: Session, profile_id):
    profile = db.get(SocialProfile, profile_id)
    return profile.user_id if profile else None


def _upsert_artifact(db: Session, workflow: MediaWorkflow, *, artifact_type: str, uri: str, status: str) -> WorkflowArtifact:
    artifact = db.query(WorkflowArtifact).filter(WorkflowArtifact.workflow_id == workflow.id, WorkflowArtifact.artifact_type == artifact_type, WorkflowArtifact.uri == uri).first()
    if not artifact:
        artifact = WorkflowArtifact(workflow_id=workflow.id, artifact_type=artifact_type, uri=uri)
        db.add(artifact)
    artifact.status = status
    return artifact


def _merge_status(current: str | None, next_status: str) -> str:
    order = ["DRAFT", "SOURCES_SELECTED", "PLANNING_RUNNING", "PLAN_READY", "APPROVED", "PRODUCTION_READY", "EDITING", "VOICE_READY", "RENDERING", "RENDERED", "PUBLISHED"]
    if current == "FAILED":
        return next_status
    if current not in order:
        return next_status
    return next_status if order.index(next_status) >= order.index(current) else current


def _status_from_plan(status: str) -> str:
    if status == "APPROVED":
        return "APPROVED"
    if status in {"REJECTED", "SUPERSEDED"}:
        return status
    return "PLAN_READY"


def _serialize_source(source: WorkflowSource) -> dict[str, Any]:
    return {
        "id": str(source.id),
        "source_type": source.source_type,
        "source_id": str(source.source_id) if source.source_id else None,
        "content_id": str(source.content_id) if source.content_id else None,
        "story_id": str(source.story_id) if source.story_id else None,
        "episode_id": str(source.episode_id) if source.episode_id else None,
        "role": source.role,
        "status": source.status,
        "score": float(source.score or 0),
        "metadata": source.metadata_json or {},
    }


def _serialize_candidate(candidate: WorkflowCandidate) -> dict[str, Any]:
    return {
        "id": str(candidate.id),
        "content_id": str(candidate.content_id) if candidate.content_id else None,
        "story_id": str(candidate.story_id) if candidate.story_id else None,
        "episode_id": str(candidate.episode_id) if candidate.episode_id else None,
        "rank_order": candidate.rank_order,
        "score": float(candidate.score or 0),
        "eligible": candidate.eligible,
        "metadata": candidate.metadata_json or {},
    }


def _workflow_draft_json(workflow: MediaWorkflow) -> dict[str, Any]:
    draft = getattr(workflow, "draft_json", None)
    if isinstance(draft, dict):
        return draft
    metadata = workflow.metadata_json if isinstance(workflow.metadata_json, dict) else {}
    draft = metadata.get("draft_json")
    return draft if isinstance(draft, dict) else {}


def _normalized_workflow_draft_json(workflow: MediaWorkflow) -> dict[str, Any]:
    draft = dict(_workflow_draft_json(workflow))
    raw_scenes = draft.get("story_data")
    if not isinstance(raw_scenes, list):
        raw_scenes = draft.get("scenes") if isinstance(draft.get("scenes"), list) else []
    if not raw_scenes and isinstance(draft.get("script_parts"), list):
        raw_scenes = _legacy_script_parts_to_story_data(draft["script_parts"])
    if not isinstance(raw_scenes, list):
        return draft
    normalized_scenes = []
    for index, raw in enumerate(raw_scenes, start=1):
        if not isinstance(raw, dict):
            continue
        normalized_scenes.append(_normalize_story_scene(raw, index))
    draft["story_data"] = normalized_scenes
    draft.pop("script_parts", None)
    draft.pop("script_part", None)
    draft.pop("scenes", None)
    return draft


def _legacy_script_parts_to_story_data(script_parts: list[Any]) -> list[dict[str, Any]]:
    scenes: list[dict[str, Any]] = []
    for part in script_parts:
        if not isinstance(part, dict):
            continue
        voiceover = str(part.get("voiceover") or "").strip()
        if not voiceover:
            lines = [
                str(part.get("hook_direction") or "").strip(),
                *[str(item).strip() for item in part.get("main_beats") or [] if str(item).strip()],
                str(part.get("ending_direction") or "").strip(),
            ]
            voiceover = " ".join(line for line in lines if line)
        for segment in _split_scene_text(voiceover):
            scenes.append(
                {
                    "duration": round(max(3.0, min(8.0, len(segment.split()) / 2.5 + 0.8)), 2),
                    "image": DEFAULT_STORY_IMAGES[len(scenes) % len(DEFAULT_STORY_IMAGES)],
                    "effect": DEFAULT_STORY_EFFECTS[len(scenes) % len(DEFAULT_STORY_EFFECTS)],
                    "fit": "cover",
                    "subtitle": _compact_scene_text(segment, 140),
                    "voice_text": segment,
                }
            )
    return scenes


def _split_scene_text(text: str) -> list[str]:
    import re

    sentences = [item.strip() for item in re.split(r"(?<=[.!?。！？])\s+", text) if item.strip()]
    return sentences or ([text.strip()] if text.strip() else [])


def _compact_scene_text(text: str, limit: int) -> str:
    value = " ".join(str(text or "").split())
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 1)].rstrip() + "..."


def _serialize_story_data(draft_json: dict[str, Any], workflow: MediaWorkflow) -> list[dict[str, Any]]:
    raw_scenes = draft_json.get("story_data")
    if not isinstance(raw_scenes, list):
        raw_scenes = draft_json.get("scenes") if isinstance(draft_json.get("scenes"), list) else []

    result: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_scenes, start=1):
        if not isinstance(raw, dict):
            continue
        result.append(_normalize_story_scene(raw, index))
    return result


def _normalize_story_scene(raw: dict[str, Any], index: int) -> dict[str, Any]:
    subtitle = str(raw.get("subtitle") or raw.get("text") or raw.get("voice_text") or raw.get("voiceover") or "").strip()
    voice_text = str(raw.get("voice_text") or raw.get("voiceover") or "").strip()
    try:
        duration = float(raw.get("duration") if raw.get("duration") is not None else raw.get("duration_seconds") or 4)
    except (TypeError, ValueError):
        duration = 4.0
    image = str(raw.get("image") or raw.get("src") or "").strip()
    if not image or (image.startswith("assets/images/") and image not in DEFAULT_STORY_IMAGES):
        image = DEFAULT_STORY_IMAGES[(index - 1) % len(DEFAULT_STORY_IMAGES)]
    scene: dict[str, Any] = {
        "duration": round(max(3.0, min(8.0, duration)), 2),
        "image": image,
        "effect": DEFAULT_STORY_EFFECTS[(index - 1) % len(DEFAULT_STORY_EFFECTS)],
        "fit": "cover" if str(raw.get("fit") or "cover").lower() == "cover" else "contain",
        "subtitle": _compact_scene_text(subtitle, 140),
    }
    if voice_text and voice_text != scene["subtitle"]:
        scene["voice_text"] = voice_text
    for key in ("media_type", "scale", "opacity", "position_x", "position_y", "rotation", "subtitle_start", "subtitle_duration"):
        if raw.get(key) is not None:
            scene[key] = raw[key]
    if isinstance(raw.get("text_style"), dict):
        scene["text_style"] = raw["text_style"]
    if raw.get("voice_subtitle"):
        scene["voice_subtitle"] = str(raw["voice_subtitle"])
    if isinstance(raw.get("timing"), dict):
        scene["timing"] = raw["timing"]
    return scene


def _serialize_run(run: WorkflowRun) -> dict[str, Any]:
    status = run.status
    current_stage = run.current_stage
    if run.run_type == "PLANNING" and status == "WAITING_REVIEW" and getattr(getattr(run, "workflow", None), "status", None) == "APPROVED":
        status = "SUCCEEDED"
        current_stage = "APPROVED"
    return {
        "id": str(run.id),
        "run_type": run.run_type,
        "status": status,
        "current_stage": current_stage,
        "progress_percent": float(run.progress_percent or 0),
        "error_message": run.error_message,
        "metadata": run.metadata_json or {},
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
    }


def _serialize_artifact(artifact: WorkflowArtifact) -> dict[str, Any]:
    return {
        "id": str(artifact.id),
        "artifact_type": artifact.artifact_type,
        "uri": artifact.uri,
        "status": artifact.status,
        "metadata": artifact.metadata_json or {},
        "created_at": artifact.created_at.isoformat() if artifact.created_at else None,
        "updated_at": artifact.updated_at.isoformat() if artifact.updated_at else None,
    }
