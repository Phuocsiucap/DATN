from sqlalchemy import Column, Integer, String, Table, ForeignKey, Boolean, DateTime, Text, Float
from sqlalchemy.orm import relationship
from backend.user_service.app.core.database import Base
from datetime import datetime

# Association table for Many-to-Many relationship between Users and Roles
user_roles = Table(
    'user_roles',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id', ondelete="CASCADE"), primary_key=True),
    Column('role_id', Integer, ForeignKey('roles.id', ondelete="CASCADE"), primary_key=True)
)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    roles = relationship("Role", secondary=user_roles, back_populates="users")


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)

    users = relationship("User", secondary=user_roles, back_populates="roles")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_revoked = Column(Boolean, default=False)

    user = relationship("User")


class SocialProfile(Base):
    __tablename__ = "social_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    platform = Column(String, nullable=False) # 'tiktok', 'facebook', 'youtube'...
    profile_name = Column(String, nullable=False) # Tên hiển thị
    username = Column(String, nullable=True) # ID mạng xã hội
    
    # Đường dẫn thư mục lưu trữ profile Playwright
    folder_path = Column(String, nullable=False, unique=True) 
    
    status = Column(String, default="active") # 'active', 'expired_cookie', 'banned'
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    posts = relationship("SocialPost", back_populates="profile", cascade="all, delete-orphan")
    strategy = relationship("SocialProfileStrategy", back_populates="profile", cascade="all, delete-orphan", uselist=False)
    queue_items = relationship("PublishingQueueItem", back_populates="profile", cascade="all, delete-orphan")
    article_matches = relationship("ArticleProfileMatch", back_populates="profile", cascade="all, delete-orphan")


class SocialProfileStrategy(Base):
    __tablename__ = "social_profile_strategies"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)

    content_topics = Column(Text, default="")
    avoid_topics = Column(Text, default="")
    tone = Column(String, default="ngắn gọn, tự nhiên, đáng tin")
    target_audience = Column(String, default="")
    post_frequency_per_day = Column(Integer, default=2)
    active_hours = Column(String, default="08:00-11:00,19:00-22:00")
    schedule_enabled = Column(Boolean, default=True)
    schedule_days = Column(String, default="0,1,2,3,4,5,6")
    schedule_times = Column(String, default="08:30,20:30")
    schedule_timezone = Column(String, default="Asia/Bangkok")
    approval_mode = Column(String, default="manual")
    risk_level = Column(String, default="medium")
    min_score = Column(Float, default=70.0)
    require_video = Column(Boolean, default=False)
    auto_queue_enabled = Column(Boolean, default=True)
    auto_publish_enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    profile = relationship("SocialProfile", back_populates="strategy")


class ArticleProfileMatch(Base):
    __tablename__ = "article_profile_matches"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)

    article_link = Column(String, nullable=False, index=True)
    article_title = Column(String, nullable=False)
    score = Column(Float, default=0.0)
    decision = Column(String, default="skip")
    reason = Column(Text, nullable=True)
    suggested_platform = Column(String, nullable=True)
    matched_topics = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    profile = relationship("SocialProfile", back_populates="article_matches")


class PublishingQueueItem(Base):
    __tablename__ = "publishing_queue_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    match_id = Column(Integer, ForeignKey("article_profile_matches.id", ondelete="SET NULL"), nullable=True)

    article_link = Column(String, nullable=False, index=True)
    article_title = Column(String, nullable=False)
    platform = Column(String, nullable=False)
    generated_content = Column(Text, nullable=True)
    ai_reason = Column(Text, nullable=True)
    status = Column(String, default="queued", index=True)
    scheduled_at = Column(DateTime, nullable=True, index=True)
    published_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    profile = relationship("SocialProfile", back_populates="queue_items")
    match = relationship("ArticleProfileMatch")


class SocialPost(Base):
    __tablename__ = "social_posts"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String, nullable=False)
    post_url = Column(String, nullable=True)
    platform_post_id = Column(String, nullable=True)
    caption = Column(Text, nullable=True)
    status = Column(String, default="published")
    published_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    profile = relationship("SocialProfile", back_populates="posts")
    metrics = relationship("SocialPostMetric", back_populates="post", cascade="all, delete-orphan")


class SocialPostMetric(Base):
    __tablename__ = "social_post_metrics"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("social_posts.id", ondelete="CASCADE"), nullable=False, index=True)

    views = Column(Integer, default=0)
    likes = Column(Integer, default=0)
    comments = Column(Integer, default=0)
    shares = Column(Integer, default=0)
    captured_at = Column(DateTime, default=datetime.utcnow, index=True)

    post = relationship("SocialPost", back_populates="metrics")
