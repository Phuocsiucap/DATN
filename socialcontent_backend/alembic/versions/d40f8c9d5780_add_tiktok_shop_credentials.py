"""Add TikTok Shop credentials."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d40f8c9d5780"
down_revision = "0b7a4c9e2d11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tiktok_shop_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("shop_id", sa.String(length=255), nullable=False),
        sa.Column("shop_name", sa.String(length=255), nullable=False),
        sa.Column("shop_cipher", sa.Text(), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authorized_scopes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tiktok_shop_credentials_shop_id", "tiktok_shop_credentials", ["shop_id"])
    op.create_index("ix_tiktok_shop_credentials_status", "tiktok_shop_credentials", ["status"])
    op.create_index("ix_tiktok_shop_credentials_user_id", "tiktok_shop_credentials", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_tiktok_shop_credentials_user_id", table_name="tiktok_shop_credentials")
    op.drop_index("ix_tiktok_shop_credentials_status", table_name="tiktok_shop_credentials")
    op.drop_index("ix_tiktok_shop_credentials_shop_id", table_name="tiktok_shop_credentials")
    op.drop_table("tiktok_shop_credentials")
