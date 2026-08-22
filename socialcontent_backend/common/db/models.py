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
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector
from sqlalchemy.orm import relationship

from common.db.session import Base


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
    tasks = relationship("CrawlTask", back_populates="job", cascade="all, delete-orphan")


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
    tasks = relationship("CrawlTask", back_populates="job_source")


class CrawlTask(Base):
    __tablename__ = "crawl_tasks"

    id = uuid_pk()
    job_id = Column(UUID(as_uuid=True), ForeignKey("crawl_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    job_source_id = Column(UUID(as_uuid=True), ForeignKey("crawl_job_sources.id", ondelete="CASCADE"), nullable=False)
    task_type = Column(String(60), nullable=False)
    external_reference = Column(String(255), nullable=True, index=True)
    status = Column(String(40), nullable=False, default="PENDING", index=True)
    attempt_count = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=4, nullable=False)
    error_code = Column(String(120), nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = now_col()
    updated_at = updated_col()

    job = relationship("CrawlJob", back_populates="tasks")
    job_source = relationship("CrawlJobSource", back_populates="tasks")


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
    created_by_type = Column(String(40), default="SYSTEM", nullable=False)
    status = Column(String(40), default="NEEDS_REVIEW", nullable=False, index=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    canonical_url = Column(Text, nullable=True)
    content_hash = Column(String(128), nullable=True, index=True)
    transcript_hash = Column(String(128), nullable=True, index=True)
    quality_score = Column(Numeric(5, 2), default=0, nullable=False)
    created_at = now_col()
    updated_at = updated_col()

    sources = relationship("ContentSource", back_populates="content", cascade="all, delete-orphan")


class ContentSource(Base):
    __tablename__ = "content_sources"

    id = uuid_pk()
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(40), nullable=False, index=True)
    source_external_id = Column(String(255), nullable=False, index=True)
    source_url = Column(Text, nullable=True)
    raw_document_id = Column(String(64), nullable=True)
    processed_document_id = Column(String(64), nullable=True)
    source_title = Column(Text, nullable=True)
    source_author = Column(String(255), nullable=True)
    source_published_at = Column(DateTime(timezone=True), nullable=True)
    first_seen_at = now_col()
    last_seen_at = updated_col()
    is_primary = Column(Boolean, default=True, nullable=False)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()
    updated_at = updated_col()

    content = relationship("ContentItem", back_populates="sources")


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

    episodes = relationship("Episode", back_populates="story", cascade="all, delete-orphan")


class Episode(Base):
    __tablename__ = "episodes"

    id = uuid_pk()
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    story_id = Column(UUID(as_uuid=True), ForeignKey("stories.id", ondelete="CASCADE"), nullable=False, index=True)
    episode_number = Column(Integer, nullable=True, index=True)
    chapter_number = Column(Integer, nullable=True)
    season_number = Column(Integer, nullable=True)
    sequence_order = Column(Integer, nullable=True)
    episode_title = Column(Text, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    is_missing = Column(Boolean, default=False, nullable=False)
    created_at = now_col()
    updated_at = updated_col()

    story = relationship("Story", back_populates="episodes")


class ContentMedia(Base):
    __tablename__ = "content_media"

    id = uuid_pk()
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    media_type = Column(String(40), nullable=False)
    source_url = Column(Text, nullable=True)
    storage_url = Column(Text, nullable=True)
    thumbnail_url = Column(Text, nullable=True)
    mime_type = Column(String(120), nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    checksum = Column(String(128), nullable=True, index=True)
    created_at = now_col()


class ContentDuplicate(Base):
    __tablename__ = "content_duplicates"

    id = uuid_pk()
    primary_content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False)
    duplicate_content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False)
    match_type = Column(String(60), nullable=False)
    similarity_score = Column(Numeric(5, 2), default=0, nullable=False)
    decision = Column(String(60), default="PENDING", nullable=False)
    decision_reason = Column(Text, nullable=True)
    created_at = now_col()


class ContentEmbedding(Base):
    __tablename__ = "content_embeddings"
    __table_args__ = (UniqueConstraint("content_id", "model_name", name="uq_content_embedding_model"),)

    id = uuid_pk()
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True)
    embedding = Column(JSONB, nullable=False)
    embedding_text = Column(Text, nullable=False)
    embedding_text_hash = Column(String(128), nullable=False, index=True)
    model_name = Column(String(120), nullable=False, index=True)
    model_version = Column(String(80), nullable=True)
    embedding_dim = Column(Integer, nullable=False)
    source_language = Column(String(12), nullable=True)
    created_at = now_col()
    updated_at = updated_col()


class ProcessingRun(Base):
    __tablename__ = "processing_runs"

    id = uuid_pk()
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True, index=True)
    job_id = Column(UUID(as_uuid=True), ForeignKey("crawl_jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    processing_type = Column(String(80), nullable=False)
    status = Column(String(40), nullable=False)
    processor_version = Column(String(80), nullable=True)
    input_reference = Column(String(255), nullable=True)
    output_reference = Column(String(255), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = now_col()


class ProcessedEvent(Base):
    __tablename__ = "processed_events"

    event_id = Column(UUID(as_uuid=True), primary_key=True)
    consumer_name = Column(String(120), primary_key=True)
    processed_at = now_col()


class SocialProfile(Base):
    __tablename__ = "social_profiles"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    platform = Column(String(40), nullable=False, index=True)
    profile_name = Column(String(255), nullable=False)
    username = Column(String(255), nullable=True)
    folder_path = Column(String(500), unique=True, nullable=False)
    status = Column(String(40), default="active", nullable=False, index=True)
    created_at = now_col()
    updated_at = updated_col()

    user = relationship("User", back_populates="social_profiles")
    strategy = relationship("SocialProfileStrategy", back_populates="profile", cascade="all, delete-orphan", uselist=False)
    queue_items = relationship("PublishingQueueItem", back_populates="profile", cascade="all, delete-orphan")
    posts = relationship("SocialPost", back_populates="profile", cascade="all, delete-orphan")
    content_plans = relationship("MediaWorkflow", back_populates="profile", cascade="all, delete-orphan")
    content_links = relationship("ProfileContentLink", back_populates="profile", cascade="all, delete-orphan")


class SocialProfileStrategy(Base):
    __tablename__ = "social_profile_strategies"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    content_topics = Column(Text, default="", nullable=False)
    avoid_topics = Column(Text, default="", nullable=False)
    tone = Column(String(255), default="ngắn gọn, tự nhiên, đáng tin", nullable=False)
    target_audience = Column(String(255), default="", nullable=False)
    post_frequency_per_day = Column(Integer, default=2, nullable=False)
    active_hours = Column(String(120), default="08:00-11:00,19:00-22:00", nullable=False)
    schedule_enabled = Column(Boolean, default=True, nullable=False)
    schedule_days = Column(String(40), default="0,1,2,3,4,5,6", nullable=False)
    schedule_times = Column(String(120), default="08:30,20:30", nullable=False)
    schedule_timezone = Column(String(80), default="Asia/Bangkok", nullable=False)
    approval_mode = Column(String(40), default="manual", nullable=False)
    risk_level = Column(String(40), default="medium", nullable=False)
    min_score = Column(Float, default=70.0, nullable=False)
    require_video = Column(Boolean, default=False, nullable=False)
    receive_system_content = Column(Boolean, default=True, nullable=False)
    auto_project_queue_enabled = Column(Boolean, default=False, nullable=False)
    auto_planning_enabled = Column(Boolean, default=False, nullable=False)
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
    first_seen_at = now_col()
    last_seen_at = updated_col()
    created_at = now_col()
    updated_at = updated_col()

    profile = relationship("SocialProfile", back_populates="content_links")


class PlanningFeedback(Base):
    __tablename__ = "planning_feedback"

    id = uuid_pk()
    media_workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    feedback_type = Column(String(60), nullable=False)
    feedback_text = Column(Text, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = now_col()

    media_workflow = relationship("MediaWorkflow", back_populates="feedback")


class PromptRun(Base):
    __tablename__ = "prompt_runs"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_run_id = Column(UUID(as_uuid=True), ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True, index=True)
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
    workflow_run = relationship("WorkflowRun", foreign_keys=[workflow_run_id], back_populates="prompt_runs")


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
    parts = relationship("WorkflowPart", back_populates="series")


class MediaWorkflow(Base):
    __tablename__ = "media_workflows"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    series_id = Column(UUID(as_uuid=True), ForeignKey("content_series.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(Text, nullable=False)
    status = Column(String(40), default="DRAFT", nullable=False, index=True)
    planning_mode = Column(String(40), nullable=True, index=True)
    primary_content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True, index=True)
    primary_story_id = Column(UUID(as_uuid=True), ForeignKey("stories.id", ondelete="SET NULL"), nullable=True, index=True)
    current_stage = Column(String(80), nullable=True)
    progress_percent = Column(Numeric(5, 2), default=0, nullable=False)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()
    updated_at = updated_col()

    profile = relationship("SocialProfile", back_populates="content_plans")
    user = relationship("User")
    feedback = relationship("PlanningFeedback", back_populates="media_workflow", cascade="all, delete-orphan")
    sources = relationship("WorkflowSource", back_populates="project", cascade="all, delete-orphan")
    candidates = relationship("WorkflowCandidate", back_populates="project", cascade="all, delete-orphan")
    parts = relationship("WorkflowPart", back_populates="project", cascade="all, delete-orphan")
    runs = relationship("WorkflowRun", back_populates="project", cascade="all, delete-orphan")
    artifacts = relationship("WorkflowArtifact", back_populates="project", cascade="all, delete-orphan")
    series = relationship("ContentSeries", back_populates="projects")


class WorkflowSource(Base):
    __tablename__ = "workflow_sources"
    __table_args__ = (UniqueConstraint("workflow_id", "source_type", "source_id", name="uq_workflow_source_ref"),)

    id = uuid_pk()
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(40), nullable=False, index=True)
    source_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True, index=True)
    story_id = Column(UUID(as_uuid=True), ForeignKey("stories.id", ondelete="SET NULL"), nullable=True, index=True)
    episode_id = Column(UUID(as_uuid=True), ForeignKey("episodes.id", ondelete="SET NULL"), nullable=True, index=True)
    role = Column(String(60), default="PRIMARY", nullable=False, index=True)
    status = Column(String(40), default="ACTIVE", nullable=False, index=True)
    score = Column(Numeric(5, 2), default=0, nullable=False)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()

    project = relationship("MediaWorkflow", back_populates="sources")


class WorkflowCandidate(Base):
    __tablename__ = "workflow_candidates"

    id = uuid_pk()
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True, index=True)
    story_id = Column(UUID(as_uuid=True), ForeignKey("stories.id", ondelete="SET NULL"), nullable=True, index=True)
    episode_id = Column(UUID(as_uuid=True), ForeignKey("episodes.id", ondelete="SET NULL"), nullable=True, index=True)
    rank_order = Column(Integer, nullable=True)
    score = Column(Numeric(5, 2), default=0, nullable=False)
    eligible = Column(Boolean, default=True, nullable=False)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()

    project = relationship("MediaWorkflow", back_populates="candidates")
    content = relationship("ContentItem")
    story = relationship("Story")
    episode = relationship("Episode")

    @property
    def candidate_score(self) -> float:
        return float(self.score or 0)

    @candidate_score.setter
    def candidate_score(self, value) -> None:
        self.score = value or 0

    @property
    def score_breakdown(self) -> dict:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return metadata.get("score_breakdown") or {}

    @score_breakdown.setter
    def score_breakdown(self, value) -> None:
        metadata = dict(self.metadata_json or {})
        metadata["score_breakdown"] = value or {}
        self.metadata_json = metadata

    @property
    def selection_reasons(self) -> list:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return metadata.get("selection_reasons") or []

    @selection_reasons.setter
    def selection_reasons(self, value) -> None:
        metadata = dict(self.metadata_json or {})
        metadata["selection_reasons"] = value or []
        self.metadata_json = metadata

    @property
    def rejection_reasons(self) -> list:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return metadata.get("rejection_reasons") or []

    @rejection_reasons.setter
    def rejection_reasons(self, value) -> None:
        metadata = dict(self.metadata_json or {})
        metadata["rejection_reasons"] = value or []
        self.metadata_json = metadata

    @property
    def content_title(self) -> str | None:
        return self.content.canonical_title if getattr(self, "content", None) else None

    @property
    def content_url(self) -> str | None:
        return self.content.canonical_url if getattr(self, "content", None) else None


class WorkflowPart(Base):
    __tablename__ = "workflow_parts"

    id = uuid_pk()
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    series_id = Column(UUID(as_uuid=True), ForeignKey("content_series.id", ondelete="SET NULL"), nullable=True, index=True)
    part_number = Column(Integer, nullable=False, index=True)
    title = Column(Text, nullable=False)
    target_duration_seconds = Column(Integer, nullable=True)
    status = Column(String(40), default="DRAFT", nullable=False, index=True)
    payload = Column(JSONB, nullable=False, default=dict)
    created_at = now_col()
    updated_at = updated_col()

    project = relationship("MediaWorkflow", back_populates="parts")
    series = relationship("ContentSeries", back_populates="parts")


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    id = uuid_pk()
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    run_type = Column(String(60), nullable=False, index=True)
    status = Column(String(40), default="PENDING", nullable=False, index=True)
    current_stage = Column(String(80), nullable=True)
    progress_percent = Column(Numeric(5, 2), default=0, nullable=False)
    error_message = Column(Text, nullable=True)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = now_col()
    updated_at = updated_col()

    project = relationship("MediaWorkflow", back_populates="runs")
    prompt_runs = relationship("PromptRun", foreign_keys="PromptRun.workflow_run_id", back_populates="workflow_run")

    @property
    def user_id(self):
        return self.project.user_id if self.project else None

    @property
    def profile_id(self):
        return self.project.profile_id if self.project else None

    @property
    def planning_mode(self) -> str:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return metadata.get("planning_mode") or (self.project.planning_mode if self.project else None) or "SERIES"

    @property
    def target_duration_seconds(self) -> int | None:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return metadata.get("target_duration_seconds")

    @property
    def preferred_part_count(self) -> int | None:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return metadata.get("preferred_part_count")

    @property
    def language(self) -> str:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return metadata.get("language") or "vi"

    @property
    def instructions(self) -> str | None:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return metadata.get("instructions")

    @property
    def attempt_count(self) -> int:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return int(metadata.get("attempt_count") or 1)

    @attempt_count.setter
    def attempt_count(self, value: int) -> None:
        metadata = dict(self.metadata_json or {})
        metadata["attempt_count"] = int(value or 1)
        self.metadata_json = metadata

    @property
    def error_code(self) -> str | None:
        metadata = self.metadata_json if isinstance(self.metadata_json, dict) else {}
        return metadata.get("error_code")

    @error_code.setter
    def error_code(self, value: str | None) -> None:
        metadata = dict(self.metadata_json or {})
        metadata["error_code"] = value
        self.metadata_json = metadata


class WorkflowArtifact(Base):
    __tablename__ = "workflow_artifacts"

    id = uuid_pk()
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    artifact_type = Column(String(60), nullable=False, index=True)
    uri = Column(Text, nullable=True)
    status = Column(String(40), default="READY", nullable=False, index=True)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = now_col()
    updated_at = updated_col()

    project = relationship("MediaWorkflow", back_populates="artifacts")
