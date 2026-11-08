# Self-Validation Capabilities

## Status

In progress: initial Vitest UT, a local development runtime, and real-browser E2E are delivered and verified locally and in [PR #8](https://github.com/tywzoj/hydro-addon-blog/pull/8). Project-scoped type checking and the additional UT branch coverage recorded below are delivered and verified locally; current-head CI and cross-platform checks remain to be verified on future PR heads.

The [investigation record](self-validation-investigation.md) retains experiments and limitations. The repository provides local Playwright MCP, project-scoped TypeScript checking, Vitest UT, managed local Hydro with disposable MongoDB, and Playwright E2E. The workflow includes lint, type checking, UT coverage, and E2E; recheck the actual PR head after every push rather than reusing earlier evidence.

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
| Establish checks (UT/type checking delivered) | Add Vitest scripts, V8 coverage, and an explicitly scoped type check without weakening lint. | UT/coverage and `yarn typecheck` pass locally; empty UT discovery/suites, a publication mutation, and temporary backend/frontend/test type errors exit nonzero. |
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
- The project-scoped type check is delivered. A clean full upstream-source build
  remains outside this addon's check; address dependency compatibility separately
  if that broader guarantee becomes a requirement.
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

### Bounded E2E Retries

On 2026-11-08, the maintainer requested two retries for each failed task point.
Playwright now permits two retries per failed test in local and CI E2E, not
whole-job retries. Passing tests are not rerun, recovered tests remain visible
as flaky, and exhausted failures still fail validation. Test/action/navigation
and global deadlines remain unchanged. Retry attempts use a fresh worker/browser
but retain the run-owned database; native fixture cleanup remains required.
Temporary probes against the managed runtime verified one attempt for a passing
test, exactly three attempts and flaky reporting for recovery on retry 2, and
exactly three attempts plus a nonzero exit for an exhausted failure. JSON report
assertions checked retry indices `[0, 1, 2]`; the probes were removed afterward.
Lint, project type checking, and twelve focused real-Hydro E2E cases passed with
the new policy, including pagination and pending withdrawal.
Current-head CI validation remains pending.

The first retry-enabled CI run exercised both retry attempts but exposed an
unscoped review-notification count: retained messages from earlier attempts
made later attempts fail. The assertion now filters by the current article ID
as well as recipient and content. Repeating the complete pre-publication review
case twice against one disposable database passed both attempts, plus six login
setups; lint and type checking also passed. Unrelated review navigation failures
still require current-head CI evidence.

### Project-Scoped Type Checking

On 2026-11-07, `yarn typecheck` was added using the installed TypeScript 5.9.3
Compiler API. Hydro 5.0.7 and default UI 4.58.5 expose TypeScript source entries,
so raw `tsc` also diagnoses upstream implementations. The supported command
resolves real dependency types, checks all project-owned files plus compiler
configuration/options/global diagnostics, and explicitly does not request
dependency implementation diagnostics. Its scope is documented in
[validation](../validation.md#type-checking), not represented as a clean full
Hydro build.

`tsconfig.json` now prevents emission and excludes generated reports. No strict
compiler option was weakened, no package or type stub was added, and no dependency
source was modified. Local fixes preserve runtime behavior: explicit role-name
comparisons, numeric MongoDB collection ID types in tests, typed heterogeneous
request/mask fixtures, and the zero-argument mocked Handler constructor boundary.

Local evidence: 32 project files passed `yarn typecheck`; `yarn lint` and all
162 UT passed. Temporary errors involving Hydro `ObjectId`, UI `NamedPage`, and
a test Boolean each produced diagnostics and exit 1 without emitted JS; the
probe files were removed. The affected role/comment E2E selection passed six
cases including authentication under the changed compiler configuration:
`yarn test:e2e --grep 'global settings role assignment|delegated managers|comments matrix'`.
Run artifacts are under `test-results/hydro-blog-39322-fe82b4e3/`.

The workflow runs the same command after lint with a five-minute timeout.
Remote CI results for this step are tracked on the implementation PR and must
identify the verified head commit; the local results above do not establish them.
Broader E2E scenarios and cross-platform/version-matrix verification remain
follow-up work; no full-runtime compatibility claim is made.

### UT Branch-Coverage Extension

On 2026-11-07, coverage was measured on baseline `284b911` and extended without
changing production code, dependencies, Vitest discovery, coverage inclusions,
or exclusions. Acceptance criteria were meaningful assertions for uncovered
behavior and failure paths, improved coverage in the same scope, and passing
coverage, lint and project-scoped type checks.

| Metric | Baseline | Extended suite |
| --- | --- | --- |
| Passing UT | 249 | 328 |
| Branches | 86.14% | 99.84% |
| Statements | 85.36% | 99.18% |
| Lines | 86.69% | 99.05% |
| Functions | 82.71% | 99.06% |

The 79 additional cases cover:

- Review queue/detail pagination, private report hydration, independent authority,
  accepted/duplicate/hidden reports, legacy reset counters, rejection notices,
  receipt-integrity failures, counter overflow and bounded approval recovery.
- Comment hydration with nested and legacy replies, user-specific likes, deletion
  capabilities and notices, successful replies, parent disappearance, no-op like
  compensation, scoped indexes and stale article-deletion protection.
- Settings initialization and compatibility, request-local policy caching,
  concurrent configuration writes, role deletion/assignment and audit payloads,
  management-page rendering and system-domain sudo arguments.
- Secondary-instance reminder registration, empty recovery, persisted cadence
  changes, empty/nonreviewer recipient batches and ownership-safe early exits.
- Draft-only lists, privacy projections, no-op and unchecked form submissions,
  independent publication/withdrawal, unreadable-result redirects, report
  eligibility and legacy author review controls.

The only harness change replaces the instance-field URL mock with a spied
prototype method. The former shadowed `BlogSettingsHandler.url`; the new fixture
executes the real override and its `super.url` call while keeping URL generation
an explicit service boundary. The installed framework's `HandlerCommon.url` in
`node_modules/@hydrooj/framework/server.ts` is also a prototype method. Decorated
requests continue using real installed Hydro conversion and simulated lifecycle
ordering, not a second server implementation.

Local checks use Node.js `24.22.1`, Yarn `1.22.22`, Vitest/coverage-v8 `4.0.18`:

```sh
yarn lint
yarn typecheck
yarn test:coverage
```

Lint and the 41-file scoped type check pass. All 328 UT pass. Two temporary
production mutations (reversing the conditional-delete guard and omitting the
receipt-comment integrity comparison) caused the corresponding new tests to
fail with exit 1. Both mutations were removed before the final checks.

The unrounded branch result is 663/664. The remaining `if` at
`features/handler.ts:148` has V8 hit counts `[6, -4]` in the full report. A focused
run of the existing sequential-view and anonymous-view tests also passes all
three cases but reports `[1, -1]` for the same branch:

```sh
yarn test tests/unit/handler.test.ts --coverage \
  --testNamePattern 'counts the first eligible view|does not track a view' \
  --coverage.reporter=json --coverage.reportsDirectory=coverage/view-branch-probe
```

These assertions explicitly check one write across repeated authenticated reads
and no writes for anonymous identities. The negative counter is a coverage
measurement limitation in this environment; it was not hidden with exclusions,
new provider settings, dependency upgrades or repetitive tests. Remaining
unexecuted lines include the simple article count wrapper, review index
initialization and notification dependency-injection registration. This is not
a claim of exhaustive application or concurrency verification.

E2E and MCP were not rerun for this test-only extension: no production handler,
model, template or browser behavior changed. Existing real-Hydro coverage remains
separate evidence. No current-head CI run or compatibility matrix is claimed.

### Data Authorization Regression Extension

The next extension starts from `da0798a` and focuses on addon data safety:
unauthorized create/read/update/delete, independent permissions, target binding,
private responses and denial before business side effects. It does not restore
the abandoned general-security suite or introduce framework attack probes.

Acceptance criteria are source-derived denials with meaningful positive
controls, protected-state comparisons after rejected requests, per-request
authorization after role revocation, and preservation of existing allowed
operations. Any demonstrated business defect requires maintainer confirmation
before a production fix.

The changes add 28 UT cases, extend existing request-policy and review identity
assertions, add two real-session revocation E2E cases, and strengthen four existing
E2E scenarios. The shared `blogState` helper captures articles/comments,
statuses, receipts and scoped business messages/audits through read-only database
queries. Unrelated sentinel articles help detect accidental query widening.
The [testing inventory](../testing.md#data-authorization-regression-inventory)
maps each boundary to its regression.

Important boundaries preserved:

- Authentication is still required even if a guest mask includes write grants.
- Own and others grants remain separate, and metadata operations do not acquire
  an unrelated content-edit requirement.
- New requests reload policy; neither an old browser session nor valid sudo
  restores a revoked grant.
- Unreadable drafts deny comment writes/deletion, but authorized moderation of
  a readable draft remains allowed.
- A completed hidden-report receipt can be acknowledged by its reporter without
  exposing hidden content or repeating counts, messages and audits. Pending
  receipt recovery is a different contract and is not required to be write-free.
- Safely ignored extra fields are not treated as an error requirement. Trusted
  identity, ownership and review state remain server-controlled.

Source review did not establish a confirmed business authorization bypass.
It did identify an unresolved privacy-contract question: article `ip` is
persisted by `features/model.ts:35-40`, updated from the current editor request
by `features/handler.ts:290`, and is not removed by
`features/review.model.ts:39-56`. Additional source inspection established that
the installed framework's `base.ts:95` JSON path and `serializer.ts:3` do not
strip `ip`. The default source path therefore retains it for article JSON
readers; this is source evidence, not a separate runtime observation. Unlike
comment-IP exclusion, its intended audience was not explicitly defined at that
point. The maintainer was unavailable for the initial confirmation, so the
test-only extension made no production fix. The later confirmed decision and
implementation are recorded under [Article IP Response Fix](#article-ip-response-fix).

The read-only security review covered production paths at `da0798a`, not just the
test diff (line references below precede the IP response fix):

| Boundary | Source basis |
| --- | --- |
| Admission and URL-author binding | `features/handler.base.ts:14`, `features/handler.base.ts:46` |
| Strict ownership grants and independent mutation checks | `features/permission.ts:91`, `features/handler.ts:274` |
| Article-scoped comment and nested reply lookup | `features/comments.model.ts:23`, `features/comments.model.ts:33` |
| Reviewer authority, authenticated reporter identity and conditional writes | `features/review.handler.ts:59`, `features/review.handler.ts:145`, `features/review.model.ts:126` |
| Management permission, request-local policy and stale settings | `features/settings.handler.ts:62`, `features/settings.model.ts:174`, `features/settings.model.ts:183` |

Local validation uses Node.js `24.22.1`, Hydro `5.0.7`, framework `0.3.2` and UI
`4.58.5`. `yarn lint`, `yarn typecheck` (41 files) and `yarn test:coverage` pass:
356 UT, with the same 99.84% scoped branch coverage. The increase is in
authorization/data assertions, not a coverage-percentage claim.

The focused command below passed five business cases and six real login cases
in the owned runtime. Artifacts: `test-results/hydro-blog-47669-d5a38d4a/`.

```sh
yarn test:e2e --grep 'a non-owner cannot|revoked delegates|comments validate target chains|review reports deduplicate|global settings role assignment'
```

Before the final review/reset revocation case and batch role-deletion denial
were added, `yarn test:e2e` passed all 43 cases (six authentication setups and
37 business scenarios).
Artifacts: `test-results/hydro-blog-49168-5a68b992/`. Both the focused and full
runs exited successfully; their named MongoDB containers, temporary Hydro
storage and saved authentication directories were confirmed removed. A final
`yarn lint`, `yarn typecheck` and `yarn test:coverage` also passed on the current
tree with 356 UT. The final additions passed lint, type checking and the following
focused run (two business cases and six real login cases), with artifacts under
`test-results/hydro-blog-56629-53ccfa15/`:

```sh
yarn test:e2e --grep 'global settings role assignment|review and reset revocation'
```

The final `yarn test:e2e` run passed all 44 cases (six authentication setups and
38 business scenarios), including review/reset revocation and batch role-deletion
denial. Artifacts: `test-results/hydro-blog-57423-b6fe5eac/`. The focused and final
runs' named MongoDB containers, temporary Hydro storage and saved authentication
directories were confirmed removed. Production sources and runtime/coverage
configuration remain unchanged.

No separate MCP browser session was needed for these request/data assertions;
the real-browser suite is the runtime evidence. No deployment security
certification, additional browser/platform matrix, or current-head remote CI
result is implied.

### Article IP Response Fix

On 2026-11-07, the maintainer confirmed that IP addresses must not be returned
and authorized the production fix. The acceptance criteria are: no article or
legacy embedded reply IP in ordinary or review response objects, no privilege
exception, unchanged stored IPs/audit snapshots, preserved review tokens and
unchanged authorization.

The shared response-only `articleForResponse` projection is applied at all six
article response paths: home/user lists, detail/editor, review queue/detail.
It clones articles and legacy replies rather than mutating prepared documents.
The existing review-metadata projection remains separate because edit/delete
audit snapshots also use it. Database reads/writes, authorization, dependency
versions and native audit calls are unchanged.

Upstream research rechecked official Hydro commit
`3bae56fe8edddff12346bcb1c8281269c94688d8`:
`framework/framework/serializer.ts` does not exclude IP fields, and
`packages/hydrooj/src/model/oplog.ts` persists supplied audit data along with
the operator's `operateIp`. The installed framework `0.3.2` and Hydro `5.0.7`
match these relevant behaviors. The addon therefore filters response copies
explicitly rather than relying on framework serialization or modifying audit
data. The general official documentation was consulted; these source paths
define the specific serialization/audit contract.

Before the fix, eleven new UT cases failed on returned IPs. Two new real-Hydro
JSON cases also failed with returned loopback addresses, confirming the prior
source-derived propagation at runtime. Expected-failure artifacts:
`test-results/article-ip-ut-before.log` and
`test-results/hydro-blog-63710-33d1102a/`.

Post-fix validation:

```sh
yarn lint
yarn typecheck
yarn test:coverage
yarn test:e2e --grep 'JSON responses omit IPs|guest policy and domain independence'
```

Lint, the 41-file scoped type check and all 367 UT pass; scoped branch coverage
remains 99.84%. The focused E2E run passes nine cases (six real logins and three
business cases), including author/viewer/root, reviewer and guest JSON checks,
restricted-domain routes, retained database/audit IPs and successful review
approval. Artifacts: `test-results/hydro-blog-64446-97637f89/`.
Both the expected-failure and passing runs removed their owned MongoDB containers,
temporary Hydro storage and authentication files; cleanup was checked explicitly.

The preceding full 44-case browser run belongs to the test-only extension;
the now-46-case full suite was not rerun for this response-only fix. The focused
cases cover every changed response path, and the full UT suite covers existing
policy and write behavior. No separate MCP session or remote CI run is claimed.
The legacy inline-reply regression uses UT fixtures rather than E2E database
writes. No production data was modified.
