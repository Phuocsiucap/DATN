from __future__ import annotations

import uuid
import logging
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from common.db.models import PublishingQueueItem, SocialPost, SocialPostMetric, SocialProfile, SocialProfileStrategy, User
from app.schemas import api as schemas
from app.services.tiktok_qr import (
    BACKEND_SOCIAL_PROFILE_ROOT,
    SOCIAL_PROFILE_ROOT,
    WORKSPACE_ROOT,
    get_tiktok_qr_session,
    qr_image_data_url,
    refresh_tiktok_qr_session,
    start_tiktok_qr_session,
    stop_tiktok_qr_session,
)

logger = logging.getLogger(__name__)


class SocialProfileService:
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
            folder_path=self.build_profile_path(user.id, platform, profile_name),
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

    def delete_profile(self, db: Session, profile: SocialProfile) -> None:
        stop_tiktok_qr_session(str(profile.id), profile.user_id)
        self.delete_profile_folder(profile.folder_path)
        db.delete(profile)
        db.commit()

    def start_pending_tiktok_qr_login(self, user: User, payload: schemas.TikTokQrStartRequest) -> dict:
        session_id = uuid.uuid4().hex
        profile_name = (payload.profile_name or "TikTok account").strip() or "TikTok account"
        folder_path = self.build_profile_path(user.id, "tiktok", profile_name)
        session = start_tiktok_qr_session(session_id, folder_path, user.id)
        logger.info(
            "Started pending TikTok QR login session_id=%s user_id=%s folder_path=%s authenticated=%s",
            session_id,
            user.id,
            folder_path,
            session.is_authenticated(),
        )
        return {
            "session_id": session_id,
            "authenticated": session.is_authenticated(),
            "qr_image": qr_image_data_url(session),
            "page_url": session.page_url(),
        }

    def get_pending_tiktok_qr_status(
        self,
        db: Session,
        user: User,
        session_id: str,
        profile_name: str | None = None,
        username: str | None = None,
    ) -> dict:
        session = get_tiktok_qr_session(session_id, user.id)
        if not session:
            logger.info("Pending TikTok QR status session missing session_id=%s user_id=%s", session_id, user.id)
            return {"session_active": False, "authenticated": False, "profile": None}

        authenticated = session.is_authenticated()
        logger.info(
            "Pending TikTok QR status session_id=%s user_id=%s authenticated=%s page_url=%s cookies=%s",
            session_id,
            user.id,
            authenticated,
            session.page_url(),
            session.cookie_names(),
        )
        try:
            refreshed_session = refresh_tiktok_qr_session(session_id, user.id)
            qr_image = qr_image_data_url(refreshed_session)
        except RuntimeError:
            qr_image = None

        if not authenticated:
            return {
                "session_active": True,
                "authenticated": False,
                "profile": None,
                "page_url": session.page_url(),
                "qr_image": qr_image or qr_image_data_url(session),
            }

        final_profile_name = (profile_name or "TikTok account").strip() or "TikTok account"
        profile = SocialProfile(
            user_id=user.id,
            platform="tiktok",
            profile_name=final_profile_name,
            username=username.strip() if username else None,
            folder_path=self.to_runtime_folder_path(session.profile_dir),
            status="active",
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)
        page_url = session.page_url()
        logger.info(
            "Created TikTok profile from QR session_id=%s user_id=%s profile_id=%s folder_path=%s",
            session_id,
            user.id,
            profile.id,
            profile.folder_path,
        )
        stop_tiktok_qr_session(session_id, user.id)
        return {
            "session_active": False,
            "authenticated": True,
            "profile": self.serialize_profile(profile),
            "page_url": page_url,
            "qr_image": qr_image or qr_image_data_url(session),
        }

    def stop_pending_tiktok_qr_login(self, user: User, session_id: str) -> dict:
        stop_tiktok_qr_session(session_id, user.id)
        return {"message": "Đã đóng phiên QR TikTok"}

    def start_tiktok_qr_login(self, db: Session, profile: SocialProfile) -> dict:
        self.ensure_tiktok_profile(profile)
        session = start_tiktok_qr_session(str(profile.id), profile.folder_path, profile.user_id)
        profile.status = "qr_pending"
        db.commit()
        db.refresh(profile)
        return {
            "profile": self.serialize_profile(profile),
            "authenticated": session.is_authenticated(),
            "qr_image": qr_image_data_url(session),
            "page_url": session.page_url(),
        }

    def get_tiktok_qr_status(self, db: Session, profile: SocialProfile) -> dict:
        self.ensure_tiktok_profile(profile)
        session = get_tiktok_qr_session(str(profile.id), profile.user_id)
        if not session:
            return {"profile": self.serialize_profile(profile), "session_active": False, "authenticated": False}

        authenticated = session.is_authenticated()
        if authenticated and profile.status != "active":
            profile.status = "active"
            db.commit()
            db.refresh(profile)
        if authenticated:
            page_url = session.page_url()
            stop_tiktok_qr_session(str(profile.id), profile.user_id)
            return {
                "profile": self.serialize_profile(profile),
                "session_active": False,
                "authenticated": True,
                "page_url": page_url,
                "qr_image": None,
            }

        try:
            refreshed_session = refresh_tiktok_qr_session(str(profile.id), profile.user_id)
            qr_image = qr_image_data_url(refreshed_session)
        except RuntimeError:
            qr_image = None

        return {
            "profile": self.serialize_profile(profile),
            "session_active": True,
            "authenticated": authenticated,
            "page_url": session.page_url(),
            "qr_image": qr_image or qr_image_data_url(session),
        }

    def stop_tiktok_qr_login(self, db: Session, profile: SocialProfile) -> dict:
        self.ensure_tiktok_profile(profile)
        stop_tiktok_qr_session(str(profile.id), profile.user_id)
        if profile.status == "qr_pending":
            profile.status = "inactive"
            db.commit()
            db.refresh(profile)
        return {"message": "Đã đóng phiên QR", "profile": self.serialize_profile(profile)}

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
        for field, value in payload.model_dump(exclude_unset=True).items():
            if field == "post_frequency_per_day" and value is not None:
                value = max(int(value), 1)
            elif field == "min_score" and value is not None:
                value = max(0.0, min(float(value), 100.0))
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

        if strategy.approval_mode != "auto":
            strategy.auto_publish_enabled = False
        db.commit()
        db.refresh(strategy)
        return strategy

    def list_profile_queue(self, db: Session, profile: SocialProfile, queue_status: str | None = None) -> list[PublishingQueueItem]:
        query = db.query(PublishingQueueItem).filter(PublishingQueueItem.profile_id == profile.id)
        if queue_status:
            query = query.filter(PublishingQueueItem.status == queue_status)
        return query.order_by(PublishingQueueItem.scheduled_at.asc(), PublishingQueueItem.created_at.desc()).all()

    def list_user_queue(self, db: Session, user: User, queue_status: str | None = None) -> list[PublishingQueueItem]:
        query = db.query(PublishingQueueItem).join(SocialProfile, SocialProfile.id == PublishingQueueItem.profile_id)
        if not self.is_system_user(user):
            query = query.filter(SocialProfile.user_id == user.id)
        if queue_status == "upcoming":
            query = query.filter(PublishingQueueItem.status.in_(["queued", "approved"]))
        elif queue_status:
            query = query.filter(PublishingQueueItem.status == queue_status)
        return query.order_by(PublishingQueueItem.scheduled_at.asc(), PublishingQueueItem.created_at.desc()).all()

    def update_queue_status(self, db: Session, queue_item_id: uuid.UUID, user: User, next_status: str) -> PublishingQueueItem:
        if next_status not in {"queued", "needs_approval", "approved", "skipped"}:
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
        item.status = next_status
        db.commit()
        db.refresh(item)
        return item

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
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="title không được để trống")
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
        data = {
            "id": profile.id,
            "platform": profile.platform,
            "profile_name": profile.profile_name,
            "username": profile.username,
            "folder_path": profile.folder_path,
            "status": profile.status,
            "created_at": profile.created_at,
        }
        if profile.strategy:
            data["strategy"] = self.serialize_strategy(profile.strategy)
        return data

    def serialize_strategy(self, strategy: SocialProfileStrategy) -> dict:
        return {
            "id": strategy.id,
            "content_topics": strategy.content_topics,
            "avoid_topics": strategy.avoid_topics,
            "tone": strategy.tone,
            "target_audience": strategy.target_audience,
            "post_frequency_per_day": strategy.post_frequency_per_day,
            "active_hours": strategy.active_hours,
            "schedule_enabled": strategy.schedule_enabled,
            "schedule_days": strategy.schedule_days,
            "schedule_times": strategy.schedule_times,
            "schedule_timezone": strategy.schedule_timezone,
            "approval_mode": strategy.approval_mode,
            "risk_level": strategy.risk_level,
            "min_score": strategy.min_score,
            "require_video": strategy.require_video,
            "receive_system_content": getattr(strategy, "receive_system_content", True),
            "auto_project_queue_enabled": getattr(strategy, "auto_project_queue_enabled", False),
            "auto_planning_enabled": getattr(strategy, "auto_planning_enabled", False),
            "video_render_mode": getattr(strategy, "video_render_mode", "manual"),
            "max_system_recommendations": getattr(strategy, "max_system_recommendations", 20),
            "auto_queue_enabled": strategy.auto_queue_enabled,
            "auto_publish_enabled": strategy.auto_publish_enabled,
            "created_at": strategy.created_at,
            "updated_at": strategy.updated_at,
        }

    def serialize_queue_item(self, item: PublishingQueueItem) -> dict:
        return {
            "id": item.id,
            "profile_id": item.profile_id,
            "profile_name": item.profile.profile_name if item.profile else None,
            "article_link": item.article_link,
            "article_title": item.article_title,
            "platform": item.platform,
            "generated_content": item.generated_content,
            "ai_reason": item.ai_reason,
            "status": item.status,
            "scheduled_at": item.scheduled_at,
            "published_at": item.published_at,
            "error": item.error,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }

    def serialize_post(self, post: SocialPost) -> dict:
        metrics = sorted(post.metrics, key=lambda metric: metric.captured_at)
        latest_metric = metrics[-1] if metrics else None
        now = datetime.utcnow()

        def metric_at_or_before(target_time: datetime):
            candidates = [metric for metric in metrics if metric.captured_at <= target_time]
            return max(candidates, key=lambda metric: metric.captured_at) if candidates else None

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
            "platform_post_id": post.platform_post_id,
            "caption": post.caption,
            "status": post.status,
            "published_at": post.published_at,
            "created_at": post.created_at,
            "latest_metric": self.serialize_metric(latest_metric) if latest_metric else None,
            "growth": {"views_1h": growth_since(timedelta(hours=1)), "views_24h": growth_since(timedelta(days=1)), "views_7d": growth_since(timedelta(days=7))},
            "metrics": [self.serialize_metric(metric) for metric in metrics],
        }

    def serialize_metric(self, metric: SocialPostMetric) -> dict:
        return {
            "id": metric.id,
            "views": metric.views,
            "likes": metric.likes,
            "comments": metric.comments,
            "shares": metric.shares,
            "captured_at": metric.captured_at,
        }

    def build_profile_path(self, user_id: uuid.UUID, platform: str, profile_name: str) -> str:
        profile_key = f"{self.slugify(profile_name)}-{uuid.uuid4().hex[:8]}"
        return str(Path("social_profile") / "accounts" / f"user_{user_id}" / platform / profile_key)

    def to_runtime_folder_path(self, profile_dir: Path) -> str:
        try:
            return str(profile_dir.resolve().relative_to(WORKSPACE_ROOT.resolve()))
        except ValueError:
            return str(profile_dir)

    def ensure_tiktok_profile(self, profile: SocialProfile) -> None:
        if profile.platform != "tiktok":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile này không phải TikTok")

    def delete_profile_folder(self, folder_path: str) -> None:
        folder = Path(folder_path)
        candidates = [folder.resolve()] if folder.is_absolute() else [
            (WORKSPACE_ROOT / folder).resolve(),
            (Path(__file__).resolve().parents[4] / folder).resolve(),
        ]
        allowed_roots = [SOCIAL_PROFILE_ROOT.resolve(), BACKEND_SOCIAL_PROFILE_ROOT.resolve()]
        target_dir = next(
            (
                candidate
                for candidate in candidates
                for allowed_root in allowed_roots
                if candidate.is_relative_to(allowed_root)
            ),
            None,
        )
        if not target_dir:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Đường dẫn profile không hợp lệ")
        if target_dir.exists():
            shutil.rmtree(target_dir)

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
        if not times:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="schedule_times không được để trống")
        return ",".join(times)

    def is_system_user(self, user: User) -> bool:
        role_names = {role.name for role in user.roles}
        return bool(user.is_system_admin or "SYSTEM_ADMIN" in role_names or "ADMIN" in role_names)
