# Social v1 Product and Service Design

## Intent

Improve the whole Social v1 system: product UI, codebase organization, service boundaries, shared packages, database access, background processing, and operational design. Preserve existing capabilities and avoid a backend rewrite.

## Goals

- Map the whole repository and runtime topology first: frontend, all deployed backend services and workers, shared packages, data and event flows, dependencies, and operational configuration.
- Replace the scattered, generic-feeling visual treatment with a clear design system shared by the app shell, navigation, page headers, forms, tables, dialogs, and feedback states.
- Rework every existing frontend area in sequence, starting with the app shell and the creator's core content workflow, then secondary and admin areas.
- Keep the current React SPA, routes, Vietnamese product language, permissions, and user-visible workflows unless a concrete defect requires a behavior change.
- Make API route handlers thin: parse and validate transport input, apply dependencies, call reusable service functions, and shape HTTP responses.
- Move reusable database queries and business processing out of API routes into the existing service layer. Review processing in background workers and shared packages too, and improve avoidable duplicate work, N+1 reads, and unbounded queries while preserving API contracts.
- Assess whether existing deployed services have clearly overlapping responsibilities. Do not add a new deployed service; existing services may be consolidated when the full-system map shows concrete responsibility overlap and operational or code-ownership benefit.
- Complete the VNExpress removal as the first isolated change before starting this broader work.

## Non-goals

- Replacing the backend framework, persistence layer, or message bus.
- Changing API paths, request/response shapes, role access, or workflow semantics as part of the refactor.
- Removing persisted historical content or VNExpress records from the database.
- Adding a new frontend framework or a component-library dependency.
- Rewriting all screens in one unreviewable change.

## Constraints

- Build on the current React 19, TypeScript, Tailwind 4, and FastAPI stack.
- Keep existing URLs and deep links working.
- Reuse existing service packages where their domain fits; internal modules may be added, but no independently deployed service may be added. Merge existing deployments only when responsibility overlap is clear, with API/data/event compatibility and a migration/rollback path.
- Preserve Bilibili and all non-VNExpress workflows.
- Do not add or run tests unless the user asks for testing or verification. Keep changes reviewable by bounded feature/module slices.

## Approaches

1. **Replace everything in one pass.** Rebuild all frontend pages and extract all route logic in one broad change. This gives one sweeping transition but makes regressions hard to locate and review.
2. **Audit the whole system, then optimize in phases (selected).** Map all current runtime services, workers, data/event paths, and frontend areas first. Establish shared visual foundations and the app shell, update pages by workflow, and move route queries and processing into reusable services. Consolidate existing deployments only where responsibilities clearly overlap and the migration preserves API/data/event behavior; add no services. This reaches the whole-system scope without a backend rewrite and keeps each implementation slice reviewable.
3. **Visual polish only.** Refresh shared colors and components without changing page structure or backend route boundaries. This is lower effort but does not satisfy the requested workflow and service-layer changes.

## Proposed design

### Frontend

- Create a restrained, consistent visual language with clear type scale, spacing, neutral surfaces, and a limited accent palette. Remove decorative treatments that compete with task information.
- Refine the shared app shell and role-based navigation before changing individual screens.
- Organize each page around its primary job, with consistent title/action placement, readable data density, and explicit loading, empty, error, and success states.
- Apply the design across all current feature areas in slices: app shell and dashboards; content intake, library, planning, video production, approvals, and publishing; then settings, analytics, shop, and admin.
- Keep existing user actions and workflows. Treat any proposed workflow change as a separate decision.

### Whole-system architecture

- Begin with an architecture map of the existing runtime: the five backend service codebases, worker processes in the compose file, shared packages, infrastructure dependencies, and the frontend's API/data paths.
- Identify overlapping responsibilities, duplicate business logic, repeated database access, cross-service coupling, and operational costs. Separate evidence-backed findings from potential improvements.
- Keep existing APIs and data/event contracts. Map deployment boundaries during the audit and identify consolidation candidates with evidence, migration steps, and rollback implications.

Current repository evidence to carry into the audit:

- Compose defines six application processes: data ingestion, embedding, AI planning, AI video, AI OCR, and Remotion. The API service has a Docker Compose entry commented out, while the README still says it runs on port 8000; its actual local/production deployment needs to be confirmed from deployment configuration.
- AI planning, video generation, and OCR use the same `ai-media-engine` codebase and Dockerfile but have separate process commands and task scopes. This alone is not evidence that they should be merged into one process; inspect scaling, resource isolation, and queue behavior before proposing a change.
- Data ingestion already combines orchestration, crawler, normalization, and story-processing consumers in one service codebase. The README still describes some of those as separate named services, so service ownership documentation needs to match runtime reality.
- Postgres, MongoDB, Kafka, and Zookeeper are core runtime dependencies; pgAdmin and Mongo Express are supporting tools in the same Compose file.

### Backend

- Keep API route modules as the HTTP boundary. Routes should not assemble domain queries, perform multi-step state transitions, or duplicate reusable processing.
- Put domain operations and reusable queries in existing service packages, grouped by current domain. A service owns its transaction decisions and returns domain results; routes translate expected service errors into HTTP responses.
- Extract and simplify one domain at a time. Start with the most mixed API modules (`generate_video.py`, `media_workflows.py`, and `contents.py`), then handle analytics, users, sources, and other modules based on their actual shared logic. Review ingestion, AI/media, embedding, and rendering workers for duplicated or misplaced processing.
- Optimize repeated database reads and unbounded result loading only where safe behavior and API contracts can be preserved. Avoid speculative schema or infrastructure changes.

## Rollout and review

- Finish and review VNExpress removal independently.
- Produce the current-state system map and prioritized findings before broad refactoring. Use it to split work into independent UI, API/service-layer, and runtime-consolidation plans.
- For each feature slice, review the current behavior, update implementation, and inspect the resulting UI or API diff before moving to the next slice.
- Keep the current branch. Do not create a parallel replacement backend or add deployed services.
- Any deployment consolidation should state which processes move, why responsibilities overlap, how data/events remain compatible, and how to roll back.

## Implementation calls

- Start with a current-state architecture map and prioritized findings for the whole repository and runtime.
- Start the visual work with the app shell, creator dashboard, and core content workflow; they establish shared patterns and are the primary day-to-day path. Continue through the remaining creator pages and then admin pages.
- Run route/service extraction in bounded domain slices. Consolidate existing services only when the architecture map demonstrates clear responsibility overlap; create no new deployed service.
- These calls follow the user's whole-system scope and no-backend-rewrite constraint; the user can correct them while reviewing this design.
