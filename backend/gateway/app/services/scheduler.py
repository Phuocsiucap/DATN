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
from backend.gateway.app.core.kafka import KAFKA_DISABLED  # noqa: E402
from backend.gateway.app.services.vnexpress_gateway import request_vnexpress_topic_crawl  # noqa: E402

USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")

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


async def start_scheduler(interval_minutes: int = 30):
    if not scheduler.running:
        scheduler.add_job(run_crawl_cycle, "interval", minutes=interval_minutes, id="crawl_cycle", replace_existing=True)
        scheduler.add_job(run_publish_queue_cycle, "interval", minutes=5, id="publish_queue_cycle", replace_existing=True)
        scheduler.start()
        print(f"🕐 Scheduler started — crawling every {interval_minutes} minutes")
        asyncio.create_task(run_crawl_cycle())
    else:
        # Check if job exists, reschedule it with new interval
        job = scheduler.get_job("crawl_cycle")
        if job:
            scheduler.reschedule_job("crawl_cycle", trigger="interval", minutes=interval_minutes)
        else:
            scheduler.add_job(run_crawl_cycle, "interval", minutes=interval_minutes, id="crawl_cycle", replace_existing=True)
        if not scheduler.get_job("publish_queue_cycle"):
            scheduler.add_job(run_publish_queue_cycle, "interval", minutes=5, id="publish_queue_cycle", replace_existing=True)
        scheduler.resume()
        print(f"🕐 Scheduler resumed/updated — crawling every {interval_minutes} minutes")

def get_current_interval() -> int:
    job = scheduler.get_job("crawl_cycle")
    if job and hasattr(job.trigger, 'interval'):
        return int(job.trigger.interval.total_seconds() / 60)
    return 30

async def stop_scheduler():
    if scheduler.running:
        scheduler.pause()
        print("⏸ Scheduler paused")
