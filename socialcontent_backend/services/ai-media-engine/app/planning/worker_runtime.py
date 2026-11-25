from __future__ import annotations

import asyncio

from common.workers import run_thread_worker_forever
from app.planning.consumers.candidate_review import run_candidate_review_worker
from app.planning.consumers.crawl_job_completed import run_crawl_job_completed_consumer


def start_planning_workers() -> list[asyncio.Task]:
    return [
        asyncio.create_task(run_thread_worker_forever("planning:reviewed-candidates", run_candidate_review_worker)),
        asyncio.create_task(run_thread_worker_forever("planning-orchestrator:crawl-job-completed", run_crawl_job_completed_consumer)),
    ]
