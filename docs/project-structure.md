# Project Structure

This repository is a fork of the official Hydro blog addon. It runs within a Hydro instance and integrates with Hydro's persistence, handlers, permissions, localization, and UI.

| Path | Responsibility |
| --- | --- |
| `index.ts` | Addon initialization, index setup, and feature registration. |
| `features/{articles,comments,integration,review,settings}/index.ts` | Explicit named exports consumed by the composition root; no wildcard exports or registration logic. |
| `features/articles/article.handler.ts` | Article routes, lists, detail and write actions. |
| `features/articles/article.model.ts` | Article persistence, document status, scoped indexes and the public `Hydro.model.blog` registration. |
| `features/articles/article.projection.ts` | Reader-specific review metadata and response-only IP projections; no persistence or request handling. |
| `features/comments/comment.handler.ts` | Comment loading, two-level replies/deletion/likes, target binding, and native notification/audit sequencing. |
| `features/comments/comment.model.ts` | Independent comment documents, embedded replies, per-user likes, scoped indexes, and cascade cleanup. |
| `features/settings/settings.policy.ts` | Permission metadata and strict own/others policy using the shared constant catalog. |
| `features/settings/settings.model.ts` | Global blog roles, revision-checked settings, user assignments and effective-role resolution. |
| `features/settings/settings.handler.ts` | Settings routes, matrix validation, role management, sudo and audit integration. |
| `features/review/review.model.ts` | Article review transitions, conditional-write predicates, independent report receipts and bounded pending-write recovery. |
| `features/review/review.policy.ts` | Review-comment validation and publication-update calculation; no database access. |
| `features/review/review.handler.ts` | Restricted queue/decision/report/reset routes, author notices, and handler-aware Oplog records. |
| `features/review/review.notifications.ts` | Login reminders, native maintenance/summary scheduling, persisted due/lease state, and effective-role recipient batches. |
| `features/common/base.handler.ts` | Shared admission, user and article preparation owned by Hydro's lifecycle. |
| `features/common/notifications.ts` | Shared rich-message delivery localized by recipient preference, with bulk language lookup and per-language recipient groups. |
| `features/common/templates.ts` | Template-name conversion used by server handlers. |
| `features/shared/types.ts` | Blog document/status, role/settings, and shared update/visibility types; type-only framework references. |
| `features/shared/constants.ts` | Browser-safe routes/templates, roles, permission/action identifiers, messages, storage identifiers, and policy values. |
| `features/integration/i18n.ts` | Registers one fresh catalog per locale through Hydro; no translation data or fallback implementation. |
| `features/integration/locales/{en,zh,zh_TW,ko}.ts` | Explicit per-language dictionaries with stable symbolic keys and unchanged application text. |
| `features/integration/locales/catalog.ts` | Locale completeness contract and the existing English source-text fallback keys. |
| `features/integration/ui.ts` | Server-side UI context and native navigation integration. |
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

## Dependency Boundaries

`index.ts` is the composition root, not a feature barrel. It initializes article
and comment indexes, settings and review storage, then registers translations,
settings routes, review routes, article routes, UI integration and notifications
in that order. Static routes must precede parameterized article routes.
All four models expose `static async init(ctx: Context)` for storage setup,
even when a model only needs indexes. Initialization stays explicitly awaited
in the composition root, never hidden in model constructors or import side effects.

- **Shared contracts:** `features/shared/` contains values/types used across
  features or execution environments. It imports only other shared modules and
  type-only framework definitions, never a model or server helper.
- **Feature logic:** models own persistence; policy modules own calculations and
  authorization rules; projections own response shaping. They do not import
  handlers, common server orchestration, frontend code or integration modules.
  Models may call other feature models when an existing workflow requires it,
  such as article deletion cleaning up comments and reports.
- **Request orchestration:** handlers use models, policies, projections and
  `features/common/` helpers. Common helpers are server-only, not an unrestricted
  home for feature-specific business logic. Base handlers retain their existing
  model/policy dependencies and native preparation stages.
- **Hydro integration:** `features/integration/` registers locales and native UI
  hooks. Feature models do not depend on these adapters.
- **Browser:** `frontend/` uses supported Hydro browser APIs, sibling frontend
  modules and shared contracts only. It must not import server feature modules,
  even through a convenience barrel.

ESLint enforces these import boundaries alongside the Hydro-first dependency
policy. The composition root imports the five feature entry points, which
explicitly export only its required model and registration interfaces.
Inside features, retain direct imports from the owning implementation file;
never import the current or another feature's entry point. This keeps model
dependencies explicit and avoids cycles through a barrel that also loads handlers.
Do not add wildcard exports or create entry points for every directory by default.
The framework entry, frontend discovery directory and templates remain at the
repository root. These locations are integration contracts, not layout debt.

## Extending the Addon

Place a new responsibility next to its owning feature. Use a separate policy or
projection module only when there is a concrete boundary to isolate; do not add
a service/repository abstraction around an existing model just for symmetry.
Use [the naming rules](development.md#identifier-and-file-naming), and keep
cross-feature contracts in `shared/` rather than importing them through a model.

Register new routes explicitly in the feature's `apply*Handlers` function and,
for a new feature, wire it into the composition root with deliberate ordering.
Preserve [native lifecycle ownership](handler-lifecycle.md), add focused tests
beside the corresponding unit/E2E suites, include extracted logic in coverage,
and verify the affected flow through the isolated Hydro runtime.

The [structure-refactor plan](plans/structure-refactor.md) records the flat-to-
feature migration and its compatibility evidence. Internal source paths moved;
the package entry and `Hydro.model.blog` API did not. No data migration is needed.
