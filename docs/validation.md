# Validation

## Environment and Dependencies

Use Node.js 24 to match `.github/workflows/validation.yml` and the Yarn version declared in `package.json`.

```sh
corepack enable
corepack prepare --activate
yarn install
```

Installation runs `patch-package` through the existing `postinstall` script. Do not bypass it as a normal setup step.

`yarn.lock` is intentionally ignored. Do not commit it, introduce another lockfile, or switch package managers without an explicit request. CI uses `yarn install` without `--frozen-lockfile`.

## Dependency and Patch Troubleshooting

Dependency declarations include ranges, so identical repository revisions do not establish that two installations resolved identical packages.

For installation failures, patch failures, or version-sensitive behavior:

1. Record the repository revision, operating system, and Node.js and Yarn versions. Use `git rev-parse HEAD`, `node --version`, and `yarn --version`.
2. Record the actual resolved versions of affected packages and the loaded Hydro deployment, not just the ranges in `package.json`. With an existing Yarn installation, `yarn why hydrooj`, `yarn why @hydrooj/framework`, and `yarn why @hydrooj/ui-default` can help identify dependency paths and versions.
3. Keep the relevant installation and patch-application output. Redact credentials, tokens, and private registry information before sharing logs.
4. Inspect the affected patch and compare it with the installed target source. The repository currently carries `patches/@hydrooj+framework+0.3.0.patch`, which changes validator typing and content validation; do not assume it applies to a different framework version.
5. Record the exact upstream revision or package source used for compatibility analysis, and compare the local and CI environments.

Do not delete or disable a failing patch to make installation green. Do not edit `node_modules` as the delivered fix, silently change a shared registry, or commit a generated lockfile as a workaround. Keep dependency or patch changes explicit and verify installation and affected behavior.

This repository does not establish a complete supported Hydro or database version matrix. Record the runtime actually exercised; Node.js 24 in lint CI alone does not establish compatibility of every Hydro deployment.

## Automated Checks

Run the existing lint command for code changes:

```sh
yarn lint
```

Use `yarn lint:fix` only when appropriate and review its diff for unrelated edits.

Run the Vitest UT suite for model, handler, or testing-tool changes:

```sh
yarn test
yarn test:coverage
```

