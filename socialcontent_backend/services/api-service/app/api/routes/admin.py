from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Text, cast, func, or_
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
from app.services.admin_dashboard import (
    admin_dashboard_errors,
    admin_dashboard_pipeline,
    admin_dashboard_services,
    admin_dashboard_summary,
    admin_operations_snapshot,
)
from app.services.users import UserService, to_user_response

router = APIRouter()


@router.get("/system/dashboard/summary")
def get_admin_dashboard_summary(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    return admin_dashboard_summary(db)


@router.get("/system/dashboard/pipeline")
def get_admin_dashboard_pipeline(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    return admin_dashboard_pipeline(db)


@router.get("/system/dashboard/errors")
def get_admin_dashboard_errors(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    return admin_dashboard_errors(db)


@router.get("/system/dashboard/services")
async def get_admin_dashboard_services(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    return await admin_dashboard_services(db)


@router.get("/system/dashboard", deprecated=True)
async def get_admin_dashboard(
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    return await admin_operations_snapshot(db)


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
def audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: str | None = Query(None, max_length=200),
    actor_id: uuid.UUID | None = None,
    action: str | None = Query(None, max_length=120),
    target_type: str | None = Query(None, max_length=120),
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    """Return an immutable, filterable audit trail for System Admins."""
    if created_from and created_to and created_from > created_to:
        raise HTTPException(status_code=400, detail="Thời gian bắt đầu phải trước thời gian kết thúc")

    query = db.query(AuditLog, User).outerjoin(User, User.id == AuditLog.actor_id)
    if actor_id:
        query = query.filter(AuditLog.actor_id == actor_id)
    if action and action.strip():
        query = query.filter(AuditLog.action == action.strip())
    if target_type and target_type.strip():
        query = query.filter(AuditLog.target_type == target_type.strip())
    if created_from:
        query = query.filter(AuditLog.created_at >= created_from)
    if created_to:
        query = query.filter(AuditLog.created_at <= created_to)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                AuditLog.action.ilike(pattern),
                AuditLog.target_type.ilike(pattern),
                AuditLog.target_id.ilike(pattern),
                cast(AuditLog.metadata_json, Text).ilike(pattern),
                User.email.ilike(pattern),
                User.full_name.ilike(pattern),
            )
        )

    total = query.count()
    unique_actors, unique_actions = query.with_entities(
        func.count(func.distinct(AuditLog.actor_id)),
        func.count(func.distinct(AuditLog.action)),
    ).one()
    rows = (
        query
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    total_pages = (total + page_size - 1) // page_size

    action_options = [
        value
        for (value,) in db.query(AuditLog.action).distinct().order_by(AuditLog.action.asc()).all()
        if value
    ]
    target_type_options = [
        value
        for (value,) in db.query(AuditLog.target_type).filter(AuditLog.target_type.isnot(None)).distinct().order_by(AuditLog.target_type.asc()).all()
        if value
    ]
    actor_options = [
        {"id": str(user_id), "email": email, "full_name": full_name}
        for user_id, email, full_name in (
            db.query(User.id, User.email, User.full_name)
            .join(AuditLog, AuditLog.actor_id == User.id)
            .distinct()
            .order_by(User.email.asc())
            .all()
        )
    ]

    return {
        "items": [_serialize_audit_log(log, actor) for log, actor in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "summary": {
            "unique_actors": int(unique_actors or 0),
            "unique_actions": int(unique_actions or 0),
        },
        "filters": {
            "actors": actor_options,
            "actions": action_options,
            "target_types": target_type_options,
        },
    }


def _serialize_audit_log(log: AuditLog, actor: User | None) -> dict:
    return {
        "id": str(log.id),
        "actor_id": str(log.actor_id) if log.actor_id else None,
        "actor": (
            {
                "id": str(actor.id),
                "email": actor.email,
                "full_name": actor.full_name,
            }
            if actor
            else None
        ),
        "action": log.action,
        "target_type": log.target_type,
        "target_id": log.target_id,
        "metadata": log.metadata_json if isinstance(log.metadata_json, dict) else {},
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


@router.get("/settings/scheduler")
def get_scheduler_settings(_: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    return scheduler_snapshot(db)


@router.put("/settings/scheduler")
def update_scheduler_settings(
    payload: schemas.SchedulerSettingsRequest,
    current_user: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    before = scheduler_snapshot(db)["settings"]
    save_scheduler_settings(db, payload.model_dump(), current_user)
    snapshot = scheduler_snapshot(db)
    db.add(
        AuditLog(
            actor_id=current_user.id,
            action="scheduler.settings_updated",
            target_type="system_setting",
            target_id="scheduler_settings",
            metadata_json={"before": before, "after": snapshot["settings"]},
        )
    )
    db.commit()
    return snapshot


@router.post("/settings/scheduler/start")
async def start_scheduler(current_user: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    await start_publish_queue_scheduler()
    snapshot = scheduler_snapshot(db)
    db.add(AuditLog(actor_id=current_user.id, action="scheduler.started", target_type="scheduler", target_id="publish_queue"))
    db.commit()
    return snapshot


@router.post("/settings/scheduler/stop")
async def stop_scheduler(current_user: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    await stop_publish_queue_scheduler()
    snapshot = scheduler_snapshot(db)
    db.add(AuditLog(actor_id=current_user.id, action="scheduler.stopped", target_type="scheduler", target_id="publish_queue"))
    db.commit()
    return snapshot


@router.post("/settings/scheduler/publish-queue/run-once")
def run_publish_queue_now(current_user: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    result = run_publish_queue_once()
    snapshot = scheduler_snapshot(db)
    snapshot["last_run"] = result
    db.add(
        AuditLog(
            actor_id=current_user.id,
            action="scheduler.run_once",
            target_type="scheduler",
            target_id="publish_queue",
            metadata_json={"result": result},
        )
    )
    db.commit()
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

@router.get("/system/deepseek-usage/metrics")
async def get_deepseek_usage_metrics(
    start_time: int | None = None,
    _: User = Depends(require_system_admin),
    db: Session = Depends(get_db),
):
    import time
    from datetime import datetime, timezone
    import httpx
    
    settings = get_settings()
    now = int(time.time())
    if not start_time:
        start_time = now - 30 * 24 * 3600
        
    # Get balance
    balance_info = {"is_available": False, "total_balance": 0.0}
    if settings.deepseek_api_key:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://api.deepseek.com/user/balance",
                    headers={"Authorization": f"Bearer {settings.deepseek_api_key}"}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    balance_info["is_available"] = data.get("is_available", False)
                    balances = data.get("balance_infos", [])
                    if balances:
                        # Depending on the currency, use total_balance
                        balance_info["total_balance"] = float(balances[0].get("total_balance", 0.0))
        except Exception as e:
            print("Failed to fetch deepseek balance", e)

    # Fetch prompt runs from DB
    from common.db.models import PromptRun
    dt_start = datetime.fromtimestamp(start_time, tz=timezone.utc).replace(tzinfo=None)
    
    runs = db.query(PromptRun).filter(
        PromptRun.model_provider == 'deepseek',
        PromptRun.created_at >= dt_start
    ).all()
    
    total_cost = 0.0
    total_requests = 0
    total_tokens = 0
    
    daily_stats = {}
    model_stats = {}
    
    for run in runs:
        if not run.created_at:
            continue
        c_cost = float(run.cost_usd or 0)
        c_tok = run.total_tokens or 0
        total_cost += c_cost
        total_requests += 1
        total_tokens += c_tok
        
        day_str = run.created_at.strftime("%Y-%m-%d")
        ts = int(run.created_at.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        
        if day_str not in daily_stats:
            daily_stats[day_str] = {"cost": 0.0, "requests": 0, "tokens": 0, "timestamp": ts}
            
        daily_stats[day_str]["cost"] += c_cost
        daily_stats[day_str]["requests"] += 1
        daily_stats[day_str]["tokens"] += c_tok
        
        model = run.model_name or "unknown"
        if model not in model_stats:
            model_stats[model] = {"total_requests": 0, "total_tokens": 0, "daily": {}}
            
        model_stats[model]["total_requests"] += 1
        model_stats[model]["total_tokens"] += c_tok
        
        if day_str not in model_stats[model]["daily"]:
            model_stats[model]["daily"][day_str] = {"requests": 0, "tokens": 0, "timestamp": ts}
            
        model_stats[model]["daily"][day_str]["requests"] += 1
        model_stats[model]["daily"][day_str]["tokens"] += c_tok

    def fill_gaps(stats_dict, st, end):
        res = []
        curr = st
        while curr <= end:
            day_str = datetime.fromtimestamp(curr, tz=timezone.utc).strftime("%Y-%m-%d")
            # Create a pretty short date like '8/7' for UI
            dt_obj = datetime.fromtimestamp(curr, tz=timezone.utc)
            short_date = f"{dt_obj.month}/{dt_obj.day}"
            
            if day_str in stats_dict:
                res.append({"date": short_date, "full_date": day_str, **stats_dict[day_str]})
            else:
                res.append({"date": short_date, "full_date": day_str, "timestamp": curr, "cost": 0.0, "requests": 0, "tokens": 0})
            curr += 86400
        return res

    start_day = start_time - (start_time % 86400)
    end_day = now - (now % 86400)
    
    cost_series = fill_gaps(daily_stats, start_day, end_day)
    
    formatted_models = {}
    for m, m_data in model_stats.items():
        m_series = fill_gaps(m_data["daily"], start_day, end_day)
        formatted_models[m] = {
            "total_requests": m_data["total_requests"],
            "total_tokens": m_data["total_tokens"],
            "series": m_series
        }

    return {
        "balance": balance_info,
        "total_cost": total_cost,
        "total_api_requests": total_requests,
        "total_tokens": total_tokens,
        "cost_series": cost_series,
        "models": formatted_models
    }
