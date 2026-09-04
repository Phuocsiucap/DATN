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


@router.post("", response_model=schemas.CrawlJobResponse, status_code=201)
def create_crawl_job(payload: schemas.CrawlJobCreateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return CrawlJobService().create(db, payload, user)


@router.get("", response_model=list[schemas.CrawlJobResponse])
def list_crawl_jobs(
    content_scope: str | None = None,
    status: str | None = None,
    source_type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(CrawlJob)
    if not user.is_system_admin:
        query = query.filter(CrawlJob.requested_by == user.id)
    elif content_scope:
        query = query.filter(CrawlJob.content_scope == content_scope.upper())

    if status:
        query = query.filter(CrawlJob.status == status.upper())
    if source_type:
        from common.db.models import CrawlJobSource
        query = query.filter(CrawlJob.sources.any(CrawlJobSource.source_type == source_type.upper()))
    if date_from:
        from datetime import datetime as dt
        try:
            query = query.filter(CrawlJob.created_at >= dt.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        from datetime import datetime as dt, timedelta
        try:
            query = query.filter(CrawlJob.created_at < dt.fromisoformat(date_to) + timedelta(days=1))
        except ValueError:
            pass
    if q:
        query = query.filter(CrawlJob.name.ilike(f"%{q}%"))

    return query.order_by(CrawlJob.created_at.desc()).limit(200).all()


@router.get("/{job_id}", response_model=schemas.CrawlJobResponse)
def get_crawl_job(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_owned_job(db, job_id, user)


@router.post("/{job_id}/cancel", response_model=schemas.CrawlJobResponse)
def cancel_crawl_job(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = _get_owned_job(db, job_id, user)
    return CrawlJobService().cancel(db, job, user)


@router.put("/{job_id}/schedule", response_model=schemas.CrawlJobResponse)
def update_crawl_job_schedule(
    job_id: uuid.UUID,
    payload: schemas.CrawlJobScheduleRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = _get_owned_job(db, job_id, user)
    if job.crawl_mode == "SCHEDULED_RUN":
        raise HTTPException(status_code=409, detail="Không thể đặt lịch trên một lần chạy được sinh tự động")
    if job.status in {"PENDING", "QUEUED", "RUNNING"}:
        raise HTTPException(status_code=409, detail="Không thể đổi lịch khi job đang được xử lý")
    return CrawlJobService().update_schedule(db, job, payload, user)


@router.post("/{job_id}/retry", response_model=schemas.CrawlJobResponse)
def retry_crawl_job(job_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = _get_owned_job(db, job_id, user)
    if job.crawl_mode == "SOURCE_CONFIG":
        raise HTTPException(status_code=409, detail="Hãy bật lịch để tiếp tục chạy job định kỳ")
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
