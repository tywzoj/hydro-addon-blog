# Testing Requirements

## Current Capability and Scope

The repository currently has linting but no automated test script. The [self-validation plan](plans/self-validation.md) tracks a separate PR for the missing capabilities.

This guide defines expectations for implementation work; it does not claim that a test runner, fixtures, integration environment, or additional CI checks already exist. Do not invent executable commands for planned capabilities.

## Required Coverage Layers

The project must develop and maintain both unit-test (UT) and end-to-end (E2E) coverage. Coverage means meaningful assertions for behavior and failure paths, not a mandated percentage or testing every function.

| Layer | Responsibility | Initial examples |
| --- | --- | --- |
| UT | Execute actual addon logic deterministically, replacing only external boundaries. Small handler-contract tests may share this runner but must identify their simulated services. | Publication timestamps, legacy-read fallback, query construction, and invalid input before side effects. |
| E2E | Exercise the loaded addon through a real browser, real Hydro routing, sessions, permissions, templates, and disposable persistence. Do not replace these with mocks. | Author creates and publishes a post; another viewer sees only published list entries; a non-owner write is denied without mutation; edits and deletion persist after reload. |

For behavior changes, select the affected cases in both layers; explain when a layer is not applicable. A UT assertion that a handler calls a privilege service is not proof that Hydro enforces access end to end. Template or browser-flow changes need E2E evidence even when no isolated UT is useful.

Use Playwright Test for the planned repeatable browser E2E suite and the [declared Playwright MCP](verification-environment.md#project-playwright-mcp) for agent-assisted exploration, reproduction, and browser verification. MCP sessions supplement, not replace, checked-in E2E tests and their CI results. Promote discovered regressions into executable UT or E2E cases at the appropriate boundary.

Both runners must reject empty discovery and relevant failures with nonzero exits, have bounded execution, and clean up run-owned resources. Record separately which UT, E2E, and MCP checks actually ran. Until the tooling exists, report missing coverage against this goal using the fallback below.

## Coverage Expectations

- Add or update focused tests for new behavior and bug fixes when suitable infrastructure is available.
- For a regression, the test should fail for the original defect and pass with the fix. Confirm this when practical.
- Cover the intended success case and relevant boundary, invalid-input, permission-denial, and failure cases. Select cases based on the change rather than testing every combination mechanically.
- Verify externally observable behavior and state changes, not private implementation details.
- Test repeated or concurrent operations when correctness depends on uniqueness, idempotency, counters, or ordering.
- Cover compatibility with existing documents when changing fields or persistence behavior.
- Do not add tests that merely restate constants, trivial accessors, or behavior supplied by the language or framework.

Examples of meaningful blog regression cases include:

| Area | Candidate cases when affected |
| --- | --- |
| Visibility and authorization | Public lists exclude drafts; owners and privileged users retain intended access; unauthorized direct requests are rejected. |
| Publication state | First publication sets its timestamp; later edits preserve it; legacy published documents retain their fallback behavior. |
| Lists and sorting | Supported sort keys select the expected order; pinned posts retain their intended precedence; pagination respects filters. |
| Views and status | Anonymous access follows the existing policy; repeat views by the same user follow the intended counting rules. |
| Writes and failures | Invalid input does not mutate data; failed operations are not reported as successful. |
| UI integration | Links, templates, and translated labels match the server-side route and response contract. |

These are coverage candidates, not a claim that the current repository already tests them.

Use the [behavior reference](blog-behavior.md) to distinguish source-derived behavior from unresolved policy or concurrency guarantees. Use the [prioritized coverage plan](plans/self-validation.md#initial-coverage-priorities) when selecting the first automated cases.

## Test Design

- Prefer small deterministic tests for isolated logic and integration tests for contracts that depend on Hydro, persistence, or rendering.
- Mock external boundaries only where appropriate. Do not mock away the permission checks or behavior under test.
- Use controlled clocks, identifiers, and fixtures when timing or ordering matters.
- Keep tests isolated. Clean up owned data and resources, including after failures.
- Never use production databases, real credentials, or personal data in fixtures. Integration checks must use explicitly configured disposable environments.
- Follow the [verification-environment requirements](verification-environment.md): isolate Hydro and databases in containers; run Playwright locally with independent test sessions. Browser containerization is optional, not required.
- Do not require external network access for tests that can run locally.
- Use clear assertions and useful failure messages. Do not rely on arbitrary sleeps to make asynchronous tests pass.

## When Infrastructure Is Missing

Do not silently skip behavioral verification or expand an ordinary feature PR into a test-platform project.

1. Identify the acceptance criteria and the missing capability.
2. Run existing checks and use the [Hydro smoke-testing guide](hydro-smoke-testing.md) for a reproducible manual scenario in a suitable instance when available.
3. Record setup, relevant user roles and initial state, actions, expected results, and observed results.
4. If the scenario cannot be exercised, state the blocker and remaining uncertainty explicitly.
5. Capture recurring infrastructure gaps in the relevant [project plan](plans/README.md), keeping proposed coverage separate from implemented tests.

Once tooling is added, update this guide and the [validation commands](validation.md) in the same PR. Existing documented gaps are not a permanent exemption from regression coverage.
