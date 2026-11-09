# Social v1 Frontend Redesign Implementation Plan

> **For agentic workers:** execute in order and keep each slice reviewable. The user approved the whole-system redesign direction. Preserve routes, role access, user actions, Vietnamese product language, and workflow semantics.

**Goal:** Replace generic, inconsistent visual treatments with a coherent, task-oriented design across every current screen, beginning with the shared app shell and daily creator workflow.

**Architecture:** Keep the existing React SPA, History API routing, Tailwind 4, and shared component layer. Consolidate visual primitives in place; do not add a framework or change server/API behavior.

**Inputs:** `docs/architecture/social-v1-frontend-map.md`, `docs/architecture/social-v1-prioritized-improvements.md`.

## Slice 1 — Foundation and shell

- Inspect `frontend/src/index.css`, `commons/component/social-ui.tsx`, `commons/component/ui/**`, `commons/component/Sidebar.tsx`, `commons/component/navigation.ts`, and `App.tsx` before changing styles.
- Establish restrained color, type, spacing, border, focus, surface, and elevation tokens. Remove decorative gradient/shadow/hover patterns where they reduce hierarchy.
- Add consistent page heading/action, content width, and feedback-state patterns using existing shared primitives.
- Redesign role-aware desktop navigation and provide mobile access to every permitted route; preserve role filtering and custom URL router behavior.
- Review the 30-second AI usage poll: keep the indicator only if useful in the shared shell, otherwise load it on demand or reduce redundant requests without changing usage data semantics.
- Inspect the shell at desktop and narrow/mobile widths before proceeding.

## Slice 2 — Creator entry and content workflow

- Refactor `CreatorDashboardPage.tsx`, then crawl, content library/detail, series status, and planning pages in their feature folders.
- Standardize task context, filters, data density, empty/loading/error states, primary actions, and cross-links along collect → review → plan → produce.
- Preserve all current actions, filters, pagination, route paths, and workflow status semantics.

## Slice 3 — Production and publishing

- Update video project list/workspaces, approvals, schedule/calendar, and published-post pages.
- Preserve nested `/generate-video/:workflowId` and `/social-account/:profileId` deep links and all approve/reject/render/queue/publish operations.
- Keep distinct interaction models where workspaces or calendars require them while reusing foundations.

## Slice 4 — Accounts, settings, commerce, administration

- Update social account/profile strategy, profile/settings, AI management, TikTok Shop, user management, AI usage, audit, content admin, auth, and legal screens.
- Preserve OAuth callbacks, administrator-only access, current labels where accurate, and all existing links/actions.

## Review and verification per slice

- Do not add or run tests under the current instruction.
- Inspect source changes and run `git diff --check` after each slice.
- Use the running app/browser if available to inspect desktop and mobile rendering; otherwise record that visual inspection is unavailable and use existing non-test lint/build only if appropriate.
- Search for obsolete shared classes/components only after all call sites are migrated. Keep unused APIs until all imports are accounted for.
- Avoid broad page rewrites in one diff; complete and review one workflow slice before moving on.
