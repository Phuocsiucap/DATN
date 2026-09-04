from __future__ import annotations

import uuid
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from common.db.models import ContentItem, MediaWorkflow, ProfileContentLink, PublishingQueueItem, SocialPost, SocialPostMetric, SocialProfile, SocialProfileSnapshot, SocialProfileStrategy, User
from common.planning.embedding_matcher import StrategyEmbeddingMatcher
from common.planning.auto_draft_policy import auto_production_allowed, is_auto_workflow
from common.planning.publishing_schedule import choose_publish_schedule, lock_schedule_profile, schedule_timezone
from app.schemas import api as schemas
from app.services.tiktok_oauth import (
    build_tiktok_token_metadata,
    fetch_tiktok_user_info,
    fetch_tiktok_video_list,
    fetch_tiktok_video_stats,
    granted_scopes,
    poll_tiktok_oauth_qr_session,
    requested_tiktok_scopes,
    start_tiktok_oauth_qr_session,
    stop_tiktok_oauth_qr_session,
)
from app.services import generate_video as video_pipeline
from app.services.tiktok_posting import (
    direct_post_video_to_tiktok,
    ensure_tiktok_access_token,
    extract_tiktok_public_post_id,
    fetch_tiktok_publish_status,
    poll_tiktok_publish_status,
    tiktok_publish_failure_reason,
    tiktok_publish_is_complete,
    tiktok_publish_is_failed,
    tiktok_publish_status_value,
    upload_video_to_tiktok_inbox,
)

logger = logging.getLogger(__name__)


def _scope_list(value: object) -> list[str]:
    if isinstance(value, str):
        raw_values = [value]
    elif isinstance(value, list):
        raw_values = [str(item) for item in value]
    else:
        raw_values = []
    scopes: list[str] = []
    for item in raw_values:
        for part in re.split(r"[\s,]+", item):
            scope = part.strip()
            if scope and scope not in scopes:
                scopes.append(scope)
    return scopes


def _append_human_note(current: str | None, note: str) -> str:
    base = (current or "").strip()
    if not base:
        return note
    if note in base:
        return base
    return f"{base}\n{note}"


def _optional_int(value: object) -> int | None:
    if value in (None, ""):
        return None
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return None


def _apply_tiktok_user_info(profile: SocialProfile, user_info: dict, update_metadata: bool = True) -> None:
    display_name = (user_info.get("display_name") or "").strip()
    username = (user_info.get("username") or "").strip()
    if display_name:
        profile.profile_name = display_name
    if username:
        profile.username = username

    avatar_url = user_info.get("avatar_large_url") or user_info.get("avatar_url_100") or user_info.get("avatar_url")
    if avatar_url:
        profile.avatar_url = avatar_url

    for source_key, attr_name in (
        ("follower_count", "follower_count"),
        ("following_count", "following_count"),
        ("likes_count", "likes_count"),
        ("video_count", "video_count"),
    ):
        if source_key in user_info:
            setattr(profile, attr_name, _optional_int(user_info.get(source_key)))

    if update_metadata:
        metadata = dict(profile.metadata_json or {})
        metadata["provider"] = "tiktok"
        metadata["user"] = user_info
        metadata["last_profile_sync_at"] = datetime.now(timezone.utc).isoformat()
        profile.metadata_json = metadata


