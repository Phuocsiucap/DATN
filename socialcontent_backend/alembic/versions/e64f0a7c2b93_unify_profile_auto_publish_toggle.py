"""Unify the profile schedule and automatic publishing toggles.

Revision ID: e64f0a7c2b93
Revises: d6c2f4a9b81e
Create Date: 2026-08-31 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "e64f0a7c2b93"
down_revision = "d6c2f4a9b81e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Preserve the old scheduler's effective opt-in before removing its gate.
    op.execute(
        "UPDATE social_profile_strategies "
        "SET auto_publish_enabled = auto_publish_enabled AND schedule_enabled"
    )
    op.drop_column("social_profile_strategies", "schedule_enabled")


def downgrade() -> None:
    # Recreate the former default gate; auto_publish_enabled keeps the opt-in.
    op.add_column(
        "social_profile_strategies",
        sa.Column("schedule_enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.alter_column("social_profile_strategies", "schedule_enabled", server_default=None)
