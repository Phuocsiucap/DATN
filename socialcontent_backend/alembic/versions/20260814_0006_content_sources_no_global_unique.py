"""Remove global unique content source identity.

Revision ID: 20260814_0006
Revises: 20260814_0005
Create Date: 2026-08-14
"""

from alembic import op


revision = "20260814_0006"
down_revision = "20260814_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE content_sources DROP CONSTRAINT IF EXISTS uq_content_source_external")
    op.execute("CREATE INDEX IF NOT EXISTS ix_content_sources_source_identity ON content_sources (source_type, source_external_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_content_sources_source_identity")
    op.create_unique_constraint("uq_content_source_external", "content_sources", ["source_type", "source_external_id"])
