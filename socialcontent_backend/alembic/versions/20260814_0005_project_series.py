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
        "project_series",
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
        op.create_index(f"ix_project_series_{col}", "project_series", [col])

    op.add_column("content_projects", sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_content_projects_series_id_project_series", "content_projects", "project_series", ["series_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_content_projects_series_id", "content_projects", ["series_id"])

    op.add_column("project_parts", sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_project_parts_series_id_project_series", "project_parts", "project_series", ["series_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_project_parts_series_id", "project_parts", ["series_id"])


def downgrade() -> None:
    op.drop_index("ix_project_parts_series_id", table_name="project_parts")
    op.drop_constraint("fk_project_parts_series_id_project_series", "project_parts", type_="foreignkey")
    op.drop_column("project_parts", "series_id")

    op.drop_index("ix_content_projects_series_id", table_name="content_projects")
    op.drop_constraint("fk_content_projects_series_id_project_series", "content_projects", type_="foreignkey")
    op.drop_column("content_projects", "series_id")

    for col in ["status", "series_type", "profile_id", "user_id"]:
        op.drop_index(f"ix_project_series_{col}", table_name="project_series")
    op.drop_table("project_series")
