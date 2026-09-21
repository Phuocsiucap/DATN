"""drop planning run user id

Revision ID: a98fcbe25208
Revises: de080a3a054b
Create Date: 2026-09-11 00:01:48.175641
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql



revision = 'a98fcbe25208'
down_revision = 'de080a3a054b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("planning_runs")}
    if "user_id" not in columns:
        return

    indexes = {index["name"] for index in inspector.get_indexes("planning_runs")}
    if "ix_planning_runs_user_id" in indexes:
        op.drop_index("ix_planning_runs_user_id", table_name="planning_runs")

    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("planning_runs")}
    if "planning_runs_user_id_fkey" in foreign_keys:
        op.drop_constraint("planning_runs_user_id_fkey", "planning_runs", type_="foreignkey")

    op.drop_column("planning_runs", "user_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("planning_runs")}
    if "user_id" in columns:
        return

    op.add_column("planning_runs", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        """
        UPDATE planning_runs AS pr
        SET user_id = sp.user_id
        FROM social_profiles AS sp
        WHERE pr.profile_id = sp.id
        """
    )
    op.alter_column("planning_runs", "user_id", nullable=False)
    op.create_foreign_key(
        "planning_runs_user_id_fkey",
        "planning_runs",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_planning_runs_user_id", "planning_runs", ["user_id"], unique=False)
