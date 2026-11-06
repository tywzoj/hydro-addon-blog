# Testing Requirements

## Current Capability and Scope

The repository provides Vitest UT, V8 coverage, Playwright E2E, a disposable local runtime, and linting. The [self-validation plan](plans/self-validation.md) tracks remaining type-check tooling, coverage extensions, and PR-head CI evidence.

The PR workflow runs lint, UT with coverage, and E2E. Real Hydro/browser cases are separate from isolated UT and do not establish exhaustive coverage or a complete deployment matrix.

## Running and Extending UT

After the standard dependency installation, run from the repository root:

```sh
yarn test
yarn test:coverage
# Optional interactive development:
yarn test:watch
# Focus a regression without changing discovery rules:
yarn test tests/unit/model.test.ts
```

`yarn test` and `yarn test:coverage` are non-watch commands. Coverage reports are generated under ignored `coverage/`, including HTML and a JSON summary. Coverage currently targets `features/model.ts`, `features/handler.ts`, and `features/handler.base.ts`; it is not a whole-project or E2E coverage claim. No percentage threshold is imposed as a substitute for meaningful assertions.

Vitest discovers `tests/unit/**/*.test.ts`, rejects empty discovery or empty suites, disallows focused `.only` tests, and applies five-second test/hook timeouts. CI additionally limits the UT step to five minutes. Ordinary tests are offline and need neither Docker nor a browser. Use the same non-watch command locally and in CI.

The test boundary is intentionally explicit:

- Vitest transforms actual addon TypeScript with legacy decorators enabled. The source imports remain mockable ES modules in the runner; application files are not rewritten to use `require`.
- `tests/setup.ts` replaces the top-level `hydrooj` application API with the small fixture in `tests/helpers/hydro.ts`, avoiding full application startup.
- The fixture loads installed real Hydro `param`, `Types`, and privilege constants through the official `@hydrooj/register` loader. Invalid-input tests invoke decorated methods with the framework-style raw object, including `domainId`; positional calls can bypass those validators.
- Persistence, user lookup, pagination, rate limiting, routing capture, and audit services are test boundaries. Fixture users, ownership/privilege enforcement, and lookup errors are not the real Hydro authorization lifecycle.
- Each test resets mocks; clocks return to real time after every test, the temporary Hydro global is restored after each file, and Vitest isolates files. Do not opt shared-state tests into concurrent execution.

Model cases cover publication transitions, legacy reads, reply/counter updates, deletion/status cleanup, per-user star-only updates, index scoping, and propagated persistence failures. Handler cases cover route ordering/gates, target-user/post preparation, list filters/sorts/pagination, permission delegation, input rejection, write/rate-limit/audit behavior, sequential views, star conversion, and success/failure responses.

Assertions about query construction are not MongoDB ordering tests. Fixture denial is not proof of real Hydro access control. A star-only update assertion does not establish database merge semantics. Sequential views do not establish concurrent exactly-once behavior. Preserve these distinctions when adding tests and use E2E for the actual runtime contracts.

The initial implementation verified nonzero exits for unmatched discovery, a discovered file containing no tests, and a temporary transform that reversed the creation publication branch. Both publication regressions failed under that mutation. Temporary probes were removed; application source was not modified.

