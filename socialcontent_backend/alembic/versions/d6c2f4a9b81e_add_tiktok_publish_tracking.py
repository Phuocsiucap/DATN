"""add_tiktok_publish_tracking

Revision ID: d6c2f4a9b81e
Revises: c53d9a42b18f
Create Date: 2026-08-29 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d6c2f4a9b81e"
down_revision = "c53d9a42b18f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    queue_columns = {column["name"] for column in inspector.get_columns("publishing_queue_items")}
    queue_indexes = {index["name"] for index in inspector.get_indexes("publishing_queue_items")}
    post_columns = {column["name"] for column in inspector.get_columns("social_posts")}
    post_indexes = {index["name"] for index in inspector.get_indexes("social_posts")}

    if "platform_publish_id" not in queue_columns:
        op.add_column("publishing_queue_items", sa.Column("platform_publish_id", sa.String(length=255), nullable=True))
    if "publish_status" not in queue_columns:
        op.add_column(
            "publishing_queue_items",
            sa.Column(
                "publish_status",
                postgresql.JSONB(astext_type=sa.Text()),
                server_default=sa.text("'{}'::jsonb"),
                nullable=False,
            ),
        )
    if op.f("ix_publishing_queue_items_platform_publish_id") not in queue_indexes:
        op.create_index(op.f("ix_publishing_queue_items_platform_publish_id"), "publishing_queue_items", ["platform_publish_id"], unique=False)

    if "platform_publish_id" not in post_columns:
        op.add_column("social_posts", sa.Column("platform_publish_id", sa.String(length=255), nullable=True))
    if op.f("ix_social_posts_platform_publish_id") not in post_indexes:
        op.create_index(op.f("ix_social_posts_platform_publish_id"), "social_posts", ["platform_publish_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_social_posts_platform_publish_id"), table_name="social_posts")
    op.drop_column("social_posts", "platform_publish_id")

    op.drop_index(op.f("ix_publishing_queue_items_platform_publish_id"), table_name="publishing_queue_items")
    op.drop_column("publishing_queue_items", "publish_status")
    op.drop_column("publishing_queue_items", "platform_publish_id")
