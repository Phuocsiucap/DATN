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
    op.execute("ALTER TABLE IF EXISTS project_source_selections ADD COLUMN IF NOT EXISTS strategy_snapshot JSON DEFAULT '{}'::json NOT NULL")
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('project_source_selection_items') IS NOT NULL THEN
                ALTER TABLE project_source_selection_items ADD COLUMN IF NOT EXISTS source_crawl_job_id UUID;
                ALTER TABLE project_source_selection_items ADD COLUMN IF NOT EXISTS item_role VARCHAR(60) DEFAULT 'MANUAL_INCLUDED' NOT NULL;
                ALTER TABLE project_source_selection_items ADD COLUMN IF NOT EXISTS relation_reason VARCHAR(80);
                ALTER TABLE project_source_selection_items ADD COLUMN IF NOT EXISTS similarity_score NUMERIC(6, 4);
                ALTER TABLE project_source_selection_items ADD COLUMN IF NOT EXISTS candidate_score NUMERIC(5, 2);
                ALTER TABLE project_source_selection_items ADD COLUMN IF NOT EXISTS metadata JSON DEFAULT '{}'::json NOT NULL;
                CREATE INDEX IF NOT EXISTS ix_project_source_selection_items_source_crawl_job_id ON project_source_selection_items (source_crawl_job_id);
                CREATE INDEX IF NOT EXISTS ix_project_source_selection_items_item_role ON project_source_selection_items (item_role);
                CREATE INDEX IF NOT EXISTS ix_project_source_selection_items_relation_reason ON project_source_selection_items (relation_reason);
            END IF;
        END $$;
        """
    )

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
        sa.Column("project_series_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("current_part", sa.Integer(), nullable=False),
        sa.Column("total_parts", sa.Integer(), nullable=False),
        sa.Column("last_planned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["social_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_profile_series_tracks_user_id", "profile_series_tracks", ["user_id"])
    op.create_index("ix_profile_series_tracks_profile_id", "profile_series_tracks", ["profile_id"])
    op.create_index("ix_profile_series_tracks_story_id", "profile_series_tracks", ["story_id"])
    op.create_index("ix_profile_series_tracks_project_series_id", "profile_series_tracks", ["project_series_id"])
    op.create_index("ix_profile_series_tracks_status", "profile_series_tracks", ["status"])


def downgrade() -> None:
    op.drop_index("ix_profile_series_tracks_status", table_name="profile_series_tracks")
    op.drop_index("ix_profile_series_tracks_project_series_id", table_name="profile_series_tracks")
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

    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('project_source_selection_items') IS NOT NULL THEN
                DROP INDEX IF EXISTS ix_project_source_selection_items_relation_reason;
                DROP INDEX IF EXISTS ix_project_source_selection_items_item_role;
                DROP INDEX IF EXISTS ix_project_source_selection_items_source_crawl_job_id;
                ALTER TABLE project_source_selection_items DROP COLUMN IF EXISTS metadata;
                ALTER TABLE project_source_selection_items DROP COLUMN IF EXISTS candidate_score;
                ALTER TABLE project_source_selection_items DROP COLUMN IF EXISTS similarity_score;
                ALTER TABLE project_source_selection_items DROP COLUMN IF EXISTS relation_reason;
                ALTER TABLE project_source_selection_items DROP COLUMN IF EXISTS item_role;
                ALTER TABLE project_source_selection_items DROP COLUMN IF EXISTS source_crawl_job_id;
            END IF;
            IF to_regclass('project_source_selections') IS NOT NULL THEN
                ALTER TABLE project_source_selections DROP COLUMN IF EXISTS strategy_snapshot;
            END IF;
        END $$;
        """
    )
