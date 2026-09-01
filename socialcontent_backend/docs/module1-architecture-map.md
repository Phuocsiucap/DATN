# Module 1 Architecture Map

This backend follows `.agents/module1` as a four-worker FastAPI system:

- API Service: REST API, PostgreSQL state, user/admin system, Kafka producer.
- Crawl Orchestrator: consumes `crawl.job.created`, creates crawl tasks, emits `crawl.task.requested`.
- Crawler Service: consumes crawl tasks, crawls and normalizes directly, writes MongoDB `processed_documents`, emits `content.normalized`.
- Story Processing Service: consumes normalized refs, writes PostgreSQL canonical content, stories, episodes, duplicates, and processing runs; embedding is delegated to the ai-media planning worker via Kafka.

VNExpress legacy crawler integration:

- RSS discovery and article-detail extraction run in `services/data-ingestion-engine/app/crawler/crawlers/vnexpress.py`.
- The adapter writes one normalized MongoDB `processed_documents` record per article and emits one `content.normalized` event per processed document.
- Supported VNExpress configuration:
  - `max_items` or `limit`: number of articles, capped at 30.
  - `exclude_keywords`: list or comma-separated string.
  - `timeout_seconds`: HTTP timeout.
  - `user_agent`: override default browser-like user agent.
- It extracts title, article paragraphs, image URLs, video URLs, embed URLs, source URL, VNExpress article id, category id, site id, and media references directly into the canonical normalized shape.
- It also extracts description, author, published_at, category, tags, HTTP metadata, response timing, and crawl quality metadata.

Bilibili legacy crawler integration:

- The old manual Bilibili flow was reviewed across `backend/bilibili_service` and `backend/gateway`.
- The new `services/crawler-service/app/crawlers/bilibili.py` keeps metadata discovery only:
  - WBI search over Bilibili keywords.
  - candidate ranking/dedup by title, series key, `bvid`, `aid`.
  - direct URL resolution for `aid`/`bvid`.
  - view-detail and view fallback metadata fetch.
  - `ugc_season`, page-list, season archive API, and page-state hints for full episode lists.
- Heavy video processing from the old pipeline is intentionally not ported into Module 1:
  - no video download
  - no OCR/STT
  - no translation
  - no rendering/re-encoding
- The crawler stores normalized MongoDB metadata documents with `metadata_only=true`, `content_type=PLAYLIST` for multi-episode collections, `episode_count`, `episodes`, `season_id`, `season_title`, source refs, thumbnail/player URLs, and review/danmaku counts.
- Story Processing persists Bilibili source metadata summary into `content_sources.metadata`, media refs into `content_media`, and creates one `episodes` row per discovered episode.
- Source duplicates are handled before canonical insert by `source_type + source_external_id`, so re-crawling the same Bilibili playlist/video updates the existing canonical reference instead of creating duplicate content.

Operational hardening added after reviewing `.agents/structure_professional.drawio.xml`:

- `crawl_logs` records discovery, crawling, normalization, grouping, skipped URLs, errors, and terminal status.
- `crawl_logs` remains available to operators for direct audit/debug queries.
- Crawler tasks support retry/backoff with `configuration.max_attempts` and `configuration.retry_backoff_seconds`.
- Permanent crawler and normalization failures emit `dead-letter.content`.
- Job finalization sets `SUCCEEDED`, `PARTIAL_SUCCESS`, or `FAILED` only after active tasks finish and normalized documents are saved canonically or accounted for as failed.
- Crawl Orchestrator includes a lightweight source scheduler for `SOURCE_CONFIG` jobs with `configuration.schedule_enabled=true`.
- Crawl Orchestrator commits tasks before publishing `crawl.task.requested`.
- Job cancellation is honored by crawler and story-processing workers.
- Job retry resets counters/progress and recreates tasks from the existing source configuration.
- Canonical writer persists publish dates, source publish dates, content media, story/episode rows, and processing runs for Module 2 consumption.
- Basic deduplication follows the Module 1 order for MVP: source external id first, exact URL, content hash, then transcript hash.

Each worker service now keeps `main.py` as a composition root only:

- `consumers/`: Kafka subscription loops.
- `producers/`: event publication helpers.
- `services/`: business orchestration.
- `repositories/`: MongoDB/PostgreSQL persistence boundaries where relevant.

API schemas are split by domain under `services/api-service/app/schemas/`:

- `auth.py`
- `users.py`
- `crawl_jobs.py`
- `sources.py`
- `contents.py`
- `stories.py`
- `api.py` remains a compatibility re-export.

Admin/user additions:

- `users`, `roles`, `user_roles`
- `SYSTEM_ADMIN`, `ADMIN`, `USER`
- `system_settings`
- `audit_logs`
- bootstrap endpoint: `POST /api/v1/admin/system/bootstrap`

User-owned account additions ported from the old backend:

- `social_profiles`: each social account belongs to exactly one user.
- `social_profile_strategies`: per-account automation strategy.
- `publishing_queue_items`: per-user/per-profile queue.
- `social_posts` and `social_post_metrics`: per-profile publishing history and growth metrics.
- User routes enforce ownership by filtering `SocialProfile.user_id == current_user.id`.
- System admin user management includes create/update/delete safeguards:
  - cannot delete yourself
  - cannot deactivate yourself
  - cannot remove your own `SYSTEM_ADMIN` role
