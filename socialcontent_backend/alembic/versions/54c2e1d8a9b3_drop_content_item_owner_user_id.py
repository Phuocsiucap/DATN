"""drop content item owner user id

Revision ID: 54c2e1d8a9b3
Revises: 2c41b8a5e9d7
Create Date: 2026-09-11 01:05:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "54c2e1d8a9b3"
down_revision = "2c41b8a5e9d7"
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
    columns = _column_names(inspector, "content_items")
    if "owner_user_id" not in columns:
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(
        """
        WITH owners AS (
            SELECT DISTINCT ci.owner_user_id AS user_id
            FROM content_items ci
            WHERE ci.owner_user_id IS NOT NULL
              AND ci.content_scope = 'PRIVATE'
              AND NOT EXISTS (
                  SELECT 1
                  FROM crawl_job_contents cjc
                  JOIN crawl_jobs cj ON cj.id = cjc.job_id
                  WHERE cjc.content_id = ci.id
                    AND cj.requested_by = ci.owner_user_id
                    AND cj.content_scope = 'PRIVATE'
              )
        ), manual_jobs AS (
            INSERT INTO crawl_jobs (
                id, name, crawl_mode, content_scope, created_by_type, status,
                current_stage, priority, total_discovered, total_crawled,
                total_normalized, total_failed, total_duplicates, progress_percent,
                requested_by, completed_at, created_at, updated_at
            )
            SELECT
                gen_random_uuid(),
                'Manual content import migration',
                'MANUAL_IMPORT',
                'PRIVATE',
                'CREATOR',
                'SUCCEEDED',
                'COMPLETED',
                5,
                0,
                0,
                0,
                0,
                0,
                100,
                owners.user_id,
                now(),
                now(),
                now()
            FROM owners
            RETURNING id, requested_by
        ), inserted_links AS (
            INSERT INTO crawl_job_contents (job_id, content_id, is_duplicate, created_at)
            SELECT manual_jobs.id, ci.id, false, now()
            FROM manual_jobs
            JOIN content_items ci ON ci.owner_user_id = manual_jobs.requested_by
            WHERE ci.content_scope = 'PRIVATE'
              AND NOT EXISTS (
                  SELECT 1
                  FROM crawl_job_contents cjc
                  JOIN crawl_jobs cj ON cj.id = cjc.job_id
                  WHERE cjc.content_id = ci.id
                    AND cj.requested_by = ci.owner_user_id
                    AND cj.content_scope = 'PRIVATE'
              )
            ON CONFLICT DO NOTHING
            RETURNING 1
        )
        UPDATE crawl_jobs cj
        SET total_discovered = counts.total_count,
            total_crawled = counts.total_count,
            total_normalized = counts.total_count
        FROM (
            SELECT cjc.job_id, count(*)::integer AS total_count
            FROM crawl_job_contents cjc
            JOIN manual_jobs mj ON mj.id = cjc.job_id
            GROUP BY cjc.job_id
        ) counts
        WHERE cj.id = counts.job_id
        """
    )

    indexes = _index_names(inspector, "content_items")
    if "ix_content_items_owner_user_id" in indexes:
        op.drop_index("ix_content_items_owner_user_id", table_name="content_items")

    foreign_keys = _fk_names(inspector, "content_items")
    if "content_items_owner_user_id_fkey" in foreign_keys:
        op.drop_constraint("content_items_owner_user_id_fkey", "content_items", type_="foreignkey")

    op.drop_column("content_items", "owner_user_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = _column_names(inspector, "content_items")
    if "owner_user_id" in columns:
        return

    op.add_column("content_items", sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        """
        UPDATE content_items ci
        SET owner_user_id = owner_lookup.requested_by
        FROM (
            SELECT DISTINCT ON (cjc.content_id)
                cjc.content_id,
                cj.requested_by
            FROM crawl_job_contents cjc
            JOIN crawl_jobs cj ON cj.id = cjc.job_id
            WHERE cj.content_scope = 'PRIVATE'
              AND cj.requested_by IS NOT NULL
            ORDER BY cjc.content_id, cjc.created_at ASC, cj.created_at ASC
        ) owner_lookup
        WHERE ci.id = owner_lookup.content_id
          AND ci.content_scope = 'PRIVATE'
        """
    )
    op.create_foreign_key(
        "content_items_owner_user_id_fkey",
        "content_items",
        "users",
        ["owner_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_content_items_owner_user_id", "content_items", ["owner_user_id"], unique=False)
