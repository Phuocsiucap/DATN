from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, Callable

from sqlalchemy.orm import Session

from backend.bilibili_service.app.core.database import Base, SessionLocal, engine
from backend.bilibili_service.app.models.job import BilibiliJob
from backend.bilibili_service.app.schemas.api import CreateJobRequest, JobRecord, JobStatus, PipelineStage


class Database:
    def __init__(self) -> None:
        self.on_change: Callable[[str, JobRecord], None] | None = None
        self.init()

    def init(self) -> None:
        Base.metadata.create_all(bind=engine)

    def create_job(self, req: CreateJobRequest, user_id: int | None = None) -> JobRecord:
        now = utc_now_dt()
        initial_artifacts: dict[str, Any] = {}
        if req.source_platform:
            initial_artifacts["search_provider"] = req.source_platform
        if req.source_title:
            initial_artifacts["crawler_title"] = req.source_title

        with self.session() as session:
            row = BilibiliJob(
                user_id=user_id,
                status=JobStatus.pending.value,
                stage=PipelineStage.queued.value,
                progress=0,
                input_text=req.input_text,
                niche=req.niche.value,
                max_duration_seconds=req.max_duration_seconds,
                source_url=str(req.source_url) if req.source_url else None,
                source_platform=req.source_platform,
                source_title=req.source_title,
                artifacts_json=json.dumps(initial_artifacts, ensure_ascii=False),
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.commit()
            session.refresh(row)
            job = row_to_job(row)

        self._notify("job_created", job)
        return job

    def get_job(self, job_id: int) -> JobRecord:
        with self.session() as session:
            row = session.get(BilibiliJob, job_id)
            if row is None:
                raise KeyError(f"Job {job_id} not found")
            return row_to_job(row)

    def list_jobs(self, user_id: int | None = None) -> list[JobRecord]:
        with self.session() as session:
            query = session.query(BilibiliJob)
            if user_id is not None:
                query = query.filter((BilibiliJob.user_id == user_id) | (BilibiliJob.user_id.is_(None)))
            rows = query.order_by(BilibiliJob.id.desc()).all()
            return [row_to_job(row) for row in rows]

    def list_recoverable_jobs(self) -> list[JobRecord]:
        with self.session() as session:
            rows = (
                session.query(BilibiliJob)
                .filter(BilibiliJob.status.in_([JobStatus.pending.value, JobStatus.running.value]))
                .order_by(BilibiliJob.id.asc())
                .all()
            )
            return [row_to_job(row) for row in rows]

    def delete_job(self, job_id: int) -> JobRecord:
        with self.session() as session:
            row = session.get(BilibiliJob, job_id)
            if row is None:
                raise KeyError(f"Job {job_id} not found")
            job = row_to_job(row)
            session.delete(row)
            session.commit()

        self._notify("job_deleted", job)
        return job

    def update_job(
        self,
        job_id: int,
        *,
        status: JobStatus | None = None,
        stage: PipelineStage | None = None,
        progress: int | None = None,
        artifacts: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> JobRecord:
        with self.session() as session:
            row = session.get(BilibiliJob, job_id)
            if row is None:
                raise KeyError(f"Job {job_id} not found")

            next_artifacts = parse_artifacts(row.artifacts_json)
            if artifacts:
                next_artifacts.update(artifacts)

            if status is not None:
                row.status = status.value
            if stage is not None:
                row.stage = stage.value
            if progress is not None:
                row.progress = progress
            row.artifacts_json = json.dumps(next_artifacts, ensure_ascii=False)
            row.error_message = error_message
            row.updated_at = utc_now_dt()

            session.commit()
            session.refresh(row)
            job = row_to_job(row)

        self._notify("job_updated", job)
        return job

    def session(self) -> Session:
        return SessionLocal()

    def _notify(self, event_type: str, job: JobRecord) -> None:
        if not self.on_change:
            return
        self.on_change(event_type, job)


def row_to_job(row: BilibiliJob) -> JobRecord:
    return JobRecord(
        id=int(row.id),
        user_id=int(row.user_id) if row.user_id is not None else None,
        status=JobStatus(str(row.status)),
        stage=PipelineStage(str(row.stage)),
        progress=int(row.progress or 0),
        input_text=str(row.input_text),
        niche=str(row.niche),
        max_duration_seconds=int(row.max_duration_seconds or 180),
        source_url=str(row.source_url) if row.source_url else None,
        artifacts=parse_artifacts(row.artifacts_json),
        error_message=str(row.error_message) if row.error_message else None,
        created_at=to_iso(row.created_at),
        updated_at=to_iso(row.updated_at),
    )


def parse_artifacts(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def utc_now_dt() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def to_iso(value: datetime | None) -> str:
    if value is None:
        return utc_now()
    return value.isoformat()


def utc_now() -> str:
    return utc_now_dt().isoformat()



