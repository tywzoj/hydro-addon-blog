# Global Blog Settings and Permissions

Status: Implementation complete; PR validation and review are tracked on the pull request. No moderation workflow is included.

## PR Delivery

The delivery includes global role settings, the native-UX and anonymous-guest
corrections, Hydro-compatible matrix ordering, and the shared-constant/type
refactor. Local verification records are retained below. The pull request's
current-head checks are authoritative for CI lint, unit coverage and real-Hydro
E2E results; historical local results do not substitute for those checks.

## Follow-up: Shared Constants

Status: Completed locally. Consolidate repeated role names, permission/action identifiers,
settings route/template names, audit operations, shared messages, storage identity,
schema version and pagination values using the existing `as const` conventions.
Derive literal unions and reuse update/visibility types rather than duplicating
their definitions. Keep frontend-shared constants free of Hydro server imports.

This is a behavior-preserving refactor: persisted values, permission bits, route
URLs, operation names, role ordering and UX remain unchanged. Reuse existing
regression tests rather than adding tests that only restate constant values.

The catalog in `features/constants.ts` is browser-safe. Permission names and
translation keys derive from its stable permission-bit definitions; action and
operation unions derive from `as const` objects. Shared model shapes and
update/visibility aliases live in `features/types.ts`, while former exports remain
available for compatibility. Native template markup and independent test
expectations retain their declarative literals, matching the original project
pattern rather than introducing a new template-context mechanism.

Verification passed `yarn lint --fix`, `yarn test:coverage` (99 UT) and
`yarn test:e2e` (all 17 cases). Browser evidence is under ignored
`test-results/hydro-blog-2536-8f44688c/`. MCP additionally verified that the
refactored client bundle loads, the matrix still contains 18 permissions with
read-only root, and the native assignment dialog still excludes guest.
VS Code reported no diagnostics for the checked constants, model and type files;
this is not a standalone whole-project type-check claim. No CI run is claimed.
The temporary refactoring tool and verification runtime were cleaned up; the
existing manual instance and its data were left untouched.

## Follow-up: Native User-Management UX

Status: Completed locally. Align the blog user page with Hydro's domain-user workflow:
header-level Add User dialog, checkbox/UID/username/role table, inline role
selectors and bulk role assignment. The latest clarification below removes
the separate user-removal action.
Reuse exposed `prompt`, `confirm`, `Notification`, `request`, checkbox conventions
and native table styles. Guest/default users remain excluded from the list;
selecting default resets an assignment without changing any membership or account. Forced
root rows are read-only; other current-user changes remain allowed by the approved
trusted-manager policy. Keep the single-user endpoint compatible.

Reference: pinned official
`packages/ui-default/pages/domain_user.page.js`,
`templates/domain_user.html`, and `pages/domain_user.page.styl`; exposed dialog
and request implementations were checked against installed UI default 4.58.5.
Bulk requests must validate all users before writing. Add UT and E2E for these
flows, and retain the maintainer's existing manual-test instance and data.

The maintainer expanded this follow-up to all blog UX. The source audit covers:

| Page or integration | Native reference | Resolution |
| --- | --- | --- |
| Home and author lists | Official `packages/blog/templates/blog_main.html` | Keep native list/empty-state/paginator/sidebar patterns. Remove the custom mobile column reversal and use Hydro's normal responsive grid stacking. Retain the blog-specific sort selector using native controls. |
| Article detail | Official `packages/blog/templates/blog_detail.html` | Keep native author/profile, rich content, star and supplementary footer patterns. Place independent article action controls before the footer so it remains the section's final block. |
| Create/edit | Official blog editor and `partials/discussion_edit_form.html` | Already aligned: native Markdown editor, checkbox controls, primary submit/hotkey, delete and cancel, and Markdown help sidebar. Keep direct article form submission, as upstream does; bulk role/user removal uses confirmation dialogs separately. |
| Settings overview/sidebar | `domain_base.html`, `components/sidemenu.html` | Use Hydro's sticky sidebar and exposed side-menu macro for selected-page feedback. Overview remains blog-specific explanatory content within native sections. |
| Roles | `domain_role.html`, `pages/domain_role.page.js` | Header create dialog, built-in labels/read-only checkboxes, selection and confirmed bulk deletion. Do not fabricate domain membership counts for global roles. |
| Permission matrix | `domain_permission.html` and scoped styles | Reuse native column/family classes, grouped bodies, checkbox range behavior, and Update/Cancel controls. Fix the previously misplaced loop boundary so each row is explicitly closed. |
| Users | `domain_user.html`, `pages/domain_user.page.js` | Header role-assignment dialog with native multi-user selection; checkbox/UID/username/role table; immediate inline role updates and bulk assignment. Reset through default; guest is not assignable and there is no user-removal action. |
| Native navigation/profile entry | `ctx.injectUI`, `NamedPage`, existing profile contact items | Retain permission-aware native menu injection and the existing profile contact-link integration; do not override Hydro templates. |

