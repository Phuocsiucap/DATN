import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import ContentContext, ContentItem, ContentMedia, ContentPlan, ContentSeries, ContentSource, Module3Handoff, Module3HandoffPart, SeriesPart, SocialProfile, User
from common.db.session import get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import MODULE3_HANDOFF_CREATED
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


@router.post("", response_model=schemas.Module3HandoffResponse)
def create_module3_handoff(payload: schemas.Module3HandoffCreateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    series = db.get(ContentSeries, payload.content_series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Content series not found")
    profile = db.get(SocialProfile, series.profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Content series not found")
    plan = db.get(ContentPlan, series.content_plan_id)
    if not plan or plan.status != "APPROVED":
        raise HTTPException(status_code=400, detail="Content plan must be approved before module 3 handoff")

    handoff = create_module3_handoff_for_series(
        db,
        user=user,
        series=series,
        plan=plan,
        part_ids=payload.part_ids,
        priority=payload.priority,
        handoff_note=payload.handoff_note,
    )
    db.commit()
    db.refresh(handoff)
    publish_module3_handoff_created(handoff, series, plan)
    return _serialize_handoff_response(handoff, db)


def create_module3_handoff_for_series(
    db: Session,
    *,
    user: User,
    series: ContentSeries,
    plan: ContentPlan,
    part_ids: list[uuid.UUID] | None = None,
    priority: int = 5,
    handoff_note: str | None = None,
) -> Module3Handoff:
    existing = (
        db.query(Module3Handoff)
        .filter(
            Module3Handoff.user_id == user.id,
            Module3Handoff.content_plan_id == plan.id,
            Module3Handoff.content_series_id == series.id,
            Module3Handoff.status.in_(["READY", "IN_PROGRESS"]),
        )
        .order_by(Module3Handoff.created_at.desc())
        .first()
    )
    if existing:
        series.status = "HANDED_OFF"
        return existing

    context = _get_active_context(db, series.id)
    parts_query = db.query(SeriesPart).filter(SeriesPart.series_id == series.id)
    if part_ids:
        parts_query = parts_query.filter(SeriesPart.id.in_(part_ids))
    parts = parts_query.order_by(SeriesPart.part_number.asc()).all()
    if part_ids and len(parts) != len(set(part_ids)):
        raise HTTPException(status_code=400, detail="All part_ids must belong to the selected series")
    if not parts:
        raise HTTPException(status_code=400, detail="Content series must have at least one part")

    handoff = Module3Handoff(
        user_id=user.id,
        profile_id=series.profile_id,
        content_plan_id=plan.id,
        content_series_id=series.id,
        context_id=context.id if context else None,
        handoff_note=handoff_note,
        payload=_build_handoff_payload(db, series=series, plan=plan, parts=parts, priority=priority),
    )
    db.add(handoff)
    db.flush()
    for part in parts:
        db.add(
            Module3HandoffPart(
                handoff_id=handoff.id,
                series_part_id=part.id,
                part_number=part.part_number,
                payload=_serialize_series_part(part),
            )
        )
    series.status = "HANDED_OFF"
    return handoff


def _build_handoff_payload(
    db: Session,
    *,
    series: ContentSeries,
    plan: ContentPlan,
    parts: list[SeriesPart],
    priority: int,
) -> dict:
    payload = {
        "plan": _serialize_plan(plan),
        "source_content": _serialize_content_item(db, plan.primary_content_id),
        "plan_title": plan.title,
        "part_count": len(parts),
        "priority": priority,
    }
    if not _is_single_handoff(plan=plan, series=series):
        payload.update(
            {
                "series": _serialize_series(series),
                "series_title": series.title,
                "context_version": series.context_version,
            }
        )
    return payload


def _is_single_handoff(*, plan: ContentPlan, series: ContentSeries) -> bool:
    return (plan.planning_mode or "").upper() == "SINGLE" or (series.series_type or "").upper() == "SINGLE" or series.total_parts <= 1


def _sanitize_handoff_payload(payload: dict | None, db: Session, handoff: Module3Handoff) -> dict:
    next_payload = dict(payload or {})
    plan_payload = next_payload.get("plan") if isinstance(next_payload.get("plan"), dict) else {}
    planning_mode = str(plan_payload.get("planning_mode") or "").upper()
    is_single = planning_mode == "SINGLE"
    if not is_single:
        series = db.get(ContentSeries, handoff.content_series_id)
        plan = db.get(ContentPlan, handoff.content_plan_id)
        if series and plan:
            is_single = _is_single_handoff(plan=plan, series=series)
    if is_single:
        next_payload.pop("series", None)
        next_payload.pop("series_title", None)
        next_payload.pop("context_version", None)
    return next_payload


def _serialize_handoff_response(handoff: Module3Handoff, db: Session) -> dict:
    return {
        "id": handoff.id,
        "status": handoff.status,
        "handoff_note": handoff.handoff_note,
        "payload": _sanitize_handoff_payload(handoff.payload, db, handoff),
        "created_at": handoff.created_at,
        "updated_at": handoff.updated_at,
        "parts": handoff.parts,
    }


def publish_module3_handoff_created(handoff: Module3Handoff, series: ContentSeries, plan: ContentPlan) -> None:
    publish(
        MODULE3_HANDOFF_CREATED,
        build_event(
            event_type=MODULE3_HANDOFF_CREATED,
            source="api-service",
            payload={"handoff_id": str(handoff.id), "series_id": str(series.id), "plan_id": str(plan.id)},
        ),
    )


def _get_active_context(db: Session, series_id: uuid.UUID) -> ContentContext | None:
    return (
        db.query(ContentContext)
        .filter(ContentContext.series_id == series_id, ContentContext.is_active == True)  # noqa: E712
        .order_by(ContentContext.version.desc())
        .first()
    )


def _serialize_plan(plan: ContentPlan) -> dict:
    return {
        "id": str(plan.id),
        "planning_job_id": str(plan.planning_job_id),
        "profile_id": str(plan.profile_id),
        "primary_content_id": str(plan.primary_content_id) if plan.primary_content_id else None,
        "primary_story_id": str(plan.primary_story_id) if plan.primary_story_id else None,
        "title": plan.title,
        "content_angle": plan.content_angle,
        "target_audience": plan.target_audience,
        "tone": plan.tone,
        "format": plan.format,
        "planning_mode": plan.planning_mode,
        "target_duration_seconds": plan.target_duration_seconds,
        "recommended_part_count": plan.recommended_part_count,
        "confidence_score": float(plan.confidence_score or 0),
        "risk_level": plan.risk_level,
        "status": plan.status,
        "version": plan.version,
        "ai_reasoning": plan.ai_reasoning or [],
        "production_requirements": plan.production_requirements or {},
        "approved_by": str(plan.approved_by) if plan.approved_by else None,
        "approved_at": plan.approved_at.isoformat() if plan.approved_at else None,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "updated_at": plan.updated_at.isoformat() if plan.updated_at else None,
    }


def _serialize_series(series: ContentSeries) -> dict:
    return {
        "id": str(series.id),
        "content_plan_id": str(series.content_plan_id),
        "profile_id": str(series.profile_id),
        "title": series.title,
        "description": series.description,
        "series_type": series.series_type,
        "total_parts": series.total_parts,
        "current_part": series.current_part,
        "status": series.status,
        "context_version": series.context_version,
        "created_at": series.created_at.isoformat() if series.created_at else None,
        "updated_at": series.updated_at.isoformat() if series.updated_at else None,
    }


def _serialize_series_part(part: SeriesPart) -> dict:
    return {
        "id": str(part.id),
        "series_id": str(part.series_id),
        "part_number": part.part_number,
        "part_type": part.part_type,
        "title": part.title,
        "goal": part.goal,
        "hook_direction": part.hook_direction,
        "ending_direction": part.ending_direction,
        "previous_part_recap": part.previous_part_recap,
        "next_part_tease": part.next_part_tease,
        "target_duration_seconds": part.target_duration_seconds,
        "status": part.status,
        "source_refs": part.source_refs or [],
        "main_beats": part.main_beats or [],
        "production_notes": part.production_notes or {},
        "risk_notes": part.risk_notes or [],
        "created_at": part.created_at.isoformat() if part.created_at else None,
        "updated_at": part.updated_at.isoformat() if part.updated_at else None,
    }


def _serialize_content_item(db: Session, content_id: uuid.UUID | None) -> dict | None:
    if not content_id:
        return None
    content = db.get(ContentItem, content_id)
    if not content:
        return None
    sources = (
        db.query(ContentSource)
        .filter(ContentSource.content_id == content.id)
        .order_by(ContentSource.is_primary.desc(), ContentSource.first_seen_at.desc())
        .all()
    )
    media_items = db.query(ContentMedia).filter(ContentMedia.content_id == content.id).order_by(ContentMedia.created_at.desc()).all()
    primary_source = sources[0] if sources else None
    full_text = _load_full_text(db, sources)
    return {
        "id": str(content.id),
        "content_type": content.content_type,
        "canonical_title": content.canonical_title,
        "summary": content.summary,
        "full_text": full_text or content.summary,
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
        "sources": [_serialize_content_source(item) for item in sources],
        "media": [_serialize_content_media(item) for item in media_items],
    }


def _load_full_text(db: Session, sources: list[ContentSource]) -> str | None:
    if not sources:
        return None
    try:
        from app.api.routes.profile_planning import _load_full_texts

        texts = _load_full_texts(sources)
        for source in sources:
            if source.content_id in texts:
                return texts[source.content_id]
    except Exception:
        return None
    return None


def _serialize_content_source(source: ContentSource) -> dict:
    return {
        "id": str(source.id),
        "source_type": source.source_type,
        "source_external_id": source.source_external_id,
        "source_url": source.source_url,
        "raw_document_id": source.raw_document_id,
        "source_title": source.source_title,
        "source_author": source.source_author,
        "source_published_at": source.source_published_at.isoformat() if source.source_published_at else None,
        "metadata_json": source.metadata_json or {},
        "first_seen_at": source.first_seen_at.isoformat() if source.first_seen_at else None,
        "last_seen_at": source.last_seen_at.isoformat() if source.last_seen_at else None,
    }


def _serialize_content_media(media: ContentMedia) -> dict:
    return {
        "id": str(media.id),
        "media_type": media.media_type,
        "source_url": media.source_url,
        "storage_url": media.storage_url,
        "thumbnail_url": media.thumbnail_url,
        "mime_type": media.mime_type,
        "width": media.width,
        "height": media.height,
        "duration_seconds": media.duration_seconds,
        "created_at": media.created_at.isoformat() if media.created_at else None,
    }


@router.get("")
def list_module3_handoffs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    handoffs = (
        db.query(Module3Handoff)
        .filter(Module3Handoff.user_id == user.id)
        .order_by(Module3Handoff.created_at.desc())
        .limit(100)
        .all()
    )
    items = []
    for handoff in handoffs:
        payload = _sanitize_handoff_payload(handoff.payload, db, handoff)
        video_project = payload.get("video_project") if isinstance(payload.get("video_project"), dict) else {}
        artifacts = video_project.get("video_artifacts") if isinstance(video_project.get("video_artifacts"), dict) else {}
        timeline = video_project.get("timeline") if isinstance(video_project.get("timeline"), dict) else {}
        audio = video_project.get("audio") if isinstance(video_project.get("audio"), dict) else {}
        project_status = str(video_project.get("project_status") or "").strip()
        if not project_status:
            if artifacts.get("final"):
                project_status = "RENDERED"
            elif audio.get("voice") or any(isinstance(clip, dict) and str(clip.get("type") or "").lower() == "voice" for clip in timeline.get("audio") or []):
                project_status = "VOICE_READY"
            elif timeline.get("video") or timeline.get("text"):
                project_status = "EDITING"
            else:
                project_status = "READY"
        items.append(
            {
            "id": handoff.id,
            "user_id": handoff.user_id,
            "profile_id": handoff.profile_id,
            "content_plan_id": handoff.content_plan_id,
            "content_series_id": handoff.content_series_id,
            "context_id": handoff.context_id,
            "status": handoff.status,
            "handoff_note": handoff.handoff_note,
            "payload": payload,
            "title": payload.get("series_title") or payload.get("plan_title"),
            "part_count": payload.get("part_count"),
            "priority": payload.get("priority"),
            "project_status": project_status,
            "timeline_duration": timeline.get("duration"),
            "rendered_video": artifacts.get("final"),
            "created_at": handoff.created_at,
            "updated_at": handoff.updated_at,
        }
        )
    return items


@router.get("/{handoff_id}", response_model=schemas.Module3HandoffResponse)
def get_module3_handoff(handoff_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    handoff = db.get(Module3Handoff, handoff_id)
    if not handoff or handoff.user_id != user.id:
        raise HTTPException(status_code=404, detail="Module 3 handoff not found")
    return _serialize_handoff_response(handoff, db)


@router.patch("/{handoff_id}", response_model=schemas.Module3HandoffResponse)
def update_module3_handoff(handoff_id: uuid.UUID, payload: schemas.Module3HandoffUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    handoff = db.get(Module3Handoff, handoff_id)
    if not handoff or handoff.user_id != user.id:
        raise HTTPException(status_code=404, detail="Module 3 handoff not found")
    if payload.status is not None:
        handoff.status = payload.status
    if payload.handoff_note is not None:
        handoff.handoff_note = payload.handoff_note
    if payload.payload is not None:
        handoff.payload = payload.payload
    if payload.parts is not None:
        by_id = {str(part.id): part for part in handoff.parts}
        for item in payload.parts:
            part_id = str(item.get("id") or "")
            if part_id not in by_id:
                continue
            part = by_id[part_id]
            if "status" in item:
                part.status = item["status"]
            if "payload" in item:
                part.payload = item["payload"] or {}
    db.commit()
    db.refresh(handoff)
    return _serialize_handoff_response(handoff, db)
