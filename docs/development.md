# Development Guidelines

## Official Hydro References

Use the [Hydro repository](https://github.com/hydro-dev/Hydro) as the primary source for framework APIs, base implementations, and integration patterns.

Use the [official Hydro documentation](https://docs.hydro.ac/zh/docs/Hydro) for related concepts, configuration, deployment, and extension guidance. Reading Chinese reference material is acceptable; documentation added to this repository must remain in English.

Useful starting points in the upstream repository:

| Location | Reference area |
| --- | --- |
| `packages/blog/` | Original blog addon implementation. |
| `packages/hydrooj/src/handler/` | Request handling and permission patterns. |
| `packages/hydrooj/src/model/` | Persistence APIs and document behavior. |
| `packages/hydrooj/src/` | Context, plugin APIs, services, and shared types. |
| `packages/ui-default/` | Default UI, frontend integration, and templates. |
| `framework/` | Underlying framework implementations. |

Before implementing a Hydro-dependent change:

1. Identify the affected API or behavior and inspect its existing use in this addon.
2. Locate the corresponding implementation and representative callers in the official Hydro repository. Do not invent API signatures or infer behavior from names alone.
3. Consult the relevant official documentation when available.
4. Check compatibility with the dependency ranges declared in `package.json` and the actual installed versions, types, or source when available. Upstream `master` may differ from the version used by this addon.
5. Follow the compatible upstream pattern while preserving this addon's intended behavior. Include relevant source paths or links in the PR description when they explain a non-obvious decision.

If references are unavailable or conflicting, state the limitation and verify against the applicable implementation before claiming compatibility.

For version-sensitive decisions, record the upstream commit, tag, or installed package version used as evidence. Prefer commit-specific source links in PR descriptions over moving branch links. See [dependency troubleshooting](validation.md#dependency-and-patch-troubleshooting) when the resolved versions or patches differ between environments.

## Implementation Rules

- Make the smallest complete change for the requested behavior. Avoid unrelated refactoring or new abstractions.
- Follow `eslint.config.mjs`, `.prettierrc`, and existing TypeScript patterns.
- Reuse existing constants, types, helpers, and localization mechanisms.
- Prefer tools, APIs, utilities, and reusable code exposed by Hydro. Inspect the compatible upstream implementation before adding an equivalent; implement a custom alternative only when no suitable exposed implementation exists, and document why reuse is not possible.
- Keep shared contracts consistent across server code, templates, frontend code, and translations.
- Apply the [Hydro-first dependency policy](#third-party-dependencies) to all
  third-party runtime values and types, not only MongoDB.
- Preserve the dependency patching workflow. Inspect relevant patches when changing affected dependencies.
- Add concise English comments only when they clarify non-obvious intent or constraints.

## Implementation Workflow

1. Define observable acceptance criteria before implementation. Identify affected callers, data, permissions, and failure paths.
2. Read the relevant code and upstream references. Identify how the changed behavior can be verified using the [validation guide](validation.md) and [testing requirements](testing.md).
3. Implement a complete, focused change, keeping dependent call sites and user-visible behavior consistent.
4. Add or update unit tests (UT) for changed logic and end-to-end tests (E2E) for affected user flows. Follow the [testing requirements](testing.md) for boundaries and missing infrastructure. For a bug fix, capture the failing scenario before the fix when practical.
5. Run the applicable checks, inspect the final diff, and record results and limitations. Update related documentation and any active [project plan](plans/README.md).

Do not treat successful compilation, linting, or a plausible-looking diff as proof that changed behavior works.

The project's coverage goal includes both UT and E2E; neither replaces the other. Use the [low-impact verification environment](verification-environment.md): local Hydro and Playwright, a disposable MongoDB container, and environment-controlled user-writable configuration, storage, and temporary paths. Do not copy upstream devcontainer assumptions or require root access. A devcontainer is optional, not a prerequisite. Use the project-declared Playwright MCP for agent-assisted browser investigation and verification, and retain repeatable regressions as executable tests rather than only a conversation transcript.

## Code Requirements

### Identifier and File Naming

- Name feature directories by domain (`articles`, `comments`, `review`,
  `settings`). Name files by subject and responsibility: `article.model.ts`,
  `comment.handler.ts`, `review.policy.ts`, `article.projection.ts`.
  Avoid generic feature files named `model.ts`, `handler.ts` or `utils.ts`.
- Use `PascalCase` for classes, interfaces, type aliases and related `as const`
  value objects; use `camelCase` for functions, methods, parameters and locals.
  Use `UPPER_SNAKE_CASE` for standalone module constants and lookup tables.
  ESLint enforces type/class and standalone function naming; method/property
  names remain compatible with Hydro lifecycle and serialized contracts.
  Hydro parameter descriptors retain the existing `OptionalBoolean` and
  `OptionalReviewComment` style, matching framework descriptors such as `Types`.
- Name route registration functions `apply<Feature>Handlers`. Each persistent
  model exposes `static async init(ctx: Context)` for its storage initialization,
  including index-only setup; invoke these methods explicitly from the
  composition root. Keep the root framework entry named `apply`.
  Feature modules must not register routes simply by being imported.
- Name tests for the subject under test (`article.model.test.ts`,
  `article.handler.test.ts`, `settings.policy.test.ts`). Workflow suites that
  intentionally cover several layers may retain feature-level names such as
  `comments.test.ts` or `review.test.ts`.
- Treat existing handler class names, lifecycle methods, `postXxx` operations,
  public model methods, route IDs, permission keys/bits, template context keys,
  database fields, collection/index names, translation keys and wire values as
  compatibility identifiers. Do not normalize these during an internal rename.
  In particular, Hydro derives event names from handler class names.
- Retain Hydro vocabulary (`ddoc`, `udoc`, `did`, `uid`, `drid`, `drrid`) at
  framework and template boundaries. Use descriptive names for new internal
  concepts instead of renaming serialized fields or introducing aliases for
  every existing framework identifier.

Follow the [module boundaries](project-structure.md#dependency-boundaries).
Expose root-level integration through a feature's explicit named-export
`index.ts`; keep implementation-to-implementation imports pointed at concrete
files. Entry points do not own initialization, business logic or wildcard exports.
When moving code, update explicit imports, coverage targets and current guide
links in the same change. A naming cleanup is not authorization to rewrite
queries, validation, defaults, error handling or operation ordering.

### Constants and Shared Types

- Follow `features/shared/constants.ts`: centralize shared domain/protocol strings and meaningful numeric settings, and reuse them across models, handlers, frontend code, and localization instead of repeating literals.
- Prefer `as const` value objects for related values and derive literal unions with `typeof` and `keyof`. Reuse named types for repeated object shapes or `Pick`/union declarations; do not maintain a separate literal-type list for values already defined at runtime.
- Keep constants at the smallest useful scope, and do not merge equal values with different meanings. Preserve persisted identifiers, permission bits, wire values, and defaults during extraction. Ordinary arithmetic, declarative template markup, and independent test expectations need not be replaced merely because the same text appears elsewhere.

### Third-Party Dependencies

For every third-party dependency, first check whether Hydro exposes the required
runtime value, type, or equivalent API. If it does, use that public export:
`hydrooj` for server code, or the appropriate supported Hydro frontend API.
Direct third-party imports or new direct dependencies are allowed only when no
suitable Hydro export exists for the supported version and execution context.
Convenience or an existing dependency declaration is not an exception.

Before adding or changing a third-party import:

1. Inspect the official Hydro source and compatible installed public exports.
   Do not assume an export exists or import private Hydro internals as a workaround.
2. Prefer the Hydro export for both runtime values and type-only imports.
3. If no suitable export exists, document the checked source/version and why
   direct use is necessary in the PR and relevant development documentation.
   Declare only the dependency and scope actually needed.

For MongoDB, addon runtime values such as `ObjectId` must come from `hydrooj`.
Prefer Hydro's `Filter` and `ObjectId` types too. Types that Hydro does not directly
export, such as `Collection` and `SortDirection`, may use `import type` from
`mongodb`. ESLint enforces this known boundary for the addon entry, features,
frontend and ordinary unit tests; the same source-checking policy applies to
other third-party libraries even when no lint guard exists yet.

Standalone verification tools and the Hydro test mock use the MongoDB driver
because they must provision isolated databases or supply the mocked API without
bootstrapping the application being tested. This is a documented execution-boundary
exception, not a general exemption for tests; ordinary unit tests use Hydro exports.
Node.js built-in modules are not third-party dependencies.

### Localization

Keep application translations in `features/integration/locales/`: one explicit
dictionary per Hydro locale ID (`en`, `zh`, `zh_TW`, `ko`). Do not encode languages
as positional array entries or mix translation data into registration functions.
Keep dictionary entries in corresponding order across languages.

`en.ts` defines the required translated-key set. Other catalogs use
`satisfies BlogLocale` to reject missing or misspelled keys without widening
the dictionary to `Record<string, string>`. Computed sort-label keys use
`as const` so their literal types remain checkable. Preserve symbolic keys from
the shared constants catalog rather than copying permission or route IDs.

Nine existing article labels intentionally rely on Hydro's source-text fallback
in English. `SOURCE_TEXT_KEYS` records this exception and requires their
translations in the other catalogs; do not register English identity entries
for them as an incidental cleanup. Likewise, do not copy Hydro-owned labels
into the addon unless an intentional override is required.

When adding an addon-owned translation, update English and all three translated
catalogs together. Preserve interpolation positions and format suffixes such as
`{0}` and `{4:link}`. Keep route-title aliases aligned with their feature titles.
Run `yarn typecheck` and `yarn test tests/unit/i18n.test.ts`, plus the affected
real-Hydro language/notification flows from the testing guide.

`applyBlogI18n` only registers fresh copies through `ctx.i18n.load`; Hydro retains
ownership of lookup, fallback, update events and disposal. Do not share the same
dictionary object between addon applications: Hydro removes registrations by
object identity. This boundary was checked against installed Hydro 5.0.7 and
the official `packages/hydrooj/src/lib/i18n.ts` at commit
`3bae56fe8edddff12346bcb1c8281269c94688d8`.

### UI and Styling

- Reuse Hydro's built-in UI components, styles, and interaction patterns wherever possible instead of recreating them in the addon.
- Align UX with existing Hydro patterns, not just visual styling. Inspect the corresponding native workflow and reuse its information hierarchy, control placement, dialogs, selection and bulk actions, feedback, and navigation; document any necessary behavior-specific differences.
- Avoid overriding Hydro's own UI with HTML templates unless necessary. When an existing Hydro UI needs adjustment, prefer script injection through the extension mechanisms described in the official Hydro documentation, and verify the approach against the compatible upstream source.
- If a template override or custom UI/style is unavoidable, document why the existing UI and documented script-injection mechanisms cannot meet the requirement, and keep the customization minimal.

### Handler Lifecycle

Follow the [Hydro handler lifecycle](handler-lifecycle.md). Let the framework
invoke lifecycle hooks; never call them from handler actions. Keep common
preparation in hooks, operation-specific permissions in actions, and genuine
shared behavior in ordinary helpers.

### Types and Input Validation
- Use existing domain types and type-only imports where appropriate. Avoid introducing `any`, unsafe assertions, or lint suppressions to conceal a mismatched contract.
- Validate untrusted request parameters with the established Hydro mechanisms. TypeScript types do not validate runtime input.
- Validate supported sort keys, identifiers, pagination parameters, and state transitions before using them in queries or writes.
- Keep permission and ownership enforcement on the server. Hiding a UI control is not authorization.
- Preserve template escaping and existing content-rendering protections. Do not mark user-controlled content as trusted merely to make rendering work.

### State Changes and Failure Handling

- Await required asynchronous work and propagate failures through existing Hydro error-handling conventions.
- Do not silently swallow errors or report success after an incomplete operation.
- Consider concurrent requests, repeated operations, and partial failures when changing counters, status records, or multi-step writes. Use the applicable Hydro or database guarantees where needed.
- Do not add a transaction, retry loop, cache, or background task without a concrete requirement and a defined failure strategy.
- Do not expose credentials, private content, or unnecessary personal data through errors or logs.

### Data and Compatibility

- Keep database reads bounded through existing pagination and query mechanisms. Avoid introducing repeated per-document lookups when bulk APIs are available.
- Consider existing records and default values when adding or changing fields.
- Document any required migration, index change, or intentional compatibility break. Do not perform destructive migrations implicitly during an unrelated request.
- Prefer existing Hydro extension points over copying framework internals or adding dependency patches. If a patch is necessary, document why and how to verify it.

## Behavioral Invariants

Use the [blog behavior reference](blog-behavior.md) for the source-derived baseline and its limits. A baseline observation is not permission to preserve a defect or to introduce a behavior change without an explicit decision.

- Preserve ownership checks, privilege checks, and draft visibility rules unless the requested change explicitly modifies them.
- Keep blog persistence within the existing domain and document-type boundaries.
- Scope database indexes to blog documents because the document collection is shared.
- Preserve compatibility with existing documents, including records without `firstPublishAt`.
- Keep list sorting behavior and supporting indexes aligned.
- Preserve creation rate limiting and create, edit, and delete operation logs when changing the corresponding write paths.
