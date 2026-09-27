from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import PublishingQueueItem, SocialProfile, SocialProfileStrategy, SystemSetting, User
from common.db.session import SessionLocal
from app.services.social_profiles import SocialProfileService
from app.services.tiktok_posting import TikTokPublishBlockedError

logger = logging.getLogger(__name__)

SCHEDULER_SETTING_KEY = "scheduler_settings"
DEFAULT_SCHEDULER_SETTINGS = {
    "publish_queue_interval_minutes": 1,
}

_publish_queue_task: asyncio.Task | None = None
_publish_cycle_tasks: set[asyncio.Task] = set()
_analytics_task: asyncio.Task | None = None
MAX_CONCURRENT_PUBLISH_CYCLES = 2
ACCOUNT_SNAPSHOT_TIMEZONE = ZoneInfo("Asia/Bangkok")
ACCOUNT_SNAPSHOT_CUTOFF_TIME = time(23, 55)
_last_run: dict[str, Any] = {"checked_at": None, "published": 0, "failed": 0, "skipped": 0, "finalized": 0, "pending": 0}
_last_account_snapshot_run: datetime | None = None
_last_video_analytics_run: datetime | None = None
_last_account_snapshot_result: dict[str, Any] = {"checked_at": None, "profiles": 0, "snapshots": 0, "failed": 0}
_last_video_analytics_result: dict[str, Any] = {"checked_at": None, "profiles": 0, "videos": 0, "metrics": 0, "failed": 0}
_profile_publish_cooldowns: dict[str, datetime] = {}


def _profile_scopes(profile: SocialProfile | None) -> set[str]:
    value = getattr(profile, "scopes_jsonb", None)
    if isinstance(value, str):
        raw_values = [value]
    elif isinstance(value, list):
        raw_values = [str(item) for item in value]
    else:
        raw_values = []
    scopes: set[str] = set()
    for item in raw_values:
        scopes.update(part.strip() for part in re.split(r"[\s,]+", item) if part.strip())
    return scopes


def _scheduler_publish_mode(profile: SocialProfile | None, *, allow_direct: bool = True) -> str:
    scopes = _profile_scopes(profile)
    if allow_direct and "video.publish" in scopes:
        return "direct"
    if "video.upload" in scopes:
        return "inbox"
    return "direct" if "video.publish" in scopes else "inbox"


def _active_publish_cooldown(profile_id: Any, now: datetime | None = None) -> datetime | None:
    key = str(profile_id)
    current = now or datetime.now(timezone.utc)
    cooldown_until = _profile_publish_cooldowns.get(key)
    if cooldown_until and cooldown_until > current:
        return cooldown_until
    _profile_publish_cooldowns.pop(key, None)
    return None


def _set_publish_cooldown(profile_id: Any, seconds: int | None) -> datetime | None:
    if not seconds or seconds <= 0:
        return None
    cooldown_until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    _profile_publish_cooldowns[str(profile_id)] = cooldown_until
    return cooldown_until


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
    global _publish_queue_task, _analytics_task
    task = _publish_queue_task
    _publish_queue_task = None
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    child_tasks = list(_publish_cycle_tasks)
    if _analytics_task and not _analytics_task.done():
        child_tasks.append(_analytics_task)
    for child in child_tasks:
        child.cancel()
    if child_tasks:
        await asyncio.gather(*child_tasks, return_exceptions=True)
    _publish_cycle_tasks.clear()
    _analytics_task = None


def seconds_until_next_interval(now: datetime, interval_minutes: int) -> float:
    """Return a wall-clock-aligned delay instead of drifting after work completes."""
    current = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    step = max(int(interval_minutes), 1) * 60
    remainder = current.timestamp() % step
    return float(step if remainder < 0.001 else step - remainder)


async def _run_publish_cycle() -> None:
    try:
        result = await asyncio.to_thread(run_publish_queue_once)
        _last_run.update(result)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("Publish queue scheduler cycle failed: %s", exc)


async def _run_analytics_cycle() -> None:
    try:
        await run_due_analytics_tracking()
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("Analytics scheduler cycle failed: %s", exc)


