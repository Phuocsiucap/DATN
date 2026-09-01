from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Table,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from common.db.session import Base
from common.db.vector import Vector


def uuid_pk():
    return Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def now_col():
    return Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


def updated_col():
    return Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id = uuid_pk()
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    is_system_admin = Column(Boolean, default=False, nullable=False)
    created_at = now_col()
    updated_at = updated_col()

    roles = relationship("Role", secondary=user_roles, back_populates="users")
    crawl_jobs = relationship("CrawlJob", back_populates="requester")
    social_profiles = relationship("SocialProfile", back_populates="user", cascade="all, delete-orphan")


class Role(Base):
    __tablename__ = "roles"

    id = uuid_pk()
    name = Column(String(80), unique=True, index=True, nullable=False)
    description = Column(String(255), nullable=True)
    created_at = now_col()

    users = relationship("User", secondary=user_roles, back_populates="roles")


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String(120), primary_key=True)
    value = Column(JSONB, nullable=False, default=dict)
    description = Column(String(255), nullable=True)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = updated_col()


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = uuid_pk()
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action = Column(String(120), nullable=False, index=True)
    target_type = Column(String(120), nullable=True)
    target_id = Column(String(120), nullable=True)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()


class CrawlJob(Base):
    __tablename__ = "crawl_jobs"

    id = uuid_pk()
    name = Column(String(255), nullable=False)
    crawl_mode = Column(String(40), nullable=False, default="ONE_TIME")
    content_scope = Column(String(40), default="GLOBAL", nullable=False, index=True)
    created_by_type = Column(String(40), default="SYSTEM", nullable=False)
    status = Column(String(40), nullable=False, default="PENDING", index=True)
    current_stage = Column(String(40), nullable=False, default="DISCOVERING")
    priority = Column(SmallInteger, default=5, nullable=False)
    total_discovered = Column(Integer, default=0, nullable=False)
    total_crawled = Column(Integer, default=0, nullable=False)
    total_normalized = Column(Integer, default=0, nullable=False)
    total_failed = Column(Integer, default=0, nullable=False)
    total_duplicates = Column(Integer, default=0, nullable=False)
    progress_percent = Column(Numeric(5, 2), default=0, nullable=False)
    requested_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = now_col()
    updated_at = updated_col()

    requester = relationship("User", back_populates="crawl_jobs")
    sources = relationship("CrawlJobSource", back_populates="job", cascade="all, delete-orphan")
    schedule = relationship("CrawlJobSchedule", back_populates="job", cascade="all, delete-orphan", uselist=False)
    content_items = relationship("ContentItem", back_populates="crawl_job")
    content_results = relationship("CrawlJobContent", back_populates="job", cascade="all, delete-orphan")

    @property
    def creator_name(self) -> str:
        if self.created_by_type == "SYSTEM" and not self.requested_by:
            return "Hệ thống"
        if self.requester:
            return self.requester.full_name or self.requester.email.split("@")[0] or "Hệ thống"
        return "Hệ thống"


