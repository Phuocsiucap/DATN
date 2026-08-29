from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from common.db.models import ContentItem, User
from common.db.session import get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas
from app.services.social_profiles import SocialProfileService

router = APIRouter()


@router.get("", response_model=schemas.SocialProfileListResponse)
def list_social_profiles(platform: str | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profiles = service.list_profiles(db, current_user, platform)
    return {"items": [service.serialize_profile(profile) for profile in profiles]}


@router.post("", response_model=schemas.SocialProfileResponse)
def create_social_profile(payload: schemas.SocialProfileCreateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.create_profile(db, current_user, payload)
    return service.serialize_profile(profile)


@router.post("/tiktok/qr/start")
async def start_pending_tiktok_qr_login(payload: schemas.TikTokQrStartRequest, current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    return await service.start_pending_tiktok_qr_login(current_user, payload)


@router.get("/tiktok/qr/{session_id}/status")
async def pending_tiktok_qr_status(
    session_id: str,
    profile_name: str | None = None,
    username: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    return await service.get_pending_tiktok_qr_status(db, current_user, session_id, profile_name, username)


@router.post("/tiktok/qr/{session_id}/stop")
async def stop_pending_tiktok_qr_login(session_id: str, current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    return await service.stop_pending_tiktok_qr_login(current_user, session_id)


@router.get("/queue/items")
def list_my_queue(
    queue_status: str | None = None,
    status: str | None = Query(default=None),
    profile_id: uuid.UUID | None = None,
    platform: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    q: str | None = None,
    view: str | None = Query(default=None),
    timezone_name: str = Query(default="Asia/Bangkok", alias="timezone"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    effective_status = queue_status or status
    tzinfo = _resolve_timezone(timezone_name)
    scheduled_from, scheduled_to = _date_range(start_date, end_date, tzinfo)
    items = service.list_user_queue(
        db,
        current_user,
        effective_status,
        profile_id=profile_id,
        platform=platform,
        scheduled_from=scheduled_from,
        scheduled_to=scheduled_to,
        search=q,
    )
    summary_items = service.list_user_queue(
        db,
        current_user,
        effective_status,
        profile_id=profile_id,
        platform=platform,
        search=q,
    )
    return {
        "items": [_serialize_queue_response_item(db, service, item, view, tzinfo) for item in items],
        "total": len(items),
        "summary": _queue_summary(summary_items, start_date, end_date, tzinfo),
    }


@router.get("/queue/items/{queue_item_id}")
def get_queue_item(
    queue_item_id: uuid.UUID,
    view: str | None = Query(default=None),
    timezone_name: str = Query(default="Asia/Bangkok", alias="timezone"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    item = service.get_owned_queue_item(db, queue_item_id, current_user)
    return _serialize_queue_response_item(db, service, item, view, _resolve_timezone(timezone_name))


@router.patch("/queue/items/{queue_item_id}")
def update_queue_item_status(
    queue_item_id: uuid.UUID,
    payload: schemas.QueueStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    item = service.update_queue_status(db, queue_item_id, current_user, payload.status)
    return service.serialize_queue_item(item)


@router.post("/queue/items/{queue_item_id}/approve-schedule")
def approve_and_schedule_queue_item(
    queue_item_id: uuid.UUID,
    payload: schemas.QueueApproveScheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    item = service.approve_and_schedule_queue_item(
        db,
        queue_item_id,
        current_user,
        schedule_mode=payload.schedule_mode,
        scheduled_at=payload.scheduled_at,
        timezone_name=payload.timezone,
    )
    return _serialize_queue_response_item(db, service, item, "approval", _resolve_timezone(payload.timezone))


@router.post("/queue/items/{queue_item_id}/request-changes")
def request_queue_item_changes(
    queue_item_id: uuid.UUID,
    payload: schemas.QueueRequestChangesRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    item = service.request_queue_item_changes(
        db,
        queue_item_id,
        current_user,
        note=payload.note if payload else None,
    )
    return _serialize_queue_response_item(db, service, item, "approval", _resolve_timezone("Asia/Bangkok"))


@router.post("/queue/items/{queue_item_id}/approve-publish-now")
def approve_and_publish_queue_item_now(
    queue_item_id: uuid.UUID,
    payload: schemas.TikTokPublishRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    result = service.approve_and_publish_queue_item_now(
        db,
        queue_item_id,
        current_user,
        mode=payload.mode if payload else "direct",
        privacy_level=payload.privacy_level if payload else "SELF_ONLY",
        disable_comment=payload.disable_comment if payload else False,
        disable_duet=payload.disable_duet if payload else False,
        disable_stitch=payload.disable_stitch if payload else False,
        is_aigc=payload.is_aigc if payload else True,
        brand_content_toggle=payload.brand_content_toggle if payload else False,
        brand_organic_toggle=payload.brand_organic_toggle if payload else False,
    )
    queue_item = service.get_owned_queue_item(db, queue_item_id, current_user)
    return {
        **result,
        "queue_item": _serialize_queue_response_item(db, service, queue_item, "approval", _resolve_timezone("Asia/Bangkok")),
    }


@router.post("/queue/items/{queue_item_id}/publish")
def publish_queue_item_to_tiktok(
    queue_item_id: uuid.UUID,
    payload: schemas.TikTokPublishRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    return service.publish_queue_item_to_tiktok(
        db,
        queue_item_id,
        current_user,
        mode=payload.mode if payload else "inbox",
        privacy_level=payload.privacy_level if payload else None,
        disable_comment=payload.disable_comment if payload else False,
        disable_duet=payload.disable_duet if payload else False,
        disable_stitch=payload.disable_stitch if payload else False,
        is_aigc=payload.is_aigc if payload else True,
        brand_content_toggle=payload.brand_content_toggle if payload else False,
        brand_organic_toggle=payload.brand_organic_toggle if payload else False,
    )


@router.post("/post-items/{post_id}/metrics")
def create_social_post_metric(
    post_id: uuid.UUID,
    payload: schemas.SocialPostMetricCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    metric = service.create_metric(db, post_id, current_user, payload)
    return service.serialize_metric(metric)


@router.get("/posts/overview")
def social_post_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    return {"items": service.list_post_overview(db, current_user)}


@router.delete("/post-items/{post_id}")
def delete_social_post(post_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    service.delete_post(db, post_id, current_user)
    return {"message": "Đã xóa bài đăng"}


@router.get("/topic-descriptions", response_model=list[schemas.StrategyTopicDetailResponse])
def preview_topic_descriptions(topics: str = Query(default=""), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    return service.serialize_strategy_topic_details(topics)


@router.delete("/{profile_id}")
async def delete_social_profile(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    await service.delete_profile(db, profile)
    return {"message": "Đã xóa tài khoản mạng xã hội"}


@router.post("/{profile_id}/sync", response_model=schemas.SocialProfileResponse)
async def sync_social_profile(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    synced_profile = await service.sync_profile(db, profile)
    return service.serialize_profile(synced_profile)


@router.get("/{profile_id}/strategy", response_model=schemas.SocialProfileStrategyResponse)
def get_social_profile_strategy(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    strategy = service.get_or_create_strategy(db, profile)
    return service.serialize_strategy(strategy)


@router.put("/{profile_id}/strategy", response_model=schemas.SocialProfileStrategyResponse)
def update_social_profile_strategy(
    profile_id: uuid.UUID,
    payload: schemas.SocialProfileStrategyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    strategy = service.update_strategy(db, profile, payload)
    return service.serialize_strategy(strategy)


@router.get("/{profile_id}/strategy/topics", response_model=list[schemas.StrategyTopicDetailResponse])
def list_social_profile_strategy_topics(
    profile_id: uuid.UUID,
    kind: str = Query(default="content"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    strategy = service.get_or_create_strategy(db, profile)
    return service.list_strategy_topics(strategy, kind)


@router.post("/{profile_id}/strategy/topics", response_model=schemas.SocialProfileStrategyResponse)
def add_social_profile_strategy_topic(
    profile_id: uuid.UUID,
    payload: schemas.StrategyTopicMutationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    strategy = service.get_or_create_strategy(db, profile)
    strategy = service.add_strategy_topic(db, strategy, payload)
    return service.serialize_strategy(strategy)


@router.put("/{profile_id}/strategy/topics/{topic_key}", response_model=schemas.SocialProfileStrategyResponse)
def update_social_profile_strategy_topic(
    profile_id: uuid.UUID,
    topic_key: str,
    payload: schemas.StrategyTopicMutationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    strategy = service.get_or_create_strategy(db, profile)
    strategy = service.update_strategy_topic(db, strategy, topic_key, payload)
    return service.serialize_strategy(strategy)


@router.delete("/{profile_id}/strategy/topics/{topic_key}", response_model=schemas.SocialProfileStrategyResponse)
def delete_social_profile_strategy_topic(
    profile_id: uuid.UUID,
    topic_key: str,
    kind: str = Query(default="content"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    strategy = service.get_or_create_strategy(db, profile)
    strategy = service.delete_strategy_topic(db, strategy, kind, topic_key)
    return service.serialize_strategy(strategy)


@router.get("/{profile_id}/queue")
def list_profile_queue(
    profile_id: uuid.UUID,
    queue_status: str | None = None,
    status: str | None = Query(default=None),
    start_date: date | None = None,
    end_date: date | None = None,
    q: str | None = None,
    view: str | None = Query(default=None),
    timezone_name: str = Query(default="Asia/Bangkok", alias="timezone"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    tzinfo = _resolve_timezone(timezone_name)
    scheduled_from, scheduled_to = _date_range(start_date, end_date, tzinfo)
    items = service.list_profile_queue(db, profile, queue_status or status, scheduled_from, scheduled_to, q)
    summary_items = service.list_profile_queue(db, profile, queue_status or status, search=q)
    return {
        "items": [_serialize_queue_response_item(db, service, item, view, tzinfo) for item in items],
        "total": len(items),
        "summary": _queue_summary(summary_items, start_date, end_date, tzinfo),
    }


def _resolve_timezone(timezone_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name or "Asia/Bangkok")
    except ZoneInfoNotFoundError:
        return ZoneInfo("Asia/Bangkok")


def _date_range(start_date: date | None, end_date: date | None, tzinfo: ZoneInfo) -> tuple[datetime | None, datetime | None]:
    scheduled_from = datetime.combine(start_date, time.min, tzinfo=tzinfo).astimezone(timezone.utc) if start_date else None
    scheduled_to = (
        datetime.combine((end_date or start_date) + timedelta(days=1), time.min, tzinfo=tzinfo).astimezone(timezone.utc)
        if (end_date or start_date)
        else None
    )
    return scheduled_from, scheduled_to


def _queue_summary(items: list, start_date: date | None, end_date: date | None, tzinfo: ZoneInfo) -> dict:
    today = datetime.now(tzinfo).date()
    range_start = start_date or today
    range_end = end_date or range_start
    status_counts: dict[str, int] = {}
    today_count = 0
    range_count = 0
    scheduled_count = 0

    for item in items:
        status_counts[item.status] = status_counts.get(item.status, 0) + 1
        if not item.scheduled_at:
            continue
        scheduled_count += 1
        scheduled_day = _local_date(item.scheduled_at, tzinfo)
        if scheduled_day == today:
            today_count += 1
        if range_start <= scheduled_day <= range_end:
            range_count += 1

    return {
        "total": len(items),
        "total_scheduled": scheduled_count,
        "today": today_count,
        "date_range": range_count,
        "status_counts": status_counts,
    }


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _local_date(value: datetime, tzinfo: ZoneInfo) -> date:
    return _ensure_aware(value).astimezone(tzinfo).date()


def _serialize_queue_response_item(db: Session, service: SocialProfileService, item, view: str | None, tzinfo: ZoneInfo) -> dict:
    data = service.serialize_queue_item(item)
    if view == "approval":
        return _serialize_approval_queue_item(db, item, data, tzinfo)
    if view != "schedule":
        return data
    scheduled_at = item.scheduled_at
    scheduled_at_local = _ensure_aware(scheduled_at).astimezone(tzinfo).isoformat() if scheduled_at else None
    profile_scopes = data["profile_scopes"] or []
    return {
        "id": data["id"],
        "profile_id": data["profile_id"],
        "profile_name": data["profile_name"],
        "platform": data["platform"],
        "article_title": data["article_title"],
        "article_link": data["article_link"],
        "generated_content": data["generated_content"],
        "status": data["status"],
        "scheduled_at": data["scheduled_at"],
        "scheduled_at_local": scheduled_at_local,
        "can_upload_inbox": "video.upload" in profile_scopes,
        "can_publish_direct": "video.publish" in profile_scopes,
    }


def _serialize_approval_queue_item(db: Session, item, data: dict, tzinfo: ZoneInfo) -> dict:
    profile = item.profile
    profile_scopes = data["profile_scopes"] or []
    content = db.get(ContentItem, item.content_id) if item.content_id else None
    content_metadata = _content_metadata(content)
    tags = content_metadata.get("tags") if isinstance(content_metadata.get("tags"), list) else []
    scheduled_at = item.scheduled_at
    scheduled_at_local = _ensure_aware(scheduled_at).astimezone(tzinfo).isoformat() if scheduled_at else None
    video_url = _queue_video_url(item.article_link)
    return {
        "id": data["id"],
        "profile_id": data["profile_id"],
        "profile_name": data["profile_name"],
        "profile_username": profile.username if profile else None,
        "profile_avatar_url": profile.avatar_url if profile else None,
        "profile_scopes": profile_scopes,
        "platform": data["platform"],
        "content_id": data["content_id"],
        "article_title": data["article_title"],
        "generated_content": data["generated_content"],
        "caption": data["generated_content"] or data["article_title"],
        "ai_reason": data["ai_reason"],
        "status": data["status"],
        "scheduled_at": data["scheduled_at"],
        "scheduled_at_local": scheduled_at_local,
        "published_at": data["published_at"],
        "created_at": data["created_at"],
        "updated_at": data["updated_at"],
        "error": data["error"],
        "video_url": video_url,
        "thumbnail_url": content_metadata.get("thumbnail_url") or _first_media_url(content.media_jsonb if content else None),
        "source_url": content.canonical_url if content else None,
        "category": content_metadata.get("category"),
        "tags": [str(tag) for tag in tags[:8]],
        "quality_score": float(content.quality_score or 0) if content else None,
        "duration_seconds": content.duration_seconds if content else None,
        "creator_name": _display_user_name(profile.user if profile else None),
        "can_upload_inbox": "video.upload" in profile_scopes,
        "can_publish_direct": "video.publish" in profile_scopes,
    }


def _display_user_name(user: User | None) -> str:
    if not user:
        return "Người dùng"
    return user.full_name or user.email or "Người dùng"


def _queue_video_url(value: str | None) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://", "/api/")):
        return raw
    if raw.startswith("out/") or raw.startswith("out\\"):
        raw = raw[4:]
    normalized = raw.replace("\\", "/")
    return f"/api/v1/generate-video/output/{normalized}"


def _content_metadata(content: ContentItem | None) -> dict:
    if not content:
        return {}
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary_source = sources[0] if sources else {}
    metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def _first_media_url(media_items: list | None) -> str | None:
    media = media_items if isinstance(media_items, list) else []
    for item in media:
        if not isinstance(item, dict):
            continue
        value = item.get("thumbnail_url") or item.get("source_url") or item.get("storage_url")
        if value:
            return value
    return None


@router.get("/{profile_id}/posts")
def list_social_posts(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    return {"items": [service.serialize_post(post) for post in service.list_posts(db, profile)]}


@router.post("/{profile_id}/posts")
def create_social_post(
    profile_id: uuid.UUID,
    payload: schemas.SocialPostCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    post = service.create_post(db, profile, payload)
    return service.serialize_post(post)


@router.post("/{profile_id}/tiktok/qr/start")
async def start_tiktok_qr_login(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    return await service.start_tiktok_qr_login(db, profile)


@router.get("/{profile_id}/tiktok/qr/status")
async def tiktok_qr_status(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    return await service.get_tiktok_qr_status(db, profile)


@router.post("/{profile_id}/tiktok/qr/stop")
async def stop_tiktok_qr_login(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    return await service.stop_tiktok_qr_login(db, profile)
