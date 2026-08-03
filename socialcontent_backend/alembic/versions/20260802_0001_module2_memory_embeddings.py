"""module2 memory and openai embeddings

Revision ID: 20260802_0001
Revises:
Create Date: 2026-08-02
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260802_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("module2_handoffs", sa.Column("strategy_snapshot", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")))

    op.add_column("module2_handoff_items", sa.Column("source_crawl_job_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("module2_handoff_items", sa.Column("item_role", sa.String(length=60), nullable=False, server_default="MANUAL_INCLUDED"))
    op.add_column("module2_handoff_items", sa.Column("relation_reason", sa.String(length=80), nullable=True))
    op.add_column("module2_handoff_items", sa.Column("similarity_score", sa.Numeric(6, 4), nullable=True))
    op.add_column("module2_handoff_items", sa.Column("candidate_score", sa.Numeric(5, 2), nullable=True))
    op.add_column("module2_handoff_items", sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")))
    op.create_index("ix_module2_handoff_items_source_crawl_job_id", "module2_handoff_items", ["source_crawl_job_id"])
    op.create_index("ix_module2_handoff_items_item_role", "module2_handoff_items", ["item_role"])
    op.create_index("ix_module2_handoff_items_relation_reason", "module2_handoff_items", ["relation_reason"])

    op.create_table(
        "content_embeddings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("embedding", sa.JSON(), nullable=False),
        sa.Column("embedding_text", sa.Text(), nullable=False),
        sa.Column("embedding_text_hash", sa.String(length=128), nullable=False),
        sa.Column("model_name", sa.String(length=120), nullable=False),
        sa.Column("model_version", sa.String(length=80), nullable=True),
        sa.Column("embedding_dim", sa.Integer(), nullable=False),
        sa.Column("source_language", sa.String(length=12), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["content_id"], ["content_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("content_id", "model_name", name="uq_content_embedding_model"),
    )
    op.create_index("ix_content_embeddings_content_id", "content_embeddings", ["content_id"])
    op.create_index("ix_content_embeddings_embedding_text_hash", "content_embeddings", ["embedding_text_hash"])
    op.create_index("ix_content_embeddings_model_name", "content_embeddings", ["model_name"])

    op.create_table(
        "profile_content_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("story_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("relation_type", sa.String(length=60), nullable=False),
        sa.Column("relation_reason", sa.String(length=80), nullable=True),
        sa.Column("score", sa.Numeric(5, 2), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["content_id"], ["content_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["social_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_profile_content_links_user_id", "profile_content_links", ["user_id"])
    op.create_index("ix_profile_content_links_profile_id", "profile_content_links", ["profile_id"])
    op.create_index("ix_profile_content_links_content_id", "profile_content_links", ["content_id"])
    op.create_index("ix_profile_content_links_story_id", "profile_content_links", ["story_id"])
    op.create_index("ix_profile_content_links_relation_type", "profile_content_links", ["relation_type"])
    op.create_index("ix_profile_content_links_relation_reason", "profile_content_links", ["relation_reason"])
    op.create_index("ix_profile_content_links_status", "profile_content_links", ["status"])

    op.create_table(
        "profile_series_tracks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("story_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("content_series_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("current_part", sa.Integer(), nullable=False),
        sa.Column("total_parts", sa.Integer(), nullable=False),
        sa.Column("last_planned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["content_series_id"], ["content_series.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["profile_id"], ["social_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_profile_series_tracks_user_id", "profile_series_tracks", ["user_id"])
    op.create_index("ix_profile_series_tracks_profile_id", "profile_series_tracks", ["profile_id"])
    op.create_index("ix_profile_series_tracks_story_id", "profile_series_tracks", ["story_id"])
    op.create_index("ix_profile_series_tracks_content_series_id", "profile_series_tracks", ["content_series_id"])
    op.create_index("ix_profile_series_tracks_status", "profile_series_tracks", ["status"])


def downgrade() -> None:
    op.drop_index("ix_profile_series_tracks_status", table_name="profile_series_tracks")
    op.drop_index("ix_profile_series_tracks_content_series_id", table_name="profile_series_tracks")
    op.drop_index("ix_profile_series_tracks_story_id", table_name="profile_series_tracks")
    op.drop_index("ix_profile_series_tracks_profile_id", table_name="profile_series_tracks")
    op.drop_index("ix_profile_series_tracks_user_id", table_name="profile_series_tracks")
    op.drop_table("profile_series_tracks")

    op.drop_index("ix_profile_content_links_status", table_name="profile_content_links")
    op.drop_index("ix_profile_content_links_relation_reason", table_name="profile_content_links")
    op.drop_index("ix_profile_content_links_relation_type", table_name="profile_content_links")
    op.drop_index("ix_profile_content_links_story_id", table_name="profile_content_links")
    op.drop_index("ix_profile_content_links_content_id", table_name="profile_content_links")
    op.drop_index("ix_profile_content_links_profile_id", table_name="profile_content_links")
    op.drop_index("ix_profile_content_links_user_id", table_name="profile_content_links")
    op.drop_table("profile_content_links")

    op.drop_index("ix_content_embeddings_model_name", table_name="content_embeddings")
    op.drop_index("ix_content_embeddings_embedding_text_hash", table_name="content_embeddings")
    op.drop_index("ix_content_embeddings_content_id", table_name="content_embeddings")
    op.drop_table("content_embeddings")

    op.drop_index("ix_module2_handoff_items_relation_reason", table_name="module2_handoff_items")
    op.drop_index("ix_module2_handoff_items_item_role", table_name="module2_handoff_items")
    op.drop_index("ix_module2_handoff_items_source_crawl_job_id", table_name="module2_handoff_items")
    op.drop_column("module2_handoff_items", "metadata")
    op.drop_column("module2_handoff_items", "candidate_score")
    op.drop_column("module2_handoff_items", "similarity_score")
    op.drop_column("module2_handoff_items", "relation_reason")
    op.drop_column("module2_handoff_items", "item_role")
    op.drop_column("module2_handoff_items", "source_crawl_job_id")
    op.drop_column("module2_handoffs", "strategy_snapshot")
