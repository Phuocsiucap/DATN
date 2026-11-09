import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.schemas import api as schemas
from app.services.profile_planning import (
    list_profile_content_plans as list_profile_content_plans_service,
    list_profile_content_series as list_profile_content_series_service,
    list_profile_series_review as list_profile_series_review_service,
)
from common.db.models import User
from common.db.session import get_db

router = APIRouter()


@router.get("/{profile_id}/content-plans", response_model=list[schemas.MediaWorkflowResponse])
def list_profile_content_plans(
    profile_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_profile_content_plans_service(db, profile_id, user)


@router.get("/{profile_id}/content-series", response_model=list[schemas.ContentSeriesResponse])
def list_profile_content_series(
    profile_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_profile_content_series_service(db, profile_id, user)


@router.get("/{profile_id}/series-review", response_model=list[schemas.ProfileSeriesReviewResponse])
def list_profile_series_review(
    profile_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_profile_series_review_service(db, profile_id, user)