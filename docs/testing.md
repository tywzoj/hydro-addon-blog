# Testing Requirements

## Current Capability and Scope

The repository provides project-scoped TypeScript checking, Vitest UT, V8 coverage,
Playwright E2E, a disposable local runtime, and linting. The
[self-validation plan](plans/self-validation.md) tracks delivery evidence, coverage
extensions, and PR-head CI verification.

The PR workflow runs lint, `yarn typecheck`, UT with coverage, and E2E.
The [type-check boundary](validation.md#type-checking) includes project tests but
not upstream implementation diagnostics. Real Hydro/browser cases are separate
from isolated UT and do not establish exhaustive coverage or a complete deployment matrix.

## Running and Extending UT

After the standard dependency installation, run from the repository root:

```sh
yarn test
yarn test:coverage
# Optional interactive development:
yarn test:watch
# Focus a regression without changing discovery rules:
yarn test tests/unit/article.model.test.ts
```

`yarn test` and `yarn test:coverage` are non-watch commands. Coverage reports are generated under ignored `coverage/`, including HTML and a JSON summary. Coverage targets article, comment, review and settings models/handlers, review notifications, shared recipient-localized message delivery, shared handler preparation, and the permission policy; it is not a whole-project or E2E coverage claim. No percentage threshold is imposed as a substitute for meaningful assertions.

Vitest discovers `tests/unit/**/*.test.ts`, rejects empty discovery or empty suites, disallows focused `.only` tests, and applies five-second test/hook timeouts. CI additionally limits the UT step to five minutes. Ordinary tests are offline and need neither Docker nor a browser. Use the same non-watch command locally and in CI.

`bootstrap.test.ts` exercises the real composition root and registration
functions with isolated storage initializers. It checks awaited initialization,
static-before-parameterized route order, stable route/handler names, UI/worker
registration order and fail-fast startup. It does not initialize a real database
or execute the injected worker; E2E covers those runtime boundaries.

Coverage follows the feature directories, including extracted
`article.projection.ts` and `review.policy.ts`. Moving a function is not a reason
to remove its existing assertions or exclude it from coverage. The
[structure-refactor record](plans/structure-refactor.md) compares the same
behavioral scope before and after the move.

`i18n.test.ts` checks complete per-language catalogs, the intentional English
source-text fallback, interpolation/link placeholders, route-title aliases and
independent catalog objects across addon applications. Type checking additionally
rejects missing and unknown translated keys. Locale data is not a custom
translation engine: real-Hydro E2E checks the actual dialogs, stale-client-catalog
fallback and recipient-language notifications.

The test boundary is intentionally explicit:

- Vitest transforms actual addon TypeScript with legacy decorators enabled. The source imports remain mockable ES modules in the runner; application files are not rewritten to use `require`.
- `tests/setup.ts` replaces the top-level `hydrooj` application API with the small fixture in `tests/helpers/hydro.ts`, avoiding full application startup.
- The fixture loads installed real Hydro `param`, `Types`, and privilege constants through the official `@hydrooj/register` loader. Invalid-input tests invoke decorated methods with the framework-style raw object, including `domainId`; positional calls can bypass those validators.
- Persistence, user lookup, pagination, rate limiting, routing capture, and audit services are test boundaries. Fixture users, ownership/privilege enforcement, and lookup errors are not the real Hydro authorization lifecycle.
- Each test resets mocks; clocks return to real time after every test, the temporary Hydro global is restored after each file, and Vitest isolates files. Do not opt shared-state tests into concurrent execution.
- The fixture's `url` is a prototype method with a per-instance spy, so subclass
  overrides and `super.url(...)` remain executable. Its route-name result is not
  real Hydro URL generation; URL-policy tests assert the arguments sent to the
  base method, including the system-domain sudo override.
- Authorization-boundary tests use `dispatchHandler` after fixture hydration to
  run preparation, generic POST and the operation in native order. Hook-count
  assertions reject accidental invocation from actions. This helper does not
  replace real routing/events/control-flow or native E2E; see the
  [lifecycle guide](handler-lifecycle.md#testing-boundary).

Model cases cover publication transitions, legacy reads, reply/counter updates, deletion/status cleanup, per-user star-only updates, index scoping, and propagated persistence failures. Handler cases cover route ordering/gates, target-user/post preparation, list filters/sorts/pagination, permission delegation, input rejection, write/rate-limit/audit behavior, sequential views, star conversion, and success/failure responses.

Permission/settings cases execute the actual policy: effective roles, forced/manual
root, strict own/others selection, guest identity boundaries, empty masks,
role creation/deletion/recreation, stale configuration saves, matrix validation,
filtered assignment queries and the single management gate. Sudo is simulated in
UT only to capture the handler boundary; E2E performs actual Hydro reauthentication.
Article regressions cover draft direct-link denial, public-edit publication rights,
omitted versus unchecked fields, independent metadata operations, and stale writes.

Assertions about query construction are not MongoDB ordering tests. Fixture denial is not proof of real Hydro access control. A star-only update assertion does not establish database merge semantics. Sequential views do not establish concurrent exactly-once behavior. Preserve these distinctions when adding tests and use E2E for the actual runtime contracts.

The [2026-11-07 branch-coverage extension](plans/self-validation.md#ut-branch-coverage-extension)
records 328 passing UT and 99.84% branches in the unchanged coverage scope.
It adds queue/report response and denial cases, receipt-integrity and overflow
failures, comment hydration and moderation, settings rendering and writes,
request-local policy caching, reminder scheduling/recipient boundaries, and
article publication/control regressions. Temporary deletion and receipt-integrity
mutations were both detected by the new tests.

The remaining reported branch is the view-count skip path in
`features/articles/article.handler.ts`. Existing assertions verify both a previously viewed article
and anonymous reads without additional count/status writes, but the installed
V8 reporter gives this path a negative hit count, including in a focused run.
Treat this as a measurement limitation in the recorded environment, not evidence
that those assertions are missing or a reason to suppress coverage. Do not add
duplicate cases, change the coverage scope, or round the result to 100%.

The initial implementation verified nonzero exits for unmatched discovery, a discovered file containing no tests, and a temporary transform that reversed the creation publication branch. Both publication regressions failed under that mutation. Temporary probes were removed; application source was not modified.

Use the official [Vitest module-mocking guide](https://vitest.dev/guide/mocking/modules) and [Vitest 4 coverage reference](https://v4.vitest.dev/config/coverage) when extending the harness; keep package versions and dependency transformation behavior compatible with the installed runner.

## Running and Extending E2E

```sh
yarn test:e2e
yarn test:e2e --grep "publication"
```

The [verification-environment guide](verification-environment.md#local-runtime-boundary) documents Node/Docker/browser prerequisites, local development, writable paths, timeouts, evidence, and cleanup. The launcher owns a local Hydro child and only containerizes MongoDB. It never accepts a production or shared database.

Playwright runs six real-form authentication setup cases and forty-one business
tests with independent author, viewer, system-editor, and reporter sessions.
The original six scenarios are:

| Scenario | Evidence | Related smoke cases |
| --- | --- | --- |
| Draft, publication, and edit | Owner sees its draft, ordinary viewer does not; publication becomes visible; edited content persists and preserves first-publication time. | M2, M3 |
| Non-owner denial | Actual create/edit GET and create/edit/delete POST requests are rejected without the attempted mutation. | M6 |
| System editor | Actual system privilege permits seeing and editing another author's draft; home still excludes it. | M3, M6 |
| Sequential views and stars | First viewer read increments once; reload does not; star/unstar persists after reload without changing the author's state. | M7 |
| Delete | UI deletion removes the post and all of its persisted user statuses. | M8 |
| Profile frontend | The addon frontend adds a working blog link on the actual Hydro profile page. | M1 |

An additional article scenario verifies native confirmation cancellation, zero
mutation requests before acceptance, exactly one accepted hotkey submission,
retained editor content, and editor-based withdrawal. Existing deletion,
publication, review-decision and reset cases also exercise the dialogs, including
immediate retries after cancellation and retention of rejection comments/tokens.
Focused UT covers which actions/publication transitions require confirmation.
The keyboard case exercises both Control+Enter and Meta+Enter without relaxing
the exact content-preservation assertion. The article form intercepts submission
in the capture phase before the editor can handle its platform-specific
Mod-Enter newline shortcut, then uses the normal submit button and confirmation.
Three locale cases select Simplified Chinese, Traditional Chinese and Korean
through native preferences, then remove the confirmation keys from the browser's
catalog to simulate an older cached language file. Actual publication/deletion
dialogs must still use the selected language and cancellation must preserve the
draft. This is client-catalog fault injection, not a browser cache-expiry test;
authentication, preference changes, requests and persistence remain real.
The disabled-review scenario verifies warning cancellation, automatic approval
of publication/report queues, retained nonpending rejection holds, normal
notifications/audit, report-version immunity, hidden navigation/report controls
and accurate publication wording. Unit cases cover configuration acknowledgement,
revision conflicts, competing decisions, bounded retries and partial failures.

Use the real Markdown editor and controls; do not inject session cookies, bypass decorators, stub routes, or mock persistence to make E2E green. Direct authenticated denial requests preserve the same-origin Referer expected by Hydro's CSRF handling. MongoDB access is read-only assertion evidence against the run-owned database; fixture accounts are created through Hydro's user model.

`permissions.spec.ts` provides eleven scenarios covering real sudo and delegated role
management, stale matrix saves, default/guest list exclusion, forced root,
private drafts and rejected public edits, strict own/others permissions, role
deletion/recreation, anonymous access, domain independence, independent
publication/pinning/deletion, visible unchecked controls, native role controls,
global user lookup, fresh sudo and same-session permission revocation. Its cleanup restores
fixture assignments and guest permissions through authenticated management
requests, including after failures; it does not write test outcomes into MongoDB.

Self-only creation coverage rejects root GET/POST requests for another author,
including through a restricted domain, verifies no create entry or persisted
article, and confirms root can still create its own articles. Policy UT also
covers missing creation/access grants and anonymous identities. The settings
matrix exposes 23 permissions: the original 17 article/settings grants, four
comment grants, and independent review/reset grants.

Native-UX regressions cover dialog cancellation, initial focus, single/multi-user
selection, inline updates, empty selection feedback, bulk changes, protected
root rows, and resetting assignments to default without a remove-user action.
All assignment controls exclude guest, and single/bulk requests attempting to
assign guest are rejected without persistence. Policy UT covers legacy guest
assignments falling back to default for authenticated users. A fresh-session case
verifies that restricted-domain settings route sudo through the global identity
entry and return to the original page. Article submission waits for DOM readiness
and then checks application state rather than waiting for external avatars.

Review regressions send actual JSON `false` and `0` for creation and updates,
checking publication, unpinning and omission behavior. A delegated manager
without restricted-domain view permission searches and selects a user through
the system API, while navigation stays domain-prefixed. The same scenario checks
that an explicitly assigned, forced-root user appears once and that a later empty
page remains empty. UT checks candidate filtering before joins, union
deduplication before pagination, and page-only profile hydration.

The suite uses one worker, no automatic retries, isolated browser contexts, focused-test rejection, and explicit timeouts. Empty selections and real assertion failures return nonzero exits. Keep fixtures unique within the run and promote new relevant failures into the suite. It does not establish every sorting/pagination outcome, all locales, or concurrent view deduplication. MCP checks supplement automated coverage for localized and narrow-screen settings UI.

Navigation waits for DOM readiness and then asserts actual page controls/content.
It does not wait for third-party avatars or unrelated resources to finish before
testing application behavior. This avoids observed `load` stalls without mocking
requests or relaxing permission/persistence assertions.

## Data Authorization Regression Inventory

The data-safety extension builds on the existing suites rather than introducing
a separate attack runner. It adds 28 UT cases and two real-session revocation
scenarios, and strengthens four existing E2E cases with protected-state checks.

| Boundary | Regression evidence |
| --- | --- |
| Authenticated mutation | Guest identities cannot create, edit, publish, pin, delete or star even when their blog mask contains every grant. |
| Independent own/others grants | Dedicated publication/pinning and equivalent form submissions enforce the own grant; an others grant cannot restore it. A permitted control still works without unrelated content-edit permission. |
| Trusted identities and protected fields | Article creation/editing and report/reset actions do not accept forged ownership, reporter IDs, review holds or counter resets as authoritative data. |
| Request-local policy | Reusing an identity in a new handler reloads policy. Real delegated users reuse the same browser session immediately after revocation, without a refresh, and cannot use captured article, review-decision or counter-reset requests. Restoring grants restores authorized operations. |
| Management authority | A still-valid sudo session does not restore revoked management permission, including inherited operations and batch role deletion on settings routes. Settings, assignments and successful business audits remain unchanged. |
| Object and draft boundaries | Foreign article/comment/reply IDs and unreadable draft mutations cannot alter target records, notices or audit history. Authorized draft moderation remains supported. |
| Private responses | Comment/reply IP fields stay excluded. Materialized hidden-report duplicates acknowledge only the reporter's receipt without exposing content or repeating effects; another reporter is denied. |

`blogState` in `tests/e2e/fixtures.ts` reads the run-owned database without
mutating it. It snapshots scoped article/comment records, statuses, report
receipts, article-linked messages and business audits. Tests include unrelated
sentinel articles and compare after each denial. This is not a whole-database
snapshot: normal session bookkeeping and authorized reads are legitimate effects.
Do not perform a successful detail read between snapshots that are intended to
prove no unauthorized mutation.

The focused runtime selection is:

```sh
yarn test:e2e --grep 'a non-owner cannot|revoked delegates|comments validate target chains|review reports deduplicate|global settings role assignment|review and reset revocation'
```

These are blog data-authorization regressions, not CSRF, XSS, dependency or
general framework attack tests. The original extension did not change production
behavior. The subsequently confirmed article-IP privacy fix is covered below. See the
[delivery record](plans/self-validation.md#data-authorization-regression-extension)
for actual checks and limitations.

### Article IP Response Regressions

The maintainer confirmed that article IP addresses must not be returned.
Eleven UT cases exercise home/user lists, detail/editor responses and both
review pages, including privileged readers, legacy embedded reply IPs and
articles without replies. Assertions retain source IPs and review tokens;
existing edit/delete cases also verify that server audit snapshots retain IPs.

Two real-Hydro JSON cases exercise public, author, root and reviewer responses
through ordinary and restricted-domain routes. Read-only database assertions
verify that addresses remain stored; an actual pin operation retains native
audit IPs, and review approval still succeeds. The existing guest-policy case
also checks article JSON IP omission. Both new E2E cases and all eleven UT
regressions failed before the production fix.

```sh
yarn test:e2e --grep 'JSON responses omit IPs|guest policy and domain independence'
```

The response boundary is shared by HTML template data and JSON; no IP stripping
is delegated to templates or the framework serializer. Legacy embedded replies
are exercised in UT, not by inserting synthetic legacy records into E2E MongoDB.
The [delivery record](plans/self-validation.md#article-ip-response-fix) distinguishes
the focused post-fix checks from the preceding full browser-suite run.

## Comment Regression Inventory

`tests/unit/comments.test.ts` exercises the four comment grants, native asymmetric
deletion branches, unchanged stored masks, immutable content, validation and
parent binding, two-level desired-state likes, timestamp/count invariants,
parent-loss cleanup, and native notification/audit failure ordering. The existing
model and handler tests also cover article deletion and comment detail integration.

`tests/e2e/comments.spec.ts` adds seven real-Hydro scenarios:

- Native Markdown comments/replies, replying to an existing reply, two-level
  likes/unlikes after reload, native delete cancellation/confirmation, and notices.
- Cross-article/nested target rejection, immutable content, withdrawn-article
  creation/like denial, preserved comments, and allowed draft moderation.
- Real sudo/matrix changes exercising native deletion asymmetry and posting/like
  permission sharing, including browser controls and direct requests.
- Configured top-level pagination through a restricted domain.
- Concurrent same-state likes, repeated deletion, and article-tree/status cleanup.
- Explicitly anonymous contexts reading admitted articles but not mutating them,
  even when guest has comment permission bits.
- Comment/reply/like requests racing with article deletion, checking the resulting
  run-owned database for orphan comments and statuses.

Anonymous JSON denial follows Hydro's login-handoff contract: HTTP 200 with a
login URL, not a successful write. The regression checks that payload and unchanged
database state rather than treating `response.ok()` as evidence of authorization.
Anonymous contexts explicitly clear inherited storage state. Matrix-order
regressions account for prior legitimate configuration rather than assuming an
untouched default/guest ordering.

The isolated runtime sets Hydro's existing `pagination.reply` to 3 to exercise
page boundaries without flooding the creation limiter. Product defaults and rate
limits are unchanged. MongoDB access remains read-only assertion evidence; normal
authenticated requests create all business fixtures.

Run the focused browser cases with `yarn test:e2e --grep comments`.
These checks do not establish atomicity across documents/messages or crash-safe
exactly-once delivery. MCP supplements them for translated and narrow-screen UI.

## Article Review Regression Inventory

`tests/unit/review.test.ts` exercises publication modes, threshold boundaries,
approval-only holds, independent report receipts and pending-slot recovery,
duplicate/stale requests, counter epochs, privacy projections, permissions,
native notice/audit failure boundaries, and parent-deletion compensation.
`tests/unit/review.notifications.test.ts` covers login failure isolation,
default/retired/forced-root recipients across multiple pages, summary ownership,
lease loss before dispatch, configuration changes, and maintenance while
reminders are disabled. Existing model/settings tests cover conditional writes,
timestamp preservation, compatible defaults and review-setting validation.

`tests/e2e/review.spec.ts` provides ten real-Hydro cases:

- Pre-publication privacy, reviewer-only authority, native approval/rejection,
  last-rejection feedback, obsolete decisions, sudo before editing settings,
  sidebar order/current-user links, and the separate review permission family.
- Concurrent duplicate reports, strict report threshold, private report history,
  pending edits, restoration/immunity, renewed reporting through the dialog,
  and reviewer-only counts in author list/detail/editor JSON and HTML.
- Rejection limit, reset-only permission/count privacy, withdrawal and
  disabled-mode holds.
- Confirmed disabling, automatic publication/report approval, notifications,
  audit, unchanged nonpending rejections, and disabled-mode controls/text.
- Delegated and root withdrawal of another author's pending draft, preserving
  private-data projection and independent unpublish permission.
- Concurrent reviewer decisions with one notice/audit, including restricted domains.
- Same-session review/reset revocation with captured valid tokens, denied queue
  and detail reads, unchanged scoped state, and successful operations after
  restoring the grants.
- Review queue/detail JSON IP omission for reviewers and root, with preserved
  decision tokens, stored addresses and successful approval.
- Anonymous report denial and native article/comment/status/report cascade.
- Login and actual periodic worker reminders, default-role recipients, switch
  semantics, and author notifications remaining enabled.

The automated isolated runtime now enables the native worker. Periodic reminder
tests wait for the real schedule and do not mutate database fixtures or expose
test-only production endpoints. The suite does not establish process-kill/restart
recovery, every multi-process scheduler race, or crash-safe exactly-once messages.
Fault-injection UT and normal concurrent E2E are distinct evidence.

Run focused cases with `yarn test:e2e --grep review`. Follow the
[review plan](plans/blog-review.md) for delivery records and remaining limits.

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
