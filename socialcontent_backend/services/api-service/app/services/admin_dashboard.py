from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from time import perf_counter
from typing import Any

import httpx
from kafka import KafkaAdminClient
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import (
    ContentItem,
    CrawlJob,
    KafkaTask,
    MediaWorkflow,
    PromptRun,
    PublishingQueueItem,
    SocialPost,
)
from common.db.mongo import get_mongo_client
from app.services.publish_scheduler import scheduler_snapshot


ACTIVE_TASK_STATUSES = ("PENDING", "QUEUED", "RUNNING", "PROCESSING", "RETRYING")
SUCCESS_TASK_STATUSES = ("COMPLETED", "SUCCEEDED")
FAILED_STATUSES = ("FAILED", "ERROR")

PIPELINE_TASK_TYPES = {
    "crawl": {"CRAWL_URL", "NORMALIZE"},
    "draft": {"GENERATE_VIDEO_SCRIPT", "GENERATE_VIDEO_EDIT", "GENERATE_VIDEO_REVIEW", "PLANNING_CANDIDATE_REVIEW"},
    "voice": {"GENERATE_VIDEO_VOICE"},
    "render": {"GENERATE_VIDEO_RENDER"},
}

TASK_TYPE_LABELS = {
    "CRAWL_URL": "Crawl dữ liệu",
    "NORMALIZE": "Chuẩn hóa nội dung",
    "GENERATE_VIDEO_SCRIPT": "Sinh draft",
    "GENERATE_VIDEO_EDIT": "Chỉnh sửa draft tự động",
    "GENERATE_VIDEO_REVIEW": "Tự động kiểm duyệt draft",
    "PLANNING_CANDIDATE_REVIEW": "Lập kế hoạch nội dung",
    "GENERATE_VIDEO_VOICE": "Sinh voice",
    "GENERATE_VIDEO_RENDER": "Render video",
}


def build_pipeline_counts(task_counts: dict[str, int], publishing: int, active_crawl_jobs: int) -> dict[str, int]:
    result = {
        bucket: sum(int(task_counts.get(task_type, 0)) for task_type in task_types)
        for bucket, task_types in PIPELINE_TASK_TYPES.items()
    }
    result["publishing"] = int(publishing)
    result["crawl_jobs"] = int(active_crawl_jobs)
    known_task_types = set().union(*PIPELINE_TASK_TYPES.values())
    result["other"] = sum(int(count) for task_type, count in task_counts.items() if task_type not in known_task_types)
    result["total"] = sum(int(count) for count in task_counts.values()) + int(publishing)
    return result


def admin_dashboard_summary(db: Session) -> dict[str, Any]:
    return {
        "generated_at": _generated_at(),
        "totals": {
            "crawl_jobs": _count(db.query(func.count(CrawlJob.id))),
            "crawl_jobs_completed": _count(
                db.query(func.count(CrawlJob.id)).filter(CrawlJob.status.in_(("COMPLETED", "SUCCEEDED")))
            ),
            "contents": _count(db.query(func.count(ContentItem.id))),
            "videos_rendered": _count(
                db.query(func.count(func.distinct(KafkaTask.reference_id))).filter(
                    KafkaTask.task_type == "GENERATE_VIDEO_RENDER",
                    KafkaTask.status.in_(SUCCESS_TASK_STATUSES),
                    KafkaTask.reference_id.is_not(None),
                )
            ),
            "audio_generated": _count(
                db.query(func.count(func.distinct(KafkaTask.reference_id))).filter(
                    KafkaTask.task_type == "GENERATE_VIDEO_VOICE",
                    KafkaTask.status.in_(SUCCESS_TASK_STATUSES),
                    KafkaTask.reference_id.is_not(None),
                )
            ),
            "published_posts": _count(db.query(func.count(SocialPost.id))),
            "tasks": _count(db.query(func.count(KafkaTask.id))),
            "tasks_completed": _count(
                db.query(func.count(KafkaTask.id)).filter(KafkaTask.status.in_(SUCCESS_TASK_STATUSES))
            ),
        },
    }


