from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from common.db.models import CrawlJob, CrawlTask, ProcessingRun
import logging

logger = logging.getLogger(__name__)

ACTIVE_TASK_STATUSES = {"PENDING", "QUEUED", "RUNNING", "RETRYING"}


def add_crawl_log(
    db: Session,
    *,
    job_id: uuid.UUID | str,
    task_id: uuid.UUID | str | None = None,
    source_type: str | None = None,
    stage: str,
    level: str = "INFO",
    message: str,
    metadata: dict[str, Any] | None = None,
):
    log_msg = f"[Job {job_id}] [Stage: {stage}] {message} | Meta: {metadata}"
    if level.upper() == "ERROR":
        logger.error(log_msg)
    elif level.upper() == "DEBUG":
        logger.debug(log_msg)
    else:
        logger.info(log_msg)


def canonical_saved_count(db: Session, job_id: uuid.UUID) -> int:
    return (
        db.query(func.count(ProcessingRun.id))
        .filter(
            ProcessingRun.job_id == job_id,
            ProcessingRun.processing_type == "CANONICAL_SAVE",
            ProcessingRun.status == "SUCCEEDED",
        )
        .scalar()
        or 0
    )


def finalize_job_if_ready(db: Session, job: CrawlJob | None) -> bool:
    if not job or job.status in {"SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"}:
        return False

    tasks = list(job.tasks)
    if not tasks:
        return False
    if any(task.status in ACTIVE_TASK_STATUSES for task in tasks):
        return False

    saved_count = canonical_saved_count(db, job.id)
    if job.total_crawled > 0 and saved_count + job.total_failed < job.total_crawled:
        return False

    failed_tasks = sum(1 for task in tasks if task.status == "FAILED")
    if failed_tasks == len(tasks) and job.total_crawled == 0:
        next_status = "FAILED"
    elif failed_tasks or job.total_failed:
        next_status = "PARTIAL_SUCCESS"
    else:
        next_status = "SUCCEEDED"

    job.status = next_status
    job.current_stage = "COMPLETED"
    job.completed_at = datetime.utcnow()
    job.progress_percent = 100
    add_crawl_log(
        db,
        job_id=job.id,
        stage="COMPLETED",
        level="INFO" if next_status != "FAILED" else "ERROR",
        message=f"Crawl job finished with status {next_status}",
        metadata={
            "total_tasks": len(tasks),
            "failed_tasks": failed_tasks,
            "total_crawled": job.total_crawled,
            "canonical_saved": saved_count,
            "total_failed": job.total_failed,
        },
    )
    return True