All choices preserve the approved global authorization semantics. Native dialog,
notification, request, form, table and checkbox implementations are reused rather
than replaced by addon-specific widgets.

The add-user dialog composes Hydro's exposed `ActionDialog` and
`UserSelectAutoComplete` rather than replacing either widget. Native lifecycle
events keep dialog actions disabled until the opening animation completes and
focus the user selector. This also prevents fast cancellation from leaving a
backdrop behind. Inline failures restore the previous role and use native error
notifications.

The side-menu macro is retained; a blog-scoped page script supplies active/ARIA
state where a domain prefix prevents the macro's path comparison from matching.
Blog sudo links target the system-domain identity endpoint, preserving the
original return URL and all authentication requirements.

Follow-up verification on November 6, 2026:

- `yarn lint --fix` and `yarn test:coverage`: passed, with 95 UT.
- `yarn test:e2e`: all 17 cases passed in the isolated runtime; evidence is under
  ignored `test-results/hydro-blog-69297-cd85b0d9/`.
- Playwright MCP verified native dialog layout/focus/cancellation, 18 matrix rows,
  read-only root, correct cross-domain current-page state and fresh sudo return,
  390px layout without document overflow, native list stacking and detail footer
  ordering. A temporary article was created through the editor and deleted.
- Snapshot: ignored `.playwright-mcp/blog-users-native-dialog-mobile.png`.
- Intermittent external Gravatar DNS failures were observed, not local addon
  script failures. Submission tests now wait for DOM readiness and retain their
  application assertions instead of waiting for unrelated avatar loading.
- No CI or standalone type-check result is claimed. At this stage, an independent
  instance on port 8891 preserved the original manual data. Both interim instances
  were subsequently replaced at the maintainer's request, as recorded below.

## Goal and Confirmed Decisions

Provide one installation-wide blog settings area, independent of Hydro domains.
Keep articles in the existing system-domain document type 70.

- Unassigned authenticated users use `default`; anonymous users use `guest`.
- Blog permissions cover all users automatically. There is no joining, leaving,
  invitation or membership state. The user table lists role overrides, not members.
- Guest is reserved for unauthenticated identities and cannot be assigned through
  the UI or APIs. Existing manual guest assignments resolve to default when the
  user is authenticated; no destructive migration is needed.
- `PRIV_EDIT_SYSTEM` forces `root`. Explicit root assignments are also supported.
- Guest starts with no access, but administrators may configure any guest permission.
  Writes still require an authenticated profile; sensitive management actions use sudo.
- One `MANAGE_SETTINGS` permission controls all settings operations. Managers may
  assign root or grant permissions they do not themselves possess.
- Root has the immutable `-1n` mask. Root/default/guest cannot be deleted.
- Custom roles inherit the current default mask. Deleting a custom role returns
  its members to default without resurrecting assignments when its name is reused.
- User-role lists show only effective root/custom-role users, filtering before
  counting and pagination. User lookup still finds unlisted registered users for
  assignment to default, root or a custom role.
- Own and others permissions are strictly separate. Article ownership is not a bypass.
- Default grants published reading, starring, and all own-article operations.
- Draft visibility applies equally to lists, direct links, editor and JSON responses.
- Publishing permission also protects changes to content that remains public.
- Reuse Hydro UI/styles and frontend injection; do not override native templates.

## Hydro Source Conformance