See the [UT guide](testing.md#running-and-extending-ut) for focused runs, coverage scope, isolation boundaries, and optional watch mode. The normal commands do not start Hydro, MongoDB, Docker, or a browser.

Run the supported project-scoped type check:

```sh
yarn typecheck
```

See [Type Checking](#type-checking) for its explicit boundary. Vitest transformation
and lint do not replace this check.

Follow the [testing requirements](testing.md) for behavioral coverage. Consult the [self-validation plan](plans/self-validation.md) for delivery status. Treat E2E and environment commands as available only after they exist in the repository; a planned capability is not an implemented check.

For real-service browser coverage:

```sh
yarn test:e2e
```

This command provisions its own MongoDB container, launches local Hydro using isolated user-writable paths, runs Playwright, and tears down run-owned resources. It requires a running Docker engine and local Chrome, not root access or a Hydro container. See the [runtime guide](verification-environment.md#local-runtime-boundary) for browser alternatives and `yarn dev` for manual/MCP work. Do not run bare Playwright against an arbitrary deployment in place of this owned environment.

The coverage goal requires both UT and browser E2E. Use the [verification-environment guide](verification-environment.md) for low-impact Docker boundaries and the project Playwright MCP declaration. MCP-assisted checks are separate evidence, not an automated E2E suite. The [investigation](plans/self-validation-investigation.md) records the original raw standalone TypeScript failures; the supported scoped check is described below.

The PR validation workflow installs dependencies, runs lint, `yarn typecheck`,
`yarn test:coverage`, and `yarn test:e2e`. When changing the workflow, verify the affected run rather than relying on a check from an earlier commit. A locally passing command does not establish a head-specific CI result.

## Type Checking

`yarn typecheck` runs `scripts/typecheck.mjs` using the installed TypeScript compiler
and the repository's `tsconfig.json`. It checks project-owned TypeScript sources:
the addon entry, backend features, frontend pages, tests/helpers, and TypeScript
configuration files. Generated reports and `node_modules` are not roots.
The command fails on configuration, compiler-option, global, syntax, and semantic
errors in that scope, including an empty project. It never emits JavaScript.
Existing strict-null and other compiler options remain enabled as configured.

Hydro `5.0.7` exposes `src/plugin-api.ts`, and default UI `4.58.5` exposes `api.ts`
as its type entry. Their imports pull upstream implementation sources into the
TypeScript program. `skipLibCheck` skips declaration-file checks, not arbitrary
dependency `.ts` implementation checks. A raw full `tsc` invocation therefore
also reports upstream source/configuration issues unrelated to this addon.

The supported command resolves these real dependency types normally, then requests
syntax/semantic diagnostics only for project-owned files. Dependency API misuse
reported in an addon or test file still fails. No handwritten `any` replacement
modules, ignored local error codes, or relaxed compiler options are used.
Dependency implementation diagnostics are intentionally not requested; the command
prints that boundary with its checked-file count. This is not a successful build
or compatibility certification for the entire Hydro dependency graph. Upstream
typing limitations can still limit inference at API boundaries.

For an explicitly full diagnostic investigation, run
`node node_modules/typescript/bin/tsc --noEmit --pretty false`; do not advertise
that broader command as green unless its upstream diagnostics have also been
resolved. Keep `noEmit` in the configuration so accidental invocations cannot
leave JavaScript siblings that interfere with source loading.

The implementation was verified with temporary backend, frontend, and test type
errors, including misuse of the real `ObjectId` and `NamedPage` types. All failed
with nonzero status, emitted no JavaScript, and passed again after probe removal.
No Docker, browser, network service, or new dependency is required for this check.

Official references: TypeScript's compiler API guide at
`https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API` and
`skipLibCheck` reference at
`https://www.typescriptlang.org/tsconfig/skipLibCheck.html`.

## Manual Verification

Follow the [Hydro smoke-testing guide](hydro-smoke-testing.md) for prerequisites, test accounts, fixtures, actions, and expected results. Compare outcomes with the [behavior reference](blog-behavior.md).

For behavior changes, verify the affected flow in a Hydro instance when available. Select relevant cases rather than treating this as a mandatory full checklist:

- Public, owner, and privileged-user access, especially draft visibility.
- Creating, editing, publishing, and deleting posts.
- Home and user lists, sorting, pinned posts, and pagination.
- View tracking, stars, two-level comments/likes, deletion permissions, native
  notifications, and comment/status cleanup through the loaded detail handler.
- Template rendering, frontend integration, and affected translations.
- Compatibility with existing documents when changing persistence.

Document what was checked and any environment limitations. Do not claim checks passed unless they were run.

Documentation-only changes do not require application validation unless they also change executable configuration. Check documentation paths, links, and commands for consistency with the repository. The current workflow has Markdown path exclusions; a documentation-only change may not produce a validation run. Do not interpret an absent check as proof of document correctness.

## Required Verification by Change

| Change | Minimum applicable evidence |
| --- | --- |
| Documentation only | Review accuracy, local links, referenced paths, and consistency with implemented commands. |
| Types or shared contracts | Lint, `yarn typecheck`, and inspect affected callers. Verify affected behavior separately. |
| Model, handler, or business behavior | Lint, focused Vitest UT, and applicable Playwright E2E denial/persistence cases. Use the runtime/manual fallback for contracts outside automated coverage. |
| Templates, frontend, or localization | Lint where applicable and applicable Playwright E2E; verify additional rendered languages and roles through the local development runtime when outside current coverage. |
| Dependencies or patches | Verify installation and patch application, lint, and exercise affected integrations. |
| CI or validation tooling | Run the changed checks and verify the corresponding workflow on the current PR head. Confirm failure detection as well as successful execution. |

Use the smallest checks that cover the change. Broaden verification when shared behavior, failures, or unresolved risks justify it; do not run unrelated full-system checks mechanically.

## Completion and Evidence

For implementation work, record:

- The acceptance criteria and changed scenarios verified.
- Exact commands and outcomes, distinguishing lint, type checks, tests, and manual checks.
- Any relevant runtime or dependency constraints needed to reproduce the result.
- Checks not run, the reason, and the remaining uncertainty.

Fix failures caused by the change before marking it complete. Do not disable checks, weaken assertions, or ignore failures to obtain a green result. Distinguish unrelated baseline failures with evidence and report them.

When required infrastructure is unavailable, perform the checks that are possible and document the gap. A blocked or unverified scenario is not a passing scenario; do not claim full validation.
