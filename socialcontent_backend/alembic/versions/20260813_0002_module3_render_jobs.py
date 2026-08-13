"""module3 story versions and render jobs

Revision ID: 20260813_0002
Revises: 20260802_0001
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260813_0002"
down_revision = "20260802_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "module3_story_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("handoff_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=60), nullable=False, server_default="RENDER"),
        sa.Column("story", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["handoff_id"], ["module3_handoffs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("handoff_id", "version_number", name="uq_module3_story_versions_handoff_version"),
    )
    op.create_index("ix_module3_story_versions_handoff_id", "module3_story_versions", ["handoff_id"])
    op.create_index("ix_module3_story_versions_user_id", "module3_story_versions", ["user_id"])
    op.create_index("ix_module3_story_versions_reason", "module3_story_versions", ["reason"])

    op.create_table(
        "module3_render_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("handoff_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("story_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="QUEUED"),
        sa.Column("progress_percent", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("output_path", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["handoff_id"], ["module3_handoffs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["story_version_id"], ["module3_story_versions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_module3_render_jobs_handoff_id", "module3_render_jobs", ["handoff_id"])
    op.create_index("ix_module3_render_jobs_story_version_id", "module3_render_jobs", ["story_version_id"])
    op.create_index("ix_module3_render_jobs_user_id", "module3_render_jobs", ["user_id"])
    op.create_index("ix_module3_render_jobs_status", "module3_render_jobs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_module3_render_jobs_status", table_name="module3_render_jobs")
    op.drop_index("ix_module3_render_jobs_user_id", table_name="module3_render_jobs")
    op.drop_index("ix_module3_render_jobs_story_version_id", table_name="module3_render_jobs")
    op.drop_index("ix_module3_render_jobs_handoff_id", table_name="module3_render_jobs")
    op.drop_table("module3_render_jobs")

    op.drop_index("ix_module3_story_versions_reason", table_name="module3_story_versions")
    op.drop_index("ix_module3_story_versions_user_id", table_name="module3_story_versions")
    op.drop_index("ix_module3_story_versions_handoff_id", table_name="module3_story_versions")
    op.drop_table("module3_story_versions")
