import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import CrawlJob, CrawlJobSource, User
from common.db.session import get_db
from app.api.deps import get_current_user, require_admin
from app.schemas import api as schemas

router = APIRouter()


@router.get("/source-types")
def source_types(_: User = Depends(get_current_user)):
    return [
        {"type": "BILIBILI", "supports": ["keywords", "url", "playlist", "metadata"]},
        {"type": "VNEXPRESS", "supports": ["keywords", "url", "rss", "category"]},
    ]


@router.post("/crawl-sources")
def create_source(payload: schemas.CrawlSourceCreateRequest, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    job = db.get(CrawlJob, payload.job_id) if payload.job_id else CrawlJob(name=payload.name or f"{payload.source_type} source config", crawl_mode="SOURCE_CONFIG", requested_by=user.id)
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


@router.get("/crawl-sources")
def list_sources(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(CrawlJobSource).order_by(CrawlJobSource.created_at.desc()).limit(100).all()


@router.patch("/crawl-sources/{source_id}")
def update_source(source_id: uuid.UUID, payload: schemas.CrawlSourceUpdateRequest, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    source = db.get(CrawlJobSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Crawl source not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, field, value)
    db.commit()
    db.refresh(source)
    return source


@router.delete("/crawl-sources/{source_id}")
def delete_source(source_id: uuid.UUID, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    source = db.get(CrawlJobSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Crawl source not found")
    db.delete(source)
    db.commit()
    return {"deleted": True}
