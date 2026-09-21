"""drop social profile strategy user id

Revision ID: de080a3a054b
Revises: 930be19b2257
Create Date: 2026-09-10 23:59:36.058176
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql



revision = 'de080a3a054b'
down_revision = '930be19b2257'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("social_profile_strategies")}
    if "user_id" not in columns:
        return

    indexes = {index["name"] for index in inspector.get_indexes("social_profile_strategies")}
    if "ix_social_profile_strategies_user_id" in indexes:
        op.drop_index("ix_social_profile_strategies_user_id", table_name="social_profile_strategies")

    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("social_profile_strategies")}
    if "social_profile_strategies_user_id_fkey" in foreign_keys:
        op.drop_constraint("social_profile_strategies_user_id_fkey", "social_profile_strategies", type_="foreignkey")

    op.drop_column("social_profile_strategies", "user_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("social_profile_strategies")}
    if "user_id" in columns:
        return

    op.add_column("social_profile_strategies", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        """
        UPDATE social_profile_strategies AS sps
        SET user_id = sp.user_id
        FROM social_profiles AS sp
        WHERE sps.profile_id = sp.id
        """
    )
    op.alter_column("social_profile_strategies", "user_id", nullable=False)
    op.create_foreign_key(
        "social_profile_strategies_user_id_fkey",
        "social_profile_strategies",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_social_profile_strategies_user_id", "social_profile_strategies", ["user_id"], unique=False)
