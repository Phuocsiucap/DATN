"""widen strategy target audience

Revision ID: e2f4a6b8c9d1
Revises: daf371499381
Create Date: 2026-09-26 14:20:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "e2f4a6b8c9d1"
down_revision = "daf371499381"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "social_profile_strategies",
        "target_audience",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=False,
        existing_server_default=None,
    )


def downgrade() -> None:
    op.alter_column(
        "social_profile_strategies",
        "target_audience",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=False,
        existing_server_default=None,
    )
