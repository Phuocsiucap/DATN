import asyncio
from fastapi import APIRouter, HTTPException
from backend.schemas.requests import PublishRequest
from backend.core.database import articles_col
from backend.services.publisher import publish_article

router = APIRouter()

@router.post("")
async def trigger_publish(req: PublishRequest):
    doc = articles_col.find_one({"link": req.link})
    if not doc:
        raise HTTPException(status_code=404, detail="Article not found")

    results = {}
    for platform in req.platforms:
        result = await publish_article(doc, platform)
        results[platform] = result

    return {"results": results}

@router.post("/crawl-now")
async def trigger_crawl():
    """Manually trigger a crawl cycle."""
    from backend.services.scheduler import run_crawl_cycle
    asyncio.create_task(run_crawl_cycle())
    return {"message": "Crawl cycle triggered"}

from pydantic import BaseModel

class SchedulerStartRequest(BaseModel):
    interval_minutes: int = 30

@router.post("/scheduler/start")
async def start_scheduler_api(req: SchedulerStartRequest = None):
    """Start or resume the background scheduler with an optional interval."""
    from backend.services.scheduler import start_scheduler
    interval = req.interval_minutes if req else 30
    await start_scheduler(interval)
    return {"message": f"Scheduler started/resumed every {interval} minutes", "status": "running"}

@router.post("/scheduler/stop")
async def stop_scheduler_api():
    """Pause the background scheduler."""
    from backend.services.scheduler import stop_scheduler
    await stop_scheduler()
    return {"message": "Scheduler paused", "status": "paused"}

@router.get("/scheduler/status")
async def get_scheduler_status():
    """Get the current status and interval of the scheduler."""
    from backend.services.scheduler import scheduler, get_current_interval
    # APScheduler state: 1 is RUNNING, 2 is PAUSED, 0 is STOPPED
    state = scheduler.state
    interval = get_current_interval()
    
    if state == 1:
        return {"status": "running", "interval": interval}
    elif state == 2:
        return {"status": "paused", "interval": interval}
    else:
        return {"status": "stopped", "interval": interval}
