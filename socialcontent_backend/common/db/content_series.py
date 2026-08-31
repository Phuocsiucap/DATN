from __future__ import annotations

import unicodedata
import uuid
from typing import Any

from sqlalchemy import func

from common.db.models import ContentSeries, MediaWorkflow, SocialProfile


# Failed jobs keep their slot because they can be retried in the same workflow.
NON_COUNTING_WORKFLOW_STATUSES = {"REJECTED"}


def normalized_series_title(value: Any) -> str:
    clean = " ".join(str(value or "").split()).strip().casefold()
    return unicodedata.normalize("NFC", clean)


def series_part_count(db: Any, series_id: uuid.UUID, *, exclude_workflow_id: uuid.UUID | None = None) -> int:
    query = db.query(func.count(MediaWorkflow.id)).filter(
        MediaWorkflow.series_id == series_id,
        ~MediaWorkflow.status.in_(NON_COUNTING_WORKFLOW_STATUSES),
    )
    if exclude_workflow_id:
        query = query.filter(MediaWorkflow.id != exclude_workflow_id)
    return int(query.scalar() or 0)


def sync_series_current_part(db: Any, series_or_id: ContentSeries | uuid.UUID | None) -> ContentSeries | None:
    if not series_or_id:
        return None
    series = series_or_id if isinstance(series_or_id, ContentSeries) else (
        db.query(ContentSeries).filter(ContentSeries.id == series_or_id).with_for_update().first()
    )
    if not series:
        return None
    series.current_part = series_part_count(db, series.id)
    db.add(series)
    return series


def lock_active_series(db: Any, series_id: uuid.UUID, *, profile_id: uuid.UUID, workflow_id: uuid.UUID | None = None) -> ContentSeries | None:
    series = (
        db.query(ContentSeries)
        .filter(
            ContentSeries.id == series_id,
            ContentSeries.profile_id == profile_id,
            ContentSeries.status == "ACTIVE",
        )
        .with_for_update()
        .first()
    )
    if not series:
        return None
    series.current_part = series_part_count(db, series.id)
    occupied = series_part_count(db, series.id, exclude_workflow_id=workflow_id) if workflow_id else series.current_part
    if int(series.total_parts or 0) > 0 and occupied >= int(series.total_parts or 0):
        return None
    return series


def find_active_series_by_title(db: Any, profile_id: uuid.UUID, title: str) -> ContentSeries | None:
    target = normalized_series_title(title)
    if not target:
        return None
    rows = db.query(ContentSeries).filter(ContentSeries.profile_id == profile_id, ContentSeries.status == "ACTIVE").all()
    return next((row for row in rows if normalized_series_title(row.title) == target), None)


def lock_profile_series_scope(db: Any, profile_id: uuid.UUID) -> None:
    # Serializes CREATE_NEW for one profile even without a database expression index.
    db.query(SocialProfile.id).filter(SocialProfile.id == profile_id).with_for_update().first()
