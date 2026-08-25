from sqlalchemy import text
from sqlalchemy.orm import Session

from common.db.models import Role


DEFAULT_ROLES = {
    "SYSTEM_ADMIN": "Quản trị viên / Vận hành hệ thống: Quản lý người dùng, giám sát service, hệ thống log và dữ liệu Global.",
    "CREATOR": "Người dùng sáng tạo nội dung: Quản lý tài khoản kênh, chiến lược, tự crawl dữ liệu riêng, lập kế hoạch AI, sản xuất video và lên lịch đăng bài.",
}


def ensure_roles(db: Session) -> None:
    existing = {role.name for role in db.query(Role).all()}
    for name, description in DEFAULT_ROLES.items():
        if name not in existing:
            db.add(Role(name=name, description=description))
    db.commit()


def ensure_schema_compatibility(db: Session) -> None:
    db.execute(
        text(
            """
            DO $$
            BEGIN
                IF to_regclass('social_profile_strategies') IS NOT NULL THEN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'social_profile_strategies'
                          AND column_name = 'auto_handoff_enabled'
                    ) AND NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'social_profile_strategies'
                          AND column_name = 'auto_project_queue_enabled'
                    ) THEN
                        ALTER TABLE social_profile_strategies
                        RENAME COLUMN auto_handoff_enabled TO auto_project_queue_enabled;
                    END IF;

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS receive_system_content BOOLEAN DEFAULT TRUE NOT NULL;

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS auto_project_queue_enabled BOOLEAN DEFAULT FALSE NOT NULL;

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS video_render_mode VARCHAR(40) DEFAULT 'manual' NOT NULL;

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS max_system_recommendations INTEGER DEFAULT 20 NOT NULL;
                END IF;

                IF to_regclass('content_items') IS NOT NULL THEN
                    ALTER TABLE content_items
                    ADD COLUMN IF NOT EXISTS crawl_job_id UUID REFERENCES crawl_jobs(id) ON DELETE SET NULL;

                    CREATE INDEX IF NOT EXISTS ix_content_items_crawl_job_id
                    ON content_items (crawl_job_id);
                END IF;

                IF to_regclass('media_workflow') IS NOT NULL THEN
                    CREATE TABLE IF NOT EXISTS planning_runs (
                        id UUID PRIMARY KEY,
                        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
                        workflow_id UUID NOT NULL REFERENCES media_workflow(id) ON DELETE CASCADE,
                        crawl_job_id UUID NULL REFERENCES crawl_jobs(id) ON DELETE SET NULL,
                        planning_mode VARCHAR(40) NOT NULL DEFAULT 'AUTO',
                        status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
                        input_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
                        output_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
                        reason_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        started_at TIMESTAMPTZ NULL,
                        completed_at TIMESTAMPTZ NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );
                    CREATE INDEX IF NOT EXISTS ix_planning_runs_user_id ON planning_runs (user_id);
                    CREATE INDEX IF NOT EXISTS ix_planning_runs_profile_id ON planning_runs (profile_id);
                    CREATE INDEX IF NOT EXISTS ix_planning_runs_workflow_id ON planning_runs (workflow_id);
                    CREATE INDEX IF NOT EXISTS ix_planning_runs_crawl_job_id ON planning_runs (crawl_job_id);
                    CREATE INDEX IF NOT EXISTS ix_planning_runs_planning_mode ON planning_runs (planning_mode);
                    CREATE INDEX IF NOT EXISTS ix_planning_runs_status ON planning_runs (status);

                    CREATE TABLE IF NOT EXISTS planning_candidates (
                        id UUID PRIMARY KEY,
                        planning_run_id UUID NOT NULL REFERENCES planning_runs(id) ON DELETE CASCADE,
                        workflow_id UUID NOT NULL REFERENCES media_workflow(id) ON DELETE CASCADE,
                        content_id UUID NULL REFERENCES content_items(id) ON DELETE SET NULL,
                        rank_order INTEGER NULL,
                        score NUMERIC(5, 2) NOT NULL DEFAULT 0,
                        selected BOOLEAN NOT NULL DEFAULT FALSE,
                        eligible BOOLEAN NOT NULL DEFAULT TRUE,
                        reason_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );
                    CREATE INDEX IF NOT EXISTS ix_planning_candidates_planning_run_id ON planning_candidates (planning_run_id);
                    CREATE INDEX IF NOT EXISTS ix_planning_candidates_workflow_id ON planning_candidates (workflow_id);
                    CREATE INDEX IF NOT EXISTS ix_planning_candidates_content_id ON planning_candidates (content_id);
                    CREATE INDEX IF NOT EXISTS ix_planning_candidates_selected ON planning_candidates (selected);
                END IF;
            END $$;
            """
        )
    )
    db.commit()
