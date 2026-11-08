# Behavior-Preserving Structure Refactor

## Status and Baseline

Completed locally; [PR #15](https://github.com/tywzoj/hydro-addon-blog/pull/15).
Baseline: `2d744d94998aa457870c94efb15002c21c82bce9`,
2026-11-08, Node 24.22.1, Yarn 1.22.22, Hydro 5.0.7,
framework 0.3.2 and default UI 4.58.5.

At baseline, the backend mixed feature modules, shared contracts and framework
integration in one flat directory. Generic article filenames obscured ownership.
Review persistence also owned response projections and publication policy, while
shared types imported the article model solely for a document-type constant.

## Goal and Non-Goals

Improve navigation, dependency boundaries, internal naming and contributor
guidance without changing functionality, UX or business rules.

Do not change routes, handler class/hook names, request/response fields,
translation keys or text, templates, frontend interactions, permissions,
document shapes, collection/index names, queries, operation ordering, defaults,
audit events or notification scheduling. No dependency changes, migrations,
framework patches or new runtime abstractions are needed.

## Design and Sequence

1. Establish lint, type-check, unit-coverage and real-Hydro E2E baselines.
2. Group backend modules into articles, comments, review and settings; separate
   shared contracts, common server helpers and Hydro integration.
3. Extract article response projections and review publication policy without
   changing their implementations. Import shared document identifiers directly
   from constants, not through persistence.
4. Give internal registration functions consistent plural `apply*Handlers`
   names, use model-owned `init(ctx)` methods for all storage initialization,
   and give the article sort lookup explicit ownership. Preserve
   Hydro-dispatched handler names and the public `Hydro.model.blog` API.
5. Enforce browser/shared/persistence import boundaries through existing ESLint,
   retaining the existing Hydro-first dependency restrictions.
6. Update callers, coverage paths and English contributor documentation together.
   Run the same checks and a declared Playwright MCP smoke check.

Keep the root `index.ts`, `frontend/` and `templates/` discovery locations.
Use explicit named-export feature entry points at the composition root, as
requested in the entry-point follow-up below. Within features, retain direct
implementation imports instead of importing through these entry points.
Feature models may collaborate with other models; they must not import
handlers or UI integration. Common server helpers are not browser-safe shared
contracts and must not be imported by models or policy modules.

## Acceptance Criteria

- Every existing UT and E2E passes without weakened assertions or skipped cases.
- Existing coverage remains attached to every moved or extracted implementation.
- Route registration and initialization order remain unchanged.
- Templates, translations and frontend executable behavior remain unchanged.
- The production diff consists of file moves, import/name updates and exact
  function extraction; no business-body rewrites.
- Lint and scoped type checking pass. Negative import-boundary probes fail.
- Current documentation paths resolve and explain ownership, naming, extension
  steps and compatibility identifiers.
- Browser smoke evidence and any missing verification are recorded explicitly.

## Source Basis

Official Hydro commit `3bae56fe8edddff12346bcb1c8281269c94688d8`:
`packages/blog/index.ts` supplies the addon `apply(ctx)`, route and UI registration
pattern; `framework/framework/server.ts` supplies native handler dispatch and
class-name-based events. Installed Hydro/framework sources are the compatibility
reference for this checkout. See the [lifecycle guide](../handler-lifecycle.md)
and [official reference requirements](../development.md#official-hydro-references).
This refactor changes no framework API usage.

## Source Path Map

Paths below are relative to `features/`. Historical plans retain their original
revision-specific paths and line numbers.

| Former path | Current owner |
| --- | --- |
| `handler.ts`, `model.ts` | `articles/article.handler.ts`, `articles/article.model.ts` |
| `comments.handler.ts`, `comments.model.ts` | `comments/comment.handler.ts`, `comments/comment.model.ts` |
| `review.handler.ts`, `review.model.ts`, `review.notifications.ts` | Same filenames under `review/` |
| Response projections in `review.model.ts` | `articles/article.projection.ts` |
| Comment validation and publication calculation in `review.model.ts` | `review/review.policy.ts` |
| `settings.handler.ts`, `settings.model.ts` | Same filenames under `settings/` |
| `permission.ts` | `settings/settings.policy.ts` |
| `handler.base.ts`, `notifications.ts`, `utils.ts` | `common/base.handler.ts`, `common/notifications.ts`, `common/templates.ts` |
| `constants.ts`, `types.ts` | Same filenames under `shared/` |
| `i18n.ts`, `ui.ts` | Same filenames under `integration/` |

Internal entry names are now `applyArticleHandlers`, `applySettingsHandlers`,
`applyReviewHandlers`, `applyBlogI18n` and `applyBlogUI`.
All four storage initializers use `Model.init(ctx)`: the article/comment index
helpers moved unchanged into `BlogModel.init` and `BlogCommentModel.init`,
matching `BlogSettingsModel.init` and `BlogReviewModel.init`.
The article sort lookup is `ARTICLE_SORTS`. The package-level `apply`,
`applyReviewNotifications`, existing public model methods and all
Hydro-dispatched class/method names are unchanged.

Unit filenames `handler.test.ts`, `model.test.ts` and `permission.test.ts` became
`article.handler.test.ts`, `article.model.test.ts` and `settings.policy.test.ts`.
Existing assertions are unchanged; `bootstrap.test.ts` adds composition coverage.

## Delivery Evidence

Baseline `yarn lint`, `yarn typecheck` and `yarn test:coverage` passed:
43 checked TypeScript files, 9 test files, 378 tests; scoped coverage was
99.19% statements, 99.85% branches, 99.07% functions and 99.08% lines.
The existing view-count branch measurement limitation remains documented
in the [testing guide](../testing.md).

Baseline `yarn test:e2e` passed all 47 cases (6 real-login setup cases and
41 business scenarios), including the real periodic worker, in 7.1 minutes.
Local artifacts: `test-results/hydro-blog-58318-41e8ce13/`.

Post-refactor `yarn lint`, `yarn typecheck` and `yarn test:coverage` passed:
46 checked TypeScript files, 10 test files and 383 tests. The original 378 tests
are retained; five composition cases were added. Coverage includes both
extracted modules and reports 99.31% statements, 99.85% branches, 99.53%
functions and 99.21% lines.

Additional local checks:

- Before the initialization naming follow-up below, TypeScript AST comparison
  against the baseline found all 178 production and
  186 existing-test non-import/export declarations identical after the explicit
  internal renames. This checks exact extraction and preserved test bodies,
  not runtime equivalence of arbitrary module graphs.
- Every template is byte-identical to the baseline. Translation values and
  frontend bodies are included in the declaration comparison.
- The relative runtime-import graph has no cycles.
- Eighteen in-memory ESLint probes verified allowed shared/type/model imports
  and rejected browser-to-server, shared-to-model/runtime, model-to-handler/UI
  and prohibited MongoDB imports. No probe files were written.
- Six in-memory naming probes verified `PascalCase` types/classes and
  `camelCase` functions, while retaining native `__prepare`/`postSubmit` methods.
- All 136 relative Markdown links across 18 guides/plans resolved.

The declared Playwright MCP used a separate disposable instance on loopback.
Through the real password form and native editor it created a draft, verified
Markdown rendering, cancelled publication without losing the draft, then
confirmed publication and verified the normal unpublish control and comment
editor. The homepage retained its native Blog navigation, create/my-blog links
and sort selector. No browser console errors were recorded. The login page
showed Hydro's native passkey-origin notice for `127.0.0.1`; password login
worked without bypassing authentication. Evidence:
`test-results/hydro-blog-64764-c6656f62/mcp-article.png` and
`mcp-console.txt` in the same run directory. The browser was closed and the
owned process, MongoDB container and temporary directory were removed.

Post-refactor `yarn test:e2e` passed the same 47 cases in 7.1 minutes, including
real native periodic reminders. Local artifacts:
`test-results/hydro-blog-63886-df3fc983/`. Both automated runs removed their owned
MongoDB containers and temporary runtime directories.

All local acceptance criteria are satisfied. No functionality, UX, business
logic, persisted identifiers or public model API was intentionally changed.

No dependency installation or CI workflow change was required. Remote CI and
additional Hydro/browser/version combinations have not been run; this record
establishes local verification for the versions above, not a deployment matrix.

### Initialization Naming Follow-Up

The initial delivery mixed standalone article/comment index helpers with
settings/review model `init(ctx)` methods. Maintainer feedback identified this
inconsistency. All four initializers now use model-owned `static init(ctx)`;
their contents, awaited order and failure propagation remain unchanged.
AST comparison confirmed that the article/comment initialization bodies are
identical to their original standalone implementations.

After this adjustment, `yarn lint`, `yarn typecheck` and `yarn test:coverage`
passed again (383 tests, unchanged coverage). The focused command
`yarn test:e2e --grep 'draft publication|comments use the native editor'`
passed eight cases: six real logins plus article publication/edit persistence
and native two-level comments/likes. Its owned runtime was cleaned up;
artifacts are in `test-results/hydro-blog-75479-8952ba53/`.
The full 47-case E2E and MCP results above precede this naming-only follow-up;
they were not rerun in full.

### Locale Organization Follow-Up

The former 485-line i18n module mixed translation tuples indexed by language,
route aliases, inline dictionaries and repeated registration. It is now a small
adapter plus explicit `en.ts`, `zh.ts`, `zh_TW.ts` and `ko.ts` catalogs.
English supplies the key contract, and `satisfies BlogLocale` checks the other
three languages. The nine source-text-only English labels remain deliberately
unregistered.

Before editing, all effective locale dictionaries were captured from the actual
registration function. Deep equality after extraction confirmed every key and
value: 118 English entries and 127 entries in each other locale, 499 total.
There are no translation edits or new addon overrides of native labels.
Registration consolidates 20 fragments into four complete locale loads; it
still uses Hydro's native lookup, update events and scope cleanup rather than a
custom cache/fallback layer. Each invocation supplies fresh dictionary objects
so disposal of one application cannot remove another application's catalog.

Source basis: installed Hydro 5.0.7 and the official
[i18n service at the pinned revision](https://github.com/hydro-dev/Hydro/blob/3bae56fe8edddff12346bcb1c8281269c94688d8/packages/hydrooj/src/lib/i18n.ts).
The service prepends registrations, removes them by object identity and applies
its own English-source/language fallback.

`yarn lint`, `yarn typecheck` (52 project files), and
`yarn test tests/unit/i18n.test.ts tests/unit/bootstrap.test.ts` passed:
seven locale cases and five composition cases. In-memory compiler probes
confirmed that a missing translated key fails with TS1360 and an unknown key
fails with TS2353. No probe edits were written to source files.

`yarn test:e2e --grep 'confirmation dialogs localize|notifications use recipient preferences'`
passed all ten cases: six real logins, stale-catalog dialogs in Simplified
Chinese, Traditional Chinese and Korean, and mixed-language review/mention
notifications. Local artifacts:
`test-results/hydro-blog-80551-bec6b81d/`. The owned runtime was cleaned up.
The full business suite, additional MCP checks and remote CI were not rerun
for this catalog-only follow-up; its affected browser flows were checked
through the automated isolated runtime.

### Explicit Feature Entry Points

At the maintainer's request, the composition root now imports from five small
`index.ts` files: articles, comments, integration, review and settings.
They expose only the required model/registration interfaces through named
re-exports, reducing the root from ten imports to five. They contain no runtime
registration logic or wildcard exports.

This replaces the initial blanket recommendation against feature barrels.
Feature implementations still import concrete files rather than their own or
another feature's entry point. ESLint enforces this boundary without relaxing
the shared/browser or Hydro-first import restrictions. Initialization and route
registration remain explicit and ordered in the root `apply`.

`yarn lint`, `yarn typecheck` (57 project files), and the combined bootstrap/i18n
UT selector passed (12 tests). Ten positive/negative import probes passed, and
resolution of relative imports and re-exports found no runtime cycles across
30 entry/feature files.
`yarn test:e2e --grep 'draft publication'` passed seven cases: six real logins
and article publication/edit persistence through the real addon loader.
Artifacts are in `test-results/hydro-blog-83374-c49320f6/`; the owned runtime
was cleaned up. The preceding ten localized browser cases remain the locale
follow-up evidence; the full business suite and remote CI were not rerun
for this entry-point-only change.

### PR Preparation

The final combined tree passed `yarn test:coverage`: 390 tests in 11 files,
with 99.31% statements, 99.85% branches, 99.53% functions and 99.21% lines
in the existing implementation coverage scope. The final lint/type-check
and phased browser evidence are recorded above; final-head remote CI remains
separate evidence.
