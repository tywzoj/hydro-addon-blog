# Verification Environment

## Goal and Current Capability

Minimize changes to the host operating system while providing UT and E2E evidence. Keep Hydro services and MongoDB inside disposable containers. Run Playwright and its browser locally; browser containerization is not required. Existing local Node/Yarn can run lightweight checks; do not require a host Hydro installation.

The repository declares a locally launched Playwright MCP in [`.github/mcp.json`](../.github/mcp.json). It does not yet provision Hydro, MongoDB, a UT runner, or Playwright Test E2E fixtures. The [investigation record](plans/self-validation-investigation.md) distinguishes verified experiments from proposed implementation.

## Proposed Runtime Boundary

Use a small Docker Compose stack for the implementation, not a full online-judge deployment:

| Component | Isolation and responsibility |
| --- | --- |
| Checks | Node 24 and pinned Yarn in a disposable container for installation, patch application, lint, UT, and the selected project type check. Use container-owned dependencies, not host `node_modules`. |
| Hydro | Compatible Hydro and default UI, with this addon registered at its actual container path. Run in the foreground with a dedicated home/configuration and test file storage. |
| MongoDB | Dedicated test database and run-owned volume or temporary storage; no host database port or shared database. |
| E2E | Local Playwright Test with its compatible browser, targeting Hydro through a loopback-published port and writing reports to a designated artifact directory. CI may use a browser container if useful. |
| Agent browser | The declared local Playwright MCP, using an independent browser session against the same isolated Hydro environment. |

Use `hydro-blog-validation` as the dedicated local service network name and `hydro` as the future Hydro service alias. Publish Hydro on loopback, for example `127.0.0.1:8888:8888`, so local browsers can target `http://127.0.0.1:8888`; do not publish MongoDB. These are planned stack contracts, not an already available server. CI and parallel worktrees must use unique network/resource names and available ports.

Do not include a judge, `go-judge`, privileged containers, host networking, Docker-socket mounts into test containers, host service managers, or a system installer. Do not expose an MCP HTTP endpoint when stdio is sufficient. Bind the Hydro browser-access port to loopback; an optional containerized CI browser should use the internal service address.

Keep service dependencies, package caches, Hydro's home directory, and database files in containers or dedicated volumes. Local checks and Playwright may use normal user-level package/browser caches; do not require global Hydro services or a personal browser profile. Mount only the addon source needed for the run, preferably read-only for execution; do not mount the user's home, existing `.hydro`, or unrelated checkouts. Export only designated reports. Containers and local tool caches still consume disk space; isolation does not mean zero host impact.

Bound installation, readiness, tests, and shutdown. Check MongoDB readiness, Hydro health, and an addon route before starting E2E; a listening port alone does not establish that the addon loaded. Teardown must run after failure and remove only the run's containers, network, volumes, and fixtures. Never use global Docker prune as test cleanup.

An optional devcontainer should wrap the same checks and services, not introduce a second environment. Add it only if editor tooling or a consistent Linux workspace is needed. It must not inherit upstream judge privileges or install dependencies onto the host.

## Project Playwright MCP

The shared `.github/mcp.json` declares the `playwright` stdio server. It runs `npx -y @playwright/mcp@0.0.83 --headless --browser chrome --isolated` locally. The package version is explicit rather than a moving tag; the browser uses an isolated in-memory profile, not the user's normal Chrome profile. Docker is not a prerequisite for MCP startup.

Prerequisites are Node 24/npm to match the project baseline, package-registry access for the first download, an installed Chrome browser, and an MCP client supporting this configuration. `npx` uses its package cache without a global installation. Install a supported browser explicitly if missing; do not silently install operating-system packages or switch to a personal session.

Start or reload the client's project MCP configuration, confirm server initialization and browser-tool discovery, then navigate to the loopback test Hydro address. MCP startup does not provision Hydro; project browser scenarios remain blocked until the runtime and fixtures exist. Copilot CLI loads this declaration in a trusted repository; a root `.mcp.json` can supply a per-checkout override. The declaration does not automatically configure GitHub's cloud-agent repository settings or every MCP client; VS Code uses its own `servers` configuration format.

Use the [smoke-test roles and scenarios](hydro-smoke-testing.md#accounts-and-fixture-manifest). Keep account sessions isolated, record the addon revision, actions, expected and observed results, and browser errors. Save necessary screenshots, logs, or tool-returned artifacts in a designated run directory; the default `.playwright-mcp/` output is ignored by Git. Do not use a personal browser profile or production session.

On disconnect, the client must close the stdio process and its owned browser session. Remove only run-owned temporary artifacts; do not delete shared npm/browser caches as routine cleanup. Clean up the separate Hydro stack only when it is run-owned and unused.

Refresh the package version deliberately and verify initialization, tool discovery, navigation, and cleanup. A package version or valid JSON alone does not prove that browser checks work.

On 2026-11-06, the declared local command completed MCP initialization, exposed 25 tools, navigated Chrome to `about:blank`, and closed the browser successfully. This confirms local MCP/browser startup without Docker; it does not verify a Hydro page or any project E2E scenario.

## Automated E2E and Agent Checks

Implement a separate Playwright Test command for CI. It should use real Hydro authentication and normal CSRF/session handling, synthetic author/viewer/system-editor accounts, unique fixtures, and independent browser contexts. Include both allowed flows and denied writes, asserting persisted results after reload. Do not hard-code an assumed HTTP status before checking Hydro's actual response.

Use MCP to inspect changed pages, reproduce failures, and confirm interactions during development. Retain the resulting regression as an executable test; an agent reporting success is not a deterministic CI assertion. Missing service infrastructure, failed MCP startup, or unavailable Hydro is a blocked check, never a skipped-success substitute for required E2E coverage. A stopped Docker engine blocks the proposed Hydro stack, not local MCP itself.

## Source Basis

- [Official Hydro documentation](https://docs.hydro.ac/zh/docs/Hydro) supplies deployment and extension context.
- [Hydro Docker configuration](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/install/docker/docker-compose.yml) and [backend startup](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/install/docker/backend/entrypoint.sh) show MongoDB health checks, UI addon configuration, and application initialization. The upstream [Docker README](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/install/docker/README.md) labels that deployment module as not officially maintained.
- [Hydro devcontainer](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/.devcontainer/docker-compose.yml) includes judge-related privileges and tools that are unnecessary for blog tests.
- [Hydro configuration loading](https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/packages/hydrooj/src/options.ts) uses a home-relative configuration/addon registry, motivating a container-owned home.
- [Official Playwright MCP getting-started guide](https://playwright.dev/docs/getting-started-mcp) documents local `npx` launch, headless mode, browser selection, and isolated profiles.
- [Playwright MCP configuration reference](https://github.com/microsoft/playwright-mcp#configuration) supplies further options; [Copilot CLI MCP configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) documents repository-level declarations.
