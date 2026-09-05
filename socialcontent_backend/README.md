# SocialContent Backend

Backend mới cho Module 1, bám theo kiến trúc trong `.agents/module1`.

## Services

- `api-service`: REST API, auth, user/admin system, crawl jobs, sources, content, stories, data quality.
- `crawl-orchestrator`: nhận `crawl.job.created`, chia task, publish `crawl.task.requested`.
- `crawler-service`: nhận task crawl, normalize trực tiếp, lưu processed MongoDB, publish `content.normalized`.
- `story-processing-service`: grouping, ordering, dedup, lưu canonical PostgreSQL, publish `story.grouped` và `content.canonical.saved`.

## Run Local

1. Copy `.env.example` to `.env`.
2. Start infra and services:

```bash
docker compose up --build
```

API service runs at `http://localhost:8000`.

## Key API

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/admin/system/bootstrap`
- `GET /api/v1/users`
- `POST /api/v1/users`
- `DELETE /api/v1/users/{user_id}`
- `GET /api/v1/social-profiles`
- `POST /api/v1/social-profiles`
- `POST /api/v1/social-profiles/tiktok/qr/start`
- `GET /api/v1/social-profiles/tiktok/qr/{session_id}/status`
- `POST /api/v1/social-profiles/tiktok/qr/{session_id}/stop`
- `POST /api/v1/social-profiles/{profile_id}/tiktok/qr/start`
- `GET /api/v1/social-profiles/{profile_id}/tiktok/qr/status`
- `POST /api/v1/social-profiles/{profile_id}/tiktok/qr/stop`
- `GET /api/v1/social-profiles/{profile_id}/strategy`
- `PUT /api/v1/social-profiles/{profile_id}/strategy`
- `GET /api/v1/social-profiles/queue/items`
- `GET /api/v1/social-profiles/{profile_id}/posts`
- `POST /api/v1/crawl-jobs`
- `GET /api/v1/crawl-jobs/{job_id}/events`
- `GET /api/v1/contents`
- `GET /api/v1/stories`

## User-Owned Accounts

The API service keeps the old user/account ownership model:

- `SYSTEM_ADMIN` manages users.
- Each `USER` owns their own `social_profiles`.
- Social profile, strategy, queue, post, and metric routes always scope queries by `current_user.id`.
- Users cannot read, edit, queue, or delete another user's accounts through normal user routes.
- TikTok profiles use OAuth tokens and API identifiers; no browser profile folder is required.

## TikTok QR Login

TikTok QR login uses TikTok OAuth QR APIs through `open.tiktokapis.com`.

Config:

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_REDIRECT_URI`
- `TIKTOK_OAUTH_SCOPES`, default `user.info.basic,video.upload,video.publish`

Two flows are supported:

- Pending flow: start QR first, create `social_profiles` only after TikTok auth succeeds.
- Existing profile flow: start QR against an existing TikTok profile and update status from `qr_pending` to `active` after auth.

## VNExpress Crawl Config

Use `source_type: "VNEXPRESS"` in a crawl job source.

```json
{
  "source_type": "VNEXPRESS",
  "keywords": ["thời sự", "kinh doanh"],
  "configuration": {
    "max_items": 10,
    "exclude_keywords": ["bóng đá"],
    "timeout_seconds": 20
  }
}
```

The crawler discovers links from a direct article URL or RSS/category RSS, then parses article detail HTML and writes normalized processed documents directly.

The VNExpress pipeline now records:

- Per-step `crawl_logs` for discovery, crawling, normalization, grouping, skipped URLs, and terminal job status.
- Terminal job status through the pipeline: `SUCCEEDED`, `PARTIAL_SUCCESS`, or `FAILED`.
- Retry with bounded backoff using source `configuration.max_attempts` and `configuration.retry_backoff_seconds`.
- Dead-letter events on permanent crawler/normalization failures.
- Article metadata: description, author, published_at, category, tags, HTTP status/headers/timing, article_id, category_id, site_id, images, videos.

## Bilibili Metadata Crawl Config

Use `source_type: "BILIBILI"` when the job should crawl Bilibili video/series metadata.

```json
{
  "source_type": "BILIBILI",
  "keywords": ["短剧 全集", "霸道总裁 短剧"],
  "configuration": {
    "max_items": 10,
    "max_duration_seconds": 7200,
    "timeout_seconds": 20
  }
}
```

The Bilibili crawler is metadata-only. It ports the old search and playlist/episode discovery logic, normalizes in memory, then writes processed MongoDB documents for canonical `Story`/`Episode` persistence. Multi-episode results use `content_type: "PLAYLIST"` to match Module 1. It does not download, OCR, transcribe, translate, or render videos.

For direct Bilibili URLs, the crawler resolves `aid`/`bvid`, fetches view-detail metadata, prefers `ugc_season` episode lists when available, falls back to page lists, and can enrich missing series lists from Bilibili season archive APIs/page hints.

Optional config:

- `queries`: string or list of extra Bilibili search queries.
- `cookie`: Bilibili cookie header when authenticated metadata is needed.
- `max_items`: number of metadata documents, capped at 50.
- `max_duration_seconds`: search-result duration filter.
- `timeout_seconds`: HTTP timeout.
- `user_agent`: override default browser-like user agent.

Recurring crawl is configured per Crawl Job. Create a job with a `schedule` object or update it through `PUT /api/v1/crawl-jobs/{job_id}/schedule`:

```json
{
  "enabled": true,
  "runs_per_day": 2,
  "window_start": "08:00",
  "window_end": "18:00",
  "weekdays": [0, 1, 2, 3, 4],
  "timezone": "Asia/Ho_Chi_Minh"
}
```

The Crawl Job Scheduler runs in `data-ingestion-engine` and processes only enabled job schedules. The Publish Queue Scheduler runs separately in `api-service`; System Admin can configure its interval, start or stop it, and trigger one queue pass immediately.

Shared process-level scheduler config:

- `ENABLE_SCHEDULER`, default `true`
- `SCHEDULER_POLL_SECONDS`, default `60`
