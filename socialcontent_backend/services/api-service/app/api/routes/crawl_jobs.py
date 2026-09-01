import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from common.db.models import CrawlJob, User
from common.db.session import SessionLocal, get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas
from app.services.crawl_jobs import CrawlJobService

router = APIRouter()


@router.post("", response_model=schemas.CrawlJobResponse)
def create_crawl_job(payload: schemas.CrawlJobCreateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return CrawlJobService().create(db, payload, user)


@router.get("", response_model=list[schemas.CrawlJobResponse])
def list_crawl_jobs(
    content_scope: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(CrawlJob)
    if not user.is_system_admin:
        query = query.filter(CrawlJob.requested_by == user.id)
    elif content_scope:
        query = query.filter(CrawlJob.content_scope == content_scope.upper())

    return query.order_by(CrawlJob.created_at.desc()).limit(100).all()


@router.get("/{job_id}", response_model=schemas.CrawlJobResponse)
def get_crawl_job(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_owned_job(db, job_id, user)


@router.post("/{job_id}/cancel", response_model=schemas.CrawlJobResponse)
def cancel_crawl_job(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = _get_owned_job(db, job_id, user)
    return CrawlJobService().cancel(db, job, user)


@router.post("/{job_id}/retry", response_model=schemas.CrawlJobResponse)
def retry_crawl_job(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = _get_owned_job(db, job_id, user)
    return CrawlJobService().retry(db, job, user)


@router.get("/{job_id}/events")
async def crawl_job_events(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_job(db, job_id, user)

    async def stream():
        for _ in range(60):
            with SessionLocal() as session:
                job = session.get(CrawlJob, job_id)
                if not job:
                    break
                yield (
                    "event: progress\n"
                    f"data: {{\"job_id\":\"{job.id}\",\"status\":\"{job.status}\",\"stage\":\"{job.current_stage}\","
                    f"\"progress\":{float(job.progress_percent)},\"discovered\":{job.total_discovered},"
                    f"\"processed\":{job.total_normalized},\"failed\":{job.total_failed},\"duplicates\":{job.total_duplicates}}}\n\n"
                )
                if job.status in {"SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"}:
                    break
            await asyncio.sleep(2)

    return StreamingResponse(stream(), media_type="text/event-stream")


def _get_owned_job(db: Session, job_id: uuid.UUID, user: User) -> CrawlJob:
    job = db.get(CrawlJob, job_id)
    if not job or (not user.is_system_admin and job.requested_by != user.id):
        raise HTTPException(status_code=404, detail="Crawl job not found")
    return job
