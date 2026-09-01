from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import AuditLog, User
from common.db.session import get_db
from app.schemas import api as schemas
from app.api.deps import require_system_admin
from app.services.publish_scheduler import (
    run_publish_queue_once,
    save_scheduler_settings,
    scheduler_snapshot,
    start_publish_queue_scheduler,
    stop_publish_queue_scheduler,
)
from app.services.users import UserService, to_user_response

router = APIRouter()


@router.post("/system/bootstrap", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
def bootstrap_system_admin(payload: schemas.BootstrapAdminRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    if payload.bootstrap_token != settings.system_bootstrap_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid bootstrap token")
    existing_admin = db.query(User).filter(User.is_system_admin.is_(True)).first()
    if existing_admin:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="System admin already exists")
    user = UserService().create_system_admin(db, payload)
    return to_user_response(user)


@router.get("/system/audit-logs")
def audit_logs(_: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(100).all()
    return rows


@router.get("/settings/scheduler")
def get_scheduler_settings(_: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    return scheduler_snapshot(db)


@router.put("/settings/scheduler")
def update_scheduler_settings(
    payload: schemas.SchedulerSettingsRequest,
    current_user: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    save_scheduler_settings(db, payload.model_dump(), current_user)
    return scheduler_snapshot(db)


@router.post("/settings/scheduler/start")
async def start_scheduler(_: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    await start_publish_queue_scheduler()
    return scheduler_snapshot(db)


@router.post("/settings/scheduler/stop")
async def stop_scheduler(_: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    await stop_publish_queue_scheduler()
    return scheduler_snapshot(db)


@router.post("/settings/scheduler/publish-queue/run-once")
def run_publish_queue_now(_: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    result = run_publish_queue_once()
    snapshot = scheduler_snapshot(db)
    snapshot["last_run"] = result
    return snapshot



@router.get("/system/openai-usage/costs-by-day")
async def get_openai_usage_costs_by_day(
    start_time: int | None = None,
    end_time: int | None = None,
    _: User = Depends(require_system_admin),
):
    import time
    
    settings = get_settings()
    if not settings.openai_admin_key:
        raise HTTPException(status_code=400, detail="OPENAI_ADMIN_KEY not configured in .env")
        
    now = int(time.time())
    if not start_time:
        start_time = now - 7 * 24 * 3600
        
    url = "https://api.openai.com/v1/organization/costs"
    headers = {
        "Authorization": f"Bearer {settings.openai_admin_key}",
        "Content-Type": "application/json"
    }
    params = {
        "start_time": start_time,
        "bucket_width": "1d"
    }
    # OpenAI costs API excludes the current day's bucket if end_time is before the bucket's end_time.
    # By omitting end_time, it defaults to returning all available buckets up to now.
    
    return await _fetch_openai_usage_paginated(url, headers, params)

async def _fetch_openai_usage_paginated(url: str, headers: dict, params: dict):
    import httpx
    
    current_params = params.copy()
    current_params["limit"] = 31  # Maximum allowed for bucket_width=1d is 31
    all_buckets = {}
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            response = await client.get(url, headers=headers, params=current_params)
            if response.status_code != 200:
                from fastapi import HTTPException
                raise HTTPException(status_code=response.status_code, detail=response.text)
            
            data = response.json()
            for bucket in data.get("data", []):
                st = bucket["start_time"]
                if st not in all_buckets:
                    all_buckets[st] = bucket
                else:
                    all_buckets[st]["results"].extend(bucket.get("results", []))
                    
            if not data.get("has_more") or not data.get("next_page"):
                break
                
            current_params["after"] = data["next_page"]
            
    return {"object": "page", "data": list(all_buckets.values())}


@router.get("/system/openai-usage/completions")
async def get_openai_usage_completions(
    start_time: int | None = None,
    end_time: int | None = None,
    group_by: str | None = None,
    _: User = Depends(require_system_admin),
):
    import time
    
    settings = get_settings()
    if not settings.openai_admin_key:
        raise HTTPException(status_code=400, detail="OPENAI_ADMIN_KEY not configured in .env")
        
    now = int(time.time())
    if not start_time:
        start_time = now - 7 * 24 * 3600
        
    url = "https://api.openai.com/v1/organization/usage/completions"
    headers = {
        "Authorization": f"Bearer {settings.openai_admin_key}",
        "Content-Type": "application/json"
    }
    params = {
        "start_time": start_time,
    }
    if group_by:
        params["group_by"] = group_by
    
    return await _fetch_openai_usage_paginated(url, headers, params)

@router.get("/system/openai-usage/embeddings")
async def get_openai_usage_embeddings(
    start_time: int | None = None,
    end_time: int | None = None,
    group_by: str | None = None,
    _: User = Depends(require_system_admin),
):
    import time
    
    settings = get_settings()
    if not settings.openai_admin_key:
        raise HTTPException(status_code=400, detail="OPENAI_ADMIN_KEY not configured in .env")
        
    now = int(time.time())
    if not start_time:
        start_time = now - 7 * 24 * 3600
        
    url = "https://api.openai.com/v1/organization/usage/embeddings"
    headers = {
        "Authorization": f"Bearer {settings.openai_admin_key}",
        "Content-Type": "application/json"
    }
    params = {
        "start_time": start_time,
    }
    if group_by:
        params["group_by"] = group_by
    
    return await _fetch_openai_usage_paginated(url, headers, params)

@router.get("/system/openai-usage/audio-transcriptions")
async def get_openai_usage_audio_transcriptions(
    start_time: int | None = None,
    end_time: int | None = None,
    group_by: str | None = None,
    _: User = Depends(require_system_admin),
):
    import time
    
    settings = get_settings()
    if not settings.openai_admin_key:
        raise HTTPException(status_code=400, detail="OPENAI_ADMIN_KEY not configured in .env")
        
    now = int(time.time())
    if not start_time:
        start_time = now - 7 * 24 * 3600
        
    url = "https://api.openai.com/v1/organization/usage/audio_transcriptions"
    headers = {
        "Authorization": f"Bearer {settings.openai_admin_key}",
        "Content-Type": "application/json"
    }
    params = {
        "start_time": start_time,
    }
    if group_by:
        params["group_by"] = group_by
    
    return await _fetch_openai_usage_paginated(url, headers, params)
