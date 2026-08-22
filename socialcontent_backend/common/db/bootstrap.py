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
                    ADD COLUMN IF NOT EXISTS auto_planning_enabled BOOLEAN DEFAULT FALSE NOT NULL;

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS video_render_mode VARCHAR(40) DEFAULT 'manual' NOT NULL;

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS max_system_recommendations INTEGER DEFAULT 20 NOT NULL;
                END IF;
            END $$;
            """
        )
    )
    db.commit()
