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
- Keep shared contracts consistent across server code, templates, frontend code, and translations.
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
