"""add project series grouping

Revision ID: 20260814_0005
Revises: 20260813_0004
Create Date: 2026-08-14
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260814_0005"
down_revision = "20260813_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "content_series",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("series_type", sa.String(length=60), nullable=False, server_default="NARRATIVE"),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="ACTIVE"),
        sa.Column("current_part", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_parts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("context_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["social_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ["user_id", "profile_id", "series_type", "status"]:
        op.create_index(f"ix_content_series_{col}", "content_series", [col])

    op.add_column("media_workflows", sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_media_workflows_series_id_content_series", "media_workflows", "content_series", ["series_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_media_workflows_series_id", "media_workflows", ["series_id"])

    op.add_column("workflow_parts", sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_workflow_parts_series_id_content_series", "workflow_parts", "content_series", ["series_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_workflow_parts_series_id", "workflow_parts", ["series_id"])


def downgrade() -> None:
    op.drop_index("ix_workflow_parts_series_id", table_name="workflow_parts")
    op.drop_constraint("fk_workflow_parts_series_id_content_series", "workflow_parts", type_="foreignkey")
    op.drop_column("workflow_parts", "series_id")

    op.drop_index("ix_media_workflows_series_id", table_name="media_workflows")
    op.drop_constraint("fk_media_workflows_series_id_content_series", "media_workflows", type_="foreignkey")
    op.drop_column("media_workflows", "series_id")

    for col in ["status", "series_type", "profile_id", "user_id"]:
        op.drop_index(f"ix_content_series_{col}", table_name="content_series")
    op.drop_table("content_series")
