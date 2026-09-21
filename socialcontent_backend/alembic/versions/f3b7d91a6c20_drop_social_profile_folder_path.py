"""drop_social_profile_folder_path

Revision ID: f3b7d91a6c20
Revises: a2ca78e8ef1b
Create Date: 2026-09-10 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "f3b7d91a6c20"
down_revision = "a2ca78e8ef1b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("social_profiles_folder_path_key", "social_profiles", type_="unique")
    op.drop_column("social_profiles", "folder_path")


def downgrade() -> None:
    op.add_column("social_profiles", sa.Column("folder_path", sa.String(length=500), nullable=True))
    op.execute("UPDATE social_profiles SET folder_path = 'api-profiles/legacy/' || id::text WHERE folder_path IS NULL")
    op.alter_column("social_profiles", "folder_path", nullable=False)
    op.create_unique_constraint("social_profiles_folder_path_key", "social_profiles", ["folder_path"])