def admin_dashboard_pipeline(db: Session) -> dict[str, Any]:
    task_counts = {
        str(task_type): int(count)
        for task_type, count in (
            db.query(KafkaTask.task_type, func.count(KafkaTask.id))
            .filter(KafkaTask.status.in_(ACTIVE_TASK_STATUSES))
            .group_by(KafkaTask.task_type)
            .all()
        )
    }
    active_crawl_jobs = _count(
        db.query(func.count(CrawlJob.id)).filter(CrawlJob.status.in_(ACTIVE_TASK_STATUSES))
    )
    active_publishing = _count(
        db.query(func.count(PublishingQueueItem.id)).filter(func.lower(PublishingQueueItem.status) == "publishing")
    )
    active_tasks = (
        db.query(KafkaTask)
        .filter(KafkaTask.status.in_(ACTIVE_TASK_STATUSES))
        .order_by(KafkaTask.created_at.desc())
        .limit(30)
        .all()
    )
    running_tasks = _serialize_running_tasks(db, active_tasks)
    running_tasks.extend(_serialize_publishing_tasks(db))
    running_tasks.sort(key=lambda item: item.get("created_at") or "", reverse=True)

    return {
        "generated_at": _generated_at(),
        "active": build_pipeline_counts(task_counts, active_publishing, active_crawl_jobs),
        "running_tasks": running_tasks[:30],
    }


def admin_dashboard_errors(db: Session) -> dict[str, Any]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    failed_tasks_24h = _count(
        db.query(func.count(KafkaTask.id)).filter(
            KafkaTask.status.in_(FAILED_STATUSES),
            or_(KafkaTask.completed_at >= cutoff, KafkaTask.created_at >= cutoff),
        )
    )
    failed_crawls_24h = _count(
        db.query(func.count(CrawlJob.id)).filter(CrawlJob.status.in_(FAILED_STATUSES), CrawlJob.updated_at >= cutoff)
    )
    failed_publishes_24h = _count(
        db.query(func.count(PublishingQueueItem.id)).filter(
            func.lower(PublishingQueueItem.status) == "failed",
            PublishingQueueItem.updated_at >= cutoff,
        )
    )
    failed_ai_runs_24h = _count(
        db.query(func.count(PromptRun.id)).filter(PromptRun.status.in_(FAILED_STATUSES), PromptRun.created_at >= cutoff)
    )
    return {
        "generated_at": _generated_at(),
        "errors": {
            "last_24h": failed_tasks_24h + failed_crawls_24h + failed_publishes_24h + failed_ai_runs_24h,
            "tasks": failed_tasks_24h,
            "crawl": failed_crawls_24h,
            "publishing": failed_publishes_24h,
            "ai": failed_ai_runs_24h,
        },
    }


async def admin_dashboard_services(db: Session) -> dict[str, Any]:
    return {
        "generated_at": _generated_at(),
        "services": await _service_health_snapshot(db),
    }


async def admin_operations_snapshot(db: Session) -> dict[str, Any]:
    """Compatibility response for older clients; new UI consumes the split endpoints."""
    summary = admin_dashboard_summary(db)
    pipeline = admin_dashboard_pipeline(db)
    errors = admin_dashboard_errors(db)
    services = await admin_dashboard_services(db)
    return {
        "generated_at": _generated_at(),
        "totals": summary["totals"],
        "active": pipeline["active"],
        "errors": errors["errors"],
        "running_tasks": pipeline["running_tasks"],
        "services": services["services"],
        "scheduler": scheduler_snapshot(db),
    }


def _generated_at() -> str:
    return datetime.now(timezone.utc).isoformat()


def _count(query) -> int:
    return int(query.scalar() or 0)


def _serialize_running_tasks(db: Session, tasks: list[KafkaTask]) -> list[dict[str, Any]]:
    workflow_ids = {
        task.reference_id for task in tasks
        if task.reference_id and str(task.reference_type or "").lower() == "media_workflow"
    }
    crawl_job_ids = {
        task.reference_id for task in tasks
        if task.reference_id and str(task.reference_type or "").lower() == "crawl_job"
    }
    workflows = {
        workflow.id: workflow.title
        for workflow in db.query(MediaWorkflow.id, MediaWorkflow.title).filter(MediaWorkflow.id.in_(workflow_ids)).all()
    } if workflow_ids else {}
    crawl_jobs = {
        job.id: job.name
        for job in db.query(CrawlJob.id, CrawlJob.name).filter(CrawlJob.id.in_(crawl_job_ids)).all()
    } if crawl_job_ids else {}

    rows = []
    for task in tasks:
        reference_type = str(task.reference_type or "")
        reference_title = None
        if reference_type.lower() == "media_workflow":
            reference_title = workflows.get(task.reference_id)
        elif reference_type.lower() == "crawl_job":
            reference_title = crawl_jobs.get(task.reference_id)
        rows.append({
            "id": str(task.id),
            "task_type": task.task_type,
            "label": TASK_TYPE_LABELS.get(task.task_type, task.task_type.replace("_", " ").title()),
            "status": task.status,
            "stage": task.current_stage,
            "progress_percent": float(task.progress_percent or 0),
            "reference_id": str(task.reference_id) if task.reference_id else None,
            "reference_type": reference_type or None,
            "reference_title": reference_title,
            "worker": task.locked_by,
            "attempt_count": int(task.attempt_count or 0),
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "heartbeat_at": task.heartbeat_at.isoformat() if task.heartbeat_at else None,
        })
    return rows


