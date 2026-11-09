# Social v1 Whole-System Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an evidence-based map of the current Social v1 product and runtime that identifies the safest, highest-value UI, service/query, and deployment improvements before broad implementation.

**Architecture:** Inspect the current React SPA, FastAPI API service, existing Python/Node workers, shared packages, Docker Compose topology, and data/event contracts. Do not change runtime topology during this audit; recommend merging existing deployments only when concrete responsibility overlap and operational benefit are demonstrated.

**Tech Stack:** React 19, TypeScript, Tailwind 4, FastAPI, SQLAlchemy, PostgreSQL, MongoDB, Kafka, Python worker processes, Node/Remotion worker, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-04-social-v1-product-and-service-design.md`

## Global Constraints

- Keep existing product capabilities, API contracts, URLs, permissions, and persisted data intact.
- Do not rewrite the backend or add a deployed service.
- Keep Bilibili and all non-VNExpress workflows intact; VNExpress removal is a separate completed change.
- Use current repository evidence; mark runtime/deployment facts absent from the repo as unknown rather than guessing.
- Do not add or run tests unless the user asks for testing or verification. Use read-only inspection and existing lint/build commands only when needed.

## Review Focus

- API deployment is unclear because the Compose entry is commented out while README states API runs on port 8000; document what the repo can establish and mark the actual deployment source as unknown.
- Planning, video, and OCR processes share the AI media codebase but have distinct commands/task types; do not label this duplication without evidence about queues, scaling, or resource isolation.
- The README describes ingestion sub-services separately although Compose runs one data-ingestion process; distinguish logical components from deployed processes.
- Large API route modules may have direct queries, repeated reads, or transaction logic; identify candidates without changing their observable behavior.
- Frontend pages share a shell and CSS tokens but cover distinct creator/admin roles; map current permissions and route behavior before proposing a navigation change.

---

### Task 1: Map runtime processes and dependencies

**Files:**
- Read: `socialcontent_backend/docker-compose.yml`
- Read: `socialcontent_backend/services/*/Dockerfile`
- Read: service entrypoints, worker commands, `socialcontent_backend/README.md`
- Create: `docs/architecture/social-v1-current-state.md`

**Interfaces:**
- Consumes: existing Compose definitions, Dockerfiles, service entrypoints, topic definitions, and README.
- Produces: a table of deployed application processes, codebase/image ownership, commands, dependencies, ports, event topics, and deployment facts not present in the repo.

- [x] **Step 1: Inventory runtime definitions**

Read Compose, Dockerfiles, and process entrypoints; record each application process, shared image/codebase, infrastructure dependency, port, and configured task role.

- [x] **Step 2: Trace inter-process data paths**

Follow API service calls, Kafka topic producers/consumers, direct HTTP calls, and PostgreSQL/MongoDB access to describe the main crawl, planning, video, embedding, and rendering flows.

- [x] **Step 3: Compare documented and configured topology**

Record differences between README service names and Compose processes, including the commented API service entry and unknown actual deployment source.

- [x] **Step 4: Write the current-state map**

Create `docs/architecture/social-v1-current-state.md` with the process table, Mermaid data-flow diagram, known constraints, unknowns, and evidence file paths.

- [x] **Step 5: Review for unsupported consolidation claims**

For every potential merge candidate, cite concrete duplicated ownership or processing. If evidence is insufficient, mark it as requiring deployment/operational data and do not recommend merging yet.

### Task 2: Map API route and service responsibilities

**Files:**
- Read: `socialcontent_backend/services/api-service/app/api/routes/*.py`
- Read: `socialcontent_backend/services/api-service/app/services/*.py`
- Create: `docs/architecture/social-v1-route-service-map.md`

**Interfaces:**
- Consumes: current routes, existing service modules, ORM models, API schemas, and event producer calls.
- Produces: a route-domain matrix showing transport responsibilities, database/query work, state transitions, reusable processing, response contracts, and suitable existing service modules.

- [x] **Step 1: Inventory route responsibilities**

For each route module, list endpoints, direct ORM access, transaction boundaries, processing helpers, and calls to existing services.

- [x] **Step 2: Identify query and reuse opportunities**

Flag observable patterns such as repeated entity reads, per-item queries, unbounded result loading, duplicate serialization/business logic, or query logic embedded in routes. Cite file and line locations.

- [x] **Step 3: Define route/service boundary recommendations**

For each candidate, name the current or proposed `app/services` module and the domain operation/query it should own. Preserve authorization dependencies and API response shapes.

- [x] **Step 4: Write the responsibility map**

Create `docs/architecture/social-v1-route-service-map.md`, ordered by impact and change risk, and distinguish confirmed improvements from hypotheses that need runtime query data.

### Task 3: Map frontend product areas and shared visual structure

**Files:**
- Read: `frontend/src/App.tsx`
- Read: `frontend/src/commons/component/Sidebar.tsx`
- Read: `frontend/src/commons/component/navigation.ts`
- Read: `frontend/src/index.css`
- Read: `frontend/src/features/**`
- Create: `docs/architecture/social-v1-frontend-map.md`

**Interfaces:**
- Consumes: route/tab configuration, role permissions, page components, and shared UI tokens/components.
- Produces: a role-by-workflow screen map, shared visual inventory, and ordered redesign slices that preserve current actions and deep links.

- [x] **Step 1: Inventory routes and role access**

Map creator/admin navigation, route paths, deep links, and page access rules from the app shell and navigation definitions.

- [x] **Step 2: Group screens by user workflow**

Group existing screens into content intake, library, planning, production, approvals, publishing, analytics/settings, and admin operations; list the primary actions each page currently exposes.

- [x] **Step 3: Inventory shared visual primitives**

Record global tokens, shell/layout patterns, common controls, tables, dialogs, and inconsistent page-level treatments without changing them.

- [x] **Step 4: Write the frontend map**

Create `docs/architecture/social-v1-frontend-map.md` with role/workflow tables, existing shared structures, and a phased redesign order beginning with shell and creator workflows.

### Task 4: Prioritize whole-system improvements

**Files:**
- Read: outputs of Tasks 1–3
- Create: `docs/architecture/social-v1-prioritized-improvements.md`

**Interfaces:**
- Consumes: runtime, route/service, and frontend maps.
- Produces: separate implementation backlogs for UI, route/service/query refactoring, documentation, and any evidence-backed deployment consolidation candidate.

- [x] **Step 1: Rank findings by impact and risk**

For each finding, state the user/operational impact, supporting evidence, affected modules, dependencies, and whether runtime data or deployment access is required.

- [x] **Step 2: Split independent implementation work**

Create ordered, bounded workstreams for frontend foundation/screens, API service boundaries/query work, system documentation, and approved deployment consolidation candidates.

- [x] **Step 3: Document consolidation candidates**

For each candidate, identify current processes, clear responsibility overlap, API/data/event compatibility risks, resource/scaling implications, and rollback path. Do not include a speculative merge.

- [x] **Step 4: Produce the prioritized backlog**

Create `docs/architecture/social-v1-prioritized-improvements.md` and link the three maps. Mark unknown deployment facts and measurement-dependent optimizations explicitly.

### Task 5: Handoff to implementation plans

**Files:**
- Read: `docs/architecture/social-v1-prioritized-improvements.md`
- Create: separate plans under `docs/superpowers/plans/` for the approved frontend and backend workstreams.

**Interfaces:**
- Consumes: prioritized improvements and the approved design.
- Produces: independent, sequenced implementation plans that preserve the existing product and API contracts.

- [x] **Step 1: Draft the frontend implementation plan**

Sequence shared design tokens and app shell before role-based dashboards and workflow pages, then remaining creator and admin areas.

- [x] **Step 2: Draft the backend implementation plan**

Sequence route/service extraction and query improvements by domain and risk; include deployment consolidation only if the audit found a concrete candidate.

- [x] **Step 3: Review the handoff**

Ensure each plan names the files, service interfaces, preserved API behavior, and non-test verification method for each slice; do not begin code changes covered by those plans until the user has reviewed them.