Source basis: official revision `3c8286dd1350fcd00412e95d5b056dbfed64edda`,
installed Hydro 5.0.7 and UI default 4.58.5.

| Contract | Verified source and decision |
| --- | --- |
| Management authority | `packages/hydrooj/src/handler/domain.ts` uses one `PERM_EDIT_DOMAIN`; blog uses one `MANAGE_SETTINGS`. |
| Role precedence | `model/domain.ts:getDomainUser` applies guest/profile/join, forced root, then default. Blog omits join and uses `PRIV_EDIT_SYSTEM`, intentionally. |
| Root and defaults | `model/builtin.ts`, `packages/common/permission.ts`: built-in guest/default/root and `PERM_ALL = -1n`. Blog guest/default masks are product-specific. |
| Ownership | `handler/discussion.ts:postUpdate/postDelete` strictly selects self versus others; adopt that pattern rather than problem management's own-or-global alternative. |
| Role operations | New roles inherit default; built-ins cannot be deleted; deleted-role users fall back to default. |
| Matrix | Root edits are ignored; unchecked editable roles save zero. Validate actual bits and preserve the empty-column marker semantics. |
| Sudo | Role/permission/user GETs, permission saves, role deletion and user assignment require sudo. Role-creation POST has no extra sudo decorator. |
| Role names | `framework/framework/validator.ts:Types.Role` performs trim/SASLprep and accepts word/Chinese characters; reuse it. |
| Assignment persistence | Installed domain bulk assignment uses `updateMany` upsert; pinned upstream fixes this with individual bulk upserts. Use per-user upserts in the addon. |

Domain ownership, domain joining/kicking, and domain-user permissions do not apply
to this global subsystem. Only the role/permission design and applicable UX
controls are reused, not membership operations. No grant-subset or self-assignment prohibition is added.
Root/default/guest remain visible in the permission matrix, not as guest/default
groups in the user list.

### Latest Clarification: No Blog Membership

The maintainer clarified that guest represents unauthenticated users, not a role
that can be assigned to registered users. Remove the separate removal control and
its confirmation flow. Use "Assign User Roles" instead of "Add User" so the UI
does not imply enrollment. All three assignment controls share the same filtered
role list; the model rejects guest assignment for both single and bulk requests.
Keep guest in the permission matrix for configuring anonymous access, and retain
default as the way to clear an explicit assignment.

Verification: `yarn lint --fix` and `yarn test:coverage` passed with 97 UT.
The focused E2E command
`yarn test:e2e --grep 'global settings role|native role controls|guest policy'`
passed all six cases (three logins and three business scenarios), recorded under
ignored `test-results/hydro-blog-85450-7449407c/`. Tests cover all three role
selectors, rejection of single/bulk guest assignment without writes, assignment
reset through default, and retained anonymous permission configuration.
MCP confirmed the removed control and filtered assignment dialog. At the
maintainer's request, all earlier owned manual instances and their disposable
databases were stopped and cleaned up, then one fresh instance was started on
port 8888 with the latest code and fixture accounts. MCP verified the fresh
instance's role chooser and both guest-assignment API rejections (403).
No CI or standalone type-check result is claimed for this correction.

### Permission Matrix Role Order

Status: Completed locally. Match `DomainModel.getRoles` at the pinned Hydro revision:
enumerate explicitly configured roles in dictionary order, then append missing
built-ins (`guest`, `default`, `root`). Root remains a read-only fallback column.
This is not alphabetical sorting or a permanent custom-first partition: saving
guest/default explicitly places them before custom roles created afterwards.

The optional `permissionRoleOrder` field records configuration order using stable
role IDs. Rendering applies JavaScript dictionary enumeration to role names,
including integer-like names. Creation, permission saves and deletion maintain the
order; masks and user assignments are unchanged. Legacy settings lacking ordering
metadata retain the existing custom-role order and use builtin fallback order;
their previous explicit builtin-configuration history cannot be recovered.

Hydro's `getRoles` also supplies domain permission masks, so it is not invoked with
a fabricated domain just for ordering. The addon mirrors its enumeration with
the blog's own masks and leaves other role-list/assignment controls unchanged.

