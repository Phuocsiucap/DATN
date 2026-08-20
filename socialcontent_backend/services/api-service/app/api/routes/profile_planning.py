import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.schemas import api as schemas
from common.db.models import ContentItem, ContentMedia, ContentPlan, ContentSource, Episode, ProjectPart, ProjectSeries, SocialProfile, User
from common.db.session import get_db

router = APIRouter()


def _get_owned_profile(db: Session, profile_id: uuid.UUID, user: User) -> SocialProfile:
    profile = db.get(SocialProfile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Social profile not found")
    return profile


@router.get("/{profile_id}/content-plans", response_model=list[schemas.ContentPlanResponse])
def list_profile_content_plans(profile_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_profile(db, profile_id, user)
    return db.query(ContentPlan).filter(ContentPlan.profile_id == profile_id).order_by(ContentPlan.updated_at.desc()).limit(100).all()


@router.get("/{profile_id}/project-series", response_model=list[schemas.ProjectSeriesResponse])
def list_profile_project_series(profile_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_profile(db, profile_id, user)
    return [_serialize_series(row) for row in db.query(ProjectSeries).filter(ProjectSeries.profile_id == profile_id).order_by(ProjectSeries.updated_at.desc()).limit(100).all()]


@router.get("/{profile_id}/series-review", response_model=list[schemas.ProfileSeriesReviewResponse])
def list_profile_series_review(profile_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_profile(db, profile_id, user)
    series_items = db.query(ProjectSeries).filter(ProjectSeries.profile_id == profile_id).order_by(ProjectSeries.updated_at.desc()).limit(100).all()
    result = []
    for series in series_items:
        parts = db.query(ProjectPart).filter(ProjectPart.series_id == series.id).order_by(ProjectPart.updated_at.desc(), ProjectPart.part_number.asc()).all()
        plan = _series_plan(db, series)
        content = db.get(ContentItem, plan.primary_content_id) if plan and plan.primary_content_id else None
        source = (
            db.query(ContentSource)
            .filter(ContentSource.content_id == content.id)
            .order_by(ContentSource.is_primary.desc(), ContentSource.first_seen_at.desc())
            .first()
            if content
            else None
        )
        sources = db.query(ContentSource).filter(ContentSource.content_id == content.id).all() if content else []
        media = db.query(ContentMedia).filter(ContentMedia.content_id == content.id).all() if content else []
        result.append(
            {
                "series": _serialize_series(series),
                "articles": [
                    {
                        "plan": plan,
                        "source_content": _serialize_source_content(content, source, sources, media) if content else None,
                        "parts": [_serialize_part(part) for part in parts],
                    }
                ],
            }
        )
    return result


def _series_plan(db: Session, series: ProjectSeries) -> ContentPlan | None:
    plan_id = (series.metadata_json or {}).get("content_plan_id")
    if not plan_id:
        return None
    try:
        return db.get(ContentPlan, uuid.UUID(str(plan_id)))
    except ValueError:
        return None


def _serialize_series(series: ProjectSeries) -> dict:
    metadata = series.metadata_json or {}
    return {
        "id": series.id,
        "content_plan_id": uuid.UUID(str(metadata["content_plan_id"])) if metadata.get("content_plan_id") else series.id,
        "profile_id": series.profile_id,
        "title": series.title,
        "description": series.description,
        "series_type": series.series_type,
        "total_parts": series.total_parts,
        "current_part": series.current_part,
        "status": series.status,
        "context_version": int((series.context_json or {}).get("version") or 1),
        "created_at": series.created_at,
        "updated_at": series.updated_at,
    }


def _serialize_part(part: ProjectPart) -> dict:
    payload = part.payload or {}
    return {
        "id": part.id,
        "series_id": part.series_id,
        "part_number": part.part_number,
        "part_type": payload.get("part_type") or "MIDDLE",
        "title": part.title,
        "goal": payload.get("goal"),
        "hook_direction": payload.get("hook_direction"),
        "ending_direction": payload.get("ending_direction"),
        "previous_part_recap": payload.get("previous_part_recap"),
        "next_part_tease": payload.get("next_part_tease"),
        "target_duration_seconds": part.target_duration_seconds if part.target_duration_seconds is not None else payload.get("target_duration_seconds"),
        "status": part.status,
        "source_refs": payload.get("source_refs") or [],
        "main_beats": payload.get("main_beats") or [],
        "production_notes": payload.get("production_notes") or {},
        "risk_notes": payload.get("risk_notes") or [],
        "created_at": part.created_at,
        "updated_at": part.updated_at,
    }


def _serialize_source_content(content: ContentItem, source: ContentSource | None, sources: list[ContentSource], media: list[ContentMedia]) -> dict:
    return {
        "id": content.id,
        "content_type": content.content_type,
        "canonical_title": content.canonical_title,
        "summary": content.summary,
        "full_text": None,
        "language": content.language,
        "status": content.status,
        "canonical_url": content.canonical_url,
        "source_type": source.source_type if source else None,
        "source_url": source.source_url if source else None,
        "source_author": source.source_author if source else None,
        "source_published_at": source.source_published_at if source else None,
        "quality_score": float(content.quality_score or 0),
        "published_at": content.published_at,
        "created_at": content.created_at,
        "updated_at": content.updated_at,
        "sources": [_serialize_content_source(item) for item in sources],
        "media": [_serialize_content_media(item) for item in media],
    }


def _serialize_content_source(source: ContentSource) -> dict:
    return {
        "id": source.id,
        "content_id": source.content_id,
        "source_type": source.source_type,
        "source_external_id": source.source_external_id,
        "source_url": source.source_url,
        "raw_document_id": source.raw_document_id,
        "source_title": source.source_title,
        "source_author": source.source_author,
        "source_published_at": source.source_published_at,
        "first_seen_at": source.first_seen_at,
        "last_seen_at": source.last_seen_at,
        "is_primary": source.is_primary,
        "metadata": source.metadata_json or {},
        "created_at": source.created_at,
        "updated_at": source.updated_at,
    }


def _serialize_content_media(item: ContentMedia) -> dict:
    return {
        "id": item.id,
        "content_id": item.content_id,
        "media_type": item.media_type,
        "source_url": item.source_url,
        "storage_url": item.storage_url,
        "thumbnail_url": item.thumbnail_url,
        "mime_type": item.mime_type,
        "width": item.width,
        "height": item.height,
        "duration_seconds": item.duration_seconds,
        "checksum": item.checksum,
        "created_at": item.created_at,
    }
