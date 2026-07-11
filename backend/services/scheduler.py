import asyncio
import sys
import threading
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from apscheduler.schedulers.asyncio import AsyncIOScheduler

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.core.database import articles_col  # noqa: E402
from backend.api.websockets.events import broadcast  # noqa: E402
from backend.crawlers.vnexpress import crawl_vnexpress_sync, crawl_rss_sync, crawl_article_sync  # noqa: E402

scheduler = AsyncIOScheduler()
_thread_executor = ThreadPoolExecutor(max_workers=2)


async def run_crawl_cycle():
    loop = asyncio.get_event_loop()
    await broadcast({"type": "crawl_start", "timestamp": datetime.utcnow().isoformat()})

    # Collect links (run sync Playwright + RSS in threads)
    vnexpress_links = await loop.run_in_executor(_thread_executor, crawl_vnexpress_sync)
    # rss_links = await loop.run_in_executor(_thread_executor, crawl_rss_sync)

    # links = list(set(vnexpress_links + rss_links))
    links = list(set(vnexpress_links))
    new_count = 0

    for link in links:
        try:
            if articles_col.find_one({"link": link}):
                continue

            data = await loop.run_in_executor(_thread_executor, crawl_article_sync, link)
            if data:
                if articles_col.find_one({"title": data["title"]}):
                    continue
                data["crawled_at"] = datetime.utcnow()
                data["status"] = "crawled"
                articles_col.insert_one(data)
                new_count += 1
                await broadcast({
                    "type": "article_crawled",
                    "title": data["title"],
                    "link": link,
                    "timestamp": data["crawled_at"].isoformat()
                })
        except Exception as e:
            print(f"Error processing {link}: {e}")

    await broadcast({
        "type": "crawl_done",
        "new_articles": new_count,
        "timestamp": datetime.utcnow().isoformat()
    })
    print(f"✅ Crawl done: {new_count} new articles")


async def start_scheduler(interval_minutes: int = 30):
    if not scheduler.running:
        scheduler.add_job(run_crawl_cycle, "interval", minutes=interval_minutes, id="crawl_cycle", replace_existing=True)
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
