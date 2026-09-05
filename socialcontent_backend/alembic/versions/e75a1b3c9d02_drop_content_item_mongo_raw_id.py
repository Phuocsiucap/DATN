"""Drop obsolete raw MongoDB reference from content items.

Revision ID: e75a1b3c9d02
Revises: d4a6c8e91f20
"""

from alembic import op
import sqlalchemy as sa


revision = "e75a1b3c9d02"
down_revision = "d4a6c8e91f20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_content_items_mongo_raw_id", table_name="content_items")
    op.drop_column("content_items", "mongo_raw_id")


def downgrade() -> None:
    op.add_column("content_items", sa.Column("mongo_raw_id", sa.String(64), nullable=True))
    op.create_index("ix_content_items_mongo_raw_id", "content_items", ["mongo_raw_id"])
