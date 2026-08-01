# Module 1 Architecture Map

This backend follows `.agents/module1` as a five-service FastAPI system:

- API Service: REST API, PostgreSQL state, user/admin system, Kafka producer.
- Crawl Orchestrator: consumes `crawl.job.created`, creates crawl tasks, emits `crawl.task.requested`.
- Crawler Service: consumes crawl tasks, persists MongoDB `raw_documents`, emits `content.raw.created`.
- Normalization Service: consumes raw refs, writes MongoDB `processed_documents`, emits `content.normalized`.
- Story Processing Service: consumes normalized refs, writes PostgreSQL canonical content, stories, episodes, duplicates, processing runs.

VNExpress legacy crawler integration:

- Legacy RSS/homepage discovery and article-detail extraction were ported into `services/crawler-service/app/crawlers/vnexpress.py`.
- The new adapter no longer emits the old `vnexpress.article.crawled` event. It writes one MongoDB `raw_documents` record per article and emits one `content.raw.created` event per raw document.
- Supported VNExpress configuration:
  - `max_items` or `limit`: number of articles, capped at 30.
  - `exclude_keywords`: list or comma-separated string.
  - `timeout_seconds`: HTTP timeout.
  - `user_agent`: override default browser-like user agent.
- It extracts title, article paragraphs, image URLs, video URLs, source URL, VNExpress article id, and media references for downstream normalization.
- It now also extracts description, author, published_at, category, tags, HTTP metadata, response timing, and raw HTML.

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
- The crawler stores raw MongoDB metadata documents with `metadata_only=true`, `content_type=PLAYLIST` for multi-episode collections, `episode_count`, `episodes`, `season_id`, `season_title`, source refs, thumbnail/player URLs, and review/danmaku counts.
- Normalization preserves Bilibili metadata fields in MongoDB processed documents instead of flattening them away.
- Story Processing persists Bilibili source metadata summary into `content_sources.metadata`, media refs into `content_media`, and creates one `episodes` row per discovered episode.
- Source duplicates are handled before canonical insert by `source_type + source_external_id`, so re-crawling the same Bilibili playlist/video updates the existing canonical reference instead of creating duplicate content.

Operational hardening added after reviewing `.agents/structure_professional.drawio.xml`:

- `crawl_logs` records discovery, crawling, normalization, grouping, skipped URLs, errors, and terminal status.
- `GET /api/v1/crawl-jobs/{job_id}/logs` exposes audit/debug logs.
- Crawler tasks support retry/backoff with `configuration.max_attempts` and `configuration.retry_backoff_seconds`.
- Permanent crawler and normalization failures emit `dead-letter.content`.
- Job finalization sets `SUCCEEDED`, `PARTIAL_SUCCESS`, or `FAILED` only after active tasks finish and raw documents are saved canonically or accounted for as failed.
- Crawl Orchestrator includes a lightweight source scheduler for `SOURCE_CONFIG` jobs with `configuration.schedule_enabled=true`.
- Crawl Orchestrator commits tasks before publishing `crawl.task.requested`.
- Job cancellation is honored by crawler, normalization, and story-processing workers.
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
