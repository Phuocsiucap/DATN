CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE module2_handoffs
ADD COLUMN IF NOT EXISTS strategy_snapshot JSON DEFAULT '{}'::json NOT NULL;

ALTER TABLE module2_handoff_items
ADD COLUMN IF NOT EXISTS source_crawl_job_id UUID NULL,
ADD COLUMN IF NOT EXISTS item_role VARCHAR(60) DEFAULT 'MANUAL_INCLUDED' NOT NULL,
ADD COLUMN IF NOT EXISTS relation_reason VARCHAR(80) NULL,
ADD COLUMN IF NOT EXISTS similarity_score NUMERIC(6, 4) NULL,
ADD COLUMN IF NOT EXISTS candidate_score NUMERIC(5, 2) NULL,
ADD COLUMN IF NOT EXISTS metadata JSON DEFAULT '{}'::json NOT NULL;

CREATE INDEX IF NOT EXISTS ix_module2_handoff_items_source_crawl_job_id
ON module2_handoff_items (source_crawl_job_id);

CREATE INDEX IF NOT EXISTS ix_module2_handoff_items_item_role
ON module2_handoff_items (item_role);

CREATE INDEX IF NOT EXISTS ix_module2_handoff_items_relation_reason
ON module2_handoff_items (relation_reason);

CREATE TABLE IF NOT EXISTS content_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    embedding JSON NOT NULL,
    embedding_text TEXT NOT NULL,
    embedding_text_hash VARCHAR(128) NOT NULL,
    model_name VARCHAR(120) NOT NULL,
    model_version VARCHAR(80) NULL,
    embedding_dim INT NOT NULL,
    source_language VARCHAR(12) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_content_embedding_model UNIQUE (content_id, model_name)
);

CREATE INDEX IF NOT EXISTS ix_content_embeddings_content_id
ON content_embeddings (content_id);

CREATE INDEX IF NOT EXISTS ix_content_embeddings_embedding_text_hash
ON content_embeddings (embedding_text_hash);

CREATE INDEX IF NOT EXISTS ix_content_embeddings_model_name
ON content_embeddings (model_name);

CREATE TABLE IF NOT EXISTS profile_content_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
    content_id UUID NULL REFERENCES content_items(id) ON DELETE CASCADE,
    story_id UUID NULL REFERENCES stories(id) ON DELETE CASCADE,
    relation_type VARCHAR(60) NOT NULL,
    relation_reason VARCHAR(80) NULL,
    score NUMERIC(5, 2) NOT NULL DEFAULT 0,
    status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    metadata JSON NOT NULL DEFAULT '{}'::json,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_profile_content_links_user_id
ON profile_content_links (user_id);

CREATE INDEX IF NOT EXISTS ix_profile_content_links_profile_id
ON profile_content_links (profile_id);

CREATE INDEX IF NOT EXISTS ix_profile_content_links_content_id
ON profile_content_links (content_id);

CREATE INDEX IF NOT EXISTS ix_profile_content_links_story_id
ON profile_content_links (story_id);

CREATE INDEX IF NOT EXISTS ix_profile_content_links_relation_type
ON profile_content_links (relation_type);

CREATE INDEX IF NOT EXISTS ix_profile_content_links_status
ON profile_content_links (status);

CREATE TABLE IF NOT EXISTS profile_series_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
    story_id UUID NULL REFERENCES stories(id) ON DELETE SET NULL,
    content_series_id UUID NULL REFERENCES content_series(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    current_part INT NOT NULL DEFAULT 0,
    total_parts INT NOT NULL DEFAULT 0,
    last_planned_at TIMESTAMPTZ NULL,
    last_published_at TIMESTAMPTZ NULL,
    metadata JSON NOT NULL DEFAULT '{}'::json,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_profile_series_tracks_user_id
ON profile_series_tracks (user_id);

CREATE INDEX IF NOT EXISTS ix_profile_series_tracks_profile_id
ON profile_series_tracks (profile_id);

CREATE INDEX IF NOT EXISTS ix_profile_series_tracks_story_id
ON profile_series_tracks (story_id);

CREATE INDEX IF NOT EXISTS ix_profile_series_tracks_content_series_id
ON profile_series_tracks (content_series_id);

CREATE INDEX IF NOT EXISTS ix_profile_series_tracks_status
ON profile_series_tracks (status);
