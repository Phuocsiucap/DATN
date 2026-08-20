"""Add profile strategy video render mode.

Revision ID: 20260814_0011
Revises: 20260814_0010
Create Date: 2026-08-14 00:11:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260814_0011"
down_revision = "20260814_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "social_profile_strategies",
        sa.Column("video_render_mode", sa.String(length=40), nullable=False, server_default="manual"),
    )
    op.alter_column("social_profile_strategies", "video_render_mode", server_default=None)


def downgrade() -> None:
    op.drop_column("social_profile_strategies", "video_render_mode")
