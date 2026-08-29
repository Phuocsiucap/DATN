"""drop_unused_strategy_score_columns

Revision ID: b42f6e18c9d2
Revises: a31c4d2e9b07
Create Date: 2026-08-29 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "b42f6e18c9d2"
down_revision = "a31c4d2e9b07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE social_profile_strategies DROP COLUMN IF EXISTS min_score")
    op.execute("ALTER TABLE social_profile_strategies DROP COLUMN IF EXISTS relevance_weight")


def downgrade() -> None:
    op.add_column(
        "social_profile_strategies",
        sa.Column("relevance_weight", sa.Float(), server_default="1.0", nullable=False),
    )
    op.add_column(
        "social_profile_strategies",
        sa.Column("min_score", sa.Float(), server_default="70.0", nullable=False),
    )
    op.alter_column("social_profile_strategies", "relevance_weight", server_default=None)
    op.alter_column("social_profile_strategies", "min_score", server_default=None)
