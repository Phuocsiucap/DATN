from __future__ import annotations

import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.user_service.app.api.routes.auth import get_current_user
from backend.user_service.app.core.database import get_db
from backend.user_service.app.models.user import PublishingQueueItem, SocialPost, SocialPostMetric, SocialProfile, User
from backend.user_service.app.services.content_automation import (
    get_or_create_strategy,
    serialize_queue_item,
    serialize_strategy,
)
from backend.user_service.app.services.tiktok_qr_service import (
    get_tiktok_qr_session,
    refresh_tiktok_qr_session,
    start_tiktok_qr_session,
    stop_tiktok_qr_session,
)

router = APIRouter()
PROJECT_ROOT = Path(__file__).resolve().parents[5]
LEGACY_PROJECT_ROOT = Path(__file__).resolve().parents[3]
SOCIAL_PROFILE_ROOT = PROJECT_ROOT / "social_profile" / "accounts"
LEGACY_SOCIAL_PROFILE_ROOT = LEGACY_PROJECT_ROOT / "social_profile" / "accounts"


class SocialProfileCreateRequest(BaseModel):
    platform: str = "tiktok"
    profile_name: str
    username: Optional[str] = None


class TikTokQrStartRequest(BaseModel):
    profile_name: Optional[str] = None
    username: Optional[str] = None


class SocialPostCreateRequest(BaseModel):
    title: str
    post_url: Optional[str] = None
    platform_post_id: Optional[str] = None
    caption: Optional[str] = None
    status: str = "published"
    published_at: Optional[datetime] = None


class SocialPostMetricCreateRequest(BaseModel):
    views: int = 0
    likes: int = 0
    comments: int = 0
    shares: int = 0
    captured_at: Optional[datetime] = None


class SocialProfileStrategyRequest(BaseModel):
    content_topics: Optional[str] = None
    avoid_topics: Optional[str] = None
    tone: Optional[str] = None
    target_audience: Optional[str] = None
    post_frequency_per_day: Optional[int] = None
    active_hours: Optional[str] = None
    schedule_enabled: Optional[bool] = None
    schedule_days: Optional[str] = None
    schedule_times: Optional[str] = None
    schedule_timezone: Optional[str] = None
    approval_mode: Optional[str] = None
    risk_level: Optional[str] = None
    min_score: Optional[float] = None
    require_video: Optional[bool] = None
    auto_queue_enabled: Optional[bool] = None
    auto_publish_enabled: Optional[bool] = None


class QueueStatusRequest(BaseModel):
    status: str


def _slugify(value: str) -> str:
    slug = "".join(character.lower() if character.isalnum() else "-" for character in value).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "profile"


def _serialize_profile(profile: SocialProfile):
    data = {
        "id": profile.id,
        "user_id": profile.user_id,
        "platform": profile.platform,
        "profile_name": profile.profile_name,
        "username": profile.username,
        "folder_path": profile.folder_path,
        "status": profile.status,
        "created_at": profile.created_at,
    }
    if profile.strategy:
        data["strategy"] = serialize_strategy(profile.strategy)
    return data


def _serialize_metric(metric: SocialPostMetric):
    return {
        "id": metric.id,
        "post_id": metric.post_id,
        "views": metric.views,
        "likes": metric.likes,
        "comments": metric.comments,
        "shares": metric.shares,
        "captured_at": metric.captured_at,
    }


def _metric_at_or_before(metrics: list[SocialPostMetric], target_time: datetime) -> Optional[SocialPostMetric]:
    candidates = [metric for metric in metrics if metric.captured_at <= target_time]
    return max(candidates, key=lambda metric: metric.captured_at) if candidates else None


def _serialize_post(post: SocialPost):
    metrics = sorted(post.metrics, key=lambda metric: metric.captured_at)
    latest_metric = metrics[-1] if metrics else None
    now = datetime.utcnow()

    def growth_since(delta: timedelta) -> Optional[int]:
        if not latest_metric:
            return None
        baseline = _metric_at_or_before(metrics, now - delta)
        if not baseline:
            return None
        return latest_metric.views - baseline.views

    return {
        "id": post.id,
        "profile_id": post.profile_id,
        "title": post.title,
        "post_url": post.post_url,
        "platform_post_id": post.platform_post_id,
        "caption": post.caption,
        "status": post.status,
        "published_at": post.published_at,
        "created_at": post.created_at,
        "latest_metric": _serialize_metric(latest_metric) if latest_metric else None,
        "growth": {
            "views_1h": growth_since(timedelta(hours=1)),
            "views_24h": growth_since(timedelta(days=1)),
            "views_7d": growth_since(timedelta(days=7)),
        },
        "metrics": [_serialize_metric(metric) for metric in metrics],
    }


