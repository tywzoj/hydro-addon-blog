# Global Blog Settings and Permissions

Status: Completed locally; maintainer manual verification pending. No moderation workflow is included.

## Goal and Confirmed Decisions

Provide one installation-wide blog settings area, independent of Hydro domains.
Keep articles in the existing system-domain document type 70.

- Unassigned authenticated users use `default`; anonymous users use `guest`.
- `PRIV_EDIT_SYSTEM` forces `root`. Explicit root assignments are also supported.
- Guest starts with no access, but administrators may configure any guest permission.
  Writes still require an authenticated profile; sensitive management actions use sudo.
- One `MANAGE_SETTINGS` permission controls all settings operations. Managers may
  assign root or grant permissions they do not themselves possess.
- Root has the immutable `-1n` mask. Root/default/guest cannot be deleted.
- Custom roles inherit the current default mask. Deleting a custom role returns
  its members to default without resurrecting assignments when its name is reused.
- User-role lists show only effective root/custom-role users, filtering before
  counting and pagination. User lookup still finds default/guest users for assignment.
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
to this global subsystem. Explicit guest assignment replaces the domain-specific
kick/join presentation. No grant-subset or self-assignment prohibition is added.
Root/default/guest remain visible in the permission matrix, not as guest/default
groups in the user list.

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
