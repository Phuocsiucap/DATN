# Social v1 Backend Service and Query Refactor Plan

> **For agentic workers:** execute one domain slice at a time. Preserve all routes, request/response shapes, role checks, persisted data, and event/task semantics. Do not add a deployed service or rewrite the backend.

**Goal:** Make API routes transport-focused and move reusable domain queries and processing into existing API service modules; reduce source-backed repeated queries without changing externally visible behavior.

**Architecture:** Keep FastAPI, SQLAlchemy, PostgreSQL/MongoDB, Kafka, and current workers. Add cohesive internal modules under the existing API service where needed. Service functions own domain queries and multi-step use cases; routes retain HTTP dependencies, validation, status mapping, and response schemas.

**Inputs:** `docs/architecture/social-v1-route-service-map.md`, `docs/architecture/social-v1-current-state.md`, `docs/architecture/social-v1-prioritized-improvements.md`.

## Slice 0 — Contract baseline

- For each endpoint in scope, record route path/method, auth dependency, request/response schema, transaction boundary, event names/order, and expected service errors from existing code.
- Confirm API deployment source and migration/bootstrap policy from deployment/operator configuration before any runtime/bootstrap change. If unavailable, keep those areas documentation-only.

## Slice 1 — Media workflow list query and serialization

- Refactor `api/routes/media_workflows.py` and `common/db/media_workflows.py` list/detail read path into an existing API service boundary.
- Replace per-workflow content/story lookups with batched reads or one projection while preserving exact response keys, ordering, ownership checks, and pagination/limit behavior.
- Keep a compatibility wrapper for shared serializer callers until all call sites are migrated.
- Do not alter state transitions in the same patch as the list query extraction.

## Slice 2 — Video state transitions and tasks

- Extract repeated ownership/readiness/active-task/state/task-row logic from `api/routes/generate_video.py` into cohesive workflow/video service operations.
- Preserve endpoint auth dependencies, idempotency behavior, DB commit/rollback boundaries, task payloads, Kafka event ordering, and existing failure semantics.
- Keep file streaming/proxy and HTTP-specific response handling at the route edge.

## Slice 3 — Content detail, Bilibili, and OCR

- Separate content queries/response assembly and manual content operations from `api/routes/contents.py` into content service functions.
- Move Bilibili episode discovery/parsing and OCR queue/progress coordination into an API application service; make `stories.py` depend on that service rather than a private route helper.
- Split GET detail reads from embedding writes/requests. Preserve current behavior explicitly and avoid hidden commits in a read path; if embedding generation must remain triggered, expose a named operation with the same response contract and failure behavior.

## Slice 4 — AI usage and story publishing status

- Move shared AI usage summaries from `users.py`/`admin.py` to a reusable service operation; use grouped aggregates for summary rows and a bounded recent-runs query only if it exactly preserves current output semantics.
- Batch missing content IDs for story publishing status rather than fetching within the loop.
- Preserve date windows, null values, ordering, totals, and role scoping.

## Slice 5 — Analytics and remaining route domains

- Move analytics query/aggregation from `analytics.py` to a service. First document date-window behavior and all callers; optimize with SQL aggregation only after matching current timezone, inclusion, and rounding semantics.
- Refactor source config, profile planning, and content series operations into cohesive existing service packages where repeated domain logic exists.
- Split `SocialProfileService` internally only around cohesive responsibilities and retain stable imports/re-exports during migration.

## Slice 6 — Worker/common ownership and runtime assessment

- Review duplicate processing and DB ownership in ingestion, planning, embedding, OCR/video, and Remotion workers; only extract shared functions where behavior truly matches.
- Do not move work between processes as part of code cleanup without queue, scaling, resource, failure/retry, and deployment evidence.
- No process merge is approved by current repository evidence. If operational evidence later supports a merge, prepare a separate migration/rollback plan and preserve task/event contracts.
- Treat startup calls to `ensure_schema_compatibility` and `Base.metadata.create_all` as an investigation only until migration ownership/concurrency policy is known.

## Verification and review

- Do not add or run tests under the current instruction.
- After each slice, inspect API schema/diff, authorization dependencies, query call sites, transaction boundaries, event ordering, and `git diff --check`.
- Use existing lint/type/static checks only when non-test and available. If a check is unavailable, record it rather than installing new tooling.
- Re-scan route modules for direct ORM access after each domain migration. Keep direct queries only for transport-specific cases with an explicit reason.