def _serialize_post_with_profile(post: SocialPost):
    data = _serialize_post(post)
    data["profile"] = _serialize_profile(post.profile)
    return data


def _get_profile_or_404(db: Session, profile_id: int, user_id: int) -> SocialProfile:
    profile = (
        db.query(SocialProfile)
        .filter(SocialProfile.id == profile_id, SocialProfile.user_id == user_id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy social profile")
    return profile


def _get_post_or_404(db: Session, post_id: int, user_id: int) -> SocialPost:
    post = (
        db.query(SocialPost)
        .join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
        .filter(SocialPost.id == post_id, SocialProfile.user_id == user_id)
        .first()
    )
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy bài đăng")
    return post


def _build_profile_path(user_id: int, platform: str, profile_name: str) -> str:
    profile_key = f"{_slugify(profile_name)}-{uuid4().hex[:8]}"
    return str(Path("social_profile") / "accounts" / f"user_{user_id}" / platform / profile_key)


def _normalize_schedule_days(value: str) -> str:
    days: list[int] = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            day = int(item)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schedule_days chỉ nhận số 0-6")
        if day < 0 or day > 6:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schedule_days chỉ nhận số 0-6")
        if day not in days:
            days.append(day)
    if not days:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schedule_days không được để trống")
    return ",".join(str(day) for day in days)


def _normalize_schedule_times(value: str) -> str:
    times: list[str] = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            parsed = datetime.strptime(item, "%H:%M")
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schedule_times phải theo định dạng HH:MM")
        normalized = parsed.strftime("%H:%M")
        if normalized not in times:
            times.append(normalized)
    if not times:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schedule_times không được để trống")
    return ",".join(times)


def _qr_image(session) -> Optional[str]:
    return f"data:image/png;base64,{session.qr_image_b64}" if session.qr_image_b64 else None


def _delete_profile_folder(folder_path: str):
    folder = Path(folder_path)
    profile_dir = (folder if folder.is_absolute() else PROJECT_ROOT / folder).resolve()
    legacy_profile_dir = (folder if folder.is_absolute() else LEGACY_PROJECT_ROOT / folder).resolve()
    allowed_root = SOCIAL_PROFILE_ROOT.resolve()
    legacy_allowed_root = LEGACY_SOCIAL_PROFILE_ROOT.resolve()
    if profile_dir.is_relative_to(allowed_root):
        target_dir = profile_dir
    elif legacy_profile_dir.is_relative_to(legacy_allowed_root):
        target_dir = legacy_profile_dir
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Đường dẫn profile không hợp lệ",
        )
    if target_dir.exists():
        shutil.rmtree(target_dir)


@router.get("")
def list_social_profiles(
    platform: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(SocialProfile).filter(SocialProfile.user_id == current_user.id)
    if platform:
        query = query.filter(SocialProfile.platform == platform)

    profiles = query.order_by(SocialProfile.created_at.desc()).all()
    return {"items": [_serialize_profile(profile) for profile in profiles]}


@router.post("")
def create_social_profile(
    request: SocialProfileCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile_name = request.profile_name.strip()
    if not profile_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="profile_name không được để trống")

    folder_path = _build_profile_path(current_user.id, request.platform, profile_name)

    profile = SocialProfile(
        user_id=current_user.id,
        platform=request.platform,
        profile_name=profile_name,
        username=request.username.strip() if request.username else None,
        folder_path=folder_path,
        status="qr_pending",
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)

    return _serialize_profile(profile)


@router.post("/tiktok/qr/start")
def start_pending_tiktok_qr_login(
    request: TikTokQrStartRequest,
    current_user: User = Depends(get_current_user),
):
    session_id = uuid4().hex
    profile_name = (request.profile_name or "TikTok account").strip() or "TikTok account"
    folder_path = _build_profile_path(current_user.id, "tiktok", profile_name)

    session = start_tiktok_qr_session(session_id, folder_path)
    return {
        "session_id": session_id,
        "authenticated": session.is_authenticated(),
        "qr_image": _qr_image(session),
        "page_url": session.page.url,
    }


@router.get("/tiktok/qr/{session_id}/status")
def pending_tiktok_qr_status(
    session_id: str,
    profile_name: Optional[str] = None,
    username: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = get_tiktok_qr_session(session_id)
    if not session:
        return {"session_active": False, "authenticated": False, "profile": None}

    authenticated = session.is_authenticated()
    try:
        refreshed_session = refresh_tiktok_qr_session(session_id)
        qr_image = _qr_image(refreshed_session)
    except RuntimeError:
        qr_image = None

    if not authenticated:
        return {
            "session_active": True,
            "authenticated": False,
            "profile": None,
            "page_url": session.page.url,
            "qr_image": qr_image or _qr_image(session),
        }

    final_profile_name = (profile_name or "TikTok account").strip() or "TikTok account"
    profile = SocialProfile(
        user_id=current_user.id,
        platform="tiktok",
        profile_name=final_profile_name,
        username=username.strip() if username else None,
        folder_path=str(session.profile_dir.relative_to(PROJECT_ROOT)),
        status="active",
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    page_url = session.page.url
    stop_tiktok_qr_session(session_id)

    return {
        "session_active": False,
        "authenticated": True,
        "profile": _serialize_profile(profile),
        "page_url": page_url,
        "qr_image": qr_image or _qr_image(session),
    }


@router.post("/tiktok/qr/{session_id}/stop")
def stop_pending_tiktok_qr_login(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    stop_tiktok_qr_session(session_id)
    return {"message": "Đã đóng phiên QR TikTok"}


@router.delete("/{profile_id}")
def delete_social_profile(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _get_profile_or_404(db, profile_id, current_user.id)
    stop_tiktok_qr_session(str(profile.id))
    _delete_profile_folder(profile.folder_path)
    db.delete(profile)
    db.commit()
    return {"message": "Đã xóa tài khoản mạng xã hội"}


@router.get("/{profile_id}/strategy")
def get_social_profile_strategy(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _get_profile_or_404(db, profile_id, current_user.id)
    strategy = get_or_create_strategy(db, profile)
    return serialize_strategy(strategy)


@router.put("/{profile_id}/strategy")
def update_social_profile_strategy(
    profile_id: int,
    request: SocialProfileStrategyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _get_profile_or_404(db, profile_id, current_user.id)
    strategy = get_or_create_strategy(db, profile)

    for field, value in request.dict(exclude_unset=True).items():
        if field in {"post_frequency_per_day"} and value is not None:
            value = max(int(value), 1)
        if field in {"min_score"} and value is not None:
            value = max(0.0, min(float(value), 100.0))
        if field == "schedule_days" and value is not None:
            value = _normalize_schedule_days(value)
        if field == "schedule_times" and value is not None:
            value = _normalize_schedule_times(value)
        if field == "schedule_timezone" and value is not None:
            value = value.strip() or "Asia/Bangkok"
        if field == "approval_mode" and value not in {"manual", "auto"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="approval_mode phải là manual hoặc auto")
        if field == "risk_level" and value not in {"low", "medium", "high"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="risk_level phải là low, medium hoặc high")
        setattr(strategy, field, value)

    if strategy.approval_mode != "auto":
        strategy.auto_publish_enabled = False

    db.commit()
    db.refresh(strategy)
    return serialize_strategy(strategy)


@router.get("/{profile_id}/queue")
def list_profile_queue(
    profile_id: int,
    queue_status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _get_profile_or_404(db, profile_id, current_user.id)
    query = db.query(PublishingQueueItem).filter(PublishingQueueItem.profile_id == profile.id)
    if queue_status:
        query = query.filter(PublishingQueueItem.status == queue_status)
    items = query.order_by(PublishingQueueItem.scheduled_at.asc(), PublishingQueueItem.created_at.desc()).all()
    return {"items": [serialize_queue_item(item) for item in items]}


@router.get("/queue/items")
def list_my_queue(
    queue_status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        db.query(PublishingQueueItem)
        .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
        .filter(SocialProfile.user_id == current_user.id)
    )
    if queue_status == "upcoming":
        query = query.filter(PublishingQueueItem.status.in_(["queued", "approved"]))
    elif queue_status:
        query = query.filter(PublishingQueueItem.status == queue_status)
    items = query.order_by(PublishingQueueItem.scheduled_at.asc(), PublishingQueueItem.created_at.desc()).all()
    return {"items": [serialize_queue_item(item) for item in items]}


@router.patch("/queue/items/{queue_item_id}")
def update_queue_item_status(
    queue_item_id: int,
    request: QueueStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(PublishingQueueItem)
        .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
        .filter(PublishingQueueItem.id == queue_item_id, SocialProfile.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy queue item")
    if request.status not in {"queued", "needs_approval", "approved", "skipped"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Trạng thái queue không hợp lệ")

    item.status = request.status
    db.commit()
    db.refresh(item)
    return serialize_queue_item(item)


@router.get("/posts/overview")
def list_social_post_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    posts = (
        db.query(SocialPost)
        .join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
        .filter(SocialProfile.user_id == current_user.id)
        .order_by(SocialPost.published_at.desc(), SocialPost.created_at.desc())
        .all()
    )

    groups: dict[str, dict] = {}
    for post in posts:
        key = post.title.strip().lower()
        if key not in groups:
            groups[key] = {
                "key": key,
                "title": post.title,
                "posts": [],
                "chart_data": [],
                "total_views": 0,
                "account_count": 0,
            }

        serialized_post = _serialize_post_with_profile(post)
        latest_views = serialized_post["latest_metric"]["views"] if serialized_post["latest_metric"] else 0
        groups[key]["posts"].append(serialized_post)
        groups[key]["chart_data"].append({
            "account": post.profile.profile_name,
            "profile_id": post.profile_id,
            "post_id": post.id,
            "views": latest_views,
            "likes": serialized_post["latest_metric"]["likes"] if serialized_post["latest_metric"] else 0,
            "comments": serialized_post["latest_metric"]["comments"] if serialized_post["latest_metric"] else 0,
            "shares": serialized_post["latest_metric"]["shares"] if serialized_post["latest_metric"] else 0,
        })
        groups[key]["total_views"] += latest_views
        groups[key]["account_count"] += 1

    return {"items": list(groups.values())}


@router.get("/{profile_id}/posts")
def list_social_posts(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _get_profile_or_404(db, profile_id, current_user.id)
    posts = (
        db.query(SocialPost)
        .filter(SocialPost.profile_id == profile.id)
        .order_by(SocialPost.published_at.desc(), SocialPost.created_at.desc())
        .all()
    )
    return {"items": [_serialize_post(post) for post in posts]}


@router.post("/{profile_id}/posts")
def create_social_post(
    profile_id: int,
    request: SocialPostCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _get_profile_or_404(db, profile_id, current_user.id)
    title = request.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="title không được để trống")

    post = SocialPost(
        profile_id=profile.id,
        title=title,
        post_url=request.post_url.strip() if request.post_url else None,
        platform_post_id=request.platform_post_id.strip() if request.platform_post_id else None,
        caption=request.caption,
        status=request.status,
        published_at=request.published_at or datetime.utcnow(),
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return _serialize_post(post)


@router.delete("/post-items/{post_id}")
def delete_social_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = _get_post_or_404(db, post_id, current_user.id)
    db.delete(post)
    db.commit()
    return {"message": "Đã xóa bài đăng"}


@router.post("/post-items/{post_id}/metrics")
def create_social_post_metric(
    post_id: int,
    request: SocialPostMetricCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = _get_post_or_404(db, post_id, current_user.id)
    metric = SocialPostMetric(
        post_id=post.id,
        views=max(request.views, 0),
        likes=max(request.likes, 0),
        comments=max(request.comments, 0),
        shares=max(request.shares, 0),
        captured_at=request.captured_at or datetime.utcnow(),
    )
    db.add(metric)
    db.commit()
    db.refresh(metric)
    return _serialize_metric(metric)


@router.post("/{profile_id}/tiktok/qr/start")
def start_tiktok_qr_login(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _get_profile_or_404(db, profile_id, current_user.id)
    if profile.platform != "tiktok":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile này không phải TikTok")

    session = start_tiktok_qr_session(str(profile.id), profile.folder_path)
    profile.status = "qr_pending"
    db.commit()

    return {
        "profile": _serialize_profile(profile),
        "authenticated": session.is_authenticated(),
        "qr_image": _qr_image(session),
        "page_url": session.page.url,
    }


@router.get("/{profile_id}/tiktok/qr/status")
def tiktok_qr_status(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _get_profile_or_404(db, profile_id, current_user.id)
    session = get_tiktok_qr_session(str(profile.id))
    if not session:
        return {"profile": _serialize_profile(profile), "session_active": False, "authenticated": False}

    authenticated = session.is_authenticated()
    if authenticated and profile.status != "active":
        profile.status = "active"
        db.commit()
        db.refresh(profile)

    try:
        refreshed_session = refresh_tiktok_qr_session(str(profile.id))
        qr_image = _qr_image(refreshed_session)
    except RuntimeError:
        qr_image = None

    return {
        "profile": _serialize_profile(profile),
        "session_active": True,
        "authenticated": authenticated,
        "page_url": session.page.url,
        "qr_image": qr_image or _qr_image(session),
    }


@router.post("/{profile_id}/tiktok/qr/stop")
def stop_tiktok_qr_login(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = _get_profile_or_404(db, profile_id, current_user.id)
    stop_tiktok_qr_session(str(profile.id))
    if profile.status == "qr_pending":
        profile.status = "inactive"
        db.commit()

    return {"message": "Đã đóng phiên QR", "profile": _serialize_profile(profile)}
