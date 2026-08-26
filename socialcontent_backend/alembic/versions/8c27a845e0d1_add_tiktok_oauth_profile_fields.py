"""add_tiktok_oauth_profile_fields

Revision ID: 8c27a845e0d1
Revises: f7f1e3cc8d41
Create Date: 2026-08-25 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "8c27a845e0d1"
down_revision = "f7f1e3cc8d41"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("social_profiles", sa.Column("external_id", sa.String(length=255), nullable=True))
    op.add_column("social_profiles", sa.Column("avatar_url", sa.Text(), nullable=True))
    op.add_column("social_profiles", sa.Column("access_token", sa.Text(), nullable=True))
    op.add_column("social_profiles", sa.Column("refresh_token", sa.Text(), nullable=True))
    op.add_column("social_profiles", sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("social_profiles", sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "social_profiles",
        sa.Column(
            "scopes_jsonb",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "social_profiles",
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.create_index(op.f("ix_social_profiles_external_id"), "social_profiles", ["external_id"], unique=False)
    op.create_index(
        "ix_social_profiles_user_platform_external_id",
        "social_profiles",
        ["user_id", "platform", "external_id"],
        unique=False,
    )
    op.alter_column("social_profiles", "scopes_jsonb", server_default=None)
    op.alter_column("social_profiles", "metadata", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_social_profiles_user_platform_external_id", table_name="social_profiles")
    op.drop_index(op.f("ix_social_profiles_external_id"), table_name="social_profiles")
    op.drop_column("social_profiles", "metadata")
    op.drop_column("social_profiles", "scopes_jsonb")
    op.drop_column("social_profiles", "refresh_expires_at")
    op.drop_column("social_profiles", "token_expires_at")
    op.drop_column("social_profiles", "refresh_token")
    op.drop_column("social_profiles", "access_token")
    op.drop_column("social_profiles", "avatar_url")
    op.drop_column("social_profiles", "external_id")
