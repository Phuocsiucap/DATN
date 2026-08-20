"""Add project part target duration column.

Revision ID: 20260814_0010
Revises: 20260814_0009
Create Date: 2026-08-14 00:10:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260814_0010"
down_revision = "20260814_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("project_parts", sa.Column("target_duration_seconds", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE project_parts
        SET target_duration_seconds = NULLIF(payload->>'target_duration_seconds', '')::integer
        WHERE target_duration_seconds IS NULL
          AND payload ? 'target_duration_seconds'
          AND (payload->>'target_duration_seconds') ~ '^[0-9]+$';
        """
    )


def downgrade() -> None:
    op.drop_column("project_parts", "target_duration_seconds")
