"""Track when Global content consumes a profile's daily recommendation quota.

Revision ID: ab73d5e920f1
Revises: 91f5b1c7d2a4
Create Date: 2026-09-01 18:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "ab73d5e920f1"
down_revision = "91f5b1c7d2a4"
branch_labels = None
depends_on = None


ASSIGNED_STATUSES = (
    "RECOMMENDED",
    "WORKFLOW_CREATED",
    "REVIEW_REQUIRED",
    "AI_REJECTED",
    "HUMAN_REJECTED",
    "DRAFT_QUEUED",
    "DRAFT_FAILED",
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("profile_content_links")}
    indexes = {index["name"] for index in inspector.get_indexes("profile_content_links")}
    if "recommended_at" not in columns:
        op.add_column(
            "profile_content_links",
            sa.Column("recommended_at", sa.DateTime(timezone=True), nullable=True),
        )
    statuses = ", ".join(f"'{status}'" for status in ASSIGNED_STATUSES)
    op.execute(
        sa.text(
            f"""
            UPDATE profile_content_links
            SET recommended_at = first_seen_at
            WHERE recommended_at IS NULL
              AND recommendation_status IN ({statuses})
            """
        )
    )
    if op.f("ix_profile_content_links_recommended_at") not in indexes:
        op.create_index(
            op.f("ix_profile_content_links_recommended_at"),
            "profile_content_links",
            ["recommended_at"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index(op.f("ix_profile_content_links_recommended_at"), table_name="profile_content_links")
    op.drop_column("profile_content_links", "recommended_at")
