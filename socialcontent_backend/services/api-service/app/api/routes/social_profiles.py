from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from common.db.models import User
from common.db.session import get_db
from app.api.deps import get_current_user
from app.schemas import api as schemas
from app.services.social_profiles import SocialProfileService

router = APIRouter()


@router.get("")
def list_social_profiles(platform: str | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profiles = service.list_profiles(db, current_user, platform)
    return {"items": [service.serialize_profile(profile) for profile in profiles]}


@router.post("")
def create_social_profile(payload: schemas.SocialProfileCreateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.create_profile(db, current_user, payload)
    return service.serialize_profile(profile)


@router.post("/tiktok/qr/start")
def start_pending_tiktok_qr_login(payload: schemas.TikTokQrStartRequest, current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    return service.start_pending_tiktok_qr_login(current_user, payload)


@router.get("/tiktok/qr/{session_id}/status")
def pending_tiktok_qr_status(
    session_id: str,
    profile_name: str | None = None,
    username: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = SocialProfileService()
    return service.get_pending_tiktok_qr_status(db, current_user, session_id, profile_name, username)


@router.post("/tiktok/qr/{session_id}/stop")
def stop_pending_tiktok_qr_login(session_id: str, current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    return service.stop_pending_tiktok_qr_login(current_user, session_id)


@router.delete("/{profile_id}")
def delete_social_profile(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    service.delete_profile(db, profile)
    return {"message": "Đã xóa tài khoản mạng xã hội"}


@router.get("/{profile_id}/strategy")
def get_social_profile_strategy(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    strategy = service.get_or_create_strategy(db, profile)
    return service.serialize_strategy(strategy)


@router.put("/{profile_id}/strategy")
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


@router.get("/{profile_id}/queue")
def list_profile_queue(profile_id: uuid.UUID, queue_status: str | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    items = service.list_profile_queue(db, profile, queue_status)
    return {"items": [service.serialize_queue_item(item) for item in items]}


@router.get("/queue/items")
def list_my_queue(queue_status: str | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    items = service.list_user_queue(db, current_user, queue_status)
    return {"items": [service.serialize_queue_item(item) for item in items]}


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


@router.post("/{profile_id}/tiktok/qr/start")
def start_tiktok_qr_login(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    return service.start_tiktok_qr_login(db, profile)


@router.get("/{profile_id}/tiktok/qr/status")
def tiktok_qr_status(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    return service.get_tiktok_qr_status(db, profile)


@router.post("/{profile_id}/tiktok/qr/stop")
def stop_tiktok_qr_login(profile_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = SocialProfileService()
    profile = service.get_owned_profile(db, profile_id, current_user)
    return service.stop_tiktok_qr_login(db, profile)
