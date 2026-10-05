"""add metadata_json to publishing_queue_items

Revision ID: a1b2c3d4e5f6
Revises: 9c1d2e3f4a5b
Create Date: 2026-09-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "a1b2c3d4e5f6"
down_revision = "9c1d2e3f4a5b"
branch_labels = None
depends_on = None


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = _column_names(inspector, "publishing_queue_items")
    if "metadata" not in columns:
        op.add_column(
            "publishing_queue_items",
            sa.Column(
                "metadata",
                postgresql.JSONB(),
                nullable=False,
                server_default="{}",
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = _column_names(inspector, "publishing_queue_items")
    if "metadata" in columns:
        op.drop_column("publishing_queue_items", "metadata")
