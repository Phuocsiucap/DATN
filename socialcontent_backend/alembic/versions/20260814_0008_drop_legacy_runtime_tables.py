"""Drop legacy handoff/planning/series runtime tables.

Revision ID: 20260814_0008
Revises: 20260814_0007
Create Date: 2026-08-14 00:08:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260814_0008"
down_revision = "20260814_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in [
        "production_project_parts",
        "production_projects",
        "profile_series_tracks",
        "content_contexts",
        "series_parts",
        "content_series",
        "planning_candidates",
        "planning_jobs",
        "module2_handoff_items",
        "module2_handoffs",
    ]:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')


def downgrade() -> None:
    pass
