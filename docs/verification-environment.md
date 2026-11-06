# Verification Environment

## Goal and Current Capability

Minimize changes to the host operating system while providing UT and E2E evidence. Run Hydro from the checkout's dependencies and run Playwright locally. Only MongoDB needs a disposable Docker container. No global Hydro installation, PM2, root access, system service, or devcontainer is required.

The repository supplies [Vitest UT](testing.md#running-and-extending-ut), local Hydro/MongoDB provisioning, Playwright Test E2E, and a locally launched Playwright MCP in [`.github/mcp.json`](../.github/mcp.json). See the [delivery plan](plans/self-validation.md#delivery-record) for verified versions, coverage, and remaining gaps.

## Local Runtime Boundary

Run from the repository root after installing dependencies. Prerequisites are Node 24, pinned Yarn, a running Docker engine, and locally installed Chrome:

```sh
# Disposable development server at http://127.0.0.1:8888:
yarn dev
# Fully managed browser run with a dynamically allocated HTTP port:
yarn test:e2e
# Forward a Playwright filter:
yarn test:e2e --grep "publication"
```

`yarn dev` prints the local URL and synthetic test accounts, then waits for Ctrl+C. Its database and files are deliberately disposable and are removed on normal shutdown. Use it for development and MCP checks, not as a persistent personal Hydro deployment. `HYDRO_E2E_PORT=8889 yarn dev` selects another HTTP port; an occupied port fails instead of reusing an existing server.

The default browser is installed Chrome. To use Playwright-managed Chromium instead, explicitly install it with `yarn playwright install chromium`, then run `HYDRO_E2E_BROWSER=chromium yarn test:e2e`. This is a user-level browser download, not a request to install OS packages. Missing browser/system prerequisites must fail visibly; do not run a privileged installer automatically.

| Component | Isolation and responsibility |
| --- | --- |
| Checks | Existing local Node 24/Yarn can run lint and UT. An optional disposable check container can use the same commands with container-owned dependencies, not host `node_modules`. A supported project type check remains planned. |
| Hydro | A local child process using the installed CLI, actual default UI, and this checkout registered as an addon. It has a dedicated home, configuration profile, file storage, and temporary directory. |
| MongoDB | One uniquely named/labeled `mongo:7-jammy` container, temporary `/data/db` and `/data/configdb`, and a dynamically allocated port published only on `127.0.0.1`. No existing database is accepted. |
| E2E | Local Playwright Test against the allocated HTTP URL, with real login sessions and a unique report directory. |
| Agent browser | The declared local Playwright MCP, using an independent browser session against the same isolated Hydro environment. |

`scripts/hydro-runtime.mjs` owns startup, readiness, tests, and teardown. It does not require Compose or a named Docker network. Both services bind to loopback; the browser reaches the local Hydro process directly. Every run gets a unique container, temporary directory, output directory, and database port.

Do not add a judge, `go-judge`, privileged containers, host networking, Docker-socket mounts, host service managers, or a system installer. Do not expose an MCP HTTP endpoint when stdio is sufficient. A devcontainer may wrap this setup if useful, but must not be copied from upstream without rechecking its current code and privileges.

No source or home bind mount is used. Node dependencies and browser/package caches remain user-level local resources. MongoDB data stays in container tmpfs; Hydro files stay under a newly allocated temporary directory. Image and tool caches still consume disk space; isolation does not mean zero host impact.

## Hydro Startup and Writable Paths

The launcher sets these only in the Hydro child's environment:

| Variable | Purpose |
| --- | --- |
| `DEFAULT_STORE_PATH` | Redirect the normal `/data/file/hydro` default into run-owned writable storage. Read back the live storage service and require an exact match. |
| `HOME` | Isolate `.hydro` configuration and the static directory that Hydro empties/rebuilds at startup. Never reuse the maintainer's home. |
| `HYDRO_PROFILE` | Select the pre-created `blog-e2e` configuration containing only the run-owned MongoDB URI and addon list. |
| `TMPDIR`, `TMP`, `TEMP` | Keep Hydro and UI-builder temporary files under the run directory. |
| `NODE_APP_INSTANCE=0` | Run initial migrations and normal static preparation for this isolated database. |
| `NODE_ENV=development`, `DEV=1` | Use development behavior and local UI assets. |

`CI` is removed only from the Hydro child: Hydro otherwise bypasses the configured MongoDB and tries `mongodb-memory-server`, and its storage default bypasses `DEFAULT_STORE_PATH`. Playwright still inherits the original CI environment. Inherited `HYDRO_CLI` is also removed so the web server is not silently disabled.

The launcher uses `--host 127.0.0.1`, an explicit port, and `--disableWorker`; no judge or scheduled-task consumer is needed. The installed default UI already supplies built assets; normal Hydro startup compiles this addon's frontend and loads its templates. No full Hydro monorepo build is required.

The bootstrap listens for `app/ready`, accesses storage through Cordis injection, verifies the loaded blog model and actual storage path, and creates synthetic author/viewer/system-editor users through Hydro's user model. Browser authentication then uses the real login form. Readiness also requires a rendered login page and an existing blog route, not merely an open TCP port; authentication tests then verify the rendered addon page.

## Evidence and Cleanup

Each run writes `test-results/<run-id>/`, ignored by Git: HTML report, failure screenshots/traces, a bounded Hydro log, and `runtime.json` listing the owned container, temporary directory, and driver PID. Authentication-state files are removed at teardown. Reports can contain synthetic sessions; do not commit them.

MongoDB readiness is bounded to 30 seconds, Hydro startup to 90 seconds, browser tests to 150 seconds globally, and the parent test process to 180 seconds. Shutdown escalates from SIGTERM to SIGKILL for owned child processes. Ordinary success, test failure, invalid configuration, empty test selection, and SIGINT/SIGTERM trigger cleanup of the owned services and temporary files.

An uncatchable kill or a tool that forcefully terminates the whole process tree can prevent `finally` cleanup. Use that run's `runtime.json` to inspect its exact resources; verify the container's `hydro-addon-blog.e2e` label before removing it and verify ownership before deleting the listed temporary directory. Never use name-wide process killing, global Docker prune, shared-database deletion, or unrelated-home cleanup.

## Project Playwright MCP

The shared `.github/mcp.json` declares the `playwright` stdio server. It runs `npx -y @playwright/mcp@0.0.83 --headless --browser chrome --isolated` locally. The package version is explicit rather than a moving tag; the browser uses an isolated in-memory profile, not the user's normal Chrome profile. Docker is not a prerequisite for MCP startup.

Prerequisites are Node 24/npm to match the project baseline, package-registry access for the first download, an installed Chrome browser, and an MCP client supporting this configuration. `npx` uses its package cache without a global installation. Install a supported browser explicitly if missing; do not silently install operating-system packages or switch to a personal session.

Start `yarn dev`, then start or reload the client's project MCP configuration, confirm tool discovery, and navigate to the printed Hydro URL. MCP startup does not provision Hydro itself. Copilot CLI loads this declaration in a trusted repository; a root `.mcp.json` can supply a per-checkout override. The declaration does not automatically configure GitHub's cloud-agent repository settings or every MCP client; VS Code uses its own `servers` configuration format.

Use the [smoke-test roles and scenarios](hydro-smoke-testing.md#accounts-and-fixture-manifest). Keep account sessions isolated, record the addon revision, actions, expected and observed results, and browser errors. Save necessary screenshots, logs, or tool-returned artifacts in a designated run directory; the default `.playwright-mcp/` output is ignored by Git. Do not use a personal browser profile or production session.

On disconnect, the client must close the stdio process and its owned browser session. Remove only run-owned temporary artifacts; do not delete shared npm/browser caches as routine cleanup. Clean up the separate Hydro stack only when it is run-owned and unused.

Refresh the package version deliberately and verify initialization, tool discovery, navigation, and cleanup. A package version or valid JSON alone does not prove that browser checks work.

On 2026-11-06, MCP initialization and blank-page navigation were first verified. After local runtime implementation, MCP also logged in to the disposable Hydro server, published a post through the actual Markdown editor, and confirmed the rendered detail content. Browser closure and owned runtime cleanup were performed. This agent-assisted evidence is separate from the automated E2E suite.

## Automated E2E and Agent Checks

`yarn test:e2e` executes three real-login setup cases and fifteen business scenarios:
the original article/frontend regressions plus global role/settings management,
fine-grained permissions, self-only creation even for root, guest access, and domain independence. The launcher also
creates a synthetic domain whose guest/default domain permissions are zero, to
verify that blog access is independent without changing ordinary domain routes.
The suite uses normal sessions, real sudo and same-origin requests, with independent
browser contexts for the roles. Read-only MongoDB assertions inspect only the
run-owned database. See the [testing inventory](testing.md#running-and-extending-e2e).

CI runs the same command after lint and UT. It requires Docker and local Chrome; GitHub's Ubuntu runner image includes Chrome, but a head-specific CI run must still verify that environment. Use MCP to inspect changed pages and reproduce failures; an agent reporting success is not a deterministic CI assertion. Missing infrastructure or failed startup is a failed check, never skipped-success coverage.

## Source Basis

- [Official Hydro documentation](https://docs.hydro.ac/zh/docs/Hydro) supplies deployment and extension context.
- [Hydro Docker configuration](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/install/docker/docker-compose.yml) and [backend startup](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/install/docker/backend/entrypoint.sh) show MongoDB health checks, UI addon configuration, and application initialization. The upstream [Docker README](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/install/docker/README.md) labels that deployment module as not officially maintained.
- [Hydro devcontainer](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/.devcontainer/docker-compose.yml) includes judge-related privileges and tools that are unnecessary for blog tests.
- [Hydro configuration loading](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/packages/hydrooj/src/options.ts), [storage defaults](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/packages/hydrooj/src/service/storage.ts), [database selection](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/packages/hydrooj/src/service/db.ts), and [worker startup](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/packages/hydrooj/src/entry/worker.ts) establish the isolated environment and readiness requirements. Installed Hydro `5.0.7` was inspected separately.
- [Official Playwright MCP getting-started guide](https://playwright.dev/docs/getting-started-mcp) documents local `npx` launch, headless mode, browser selection, and isolated profiles.
- [Playwright MCP configuration reference](https://github.com/microsoft/playwright-mcp#configuration) supplies further options; [Copilot CLI MCP configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) documents repository-level declarations.
- [Ubuntu runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) lists its browser prerequisites; do not treat that moving inventory as a completed PR check.