Verification passed lint, 99 UT, and the focused role-management E2E scenario
plus three authentication cases. Browser evidence is under ignored
`test-results/hydro-blog-93773-2f3693e6/`. MCP confirmed the native first-save
transition from custom/guest/default/root to custom/default/guest/root when guest
has no checked permissions and is submitted after default. Evidence is captured
in `.playwright-mcp/blog-matrix-role-order.png`.
The temporary MCP instance was stopped and cleaned up; the existing manual
instance was not restarted to preserve its data and needs a reload for this
backend rendering change. No CI or standalone type-check result is claimed.

Source review is not runtime verification. Input validation, revision checks and
consistent role deletion are addon safeguards, not upstream guarantee claims.

## Permission Catalog

Use stable append-only BigInt bits and decimal-string persistence, separate from
Hydro domain permission masks. Do not modify `user.role`, `user.perm` or global
privileges. There are 18 initial permissions:

| Group | Keys | Default |
| --- | --- | --- |
| Access | `ACCESS`, `VIEW_PUBLISHED` | Both |
| Drafts | `VIEW_DRAFT_OWN`, `VIEW_DRAFT_OTHERS` | Own |
| Creation | `CREATE_OWN`, `CREATE_OTHERS` | Own |
| Editing | `EDIT_OWN`, `EDIT_OTHERS` | Own |
| Publication | `PUBLISH_OWN`, `PUBLISH_OTHERS` | Own |
| Withdrawal | `UNPUBLISH_OWN`, `UNPUBLISH_OTHERS` | Own |
| Organization | `PIN_OWN`, `PIN_OTHERS` | Own |
| Deletion | `DELETE_OWN`, `DELETE_OTHERS` | Own |
| Interaction | `STAR` | Yes |
| Management | `MANAGE_SETTINGS` | No |

`ACCESS` is a prerequisite. Readability and authentication are separate
prerequisites. `OTHERS` never substitutes for a missing `OWN` permission.
Root automatically includes future bits; existing configurable roles do not.

## Implementation

1. Retain this plan and index it.
2. Add centralized policy and global settings/assignment persistence with focused UT.
3. Enforce policy on every existing route, query and mutation, with handler regressions.
4. Add settings handlers, validation, sudo, role CRUD, matrix updates and assignments.
5. Add native-style settings pages, capability-aware controls, frontend integration
   and translations.
6. Extend isolated real-Hydro E2E and inspect with the declared Playwright MCP.
7. Update behavior, structure and testing documentation with delivered evidence.

Steps 3 and 4 depend on 2; UI depends on both; verification precedes final delivery
documentation.

### Routes and Persistence

Register `/blog/settings`, `/blog/settings/roles`,
`/blog/settings/permissions`, and `/blog/settings/users` before `/blog/:uid`.
All require access and settings management. The overview has no extra sudo;
the other management GETs and sensitive POSTs follow the table above.

Use blog-only `noCheckPermView` to prevent current-domain view permissions from
gating blog routes. Preserve unknown-domain errors, global authentication, CSRF,
rate limits and blacklist handling. Use blog errors rather than domain-join errors.

Keep a global configuration document and explicit per-user assignments, without
eagerly materializing default users. Use revision-checked configuration writes and
immutable role identities if needed to prevent deleted assignments from reviving.
Resolve policy per request without a process cache. Paginate user lists, correctly
include forced root and deduplicate it against explicit assignments.

Ignore submitted root permission edits. Reject unknown roles/bits/users, duplicate
names including zero-mask roles, and invalid input before mutations. Audit all
settings changes without secrets. Do not claim atomic multi-write audit rollback.

### Article Operations

Home remains published-only. Author lists filter readable documents before
pagination. Detail/editor/JSON checks precede counters or other side effects.
Anonymous reads never produce shared UID-zero status.

Create defaults to draft when omitted. Published creation also needs publish;
initial pinning needs pin. Updates preserve omitted fields, compare actual changes,
and reject unauthorized explicit changes. Editing public content requires edit and
publish; draft content needs edit. Publish/unpublish, pin and delete remain usable
without edit permission through independent actions on readable articles.
Mixed changes require all relevant permissions before writes.

