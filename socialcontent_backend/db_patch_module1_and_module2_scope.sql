-- DB Patch for Global (System Crawl) vs Private (User Crawl) Scope & Profile Recommendation Settings

ALTER TABLE crawl_jobs
ADD COLUMN IF NOT EXISTS content_scope VARCHAR(40) DEFAULT 'GLOBAL' NOT NULL,
ADD COLUMN IF NOT EXISTS created_by_type VARCHAR(40) DEFAULT 'SYSTEM' NOT NULL;

CREATE INDEX IF NOT EXISTS ix_crawl_jobs_content_scope ON crawl_jobs(content_scope);

ALTER TABLE content_items
ADD COLUMN IF NOT EXISTS content_scope VARCHAR(40) DEFAULT 'GLOBAL' NOT NULL,
ADD COLUMN IF NOT EXISTS owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS created_by_type VARCHAR(40) DEFAULT 'SYSTEM' NOT NULL;

CREATE INDEX IF NOT EXISTS ix_content_items_content_scope ON content_items(content_scope);
CREATE INDEX IF NOT EXISTS ix_content_items_owner_user_id ON content_items(owner_user_id);

ALTER TABLE social_profile_strategies
ADD COLUMN IF NOT EXISTS receive_system_content BOOLEAN DEFAULT TRUE NOT NULL,
ADD COLUMN IF NOT EXISTS auto_handoff_enabled BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS auto_planning_enabled BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS max_system_recommendations INT DEFAULT 20 NOT NULL;

ALTER TABLE profile_content_links
ADD COLUMN IF NOT EXISTS source_scope VARCHAR(40) DEFAULT 'GLOBAL' NOT NULL,
ADD COLUMN IF NOT EXISTS recommendation_status VARCHAR(60) DEFAULT 'RECOMMENDED' NOT NULL;

CREATE INDEX IF NOT EXISTS ix_profile_content_links_source_scope ON profile_content_links(source_scope);
CREATE INDEX IF NOT EXISTS ix_profile_content_links_recommendation_status ON profile_content_links(recommendation_status);
