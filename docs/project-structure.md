# Project Structure

This repository is a fork of the official Hydro blog addon. It runs within a Hydro instance and integrates with Hydro's persistence, handlers, permissions, localization, and UI.

| Path | Responsibility |
| --- | --- |
| `index.ts` | Addon initialization, index setup, and feature registration. |
| `features/handler.ts` | Routes and request handling. |
| `features/handler.base.ts` | Shared user and post preparation. |
| `features/comments.handler.ts` | Comment loading, two-level replies/deletion/likes, target binding, and native notification/audit sequencing. |
| `features/comments.model.ts` | Independent comment documents, embedded replies, per-user likes, scoped indexes, and cascade cleanup. |
| `features/permission.ts` | Permission metadata and strict own/others policy using the shared constant catalog. |
| `features/settings.model.ts` | Global blog roles, revision-checked settings, user assignments and effective-role resolution. |
| `features/settings.handler.ts` | Settings routes, matrix validation, role management, sudo and audit integration. |
| `features/model.ts` | Blog persistence, document status, and database indexes. |
| `features/review.model.ts` | Article review transitions, conditional-write predicates, independent report receipts, bounded pending-write recovery, and privacy projections. |
| `features/review.handler.ts` | Restricted queue/decision/report/reset routes, author notices, and handler-aware Oplog records. |
| `features/review.notifications.ts` | Login reminders, native maintenance/summary scheduling, persisted due/lease state, and effective-role recipient batches. |
| `features/types.ts` | Blog document/status, role/settings, and shared update/visibility types. |
| `features/constants.ts` | Shared routes/templates, roles, permission/action identifiers, messages, storage identifiers, and policy values. |
| `features/i18n.ts` | Application translations. |
| `features/ui.ts` | Server-side UI integration. |
| `features/utils.ts` | Shared helpers. |
| `frontend/` | Browser-side integration with the Hydro UI. |
| `frontend/blog-comments.page.ts` | Desired-state like/unlike controls for both comment levels, using native request and feedback helpers. |
| `frontend/blog-settings.page.ts` | Native settings dialogs, selection/bulk actions, inline role feedback, and domain-aware active navigation. |
| `frontend/blog-review.page.ts` | Native report dialog and review-counter reset confirmation. |
| `templates/` | Page templates and reusable components. |
| `templates/partials/blog_comments.html` | Blog-policy adapter for Hydro's native editor, reply, deletion, user, and pagination markup. |
| `patches/` | Dependency patches applied by `patch-package` during installation. |
| `tests/unit/` | Vitest model and handler regression tests. |
| `tests/helpers/` and `tests/setup.ts` | Explicit Hydro service fixtures, real framework primitives, and isolated test setup. |
| `vitest.config.mjs` | UT discovery, legacy-decorator transformation, timeouts, and scoped coverage. |
| `scripts/typecheck.mjs` and `tsconfig.json` | Non-emitting project-source type checks with real dependency type resolution, without checking upstream implementations. |
| `playwright.config.ts` and `tests/e2e/` | Real-browser authentication, role/permission, persistence, and frontend E2E tests. |
| `scripts/hydro-runtime.mjs` and `scripts/hydro-entry.cjs` | Owned MongoDB/local Hydro lifecycle, writable paths, real-user seeding, and cleanup. |
| `.github/workflows/validation.yml` | PR validation workflow. |

Keep changes in the existing layer. When changing a shared contract, update its dependent handlers, types, templates, frontend code, and translations as needed.
