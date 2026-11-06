# Self-Validation Investigation

## Status and Scope

Investigation completed on 2026-11-06, against addon revision `dc5947c` on `users/antares/investigate-self-validation`. This records experiments and the recommended implementation sequence, not a delivered UT/E2E suite.

The maintainer requires both unit-test (UT) and end-to-end (E2E) coverage, minimal host operating-system impact, and a project Playwright MCP declaration. Docker is available as an approach; a devcontainer is optional. These requirements are reflected in the [development guide](../development.md), [testing requirements](../testing.md), and [verification-environment guide](../verification-environment.md).

## Observed Baseline

Local experiments used macOS, Node `24.22.1`, Yarn `1.22.22`, TypeScript `5.9.3`, and ESLint `10.13.0`. Installation resolved Hydro `5.0.7`, framework `0.3.2`, default UI `4.58.5`, register `1.0.4`, and esbuild `0.25.2`. These are observations, not pinned dependencies or a certified deployment matrix.

| Check | Observed result | Meaning |
| --- | --- | --- |
| Dependency restoration | Installation completed; `patch-package` applied the framework patch with a version-mismatch warning: patch `0.3.0`, installed `0.3.2`. | Installation success does not establish full patch compatibility. Retain the warning and test the affected validators. |
| `yarn lint` | Exit 0. | Existing lint baseline passed. |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false` | Exit 2; 432 error diagnostic headers, all in imported dependency sources. | A raw standalone full type check cannot currently be advertised as green. |
| Native Node import of a utility | Exit 0. | Native TypeScript support can handle some addon files, but this is not meaningful behavioral coverage. |
| Native import of `features/handler.ts` | Exit 1 at the first decorator. | Node's native TypeScript handling is insufficient for this addon. |
| Official loader followed by bare `require("hydrooj")` | Exit 1: the hashing module accesses an uninitialized `global.Hydro.module`. | Loading the full plugin API is not a lightweight unit-test bootstrap. |
| Docker availability | CLI `29.9.2`; default daemon socket unavailable. | No container, browser, or real Hydro E2E run was executed. Do not start a system service or install another runtime implicitly. |

Corepack's default Yarn archive download succeeded through a temporary loopback proxy with Node environment-proxy support enabled. No shared registry or global proxy configuration was changed. That workstation-specific workaround is not a project test prerequisite.

## UT Mechanism Experiment

Recommended runner: `node:test` with `node:assert/strict` and the official `@hydrooj/register` TypeScript loader. Declare the loader directly in development dependencies when implementing the suite rather than relying on its current transitive availability.

A temporary CommonJS test file outside the repository used `createRequire` rooted at the addon, loaded the actual model and registered handler classes, and substituted only the top-level Hydro API boundary through a saved/restored module-cache entry. It supplied a temporary `global.Hydro.model` and restored it after the run. The fixture used the installed real framework `param` decorators and `Types` validators, not no-op decorators. No database or application server was started.

The experiment executed nine tests:

1. Draft creation omits `firstPublishAt` and uses the system-domain blog document boundary.
2. Published creation assigns the same first-publication and update time.
3. Controlled-clock first publication assigns a timestamp; subsequent editing, unpublishing, and republishing preserve it.
4. A legacy single-post read provides its fallback without writing to persistence.
5. The home handler constructs the non-draft query, default sort, and ten-item page.
6. User-list queries distinguish an ordinary viewer, owner, and system editor.
7. The real page validator rejects malformed input before querying.
8. The real title validator rejects malformed input before mutation, logging, or rate-limit side effects.
9. Foreign create/edit preparation delegates to the privilege boundary; owner and simulated system-editor paths remain available.

The unchanged source passed all nine tests with exit 0. A controlled in-memory source mutation changed the model's `if (!draft)` creation branch to `if (draft)` before transformation; three publication tests failed and the process exited 1. No tracked application source was edited for the negative control. The experiment ran with a ten-second runner timeout and a twenty-second parent-process timeout.

These are feasibility results, not committed test coverage. Permission enforcement in test 9 was a fixture, not Hydro's real service; query tests did not execute MongoDB ordering; handlers were invoked without the complete routing lifecycle. Do not describe them as authorization, database, or browser E2E proof.

Implementation constraints:

- Use process-isolated test files, restore module/global state, and avoid concurrent tests sharing mutable fixture state.
- Keep the Hydro boundary fixture small, explicit, and matched to installed API signatures. An initial fixture error passed the wrong argument as the query; the test caught it and the fixture was corrected.
- Call decorated methods with the framework-style raw argument object including `domainId`. Positional calls can bypass validation in the real decorator.
- The standalone framework `Types.ObjectId` converter is initially a placeholder until Hydro initializes it. Do not claim real identifier validation from the minimal fixture.
- Do not add a custom application bootstrap or generic mocking framework merely to support isolated tests.

## Runner and Type-Check Failure Detection

| Experiment | Outcome | Implementation requirement |
| --- | --- | --- |
| A passing `node:test` assertion and a deliberately failed assertion | Exit 0 and exit 1 respectively. | Preserve runner exits and report assertion failures. |
| `node --test '__investigation_missing_tests__/**/*.test.cjs'` | Exit 0 with zero tests. | Discover test files explicitly and reject an empty set before spawning the runner. |
| `fs.globSync` discovery with an explicit empty-set guard | Empty discovery exited 1. | Also establish that selected files contain executed tests, not only that filenames exist. |
| Compiler API with the existing tsconfig | 432 dependency errors; zero addon/global errors. | Do not label this a successful full `tsc` run. |
| Same compiler program with an in-memory `number = "wrong"` assignment appended to `features/utils.ts` | 433 errors, including one project TS2322 diagnostic. | A proposed project-scoped gate can detect addon errors while separately reporting dependency diagnostics. |
| An incompatible module/module-resolution option combination | Produced a compiler option error without a source file. | Configuration/global diagnostics must remain blocking. |

Recommended type-check direction: keep the current compiler settings and investigate a clearly labeled project-scoped Compiler API check. Report dependency-error counts separately, fail for project/configuration/global errors, and fail if expected addon files are absent or inputs cannot be read. Use path-aware containment, not a loose substring or filtered shell pipeline. The minimal experiment tested diagnostic classification, not a complete supported script.

Do not substitute `noCheck`, a permissive ambient Hydro shim, broad compiler relaxations, or a zero exit from an error-filtering pipeline. Imported dependency TypeScript files remain part of the program even when `node_modules` is excluded as a root; `skipLibCheck` does not suppress errors in ordinary `.ts` implementation files.

## Alternatives and E2E Boundary

| Approach | Assessment |
| --- | --- |
| Native Node TypeScript only | Rejected for handler tests: the decorator parse failure was reproduced. |
| `node:test` plus Hydro's loader | Preferred for UT: proven real-source/decorator loading, failure propagation, controlled clocks, and no new general-purpose runner. Loader transformation is not type checking. |
| Vitest | Not selected for the initial implementation. Its documented `vi.mock` limitation for `require` imports adds a mocking/transform boundary to the CommonJS Hydro path; no Vitest experiment was run. Revisit only if a concrete requirement outweighs the simpler proven route. |
| Full upstream Hydro test bootstrap | Useful reference for actual runtime integration, not the UT default. It starts the application and its CI database path can download a MongoDB binary. Do not copy the upstream test teardown's forced `process.exit(0)` into addon checks. |
| Playwright Test against disposable Hydro | Required E2E direction: real sessions, permissions, templates, persistence, and browser behavior. Not executed during this investigation. |
| Playwright MCP | Local initialization, discovery of 25 tools, `about:blank` navigation, and browser closure passed without Docker. This is agent-assisted verification infrastructure, not an automated E2E suite; real Hydro flows still require the service environment. |

For minimal host impact, implement only the services in the [verification-environment proposal](../verification-environment.md#proposed-runtime-boundary). Upstream Docker and devcontainer examples include judges and privileges irrelevant to this addon. Upstream explicitly labels the Docker installation module as not officially maintained; use its source as a reference, not a certified test stack.

Maintainer clarification on 2026-11-06: Playwright should run locally; browser containerization is unnecessary for development. Keep Docker isolation for Hydro and MongoDB, expose Hydro on loopback for local browser access, and use independent test profiles. Containerized browsers remain an optional CI choice.

## Proposed Implementation Sequence

1. Add the UT runner, direct loader dependency, discovery guards, bounded execution, and the proven publication/query cases. Retain real decorators for invalid-input tests. Prove negative controls and cleanup.
2. Deliver an explicitly scoped type-check command with visible dependency diagnostics, or resolve upstream compatibility in a separate dependency change. Do not silently turn a failed full type check green.
3. Provision a minimal Docker Compose runtime with Node 24, compatible resolved Hydro/UI packages, private MongoDB, addon registration, deterministic account seeding, readiness, and owned-resource cleanup. Verify the framework patch against the actual installed version.
4. Add Playwright Test E2E for publication/list visibility, rejected non-owner writes, edit/delete persistence, and rendering. Map cases to the existing smoke protocol. Use independent author/viewer/editor sessions and assert database-visible results through supported test boundaries.
5. Connect the declared MCP server, verify browser tools and navigation, exercise a relevant flow, retain evidence, and confirm cleanup. Record this separately from automated E2E.
6. Run supported lint, UT, project type checks, and E2E in CI with the same container definitions as local use; export actionable failure reports. Add a devcontainer wrapper only if needed.

Implementation acceptance must include deliberate assertion/type failures, empty UT/E2E discovery, unavailable runtime, failed addon readiness, timeout handling, and cleanup after failures. These are acceptance requirements, not already completed experiments. Keep unresolved direct-link draft privacy, concurrent view deduplication, transaction semantics, and equal-key tie ordering outside this tooling decision.

## Sources and Remaining Gaps

Upstream Hydro source was inspected at `3c8286dd1350fcd00412e95d5b056dbfed64edda`; installed Hydro `5.0.7` was inspected separately. The upstream commit's manifest version is not proof of the installed version.

- [Hydro standalone test command](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/package.json), [test bootstrap](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/test/entry.js), and [application tests](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/test/main.ts).
- [Official loader](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/framework/register/index.js), [decorators](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/framework/framework/decorators.ts), and [database CI behavior](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/packages/hydrooj/src/service/db.ts).
- [Node 24 test runner](https://nodejs.org/docs/latest-v24.x/api/test.html), [TypeScript `skipLibCheck`](https://www.typescriptlang.org/tsconfig/skipLibCheck.html), and [Vitest mocking limits](https://vitest.dev/api/vi.html#vi-mock).
- Container and MCP primary references are retained in the [environment guide](../verification-environment.md#source-basis).

The initial Docker MCP proposal included inspected image metadata but was superseded by the maintainer's local-browser direction and the [official MCP getting-started guide](https://playwright.dev/docs/getting-started-mcp). `.github/mcp.json` now pins the locally launched `@playwright/mcp` package to `0.0.83`, an available published version, with headless Chrome and an isolated profile. No MCP Docker image or dedicated Docker network is needed for startup. A bounded local probe verified initialization, 25 tools, blank-page navigation, and browser closure with exit 0.

Remaining gaps: running Docker engine for the service stack, a provisioned Hydro environment, MCP verification of an actual addon flow, real browser E2E, repeatable committed UT fixtures, a supported project type-check command, and head-specific CI evidence. No claim of complete self-validation or full patch compatibility is made.
