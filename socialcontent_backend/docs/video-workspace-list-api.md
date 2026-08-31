# Video workspace list — schema version 2

`GET /api/v1/media-workflows/video-workspace` is the read model for the
`/generate-video` library, **not** the video editor or a task diagnostic endpoint.

## Response

```json
{
  "schema_version": 2,
  "items": [
    {
      "id": "workflow-id",
      "profile_id": "profile-id",
      "series_id": "series-id",
      "title": "Video title",
      "thumbnail_url": "https://example.test/thumbnail.jpg",
      "category": "Technology",
      "status": "EDITING",
      "current_stage": "DRAFT_REVIEW_REQUIRED",
      "progress_percent": 30,
      "task_status": "COMPLETED",
      "updated_at": "2026-08-31T00:00:00Z"
    }
  ],
  "profiles": {
    "profile-id": { "name": "Profile name", "platform": "tiktok", "avatar": "https://example.test/avatar.jpg" }
  },
  "series": {
    "series-id": { "title": "Series title" }
  },
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

- UUID examples above are placeholders. `profiles` / `series` are page-local
  dictionaries, not new database tables; each referenced entity appears once.
- Nullable fields are omitted. Missing `series_id` means no assigned series;
  missing `task_status` means no relevant video task was found.
- `status` is the workflow state. `current_stage` retains draft-review state and
  progress-stage detail; it is not interchangeable with `status`.
- `task_status` preserves the existing selection rule: prefer RUNNING, then
  PROCESSING, then PENDING; within the same priority choose newest. If no active
  task exists, use the latest terminal task. This drives polling, action locks,
  and the failed-task KPI, without exposing the whole task record.
- Active task progress overrides workflow progress, including true zero. A
  missing active stage falls back to the workflow stage. Terminal tasks do not
  override the workflow's current progress/stage.
- `updated_at` falls back to workflow creation time if necessary; it is not a
  task heartbeat timestamp.
- `total` counts all matching workflows; `items` is only the requested page.

Removed from the list: source IDs/title/summary, article/site/category IDs,
snake_case/camelCase aliases, duplicated thumbnail URLs, full task data and error
messages, artifact/final-video paths, and the redundant creation timestamp.
No source/draft/diagnostic data is deleted from storage.

## Detail, behavior and database access

- Open one workflow with `GET /media-workflows/{id}/workspace` for the editor,
  including source, draft, tasks, capabilities and final video.
- `GET /media-workflows/{id}/progress` remains available to the editor.
- Ownership, visibility, profile/series/status/stage/search filtering and
  pagination limits are unchanged. Tied update timestamps now have an ID
  tiebreaker for stable pagination.
- The list performs one count query, one page query and at most one batch task
  query (none for an empty page); no per-card database requests.
- The page query no longer loads artifacts, source summary/title or the whole
  sources JSON. It projects only category and thumbnail-related source fields.
  Media JSON is still read for the existing first-usable-media thumbnail fallback.
- PostgreSQL `DISTINCT ON` limits task results to one compact row per workflow;
  task history, errors, payload and result JSON are not loaded into the list.

## Frontend

The API adapter resolves references in memory; no profile/series request per
card. It also accepts the previous list shape while the API is being restarted.
The new API shape requires the updated frontend; reload stale browser tabs after
deployment.

During 2.5-second active-task polling, full series-management data is fetched
again only when the visible series IDs/titles change. Initial/filter/manual
loads still refresh series-management data. No source/draft/detail endpoint is
called just to render cards.

Cards no longer fabricate video duration or replace zero progress with 45%.
Auto-production decisions, draft generation/review and publishing are unchanged.

## Measured example and checks

Using the user's four-workflow attachment, serialized as compact UTF-8 JSON on
both sides: **9,301 → 2,745 bytes (70.49% smaller)**. The new result still has four
items, the same total/limit/offset, one profile and one series. This is an offline
projection through the production serializer, not a claim about live HTTP gzip
size, live database latency, or the entire page's network traffic.

Regression checks:

- API tests: `tests/test_video_workspace_list.py` covers shape, catalogs, nulls,
  thumbnail fallback, active task precedence SQL, permissions/filter predicates,
  pagination and empty-page query count. Database queries are compiled against
  PostgreSQL with synthetic rows; tests do not connect to production.
- Frontend: `npm run test:video-list` covers new/legacy adapters, reference
  integrity, real card rendering, review state, active locks, zero progress and
  series refresh signatures.
- Browser fixture: run `node tests/review-ui-server.mjs` from `frontend`, then
  open `http://localhost:5187/__video-list-ui`. It uses the actual library page,
  rejects unmocked calls, and has no real credentials, writes or paid jobs.
  Verify review/failed/running cards, their open IDs, disabled running actions,
  series refresh on “Giả lập series mới”, and polling stop on “Hoàn tất job giả lập”.

Restart/reload the API process and reload the frontend to see `schema_version: 2`.
No migration, recrawl or re-render is required.
