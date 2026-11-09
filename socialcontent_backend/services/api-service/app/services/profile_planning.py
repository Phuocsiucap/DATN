from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from common.db.media_workflows import _load_content_full_text, serialize_workflows
from common.db.models import ContentItem, ContentSeries, MediaWorkflow, SocialProfile, User


def _owned_profile(db: Session, profile_id: uuid.UUID, user: User) -> SocialProfile:
    profile = db.get(SocialProfile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Social profile not found")
    return profile


def list_profile_content_plans(db: Session, profile_id: uuid.UUID, user: User) -> list[dict]:
    _owned_profile(db, profile_id, user)
    workflows = (
        db.query(MediaWorkflow)
        .filter(MediaWorkflow.profile_id == profile_id)
        .order_by(MediaWorkflow.updated_at.desc())
        .limit(100)
        .all()
    )
    return serialize_workflows(workflows, db)


def list_profile_content_series(db: Session, profile_id: uuid.UUID, user: User) -> list[dict]:
    _owned_profile(db, profile_id, user)
    series = (
        db.query(ContentSeries)
        .filter(ContentSeries.profile_id == profile_id)
        .order_by(ContentSeries.updated_at.desc())
        .limit(100)
        .all()
    )
    return [serialize_series(item) for item in series]


def list_profile_series_review(db: Session, profile_id: uuid.UUID, user: User) -> list[dict]:
    _owned_profile(db, profile_id, user)
    series_items = (
        db.query(ContentSeries)
        .filter(ContentSeries.profile_id == profile_id)
        .order_by(ContentSeries.updated_at.desc())
        .limit(100)
        .all()
    )
    standalone_workflows = (
        db.query(MediaWorkflow)
        .filter(
            MediaWorkflow.profile_id == profile_id,
            MediaWorkflow.series_id.is_(None),
            MediaWorkflow.status.notin_(("READY", "FAILED")),
        )
        .order_by(MediaWorkflow.updated_at.desc())
        .limit(100)
        .all()
    )

    series_ids = [series.id for series in series_items]
    workflows_by_series: dict[uuid.UUID, list[MediaWorkflow]] = {series_id: [] for series_id in series_ids}
    if series_ids:
        ranked_workflows = (
            db.query(
                MediaWorkflow.id.label("workflow_id"),
                func.row_number().over(
                    partition_by=MediaWorkflow.series_id,
                    order_by=(MediaWorkflow.updated_at.desc(), MediaWorkflow.id.desc()),
                ).label("series_rank"),
            )
            .filter(MediaWorkflow.series_id.in_(series_ids))
            .subquery()
        )
        series_workflows = (
            db.query(MediaWorkflow)
            .join(ranked_workflows, MediaWorkflow.id == ranked_workflows.c.workflow_id)
            .filter(ranked_workflows.c.series_rank <= 50)
            .order_by(MediaWorkflow.series_id, MediaWorkflow.updated_at.desc(), MediaWorkflow.id.desc())
            .all()
        )
        for workflow in series_workflows:
            workflows_by_series.setdefault(workflow.series_id, []).append(workflow)

    all_workflows = [workflow for group in workflows_by_series.values() for workflow in group]
    all_workflows.extend(standalone_workflows)
    serialized_by_id = {item["id"]: item for item in serialize_workflows(all_workflows, db)}
    source_content_ids = {
        workflow.primary_content_id for workflow in all_workflows if workflow.primary_content_id
    }
    source_contents = (
        db.query(ContentItem).filter(ContentItem.id.in_(source_content_ids)).all()
        if source_content_ids
        else []
    )
    source_contents_by_id = {content.id: content for content in source_contents}

    def article_payload(workflow: MediaWorkflow) -> dict:
        serialized = serialized_by_id[str(workflow.id)]
        content = source_contents_by_id.get(workflow.primary_content_id)
        return {
            "plan": serialized,
            "source_content": serialize_source_content(content) if content else None,
            "story_data": serialized.get("story_data") or [],
        }

    result = [
        {
            "series": serialize_series(series),
            "articles": [article_payload(workflow) for workflow in workflows_by_series.get(series.id, [])],
        }
        for series in series_items
    ]
    for plan in standalone_workflows:
        result.append({
            "series": {
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
            },
            "articles": [article_payload(plan)],
        })
    result.sort(key=lambda item: item["series"]["created_at"], reverse=True)
    return result


def serialize_series(series: ContentSeries) -> dict:
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


def serialize_source_content(content: ContentItem) -> dict:
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
