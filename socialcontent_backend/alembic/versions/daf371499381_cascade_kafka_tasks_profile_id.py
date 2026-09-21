"""cascade kafka_tasks profile_id

Revision ID: daf371499381
Revises: 9c1d2e3f4a5b
Create Date: 2026-09-21 00:00:40.704068
"""

from alembic import op
import sqlalchemy as sa



revision = 'daf371499381'
down_revision = '9c1d2e3f4a5b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint('kafka_tasks_profile_id_fkey', 'kafka_tasks', type_='foreignkey')
    op.create_foreign_key('kafka_tasks_profile_id_fkey', 'kafka_tasks', 'social_profiles', ['profile_id'], ['id'], ondelete='CASCADE')

def downgrade() -> None:
    op.drop_constraint('kafka_tasks_profile_id_fkey', 'kafka_tasks', type_='foreignkey')
    op.create_foreign_key('kafka_tasks_profile_id_fkey', 'kafka_tasks', 'social_profiles', ['profile_id'], ['id'])