Use the official [Vitest module-mocking guide](https://vitest.dev/guide/mocking/modules) and [Vitest 4 coverage reference](https://v4.vitest.dev/config/coverage) when extending the harness; keep package versions and dependency transformation behavior compatible with the installed runner.

## Running and Extending E2E

```sh
yarn test:e2e
yarn test:e2e --grep "publication"
```

The [verification-environment guide](verification-environment.md#local-runtime-boundary) documents Node/Docker/browser prerequisites, local development, writable paths, timeouts, evidence, and cleanup. The launcher owns a local Hydro child and only containerizes MongoDB. It never accepts a production or shared database.

Playwright runs three real-form authentication setup cases and six business tests with independent author, viewer, and system-editor sessions:

| Scenario | Evidence | Related smoke cases |
| --- | --- | --- |
| Draft, publication, and edit | Owner sees its draft, ordinary viewer does not; publication becomes visible; edited content persists and preserves first-publication time. | M2, M3 |
| Non-owner denial | Actual create/edit GET and create/edit/delete POST requests are rejected without the attempted mutation. | M6 |
| System editor | Actual system privilege permits seeing and editing another author's draft; home still excludes it. | M3, M6 |
| Sequential views and stars | First viewer read increments once; reload does not; star/unstar persists after reload without changing the author's state. | M7 |
| Delete | UI deletion removes the post and all of its persisted user statuses. | M8 |
| Profile frontend | The addon frontend adds a working blog link on the actual Hydro profile page. | M1 |

Use the real Markdown editor and controls; do not inject session cookies, bypass decorators, stub routes, or mock persistence to make E2E green. Direct authenticated denial requests preserve the same-origin Referer expected by Hydro's CSRF handling. MongoDB access is read-only assertion evidence against the run-owned database; fixture accounts are created through Hydro's user model.

The suite uses one worker, no automatic retries, isolated browser contexts, focused-test rejection, and explicit timeouts. Empty selections and real assertion failures return nonzero exits. Keep fixtures unique within the run and promote new relevant failures into the suite. Initial cases do not establish all sorting/pagination outcomes, localization, concurrent deduplication, or unresolved draft direct-link privacy.

## Required Coverage Layers

The project must develop and maintain both unit-test (UT) and end-to-end (E2E) coverage. Coverage means meaningful assertions for behavior and failure paths, not a mandated percentage or testing every function.

| Layer | Responsibility | Initial examples |
| --- | --- | --- |
| UT | Execute actual addon logic deterministically, replacing only external boundaries. Small handler-contract tests may share this runner but must identify their simulated services. | Publication timestamps, legacy-read fallback, query construction, and invalid input before side effects. |
| E2E | Exercise the loaded addon through a real browser, real Hydro routing, sessions, permissions, templates, and disposable persistence. Do not replace these with mocks. | Author creates and publishes a post; another viewer sees only published list entries; a non-owner write is denied without mutation; edits and deletion persist after reload. |

For behavior changes, select the affected cases in both layers; explain when a layer is not applicable. A UT assertion that a handler calls a privilege service is not proof that Hydro enforces access end to end. Template or browser-flow changes need E2E evidence even when no isolated UT is useful.

Use Playwright Test for repeatable browser E2E and the [declared Playwright MCP](verification-environment.md#project-playwright-mcp) for agent-assisted exploration, reproduction, and browser verification. MCP sessions supplement, not replace, checked-in E2E tests and their CI results. Promote discovered regressions into executable UT or E2E cases at the appropriate boundary.

Both runners must reject empty discovery and relevant failures with nonzero exits, have bounded execution, and clean up run-owned resources. Record separately which UT, E2E, and MCP checks actually ran. Report cases outside delivered coverage using the fallback below.

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

These are coverage expectations; use the UT/E2E inventories above and actual test files to distinguish delivered cases from remaining gaps.

Use the [behavior reference](blog-behavior.md) to distinguish source-derived behavior from unresolved policy or concurrency guarantees. Use the [prioritized coverage plan](plans/self-validation.md#initial-coverage-priorities) when selecting the first automated cases.

## Test Design

- Prefer small deterministic tests for isolated logic and integration tests for contracts that depend on Hydro, persistence, or rendering.
- Mock external boundaries only where appropriate. Do not mock away the permission checks or behavior under test.
- Use controlled clocks, identifiers, and fixtures when timing or ordering matters.
- Keep tests isolated. Clean up owned data and resources, including after failures.
- Never use production databases, real credentials, or personal data in fixtures. Integration checks must use explicitly configured disposable environments.
- Follow the [verification-environment requirements](verification-environment.md): local Hydro and Playwright with isolated writable paths and sessions, and a disposable MongoDB container.
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
