# SocialContent Backend

Backend cho SocialContent, gồm API, ingestion, AI media và các worker xử lý nền.

## Services

- `api-service`: REST API, xác thực, user/admin, crawl, content, planning, video và publishing.
- `data-ingestion-worker`: một tiến trình chứa crawl orchestration, crawler, normalization, story grouping/dedup, crawl scheduler và embedding API/consumer.
- `ai-media-engine`: một deployment chạy ba nhóm worker độc lập: planning, video generation/voice và Bilibili OCR. Mỗi nhóm giữ task filter và Kafka consumer group riêng; planning health ở `8050`, video worker health ở `8060`, OCR health ở `8061`.
- `remotion-worker`: render video; tiếp nhận task qua Kafka và có cơ chế polling DB dự phòng.

Compose khởi chạy `api-service` ở `http://localhost:8000`. Embedding API là endpoint nội bộ của `data-ingestion-worker`, được `api-service` và `ai-media-engine` gọi qua mạng Compose; không mở port riêng cho embedding ra host. Các worker AI dùng chung một Compose service `ai-media-engine`; tên DNS cũ `ai-media-planning-worker`, `ai-media-worker` và `ai-media-ocr-worker` vẫn là alias để giữ các URL health/config đang dùng.

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
