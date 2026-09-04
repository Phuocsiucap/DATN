from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy.orm import Session

from common.db.models import (
    ContentItem,
    CrawlJob,
    CrawlJobContent,
    MediaWorkflow,
    PlanningCandidate,
    PlanningRun,
    ProfileContentLink,
    PublishingQueueItem,
)


def processed_content_ids_for_user(
    db: Session,
    user_id: uuid.UUID,
    content_ids: Iterable[uuid.UUID] | None = None,
    *,
    current_crawl_job_id: uuid.UUID | None = None,
) -> set[uuid.UUID]:
    """Return canonical content already crawled, scored, produced, or queued by a user."""
    requested_ids = list(dict.fromkeys(content_ids)) if content_ids is not None else None
    if not user_id or requested_ids == []:
        return set()

    previous_crawl_query = (
        db.query(CrawlJobContent.content_id)
        .join(CrawlJob, CrawlJob.id == CrawlJobContent.job_id)
        .filter(CrawlJob.requested_by == user_id)
    )
    candidate_query = (
        db.query(PlanningCandidate.content_id)
        .join(PlanningRun, PlanningRun.id == PlanningCandidate.planning_run_id)
        .filter(PlanningRun.user_id == user_id)
    )
    workflow_query = db.query(MediaWorkflow.primary_content_id).filter(MediaWorkflow.user_id == user_id)
    recommendation_query = db.query(ProfileContentLink.content_id).filter(
        ProfileContentLink.user_id == user_id,
        ProfileContentLink.relation_type == "CONTENT_RECOMMENDATION",
        ProfileContentLink.recommended_at.is_not(None),
    )
    publishing_query = db.query(PublishingQueueItem.content_id).filter(
        PublishingQueueItem.user_id == user_id,
    )

    if current_crawl_job_id:
        previous_crawl_query = previous_crawl_query.filter(
            CrawlJobContent.job_id != current_crawl_job_id,
        )
    if requested_ids is not None:
        previous_crawl_query = previous_crawl_query.filter(CrawlJobContent.content_id.in_(requested_ids))
        candidate_query = candidate_query.filter(PlanningCandidate.content_id.in_(requested_ids))
        workflow_query = workflow_query.filter(MediaWorkflow.primary_content_id.in_(requested_ids))
        recommendation_query = recommendation_query.filter(ProfileContentLink.content_id.in_(requested_ids))
        publishing_query = publishing_query.filter(PublishingQueueItem.content_id.in_(requested_ids))

    rows = (
        *previous_crawl_query.all(),
        *candidate_query.all(),
        *workflow_query.all(),
        *recommendation_query.all(),
        *publishing_query.all(),
    )
    return {row[0] for row in rows if row[0] is not None}


def processed_source_identities_for_user(
    db: Session,
    user_id: uuid.UUID,
    *,
    source_type: str,
    current_crawl_job_id: uuid.UUID | None = None,
) -> tuple[set[str], set[str]]:
    """Return source URLs and external IDs that a private crawler should skip."""
    content_ids = processed_content_ids_for_user(
        db,
        user_id,
        current_crawl_job_id=current_crawl_job_id,
    )
    if not content_ids:
        return set(), set()

    rows = (
        db.query(ContentItem.canonical_url, ContentItem.sources_jsonb)
        .filter(ContentItem.id.in_(content_ids))
        .all()
    )
    expected_source_type = str(source_type or "").strip().upper()
    source_urls: set[str] = set()
    source_external_ids: set[str] = set()
    for canonical_url, raw_sources in rows:
        sources = raw_sources if isinstance(raw_sources, list) else []
        has_matching_source = not sources
        for source in sources:
            if not isinstance(source, dict):
                continue
            item_source_type = str(source.get("source_type") or "").strip().upper()
            if expected_source_type and item_source_type and item_source_type != expected_source_type:
                continue
            has_matching_source = True
            source_url = str(source.get("source_url") or "").strip()
            source_external_id = str(source.get("source_external_id") or "").strip()
            if source_url:
                source_urls.add(source_url)
            if source_external_id:
                source_external_ids.add(source_external_id)
        if canonical_url and has_matching_source:
            source_urls.add(str(canonical_url).strip())
    return source_urls, source_external_ids
