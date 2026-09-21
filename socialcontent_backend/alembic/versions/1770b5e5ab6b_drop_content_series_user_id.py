"""drop content series user id

Revision ID: 1770b5e5ab6b
Revises: 17dd69adcc27
Create Date: 2026-09-10 23:41:58.617585
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql



revision = '1770b5e5ab6b'
down_revision = '17dd69adcc27'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("content_series")}
    if "user_id" not in columns:
        return

    indexes = {index["name"] for index in inspector.get_indexes("content_series")}
    if "ix_content_series_user_id" in indexes:
        op.drop_index("ix_content_series_user_id", table_name="content_series")

    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("content_series")}
    if "content_series_user_id_fkey" in foreign_keys:
        op.drop_constraint("content_series_user_id_fkey", "content_series", type_="foreignkey")

    op.drop_column("content_series", "user_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("content_series")}
    if "user_id" in columns:
        return

    op.add_column("content_series", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        """
        UPDATE content_series AS cs
        SET user_id = sp.user_id
        FROM social_profiles AS sp
        WHERE cs.profile_id = sp.id
        """
    )
    op.alter_column("content_series", "user_id", nullable=False)
    op.create_foreign_key(
        "content_series_user_id_fkey",
        "content_series",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_content_series_user_id", "content_series", ["user_id"], unique=False)
