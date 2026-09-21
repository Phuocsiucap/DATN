"""link social posts back to publishing queue items

Revision ID: 9c1d2e3f4a5b
Revises: 8b7e6a5c4d3f
Create Date: 2026-09-11 02:10:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "9c1d2e3f4a5b"
down_revision = "8b7e6a5c4d3f"
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

    # Dọn chiều quan hệ sai nếu database từng có cột này trong publishing_queue_items.
    queue_columns = _column_names(inspector, "publishing_queue_items")
    if "social_post_id" in queue_columns:
        queue_indexes = _index_names(inspector, "publishing_queue_items")
        if "ix_publishing_queue_items_social_post_id" in queue_indexes:
            op.drop_index("ix_publishing_queue_items_social_post_id", table_name="publishing_queue_items")
        queue_fks = _fk_names(inspector, "publishing_queue_items")
        if "publishing_queue_items_social_post_id_fkey" in queue_fks:
            op.drop_constraint("publishing_queue_items_social_post_id_fkey", "publishing_queue_items", type_="foreignkey")
        op.drop_column("publishing_queue_items", "social_post_id")

    inspector = inspect(bind)
    post_columns = _column_names(inspector, "social_posts")
    if "queue_item_id" not in post_columns:
        op.add_column(
            "social_posts",
            sa.Column("queue_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        )

    # Backfill: bài đăng đã tạo từ một dòng queue có cùng hồ sơ và mã xử lý TikTok.
    op.execute(
        """
        WITH matched AS (
            SELECT
                sp.id AS post_id,
                pqi.id AS queue_item_id,
                row_number() OVER (PARTITION BY pqi.id ORDER BY sp.published_at DESC, sp.created_at DESC, sp.id) AS rn
            FROM social_posts sp
            JOIN publishing_queue_items pqi
              ON pqi.profile_id = sp.profile_id
             AND pqi.platform_publish_id = sp.platform_publish_id
            WHERE sp.queue_item_id IS NULL
              AND sp.platform_publish_id IS NOT NULL
              AND pqi.platform_publish_id IS NOT NULL
        )
        UPDATE social_posts sp
        SET queue_item_id = matched.queue_item_id
        FROM matched
        WHERE sp.id = matched.post_id
          AND matched.rn = 1
          AND sp.queue_item_id IS NULL
        """
    )

    inspector = inspect(bind)
    fk_names = _fk_names(inspector, "social_posts")
    if "social_posts_queue_item_id_fkey" not in fk_names:
        op.create_foreign_key(
            "social_posts_queue_item_id_fkey",
            "social_posts",
            "publishing_queue_items",
            ["queue_item_id"],
            ["id"],
            ondelete="SET NULL",
        )

    inspector = inspect(bind)
    index_names = _index_names(inspector, "social_posts")
    if "ix_social_posts_queue_item_id" not in index_names:
        op.create_index("ix_social_posts_queue_item_id", "social_posts", ["queue_item_id"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    post_columns = _column_names(inspector, "social_posts")
    if "queue_item_id" not in post_columns:
        return

    index_names = _index_names(inspector, "social_posts")
    if "ix_social_posts_queue_item_id" in index_names:
        op.drop_index("ix_social_posts_queue_item_id", table_name="social_posts")

    fk_names = _fk_names(inspector, "social_posts")
    if "social_posts_queue_item_id_fkey" in fk_names:
        op.drop_constraint("social_posts_queue_item_id_fkey", "social_posts", type_="foreignkey")

    op.drop_column("social_posts", "queue_item_id")