def _serialize_publishing_tasks(db: Session) -> list[dict[str, Any]]:
    rows = (
        db.query(PublishingQueueItem)
        .filter(func.lower(PublishingQueueItem.status) == "publishing")
        .order_by(PublishingQueueItem.updated_at.desc())
        .limit(20)
        .all()
    )
    return [{
        "id": str(item.id),
        "task_type": "PUBLISH_CONTENT",
        "label": "Đẩy bài lên nền tảng",
        "status": "RUNNING",
        "stage": "PUBLISHING",
        "progress_percent": 50.0,
        "reference_id": str(item.content_id) if item.content_id else None,
        "reference_type": "content",
        "reference_title": item.article_title,
        "worker": item.platform,
        "attempt_count": 1,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "started_at": item.updated_at.isoformat() if item.updated_at else None,
        "heartbeat_at": item.updated_at.isoformat() if item.updated_at else None,
    } for item in rows]


async def _service_health_snapshot(db: Session) -> list[dict[str, Any]]:
    settings = get_settings()
    services = [
        {"key": "api", "name": "API Service", "kind": "core", "status": "online", "latency_ms": 0, "detail": "Endpoint dashboard đang phản hồi"},
    ]

    db_started = perf_counter()
    try:
        db.execute(text("SELECT 1"))
        services.append(_health_item("postgres", "PostgreSQL", "database", "online", db_started, "Kết nối cơ sở dữ liệu bình thường"))
    except Exception as error:
        services.append(_health_item("postgres", "PostgreSQL", "database", "offline", db_started, _safe_error(error)))

    services.extend(await asyncio.gather(
        _probe_mongo(),
        _probe_kafka(),
        _probe_http("data-ingestion", "Data Ingestion Engine", settings.data_ingestion_service_url),
        _probe_http("planning", "Planning Orchestrator", settings.planning_service_url),
        _probe_http("embedding", "Embedding Service", settings.embedding_service_url),
        _probe_http("ai-media", "AI Media Worker", settings.ai_media_worker_url),
        _probe_http("remotion", "Remotion Worker", settings.remotion_worker_url),
    ))

    return services


async def _probe_http(key: str, name: str, base_url: str) -> dict[str, Any]:
    started = perf_counter()
    url = f"{base_url.rstrip('/')}/health"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(url)
        response.raise_for_status()
        payload = response.json() if response.content else {}
        reported_status = str(payload.get("status") or "ok").lower()
        status = "online" if reported_status in {"ok", "healthy", "online", "running"} else "degraded"
        detail = str(payload.get("detail") or payload.get("mode") or "Health check phản hồi bình thường")
        return _health_item(key, name, "service", status, started, detail)
    except Exception as error:
        return _health_item(key, name, "service", "offline", started, _safe_error(error))


async def _probe_mongo() -> dict[str, Any]:
    started = perf_counter()
    try:
        await asyncio.wait_for(
            asyncio.to_thread(get_mongo_client().admin.command, "ping"),
            timeout=2.5,
        )
        return _health_item("mongo", "MongoDB", "database", "online", started, "Kết nối document store bình thường")
    except Exception as error:
        return _health_item("mongo", "MongoDB", "database", "offline", started, _safe_error(error))


async def _probe_kafka() -> dict[str, Any]:
    settings = get_settings()
    started = perf_counter()
    if settings.disable_kafka:
        return _health_item("kafka", "Kafka", "message-broker", "degraded", started, "Kafka đang bị tắt bởi cấu hình")

    def ping() -> None:
        admin = KafkaAdminClient(
            bootstrap_servers=[value.strip() for value in settings.kafka_bootstrap_servers.split(",") if value.strip()],
            request_timeout_ms=1500,
            api_version_auto_timeout_ms=1500,
        )
        try:
            admin.list_topics()
        finally:
            admin.close()

    try:
        await asyncio.wait_for(asyncio.to_thread(ping), timeout=2.5)
        return _health_item("kafka", "Kafka", "message-broker", "online", started, "Message broker đang phản hồi")
    except Exception as error:
        return _health_item("kafka", "Kafka", "message-broker", "offline", started, _safe_error(error))


def _health_item(key: str, name: str, kind: str, status: str, started: float, detail: str) -> dict[str, Any]:
    return {
        "key": key,
        "name": name,
        "kind": kind,
        "status": status,
        "latency_ms": max(0, round((perf_counter() - started) * 1000)),
        "detail": detail,
    }


def _safe_error(error: Exception) -> str:
    name = type(error).__name__
    message = str(error).strip().splitlines()[0] if str(error).strip() else "Không thể kết nối"
    return f"{name}: {message}"[:180]
