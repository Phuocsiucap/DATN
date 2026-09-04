from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_creator
from app.services.creator_dashboard import (
    creator_dashboard_overview,
    creator_dashboard_projects,
    creator_dashboard_publishing,
)
from common.db.models import User
from common.db.session import get_db


router = APIRouter()


@router.get("/overview")
def get_creator_dashboard_overview(
    current_user: User = Depends(require_creator),
    db: Session = Depends(get_db),
):
    return creator_dashboard_overview(db, current_user.id)


@router.get("/publishing")
def get_creator_dashboard_publishing(
    current_user: User = Depends(require_creator),
    db: Session = Depends(get_db),
):
    return creator_dashboard_publishing(db, current_user.id)


@router.get("/projects")
def get_creator_dashboard_projects(
    current_user: User = Depends(require_creator),
    db: Session = Depends(get_db),
):
    return creator_dashboard_projects(db, current_user.id)