async def _publish_queue_scheduler_loop() -> None:
    global _analytics_task
    logger.info("Publish queue scheduler started")
    while True:
        interval_minutes = 1
        try:
            settings = get_settings()
            if settings.enable_scheduler:
                if len(_publish_cycle_tasks) < MAX_CONCURRENT_PUBLISH_CYCLES:
                    cycle = asyncio.create_task(_run_publish_cycle(), name="api_publish_queue_cycle")
                    _publish_cycle_tasks.add(cycle)
                    cycle.add_done_callback(_publish_cycle_tasks.discard)
                else:
                    logger.warning("Publish queue minute skipped because %s cycles are still running", len(_publish_cycle_tasks))
                if _analytics_task is None or _analytics_task.done():
                    _analytics_task = asyncio.create_task(_run_analytics_cycle(), name="api_analytics_cycle")
                with SessionLocal() as db:
                    interval_minutes = get_scheduler_settings(db)["publish_queue_interval_minutes"]
            else:
                logger.info("Publish queue scheduler idle because ENABLE_SCHEDULER=false")
                interval_minutes = max(int(settings.scheduler_poll_seconds / 60), 1)
        except asyncio.CancelledError:
            logger.info("Publish queue scheduler stopped")
            raise
        except Exception as exc:
            logger.exception("Publish queue scheduler cycle failed: %s", exc)
        await asyncio.sleep(seconds_until_next_interval(datetime.now(timezone.utc), interval_minutes))


