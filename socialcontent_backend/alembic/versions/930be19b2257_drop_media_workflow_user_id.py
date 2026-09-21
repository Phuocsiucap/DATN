"""drop media workflow user id

Revision ID: 930be19b2257
Revises: 1770b5e5ab6b
Create Date: 2026-09-10 23:47:38.039650
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql



revision = '930be19b2257'
down_revision = '1770b5e5ab6b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("media_workflow")}
    if "user_id" not in columns:
        return

    indexes = {index["name"] for index in inspector.get_indexes("media_workflow")}
    if "ix_media_workflow_user_id" in indexes:
        op.drop_index("ix_media_workflow_user_id", table_name="media_workflow")

    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("media_workflow")}
    if "media_workflow_user_id_fkey" in foreign_keys:
        op.drop_constraint("media_workflow_user_id_fkey", "media_workflow", type_="foreignkey")

    op.drop_column("media_workflow", "user_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("media_workflow")}
    if "user_id" in columns:
        return

    op.add_column("media_workflow", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        """
        UPDATE media_workflow AS mw
        SET user_id = sp.user_id
        FROM social_profiles AS sp
        WHERE mw.profile_id = sp.id
        """
    )
    op.alter_column("media_workflow", "user_id", nullable=False)
    op.create_foreign_key(
        "media_workflow_user_id_fkey",
        "media_workflow",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_media_workflow_user_id", "media_workflow", ["user_id"], unique=False)
