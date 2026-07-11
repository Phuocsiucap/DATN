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
