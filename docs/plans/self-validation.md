# Self-Validation Capabilities

## Status

In progress: baseline investigation is complete; UT and E2E implementation remains planned for a dedicated PR. No implementation PR is recorded yet.

The [investigation record](self-validation-investigation.md) retains experiments, a recommended approach, and limitations. The repository declares local Playwright MCP and documents its prerequisites; it does not yet deliver the runner, scripts, fixtures, dependencies, or CI jobs described here.

## Goal

Give contributors and agents repeatable ways to verify changes locally and in CI, with evidence of behavioral correctness rather than lint alone.

## Current Baseline

Original baseline reference: repository revision `d4be3cd`, before the agent-documentation changes. The investigation rechecked addon revision `dc5947c`; lint passed, while raw `tsc --noEmit` reported errors in imported dependency sources. Recheck resolved versions and scripts when implementing.

- `package.json` provides `lint` and `lint:fix`, but no automated test or dedicated type-check script.
- PR validation installs dependencies, applies the existing dependency patches, and runs lint.
- There is no documented automated behavioral test workflow.
- Runtime verification may require a configured Hydro instance.
- `yarn.lock` is intentionally ignored; this initiative does not change that policy.

## Scope and Requirements

The implementation PR should establish:

- Documented commands for the checks it introduces, with clear prerequisites and nonzero exit codes on failure.
- A deliberate type-checking approach compatible with Hydro types and the repository's TypeScript configuration.
- A minimal test setup and focused regression coverage for selected existing blog behavior.
- Both UT coverage of addon logic and browser E2E coverage against real Hydro and disposable persistence.
- Clear boundaries between isolated tests and checks that require Hydro or persistence.
- Minimal host impact: container-owned Hydro services, service dependencies, and data, with Playwright running locally in isolated browser sessions. A devcontainer may wrap the service development environment if needed; browser containers are not required.
- Playwright Test for repeatable browser E2E and the project-declared Playwright MCP for agent-assisted verification, with outcomes reported separately.
- Local and CI execution of the same supported checks, with actionable diagnostics.
- Documentation that distinguishes available capabilities from optional or still-planned checks.

The investigation recommends `node:test` with Hydro's loader for UT and a minimal Docker stack for E2E. Exact scripts and fixtures remain implementation work. Do not describe proposed commands as available before they are added.

## Initial Coverage Priorities

These are proposed priorities, not completed tests. Select a small initial set with the highest risk reduction and record the delivered cases. Use the [behavior reference](../blog-behavior.md) to avoid assumptions that exceed the implementation.

| Priority | Candidate | Acceptance scenario | Likely boundary |
| --- | --- | --- | --- |
| P0 | Publication timestamps | Draft creation has no first-publication time; first publication sets it; later edits and republishing preserve an existing value. A legacy single-post read supplies its fallback without claiming a database migration. | Model tests with controlled time and a persistence boundary. |
| P0 | Draft list filtering | Home queries exclude drafts for all viewers. Another user's list excludes drafts for an ordinary viewer, while the owner and a user with `PRIV_EDIT_SYSTEM` retain their list access. | Handler query and permission tests; confirm framework behavior separately. |
| P0 | Write authorization | An ordinary non-owner cannot create for another user or edit or delete their post; the intended owner and system-privileged paths remain available. | Handler preparation with real permission behavior or a suitable Hydro integration test. |
| P1 | Sorting and pagination | Supported keys map to descending values; defaults vary by list and viewer; user-list pinning precedes the selected sort; home has no pin precedence; page size is ten. Avoid relying on unspecified tie ordering. | Query construction, plus persistence-backed ordering where available. |
| P1 | Sequential views and star state | The first eligible read records a view; a later sequential read with recorded status does not increment it. Setting star state updates the current user's status without changing another user's state. | Handler and status persistence boundaries. |
| P1 | Invalid writes and side effects | Invalid input is rejected before mutation; the create rate limiter and create, edit, and delete log calls are preserved. | Validation and write-path tests; no live rate-limit flooding. |
| P2 | Runtime and UI smoke checks | Addon loading, templates, profile links, and relevant translated labels work in a disposable Hydro instance. | Documented manual checks initially; automate when the environment is available. |

P0 marks the first candidates to assess, not a requirement to build every integration environment in the initial PR. Explain any deferred P0 case and the available fallback evidence.

Do not encode unresolved draft-detail visibility, exact tie ordering, atomic multi-write behavior, or concurrent view deduplication as passing guarantees. Resolve the intended contract before writing tests that would establish a new policy.

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
| Establish checks | Add the selected scripts and minimal test tooling without weakening existing checks. | Commands run locally; representative lint, type, or assertion failures produce nonzero exits for the checks introduced. |
| Add initial regressions | Cover selected observable blog behavior, including a relevant denial or boundary case. | Tests detect the targeted defect or behavioral mismatch and pass for the correct implementation. |
| Integrate CI | Run supported checks in PR validation with required setup and cleanup. | The corresponding workflow passes on the PR head, with failure detection verified. |
| Document and hand off | Update agent guides with actual commands, prerequisites, coverage, and remaining gaps. | Documentation matches delivered scripts and CI; outcomes and follow-up work are retained here. |

## Acceptance Criteria

- A contributor can follow the documented setup and run the delivered checks without undocumented manual preparation.
- Introduced checks are non-interactive, bounded, and do not leave owned processes or test data behind.
- The test runner executes meaningful tests and does not silently succeed without discovering them.
- Behavioral tests are deterministic and do not depend on production data or unrelated external services.
- Both UT and E2E have meaningful initial cases, including denial/failure paths; MCP-only exploration does not satisfy automated E2E delivery.
- Runtime checks avoid host Hydro/MongoDB installation and clean up their own container resources and local browser sessions after success or failure.
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

- Implement the recommended UT runner and validate its fixture boundary; keep complete Hydro authorization in E2E.
- Resolve the demonstrated standalone type-check failures with an explicitly scoped check or separately justified dependency compatibility work.
- Provision the minimal Hydro/database/browser environment and choose concrete compatible versions, readiness, fixture seeding, and resource lifecycle.
- Sequence E2E delivery explicitly if it needs a follow-up PR; it remains a required project coverage layer, not an optional substitute for UT.
- Confirm intended direct-link draft visibility before introducing a privacy guarantee beyond list filtering. This is a product-policy decision, not a test-runner choice.
- Decide whether concurrent view deduplication, deterministic tie sorting, or atomic multi-write behavior need separately scoped changes; do not silently add those guarantees in the tooling PR.

## Delivery Record

The baseline investigation milestone is complete; see the [dated findings](self-validation-investigation.md). Development rules now require UT and E2E and a low-impact runtime boundary. The local Playwright MCP declaration passed initialization, tool discovery, blank-page navigation, and browser closure without Docker. Actual addon-flow MCP verification and automated suites are not delivered. Add implementation PRs, actual coverage, container/MCP results, and CI evidence as work progresses.