class CrawlJobSource(Base):
    __tablename__ = "crawl_job_sources"

    id = uuid_pk()
    job_id = Column(UUID(as_uuid=True), ForeignKey("crawl_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(40), nullable=False, index=True)
    source_url = Column(Text, nullable=True)
    keywords = Column(JSONB, nullable=False, default=list)
    configuration = Column(JSONB, nullable=False, default=dict)
    status = Column(String(40), nullable=False, default="ACTIVE")
    created_at = now_col()
    updated_at = updated_col()

    job = relationship("CrawlJob", back_populates="sources")


class CrawlJobSchedule(Base):
    __tablename__ = "crawl_job_schedules"

    id = uuid_pk()
    job_id = Column(UUID(as_uuid=True), ForeignKey("crawl_jobs.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    enabled = Column(Boolean, nullable=False, default=True, index=True)
    runs_per_day = Column(SmallInteger, nullable=False, default=1)
    window_start = Column(Time, nullable=False)
    window_end = Column(Time, nullable=False)
    weekdays = Column(JSONB, nullable=False, default=lambda: list(range(7)))
    timezone = Column(String(80), nullable=False, default="Asia/Ho_Chi_Minh")
    next_run_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    created_at = now_col()
    updated_at = updated_col()

    job = relationship("CrawlJob", back_populates="schedule")


class KafkaTask(Base):
    __tablename__ = "kafka_tasks"

    id               = uuid_pk()
    task_type        = Column(String(60), nullable=False, index=True)
    # CRAWL_URL | NORMALIZE | GENERATE_VIDEO_SCRIPT | GENERATE_VIDEO_RENDER

    status           = Column(String(40), nullable=False, default="PENDING", index=True)
    # PENDING | RUNNING | COMPLETED | FAILED | CANCELLED

    # Job lifecycle
    current_stage       = Column(String(80), nullable=True)
    progress_percent    = Column(Numeric(5,2), default=0, nullable=False)
    idempotency_key     = Column(String(255), unique=True, nullable=True)
    cancel_requested_at = Column(DateTime(timezone=True), nullable=True)
    locked_by           = Column(String(120), nullable=True)   # worker instance ID
    locked_until        = Column(DateTime(timezone=True), nullable=True)
    heartbeat_at        = Column(DateTime(timezone=True), nullable=True)
    scheduled_at        = Column(DateTime(timezone=True), nullable=True)
    parent_task_id      = Column(UUID(as_uuid=True), ForeignKey("kafka_tasks.id"), nullable=True)

    # Reference đến object liên quan (không FK cứng)
    reference_id        = Column(UUID(as_uuid=True), nullable=True, index=True)
    reference_type      = Column(String(40), nullable=True)
    # "crawl_job" | "media_workflow"

    profile_id          = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id"), nullable=True)

    # Payload
    payload_jsonb       = Column(JSONB, nullable=False, default=dict)
    result_jsonb        = Column(JSONB, nullable=False, default=dict)

    # Retry
    attempt_count       = Column(Integer, default=0, nullable=False)
    max_attempts        = Column(Integer, default=3, nullable=False)
    error_message       = Column(Text, nullable=True)

    created_at          = now_col()
    started_at          = Column(DateTime(timezone=True), nullable=True)
    completed_at        = Column(DateTime(timezone=True), nullable=True)


class ContentItem(Base):
    __tablename__ = "content_items"

    id = uuid_pk()
    content_type = Column(String(40), nullable=False, index=True)
    canonical_title = Column(Text, nullable=False)
    normalized_title = Column(Text, nullable=True, index=True)
    summary = Column(Text, nullable=True)
    language = Column(String(12), default="vi", nullable=False)
    content_scope = Column(String(40), default="GLOBAL", nullable=False, index=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    crawl_job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("crawl_jobs.id", name="fk_content_item_crawl_job_id", ondelete="SET NULL", use_alter=True),
        nullable=True,
        index=True,
    )
    created_by_type = Column(String(40), default="SYSTEM", nullable=False)
    status = Column(String(40), default="NEEDS_REVIEW", nullable=False, index=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    canonical_url = Column(Text, nullable=True)
    content_hash = Column(String(128), nullable=True, index=True)
    transcript_hash = Column(String(128), nullable=True, index=True)
    quality_score = Column(Numeric(5, 2), default=0, nullable=False)

    mongo_raw_id = Column(String(64), nullable=True, index=True)
    mongo_normalized_id = Column(String(64), nullable=True, index=True)
    sources_jsonb = Column(JSONB, nullable=False, default=list)
    media_jsonb = Column(JSONB, nullable=False, default=list)
    duplicate_count = Column(Integer, default=0, nullable=False)
    story_id = Column(UUID(as_uuid=True), ForeignKey("stories.id", ondelete="SET NULL", use_alter=True, name="fk_content_item_story_id"), nullable=True, index=True)
    episode_order = Column(Integer, nullable=True)

    created_at = now_col()
    updated_at = updated_col()

    crawl_job = relationship("CrawlJob", back_populates="content_items")
    crawl_job_results = relationship("CrawlJobContent", back_populates="content", cascade="all, delete-orphan")


class CrawlJobContent(Base):
    """Occurrence of one canonical content item in one crawl job."""

    __tablename__ = "crawl_job_contents"

    job_id = Column(UUID(as_uuid=True), ForeignKey("crawl_jobs.id", ondelete="CASCADE"), primary_key=True)
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), primary_key=True)
    is_duplicate = Column(Boolean, default=False, nullable=False, index=True)
    match_type = Column(String(60), nullable=True, index=True)
    source_type = Column(String(40), nullable=True, index=True)
    source_external_id = Column(Text, nullable=True)
    processed_document_id = Column(String(64), nullable=True, index=True)
    occurrence_count = Column(Integer, default=1, nullable=False)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()
    updated_at = updated_col()

    job = relationship("CrawlJob", back_populates="content_results")
    content = relationship("ContentItem", back_populates="crawl_job_results")


class Story(Base):
    __tablename__ = "stories"

    id = uuid_pk()
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True, index=True)
    canonical_name = Column(Text, nullable=False)
    normalized_name = Column(Text, nullable=False, index=True)
    description = Column(Text, nullable=True)
    language = Column(String(12), default="vi", nullable=False)
    total_episodes = Column(Integer, default=0, nullable=False)
    completion_status = Column(String(40), default="UNKNOWN", nullable=False)
    grouping_confidence = Column(Numeric(5, 2), default=0, nullable=False)
    created_at = now_col()
    updated_at = updated_col()


class ContentEmbedding(Base):
    __tablename__ = "content_embeddings"
    __table_args__ = (UniqueConstraint("content_id", "model_name", name="uq_content_embedding_model"),)

    id = uuid_pk()
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    embedding = Column(Vector, nullable=False)
    embedding_text = Column(Text, nullable=False)
    model_name = Column(String(120), nullable=False, index=True)
    embedding_dim = Column(Integer, nullable=False)
    created_at = now_col()
    updated_at = updated_col()


class TopicEmbedding(Base):
    __tablename__ = "topic_embeddings"
    __table_args__ = (UniqueConstraint("topic_key", "model_name", "embedding_text_hash", name="uq_topic_embedding_model_text"),)

    id = uuid_pk()
    topic_key = Column(String(255), nullable=False, index=True)
    topic = Column(Text, nullable=False)
    embedding_text = Column(Text, nullable=False)
    embedding_text_hash = Column(String(64), nullable=False, index=True)
    embedding = Column(Vector, nullable=False)
    model_name = Column(String(120), nullable=False, index=True)
    embedding_dim = Column(Integer, nullable=False)
    created_at = now_col()
    updated_at = updated_col()


class SocialProfile(Base):
    __tablename__ = "social_profiles"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    platform = Column(String(40), nullable=False, index=True)
    profile_name = Column(String(255), nullable=False)
    username = Column(String(255), nullable=True)
    external_id = Column(String(255), nullable=True, index=True)
    avatar_url = Column(Text, nullable=True)
    follower_count = Column(Integer, nullable=True)
    following_count = Column(Integer, nullable=True)
    likes_count = Column(Integer, nullable=True)
    video_count = Column(Integer, nullable=True)
    folder_path = Column(String(500), unique=True, nullable=False)
    status = Column(String(40), default="active", nullable=False, index=True)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    refresh_expires_at = Column(DateTime(timezone=True), nullable=True)
    scopes_jsonb = Column(JSONB, nullable=False, default=list)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()
    updated_at = updated_col()

    user = relationship("User", back_populates="social_profiles")
    strategy = relationship("SocialProfileStrategy", back_populates="profile", cascade="all, delete-orphan", uselist=False)
    queue_items = relationship("PublishingQueueItem", back_populates="profile", cascade="all, delete-orphan")
    posts = relationship("SocialPost", back_populates="profile", cascade="all, delete-orphan")
    snapshots = relationship("SocialProfileSnapshot", back_populates="profile", cascade="all, delete-orphan")
    content_plans = relationship("MediaWorkflow", back_populates="profile", cascade="all, delete-orphan")
    content_links = relationship("ProfileContentLink", back_populates="profile", cascade="all, delete-orphan")


class SocialProfileSnapshot(Base):
    __tablename__ = "social_profile_snapshots"

    id = uuid_pk()
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    follower_count = Column(Integer, default=0, nullable=False)
    following_count = Column(Integer, default=0, nullable=False)
    likes_count = Column(Integer, default=0, nullable=False)
    video_count = Column(Integer, default=0, nullable=False)
    captured_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True)

    profile = relationship("SocialProfile", back_populates="snapshots")


class SocialProfileStrategy(Base):
    __tablename__ = "social_profile_strategies"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    content_topics = Column(Text, default="", nullable=False)
    content_topic_descriptions = Column(JSONB, nullable=False, default=dict)
    avoid_topics = Column(Text, default="", nullable=False)
    avoid_topic_descriptions = Column(JSONB, nullable=False, default=dict)
    tone = Column(String(255), default="ngắn gọn, tự nhiên, đáng tin", nullable=False)
    target_audience = Column(String(255), default="", nullable=False)
    post_frequency_per_day = Column(Integer, default=2, nullable=False)
    active_hours = Column(String(120), default="08:00-11:00,19:00-22:00", nullable=False)
    schedule_days = Column(String(40), default="0,1,2,3,4,5,6", nullable=False)
    schedule_times = Column(String(120), default="08:30,20:30", nullable=False)
    schedule_timezone = Column(String(80), default="Asia/Bangkok", nullable=False)
    approval_mode = Column(String(40), default="manual", nullable=False)
    risk_level = Column(String(40), default="medium", nullable=False)
    min_similarity = Column(Float, default=0.62, nullable=False)
    avoid_similarity_threshold = Column(Float, default=0.72, nullable=False)
    require_video = Column(Boolean, default=False, nullable=False)
    receive_system_content = Column(Boolean, default=True, nullable=False)
    auto_project_queue_enabled = Column(Boolean, default=False, nullable=False)
    video_render_mode = Column(String(40), default="manual", nullable=False)
    max_system_recommendations = Column(Integer, default=20, nullable=False)
    auto_queue_enabled = Column(Boolean, default=True, nullable=False)
    auto_publish_enabled = Column(Boolean, default=False, nullable=False)
    created_at = now_col()
    updated_at = updated_col()

    profile = relationship("SocialProfile", back_populates="strategy")


class PublishingQueueItem(Base):
    __tablename__ = "publishing_queue_items"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True, index=True)
    article_link = Column(Text, nullable=True)
    article_title = Column(Text, nullable=False)
    platform = Column(String(40), nullable=False)
    generated_content = Column(Text, nullable=True)
    ai_reason = Column(Text, nullable=True)
    status = Column(String(40), default="queued", nullable=False, index=True)
    platform_publish_id = Column(String(255), nullable=True, index=True)
    publish_status_jsonb = Column("publish_status", JSONB, nullable=False, default=dict)
    scheduled_at = Column(DateTime(timezone=True), nullable=True, index=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    error = Column(Text, nullable=True)
    created_at = now_col()
    updated_at = updated_col()

    profile = relationship("SocialProfile", back_populates="queue_items")


class SocialPost(Base):
    __tablename__ = "social_posts"

    id = uuid_pk()
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    post_url = Column(Text, nullable=True)
    platform_post_id = Column(String(255), nullable=True)
    platform_publish_id = Column(String(255), nullable=True, index=True)
    caption = Column(Text, nullable=True)
    status = Column(String(40), default="published", nullable=False)
    published_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    created_at = now_col()

    profile = relationship("SocialProfile", back_populates="posts")
    metrics = relationship("SocialPostMetric", back_populates="post", cascade="all, delete-orphan")


class SocialPostMetric(Base):
    __tablename__ = "social_post_metrics"

    id = uuid_pk()
    post_id = Column(UUID(as_uuid=True), ForeignKey("social_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    views = Column(Integer, default=0, nullable=False)
    likes = Column(Integer, default=0, nullable=False)
    comments = Column(Integer, default=0, nullable=False)
    shares = Column(Integer, default=0, nullable=False)
    captured_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False, index=True)

    post = relationship("SocialPost", back_populates="metrics")


class ProfileContentLink(Base):
    __tablename__ = "profile_content_links"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), nullable=True, index=True)
    story_id = Column(UUID(as_uuid=True), ForeignKey("stories.id", ondelete="CASCADE"), nullable=True, index=True)
    relation_type = Column(String(60), nullable=False, index=True)
    relation_reason = Column(String(80), nullable=True, index=True)
    source_scope = Column(String(40), default="GLOBAL", nullable=False, index=True)
    recommendation_status = Column(String(60), default="RECOMMENDED", nullable=False, index=True)
    score = Column(Numeric(5, 2), default=0, nullable=False)
    status = Column(String(40), default="ACTIVE", nullable=False, index=True)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    recommended_at = Column(DateTime(timezone=True), nullable=True, index=True)
    first_seen_at = now_col()
    last_seen_at = updated_col()
    created_at = now_col()
    updated_at = updated_col()

    profile = relationship("SocialProfile", back_populates="content_links")


