"""Attach planning output to project runs

Revision ID: 20260814_0007
Revises: 20260814_0006
Create Date: 2026-08-14 00:07:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "20260814_0007"
down_revision = "20260814_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS project_id UUID')
    op.execute('ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS project_run_id UUID')
    op.execute('CREATE INDEX IF NOT EXISTS ix_content_plans_project_id ON content_plans (project_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_content_plans_project_run_id ON content_plans (project_run_id)')
    op.execute('ALTER TABLE content_plans ALTER COLUMN planning_job_id DROP NOT NULL')
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_content_plans_project_id_content_projects'
            ) THEN
                ALTER TABLE content_plans
                ADD CONSTRAINT fk_content_plans_project_id_content_projects
                FOREIGN KEY (project_id) REFERENCES content_projects (id) ON DELETE SET NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_content_plans_project_run_id_project_runs'
            ) THEN
                ALTER TABLE content_plans
                ADD CONSTRAINT fk_content_plans_project_run_id_project_runs
                FOREIGN KEY (project_run_id) REFERENCES project_runs (id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )
    op.execute('ALTER TABLE content_plans ALTER COLUMN project_run_id DROP NOT NULL')

    op.execute('ALTER TABLE prompt_runs ADD COLUMN IF NOT EXISTS project_run_id UUID')
    op.execute('CREATE INDEX IF NOT EXISTS ix_prompt_runs_project_run_id ON prompt_runs (project_run_id)')
    op.execute('ALTER TABLE prompt_runs ALTER COLUMN planning_job_id DROP NOT NULL')
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_prompt_runs_project_run_id_project_runs'
            ) THEN
                ALTER TABLE prompt_runs
                ADD CONSTRAINT fk_prompt_runs_project_run_id_project_runs
                FOREIGN KEY (project_run_id) REFERENCES project_runs (id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )
    op.execute('ALTER TABLE prompt_runs ALTER COLUMN project_run_id DROP NOT NULL')


def downgrade() -> None:
    op.execute('ALTER TABLE prompt_runs DROP CONSTRAINT IF EXISTS fk_prompt_runs_project_run_id_project_runs')
    op.execute('DROP INDEX IF EXISTS ix_prompt_runs_project_run_id')
    op.execute('ALTER TABLE prompt_runs DROP COLUMN IF EXISTS project_run_id')

    op.execute('ALTER TABLE content_plans DROP CONSTRAINT IF EXISTS fk_content_plans_project_run_id_project_runs')
    op.execute('ALTER TABLE content_plans DROP CONSTRAINT IF EXISTS fk_content_plans_project_id_content_projects')
    op.execute('DROP INDEX IF EXISTS ix_content_plans_project_run_id')
    op.execute('DROP INDEX IF EXISTS ix_content_plans_project_id')
    op.execute('ALTER TABLE content_plans DROP COLUMN IF EXISTS project_run_id')
    op.execute('ALTER TABLE content_plans DROP COLUMN IF EXISTS project_id')
