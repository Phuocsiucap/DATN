"""Make daily publish frequency optional and align publishing to each minute.

Revision ID: d4a6c8e91f20
Revises: bc84e6fa31d2
Create Date: 2026-09-02 22:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "d4a6c8e91f20"
down_revision = "bc84e6fa31d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "social_profile_strategies",
        "post_frequency_per_day",
        existing_type=sa.Integer(),
        nullable=True,
        server_default=None,
    )
    op.execute(
        "UPDATE social_profile_strategies "
        "SET post_frequency_per_day = NULL "
        "WHERE post_frequency_per_day = 2"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_publishing_queue_due_auto "
        "ON publishing_queue_items (scheduled_at, created_at) "
        "WHERE status IN ('queued', 'approved') AND scheduled_at IS NOT NULL"
    )
    op.execute(
        "UPDATE system_settings "
        "SET value = jsonb_set(COALESCE(value, '{}'::jsonb), "
        "'{publish_queue_interval_minutes}', '1'::jsonb, TRUE) "
        "WHERE key = 'scheduler_settings' "
        "AND COALESCE((value->>'publish_queue_interval_minutes')::integer, 5) = 5"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_publishing_queue_due_auto")
    op.execute(
        "UPDATE social_profile_strategies "
        "SET post_frequency_per_day = 2 "
        "WHERE post_frequency_per_day IS NULL"
    )
    op.alter_column(
        "social_profile_strategies",
        "post_frequency_per_day",
        existing_type=sa.Integer(),
        nullable=False,
        server_default=None,
    )
