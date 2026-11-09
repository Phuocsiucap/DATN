from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from common.core.crawl_source_config import effective_source_configuration
from common.db.models import CrawlJob, CrawlJobSource, CrawlSourceConfig, User


def validate_source_config(source_type: str, configuration: dict) -> None:
    if source_type != "BILIBILI":
        raise HTTPException(400, "Loại nguồn chưa hỗ trợ crawl")
    if {"max_items", "limit"} & configuration.keys():
        raise HTTPException(400, "Số bài chỉ được cấu hình khi tạo job")
    options = configuration.get("job_options", [])
    supported = {"source_url", "keywords"}
    if not isinstance(options, list) or any(not isinstance(key, str) or key not in supported for key in options):
        raise HTTPException(400, "Tùy chọn của nguồn không hợp lệ")
    queries = configuration.get("queries")
    if queries is not None and (
        not isinstance(queries, list) or any(not isinstance(query, str) or not query.strip() for query in queries)
    ):
        raise HTTPException(400, "Danh sách truy vấn Bilibili không hợp lệ")
    max_duration_seconds = configuration.get("max_duration_seconds")
    if max_duration_seconds is not None:
        try:
            value = int(max_duration_seconds)
        except (TypeError, ValueError):
            raise HTTPException(400, "Thời lượng tối đa Bilibili không hợp lệ") from None
        if value < 60 or value > 86400:
            raise HTTPException(400, "Thời lượng tối đa Bilibili phải từ 60 đến 86400 giây")


def serialize_source_config(config: CrawlSourceConfig) -> dict:
    creator_name = None
    if config.creator:
        creator_name = config.creator.full_name or config.creator.email or "Người dùng"
    return {
        "id": str(config.id),
        "name": config.name,
        "source_type": config.source_type,
        "source_url": config.source_url,
        "keywords": config.keywords or [],
        "configuration": effective_source_configuration(config.source_type, config.configuration),
        "status": config.status,
        "description": config.description,
        "creator_name": creator_name,
        "created_at": config.created_at.isoformat() if config.created_at else None,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


def list_source_configs(db: Session, *, source_type: str | None, status: str | None) -> dict:
    query = (
        db.query(CrawlSourceConfig)
        .options(joinedload(CrawlSourceConfig.creator))
        .filter(CrawlSourceConfig.source_type == "BILIBILI")
    )
    if source_type:
        query = query.filter(CrawlSourceConfig.source_type == source_type.upper())
    if status:
        query = query.filter(CrawlSourceConfig.status == status.upper())
    configs = query.order_by(CrawlSourceConfig.created_at.desc()).limit(200).all()
    return {"items": [serialize_source_config(config) for config in configs]}


def create_source_config(db: Session, user: User, payload) -> dict:
    source_type = payload.source_type.strip().upper()
    validate_source_config(source_type, payload.configuration)
    config = CrawlSourceConfig(
        name=payload.name.strip(),
        source_type=source_type,
        source_url=payload.source_url,
        keywords=payload.keywords,
        configuration=payload.configuration,
        description=payload.description,
        created_by=user.id,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return serialize_source_config(config)


def update_source_config(db: Session, config_id: uuid.UUID, payload) -> dict:
    config = db.get(CrawlSourceConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Nguồn crawl không tồn tại")
    if "configuration" in payload.model_fields_set:
        if payload.configuration is None:
            raise HTTPException(400, "Cấu hình nguồn không được null")
        validate_source_config(config.source_type, payload.configuration)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(config, field, value)
    db.commit()
    db.refresh(config)
    return serialize_source_config(config)


def toggle_source_config_status(db: Session, config_id: uuid.UUID, status: str) -> dict:
    config = db.get(CrawlSourceConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Nguồn crawl không tồn tại")
    normalized = status.strip().upper()
    if normalized not in ("ACTIVE", "PAUSED"):
        raise HTTPException(status_code=400, detail="Trạng thái phải là ACTIVE hoặc PAUSED")
    config.status = normalized
    db.commit()
    db.refresh(config)
    return serialize_source_config(config)


def delete_source_config(db: Session, config_id: uuid.UUID) -> dict:
    config = db.get(CrawlSourceConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Nguồn crawl không tồn tại")
    db.delete(config)
    db.commit()
    return {"deleted": True, "message": "Đã xóa nguồn crawl. Các crawl job đã tạo trước đó không bị ảnh hưởng."}


def create_legacy_source(db: Session, payload, user: User):
    job = (
        db.get(CrawlJob, payload.job_id)
        if payload.job_id
        else CrawlJob(
            name=payload.name or f"{payload.source_type} source config",
            crawl_mode="SOURCE_CONFIG",
            requested_by=user.id,
        )
    )
    if payload.job_id and not job:
        raise HTTPException(status_code=404, detail="Crawl job not found")
    if not payload.job_id:
        db.add(job)
        db.flush()
    source = CrawlJobSource(
        job_id=job.id,
        source_type=payload.source_type.upper(),
        source_url=payload.source_url,
        keywords=payload.keywords,
        configuration=payload.configuration,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


def list_legacy_sources(db: Session, user: User):
    query = db.query(CrawlJobSource)
    if not user.is_system_admin:
        query = query.join(CrawlJob, CrawlJob.id == CrawlJobSource.job_id).filter(CrawlJob.requested_by == user.id)
    return query.order_by(CrawlJobSource.created_at.desc()).limit(100).all()


def update_legacy_source(db: Session, source_id: uuid.UUID, payload):
    source = db.get(CrawlJobSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Crawl source not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, field, value)
    db.commit()
    db.refresh(source)
    return source


def update_legacy_source_status(db: Session, source_id: uuid.UUID, status: str):
    source = db.get(CrawlJobSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Crawl source not found")
    normalized_status = status.upper()
    if normalized_status not in ["ACTIVE", "INACTIVE"]:
        raise HTTPException(status_code=400, detail="Status must be ACTIVE or INACTIVE")
    source.status = normalized_status
    db.commit()
    db.refresh(source)
    return source


def delete_legacy_source(db: Session, source_id: uuid.UUID) -> dict:
    source = db.get(CrawlJobSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Crawl source not found")
    db.delete(source)
    db.commit()
    return {"deleted": True, "message": "Crawl source deleted. Existing content items are preserved."}
