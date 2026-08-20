"""add content project aggregate

Revision ID: 20260813_0004
Revises: 20260813_0003
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260813_0004"
down_revision = "20260813_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "content_projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="DRAFT"),
        sa.Column("planning_mode", sa.String(length=40), nullable=True),
        sa.Column("primary_content_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("primary_story_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("content_plan_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("video_draft_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("current_stage", sa.String(length=80), nullable=True),
        sa.Column("progress_percent", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["content_plan_id"], ["content_plans.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["primary_content_id"], ["content_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["primary_story_id"], ["stories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["profile_id"], ["social_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["video_draft_id"], ["video_drafts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("content_plan_id"),
        sa.UniqueConstraint("video_draft_id"),
    )
    for col in [
        "user_id",
        "profile_id",
        "status",
        "planning_mode",
        "primary_content_id",
        "primary_story_id",
        "content_plan_id",
        "video_draft_id",
    ]:
        op.create_index(f"ix_content_projects_{col}", "content_projects", [col])

    op.create_table(
        "project_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.String(length=40), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("content_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("story_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("episode_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role", sa.String(length=60), nullable=False, server_default="PRIMARY"),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="ACTIVE"),
        sa.Column("score", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["content_id"], ["content_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["episode_id"], ["episodes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["content_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "source_type", "source_id", name="uq_project_source_ref"),
    )
    for col in ["project_id", "source_type", "source_id", "content_id", "story_id", "episode_id", "role", "status"]:
        op.create_index(f"ix_project_sources_{col}", "project_sources", [col])

    op.create_table(
        "project_candidates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("story_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("episode_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rank_order", sa.Integer(), nullable=True),
        sa.Column("score", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("eligible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["content_id"], ["content_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["episode_id"], ["episodes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["content_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ["project_id", "content_id", "story_id", "episode_id"]:
        op.create_index(f"ix_project_candidates_{col}", "project_candidates", [col])

    op.create_table(
        "project_parts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("part_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="DRAFT"),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["content_projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ["project_id", "part_number", "status"]:
        op.create_index(f"ix_project_parts_{col}", "project_parts", [col])

    op.create_table(
        "project_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_type", sa.String(length=60), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="PENDING"),
        sa.Column("current_stage", sa.String(length=80), nullable=True),
        sa.Column("progress_percent", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["content_projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ["project_id", "run_type", "status"]:
        op.create_index(f"ix_project_runs_{col}", "project_runs", [col])

    op.create_table(
        "project_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("artifact_type", sa.String(length=60), nullable=False),
        sa.Column("uri", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="READY"),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["content_projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ["project_id", "artifact_type", "status"]:
        op.create_index(f"ix_project_artifacts_{col}", "project_artifacts", [col])


def downgrade() -> None:
    for table, cols in [
        ("project_artifacts", ["status", "artifact_type", "project_id"]),
        ("project_runs", ["status", "run_type", "project_id"]),
        ("project_parts", ["status", "part_number", "project_id"]),
        ("project_candidates", ["episode_id", "story_id", "content_id", "project_id"]),
        ("project_sources", ["status", "role", "episode_id", "story_id", "content_id", "source_id", "source_type", "project_id"]),
    ]:
        for col in cols:
            op.drop_index(f"ix_{table}_{col}", table_name=table)
        op.drop_table(table)

    for col in [
        "video_draft_id",
        "content_plan_id",
        "primary_story_id",
        "primary_content_id",
        "planning_mode",
        "status",
        "profile_id",
        "user_id",
    ]:
        op.drop_index(f"ix_content_projects_{col}", table_name="content_projects")
    op.drop_table("content_projects")
