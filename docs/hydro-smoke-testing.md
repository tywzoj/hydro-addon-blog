# Hydro Smoke Testing

## Purpose and Verification Status

This guide provides a repeatable manual protocol for checks that require Hydro. Its expected results come from the [source-derived behavior reference](blog-behavior.md); the protocol has not been executed as part of the documentation work.

The repository provides [automated E2E](testing.md#running-and-extending-e2e) and an [isolated local runtime](verification-environment.md#local-runtime-boundary) through `yarn dev`: local Hydro, disposable MongoDB, and synthetic accounts. Use this environment and the [declared Playwright MCP](verification-environment.md#project-playwright-mcp) for new manual verification. The automated subset does not prove that every manual scenario below has run or certify a complete deployment matrix. Record the environment used for each run and treat unexecuted steps as unverified, not passed.

## Prerequisites

For the repository-owned environment, use `yarn dev` and its printed URL/accounts; addon registration and readiness are handled by the launcher. Skip the deployment-management instructions below in that case. Accounts `blog_author`, `blog_viewer`, and `blog_editor` correspond to A, B, and C. Their shared test password is `000000`, defined once in `tests/e2e/accounts.ts` and reused by provisioning, browser tests, and startup output.

- An explicitly designated non-production Hydro deployment and its required services, including its configured database.
- A known deployment version, base URL, target domain, service-management method, and an operator authorized to register the addon and reload that test deployment.
- The addon checkout available to the Hydro process. Install its dependencies using the [validation guide](validation.md#environment-and-dependencies), preserving patch application.
- Hydro's default UI or an explicitly recorded compatible UI providing the templates and frontend components used by the addon.
- Disposable accounts and data reserved for the run, with permission to inspect the relevant test records and operation logs.

Use the [official Hydro documentation](https://docs.hydro.ac/zh/docs/Hydro) for deployment-specific installation and service setup, and the [official source](https://github.com/hydro-dev/Hydro) for APIs and privilege semantics. Do not copy production configuration, invent default credentials, or assume this addon checkout is a complete Hydro installation.

If these prerequisites are unavailable, record the blocker and run only the available local checks. Do not install or restart a shared deployment merely to satisfy the protocol.

## Register and Load the Addon

On the designated test deployment, register the actual checkout path:

```sh
hydrooj addon add /absolute/path/to/hydro-addon-blog
```

Reload Hydro through that deployment's established service manager. For a test installation already managed by PM2 under the name `hydrooj`, the repository's existing installation command is:

```sh
pm2 restart hydrooj
```

These commands are inherited from the repository installation instructions, not a claim that every deployment uses PM2 or this process name. Follow the actual deployment configuration for other service managers.

Check startup output for addon, patch, template, or index errors. Open `/blog` through the target domain's generated navigation; confirm the page renders and the profile blog entry points to the correct user. Record the actual URL and the loaded addon revision. Do not diagnose successful registration solely from the CLI exit code.

## Accounts and Fixture Manifest

Record the actual privilege assignments, not just account labels:

| Role | Required setup |
| --- | --- |
| Author A | Disposable account with `PRIV_USER_PROFILE` and no `PRIV_EDIT_SYSTEM`. |
| Viewer B | Different disposable account with `PRIV_USER_PROFILE` and no `PRIV_EDIT_SYSTEM`. |
| System editor C | Disposable account with both privileges. Ordinary domain administration alone is not the stated condition in this addon's checks. |
| Restricted or anonymous viewer | Record actual privileges and session state. Do not assume anonymous requests are admitted by the route gate. |

Use separate browser sessions for the accounts. Create uniquely named fixtures with a run-specific prefix and record their user IDs, post IDs, and intended cleanup:

- Author A's unpublished draft D.
- Author A's published pinned post P.
- Author A's newer published unpinned post N, with a different publication time from P.
- A published post V reserved for Viewer B's first-view and star checks.
- Optional extra published posts for a dataset exceeding ten eligible entries.

Use distinct timestamps for ordering checks rather than relying on unspecified tie behavior. Keep unrelated posts out of the expected result set or account for them explicitly.

## Manual Scenarios

| ID | Setup and actions | Expected source-derived result |
| --- | --- | --- |
| M1: Load and navigation | Load the addon, open its home and Author A's user list, and follow the profile entry. | Pages render without addon/template errors; links resolve to the intended user and domain. |
| M2: Draft and publication | As A, create D with Draft selected. Confirm its absence from home and presence in A's own list. Publish D, record its first-publication time, then edit it again. | The draft has no assigned first-publication time; publication assigns one; a later edit preserves it while refreshing update time. Use test record inspection if the rendered precision is insufficient. |
| M3: List roles | Keep another draft unpublished. Open home and A's list as A, B, and C. | Home excludes drafts for every admitted viewer. A's user list includes drafts for A and C, but excludes them for B. |
| M4: Sorting and pinning | Use P and newer N. Compare home and A's list with no sort parameter, then `?sort=latest`, `?sort=latest_update`, and `?sort=views`. Record view counts before comparing. | Defaults and selected descending keys match the behavior reference. Pinning precedes the selected key only in A's list. Use distinct values for asserted ordering. |
| M5: Pagination | With more than ten matching records, compare `?page=1` and `?page=2` under a sort whose values are distinct. | At most ten results per page, with the expected filtered records. Invalid non-positive pages are rejected by the configured validator. |
| M6: Write authorization | As B and C, attempt to open A's create form and submit a new article; verify each can create only under their own account. Compare B and C editing A's post. | Other-author creation is rejected even for system-editor C. Non-owner B without edit permission is rejected; C can still edit A's post. Rejected writes do not change data. Preserve normal CSRF/session handling in test requests. |
| M7: Sequential view and star | Before B ever opens V, record its count and B's status. Open V once as B, then again after the first request finishes. Toggle its star through the UI and reload; compare A's star state. | First eligible view increments and records status; the later sequential view does not increment again. B's star value persists independently of A's. This does not test concurrent deduplication. |
| M8: Validation and operation logs | Submit an invalid title/content through the normal form flow; then create, edit, and delete a disposable valid post. Inspect test data and operation logs. | Invalid input is rejected without the attempted mutation; valid operations record `blog.create`, `blog.edit`, and `blog.delete`; successful deletion removes the post and associated status. |
| M9: Localization and access gate | Switch between the supported languages relevant to the change, then request a blog route with the restricted session. | Labels render using the existing translations; a session without the required route privilege is not admitted. Record the actual Hydro response rather than assuming a particular HTTP status. |
| M10: Comments and likes | On a published article, post a Markdown comment and nested reply as B; like/unlike both, reply again, and reload. Cancel and confirm authorized deletion. Withdraw the article and compare A/B/C. Inspect narrow-screen and translated controls. | Both levels retain content and independent like state; replied-to targets remain interactive. No editing/history/locking UI exists. Drafts preserve comments but deny new comments/likes/unlikes. Deletion follows the exact native branches in the behavior guide and cleans descendant like state. Existing role masks need explicit comment grants after upgrade. |

Only run cases relevant to the change. Use a controlled fixture and supported test-data tooling for legacy documents without `firstPublishAt`; a single-post fallback does not prove list backfilling. Do not modify real user records to manufacture that fixture.

Do not flood the live test service to verify the creation rate limiter. Preserve its invocation through source review until an isolated automated check is available.

Draft direct-link privacy, concurrent first-view counting, failure rollback, and equal-key ordering require explicit contract decisions or additional implementation evidence. Do not label those scenarios passed by extrapolating from these checks.

## Evidence and Cleanup

Record the following in the PR or relevant project plan:

- Addon revision, runtime and resolved dependency versions, domain/UI setup, and any relevant sanitized configuration.
- Actual role privileges and the fixture manifest, using synthetic data.
- Scenario IDs run, actions, expected and observed results, and supporting logs or screenshots where useful.
- Scenarios skipped or blocked, reasons, and unresolved behavior.
- Cleanup performed and resources intentionally retained for debugging.

Remove only fixtures and resources owned by the run, using the supported application or test-environment mechanisms. Do not drop shared collections or delete unrelated accounts. Restore temporary privilege assignments and stop helper processes started for the check.
