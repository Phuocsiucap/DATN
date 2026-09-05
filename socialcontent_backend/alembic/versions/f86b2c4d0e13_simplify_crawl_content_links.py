"""Keep only job membership, first-result status and timestamp on crawl links."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f86b2c4d0e13"
down_revision = "e75a1b3c9d02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Preserve creation provenance and repair flags overwritten by repeated hits.
    op.execute("""
        INSERT INTO crawl_job_contents (job_id, content_id, is_duplicate, created_at)
        SELECT crawl_job_id, id, FALSE, created_at FROM content_items
        WHERE crawl_job_id IS NOT NULL
        ON CONFLICT (job_id, content_id) DO UPDATE SET is_duplicate = FALSE
    """)
    for name in ("match_type", "source_type", "source_external_id",
                 "processed_document_id", "occurrence_count", "metadata", "updated_at"):
        op.drop_column("crawl_job_contents", name)
    op.drop_column("content_items", "crawl_job_id")
    op.drop_column("content_items", "duplicate_count")


def downgrade() -> None:
    # Restore schema; discarded diagnostic values cannot be reconstructed.
    op.add_column("content_items", sa.Column("crawl_job_id", postgresql.UUID(), nullable=True))
    op.create_foreign_key("fk_content_item_crawl_job_id", "content_items", "crawl_jobs",
                          ["crawl_job_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_content_items_crawl_job_id", "content_items", ["crawl_job_id"])
    op.add_column("content_items", sa.Column("duplicate_count", sa.Integer(), nullable=False, server_default="0"))
    op.execute("""
        UPDATE content_items AS c SET crawl_job_id = (
            SELECT l.job_id FROM crawl_job_contents AS l
            WHERE l.content_id = c.id AND NOT l.is_duplicate
            ORDER BY l.created_at, l.job_id LIMIT 1
        )
    """)
    for column in (
        sa.Column("match_type", sa.String(60)),
        sa.Column("source_type", sa.String(40)),
        sa.Column("source_external_id", sa.Text()),
        sa.Column("processed_document_id", sa.String(64)),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ):
        op.add_column("crawl_job_contents", column)
    for name in ("match_type", "source_type", "processed_document_id"):
        op.create_index(f"ix_crawl_job_contents_{name}", "crawl_job_contents", [name])