class SocialProfileService:
    def _social_post_title(self, value: object, fallback: str = "TikTok Video") -> str:
        title = str(value or fallback).strip() or fallback
        return title[:255]

    def list_profiles(self, db: Session, user: User, platform: str | None = None) -> list[SocialProfile]:
        query = db.query(SocialProfile)
        if not self.is_system_user(user):
            query = query.filter(SocialProfile.user_id == user.id)
        if platform:
            query = query.filter(SocialProfile.platform == platform)
        return query.order_by(SocialProfile.created_at.desc()).all()

    def create_profile(self, db: Session, user: User, payload: schemas.SocialProfileCreateRequest) -> SocialProfile:
        profile_name = payload.profile_name.strip()
        if not profile_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="profile_name không được để trống")
        platform = payload.platform.strip().lower() or "tiktok"
        profile = SocialProfile(
            user_id=user.id,
            platform=platform,
            profile_name=profile_name,
            username=payload.username.strip() if payload.username else None,
            folder_path=self.build_profile_identifier(user.id, platform, profile_name),
            status="qr_pending" if platform == "tiktok" else "inactive",
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)
        return profile

    def get_owned_profile(self, db: Session, profile_id: uuid.UUID, user: User) -> SocialProfile:
        query = db.query(SocialProfile).filter(SocialProfile.id == profile_id)
        if not self.is_system_user(user):
            query = query.filter(SocialProfile.user_id == user.id)
        profile = query.first()
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy social profile")
        return profile

    async def delete_profile(self, db: Session, profile: SocialProfile) -> None:
        await stop_tiktok_oauth_qr_session(str(profile.id), profile.user_id)
        db.delete(profile)
        db.commit()

    async def start_pending_tiktok_qr_login(self, user: User, payload: schemas.TikTokQrStartRequest) -> dict:
        session_id = uuid.uuid4().hex
        profile_name = (payload.profile_name or "TikTok account").strip() or "TikTok account"
        session = await start_tiktok_oauth_qr_session(
            session_id=session_id,
            user_id=user.id,
            profile_name=profile_name,
            username=payload.username,
        )
        logger.info(
            "Started pending TikTok OAuth QR session_id=%s user_id=%s profile_name=%s",
            session_id,
            user.id,
            profile_name,
        )
        return {
            "session_id": session_id,
            "authenticated": False,
            "session_active": True,
            "status": session.last_status,
            "requested_scopes": requested_tiktok_scopes(),
            "qr_image": session.qr_image,
            "qr_url": session.qr_url,
            "page_url": session.qr_url,
        }

    async def get_pending_tiktok_qr_status(
        self,
        db: Session,
        user: User,
        session_id: str,
        profile_name: str | None = None,
        username: str | None = None,
    ) -> dict:
        result = await poll_tiktok_oauth_qr_session(session_id, user.id)
        if not result.get("session_active") and not result.get("authenticated"):
            logger.info("Pending TikTok QR status session missing session_id=%s user_id=%s", session_id, user.id)
            return {**result, "requested_scopes": requested_tiktok_scopes()}

        if not result.get("authenticated"):
            return {**result, "requested_scopes": requested_tiktok_scopes()}

        session = result["session"]
        profile = self.upsert_tiktok_oauth_profile(
            db=db,
            user=user,
            token_data=result["token_data"],
            user_info=result["user_info"],
            fallback_profile_name=profile_name or session.profile_name,
            fallback_username=username or session.username,
        )
        logger.info(
            "Stored TikTok OAuth profile from QR session_id=%s user_id=%s profile_id=%s open_id=%s",
            session_id,
            user.id,
            profile.id,
            profile.external_id,
        )
        await stop_tiktok_oauth_qr_session(session_id, user.id)
        return {
            "session_active": False,
            "authenticated": True,
            "requested_scopes": requested_tiktok_scopes(),
            "granted_scopes": _scope_list(getattr(profile, "scopes_jsonb", None)),
            "profile": self.serialize_profile(profile),
            "status": "confirmed",
            "page_url": session.qr_url,
            "qr_url": session.qr_url,
            "qr_image": session.qr_image,
        }

    async def stop_pending_tiktok_qr_login(self, user: User, session_id: str) -> dict:
        await stop_tiktok_oauth_qr_session(session_id, user.id)
        return {"message": "Đã đóng phiên QR TikTok"}

    async def start_tiktok_qr_login(self, db: Session, profile: SocialProfile) -> dict:
        self.ensure_tiktok_profile(profile)
        session = await start_tiktok_oauth_qr_session(
            session_id=str(profile.id),
            user_id=profile.user_id,
            profile_name=profile.profile_name,
            username=profile.username,
            target_profile_id=profile.id,
        )
        profile.status = "qr_pending"
        db.commit()
        db.refresh(profile)
        return {
            "profile": self.serialize_profile(profile),
            "authenticated": False,
            "session_active": True,
            "status": session.last_status,
            "requested_scopes": requested_tiktok_scopes(),
            "qr_image": session.qr_image,
            "qr_url": session.qr_url,
            "page_url": session.qr_url,
        }

    async def get_tiktok_qr_status(self, db: Session, profile: SocialProfile) -> dict:
        self.ensure_tiktok_profile(profile)
        result = await poll_tiktok_oauth_qr_session(str(profile.id), profile.user_id)
        if not result.get("authenticated"):
            return {**result, "requested_scopes": requested_tiktok_scopes(), "profile": self.serialize_profile(profile)}

        session = result["session"]
        updated_profile = self.upsert_tiktok_oauth_profile(
            db=db,
            user=profile.user,
            token_data=result["token_data"],
            user_info=result["user_info"],
            fallback_profile_name=profile.profile_name,
            fallback_username=profile.username,
            target_profile=profile,
        )
        await stop_tiktok_oauth_qr_session(str(profile.id), profile.user_id)
        return {
            "profile": self.serialize_profile(updated_profile),
            "session_active": False,
            "authenticated": True,
            "requested_scopes": requested_tiktok_scopes(),
            "granted_scopes": _scope_list(getattr(updated_profile, "scopes_jsonb", None)),
            "status": "confirmed",
            "page_url": session.qr_url,
            "qr_url": session.qr_url,
            "qr_image": session.qr_image,
        }

    async def stop_tiktok_qr_login(self, db: Session, profile: SocialProfile) -> dict:
        self.ensure_tiktok_profile(profile)
        await stop_tiktok_oauth_qr_session(str(profile.id), profile.user_id)
        if profile.status == "qr_pending":
            profile.status = "inactive"
            db.commit()
            db.refresh(profile)
        return {"message": "Đã đóng phiên QR", "profile": self.serialize_profile(profile)}

    def upsert_tiktok_oauth_profile(
        self,
        db: Session,
        user: User,
        token_data: dict,
        user_info: dict,
        fallback_profile_name: str | None = None,
        fallback_username: str | None = None,
        target_profile: SocialProfile | None = None,
    ) -> SocialProfile:
        open_id = user_info.get("open_id") or token_data.get("open_id")
        if not open_id:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="TikTok không trả về open_id")

        profile = target_profile
        if profile is None:
            profile = (
                db.query(SocialProfile)
                .filter(
                    SocialProfile.user_id == user.id,
                    SocialProfile.platform == "tiktok",
                    SocialProfile.external_id == open_id,
                )
                .first()
            )

        display_name = (user_info.get("display_name") or "").strip()
        tiktok_username = (user_info.get("username") or fallback_username or "").strip() or None
        profile_name = display_name or (fallback_profile_name or "").strip() or tiktok_username or "TikTok account"
        scope_values = _scope_list(granted_scopes(token_data))
        now = datetime.utcnow()
        expires_in = int(token_data.get("expires_in") or 0)
        refresh_expires_in = int(token_data.get("refresh_expires_in") or 0)

        if profile is None:
            profile = SocialProfile(
                user_id=user.id,
                platform="tiktok",
                profile_name=profile_name,
                username=tiktok_username,
                folder_path=self.build_profile_identifier(user.id, "tiktok", profile_name),
                status="active",
            )
            db.add(profile)
        else:
            profile.profile_name = profile_name
            profile.username = tiktok_username
            profile.status = "active"

        profile.external_id = open_id
        profile.avatar_url = user_info.get("avatar_large_url") or user_info.get("avatar_url_100") or user_info.get("avatar_url")
        profile.access_token = token_data.get("access_token")
        profile.refresh_token = token_data.get("refresh_token")
        profile.token_expires_at = now + timedelta(seconds=expires_in) if expires_in else None
        profile.refresh_expires_at = now + timedelta(seconds=refresh_expires_in) if refresh_expires_in else None
        profile.scopes_jsonb = scope_values
        profile.metadata_json = build_tiktok_token_metadata(token_data, user_info)
        _apply_tiktok_user_info(profile, user_info, update_metadata=False)
        db.flush()
        self.create_profile_snapshot_if_changed(db, profile, datetime.now(timezone.utc))

        db.commit()
        db.refresh(profile)
        return profile

    def current_profile_stats(self, profile: SocialProfile) -> dict[str, int]:
        return {
            "follower_count": int(profile.follower_count or 0),
            "following_count": int(profile.following_count or 0),
            "likes_count": int(profile.likes_count or 0),
            "video_count": int(profile.video_count or 0),
        }

    def latest_profile_snapshot(self, db: Session, profile: SocialProfile) -> SocialProfileSnapshot | None:
        return (
            db.query(SocialProfileSnapshot)
            .filter(SocialProfileSnapshot.profile_id == profile.id)
            .order_by(SocialProfileSnapshot.captured_at.desc())
            .first()
        )

    def has_account_stats_changed(self, latest_snapshot: SocialProfileSnapshot | None, current_stats: dict[str, int]) -> bool:
        if not latest_snapshot:
            return True
        return (
            latest_snapshot.follower_count != current_stats.get("follower_count", 0)
            or latest_snapshot.following_count != current_stats.get("following_count", 0)
            or latest_snapshot.likes_count != current_stats.get("likes_count", 0)
        )

    def create_profile_snapshot_if_changed(self, db: Session, profile: SocialProfile, captured_at: datetime | None = None) -> bool:
        stats = self.current_profile_stats(profile)
        latest = self.latest_profile_snapshot(db, profile)
        if not self.has_account_stats_changed(latest, stats):
            return False
        db.add(SocialProfileSnapshot(profile_id=profile.id, captured_at=captured_at or datetime.now(timezone.utc), **stats))
        return True

    async def sync_profile(self, db: Session, profile: SocialProfile) -> dict[str, Any]:
        self.ensure_tiktok_profile(profile)
        access_token = ensure_tiktok_access_token(profile)

        # 1. Fetch profile & account stats from TikTok
        user_info = await fetch_tiktok_user_info(access_token)
        open_id = user_info.get("open_id")
        if profile.external_id and open_id and str(profile.external_id) != str(open_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Access token TikTok không khớp với profile hiện tại")
        if open_id and not profile.external_id:
            profile.external_id = open_id
        profile.status = "active"
        _apply_tiktok_user_info(profile, user_info)

        now = datetime.now(timezone.utc)
        # 2. Record Account Snapshot only when account stats changed.
        snapshot_created = self.create_profile_snapshot_if_changed(db, profile, now)

        # 3. Fetch TikTok Video List & Video Stats
        synced_videos_count = 0
        resolved_post_ids_count = self.resolve_missing_tiktok_post_ids(db, profile, access_token)
        profile_id = str(profile.id)
        try:
            video_data = await fetch_tiktok_video_list(access_token, max_count=20)
            videos = video_data.get("videos") or []
            if isinstance(videos, list):
                for v in videos:
                    if not isinstance(v, dict):
                        continue
                    v_id = str(v.get("id") or "").strip()
                    if not v_id:
                        continue

                    post = (
                        db.query(SocialPost)
                        .filter(SocialPost.profile_id == profile.id, SocialPost.platform_post_id == v_id)
                        .first()
                    )
                    v_title = self._social_post_title(v.get("title") or v.get("video_description"), f"TikTok Video {v_id}")
                    v_url = v.get("share_url")
                    v_caption = v.get("video_description")
                    v_created_time = v.get("create_time")
                    pub_date = datetime.fromtimestamp(v_created_time, timezone.utc) if v_created_time else now

                    if not post:
                        post = SocialPost(
                            profile_id=profile.id,
                            title=v_title,
                            post_url=v_url,
                            platform_post_id=v_id,
                            caption=v_caption,
                            status="published",
                            published_at=pub_date,
                        )
                        db.add(post)
                        db.flush()
                    else:
                        post.title = v_title
                        if v_url:
                            post.post_url = v_url
                        if v_caption:
                            post.caption = v_caption

                    metric = SocialPostMetric(
                        post_id=post.id,
                        views=int(v.get("view_count") or 0),
                        likes=int(v.get("like_count") or 0),
                        comments=int(v.get("comment_count") or 0),
                        shares=int(v.get("share_count") or 0),
                        captured_at=now,
                    )
                    db.add(metric)
                    synced_videos_count += 1
        except SQLAlchemyError as exc:
            db.rollback()
            logger.warning("Không thể đồng bộ danh sách video TikTok cho profile %s: %s", profile_id, exc)
        except Exception as exc:
            logger.warning("Không thể đồng bộ danh sách video TikTok cho profile %s: %s", profile_id, exc)

        db.commit()
        db.refresh(profile)
        return {
            "profile": self.serialize_profile(profile),
            "synced_videos_count": synced_videos_count,
            "resolved_post_ids_count": resolved_post_ids_count,
            "snapshot_created": snapshot_created,
            "synced_at": now.isoformat(),
        }

    def get_or_create_strategy(self, db: Session, profile: SocialProfile) -> SocialProfileStrategy:
        if profile.strategy:
            return profile.strategy
        strategy = SocialProfileStrategy(user_id=profile.user_id, profile_id=profile.id)
        db.add(strategy)
        db.commit()
        db.refresh(strategy)
        return strategy

    def update_strategy(self, db: Session, profile: SocialProfile, payload: schemas.SocialProfileStrategyRequest) -> SocialProfileStrategy:
        strategy = self.get_or_create_strategy(db, profile)
        changes = payload.model_dump(exclude_unset=True)
        for field, value in changes.items():
            if field == "post_frequency_per_day" and value is not None:
                value = max(int(value), 1)
            elif field == "min_similarity" and value is not None:
                value = max(0.0, min(float(value), 1.0))
            elif field == "avoid_similarity_threshold" and value is not None:
                value = max(0.0, min(float(value), 1.0))
            elif field in {"content_topic_descriptions", "avoid_topic_descriptions"}:
                value = self.normalize_topic_descriptions(value)
            elif field == "schedule_days" and value is not None:
                value = self.normalize_schedule_days(value)
            elif field == "schedule_times" and value is not None:
                value = self.normalize_schedule_times(value)
            elif field == "schedule_timezone" and value is not None:
                value = value.strip() or "Asia/Bangkok"
            elif field == "approval_mode" and value not in {"manual", "auto"}:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="approval_mode phải là manual hoặc auto")
            elif field == "video_render_mode" and value not in {"manual", "auto"}:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="video_render_mode phải là manual hoặc auto")
            elif field == "risk_level" and value not in {"low", "medium", "high"}:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="risk_level phải là low, medium hoặc high")
            setattr(strategy, field, value)

        if changes.get("receive_system_content") is False:
            (
                db.query(ProfileContentLink)
                .filter(
                    ProfileContentLink.user_id == profile.user_id,
                    ProfileContentLink.profile_id == profile.id,
                    ProfileContentLink.source_scope == "GLOBAL",
                )
                .update({ProfileContentLink.status: "INACTIVE"}, synchronize_session=False)
            )

        strategy.content_topic_descriptions = self.prune_topic_descriptions(strategy.content_topics, strategy.content_topic_descriptions)
        strategy.avoid_topic_descriptions = self.prune_topic_descriptions(strategy.avoid_topics, strategy.avoid_topic_descriptions)
        db.commit()
        db.refresh(strategy)
        return strategy

    def list_strategy_topics(self, strategy: SocialProfileStrategy, kind: str) -> list[dict]:
        topics, descriptions = self.strategy_topic_state(strategy, kind)
        return self.serialize_strategy_topic_details(topics, descriptions)

    def add_strategy_topic(self, db: Session, strategy: SocialProfileStrategy, payload: schemas.StrategyTopicMutationRequest) -> SocialProfileStrategy:
        kind = self.normalize_topic_kind(payload.kind)
        topic = str(payload.topic or "").strip()
        if not topic:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Topic không được để trống")
        topics, descriptions = self.strategy_topic_state(strategy, kind)
        topic_list = self.split_terms(topics)
        topic_key = StrategyEmbeddingMatcher.topic_key(topic)
        if topic_key not in {StrategyEmbeddingMatcher.topic_key(item) for item in topic_list}:
            topic_list.append(topic)
        description = str(payload.description or "").strip()
        if description:
            descriptions[topic_key] = description
        self.apply_strategy_topic_state(strategy, kind, topic_list, descriptions)
        db.commit()
        db.refresh(strategy)
        return strategy

    def update_strategy_topic(
        self,
        db: Session,
        strategy: SocialProfileStrategy,
        topic_key: str,
        payload: schemas.StrategyTopicMutationRequest,
    ) -> SocialProfileStrategy:
        kind = self.normalize_topic_kind(payload.kind)
        lookup_key = StrategyEmbeddingMatcher.topic_key(topic_key)
        topics, descriptions = self.strategy_topic_state(strategy, kind)
        topic_list = self.split_terms(topics)
        index = next((idx for idx, item in enumerate(topic_list) if StrategyEmbeddingMatcher.topic_key(item) == lookup_key), None)
        if index is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy topic")

        next_topic = str(payload.topic or topic_list[index]).strip()
        if not next_topic:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Topic không được để trống")
        next_key = StrategyEmbeddingMatcher.topic_key(next_topic)
        topic_list[index] = next_topic

        if lookup_key != next_key and lookup_key in descriptions and next_key not in descriptions:
            descriptions[next_key] = descriptions.pop(lookup_key)
        elif lookup_key != next_key:
            descriptions.pop(lookup_key, None)

        if payload.description is not None:
            description = str(payload.description or "").strip()
            if description:
                descriptions[next_key] = description
            else:
                descriptions.pop(next_key, None)

        self.apply_strategy_topic_state(strategy, kind, topic_list, descriptions)
        db.commit()
        db.refresh(strategy)
        return strategy

    def delete_strategy_topic(self, db: Session, strategy: SocialProfileStrategy, kind: str, topic_key: str) -> SocialProfileStrategy:
        normalized_kind = self.normalize_topic_kind(kind)
        lookup_key = StrategyEmbeddingMatcher.topic_key(topic_key)
        topics, descriptions = self.strategy_topic_state(strategy, normalized_kind)
        topic_list = [item for item in self.split_terms(topics) if StrategyEmbeddingMatcher.topic_key(item) != lookup_key]
        descriptions.pop(lookup_key, None)
        self.apply_strategy_topic_state(strategy, normalized_kind, topic_list, descriptions)
        db.commit()
        db.refresh(strategy)
        return strategy

    def list_profile_queue(
        self,
        db: Session,
        profile: SocialProfile,
        queue_status: str | None = None,
        scheduled_from: datetime | None = None,
        scheduled_to: datetime | None = None,
        search: str | None = None,
    ) -> list[PublishingQueueItem]:
        query = (
            db.query(PublishingQueueItem)
            .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
            .filter(PublishingQueueItem.profile_id == profile.id)
        )
        query = self.apply_queue_filters(
            query,
            queue_status=queue_status,
            scheduled_from=scheduled_from,
            scheduled_to=scheduled_to,
            search=search,
        )
        return query.order_by(PublishingQueueItem.scheduled_at.asc(), PublishingQueueItem.created_at.desc()).all()

    def sync_rendered_workflows_to_queue(self, db: Session, user: User) -> None:
        """
        Đưa video hoàn tất vào Approvals khi chưa có bản ghi, không đặt lịch.
        Video đã duyệt giữ trạng thái approved để không phải duyệt hai lần.
        """
        query = db.query(MediaWorkflow).filter(
            MediaWorkflow.status.in_(["RENDERED", "VIDEO_APPROVED", "QUEUED_FOR_PUBLISHING"])
        )
        if not self.is_system_user(user):
            query = query.filter(MediaWorkflow.user_id == user.id)
        workflows = query.all()
        if not workflows:
            return

        changed = False
        for wf in workflows:
            metadata = dict(wf.metadata_json or {})
            if not auto_production_allowed(metadata, wf.draft_json):
                continue
            queued_id = metadata.get("queued_post_id")
            if queued_id:
                try:
                    existing = db.get(PublishingQueueItem, uuid.UUID(str(queued_id)))
                    if existing:
                        # Older intake mislabeled already-approved videos as
                        # pending review. Only repair its untouched, unscheduled
                        # records; never activate an existing reserved slot.
                        if (
                            metadata.get("video_approved")
                            and existing.user_id == wf.user_id
                            and existing.profile_id == wf.profile_id
                            and existing.status == "needs_approval"
                            and existing.scheduled_at is None
                            and existing.ai_reason == "Được chuyển tự động từ Video đã hoàn thành render"
                        ):
                            existing.status = "approved"
                            existing.ai_reason = "Video đã duyệt được chuyển sang Approvals, chưa lên lịch đăng"
                            db.add(existing)
                            changed = True
                        continue
                except (ValueError, TypeError):
                    pass

            artifacts = wf.artifacts_jsonb if isinstance(wf.artifacts_jsonb, list) else []
            final_video = next(
                (item.get("uri") for item in reversed(artifacts) if isinstance(item, dict) and item.get("status") != "STALE" and item.get("uri") and (item.get("type") or item.get("artifact_type")) == "FINAL_VIDEO"),
                metadata.get("rendered_video") or metadata.get("final_video")
            )
            if not final_video and isinstance(wf.draft_json, dict):
                story_artifacts = wf.draft_json.get("video_artifacts") if isinstance(wf.draft_json.get("video_artifacts"), dict) else {}
                final_video = story_artifacts.get("final")
            if not final_video:
                continue

            profile = db.get(SocialProfile, wf.profile_id)
            if not profile:
                continue

            content = db.get(ContentItem, wf.primary_content_id) if wf.primary_content_id else None
            article_link = final_video
            article_title = wf.title or (content.canonical_title if content else "Video bài viết")

            queue_item = PublishingQueueItem(
                user_id=wf.user_id,
                profile_id=wf.profile_id,
                content_id=wf.primary_content_id,
                article_link=article_link,
                article_title=article_title,
                platform=profile.platform or "tiktok",
                generated_content=wf.title,
                ai_reason="Video hoàn tất được chuyển sang Approvals, chưa lên lịch đăng",
                status="approved" if metadata.get("video_approved") else "needs_approval",
                # An Approvals record is not a reserved publishing slot.
                scheduled_at=None,
            )
            db.add(queue_item)
            db.flush()

            metadata["queued_post_id"] = str(queue_item.id)
            wf.metadata_json = metadata
            db.add(wf)
            changed = True

        if changed:
            db.commit()

    def list_user_queue(
        self,
        db: Session,
        user: User,
        queue_status: str | None = None,
        profile_id: uuid.UUID | None = None,
        platform: str | None = None,
        scheduled_from: datetime | None = None,
        scheduled_to: datetime | None = None,
        search: str | None = None,
    ) -> list[PublishingQueueItem]:
        self.sync_rendered_workflows_to_queue(db, user)
        query = db.query(PublishingQueueItem).join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
        if not self.is_system_user(user):
            query = query.filter(SocialProfile.user_id == user.id)
        if profile_id:
            query = query.filter(PublishingQueueItem.profile_id == profile_id)
        if platform:
            query = query.filter(PublishingQueueItem.platform == platform.strip().lower())
        query = self.apply_queue_filters(
            query,
            queue_status=queue_status,
            scheduled_from=scheduled_from,
            scheduled_to=scheduled_to,
            search=search,
        )
        return query.order_by(PublishingQueueItem.scheduled_at.asc(), PublishingQueueItem.created_at.desc()).all()

    def apply_queue_filters(
        self,
        query,
        *,
        queue_status: str | None = None,
        scheduled_from: datetime | None = None,
        scheduled_to: datetime | None = None,
        search: str | None = None,
    ):
        if queue_status == "upcoming":
            query = query.filter(PublishingQueueItem.status.in_(["queued", "approved", "publishing"]))
        elif queue_status:
            query = query.filter(PublishingQueueItem.status == queue_status)
        if scheduled_from:
            query = query.filter(PublishingQueueItem.scheduled_at >= scheduled_from)
        if scheduled_to:
            query = query.filter(PublishingQueueItem.scheduled_at < scheduled_to)
        term = (search or "").strip()
        if term:
            pattern = f"%{term}%"
            query = query.filter(
                or_(
                    PublishingQueueItem.article_title.ilike(pattern),
                    PublishingQueueItem.generated_content.ilike(pattern),
                    PublishingQueueItem.ai_reason.ilike(pattern),
                    SocialProfile.profile_name.ilike(pattern),
                    SocialProfile.username.ilike(pattern),
                )
            )
        return query

    def get_owned_queue_item(self, db: Session, queue_item_id: uuid.UUID, user: User) -> PublishingQueueItem:
        query = (
            db.query(PublishingQueueItem)
            .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
            .filter(PublishingQueueItem.id == queue_item_id)
        )
        if not self.is_system_user(user):
            query = query.filter(SocialProfile.user_id == user.id)
        item = query.first()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy queue item")
        return item

    def update_queue_status(self, db: Session, queue_item_id: uuid.UUID, user: User, next_status: str) -> PublishingQueueItem:
        if next_status == "approved":
            return self.approve_queue_item(db, queue_item_id, user)
        if next_status not in {"queued", "needs_approval", "approved", "skipped", "changes_requested"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Trạng thái queue không hợp lệ")
        item = (
            db.query(PublishingQueueItem)
            .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
            .filter(PublishingQueueItem.id == queue_item_id)
            .first()
        )
        if item and not self.is_system_user(user) and item.profile.user_id != user.id:
            item = None
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy queue item")
        if item.status in {"published", "skipped"} and next_status != item.status:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Queue item đã kết thúc không thể chuyển lại trạng thái duyệt")
        if next_status in {"queued", "approved"}:
            self.require_queue_draft_ready(db, item, user)
        item.status = next_status
        if next_status == "changes_requested":
            self.mark_queue_workflow_changes_requested(
                db,
                item,
                user,
                note="Reviewer yêu cầu chỉnh sửa trước khi duyệt.",
            )
        db.commit()
        db.refresh(item)
        return item

    def request_queue_item_changes(
        self,
        db: Session,
        queue_item_id: uuid.UUID,
        user: User,
        *,
        note: str | None = None,
    ) -> PublishingQueueItem:
        item = self.get_owned_queue_item(db, queue_item_id, user)
        if item.status in {"published", "skipped"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Queue item này đã kết thúc, không thể yêu cầu chỉnh sửa")
        item.status = "changes_requested"
        item.error = None
        message = (note or "").strip() or "Reviewer yêu cầu chỉnh sửa trước khi duyệt."
        item.ai_reason = _append_human_note(item.ai_reason, message)
        db.add(item)
        self.mark_queue_workflow_changes_requested(db, item, user, note=message)
        db.commit()
        db.refresh(item)
        return item

    def find_workflow_for_queue_item(
        self,
        db: Session,
        item: PublishingQueueItem,
        user: User,
    ) -> MediaWorkflow | None:
        query = db.query(MediaWorkflow).filter(MediaWorkflow.metadata_json["queued_post_id"].astext == str(item.id))
        if not self.is_system_user(user):
            query = query.filter(MediaWorkflow.user_id == user.id)
        workflow = query.order_by(MediaWorkflow.updated_at.desc()).first()
        if workflow:
            return workflow

        if not item.content_id:
            return None
        fallback_query = db.query(MediaWorkflow).filter(
            MediaWorkflow.profile_id == item.profile_id,
            MediaWorkflow.primary_content_id == item.content_id,
            MediaWorkflow.status.in_(["RENDERED", "VIDEO_APPROVED", "QUEUED_FOR_PUBLISHING", "PUBLISHED"]),
        )
        if not self.is_system_user(user):
            fallback_query = fallback_query.filter(MediaWorkflow.user_id == user.id)
        return fallback_query.order_by(MediaWorkflow.updated_at.desc()).first()

    def mark_queue_workflow_changes_requested(
        self,
        db: Session,
        item: PublishingQueueItem,
        user: User,
        *,
        note: str | None = None,
    ) -> None:
        workflow = self.find_workflow_for_queue_item(db, item, user)
        if not workflow or workflow.status == "REJECTED":
            return

        requested_at = datetime.now(timezone.utc).isoformat()
        metadata = dict(workflow.metadata_json or {})
        previous_review = metadata.get("module4_review") if isinstance(metadata.get("module4_review"), dict) else {}
        metadata["video_approved"] = False
        metadata.pop("video_approved_at", None)
        metadata.pop("video_approved_by", None)
        metadata["changes_requested_at"] = requested_at
        metadata["changes_requested_by"] = str(user.id)
        metadata["changes_requested_note"] = (note or "").strip() or "Reviewer yêu cầu chỉnh sửa trước khi duyệt."
        metadata["module4_review"] = {
            "decision": "changes_requested",
            "mode": "manual",
            "reviewed_by": str(user.id),
            "reviewed_at": requested_at,
            "note": metadata["changes_requested_note"],
            "previous_decision": previous_review.get("decision"),
        }
        workflow.metadata_json = metadata
        workflow.status = "EDITING"
        workflow.current_stage = "EDITING"
        db.add(workflow)

    def require_queue_draft_ready(self, db: Session, item: PublishingQueueItem, user: User) -> None:
        """Recheck the linked AUTO draft even for items queued before a later edit."""
        workflow = self.find_workflow_for_queue_item(db, item, user)
        if not workflow or not is_auto_workflow(workflow.metadata_json):
            return
        story = workflow.draft_json if isinstance(workflow.draft_json, dict) else {}
        if workflow.status == "REJECTED" or not auto_production_allowed(workflow.metadata_json, story):
            raise HTTPException(status_code=409, detail="Draft của video cần được duyệt lại trước khi lên lịch hoặc đăng bài.")
        artifacts = workflow.artifacts_jsonb if isinstance(workflow.artifacts_jsonb, list) else []
        final_video = next((artifact.get("uri") for artifact in reversed(artifacts) if isinstance(artifact, dict) and artifact.get("status") != "STALE" and (artifact.get("type") or artifact.get("artifact_type")) == "FINAL_VIDEO" and artifact.get("uri")), None)
        if not final_video:
            final_video = (story.get("video_artifacts") or {}).get("final") or (workflow.metadata_json or {}).get("rendered_video")
        if not final_video or str(item.article_link or "") != str(final_video):
            raise HTTPException(status_code=409, detail="Video trong queue không còn khớp draft hiện tại. Hãy render và đưa video mới vào queue.")

    def approve_and_publish_queue_item_now(
        self,
        db: Session,
        queue_item_id: uuid.UUID,
        user: User,
        *,
        mode: str = "direct",
        privacy_level: str | None = None,
        disable_comment: bool = False,
        disable_duet: bool = False,
        disable_stitch: bool = False,
        is_aigc: bool = True,
        brand_content_toggle: bool = False,
        brand_organic_toggle: bool = False,
    ) -> dict:
        item = self.get_owned_queue_item(db, queue_item_id, user)
        self.require_queue_draft_ready(db, item, user)
        if item.status in {"published", "skipped"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Queue item này đã kết thúc, không thể đăng ngay")
        item.status = "approved"
        item.scheduled_at = datetime.now(timezone.utc)
        item.error = None
        item.ai_reason = _append_human_note(item.ai_reason, "Reviewer đã duyệt và chọn đăng ngay.")
        db.add(item)
        db.commit()
        return self.publish_queue_item_to_tiktok(
            db,
            queue_item_id,
            user,
            source="manual_approval",
            mode=mode,
            privacy_level=privacy_level,
            disable_comment=disable_comment,
            disable_duet=disable_duet,
            disable_stitch=disable_stitch,
            is_aigc=is_aigc,
            brand_content_toggle=brand_content_toggle,
            brand_organic_toggle=brand_organic_toggle,
        )

    def approve_queue_item(self, db: Session, queue_item_id: uuid.UUID, user: User) -> PublishingQueueItem:
        """Approve without reserving a slot or starting an upload, including old queued items."""
        item = self.get_owned_queue_item(db, queue_item_id, user)
        if item.status in {"publishing", "published", "skipped", "rejected"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bài đang đăng hoặc đã kết thúc không thể duyệt lại")
        self.require_queue_draft_ready(db, item, user)
        item.status = "approved"
        # Old queue entries may already have an automatically assigned time.
        # A plain approval must never make such an entry eligible for publishing.
        item.scheduled_at = None
        item.error = None
        item.ai_reason = _append_human_note(item.ai_reason, "Reviewer đã duyệt video, chưa lên lịch đăng.")
        db.add(item)
        self.mark_queue_workflow_approved(db, item, user)
        db.commit()
        db.refresh(item)
        return item

    def mark_queue_workflow_approved(self, db: Session, item: PublishingQueueItem, user: User, *, record_review: bool = True) -> None:
        workflow = self.find_workflow_for_queue_item(db, item, user)
        if not workflow or workflow.status == "REJECTED":
            return
        reviewed_at = datetime.now(timezone.utc).isoformat()
        metadata = dict(workflow.metadata_json or {})
        # Selecting a time for an approved video must preserve who approved it,
        # including an automatic approval performed by the render worker.
        if record_review or not metadata.get("video_approved"):
            metadata.update(video_approved=True, video_approved_at=reviewed_at, video_approved_by=str(user.id))
            metadata["module4_review"] = {
                "decision": "approved", "mode": "manual", "reviewed_by": str(user.id), "reviewed_at": reviewed_at,
            }
        metadata["queued_post_id"] = str(item.id)
        metadata["module4_queue"] = {
            "status": item.status,
            "scheduled_at": item.scheduled_at.isoformat() if item.scheduled_at else None,
            "reason": item.ai_reason,
        }
        workflow.metadata_json = metadata
        workflow.status = "QUEUED_FOR_PUBLISHING" if item.scheduled_at else "VIDEO_APPROVED"
        workflow.current_stage = "QUEUED_FOR_PUBLISHING" if item.scheduled_at else "VIDEO_APPROVED"
        db.add(workflow)

    def approve_and_schedule_queue_item(
        self,
        db: Session,
        queue_item_id: uuid.UUID,
        user: User,
        *,
        schedule_mode: str = "manual",
        scheduled_at: datetime | None = None,
        timezone_name: str | None = None,
    ) -> PublishingQueueItem:
        item = self.get_owned_queue_item(db, queue_item_id, user)
        self.require_queue_draft_ready(db, item, user)
        if item.status in {"publishing", "published", "skipped", "rejected"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Queue item này đã kết thúc, không thể lên lịch lại")
        if item.platform != "tiktok":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Luồng duyệt này chỉ hỗ trợ TikTok")
        if not item.profile:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Queue item thiếu thông tin profile")

        mode = (schedule_mode or "manual").strip().lower()
        already_approved = item.status in {"approved", "queued"}
        if mode not in {"ai", "manual"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schedule_mode phải là ai hoặc manual")

        tzinfo = self.resolve_schedule_timezone(timezone_name or getattr(item.profile.strategy, "schedule_timezone", None))
        if mode == "manual":
            lock_schedule_profile(db, item.profile_id)
            if scheduled_at is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scheduled_at bắt buộc khi chọn lịch thủ công")
            publish_at = self.normalize_scheduled_datetime(scheduled_at, tzinfo)
            reason = "Reviewer chọn lịch đăng thủ công cho video đã duyệt." if already_approved else "Reviewer đã duyệt và chọn lịch đăng thủ công."
        else:
            try:
                decision = choose_publish_schedule(db, item.profile, item, timezone_name=tzinfo.key)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
            publish_at = decision.scheduled_at
            reason = f"Reviewer chọn lịch cho video đã duyệt. {decision.reason}" if already_approved else f"Reviewer đã duyệt. {decision.reason}"

        now = datetime.now(timezone.utc)
        if publish_at <= now:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Thời gian đăng phải nằm trong tương lai")

        item.status = "approved"
        item.scheduled_at = publish_at
        item.error = None
        item.ai_reason = _append_human_note(item.ai_reason, reason)
        db.add(item)
        self.mark_queue_workflow_approved(db, item, user, record_review=not already_approved)
        db.commit()
        db.refresh(item)
        return item

    def resolve_schedule_timezone(self, timezone_name: str | None) -> ZoneInfo:
        return schedule_timezone(timezone_name)

    def normalize_scheduled_datetime(self, value: datetime, tzinfo: ZoneInfo) -> datetime:
        if value.tzinfo is None:
            value = value.replace(tzinfo=tzinfo)
        return value.astimezone(timezone.utc)

    def _tiktok_public_post_url(self, profile: SocialProfile, post_id: str | None, fallback: str | None = None) -> str | None:
        post_id = self._clean_tiktok_post_id(post_id)
        username = (profile.username or "").strip().lstrip("@")
        if post_id and username:
            return f"https://www.tiktok.com/@{username}/video/{post_id}"
        return fallback

    def _clean_tiktok_post_id(self, post_id: str | None) -> str | None:
        clean_post_id = str(post_id or "").strip().strip("[]").strip().strip("\"'")
        return clean_post_id or None

    def _tiktok_embed_url(self, post_id: str | None) -> str | None:
        post_id = self._clean_tiktok_post_id(post_id)
        if not post_id:
            return None
        return f"https://www.tiktok.com/player/v1/{post_id}?controls=1&description=1&music_info=1"

    def _upsert_direct_tiktok_social_post(
        self,
        db: Session,
        item: PublishingQueueItem,
        profile: SocialProfile,
        publish_id: str,
        post_id: str | None,
        published_at: datetime,
    ) -> SocialPost:
        query = db.query(SocialPost).filter(SocialPost.profile_id == profile.id)
        if post_id:
            query = query.filter(
                or_(
                    SocialPost.platform_post_id == post_id,
                    SocialPost.platform_publish_id == publish_id,
                )
            )
        else:
            query = query.filter(SocialPost.platform_publish_id == publish_id)
        post = query.first()
        post_url = self._tiktok_public_post_url(profile, post_id, item.article_link if post_id else None)
        if not post:
            post = SocialPost(
                profile_id=profile.id,
                title=self._social_post_title(item.article_title),
                post_url=post_url,
                platform_post_id=post_id,
                platform_publish_id=publish_id,
                caption=item.generated_content,
                status="published_to_tiktok",
                published_at=published_at,
            )
            db.add(post)
            db.flush()
            return post

        post.title = self._social_post_title(item.article_title, post.title)
        post.post_url = post_url or post.post_url
        if post_id:
            post.platform_post_id = post_id
        post.platform_publish_id = publish_id
        post.caption = item.generated_content or post.caption
        post.status = "published_to_tiktok"
        post.published_at = published_at
        db.add(post)
        return post

    def resolve_missing_tiktok_post_ids(
        self,
        db: Session,
        profile: SocialProfile,
        access_token: str | None = None,
        *,
        limit: int = 50,
    ) -> int:
        token = access_token or ensure_tiktok_access_token(profile)
        posts = (
            db.query(SocialPost)
            .filter(
                SocialPost.profile_id == profile.id,
                SocialPost.platform_post_id.is_(None),
                SocialPost.platform_publish_id.isnot(None),
            )
            .order_by(SocialPost.created_at.desc())
            .limit(limit)
            .all()
        )
        resolved = 0
        for post in posts:
            publish_id = (post.platform_publish_id or "").strip()
            if not publish_id:
                continue
            try:
                status_data = fetch_tiktok_publish_status(token, publish_id)
            except Exception as exc:
                logger.warning("Không thể kiểm tra TikTok post_id cho publish_id=%s: %s", publish_id, exc)
                continue
            post_id = extract_tiktok_public_post_id(status_data)
            if not post_id:
                continue
            post.platform_post_id = post_id
            post.post_url = self._tiktok_public_post_url(profile, post_id, post.post_url)
            post.status = "published_to_tiktok"
            db.add(post)

            queue_item = (
                db.query(PublishingQueueItem)
                .filter(
                    PublishingQueueItem.profile_id == profile.id,
                    PublishingQueueItem.platform_publish_id == publish_id,
                )
                .first()
            )
            if queue_item:
                queue_item.publish_status_jsonb = status_data
                queue_item.status = "published"
                queue_item.error = None
                if not queue_item.published_at:
                    queue_item.published_at = post.published_at
                queue_item.ai_reason = f"TikTok đã trả post_id sau khi public/moderation. publish_id={publish_id}; post_id={post_id}"
                db.add(queue_item)
            resolved += 1
        return resolved

    def _complete_direct_tiktok_publish(
        self,
        db: Session,
        item: PublishingQueueItem,
        profile: SocialProfile,
        publish_id: str,
        status_data: dict,
        source: str,
    ) -> SocialPost | None:
        post_id = extract_tiktok_public_post_id(status_data)
        item.publish_status_jsonb = status_data
        item.platform_publish_id = publish_id
        published_at = datetime.utcnow()
        post = self._upsert_direct_tiktok_social_post(db, item, profile, publish_id, post_id, published_at)
        item.status = "published"
        item.published_at = published_at
        item.error = None
        if post_id:
            item.ai_reason = f"TikTok Direct Post đã hoàn tất ({source}). publish_id={publish_id}; post_id={post_id}"
        else:
            item.ai_reason = (
                f"TikTok Direct Post đã hoàn tất ({source}) nhưng TikTok chưa trả post_id. "
                f"Đã lưu SocialPost theo publish_id={publish_id}; post_id sẽ được bổ sung khi có dữ liệu."
            )
        db.add_all([item, post])
        return post

    def refresh_tiktok_publish_status(
        self,
        db: Session,
        item: PublishingQueueItem,
        source: str = "poller",
        *,
        poll_attempts: int = 1,
        poll_interval_seconds: float = 0,
    ) -> dict:
        profile = item.profile
        self.ensure_tiktok_profile(profile)
        publish_id = (item.platform_publish_id or "").strip()
        if not publish_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Queue item chưa có TikTok publish_id để kiểm tra")

        token = ensure_tiktok_access_token(profile)
        status_data = (
            poll_tiktok_publish_status(token, publish_id, max_attempts=poll_attempts, interval_seconds=poll_interval_seconds)
            if poll_attempts > 1
            else fetch_tiktok_publish_status(token, publish_id)
        )
        item.publish_status_jsonb = status_data
        status_value = tiktok_publish_status_value(status_data) or "UNKNOWN"

        post = None
        if tiktok_publish_is_complete(status_data):
            post = self._complete_direct_tiktok_publish(db, item, profile, publish_id, status_data, source)
        elif tiktok_publish_is_failed(status_data):
            item.status = "failed"
            item.error = tiktok_publish_failure_reason(status_data) or f"TikTok publish failed: {status_value}"
            item.ai_reason = f"TikTok Direct Post thất bại ({source}). publish_id={publish_id}; status={status_value}"
            db.add(item)
        else:
            item.status = "publishing"
            item.error = None
            item.ai_reason = f"TikTok Direct Post đang xử lý ({source}). publish_id={publish_id}; status={status_value}"
            db.add(item)

        db.commit()
        db.refresh(item)
        if post:
            db.refresh(post)
        return {
            "queue_item": self.serialize_queue_item(item),
            "post": self.serialize_post(post) if post else None,
            "tiktok": {
                "publish_id": publish_id,
                "post_id": extract_tiktok_public_post_id(status_data),
                "mode": "direct",
                "status": status_data,
            },
        }

    def finalize_tiktok_publish_statuses(self, db: Session, limit: int = 10) -> dict[str, int]:
        result = {"checked": 0, "completed": 0, "failed": 0, "pending": 0}
        items = (
            db.query(PublishingQueueItem)
            .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
            .filter(
                PublishingQueueItem.platform == "tiktok",
                PublishingQueueItem.status == "publishing",
                PublishingQueueItem.platform_publish_id.isnot(None),
                SocialProfile.status == "active",
                SocialProfile.access_token.isnot(None),
            )
            .order_by(PublishingQueueItem.updated_at.asc(), PublishingQueueItem.created_at.asc())
            .limit(limit)
            .all()
        )
        for item in items:
            result["checked"] += 1
            try:
                response = self.refresh_tiktok_publish_status(db, item, "poller")
                status_data = response.get("tiktok", {}).get("status") or {}
                if tiktok_publish_is_complete(status_data) and response.get("post"):
                    result["completed"] += 1
                elif tiktok_publish_is_failed(status_data):
                    result["failed"] += 1
                else:
                    result["pending"] += 1
            except Exception as exc:
                db.rollback()
                logger.exception("TikTok publish status polling failed queue_item_id=%s: %s", item.id, exc)
                result["failed"] += 1
        return result

    async def sync_recent_tiktok_post_metrics(
        self,
        db: Session,
        *,
        since_days: int = 30,
        batch_size: int = 20,
    ) -> dict[str, int]:
        since = datetime.now(timezone.utc) - timedelta(days=since_days)
        posts = (
            db.query(SocialPost)
            .join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
            .filter(
                SocialProfile.platform == "tiktok",
                SocialProfile.status == "active",
                SocialProfile.access_token.isnot(None),
                SocialPost.platform_post_id.isnot(None),
                SocialPost.published_at >= since,
            )
            .order_by(SocialPost.published_at.desc())
            .all()
        )
        result = {"profiles": 0, "videos": 0, "metrics": 0, "failed": 0}
        posts_by_profile: dict[uuid.UUID, list[SocialPost]] = {}
        for post in posts:
            posts_by_profile.setdefault(post.profile_id, []).append(post)

        for profile_id, profile_posts in posts_by_profile.items():
            profile = db.get(SocialProfile, profile_id)
            if not profile:
                continue
            result["profiles"] += 1
            try:
                access_token = ensure_tiktok_access_token(profile)
                for offset in range(0, len(profile_posts), batch_size):
                    batch = profile_posts[offset:offset + batch_size]
                    ids = [str(post.platform_post_id) for post in batch if post.platform_post_id]
                    if not ids:
                        continue
                    video_data = await fetch_tiktok_video_stats(access_token, ids)
                    videos = video_data.get("videos") if isinstance(video_data, dict) else []
                    videos_by_id = {
                        str(video.get("id")): video
                        for video in videos
                        if isinstance(video, dict) and video.get("id")
                    }
                    for post in batch:
                        video = videos_by_id.get(str(post.platform_post_id))
                        if not video:
                            continue
                        if video.get("share_url"):
                            post.post_url = video.get("share_url")
                        if video.get("title") or video.get("video_description"):
                            post.title = self._social_post_title(video.get("title") or video.get("video_description"), post.title)
                            post.caption = video.get("video_description") or post.caption
                        metric = SocialPostMetric(
                            post_id=post.id,
                            views=int(video.get("view_count") or 0),
                            likes=int(video.get("like_count") or 0),
                            comments=int(video.get("comment_count") or 0),
                            shares=int(video.get("share_count") or 0),
                            captured_at=datetime.now(timezone.utc),
                        )
                        db.add_all([post, metric])
                        result["videos"] += 1
                        result["metrics"] += 1
                    db.commit()
            except Exception as exc:
                db.rollback()
                logger.exception("TikTok video analytics sync failed profile_id=%s: %s", profile_id, exc)
                result["failed"] += 1
        return result

    def publish_queue_item_to_tiktok(
        self,
        db: Session,
        queue_item_id: uuid.UUID,
        user: User,
        source: str = "manual",
        mode: str = "inbox",
        privacy_level: str | None = None,
        disable_comment: bool = False,
        disable_duet: bool = False,
        disable_stitch: bool = False,
        is_aigc: bool = True,
        brand_content_toggle: bool = False,
        brand_organic_toggle: bool = False,
    ) -> dict:
        if mode not in {"inbox", "direct"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mode phải là inbox hoặc direct")
        item = (
            db.query(PublishingQueueItem)
            .join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
            .filter(PublishingQueueItem.id == queue_item_id)
            .first()
        )
        if item and not self.is_system_user(user) and item.profile.user_id != user.id:
            item = None
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy queue item")
        if item.status in {"published", "skipped"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Queue item này đã kết thúc")
        allowed_statuses = {"queued", "approved", "publishing", "failed"}
        if source == "manual":
            allowed_statuses.add("needs_approval")
        if item.status not in allowed_statuses:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Queue item chưa sẵn sàng để đăng")

        profile = item.profile
        self.ensure_tiktok_profile(profile)
        mode = self.resolve_tiktok_publish_mode(profile, mode)
        if item.status == "publishing" and item.platform_publish_id and mode == "direct":
            return self.refresh_tiktok_publish_status(db, item, "manual", poll_attempts=3, poll_interval_seconds=5)
        self.require_queue_draft_ready(db, item, user)
        video_path = self.resolve_rendered_video_path(item.article_link)
        action_label = "đăng trực tiếp" if mode == "direct" else "gửi inbox"
        item.status = "publishing"
        item.error = None
        item.ai_reason = f"Đang {action_label} TikTok bằng API ({source})."
        db.add(item)
        db.commit()
        db.refresh(item)
        try:
            if mode == "direct":
                result = direct_post_video_to_tiktok(
                    profile,
                    video_path,
                    caption=item.generated_content,
                    privacy_level=privacy_level,
                    disable_comment=disable_comment,
                    disable_duet=disable_duet,
                    disable_stitch=disable_stitch,
                    is_aigc=is_aigc,
                    brand_content_toggle=brand_content_toggle,
                    brand_organic_toggle=brand_organic_toggle,
                )
            else:
                result = upload_video_to_tiktok_inbox(profile, video_path)
        except HTTPException as error:
            item.status = "failed"
            item.error = str(error.detail)
            db.add(item)
            db.commit()
            db.refresh(item)
            raise
        except Exception as error:
            item.status = "failed"
            item.error = str(error)
            db.add(item)
            db.commit()
            db.refresh(item)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error

        publish_id = result["publish_id"]
        status_data = result.get("status") or {}
        item.platform_publish_id = publish_id
        item.publish_status_jsonb = status_data
        now = datetime.utcnow()

        if mode == "direct" and not (tiktok_publish_is_complete(status_data) or tiktok_publish_is_failed(status_data)):
            status_data = poll_tiktok_publish_status(ensure_tiktok_access_token(profile), publish_id, max_attempts=3, interval_seconds=5)
            item.publish_status_jsonb = status_data

        if mode == "direct" and tiktok_publish_is_failed(status_data):
            status_value = tiktok_publish_status_value(status_data) or "UNKNOWN"
            item.status = "failed"
            item.error = tiktok_publish_failure_reason(status_data) or f"TikTok publish failed: {status_value}"
            item.ai_reason = f"TikTok Direct Post thất bại ({source}). publish_id={publish_id}; status={status_value}"
            db.add_all([profile, item])
            db.commit()
            db.refresh(item)
            return {
                "queue_item": self.serialize_queue_item(item),
                "post": None,
                "tiktok": {
                    "publish_id": publish_id,
                    "post_id": None,
                    "mode": mode,
                    "privacy_level": result.get("privacy_level"),
                    "status": status_data,
                    "video_size": result.get("video_size"),
                },
            }

        post = None
        if mode == "direct":
            if tiktok_publish_is_complete(status_data):
                post = self._complete_direct_tiktok_publish(db, item, profile, publish_id, status_data, source)
            if not post and not tiktok_publish_is_complete(status_data):
                item.status = "publishing"
                item.published_at = None
                item.error = None
                item.ai_reason = f"TikTok Direct Post đang xử lý ({source}). publish_id={publish_id}; status={tiktok_publish_status_value(status_data) or 'UNKNOWN'}"
        else:
            post = SocialPost(
                profile_id=profile.id,
                title=self._social_post_title(item.article_title),
                post_url=item.article_link,
                platform_post_id=None,
                platform_publish_id=publish_id,
                caption=item.generated_content,
                status="sent_to_tiktok_inbox",
                published_at=now,
            )
            item.status = "published"
            item.published_at = now
            item.error = None
            item.ai_reason = f"TikTok upload sent to creator inbox ({source}). publish_id={publish_id}; status={status_data.get('status') or 'UNKNOWN'}"
        db.add_all([profile, item])
        if post:
            db.add(post)
        db.commit()
        db.refresh(item)
        if post:
            db.refresh(post)
        return {
            "queue_item": self.serialize_queue_item(item),
            "post": self.serialize_post(post) if post else None,
            "tiktok": {
                "publish_id": publish_id,
                "post_id": extract_tiktok_public_post_id(status_data),
                "mode": mode,
                "privacy_level": result.get("privacy_level"),
                "status": status_data,
                "video_size": result.get("video_size"),
            },
        }

    def list_posts(self, db: Session, profile: SocialProfile) -> list[SocialPost]:
        return db.query(SocialPost).filter(SocialPost.profile_id == profile.id).order_by(SocialPost.published_at.desc(), SocialPost.created_at.desc()).all()

    def list_post_overview(self, db: Session, user: User) -> list[dict]:
        query = db.query(SocialPost).join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
        if not self.is_system_user(user):
            query = query.filter(SocialProfile.user_id == user.id)
        posts = query.order_by(SocialPost.published_at.desc(), SocialPost.created_at.desc()).all()
        groups: dict[str, dict] = {}
        for post in posts:
            title = post.title.strip() or "Untitled post"
            key = title.lower()
            group = groups.setdefault(
                key,
                {
                    "key": key,
                    "title": title,
                    "posts": [],
                    "chart_data": [],
                    "total_views": 0,
                    "account_count": 0,
                    "_profile_ids": set(),
                },
            )
            serialized = self.serialize_post(post)
            serialized["profile"] = self.serialize_profile(post.profile)
            latest_metric = serialized.get("latest_metric") or {}
            views = int(latest_metric.get("views") or 0)
            likes = int(latest_metric.get("likes") or 0)
            comments = int(latest_metric.get("comments") or 0)
            shares = int(latest_metric.get("shares") or 0)
            group["posts"].append(serialized)
            group["chart_data"].append(
                {
                    "account": post.profile.profile_name,
                    "profile_id": str(post.profile_id),
                    "post_id": str(post.id),
                    "views": views,
                    "likes": likes,
                    "comments": comments,
                    "shares": shares,
                }
            )
            group["total_views"] += views
            group["_profile_ids"].add(str(post.profile_id))

        result = []
        for group in groups.values():
            group["account_count"] = len(group.pop("_profile_ids"))
            result.append(group)
        return sorted(result, key=lambda item: item["total_views"], reverse=True)

    def create_post(self, db: Session, profile: SocialProfile, payload: schemas.SocialPostCreateRequest) -> SocialPost:
        if not payload.title.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="title không được để trống")
        title = self._social_post_title(payload.title)
        post = SocialPost(
            profile_id=profile.id,
            title=title,
            post_url=payload.post_url.strip() if payload.post_url else None,
            platform_post_id=payload.platform_post_id.strip() if payload.platform_post_id else None,
            caption=payload.caption,
            status=payload.status,
            published_at=payload.published_at or datetime.utcnow(),
        )
        db.add(post)
        db.commit()
        db.refresh(post)
        return post

    def delete_post(self, db: Session, post_id: uuid.UUID, user: User) -> None:
        post = (
            db.query(SocialPost)
            .join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
            .filter(SocialPost.id == post_id)
            .first()
        )
        if post and not self.is_system_user(user) and post.profile.user_id != user.id:
            post = None
        if not post:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy bài đăng")
        db.delete(post)
        db.commit()

    def create_metric(self, db: Session, post_id: uuid.UUID, user: User, payload: schemas.SocialPostMetricCreateRequest) -> SocialPostMetric:
        post = (
            db.query(SocialPost)
            .join(SocialProfile, SocialProfile.id == SocialPost.profile_id)
            .filter(SocialPost.id == post_id)
            .first()
        )
        if post and not self.is_system_user(user) and post.profile.user_id != user.id:
            post = None
        if not post:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy bài đăng")
        metric = SocialPostMetric(
            post_id=post.id,
            views=max(payload.views, 0),
            likes=max(payload.likes, 0),
            comments=max(payload.comments, 0),
            shares=max(payload.shares, 0),
            captured_at=payload.captured_at or datetime.utcnow(),
        )
        db.add(metric)
        db.commit()
        db.refresh(metric)
        return metric

    def serialize_profile(self, profile: SocialProfile) -> dict:
        metadata = getattr(profile, "metadata_json", None) or {}
        user_metadata = metadata.get("user") if isinstance(metadata, dict) else {}
        if not isinstance(user_metadata, dict):
            user_metadata = {}
        data = {
            "id": profile.id,
            "platform": profile.platform,
            "profile_name": profile.profile_name,
            "username": profile.username,
            "external_id": getattr(profile, "external_id", None),
            "avatar_url": getattr(profile, "avatar_url", None),
            "follower_count": getattr(profile, "follower_count", None) if getattr(profile, "follower_count", None) is not None else _optional_int(user_metadata.get("follower_count")),
            "following_count": getattr(profile, "following_count", None) if getattr(profile, "following_count", None) is not None else _optional_int(user_metadata.get("following_count")),
            "likes_count": getattr(profile, "likes_count", None) if getattr(profile, "likes_count", None) is not None else _optional_int(user_metadata.get("likes_count")),
            "video_count": getattr(profile, "video_count", None) if getattr(profile, "video_count", None) is not None else _optional_int(user_metadata.get("video_count")),
            "status": profile.status,
            "scopes": _scope_list(getattr(profile, "scopes_jsonb", None)),
            "metadata": metadata,
            "token_expires_at": getattr(profile, "token_expires_at", None),
            "refresh_expires_at": getattr(profile, "refresh_expires_at", None),
            "created_at": profile.created_at,
        }
        if profile.strategy:
            data["strategy"] = self.serialize_strategy(profile.strategy)
        return data

    def serialize_strategy(self, strategy: SocialProfileStrategy) -> dict:
        return {
            "id": strategy.id,
            "content_topics": strategy.content_topics,
            "content_topic_descriptions": self.prune_topic_descriptions(strategy.content_topics, strategy.content_topic_descriptions),
            "content_topic_details": self.serialize_strategy_topic_details(strategy.content_topics, strategy.content_topic_descriptions),
            "avoid_topics": strategy.avoid_topics,
            "avoid_topic_descriptions": self.prune_topic_descriptions(strategy.avoid_topics, strategy.avoid_topic_descriptions),
            "avoid_topic_details": self.serialize_strategy_topic_details(strategy.avoid_topics, strategy.avoid_topic_descriptions),
            "tone": strategy.tone,
            "target_audience": strategy.target_audience,
            "post_frequency_per_day": strategy.post_frequency_per_day,
            "active_hours": strategy.active_hours,
            "schedule_days": strategy.schedule_days,
            "schedule_times": strategy.schedule_times,
            "schedule_timezone": strategy.schedule_timezone,
            "approval_mode": strategy.approval_mode,
            "risk_level": strategy.risk_level,
            "min_similarity": getattr(strategy, "min_similarity", 0.62),
            "avoid_similarity_threshold": getattr(strategy, "avoid_similarity_threshold", 0.72),
            "require_video": strategy.require_video,
            "receive_system_content": getattr(strategy, "receive_system_content", True),
            "auto_project_queue_enabled": getattr(strategy, "auto_project_queue_enabled", False),
            "video_render_mode": getattr(strategy, "video_render_mode", "manual"),
            "max_system_recommendations": getattr(strategy, "max_system_recommendations", 20),
            "auto_queue_enabled": strategy.auto_queue_enabled,
            "auto_publish_enabled": strategy.auto_publish_enabled,
            "created_at": strategy.created_at,
            "updated_at": strategy.updated_at,
        }

    def serialize_strategy_topic_details(self, raw_topics: str | None, raw_descriptions: dict | None = None) -> list[dict]:
        descriptions = self.normalize_topic_descriptions(raw_descriptions)
        details = []
        for topic in self.split_terms(raw_topics):
            topic_key = StrategyEmbeddingMatcher.topic_key(topic)
            custom_description = descriptions.get(topic_key)
            description = StrategyEmbeddingMatcher.topic_description(topic, custom_description)
            details.append(
                {
                    "topic": topic,
                    "topic_key": topic_key,
                    "description": description,
                    "embedding_text": StrategyEmbeddingMatcher.topic_embedding_text(topic, description),
                    "custom_description": bool(custom_description),
                }
            )
        return details

    @staticmethod
    def split_terms(value: str | None) -> list[str]:
        return [part.strip() for part in str(value or "").replace("\n", ",").split(",") if part.strip()]

    @staticmethod
    def normalize_topic_descriptions(value: dict | None) -> dict[str, str]:
        return StrategyEmbeddingMatcher.topic_descriptions_map(value)

    def prune_topic_descriptions(self, raw_topics: str | None, descriptions: dict | None) -> dict[str, str]:
        allowed_keys = {StrategyEmbeddingMatcher.topic_key(topic) for topic in self.split_terms(raw_topics)}
        return {
            key: value
            for key, value in self.normalize_topic_descriptions(descriptions).items()
            if key in allowed_keys and value
        }

    @staticmethod
    def normalize_topic_kind(kind: str | None) -> str:
        normalized = str(kind or "content").strip().lower()
        if normalized in {"content", "preferred", "content_topics"}:
            return "content"
        if normalized in {"avoid", "avoid_topics"}:
            return "avoid"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="kind phải là content hoặc avoid")

    def strategy_topic_state(self, strategy: SocialProfileStrategy, kind: str) -> tuple[str, dict[str, str]]:
        normalized = self.normalize_topic_kind(kind)
        if normalized == "avoid":
            return strategy.avoid_topics, self.prune_topic_descriptions(strategy.avoid_topics, strategy.avoid_topic_descriptions)
        return strategy.content_topics, self.prune_topic_descriptions(strategy.content_topics, strategy.content_topic_descriptions)

    def apply_strategy_topic_state(
        self,
        strategy: SocialProfileStrategy,
        kind: str,
        topics: list[str],
        descriptions: dict[str, str],
    ) -> None:
        topic_text = ", ".join(self.dedupe_topics(topics))
        pruned_descriptions = self.prune_topic_descriptions(topic_text, descriptions)
        if self.normalize_topic_kind(kind) == "avoid":
            strategy.avoid_topics = topic_text
            strategy.avoid_topic_descriptions = pruned_descriptions
        else:
            strategy.content_topics = topic_text
            strategy.content_topic_descriptions = pruned_descriptions

    @staticmethod
    def dedupe_topics(topics: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for topic in topics:
            clean = str(topic or "").strip()
            key = StrategyEmbeddingMatcher.topic_key(clean)
            if clean and key not in seen:
                seen.add(key)
                result.append(clean)
        return result

    def serialize_queue_item(self, item: PublishingQueueItem) -> dict:
        return {
            "id": item.id,
            "profile_id": item.profile_id,
            "profile_name": item.profile.profile_name if item.profile else None,
            "profile_scopes": _scope_list(getattr(item.profile, "scopes_jsonb", None)) if item.profile else [],
            "content_id": item.content_id,
            "article_link": item.article_link,
            "article_title": item.article_title,
            "platform": item.platform,
            "generated_content": item.generated_content,
            "ai_reason": item.ai_reason,
            "status": item.status,
            "platform_publish_id": getattr(item, "platform_publish_id", None),
            "publish_status": getattr(item, "publish_status_jsonb", None) or {},
            "scheduled_at": item.scheduled_at,
            "published_at": item.published_at,
            "error": item.error,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }

    def serialize_post(self, post: SocialPost) -> dict:
        def metric_time(metric: SocialPostMetric) -> datetime:
            captured_at = metric.captured_at
            if captured_at.tzinfo is None or captured_at.tzinfo.utcoffset(captured_at) is None:
                return captured_at.replace(tzinfo=timezone.utc)
            return captured_at.astimezone(timezone.utc)

        metrics = sorted(post.metrics, key=metric_time)
        latest_metric = metrics[-1] if metrics else None
        now = datetime.now(timezone.utc)

        def metric_at_or_before(target_time: datetime):
            target = target_time if target_time.tzinfo else target_time.replace(tzinfo=timezone.utc)
            candidates = [metric for metric in metrics if metric_time(metric) <= target]
            return max(candidates, key=metric_time) if candidates else None

        def growth_since(delta: timedelta):
            if not latest_metric:
                return None
            baseline = metric_at_or_before(now - delta)
            return latest_metric.views - baseline.views if baseline else None

        return {
            "id": post.id,
            "profile_id": post.profile_id,
            "title": post.title,
            "post_url": post.post_url,
            "platform_post_id": self._clean_tiktok_post_id(post.platform_post_id) or post.platform_post_id,
            "platform_publish_id": getattr(post, "platform_publish_id", None),
            "tiktok_embed_url": self._tiktok_embed_url(post.platform_post_id),
            "caption": post.caption,
            "status": post.status,
            "published_at": post.published_at,
            "created_at": post.created_at,
            "latest_metric": self.serialize_metric(latest_metric) if latest_metric else None,
            "growth": {"views_1h": growth_since(timedelta(hours=1)), "views_24h": growth_since(timedelta(days=1)), "views_7d": growth_since(timedelta(days=7))},
            "metrics": [self.serialize_metric(metric) for metric in metrics],
        }

    def resolve_rendered_video_path(self, value: str | None) -> Path:
        raw = (value or "").strip()
        if not raw:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Queue item chưa có video để đăng")

        output_prefix = "/api/v1/generate-video/output/"
        if raw.startswith(output_prefix):
            raw = raw[len(output_prefix):]
        if raw.startswith("out/") or raw.startswith("out\\"):
            raw = raw[4:]

        candidate = Path(raw)
        if candidate.is_absolute():
            resolved = candidate.resolve()
        else:
            resolved = (video_pipeline.VIDEO_OUT_DIR / raw).resolve()

        output_root = video_pipeline.VIDEO_OUT_DIR.resolve()
        workspace_root = video_pipeline.RENDER_WORKSPACE_ROOT.resolve()
        if not (resolved.is_relative_to(output_root) or resolved.is_relative_to(workspace_root)):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Đường dẫn video không hợp lệ")
        if not resolved.exists() or not resolved.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy file video để đăng")
        return resolved

    def serialize_metric(self, metric: SocialPostMetric) -> dict:
        return {
            "id": metric.id,
            "views": metric.views,
            "likes": metric.likes,
            "comments": metric.comments,
            "shares": metric.shares,
            "captured_at": metric.captured_at,
        }

    def build_profile_identifier(self, user_id: uuid.UUID, platform: str, profile_name: str) -> str:
        profile_key = f"{self.slugify(profile_name)}-{uuid.uuid4().hex[:8]}"
        return f"api-profiles/user_{user_id}/{platform}/{profile_key}"

    def ensure_tiktok_profile(self, profile: SocialProfile) -> None:
        if profile.platform != "tiktok":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile này không phải TikTok")

    def resolve_tiktok_publish_mode(self, profile: SocialProfile, requested_mode: str) -> str:
        scopes = set(_scope_list(getattr(profile, "scopes_jsonb", None)))
        profile_name = getattr(profile, "profile_name", None) or "này"
        if requested_mode == "direct" and "video.publish" not in scopes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"TikTok profile {profile_name} chưa có scope video.publish trong token hiện tại. "
                    "Hãy quét QR/kết nối lại tài khoản để cấp quyền Direct Post."
                ),
            )
        if requested_mode == "inbox" and "video.upload" not in scopes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"TikTok profile {profile_name} chưa có scope video.upload trong token hiện tại. "
                    "Hãy quét QR/kết nối lại tài khoản để cấp quyền upload inbox."
                ),
            )
        return requested_mode

    def slugify(self, value: str) -> str:
        slug = "".join(character.lower() if character.isalnum() else "-" for character in value).strip("-")
        while "--" in slug:
            slug = slug.replace("--", "-")
        return slug or "profile"

    def normalize_schedule_days(self, value: str) -> str:
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

    def normalize_schedule_times(self, value: str) -> str:
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
        return ",".join(times)

    def is_system_user(self, user: User) -> bool:
        role_names = {role.name for role in user.roles}
        return bool(user.is_system_admin or "SYSTEM_ADMIN" in role_names or "ADMIN" in role_names)
