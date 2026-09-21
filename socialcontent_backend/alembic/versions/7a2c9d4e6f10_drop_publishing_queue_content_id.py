"""drop publishing queue content id

Revision ID: 7a2c9d4e6f10
Revises: 6f1b2c3d4e5a
Create Date: 2026-09-11 01:40:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "7a2c9d4e6f10"
down_revision = "6f1b2c3d4e5a"
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
    if "content_id" not in columns:
        return

    indexes = _index_names(inspector, "publishing_queue_items")
    if "ix_publishing_queue_items_content_id" in indexes:
        op.drop_index("ix_publishing_queue_items_content_id", table_name="publishing_queue_items")

    foreign_keys = _fk_names(inspector, "publishing_queue_items")
    if "publishing_queue_items_content_id_fkey" in foreign_keys:
        op.drop_constraint("publishing_queue_items_content_id_fkey", "publishing_queue_items", type_="foreignkey")

    op.drop_column("publishing_queue_items", "content_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = _column_names(inspector, "publishing_queue_items")
    if "content_id" in columns:
        return

    op.add_column("publishing_queue_items", sa.Column("content_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        """
        UPDATE publishing_queue_items pqi
        SET content_id = mw.primary_content_id
        FROM media_workflow mw
        WHERE pqi.workflow_id = mw.id
          AND pqi.content_id IS NULL
        """
    )
    op.create_foreign_key(
        "publishing_queue_items_content_id_fkey",
        "publishing_queue_items",
        "content_items",
        ["content_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_publishing_queue_items_content_id", "publishing_queue_items", ["content_id"], unique=False)
