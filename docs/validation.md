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

There is no supported dedicated type-check command in `package.json`. Vitest transforms TypeScript but does not type-check it. Do not describe lint or UT as a passing full TypeScript compilation.

Follow the [testing requirements](testing.md) for behavioral coverage. Consult the [self-validation plan](plans/self-validation.md) for delivery status. Treat E2E and environment commands as available only after they exist in the repository; a planned capability is not an implemented check.

The coverage goal requires both UT and browser E2E. Use the [verification-environment guide](verification-environment.md) for low-impact Docker boundaries and the project Playwright MCP declaration. MCP-assisted checks are separate evidence, not an automated E2E suite. The [investigation](plans/self-validation-investigation.md) records a passing lint baseline and raw standalone TypeScript failures; no supported type-check command has been added.

The PR validation workflow installs dependencies, runs lint, and runs `yarn test:coverage`. When changing the workflow, verify the affected run rather than relying on a check from an earlier commit. A locally passing command does not establish a head-specific CI result.

## Manual Verification

Follow the [Hydro smoke-testing guide](hydro-smoke-testing.md) for prerequisites, test accounts, fixtures, actions, and expected results. Compare outcomes with the [behavior reference](blog-behavior.md).

For behavior changes, verify the affected flow in a Hydro instance when available. Select relevant cases rather than treating this as a mandatory full checklist:

- Public, owner, and privileged-user access, especially draft visibility.
- Creating, editing, publishing, and deleting posts.
- Home and user lists, sorting, pinned posts, and pagination.
- View tracking, star state, and other affected document-status behavior. Verify replies only when the change affects the model-level reply helper; this addon does not register a reply handler.
- Template rendering, frontend integration, and affected translations.
- Compatibility with existing documents when changing persistence.

Document what was checked and any environment limitations. Do not claim checks passed unless they were run.

Documentation-only changes do not require application validation unless they also change executable configuration. Check documentation paths, links, and commands for consistency with the repository. The current workflow has Markdown path exclusions; a documentation-only change may not produce a validation run. Do not interpret an absent check as proof of document correctness.

## Required Verification by Change

| Change | Minimum applicable evidence |
| --- | --- |
| Documentation only | Review accuracy, local links, referenced paths, and consistency with implemented commands. |
| Types or shared contracts | Lint, inspect affected callers, and run a dedicated type check once a supported command exists. Verify affected behavior separately. |
| Model, handler, or business behavior | Lint and focused Vitest UT, including applicable denial and failure paths. Use the runtime/manual fallback for contracts not exercised by isolated tests. |
| Templates, frontend, or localization | Lint where applicable and verify rendered behavior, affected languages, and relevant user roles in a Hydro instance when available. |
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
