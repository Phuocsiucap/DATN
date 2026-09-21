"""drop publishing queue user id

Revision ID: 8b7e6a5c4d3f
Revises: 7a2c9d4e6f10
Create Date: 2026-09-11 01:55:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "8b7e6a5c4d3f"
down_revision = "7a2c9d4e6f10"
branch_labels = None
depends_on = None


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _index_names(inspector, table_name: str) -> set[str]:
    return {idx["name"] for idx in inspector.get_indexes(table_name)}


def _fk_names(inspector, table_name: str) -> set[str]:
    return {fk["name"] for fk in inspector.get_foreign_keys(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = _column_names(inspector, "publishing_queue_items")
    if "user_id" not in columns:
        return

    indexes = _index_names(inspector, "publishing_queue_items")
    if "ix_publishing_queue_items_user_id" in indexes:
        op.drop_index("ix_publishing_queue_items_user_id", table_name="publishing_queue_items")

    foreign_keys = _fk_names(inspector, "publishing_queue_items")
    if "publishing_queue_items_user_id_fkey" in foreign_keys:
        op.drop_constraint("publishing_queue_items_user_id_fkey", "publishing_queue_items", type_="foreignkey")

    op.drop_column("publishing_queue_items", "user_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = _column_names(inspector, "publishing_queue_items")
    if "user_id" in columns:
        return

    op.add_column("publishing_queue_items", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        """
        UPDATE publishing_queue_items pqi
        SET user_id = sp.user_id
        FROM social_profiles sp
        WHERE pqi.profile_id = sp.id
          AND pqi.user_id IS NULL
        """
    )
    op.alter_column("publishing_queue_items", "user_id", nullable=False)
    op.create_foreign_key(
        "publishing_queue_items_user_id_fkey",
        "publishing_queue_items",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_publishing_queue_items_user_id", "publishing_queue_items", ["user_id"], unique=False)
