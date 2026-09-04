"""Link canonical content to every crawl job that discovered it.

Revision ID: bc84e6fa31d2
Revises: ab73d5e920f1
Create Date: 2026-09-01 19:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "bc84e6fa31d2"
down_revision = "ab73d5e920f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("crawl_job_contents"):
        op.create_table(
            "crawl_job_contents",
            sa.Column("job_id", sa.UUID(), nullable=False),
            sa.Column("content_id", sa.UUID(), nullable=False),
            sa.Column("is_duplicate", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("match_type", sa.String(length=60), nullable=True),
            sa.Column("source_type", sa.String(length=40), nullable=True),
            sa.Column("source_external_id", sa.Text(), nullable=True),
            sa.Column("processed_document_id", sa.String(length=64), nullable=True),
            sa.Column("occurrence_count", sa.Integer(), server_default="1", nullable=False),
            sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["content_id"], ["content_items.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["job_id"], ["crawl_jobs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("job_id", "content_id"),
        )
        existing_indexes: set[str] = set()
    else:
        existing_indexes = {index["name"] for index in inspector.get_indexes("crawl_job_contents")}

    for name, columns in (
        (op.f("ix_crawl_job_contents_content_id"), ["content_id"]),
        (op.f("ix_crawl_job_contents_is_duplicate"), ["is_duplicate"]),
        (op.f("ix_crawl_job_contents_match_type"), ["match_type"]),
        (op.f("ix_crawl_job_contents_processed_document_id"), ["processed_document_id"]),
        (op.f("ix_crawl_job_contents_source_type"), ["source_type"]),
    ):
        if name not in existing_indexes:
            op.create_index(name, "crawl_job_contents", columns, unique=False)
    op.execute(
        sa.text(
            """
            INSERT INTO crawl_job_contents (
                job_id, content_id, is_duplicate, match_type, occurrence_count,
                metadata, created_at, updated_at
            )
            SELECT
                crawl_job_id, id, FALSE, 'ORIGIN_JOB', 1,
                '{}'::jsonb, created_at, updated_at
            FROM content_items
            WHERE crawl_job_id IS NOT NULL
            ON CONFLICT (job_id, content_id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO crawl_job_contents (
                job_id, content_id, is_duplicate, match_type, processed_document_id,
                occurrence_count, metadata, created_at, updated_at
            )
            SELECT
                task.reference_id,
                (task.result_jsonb ->> 'output_reference')::uuid,
                content.crawl_job_id IS DISTINCT FROM task.reference_id,
                'HISTORICAL_TASK_RESULT',
                task.payload_jsonb ->> 'input_reference',
                1,
                jsonb_build_object('backfilled_from_task_id', task.id::text),
                COALESCE(task.completed_at, task.created_at, NOW()),
                COALESCE(task.completed_at, task.created_at, NOW())
            FROM kafka_tasks AS task
            JOIN content_items AS content
              ON content.id = CASE
                  WHEN task.result_jsonb ->> 'output_reference'
                      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  THEN (task.result_jsonb ->> 'output_reference')::uuid
                  ELSE NULL
              END
            WHERE task.reference_type = 'crawl_job'
              AND task.reference_id IS NOT NULL
              AND task.result_jsonb ->> 'output_reference'
                  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            ON CONFLICT (job_id, content_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_crawl_job_contents_source_type"), table_name="crawl_job_contents")
    op.drop_index(op.f("ix_crawl_job_contents_processed_document_id"), table_name="crawl_job_contents")
    op.drop_index(op.f("ix_crawl_job_contents_match_type"), table_name="crawl_job_contents")
    op.drop_index(op.f("ix_crawl_job_contents_is_duplicate"), table_name="crawl_job_contents")
    op.drop_index(op.f("ix_crawl_job_contents_content_id"), table_name="crawl_job_contents")
    op.drop_table("crawl_job_contents")
