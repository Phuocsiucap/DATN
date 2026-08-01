# SocialContent Backend

Backend mới cho Module 1, bám theo kiến trúc trong `.agents/module1`.

## Services

- `api-service`: REST API, auth, user/admin system, crawl jobs, sources, content, stories, data quality.
- `crawl-orchestrator`: nhận `crawl.job.created`, chia task, publish `crawl.task.requested`.
- `crawler-service`: nhận task crawl, lưu raw MongoDB, publish `content.raw.created`.
- `normalization-service`: đọc raw, clean/normalize/validate, lưu processed MongoDB, publish `content.normalized`.
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
- `GET /api/v1/crawl-jobs/{job_id}/logs`
- `GET /api/v1/contents`
- `GET /api/v1/stories`

## User-Owned Accounts

The API service keeps the old user/account ownership model:

- `SYSTEM_ADMIN` manages users.
- Each `USER` owns their own `social_profiles`.
- Social profile, strategy, queue, post, and metric routes always scope queries by `current_user.id`.
- Users cannot read, edit, queue, or delete another user's accounts through normal user routes.
- Profile runtime folders are generated as `social_profile/accounts/user_{user_id}/{platform}/{profile_key}`.

## TikTok QR Login

TikTok QR login uses Playwright persistent browser sessions and stores browser data in the profile runtime folder.

Install browser runtime after dependencies:

```bash
python -m playwright install chromium
```

Config:

- `TIKTOK_QR_LOGIN_URL`, default `https://www.tiktok.com/login/qrcode`
- `BROWSER_CHANNEL`, default `chrome`, with Chromium fallback
- `BROWSER_HEADLESS`, default `false`

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

The crawler discovers links from a direct article URL, configured source URL, VNExpress search, latest RSS, and homepage fallback. Each article is stored as a raw MongoDB document and then passed through the Module 1 normalization pipeline.

The VNExpress pipeline now records:

- Per-step `crawl_logs` for discovery, crawling, normalization, grouping, skipped URLs, and terminal job status.
- Terminal job status through the pipeline: `SUCCEEDED`, `PARTIAL_SUCCESS`, or `FAILED`.
- Retry with bounded backoff using source `configuration.max_attempts` and `configuration.retry_backoff_seconds`.
- Dead-letter events on permanent crawler/normalization failures.
- Article metadata: description, author, published_at, category, tags, HTTP status/headers/timing, raw HTML, images, videos.

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

The Bilibili crawler is metadata-only. It ports the old search and playlist/episode discovery logic, then stores raw metadata in MongoDB and lets the Module 1 pipeline normalize and persist canonical `Story`/`Episode` rows. Multi-episode results use `content_type: "PLAYLIST"` to match Module 1. It does not download, OCR, transcribe, translate, or render videos.

For direct Bilibili URLs, the crawler resolves `aid`/`bvid`, fetches view-detail metadata, prefers `ugc_season` episode lists when available, falls back to page lists, and can enrich missing series lists from Bilibili season archive APIs/page hints.

Optional config:

- `queries`: string or list of extra Bilibili search queries.
- `cookie`: Bilibili cookie header when authenticated metadata is needed.
- `max_items`: number of metadata documents, capped at 50.
- `max_duration_seconds`: search-result duration filter.
- `timeout_seconds`: HTTP timeout.
- `user_agent`: override default browser-like user agent.

Scheduled source configs are supported for rows created through `/api/v1/crawl-sources` when:

```json
{
  "configuration": {
    "schedule_enabled": true,
    "interval_minutes": 60
  }
}
```

Scheduler config:

- `ENABLE_SCHEDULER`, default `true`
- `SCHEDULER_POLL_SECONDS`, default `60`
