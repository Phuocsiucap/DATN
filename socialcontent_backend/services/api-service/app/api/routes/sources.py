import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin, require_system_admin
from app.schemas import api as schemas
from app.services.crawl_sources import (
    create_legacy_source as create_legacy_source_service,
    create_source_config as create_source_config_service,
    delete_legacy_source as delete_legacy_source_service,
    delete_source_config as delete_source_config_service,
    list_legacy_sources as list_legacy_sources_service,
    list_source_configs as list_source_configs_service,
    toggle_source_config_status as toggle_source_config_status_service,
    update_legacy_source as update_legacy_source_service,
    update_legacy_source_status as update_legacy_source_status_service,
    update_source_config as update_source_config_service,
)
from common.db.models import User
from common.db.session import get_db

router = APIRouter()


@router.get("/source-types")
def source_types(_: User = Depends(get_current_user)):
    return [
        {"type": "BILIBILI", "supports": ["keywords", "url", "queries", "max_duration_seconds", "playlist", "metadata"]},
        {"type": "MANUAL", "supports": ["manual_input"], "description": "Nội dung nhập thủ công"},
    ]


@router.get("/crawl-source-configs")
def list_source_configs(
    source_type: str | None = None,
    status: str | None = None,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_source_configs_service(db, source_type=source_type, status=status)


@router.post("/crawl-source-configs", status_code=201)
def create_source_config(
    payload: schemas.CrawlSourceConfigCreateRequest,
    user: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    return create_source_config_service(db, user, payload)


@router.patch("/crawl-source-configs/{config_id}")
def update_source_config(
    config_id: uuid.UUID,
    payload: schemas.CrawlSourceConfigUpdateRequest,
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    return update_source_config_service(db, config_id, payload)


@router.patch("/crawl-source-configs/{config_id}/status")
def toggle_source_config_status(
    config_id: uuid.UUID,
    status: str = Query(...),
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    return toggle_source_config_status_service(db, config_id, status)


@router.delete("/crawl-source-configs/{config_id}")
def delete_source_config(
    config_id: uuid.UUID,
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    return delete_source_config_service(db, config_id)


@router.post("/crawl-sources", status_code=201)
def create_source(
    payload: schemas.CrawlSourceCreateRequest,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return create_legacy_source_service(db, payload, user)


@router.get("/crawl-sources")
def list_sources(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_legacy_sources_service(db, user)


@router.patch("/crawl-sources/{source_id}")
def update_source(
    source_id: uuid.UUID,
    payload: schemas.CrawlSourceUpdateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return update_legacy_source_service(db, source_id, payload)


@router.patch("/crawl-sources/{source_id}/status")
def update_source_status(
    source_id: uuid.UUID,
    status: str,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return update_legacy_source_status_service(db, source_id, status)


@router.delete("/crawl-sources/{source_id}")
def delete_source(
    source_id: uuid.UUID,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return delete_legacy_source_service(db, source_id)