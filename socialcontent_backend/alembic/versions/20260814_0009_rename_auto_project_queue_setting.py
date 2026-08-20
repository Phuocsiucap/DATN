"""Rename automatic project queue setting.

Revision ID: 20260814_0009
Revises: 20260814_0008
Create Date: 2026-08-14 00:09:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260814_0009"
down_revision = "20260814_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'social_profile_strategies'
                  AND column_name = 'auto_handoff_enabled'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'social_profile_strategies'
                  AND column_name = 'auto_project_queue_enabled'
            ) THEN
                ALTER TABLE social_profile_strategies
                RENAME COLUMN auto_handoff_enabled TO auto_project_queue_enabled;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'social_profile_strategies'
                  AND column_name = 'auto_project_queue_enabled'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'social_profile_strategies'
                  AND column_name = 'auto_handoff_enabled'
            ) THEN
                ALTER TABLE social_profile_strategies
                RENAME COLUMN auto_project_queue_enabled TO auto_handoff_enabled;
            END IF;
        END $$;
        """
    )
