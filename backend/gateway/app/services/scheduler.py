import asyncio
import os
import sys
from pathlib import Path
from datetime import datetime
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.gateway.app.api.websockets.events import broadcast  # noqa: E402
from backend.gateway.app.core.database_mongo import scheduler_settings_col  # noqa: E402
from backend.gateway.app.core.kafka import KAFKA_DISABLED  # noqa: E402
from backend.gateway.app.services.bilibili_content_crawler import crawl_bilibili_feed  # noqa: E402
from backend.gateway.app.services.vnexpress_gateway import request_vnexpress_topic_crawl  # noqa: E402

USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")
DEFAULT_VNEXPRESS_INTERVAL_MINUTES = int(os.getenv("VNEXPRESS_SCHEDULER_INTERVAL_MINUTES", "30"))
DEFAULT_BILIBILI_INTERVAL_MINUTES = int(os.getenv("BILIBILI_SCHEDULER_INTERVAL_MINUTES", "30"))
DEFAULT_PUBLISH_QUEUE_INTERVAL_MINUTES = int(os.getenv("PUBLISH_QUEUE_INTERVAL_MINUTES", "5"))
SCHEDULER_SETTINGS_ID = "global"

scheduler = AsyncIOScheduler()


async def run_crawl_cycle():
    if KAFKA_DISABLED:
        await broadcast({
            "type": "crawl_skipped",
            "reason": "Kafka is disabled",
            "timestamp": datetime.utcnow().isoformat(),
        })
        return
    await broadcast({"type": "crawl_start", "timestamp": datetime.utcnow().isoformat()})
    request = request_vnexpress_topic_crawl(
        user_id=0,
        topics=[],
        exclude_keywords=[],
        limit=10,
        use_ai_scoring=False,
        source="system_scheduler",
    )
    await broadcast({
        "type": "crawl_queued",
        "request_id": request["request_id"],
        "timestamp": datetime.utcnow().isoformat()
    })
    print(f"✅ VNExpress crawl queued: {request['request_id']}")


async def run_publish_queue_cycle():
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(f"{USER_SERVICE_URL}/api/internal/publishing/queue/process-due")
            response.raise_for_status()
            result = response.json()
    except Exception as exc:
        await broadcast({
            "type": "publish_queue_error",
            "error": str(exc),
            "timestamp": datetime.utcnow().isoformat(),
        })
        return

    processed = int(result.get("processed", 0))
    if processed:
        await broadcast({
            "type": "publish_queue_processed",
            "processed": processed,
            "timestamp": datetime.utcnow().isoformat(),
        })


async def run_bilibili_crawl_cycle():
    await broadcast({"type": "bilibili_crawl_start", "timestamp": datetime.utcnow().isoformat()})
    try:
        result = await crawl_bilibili_feed(user_id=0, limit=10, evaluate=True)
    except Exception as exc:
        await broadcast({
            "type": "bilibili_crawl_error",
            "error": str(exc),
            "timestamp": datetime.utcnow().isoformat(),
        })
        return
    await broadcast({
        "type": "bilibili_crawl_done",
        **result,
        "timestamp": datetime.utcnow().isoformat(),
    })


def _clamp_interval(value: object, default: int) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        minutes = default
    return max(1, min(minutes, 24 * 60))


def get_scheduler_settings() -> dict[str, int]:
    try:
        settings = scheduler_settings_col.find_one({"_id": SCHEDULER_SETTINGS_ID}, {"_id": 0}) or {}
    except Exception as exc:
        print(f"Scheduler settings fallback to defaults: {exc}")
        settings = {}
    return {
        "vnexpress_interval_minutes": _clamp_interval(
            settings.get("vnexpress_interval_minutes"),
            DEFAULT_VNEXPRESS_INTERVAL_MINUTES,
        ),
        "bilibili_interval_minutes": _clamp_interval(
            settings.get("bilibili_interval_minutes"),
            DEFAULT_BILIBILI_INTERVAL_MINUTES,
        ),
        "publish_queue_interval_minutes": _clamp_interval(
            settings.get("publish_queue_interval_minutes"),
            DEFAULT_PUBLISH_QUEUE_INTERVAL_MINUTES,
        ),
    }


def save_scheduler_settings(payload: dict) -> dict[str, int]:
    current = get_scheduler_settings()
    settings = {
        "vnexpress_interval_minutes": _clamp_interval(
            payload.get("vnexpress_interval_minutes", current["vnexpress_interval_minutes"]),
            current["vnexpress_interval_minutes"],
        ),
        "bilibili_interval_minutes": _clamp_interval(
            payload.get("bilibili_interval_minutes", current["bilibili_interval_minutes"]),
            current["bilibili_interval_minutes"],
        ),
        "publish_queue_interval_minutes": _clamp_interval(
            payload.get("publish_queue_interval_minutes", current["publish_queue_interval_minutes"]),
            current["publish_queue_interval_minutes"],
        ),
    }
    scheduler_settings_col.update_one({"_id": SCHEDULER_SETTINGS_ID}, {"$set": settings}, upsert=True)
    return settings


