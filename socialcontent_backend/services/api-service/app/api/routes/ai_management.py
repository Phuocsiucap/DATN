from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.services.ai_management import AiManagementService
from app.services.social_profiles import SocialProfileService
from common.db.models import User
from common.db.session import get_db


router = APIRouter()


class AiManagementConfigRequest(BaseModel):
    profile_id: uuid.UUID
    ai_management_enabled: bool | None = None
    ai_management_frequency_days: int | None = Field(default=None, ge=1, le=90)


class AiManagementAnalyzeRequest(BaseModel):
    profile_id: uuid.UUID
    days: int = Field(default=7, ge=1, le=90)


def _owned_profile(db: Session, profile_id: uuid.UUID, current_user: User):
    return SocialProfileService().get_owned_profile(db, profile_id, current_user)


@router.get("/config")
def get_ai_management_config(
    profile_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _owned_profile(db, profile_id, current_user)
    return AiManagementService().get_config(profile)


@router.put("/config")
def update_ai_management_config(
    payload: AiManagementConfigRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _owned_profile(db, payload.profile_id, current_user)
    return AiManagementService().update_config(
        db,
        profile,
        enabled=payload.ai_management_enabled,
        frequency_days=payload.ai_management_frequency_days,
    )


@router.post("/analyze")
def analyze_ai_management(
    payload: AiManagementAnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _owned_profile(db, payload.profile_id, current_user)
    return AiManagementService().analyze(db, profile, days=payload.days, trigger_type="manual")


@router.get("/reports")
def get_ai_management_report(
    profile_id: uuid.UUID,
    limit: int = Query(default=8, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _owned_profile(db, profile_id, current_user)
    return AiManagementService().latest_report(db, profile, limit=limit)