Preserve publication timestamps, validators, creation rate limits, operation logs,
status cleanup, sorting and pagination. Prevent stale publication-sensitive writes
from bypassing policy with conditional updates.

### UI and Future Review

Use blog-owned templates extending Hydro layouts and form macros, its table/menu
classes, dialogs, notifications and user selector. Native navigation/profile
changes use `injectUI` or documented frontend page injection, not template overrides.
Render server-derived capabilities consistently; no user-zero create/my-blog links.
Preserve English, Simplified Chinese, Traditional Chinese and Korean locales.

Future review permissions can extend the catalog and action-policy boundary.
Do not add inactive review checkboxes, queues, pending/rejected states, snapshots,
notifications or a moderation bypass in this delivery. Do not reuse draft as a
review state.

## Acceptance and Verification

UT must cover effective roles, forced/manual root, empty masks, strict own/others,
single management authority, exact sudo boundaries, role CRUD/fallback/recreation,
matrix validation, filtering/counts, state-aware mutation checks, stale writes and
denials before side effects.

Real-Hydro E2E must exercise management through actual forms/sudo; delegated
managers; role changes taking effect on subsequent requests; private draft links;
denied live-content edits; independent delete/pin/publish/withdraw actions;
guest reading without anonymous writes; default/guest list exclusion and user
assignment; persistent changes; and identical behavior through domains with
different membership/permissions while ordinary domain routes remain unchanged.

Run relevant lint, UT and existing/new E2E using the existing disposable runtime.
Use local Hydro/Playwright and only disposable MongoDB in Docker. MCP verifies
changed UI, including English/Chinese and narrow-screen rendering. Record actual
evidence separately from proposed coverage; there is no supported dedicated
TypeScript-check command. Never claim CI success without a current run.

## Delivery Record

Implemented the policy catalog, global settings and assignments, all four settings
routes, native-style management UI, article authorization and independent actions,
translations, and retained documentation. The user list excludes default/guest
before pagination and includes forced root. Article storage and domain permissions
remain unchanged.

Hydro's domain role model cannot be reused as the persistence authority because
it is domain-scoped and applies membership semantics. The addon instead uses
Hydro's database service, validators, user model, framework errors, sudo, operation
logs, layout/form macros, navigation injection and exposed user selector. The
TypeScript configuration enables JSX analysis to consume that exposed TSX
component's types; no new UI dependency or copied selector is introduced.

Local verification on November 6, 2026:

| Check | Result |
| --- | --- |
| `yarn lint` | Passed. |
| `yarn test:coverage` | 92 tests passed in four files. Coverage includes article and permission/settings modules. |
| `yarn test:e2e` | All 15 cases passed: three real logins and twelve business scenarios. |
| Playwright MCP | Real login/sudo, native user selection and manual root assignment, root-only matrix controls, 18 permission rows, Chinese settings through the restricted domain, and 390px layout without document overflow. No console errors on checked settings pages. |
| Resource cleanup | Browser closed; owned Hydro/MongoDB runtime stopped and temporary storage removed. |

Final automated browser evidence is under the ignored
`test-results/hydro-blog-42952-5c37d1af/` directory. MCP evidence is under ignored
`.playwright-mcp/`, including `blog-permissions-mobile.png`; its isolated runtime
record is `test-results/hydro-blog-38269-a0090add/`.

Browser verification caught and fixed an unchecked-checkbox regression: native
Hydro forms omit unchecked controls, so explicit presence markers now distinguish
unchecking from an omitted update field. Checked article writes also advance their
timestamp to prevent same-millisecond compare-and-set collisions.

No CI run or standalone type-check result is claimed; the repository still has
no supported dedicated type-check command. This evidence is not exhaustive
concurrency, deployment-version, large-directory performance, or all-locale
coverage. English and Simplified Chinese received manual UI checks; Korean uses
Hydro's actual `ko` locale identifier, and Traditional Chinese/Korean translations
were not separately browser-verified.

For maintainer verification, start `yarn dev` to create a separate disposable
instance with the author, viewer and system-editor fixture accounts. The editor
can manage roles at `/blog/settings`; account details are printed by the launcher.
Stopping the launcher removes this instance's temporary database and storage.
