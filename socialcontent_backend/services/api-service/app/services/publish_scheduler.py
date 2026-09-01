from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import PublishingQueueItem, SocialProfile, SystemSetting, User
from common.db.session import SessionLocal
from app.services.social_profiles import SocialProfileService

logger = logging.getLogger(__name__)

SCHEDULER_SETTING_KEY = "scheduler_settings"
DEFAULT_SCHEDULER_SETTINGS = {
    "vnexpress_interval_minutes": 30,
    "bilibili_interval_minutes": 30,
    "publish_queue_interval_minutes": 5,
}

_publish_queue_task: asyncio.Task | None = None
_last_run: dict[str, Any] = {"checked_at": None, "published": 0, "failed": 0, "skipped": 0, "finalized": 0, "pending": 0}
_last_account_snapshot_run: datetime | None = None
_last_video_analytics_run: datetime | None = None
_last_account_snapshot_result: dict[str, Any] = {"checked_at": None, "profiles": 0, "snapshots": 0, "failed": 0}
_last_video_analytics_result: dict[str, Any] = {"checked_at": None, "profiles": 0, "videos": 0, "metrics": 0, "failed": 0}


def normalize_scheduler_settings(value: dict[str, Any] | None = None) -> dict[str, int]:
    data = {**DEFAULT_SCHEDULER_SETTINGS, **(value or {})}
    return {
        key: max(1, min(1440, int(data.get(key) or DEFAULT_SCHEDULER_SETTINGS[key])))
        for key in DEFAULT_SCHEDULER_SETTINGS
    }


def get_scheduler_settings(db: Session) -> dict[str, int]:
    setting = db.get(SystemSetting, SCHEDULER_SETTING_KEY)
    value = setting.value if setting and isinstance(setting.value, dict) else {}
    return normalize_scheduler_settings(value)


def save_scheduler_settings(db: Session, payload: dict[str, Any], user: User) -> dict[str, int]:
    settings = normalize_scheduler_settings(payload)
    setting = db.get(SystemSetting, SCHEDULER_SETTING_KEY)
    if setting is None:
        setting = SystemSetting(
            key=SCHEDULER_SETTING_KEY,
            value=settings,
            description="Intervals for local automation schedulers.",
            updated_by=user.id,
        )
        db.add(setting)
    else:
        setting.value = settings
        setting.updated_by = user.id
    db.commit()
    return settings


def is_publish_queue_scheduler_running() -> bool:
    return bool(_publish_queue_task and not _publish_queue_task.done())


def scheduler_snapshot(db: Session) -> dict[str, Any]:
    settings = get_scheduler_settings(db)
    interval = settings["publish_queue_interval_minutes"]
    return {
        "status": "running" if is_publish_queue_scheduler_running() else "stopped",
        "interval": interval,
        "settings": settings,
        "jobs": {
            "vnexpress": {"id": "source_scheduler", "interval_minutes": settings["vnexpress_interval_minutes"]},
            "bilibili": {"id": "source_scheduler", "interval_minutes": settings["bilibili_interval_minutes"]},
            "publish_queue": {"id": "api_publish_queue_scheduler", "interval_minutes": interval},
        },
        "last_run": _last_run,
        "analytics": {
            "account_snapshots": _last_account_snapshot_result,
            "video_metrics": _last_video_analytics_result,
        },
    }


async def start_publish_queue_scheduler() -> None:
    global _publish_queue_task
    if is_publish_queue_scheduler_running():
        return
    _publish_queue_task = asyncio.create_task(_publish_queue_scheduler_loop(), name="api_publish_queue_scheduler")


async def stop_publish_queue_scheduler() -> None:
    global _publish_queue_task
    if not _publish_queue_task:
        return
    task = _publish_queue_task
    _publish_queue_task = None
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def _publish_queue_scheduler_loop() -> None:
    logger.info("Publish queue scheduler started")
    while True:
        interval_seconds = 300
        try:
            settings = get_settings()
            if settings.enable_scheduler:
                result = await asyncio.to_thread(run_publish_queue_once)
                _last_run.update(result)
                await run_due_analytics_tracking()
                with SessionLocal() as db:
                    interval_seconds = get_scheduler_settings(db)["publish_queue_interval_minutes"] * 60
            else:
                logger.info("Publish queue scheduler idle because ENABLE_SCHEDULER=false")
                interval_seconds = max(settings.scheduler_poll_seconds, 5)
        except asyncio.CancelledError:
            logger.info("Publish queue scheduler stopped")
            raise
        except Exception as exc:
            logger.exception("Publish queue scheduler cycle failed: %s", exc)
        await asyncio.sleep(max(interval_seconds, 30))