def run_publish_queue_once(limit: int = 5) -> dict[str, Any]:
    service = SocialProfileService()
    result = {"checked_at": datetime.now(timezone.utc).isoformat(), "published": 0, "failed": 0, "skipped": 0, "finalized": 0, "pending": 0}
    with SessionLocal() as db:
        finalize_result = service.finalize_tiktok_publish_statuses(db, limit=limit * 2)
        result["finalized"] += finalize_result["completed"]
        result["failed"] += finalize_result["failed"]
        result["pending"] += finalize_result["pending"]

        due_items = (
            db.query(PublishingQueueItem)
            .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
            .join(SocialProfileStrategy, SocialProfileStrategy.profile_id == SocialProfile.id)
            .filter(
                PublishingQueueItem.platform == "tiktok",
                PublishingQueueItem.status.in_(["queued", "approved"]),
                PublishingQueueItem.scheduled_at.isnot(None),
                PublishingQueueItem.scheduled_at <= datetime.now(timezone.utc),
                SocialProfile.status == "active",
                SocialProfile.access_token.isnot(None),
                SocialProfileStrategy.auto_publish_enabled.is_(True),
                or_(
                    PublishingQueueItem.status == "approved",
                    and_(PublishingQueueItem.status == "queued", SocialProfileStrategy.approval_mode == "auto"),
                ),
            )
            .order_by(PublishingQueueItem.scheduled_at.asc(), PublishingQueueItem.created_at.asc())
            # Scan past broken legacy rows while keeping each minute's actual
            # TikTok dispatch batch bounded.
            .limit(max(limit * 10, 50))
            # Multiple API instances or a manual "run once" cannot claim the
            # same due row while this transaction is validating it.
            .with_for_update(of=PublishingQueueItem, skip_locked=True)
            .all()
        )
        ready_items = []
        now = datetime.now(timezone.utc)
        for item in due_items:
            cooldown_until = _active_publish_cooldown(item.profile_id, now)
            if cooldown_until:
                logger.info(
                    "Publish queue skipped queue_item_id=%s profile_id=%s because TikTok publish is cooling down until %s",
                    item.id,
                    item.profile_id,
                    cooldown_until.isoformat(),
                )
                result["skipped"] += 1
                continue
            strategy = item.profile.strategy
            if not strategy or not strategy.auto_publish_enabled:
                result["skipped"] += 1
                continue
            if item.status == "queued" and strategy.approval_mode != "auto":
                result["skipped"] += 1
                continue
            try:
                service.resolve_rendered_video_path(item.article_link)
            except Exception as exc:
                item.status = "failed"
                item.error = str(getattr(exc, "detail", exc))[-2000:]
                item.ai_reason = "Auto publish dừng vì file video không còn tồn tại hoặc không hợp lệ."
                db.add(item)
                result["failed"] += 1
                continue
            ready_items.append(item)
            if len(ready_items) >= limit:
                break

        # Claim the whole batch before any network request. The next minute can
        # therefore dispatch other due rows even while TikTok is still working.
        claimed_at = datetime.now(timezone.utc).isoformat()
        claimed_statuses = {item.id: item.status for item in ready_items}
        for item in ready_items:
            item.status = "publishing"
            item.error = None
            item.ai_reason = f"Scheduler nhận bài lúc {claimed_at}; đang gửi TikTok."
            db.add(item)
        db.commit()

        for item in ready_items:
            cooldown_until = _active_publish_cooldown(item.profile_id)
            if cooldown_until:
                skipped_item = db.get(PublishingQueueItem, item.id)
                if skipped_item and skipped_item.status == "publishing" and not skipped_item.platform_publish_id:
                    skipped_item.status = claimed_statuses.get(item.id, "queued")
                    skipped_item.error = None
                    skipped_item.ai_reason = f"Scheduler tạm dừng đăng TikTok đến {cooldown_until.isoformat()} do lỗi trước đó."
                    db.add(skipped_item)
                    db.commit()
                result["skipped"] += 1
                continue
            mode = _scheduler_publish_mode(item.profile)
            try:
                service.publish_queue_item_to_tiktok(db, item.id, item.profile.user, source="scheduler", mode=mode)
                result["published"] += 1
            except Exception as exc:
                db.rollback()
                if (
                    mode == "direct"
                    and isinstance(exc, TikTokPublishBlockedError)
                    and "video.upload" in _profile_scopes(item.profile)
                ):
                    logger.warning(
                        "TikTok Direct Post blocked queue_item_id=%s profile_id=%s; retrying scheduler publish via inbox: %s",
                        item.id,
                        item.profile_id,
                        exc.detail,
                    )
                    try:
                        fallback_item = db.get(PublishingQueueItem, item.id)
                        fallback_user = fallback_item.profile.user if fallback_item and fallback_item.profile else item.profile.user
                        service.publish_queue_item_to_tiktok(db, item.id, fallback_user, source="scheduler", mode="inbox")
                        result["published"] += 1
                        continue
                    except Exception as fallback_exc:
                        db.rollback()
                        exc = fallback_exc
                if isinstance(exc, TikTokPublishBlockedError):
                    cooldown_until = _set_publish_cooldown(item.profile_id, exc.retry_after_seconds)
                    if cooldown_until:
                        logger.warning(
                            "TikTok publish cooldown set for profile_id=%s until %s after queue_item_id=%s failed: %s",
                            item.profile_id,
                            cooldown_until.isoformat(),
                            item.id,
                            exc.detail,
                        )
                failed_item = db.get(PublishingQueueItem, item.id)
                if failed_item and failed_item.status == "publishing" and not failed_item.platform_publish_id:
                    failed_item.status = "failed"
                    failed_item.error = str(getattr(exc, "detail", exc))[-2000:]
                    failed_item.ai_reason = "Auto publish thất bại trước khi TikTok nhận video."
                    db.add(failed_item)
                    db.commit()
                logger.exception("Auto publish failed queue_item_id=%s: %s", item.id, exc)
                result["failed"] += 1
    return result


async def run_due_analytics_tracking() -> None:
    global _last_account_snapshot_run, _last_video_analytics_run
    now = datetime.now(timezone.utc)
    local_now = now.astimezone(ACCOUNT_SNAPSHOT_TIMEZONE)
    last_snapshot_day = (
        _last_account_snapshot_run.astimezone(ACCOUNT_SNAPSHOT_TIMEZONE).date()
        if _last_account_snapshot_run
        else None
    )
    if local_now.time() >= ACCOUNT_SNAPSHOT_CUTOFF_TIME and last_snapshot_day != local_now.date():
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
