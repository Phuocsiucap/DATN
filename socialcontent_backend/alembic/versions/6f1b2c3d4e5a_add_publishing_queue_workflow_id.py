"""add publishing queue workflow id

Revision ID: 6f1b2c3d4e5a
Revises: 54c2e1d8a9b3
Create Date: 2026-09-11 01:25:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "6f1b2c3d4e5a"
down_revision = "54c2e1d8a9b3"
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

    if "workflow_id" not in columns:
        op.add_column(
            "publishing_queue_items",
            sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=True),
        )

    op.execute(
        """
        UPDATE publishing_queue_items pqi
        SET workflow_id = mw.id
        FROM media_workflow mw
        WHERE pqi.workflow_id IS NULL
          AND mw.metadata->>'queued_post_id' = pqi.id::text
        """
    )

    op.execute(
        """
        UPDATE publishing_queue_items pqi
        SET workflow_id = matched.workflow_id
        FROM (
            SELECT DISTINCT ON (pqi2.id)
                pqi2.id AS queue_id,
                mw.id AS workflow_id
            FROM publishing_queue_items pqi2
            JOIN media_workflow mw
              ON mw.profile_id = pqi2.profile_id
             AND mw.primary_content_id IS NOT DISTINCT FROM pqi2.content_id
            WHERE pqi2.workflow_id IS NULL
            ORDER BY pqi2.id, mw.updated_at DESC, mw.created_at DESC
        ) matched
        WHERE pqi.id = matched.queue_id
          AND pqi.workflow_id IS NULL
        """
    )

    inspector = inspect(bind)
    fk_names = _fk_names(inspector, "publishing_queue_items")
    if "publishing_queue_items_workflow_id_fkey" not in fk_names:
        op.create_foreign_key(
            "publishing_queue_items_workflow_id_fkey",
            "publishing_queue_items",
            "media_workflow",
            ["workflow_id"],
            ["id"],
            ondelete="SET NULL",
        )

    inspector = inspect(bind)
    index_names = _index_names(inspector, "publishing_queue_items")
    if "ix_publishing_queue_items_workflow_id" not in index_names:
        op.create_index("ix_publishing_queue_items_workflow_id", "publishing_queue_items", ["workflow_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = _column_names(inspector, "publishing_queue_items")
    if "workflow_id" not in columns:
        return

    index_names = _index_names(inspector, "publishing_queue_items")
    if "ix_publishing_queue_items_workflow_id" in index_names:
        op.drop_index("ix_publishing_queue_items_workflow_id", table_name="publishing_queue_items")

    fk_names = _fk_names(inspector, "publishing_queue_items")
    if "publishing_queue_items_workflow_id_fkey" in fk_names:
        op.drop_constraint("publishing_queue_items_workflow_id_fkey", "publishing_queue_items", type_="foreignkey")

    op.drop_column("publishing_queue_items", "workflow_id")