class PlanningFeedback(Base):
    __tablename__ = "planning_feedback"

    id = uuid_pk()
    media_workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflow.id", ondelete="CASCADE"), nullable=False, index=True)
    feedback_type = Column(String(60), nullable=False)
    feedback_text = Column(Text, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = now_col()

    media_workflow = relationship("MediaWorkflow", back_populates="feedback")


class PromptRun(Base):
    __tablename__ = "prompt_runs"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    run_type = Column(String(60), nullable=False, index=True)
    reference_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    step_name = Column(String(80), nullable=False)
    model_provider = Column(String(80), nullable=True)
    model_name = Column(String(120), nullable=True)
    prompt_version = Column(String(80), nullable=True)
    input_reference = Column(String(255), nullable=True)
    output_reference = Column(String(255), nullable=True)
    input_tokens = Column(Integer, default=0, nullable=False)
    output_tokens = Column(Integer, default=0, nullable=False)
    total_tokens = Column(Integer, default=0, nullable=False)
    cost_usd = Column(Float, default=0.0, nullable=False)
    latency_ms = Column(Integer, nullable=True)
    status = Column(String(40), default="PENDING", nullable=False, index=True)
    error_message = Column(Text, nullable=True)
    created_at = now_col()

    user = relationship("User", foreign_keys=[user_id])


class ContentSeries(Base):
    __tablename__ = "content_series"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    series_type = Column(String(60), default="NARRATIVE", nullable=False, index=True)
    status = Column(String(40), default="ACTIVE", nullable=False, index=True)
    current_part = Column(Integer, default=0, nullable=False)
    total_parts = Column(Integer, default=0, nullable=False)
    context_json = Column(JSONB, nullable=False, default=dict)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()
    updated_at = updated_col()

    projects = relationship("MediaWorkflow", back_populates="series")


class MediaWorkflow(Base):
    __tablename__ = "media_workflow"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    series_id = Column(UUID(as_uuid=True), ForeignKey("content_series.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(Text, nullable=False)
    status = Column(String(40), default="DRAFT", nullable=False, index=True)
    planning_mode = Column(String(40), nullable=True, index=True)
    primary_content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True, index=True)
    current_stage = Column(String(80), nullable=True)
    progress_percent = Column(Numeric(5, 2), default=0, nullable=False)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    draft_json = Column(JSONB, nullable=False, default=dict)
    artifacts_jsonb = Column(JSONB, nullable=False, default=list)
    inputs_jsonb = Column(JSONB, nullable=False, default=list)
    created_at = now_col()
    updated_at = updated_col()

    profile = relationship("SocialProfile", back_populates="content_plans")
    user = relationship("User")
    feedback = relationship("PlanningFeedback", back_populates="media_workflow", cascade="all, delete-orphan")
    series = relationship("ContentSeries", back_populates="projects")


class PlanningRun(Base):
    __tablename__ = "planning_runs"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflow.id", ondelete="CASCADE"), nullable=True, index=True)
    crawl_job_id = Column(UUID(as_uuid=True), ForeignKey("crawl_jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    planning_mode = Column(String(40), default="AUTO", nullable=False, index=True)
    status = Column(String(40), default="PENDING", nullable=False, index=True)
    input_jsonb = Column(JSONB, nullable=False, default=dict)
    output_jsonb = Column(JSONB, nullable=False, default=dict)
    reason_jsonb = Column(JSONB, nullable=False, default=dict)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = now_col()
    updated_at = updated_col()

    workflow = relationship("MediaWorkflow")
    profile = relationship("SocialProfile")
    candidates = relationship("PlanningCandidate", back_populates="planning_run", cascade="all, delete-orphan")

    @property
    def current_stage(self) -> str:
        return "COMPLETED" if self.status in {"SUCCEEDED", "FAILED", "CANCELLED", "WAITING_REVIEW"} else "SELECTING_CANDIDATES"

    @property
    def progress_percent(self) -> float:
        return 100.0 if self.status in {"SUCCEEDED", "FAILED", "CANCELLED", "WAITING_REVIEW"} else 5.0

    @property
    def target_duration_seconds(self) -> int | None:
        return (self.metadata_json or {}).get("target_duration_seconds") if isinstance(self.metadata_json, dict) else None

    @property
    def preferred_part_count(self) -> int | None:
        return (self.metadata_json or {}).get("preferred_part_count") if isinstance(self.metadata_json, dict) else None

    @property
    def language(self) -> str:
        return ((self.metadata_json or {}).get("language") if isinstance(self.metadata_json, dict) else None) or "vi"

    @property
    def instructions(self) -> str | None:
        return (self.metadata_json or {}).get("instructions") if isinstance(self.metadata_json, dict) else None

    @property
    def attempt_count(self) -> int:
        return int((self.metadata_json or {}).get("attempt_count") or 1) if isinstance(self.metadata_json, dict) else 1

    @property
    def error_code(self) -> str | None:
        return (self.metadata_json or {}).get("error_code") if isinstance(self.metadata_json, dict) else None

    @property
    def error_message(self) -> str | None:
        return (self.metadata_json or {}).get("error_message") if isinstance(self.metadata_json, dict) else None


class PlanningCandidate(Base):
    __tablename__ = "planning_candidates"

    id = uuid_pk()
    planning_run_id = Column(UUID(as_uuid=True), ForeignKey("planning_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflow.id", ondelete="CASCADE"), nullable=True, index=True)
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True, index=True)
    rank_order = Column(Integer, nullable=True)
    score = Column(Numeric(5, 2), default=0, nullable=False)
    selected = Column(Boolean, default=False, nullable=False, index=True)
    eligible = Column(Boolean, default=True, nullable=False)
    reason_jsonb = Column(JSONB, nullable=False, default=dict)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()

    planning_run = relationship("PlanningRun", back_populates="candidates")
    workflow = relationship("MediaWorkflow")
    content = relationship("ContentItem")

    @property
    def workflow_run_id(self):
        return self.planning_run_id

    @property
    def story_id(self):
        return None

    @property
    def episode_id(self):
        return None

    @property
    def candidate_score(self) -> float:
        return float(self.score or 0)

    @property
    def score_breakdown(self) -> dict:
        return (self.metadata_json or {}).get("score_breakdown") or {}

    @property
    def selection_reasons(self) -> list:
        return (self.reason_jsonb or {}).get("selection_reasons") or []

    @property
    def rejection_reasons(self) -> list:
        return (self.reason_jsonb or {}).get("rejection_reasons") or []
