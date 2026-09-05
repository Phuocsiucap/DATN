"""add_user_avatar_url

Revision ID: a2ca78e8ef1b
Revises: f86b2c4d0e13
Create Date: 2026-09-05 14:32:40.526872
"""

from alembic import op
import sqlalchemy as sa



revision = 'a2ca78e8ef1b'
down_revision = 'f86b2c4d0e13'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_url', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'avatar_url')
