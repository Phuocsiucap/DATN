from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from common.db.models import (
    ContentItem,
    ContentMedia,
    ContentPlan,
    ContentSource,
    ContentProject,
    Episode,
    ProjectArtifact,
    ProjectCandidate,
    ProjectPart,
    ProjectRun,
    ProjectSeries,
    ProjectSource,
    SocialProfile,
    Story,
)


def sync_project_from_plan(db: Session, plan: ContentPlan) -> ContentProject:
    project = db.get(ContentProject, plan.project_id) if plan.project_id else None
    if not project:
        project = _find_project(db, content_plan_id=plan.id, user_id=_profile_user_id(db, plan.profile_id), profile_id=plan.profile_id)
    plan.project_id = project.id
    project.content_plan_id = plan.id
    project.profile_id = plan.profile_id
    project.planning_mode = plan.planning_mode
    project.primary_content_id = plan.primary_content_id
    project.primary_story_id = plan.primary_story_id
    project.title = plan.title or project.title
    project.status = _status_from_plan(plan.status)
    project.metadata_json = {
        **(project.metadata_json or {}),
        "content_angle": plan.content_angle,
        "target_audience": plan.target_audience,
        "tone": plan.tone,
        "format": plan.format,
        "risk_level": plan.risk_level,
        "confidence_score": float(plan.confidence_score or 0),
        "production_requirements": plan.production_requirements or {},
    }
    db.add(project)
    db.flush()
    return project


def serialize_project(project: ContentProject, db: Session | None = None) -> dict[str, Any]:
    final_artifact = next((item for item in project.artifacts if item.artifact_type == "FINAL_VIDEO" and item.uri), None)
    source_context = _project_source_context(project, db) if db else {"source_content": None, "media": [], "images": []}
    metadata = {
        **(project.metadata_json or {}),
        **(
            {
                "source_content": source_context["source_content"],
                "media": source_context["media"],
                "images": source_context["images"],
            }
            if source_context["source_content"] or source_context["media"] or source_context["images"]
            else {}
        ),
    }
    return {
        "id": str(project.id),
        "user_id": str(project.user_id),
        "profile_id": str(project.profile_id),
        "series_id": str(project.series_id) if project.series_id else None,
        "title": project.title,
        "status": project.status,
        "planning_mode": project.planning_mode,
        "primary_content_id": str(project.primary_content_id) if project.primary_content_id else None,
        "primary_story_id": str(project.primary_story_id) if project.primary_story_id else None,
        "content_plan_id": str(project.content_plan_id) if project.content_plan_id else None,
        "video_draft_id": str(project.video_draft_id) if project.video_draft_id else None,
        "current_stage": project.current_stage,
        "progress_percent": float(project.progress_percent or 0),
        "timeline_duration": (project.metadata_json or {}).get("timeline_duration"),
        "rendered_video": final_artifact.uri if final_artifact else None,
        "metadata": metadata,
        "source_content": source_context["source_content"],
        "media": source_context["media"],
        "images": source_context["images"],
        "series": serialize_project_series(project.series) if project.series else None,
        "sources": [_serialize_source(item) for item in project.sources],
        "candidates": [_serialize_candidate(item) for item in project.candidates],
        "parts": [_serialize_part(item) for item in sorted(project.parts, key=lambda part: part.part_number)],
        "runs": [_serialize_run(item) for item in project.runs],
        "artifacts": [_serialize_artifact(item) for item in project.artifacts],
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def _project_source_context(project: ContentProject, db: Session) -> dict[str, Any]:
    content_ids = _project_content_ids(project, db)
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
    source_content = _serialize_source_content(_primary_project_content(project, contents), sources, media)
    images = _image_urls(media)
    return {"source_content": source_content, "media": media, "images": images}


def _project_content_ids(project: ContentProject, db: Session) -> list[Any]:
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

    add(project.primary_content_id)
    add_story(project.primary_story_id)

    if project.content_plan_id:
        plan = db.get(ContentPlan, project.content_plan_id)
        if plan:
            add(plan.primary_content_id)
            add_story(plan.primary_story_id)

    for source in project.sources:
        add(source.content_id)
        add_story(source.story_id)
        add_episode(source.episode_id)

    for candidate in project.candidates:
        add(candidate.content_id)
        add_story(candidate.story_id)
        add_episode(candidate.episode_id)

    for part in project.parts:
        payload = part.payload or {}
        for ref in _source_refs_from_payload(payload):
            if not isinstance(ref, dict):
                continue
            add(ref.get("content_id"))
            add_story(ref.get("story_id"))
            add_episode(ref.get("episode_id"))

    return ids


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


def _primary_project_content(project: ContentProject, contents: list[ContentItem]) -> ContentItem | None:
    by_id = {content.id: content for content in contents}
    if project.primary_content_id and project.primary_content_id in by_id:
        return by_id[project.primary_content_id]
    return contents[0] if contents else None


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
        "sources": [_serialize_content_source(source) for source in content_sources],
        "media": [item for item in media if item.get("content_id") == str(content.id)],
    }


