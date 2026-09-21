"""drop planning run workflow id

Revision ID: 17dd69adcc27
Revises: f3b7d91a6c20
Create Date: 2026-09-10 23:23:03.331053
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql



revision = '17dd69adcc27'
down_revision = 'f3b7d91a6c20'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("planning_runs")}
    if "workflow_id" not in columns:
        return

    indexes = {index["name"] for index in inspector.get_indexes("planning_runs")}
    if "ix_planning_runs_workflow_id" in indexes:
        op.drop_index("ix_planning_runs_workflow_id", table_name="planning_runs")

    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("planning_runs")}
    if "planning_runs_workflow_id_fkey" in foreign_keys:
        op.drop_constraint("planning_runs_workflow_id_fkey", "planning_runs", type_="foreignkey")

    op.drop_column("planning_runs", "workflow_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("planning_runs")}
    if "workflow_id" in columns:
        return

    op.add_column("planning_runs", sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "planning_runs_workflow_id_fkey",
        "planning_runs",
        "media_workflow",
        ["workflow_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_planning_runs_workflow_id", "planning_runs", ["workflow_id"], unique=False)
