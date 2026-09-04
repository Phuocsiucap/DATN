"""Add configurable schedules for crawl jobs.

Revision ID: 91f5b1c7d2a4
Revises: e64f0a7c2b93
Create Date: 2026-09-01 16:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "91f5b1c7d2a4"
down_revision = "e64f0a7c2b93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("crawl_job_schedules"):
        op.create_table(
            "crawl_job_schedules",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("job_id", sa.UUID(), nullable=False),
            sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("runs_per_day", sa.SmallInteger(), nullable=False),
            sa.Column("window_start", sa.Time(), nullable=False),
            sa.Column("window_end", sa.Time(), nullable=False),
            sa.Column("weekdays", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("timezone", sa.String(length=80), nullable=False),
            sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["job_id"], ["crawl_jobs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("job_id"),
        )
        existing_indexes: set[str] = set()
    else:
        existing_indexes = {index["name"] for index in inspector.get_indexes("crawl_job_schedules")}

    for name, columns, unique in (
        (op.f("ix_crawl_job_schedules_enabled"), ["enabled"], False),
        (op.f("ix_crawl_job_schedules_job_id"), ["job_id"], True),
        (op.f("ix_crawl_job_schedules_next_run_at"), ["next_run_at"], False),
    ):
        if name not in existing_indexes:
            op.create_index(name, "crawl_job_schedules", columns, unique=unique)


def downgrade() -> None:
    op.drop_index(op.f("ix_crawl_job_schedules_next_run_at"), table_name="crawl_job_schedules")
    op.drop_index(op.f("ix_crawl_job_schedules_job_id"), table_name="crawl_job_schedules")
    op.drop_index(op.f("ix_crawl_job_schedules_enabled"), table_name="crawl_job_schedules")
    op.drop_table("crawl_job_schedules")
