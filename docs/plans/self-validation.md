# Self-Validation Capabilities

## Status

In progress: initial Vitest UT, a local development runtime, and real-browser E2E are delivered and verified locally and in [PR #8](https://github.com/tywzoj/hydro-addon-blog/pull/8). A supported type-check command and broader coverage remain follow-up work.

The [investigation record](self-validation-investigation.md) retains experiments and limitations. The repository provides local Playwright MCP, Vitest UT, managed local Hydro with disposable MongoDB, and Playwright E2E. The workflow includes lint, UT coverage, and E2E; recheck the actual PR head after every push rather than reusing earlier evidence.

## Goal

Give contributors and agents repeatable ways to verify changes locally and in CI, with evidence of behavioral correctness rather than lint alone.

## Current Baseline

Original baseline reference: repository revision `d4be3cd`, before the agent-documentation changes. The investigation rechecked addon revision `dc5947c`; lint passed, while raw `tsc --noEmit` reported errors in imported dependency sources. Recheck resolved versions and scripts when implementing.

- `package.json` provides `lint` and `lint:fix`, but no automated test or dedicated type-check script.
- PR validation installs dependencies, applies the existing dependency patches, and runs lint.
- There is no documented automated behavioral test workflow.
- Runtime verification may require a configured Hydro instance.
- `yarn.lock` is intentionally ignored; this initiative does not change that policy.

The bullets above describe the original baseline. The UT implementation now supplies `test`, `test:watch`, and `test:coverage`, with lint and coverage in PR validation. Subsequent CI evidence is recorded below.

## Scope and Requirements

The implementation PR should establish:

- Documented commands for the checks it introduces, with clear prerequisites and nonzero exit codes on failure.
- A deliberate type-checking approach compatible with Hydro types and the repository's TypeScript configuration.
- A minimal test setup and focused regression coverage for selected existing blog behavior.
- Both UT coverage of addon logic and browser E2E coverage against real Hydro and disposable persistence.
- Clear boundaries between isolated tests and checks that require Hydro or persistence.
- Minimal host impact: local Hydro and Playwright, isolated environment-controlled writable directories, and only MongoDB in Docker. A devcontainer may wrap this setup if useful but is not required.
- Playwright Test for repeatable browser E2E and the project-declared Playwright MCP for agent-assisted verification, with outcomes reported separately.
- Local and CI execution of the same supported checks, with actionable diagnostics.
- Documentation that distinguishes available capabilities from optional or still-planned checks.

The maintainer selected Vitest for UT, superseding the investigation's `node:test` recommendation. The delivered tests use Vitest module mocking and real framework decorators loaded through Hydro's register module. Subsequent source research established that Hydro can run locally without root; the delivered E2E runtime only containerizes MongoDB.

## Initial Coverage Priorities

These are proposed priorities, not completed tests. Select a small initial set with the highest risk reduction and record the delivered cases. Use the [behavior reference](../blog-behavior.md) to avoid assumptions that exceed the implementation.

| Priority | Candidate | Acceptance scenario | Likely boundary |
| --- | --- | --- | --- |
| P0 | Publication timestamps | Draft creation has no first-publication time; first publication sets it; later edits and republishing preserve an existing value. A legacy single-post read supplies its fallback without claiming a database migration. | Model tests with controlled time and a persistence boundary. |
| P0 | Draft list filtering | Home queries exclude drafts for all viewers. Another user's list excludes drafts for an ordinary viewer, while the owner and a user with `PRIV_EDIT_SYSTEM` retain their list access. | Handler query and permission tests; confirm framework behavior separately. |
| P0 | Write authorization | All users, including system editors, create only under their own identity. Editing or deleting another user's post requires the corresponding permission; authorized system-editor management paths remain available. | Handler preparation with real permission behavior or a suitable Hydro integration test. |
| P1 | Sorting and pagination | Supported keys map to descending values; defaults vary by list and viewer; user-list pinning precedes the selected sort; home has no pin precedence; page size is ten. Avoid relying on unspecified tie ordering. | Query construction, plus persistence-backed ordering where available. |
| P1 | Sequential views and star state | The first eligible read records a view; a later sequential read with recorded status does not increment it. Setting star state updates the current user's status without changing another user's state. | Handler and status persistence boundaries. |
| P1 | Invalid writes and side effects | Invalid input is rejected before mutation; the create rate limiter and create, edit, and delete log calls are preserved. | Validation and write-path tests; no live rate-limit flooding. |
| P2 | Runtime and UI smoke checks | Addon loading, templates, profile links, and relevant translated labels work in a disposable Hydro instance. | Documented manual checks initially; automate when the environment is available. |

P0 marks the first candidates to assess, not a requirement to build every integration environment in the initial PR. Explain any deferred P0 case and the available fallback evidence.

Draft-detail policy is now explicitly defined by the [global permission plan](blog-permissions.md): draft-read permission is required on direct links as well as lists. Exact tie ordering, atomic multi-write behavior, and concurrent view deduplication remain outside established guarantees.

## Non-Goals

- Feature development or unrelated refactoring.
- Comprehensive coverage of every existing behavior in the first tooling PR.
- A framework rewrite or an alternative implementation of Hydro.
- Tests that require production infrastructure or secrets.
- Changing the package manager or lockfile policy.

## Proposed Milestones

| Milestone | Deliverable | Completion evidence |
| --- | --- | --- |
| Inspect the baseline (completed) | Identify suitable test boundaries, Hydro compatibility constraints, and prerequisites for type checking. | [Investigation findings](self-validation-investigation.md) record baseline checks, nine passing isolated experiments, a failing mutation control, and remaining gaps. |
| Establish checks (UT delivered) | Add Vitest scripts and V8 coverage without weakening lint. | Non-watch UT and coverage pass locally; empty discovery/suites and a publication mutation exit nonzero. Dedicated type checking remains pending. |
| Add initial regressions (UT/E2E delivered) | Cover selected logic and real browser/service behavior, including denial paths. | 65 UT and nine Playwright checks pass locally; the publication mutation is detected. Broader runtime coverage remains follow-up work. |
| Integrate CI (verified) | Run supported checks in PR validation with required setup and cleanup. | The workflow passed lint, 65 UT, and nine Playwright checks on PR #8 commit `bf9ec33`; later heads must be checked independently. |
| Document and hand off | Update agent guides with actual commands, prerequisites, coverage, and remaining gaps. | Documentation matches delivered scripts and CI; outcomes and follow-up work are retained here. |

## Acceptance Criteria

- A contributor can follow the documented setup and run the delivered checks without undocumented manual preparation.
- Introduced checks are non-interactive, bounded, and do not leave owned processes or test data behind.
- The test runner executes meaningful tests and does not silently succeed without discovering them.
- Behavioral tests are deterministic and do not depend on production data or unrelated external services.
- Both UT and E2E have meaningful initial cases, including denial/failure paths; MCP-only exploration does not satisfy automated E2E delivery.
- Runtime checks avoid global Hydro/MongoDB installation and root-only paths; clean up owned child processes, MongoDB, local sessions, and temporary files after success or failure.
- The declared MCP is verified through initialization, tool discovery, test-site navigation, and cleanup before claiming it operational.
- CI exercises the same supported checks documented for local use.
- Required checks fail visibly when their validation fails; optional environment-dependent checks are explicitly labeled.
- Existing lint, patch application, and runtime behavior are preserved.
- Remaining gaps are recorded with their impact rather than presented as completed work.

## Validation Approach

Use a suitable clean installation or disposable environment to verify setup. Run the supported commands and deliberately introduce temporary, controlled failures to verify the relevant checks reject them, restoring those changes before submission.

For behavioral tests, confirm representative regression assertions fail for the defective behavior and pass for the intended behavior. For checks requiring Hydro or persistence, document the supported environment and isolate owned resources.

Review the workflow for the actual PR head and update the [validation guide](../validation.md) and [testing requirements](../testing.md) with the delivered capabilities.

## Dependencies and Open Decisions

- Extend the delivered Vitest cases as behavior changes; keep complete Hydro authorization in E2E.
- Resolve the demonstrated standalone type-check failures with an explicitly scoped check or separately justified dependency compatibility work.
- Extend the proven local Hydro/disposable MongoDB/browser environment as needed, retaining its checked storage boundary and lifecycle.
- Extend E2E coverage for remaining sorting, pagination, localization, and relevant failure scenarios without claiming unsupported privacy or concurrency guarantees.
- Direct-link draft visibility was resolved in the [global permission plan](blog-permissions.md); its handler and real-browser regressions enforce the agreed draft-read permission.
- Decide whether concurrent view deduplication, deterministic tie sorting, or atomic multi-write behavior need separately scoped changes; do not silently add those guarantees in the tooling PR.

## Delivery Record

The baseline investigation milestone is complete; see the [dated findings](self-validation-investigation.md). Documentation and the local MCP declaration were committed as `9b68128`. The MCP declaration passed initialization, tool discovery, blank-page navigation, and browser closure without Docker.

On 2026-11-06, the maintainer selected Vitest and the initial UT implementation added 65 passing cases, `yarn test`, optional watch mode, V8 coverage, and a CI coverage step. Coverage of the explicitly selected model/handler files was 98.82% lines and 100% branches; this is not whole-project or E2E coverage. Failure controls rejected unmatched discovery, an empty suite, and an in-memory publication mutation.

Vitest and `@vitest/coverage-v8` are pinned together at `4.0.18`, with Vite 7 and Hydro register `1.0.4`. An attempted `4.1.12` pairing reproducibly failed Yarn Classic's Vite linking; the selected combination installed and applied the existing framework patch successfully, retaining its pre-existing version warning.

UT implementation was committed as `1aa01a4`. The subsequent E2E implementation supplies `yarn dev` and `yarn test:e2e`, with Playwright `1.64.1`, locally resolved Hydro `5.0.7`/UI `4.58.5`, and `mongo:7-jammy`. On macOS with Node `24.22.1`, three real-login setup cases and six business scenarios passed. The runtime explicitly redirects `DEFAULT_STORE_PATH`, `HOME`, and temporary paths; only MongoDB runs in Docker. The official devcontainer was inspected but not used.

Failure/lifecycle evidence includes a nonzero empty E2E selection, an invalid port, real failing browser assertions during development, isolated Hydro startup under a CI parent, and graceful development shutdown with owned MongoDB/storage cleanup. The Playwright MCP also logged in, published a post through the actual editor, and confirmed the rendered detail. A force-stopped tool helper required targeted cleanup, motivating the run-owned resource manifest and explicit uncatchable-kill limitation.

Runtime integration findings: Cordis services require injection; Hydro's page marker follows the template basename rather than the route name; a hidden login modal duplicates form fields; and star clicks must target the generated button, not its containing element. The E2E selectors and assertions account for these actual framework/UI contracts.

PR #8's [validation run 42183061237](https://github.com/tywzoj/hydro-addon-blog/actions/runs/42183061237) passed on commit `bf9ec331803762ffbce95b031d57091ecaae276b` on 2026-11-06. The Ubuntu 26 runner completed dependency installation, lint, 65 UT, and nine Playwright checks, with Hydro storage under its writable temporary directory. This is evidence for that commit and runner, not every future head or deployment.

Remaining work: supported type checking, broader E2E scenarios, and cross-platform/version-matrix verification. This PR is not merged, and no full-runtime compatibility claim is made.