def run_publish_queue_once(limit: int = 5) -> dict[str, Any]:
    service = SocialProfileService()
    result = {"checked_at": datetime.utcnow().isoformat(), "published": 0, "failed": 0, "skipped": 0, "finalized": 0, "pending": 0}
    with SessionLocal() as db:
        finalize_result = service.finalize_tiktok_publish_statuses(db, limit=limit * 2)
        result["finalized"] += finalize_result["completed"]
        result["failed"] += finalize_result["failed"]
        result["pending"] += finalize_result["pending"]

        due_items = (
            db.query(PublishingQueueItem)
            .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
            .filter(
                PublishingQueueItem.platform == "tiktok",
                PublishingQueueItem.status.in_(["queued", "approved"]),
                PublishingQueueItem.scheduled_at.isnot(None),
                PublishingQueueItem.scheduled_at <= datetime.utcnow(),
                SocialProfile.status == "active",
                SocialProfile.access_token.isnot(None),
            )
            .order_by(PublishingQueueItem.scheduled_at.asc(), PublishingQueueItem.created_at.asc())
            .limit(limit)
            .all()
        )
        for item in due_items:
            strategy = item.profile.strategy
            if not strategy or not strategy.auto_publish_enabled:
                result["skipped"] += 1
                continue
            if item.status == "queued" and strategy.approval_mode != "auto":
                result["skipped"] += 1
                continue
            try:
                service.publish_queue_item_to_tiktok(db, item.id, item.profile.user, source="scheduler", mode="direct")
                result["published"] += 1
            except Exception as exc:
                logger.exception("Auto publish failed queue_item_id=%s: %s", item.id, exc)
                result["failed"] += 1
    return result


async def run_due_analytics_tracking() -> None:
    global _last_account_snapshot_run, _last_video_analytics_run
    now = datetime.utcnow()
    if _last_account_snapshot_run is None or (now - _last_account_snapshot_run).total_seconds() >= 24 * 60 * 60:
        _last_account_snapshot_run = now
        result = await run_daily_account_snapshots()
        _last_account_snapshot_result.update(result)

    if _last_video_analytics_run is None or (now - _last_video_analytics_run).total_seconds() >= 60 * 60:
        _last_video_analytics_run = now
        result = await run_hourly_video_analytics()
        _last_video_analytics_result.update(result)


async def run_daily_account_snapshots(limit: int | None = None) -> dict[str, Any]:
    service = SocialProfileService()
    result = {"checked_at": datetime.utcnow().isoformat(), "profiles": 0, "snapshots": 0, "failed": 0}
    with SessionLocal() as db:
        query = (
            db.query(SocialProfile)
            .filter(
                SocialProfile.platform == "tiktok",
                SocialProfile.status == "active",
                SocialProfile.access_token.isnot(None),
            )
            .order_by(SocialProfile.updated_at.asc(), SocialProfile.created_at.asc())
        )
        profiles = query.limit(limit).all() if limit else query.all()
        for profile in profiles:
            result["profiles"] += 1
            try:
                sync_result = await service.sync_profile(db, profile)
                if sync_result.get("snapshot_created"):
                    result["snapshots"] += 1
            except Exception as exc:
                db.rollback()
                logger.exception("Daily TikTok account snapshot failed profile_id=%s: %s", profile.id, exc)
                result["failed"] += 1
    return result


async def run_hourly_video_analytics() -> dict[str, Any]:
    service = SocialProfileService()
    result = {"checked_at": datetime.utcnow().isoformat(), "profiles": 0, "videos": 0, "metrics": 0, "failed": 0}
    with SessionLocal() as db:
        sync_result = await service.sync_recent_tiktok_post_metrics(db, since_days=30, batch_size=20)
        result.update(sync_result)
        result["checked_at"] = datetime.utcnow().isoformat()
    return result
