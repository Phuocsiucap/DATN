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


def _schema_has_columns(db: Session, table_name: str, column_names: set[str]) -> bool:
    existing = set(
        db.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = :table_name
                """
            ),
            {"table_name": table_name},
        ).scalars()
    )
    return column_names.issubset(existing)


def _schema_has_relation(db: Session, relation_name: str) -> bool:
    return bool(db.execute(text("SELECT to_regclass(:relation_name) IS NOT NULL"), {"relation_name": relation_name}).scalar())


def _schema_has_constraint(db: Session, constraint_name: str) -> bool:
    return bool(
        db.execute(
            text("SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = :constraint_name)"),
            {"constraint_name": constraint_name},
        ).scalar()
    )


def _schema_compatibility_current(db: Session) -> bool:
    required_tables = {
        "social_profile_strategies",
        "content_items",
        "social_profiles",
        "publishing_queue_items",
        "social_posts",
        "planning_runs",
        "planning_candidates",
        "content_embeddings",
        "topic_embeddings",
    }
    if not all(_schema_has_relation(db, table) for table in required_tables):
        return False

    required_columns = {
        "social_profile_strategies": {
            "receive_system_content",
            "auto_project_queue_enabled",
            "video_render_mode",
            "max_system_recommendations",
            "min_similarity",
            "avoid_similarity_threshold",
            "content_topic_descriptions",
            "avoid_topic_descriptions",
        },
        "content_items": {"crawl_job_id"},
        "social_profiles": {
            "external_id",
            "avatar_url",
            "follower_count",
            "following_count",
            "likes_count",
            "video_count",
            "access_token",
            "refresh_token",
            "token_expires_at",
            "refresh_expires_at",
            "scopes_jsonb",
            "metadata",
        },
        "publishing_queue_items": {
            "platform_publish_id",
            "publish_status",
        },
        "social_posts": {
            "platform_publish_id",
        },
        "topic_embeddings": {"embedding_text_hash"},
    }
    if not all(_schema_has_columns(db, table, columns) for table, columns in required_columns.items()):
        return False

    return _schema_has_constraint(db, "uq_topic_embedding_model_text")


def ensure_schema_compatibility(db: Session) -> None:
    import time
    from sqlalchemy.exc import OperationalError

    try:
        if _schema_compatibility_current(db):
            return
    except Exception:
        db.rollback()

    max_retries = 3
    for attempt in range(max_retries):
        try:
            db.execute(text("SELECT pg_advisory_xact_lock(872910481)"))
            db.execute(
                text(
                    """
            DO $$
            BEGIN
                BEGIN
                    CREATE EXTENSION IF NOT EXISTS vector;
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'pgvector extension is not available: %', SQLERRM;
                END;

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

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS min_similarity DOUBLE PRECISION DEFAULT 0.62 NOT NULL;

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS avoid_similarity_threshold DOUBLE PRECISION DEFAULT 0.72 NOT NULL;

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS content_topic_descriptions JSONB DEFAULT '{}'::jsonb NOT NULL;

                    ALTER TABLE social_profile_strategies
                    ADD COLUMN IF NOT EXISTS avoid_topic_descriptions JSONB DEFAULT '{}'::jsonb NOT NULL;
                END IF;

                IF to_regclass('content_items') IS NOT NULL THEN
                    ALTER TABLE content_items
                    ADD COLUMN IF NOT EXISTS crawl_job_id UUID REFERENCES crawl_jobs(id) ON DELETE SET NULL;

                    CREATE INDEX IF NOT EXISTS ix_content_items_crawl_job_id
                    ON content_items (crawl_job_id);
                END IF;

                IF to_regclass('social_profiles') IS NOT NULL THEN
                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS avatar_url TEXT;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS follower_count INTEGER;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS following_count INTEGER;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS likes_count INTEGER;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS video_count INTEGER;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS access_token TEXT;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS refresh_token TEXT;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS scopes_jsonb JSONB DEFAULT '[]'::jsonb NOT NULL;

                    ALTER TABLE social_profiles
                    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb NOT NULL;

                    CREATE INDEX IF NOT EXISTS ix_social_profiles_external_id
                    ON social_profiles (external_id);

                    CREATE INDEX IF NOT EXISTS ix_social_profiles_user_platform_external_id
                    ON social_profiles (user_id, platform, external_id);
                END IF;

                IF to_regclass('publishing_queue_items') IS NOT NULL THEN
                    ALTER TABLE publishing_queue_items
                    ADD COLUMN IF NOT EXISTS platform_publish_id VARCHAR(255);

                    ALTER TABLE publishing_queue_items
                    ADD COLUMN IF NOT EXISTS publish_status JSONB DEFAULT '{}'::jsonb NOT NULL;

                    CREATE INDEX IF NOT EXISTS ix_publishing_queue_items_platform_publish_id
                    ON publishing_queue_items (platform_publish_id);
                END IF;

                IF to_regclass('social_posts') IS NOT NULL THEN
                    ALTER TABLE social_posts
                    ADD COLUMN IF NOT EXISTS platform_publish_id VARCHAR(255);

                    CREATE INDEX IF NOT EXISTS ix_social_posts_platform_publish_id
                    ON social_posts (platform_publish_id);
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

                IF to_regclass('content_embeddings') IS NOT NULL THEN
                    BEGIN
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'content_embeddings'
                              AND column_name = 'embedding'
                              AND udt_name = 'jsonb'
                        ) THEN
                            ALTER TABLE content_embeddings
                            ALTER COLUMN embedding TYPE vector
                            USING (embedding::text::vector);
                        END IF;
                    EXCEPTION WHEN OTHERS THEN
                        RAISE NOTICE 'Could not migrate content_embeddings.embedding to vector: %', SQLERRM;
                    END;
                END IF;

                CREATE TABLE IF NOT EXISTS topic_embeddings (
                    id UUID PRIMARY KEY,
                    topic_key VARCHAR(255) NOT NULL,
                    topic TEXT NOT NULL,
                    embedding_text TEXT NOT NULL,
                    embedding_text_hash VARCHAR(64) NOT NULL,
                    embedding vector NOT NULL,
                    model_name VARCHAR(120) NOT NULL,
                    embedding_dim INTEGER NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    CONSTRAINT uq_topic_embedding_model_text UNIQUE (topic_key, model_name, embedding_text_hash)
                );
                ALTER TABLE topic_embeddings ADD COLUMN IF NOT EXISTS embedding_text_hash VARCHAR(64);
                UPDATE topic_embeddings
                SET embedding_text_hash = md5(COALESCE(embedding_text, ''))
                WHERE embedding_text_hash IS NULL;
                ALTER TABLE topic_embeddings ALTER COLUMN embedding_text_hash SET NOT NULL;
                ALTER TABLE topic_embeddings DROP CONSTRAINT IF EXISTS uq_topic_embedding_model;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'uq_topic_embedding_model_text'
                ) THEN
                    ALTER TABLE topic_embeddings
                    ADD CONSTRAINT uq_topic_embedding_model_text UNIQUE (topic_key, model_name, embedding_text_hash);
                END IF;
                CREATE INDEX IF NOT EXISTS ix_topic_embeddings_topic_key ON topic_embeddings (topic_key);
                CREATE INDEX IF NOT EXISTS ix_topic_embeddings_model_name ON topic_embeddings (model_name);
                CREATE INDEX IF NOT EXISTS ix_topic_embeddings_embedding_text_hash ON topic_embeddings (embedding_text_hash);
            END $$;
            """
                )
            )
            db.commit()
            break
        except OperationalError as exc:
            db.rollback()
            if attempt == max_retries - 1:
                print(f"[bootstrap] ensure_schema_compatibility warning after {max_retries} attempts: {exc}")
            else:
                time.sleep(1)
        except Exception as exc:
            db.rollback()
            print(f"[bootstrap] ensure_schema_compatibility error: {exc}")
            break