def _load_content_full_text(sources: list[ContentSource]) -> str | None:
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
        print("Error fetching full text for content project:", exc)
    return None


def _serialize_content_source(source: ContentSource) -> dict[str, Any]:
    return {
        "id": str(source.id),
        "content_id": str(source.content_id),
        "source_type": source.source_type,
        "source_external_id": source.source_external_id,
        "source_url": source.source_url,
        "raw_document_id": source.raw_document_id,
        "source_title": source.source_title,
        "source_author": source.source_author,
        "source_published_at": source.source_published_at.isoformat() if source.source_published_at else None,
        "first_seen_at": source.first_seen_at.isoformat() if source.first_seen_at else None,
        "last_seen_at": source.last_seen_at.isoformat() if source.last_seen_at else None,
        "is_primary": source.is_primary,
        "metadata": source.metadata_json or {},
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


def serialize_project_series(series: ProjectSeries) -> dict[str, Any]:
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


def _find_project(db: Session, *, user_id, profile_id, **refs) -> ContentProject:
    for field, value in refs.items():
        if value is None:
            continue
        project = db.query(ContentProject).filter(getattr(ContentProject, field) == value).first()
        if project:
            return project
    project = ContentProject(
        user_id=user_id,
        profile_id=profile_id,
        title="Untitled project",
        status="DRAFT",
    )
    db.add(project)
    db.flush()
    return project


def _profile_user_id(db: Session, profile_id):
    profile = db.get(SocialProfile, profile_id)
    return profile.user_id if profile else None


def _upsert_artifact(db: Session, project: ContentProject, *, artifact_type: str, uri: str, status: str) -> ProjectArtifact:
    artifact = db.query(ProjectArtifact).filter(ProjectArtifact.project_id == project.id, ProjectArtifact.artifact_type == artifact_type, ProjectArtifact.uri == uri).first()
    if not artifact:
        artifact = ProjectArtifact(project_id=project.id, artifact_type=artifact_type, uri=uri)
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


def _serialize_source(source: ProjectSource) -> dict[str, Any]:
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


def _serialize_candidate(candidate: ProjectCandidate) -> dict[str, Any]:
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


def _serialize_part(part: ProjectPart) -> dict[str, Any]:
    payload = part.payload or {}
    return {
        "id": str(part.id),
        "series_id": str(part.series_id) if part.series_id else None,
        "part_number": part.part_number,
        "title": part.title,
        "status": part.status,
        "target_duration_seconds": part.target_duration_seconds if part.target_duration_seconds is not None else payload.get("target_duration_seconds"),
        "payload": payload,
    }


def _serialize_run(run: ProjectRun) -> dict[str, Any]:
    return {
        "id": str(run.id),
        "run_type": run.run_type,
        "status": run.status,
        "current_stage": run.current_stage,
        "progress_percent": float(run.progress_percent or 0),
        "error_message": run.error_message,
        "metadata": run.metadata_json or {},
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
    }


def _serialize_artifact(artifact: ProjectArtifact) -> dict[str, Any]:
    return {
        "id": str(artifact.id),
        "artifact_type": artifact.artifact_type,
        "uri": artifact.uri,
        "status": artifact.status,
        "metadata": artifact.metadata_json or {},
        "created_at": artifact.created_at.isoformat() if artifact.created_at else None,
        "updated_at": artifact.updated_at.isoformat() if artifact.updated_at else None,
    }
