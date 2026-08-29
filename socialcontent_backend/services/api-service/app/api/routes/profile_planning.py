import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.schemas import api as schemas
from common.db.media_workflows import _load_content_full_text, serialize_workflow
from common.db.models import ContentItem, ContentSeries, SocialProfile, User, MediaWorkflow
from common.db.session import get_db

router = APIRouter()


def _get_owned_profile(db: Session, profile_id: uuid.UUID, user: User) -> SocialProfile:
    profile = db.get(SocialProfile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Social profile not found")
    return profile


@router.get("/{profile_id}/content-plans", response_model=list[schemas.MediaWorkflowResponse])
def list_profile_content_plans(profile_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_profile(db, profile_id, user)
    workflows = db.query(MediaWorkflow).filter(MediaWorkflow.profile_id == profile_id).order_by(MediaWorkflow.updated_at.desc()).limit(100).all()
    return [serialize_workflow(workflow, db) for workflow in workflows]


@router.get("/{profile_id}/content-series", response_model=list[schemas.ContentSeriesResponse])
def list_profile_content_series(profile_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_profile(db, profile_id, user)
    return [_serialize_series(row) for row in db.query(ContentSeries).filter(ContentSeries.profile_id == profile_id).order_by(ContentSeries.updated_at.desc()).limit(100).all()]


@router.get("/{profile_id}/series-review", response_model=list[schemas.ProfileSeriesReviewResponse])
def list_profile_series_review(profile_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_profile(db, profile_id, user)
    
    series_items = db.query(ContentSeries).filter(ContentSeries.profile_id == profile_id).order_by(ContentSeries.updated_at.desc()).limit(100).all()
    standalone_workflows = db.query(MediaWorkflow).filter(
        MediaWorkflow.profile_id == profile_id,
        MediaWorkflow.series_id == None,
        MediaWorkflow.status != "READY",
        MediaWorkflow.status != "FAILED"
    ).order_by(MediaWorkflow.updated_at.desc()).limit(100).all()
    
    result = []
    
    for series in series_items:
        workflows = (
            db.query(MediaWorkflow)
            .filter(MediaWorkflow.series_id == series.id)
            .order_by(MediaWorkflow.updated_at.desc())
            .limit(50)
            .all()
        )
        if not workflows:
            workflows = []
        result.append(
            {
                "series": _serialize_series(series),
                "articles": [
                    _review_article_payload(db, workflow)
                    for workflow in workflows
                    if workflow
                ],
            }
        )
        
    for plan in standalone_workflows:
        mock_series = {
            "id": plan.id,
            "profile_id": plan.profile_id,
            "title": plan.title or "Standalone Video",
            "description": (plan.metadata_json or {}).get("content_angle") or "Kịch bản độc lập",
            "series_type": "SINGLE",
            "total_parts": 1,
            "current_part": 1,
            "status": "ACTIVE",
            "context_version": 1,
            "created_at": plan.created_at,
            "updated_at": plan.updated_at or plan.created_at,
        }
        
        result.append(
            {
                "series": mock_series,
                "articles": [
                    _review_article_payload(db, plan)
                ],
            }
        )
        
    # Sort result by series created_at descending
    result.sort(key=lambda x: x["series"]["created_at"], reverse=True)
    return result


def _serialize_series(series: ContentSeries) -> dict:
    metadata = series.metadata_json if isinstance(series.metadata_json, dict) else {}
    category_id = metadata.get("category_id") or metadata.get("categoryId")
    return {
        "id": series.id,
        "profile_id": series.profile_id,
        "profileId": series.profile_id,
        "title": series.title,
        "description": series.description,
        "series_type": series.series_type,
        "total_parts": series.total_parts,
        "current_part": series.current_part,
        "status": series.status,
        "context_version": int((series.context_json or {}).get("version") or 1),
        "category_id": category_id,
        "categoryId": category_id,
        "category": metadata.get("category"),
        "metadata": metadata,
        "created_at": series.created_at,
        "updated_at": series.updated_at,
    }


def _review_article_payload(db: Session, plan: MediaWorkflow) -> dict:
    content = db.get(ContentItem, plan.primary_content_id) if plan.primary_content_id else None
    serialized = serialize_workflow(plan, db)
    return {
        "plan": serialized,
        "source_content": _serialize_source_content(content) if content else None,
        "story_data": serialized.get("story_data") or [],
    }

def _serialize_source_content(content: ContentItem) -> dict:
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources else {}
    source_metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    if not isinstance(source_metadata, dict):
        source_metadata = {}
    media = content.media_jsonb if isinstance(content.media_jsonb, list) else []
    article_id = source_metadata.get("article_id")
    category_id = source_metadata.get("category_id")
    site_id = source_metadata.get("site_id")
    
    return {
        "id": content.id,
        "content_type": content.content_type,
        "canonical_title": content.canonical_title,
        "summary": content.summary,
        "full_text": _load_content_full_text(content.mongo_normalized_id) or content.summary,
        "language": content.language,
        "status": content.status,
        "canonical_url": content.canonical_url,
        "source_type": primary_source.get("source_type"),
        "source_url": primary_source.get("source_url"),
        "source_author": primary_source.get("source_author"),
        "source_published_at": primary_source.get("source_published_at"),
        "source_metadata": source_metadata,
        "article_id": article_id,
        "articleId": article_id,
        "category_id": category_id,
        "categoryId": category_id,
        "category": source_metadata.get("category"),
        "site_id": site_id,
        "siteId": site_id,
        "quality_score": float(content.quality_score or 0),
        "published_at": content.published_at,
        "created_at": content.created_at,
        "updated_at": content.updated_at,
        "sources": sources,
        "media": media,
    }