def _upsert_interval_job(job_id: str, func, minutes: int) -> None:
    job = scheduler.get_job(job_id)
    if job:
        scheduler.reschedule_job(job_id, trigger="interval", minutes=minutes)
    else:
        scheduler.add_job(func, "interval", minutes=minutes, id=job_id, replace_existing=True)


async def apply_scheduler_settings(settings: dict | None = None) -> dict[str, int]:
    resolved = settings or get_scheduler_settings()
    if scheduler.running:
        _upsert_interval_job("crawl_cycle", run_crawl_cycle, resolved["vnexpress_interval_minutes"])
        _upsert_interval_job("bilibili_crawl_cycle", run_bilibili_crawl_cycle, resolved["bilibili_interval_minutes"])
        _upsert_interval_job("publish_queue_cycle", run_publish_queue_cycle, resolved["publish_queue_interval_minutes"])
    return resolved


async def update_scheduler_settings(payload: dict) -> dict[str, int]:
    settings = save_scheduler_settings(payload)
    await apply_scheduler_settings(settings)
    await broadcast({
        "type": "scheduler_settings_updated",
        **settings,
        "timestamp": datetime.utcnow().isoformat(),
    })
    return settings


async def start_scheduler(interval_minutes: int | None = None, *, bilibili_interval_minutes: int | None = None):
    if interval_minutes is not None or bilibili_interval_minutes is not None:
        settings = save_scheduler_settings({
            "vnexpress_interval_minutes": interval_minutes,
            "bilibili_interval_minutes": bilibili_interval_minutes,
        })
    else:
        settings = get_scheduler_settings()

    if not scheduler.running:
        scheduler.add_job(run_crawl_cycle, "interval", minutes=settings["vnexpress_interval_minutes"], id="crawl_cycle", replace_existing=True)
        scheduler.add_job(run_bilibili_crawl_cycle, "interval", minutes=settings["bilibili_interval_minutes"], id="bilibili_crawl_cycle", replace_existing=True)
        scheduler.add_job(run_publish_queue_cycle, "interval", minutes=settings["publish_queue_interval_minutes"], id="publish_queue_cycle", replace_existing=True)
        scheduler.start()
        print(
            "🕐 Scheduler started — "
            f"VNExpress every {settings['vnexpress_interval_minutes']} minutes, "
            f"Bilibili every {settings['bilibili_interval_minutes']} minutes"
        )
        asyncio.create_task(run_crawl_cycle())
        asyncio.create_task(run_bilibili_crawl_cycle())
    else:
        await apply_scheduler_settings(settings)
        scheduler.resume()
        print(
            "🕐 Scheduler resumed/updated — "
            f"VNExpress every {settings['vnexpress_interval_minutes']} minutes, "
            f"Bilibili every {settings['bilibili_interval_minutes']} minutes"
        )


def get_job_interval(job_id: str, fallback: int) -> int:
    job = scheduler.get_job(job_id)
    if job and hasattr(job.trigger, "interval"):
        return int(job.trigger.interval.total_seconds() / 60)
    return fallback


def get_current_interval() -> int:
    settings = get_scheduler_settings()
    return get_job_interval("crawl_cycle", settings["vnexpress_interval_minutes"])


def get_scheduler_status_payload() -> dict:
    settings = get_scheduler_settings()
    state = scheduler.state
    status = "running" if state == 1 else "paused" if state == 2 else "stopped"
    return {
        "status": status,
        "interval": get_job_interval("crawl_cycle", settings["vnexpress_interval_minutes"]),
        "settings": settings,
        "jobs": {
            "vnexpress": {
                "id": "crawl_cycle",
                "interval_minutes": get_job_interval("crawl_cycle", settings["vnexpress_interval_minutes"]),
            },
            "bilibili": {
                "id": "bilibili_crawl_cycle",
                "interval_minutes": get_job_interval("bilibili_crawl_cycle", settings["bilibili_interval_minutes"]),
            },
            "publish_queue": {
                "id": "publish_queue_cycle",
                "interval_minutes": get_job_interval("publish_queue_cycle", settings["publish_queue_interval_minutes"]),
            },
        },
    }

async def stop_scheduler():
    if scheduler.running:
        scheduler.pause()
        print("⏸ Scheduler paused")
