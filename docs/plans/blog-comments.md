# Blog Comments and Permission Matrix

Status: Completed locally. Implemented after item-by-item comparison with
official Hydro and user confirmation, on `users/antares/blog-comments`.

## Goal

Add blog comments modeled on Hydro's native discussion workflow while retaining
this addon's global roles, domain-independent storage, article visibility, and
native UI conventions. Both comment levels support posting, replies, likes,
unlikes, and authorized deletion. Comments are immutable after posting.
Do not implement editing, locking, history, or raw-content editing endpoints.

This document retains the confirmed design and is the durable planning source
of truth. Implementation, commits, and pull-request CI verification are
authorized. Merging is not authorized.

## Confirmed Decisions

- Support top-level comments and one embedded level of replies, Markdown,
  native comment interactions, and top-level pagination.
- Match the official deletion branches exactly, including their different
  handling of top-level comments and nested replies. An article author's
  moderation grant applies only to top-level comments.
- Both levels are immutable after creation. Remove the earlier proposals for
  editing, history, raw editing endpoints, and locking.
- Replace generic reactions with one like/unlike button on BOTH levels.
  Existing replies do not prevent further replies, likes, or unlikes.
  Keep authorized delete controls. Articles retain their existing star feature
  and gain no like/reaction feature.
- Posting permission also grants liking/unliking. Do not add a separate like
  permission or comment-reading permission.
- Keep official mention/moderator-deletion notification recipients, content,
  ordering, and cascade scope. Record deletion audit events only.
- Allow new comments/replies only on published articles. Withdrawing an article
  preserves comments; authorized draft readers can still view them and delete
  according to their deletion permissions. Drafts reject new comments/replies,
  likes, AND unlikes.
- Comment operations must not change article `updateAt` or `firstPublishAt`.
  Do not add a separate comment activity timestamp or activity-sort option.
- There is no historical embedded comment data requiring preservation. No
  legacy comment migration or dual-storage compatibility layer is requested.
- Use the native pagination presentation: top-level comments newest first;
  nested replies remain in their native embedded insertion order and are shown
  in full. No nested pagination, artificial cap, or history UI is included.
- Add FOUR permissions to the existing matrix. Comment reading inherits article
  reading. Do not use domain discussion permissions for authorization.
- New installations grant normal comment capabilities to `default`, not global
  moderation. Existing persisted role masks remain unchanged; administrators
  explicitly enable new permissions. `guest` remains empty by default.
- Preserve the existing strict own/others policy for ARTICLES. Comments instead
  follow the explicitly selected official deletion branches, documented below.

## Confirmed Difference Register

This register records the final answers, including decisions that supersede
the first draft. "Keep official" is an explicit choice, not a missing decision.

| Item | Official behavior or existing baseline | Confirmed blog decision |
| --- | --- | --- |
| D01 Editing | Authors with the corresponding grant may edit both levels. | No editing, including for root. |
| D02 History/raw | Creation records an initial version; edits add history; raw/history endpoints exist. | No history storage, history UI, or raw editing endpoint. |
| D03 Locking | Topics may be locked to block new replies. | No lock field, permission, control, or operation. |
| D04 Draft lifecycle | Discussion lacks this blog publication/withdrawal lifecycle. | New comments, replies, likes, and unlikes require publication. Draft readers may view; authorized users may delete. |
| D05 Activity time | New replies update discussion `updateAt`. | Preserve article timestamps and add NO independent activity timestamp. |
| D06 Reactions | Topics and top-level comments have multi-emoji reactions; nested replies do not. | One like/unlike interaction on both comment levels; article remains star-only. |
| D07 Read/like grants | Discussion reading covers comments; reaction has a separate grant. | Reading inherits article reading; liking/unliking shares the posting grant. |
| D08 Author moderation | Own-topic moderation applies to top-level comments, not nested replies. | Keep official asymmetry; do not extend the grant to nested replies. |
| D09 Delete fallback | Top-level and nested branches have different management fallbacks. | Keep official branches exactly; do not apply the article strict-own policy to comments. |
| D10 Global scope | Discussions use their domain's data and roles. | Use system-domain blog data and global blog roles across domain-prefixed URLs. |
| D11 Matrix/defaults | Native discussion has additional edit/lock/reaction grants. | Four new matrix rows; fresh default gets posting, own deletion, own-article top-level moderation; guest remains empty. |
| D12 Existing roles | Blog settings already store explicit role masks. | Do not grant new bits to existing non-root roles; root remains all-permissions. |
| D13 Storage | Native discussion uses separate top-level reply documents and embedded tails. | Retain that structure in shared `document`, with an independent blog comment type and DocumentModel wrappers. |
| D14 Legacy helper | Existing blog helper embeds top-level replies in the article. | Replace that path; no migration/dual-read layer because no historical comments need preservation. Do not silently erase unexpected data. |
| D15 UI | Native macro assumes domain permissions, discussion routes, editing/history, and emoji controls. | Thin blog template adapter; reuse native editor/reply/delete behavior; add a small two-level like controller. |
| D16 Pagination | `pagination.reply` controls top-level page size; tails are embedded and shown in full. | Keep official behavior, including newest-first top-level order; do not hardcode a 50-row page size or add tail pagination. |
| D17 Rate bucket | Discussion creation and its replies share `add_discussion`. | Independent blog-comment creation bucket, shared by both levels, with the native `3600, 60` call and framework overrides/bypasses. No new like-specific quota. |
| D18 Mention recipients | Existing mentioned users are deduplicated and notified without a per-recipient readability filter. | Keep official behavior; do not introduce recipient policy filtering. |
| D19 Notification order | Mentions are sent before insertion; deletion, notification, and audit run concurrently. | Keep official ordering rather than persistence-first ordering. |
| D20 Deletion notices | Notices contain a short content excerpt, topic title, and link; self-deletion is not notified; top-level cascade targets only its author. | Keep content and recipient scope; adapt wording/URLs to blogs without readership-based redaction. No comment-notification fan-out on article deletion. |
| D21 Audit | Comment creation/reactions have no matching operation-log entry; deletion does. | Log top-level/nested deletion only; no create/like/unlike audit events. |
| D22 Like protocol | Reaction accepts emoji/type/id/reverse. | Dedicated desired-state like operation with top-level ID and optional nested ID; repeated same-state requests do not double count. |
| D23 Target binding | Parent-chain checks vary among native operations. | Uniformly validate URL author, article, top-level comment, and optional nested reply before any operation side effects. |
| D24 Cleanup/failures | Native multi-step writes are not a transaction. | Clean both levels' like states, guard repeated deletion/count updates, propagate genuine failures; no transaction, queue, background compensation, rollback, or exactly-once promise. |

Superseded proposals must NOT be implemented: six/nine comment grants,
`VIEW_COMMENT`, independent reaction permission, two-level article-author
moderation, strict-self deletion at both levels, `commentUpdatedAt`,
generic emoji reactions, recipient-readability filtering, notice redaction,
persistence-first notifications, or creation audit logs.

## Source Investigation and Baseline

### Local addon

Inspected addon revision: `15e07b19b3cc91a023bce20edea2af7f2df5fd90`.
The working tree was clean at investigation start.

| Area | Observed implementation | Consequence |
| --- | --- | --- |
| `features/model.ts` | Blog documents use system domain/type 70. `addReply` pushes into the article's `reply` array and updates its counter and article timestamp. | Replace the unused embedded top-level write path; do not extend it into the new design. |
| `features/types.ts` | `BlogReplyDoc` is an embedded shape; `BlogDoc` includes `nReply` and `reply`. | Define separate top-level comment, embedded reply, and like-status contracts. |
| `features/handler.ts`, `handler.base.ts` | Detail GET checks readability and tracks views; detail POST currently supports stars. URL author must match the article. | Extend the existing detail contract without weakening visibility, identity, or star behavior. |
| `templates/blog_detail.html` | No comment section exists. | Add a blog-owned comment partial without overriding Hydro templates globally. |
| `features/constants.ts`, `permission.ts` | Seventeen stable article/settings permission bits; strict article own/others selection; root mask is `-1`. | Append four bits, preserve all existing values/indices and article semantics, and introduce a comment family. |
| `features/settings.model.ts` | Initial settings are inserted only when absent; persisted masks are strings; roles and revisions already exist. | New defaults affect new installations only; no permission backfill is needed. |
| `features/settings.handler.ts`, `templates/blog_settings_permissions.html` | Catalog-driven matrix with role columns, family grouping, placeholder handling, sudo, revision checks, and audit. | Extend the catalog and labels rather than adding a second permission screen. |
| Tests | Vitest and real-Hydro Playwright infrastructure already exist. | Extend current fixtures and suites, with focused comment tests. |

Specific coupled tests: `tests/unit/model.test.ts` currently expects the old
embedded reply/timestamp behavior; `tests/unit/settings.test.ts` treats index
`17` as invalid; `tests/e2e/permissions.spec.ts` expects seventeen matrix rows.
Update these expectations alongside actual behavioral coverage.

### Official Hydro evidence

Pinned upstream revision:
`hydro-dev/Hydro@3c8286dd1350fcd00412e95d5b056dbfed64edda`.

Installed packages inspected: `hydrooj@5.0.7` and
`@hydrooj/ui-default@4.58.5`, within the manifest's declared ranges.
The installed discussion handler/model, comment macro, comment controller, and
CommentBox match the pinned official source byte-for-byte. The inspected
`document.ts` difference is an unrelated `contestTeam` index.

| Official path | Evidence used |
| --- | --- |
| `packages/hydrooj/src/model/discussion.ts` | Separate top-level reply documents, embedded tail replies, newest-first top-level query, counters, reactions, and cascade behavior. |
| `packages/hydrooj/src/handler/discussion.ts` | Request operations, parameter validation, parent relationships, rate limiting, user batching, mentions, and moderation notifications. |
| `packages/hydrooj/src/model/document.ts` | Document/subdocument/status operations and their actual filtering, upsert, and failure semantics. |
| `packages/common/permission.ts` | Independent discussion reply, self-deletion, moderator-deletion, own-topic moderation, and reaction grants. |
| `packages/hydrooj/src/handler/domain.ts` | Native role-matrix save workflow, sudo, root protection, and unchecked-column placeholder. |
| `packages/ui-default/templates/domain_permission.html` | Role columns, grouped permission rows, native checkbox/range controls. |
| `packages/ui-default/templates/discussion_detail.html` | Comment section, count, pagination, and macro wiring. |
| `packages/ui-default/templates/components/comments_discussion.html` | Comment DOM/data contracts; hardcoded domain permission checks and discussion raw/history routes. |
| `packages/ui-default/components/discussion/comments.page.tsx`, `CommentBox.js` | Autoloaded editor/reply/delete behavior, mention insertion, POST payloads, and reload behavior. |
| `packages/ui-default/components/discussion/reaction.page.tsx` | `nodeType`, `id`, `emoji`, `reverse` requests and `{ doc, sdoc }` responses. |
| `packages/hydrooj/src/model/message.ts` | Rich-text/unread message API and multi-step delivery side effects. |

Official reference URL pattern:
`https://github.com/hydro-dev/Hydro/blob/3c8286dd1350fcd00412e95d5b056dbfed64edda/<path>`.

Official documentation references:
`https://docs.hydro.ac/zh/docs/Hydro`,
`https://docs.hydro.ac/zh/docs/Hydro/dev/typescript`, and
`https://hydro.js.org/docs/Hydro/system/frontend-modify`.

The official discussion model hardcodes discussion document types and parent
updates, so it cannot be called unchanged for blog comments. Reuse compatible
DocumentModel primitives with blog-scoped wrappers instead.

The native macro hardcodes domain permissions and discussion-specific routes.
A small blog-owned template adapter is justified; it must retain native markup,
styles, editor, reply, and confirmation behavior. Do not spoof
`user.hasPerm`, modify domain roles, replace upstream templates, or copy the
native JavaScript controllers. A small addon-owned like controller is necessary
because the selected two-level, single-like behavior differs from the native
multi-emoji controller.

The native history renderer requires a discussion-specific Markdown hook, but
history was explicitly removed from this feature. Do not implement that hook.

## Permission Design

Append these entries after the existing seventeen permissions. Names below are
the proposed implementation names; their semantics and stable bit allocation
are the contract.

| Permission | Bit | Meaning |
| --- | --- | --- |
| `CREATE_COMMENT` | 17 | Publish either comment level and like/unlike either level on a published article. |
| `DELETE_COMMENT_OWN` | 18 | Delete one's own top-level comments or nested replies. |
| `DELETE_COMMENT` | 19 | Global comment deletion grant, subject to the exact native branches below; not a universal top-level self-deletion override. |
| `DELETE_COMMENT_IN_OWN_POST` | 20 | Delete top-level comments on one's own article, including a self-authored top-level comment; does not apply to nested replies. |

The resulting matrix has 21 permission rows. Put the new rows in a translated
`Blog comments` family; preserve article/settings groups, configured role order,
root-last placement, sudo, stale-save rejection, and whole-column clearing.
Labels must explain that posting also enables likes and that own-article
moderation covers top-level comments only. Do not label the global grant as
a strict "others-only" grant.

Common gates:

1. Require blog access and current article readability.
2. Article readability is sufficient to read comments; there is no extra grant.
3. Require an authenticated profile for all mutations, regardless of guest masks.
4. Require the operation-specific permission and a verified target chain.
5. Creation AND like/unlike require publication and `CREATE_COMMENT`.
   Deletion requires its own applicable grant, not `CREATE_COMMENT`.

Exact deletion policy (after the common gates):

- Top-level comment: first allow an article owner with
  `DELETE_COMMENT_IN_OWN_POST`. Otherwise, if the requester authored the comment,
  require `DELETE_COMMENT_OWN`; otherwise require `DELETE_COMMENT`.
- Nested reply: allow its author with `DELETE_COMMENT_OWN`; otherwise require
  `DELETE_COMMENT`, including when the requester is the reply author but lacks
  the own-deletion grant. Own-article moderation has no effect here.
- Consequently, the global grant alone cannot delete one's own top-level
  comment, but CAN delete one's own nested reply. Preserve this specifically
  confirmed native distinction in both UI controls and server enforcement.
- Article edit/delete permissions and `MANAGE_SETTINGS` do not imply comment
  moderation. Root's all-bits mask satisfies the explicit policy.
- Nobody, including root, receives an edit or lock operation.
- Use explicit comment policy helpers. Do not change the generic strict
  own/others article policy to implement these comment-specific branches.

Fresh `default` receives all new permissions except `DELETE_COMMENT`.
Fresh `guest` remains empty; explicit guest reading is possible with access
and article-read grants. Guest mutations remain forbidden even if a comment
permission is configured. Root remains immutable and all-permissions.
Existing non-root masks remain untouched, including an existing default role.
New custom roles continue copying the currently configured default role.

## Persistence and Lifecycle

Use the shared `document` collection and `SYSTEM_DOMAIN`, with an addon-specific
`TYPE_BLOG_COMMENT` (proposed value 71; verify registration availability before
implementation). Never reuse `TYPE_DISCUSSION_REPLY` for blog data.

Top-level comments contain normal document identity/ownership, content and IP,
`parentType: TYPE_BLOG`, `parentId: article.docId`, an optional embedded `reply`
array, and a like count. Nested replies contain `_id`, owner, content,
IP, and a like count; they cannot contain further replies. Replying to a nested
reply posts into the same top-level thread with native mention insertion.

Use document-status records scoped to the new comment type for per-user
like state, keyed by the target top-level or nested ID and user ID. Include
article/top-level linkage where needed for efficient scoped cleanup; nested
reply status must not be confused with its parent's status. Likes on the two
levels are independent. Public responses need content and display state, not
stored IPs or other users' private status records.

Add only necessary comment-scoped indexes, principally parent lookup plus
descending comment ID. Reuse existing document/status identity indexes where
sufficient. Never broaden existing article partial indexes to unrelated types.

`nReply` counts top-level comments, not nested replies. Use the paginated
comment query's count for displayed totals. Maintain stored article counts
only after a confirmed insertion/deletion; repeated deletion must not decrement
again. Do not call the article edit path or write any activity timestamp for
comment, reply, like, unlike, or comment-deletion operations. Missing arrays
and count/status fields must render safely as empty/zero/unliked.

Replace/remove the legacy embedded `BlogModel.addReply` implementation so no
remaining addon call writes a competing top-level format. Do not silently erase
unexpected legacy data or run an unrequested migration.

Deleting a top-level comment removes its nested replies and all their like
statuses. Deleting a nested reply removes only that reply and its like statuses,
preserving its parent and siblings. Both article deletion paths (`del` and
`deleteChecked`) must clean comment documents and statuses
without changing the existing checked article-delete semantics.

### Failure and concurrency boundaries

- Revalidate parent identity and mutation preconditions at the write boundary;
  never use an upserting content update that could recreate a deleted parent.
- Check matched/deleted results before counter changes. Notification ordering
  is explicitly the native ordering below, not persistence-first.
- Exercise simultaneous/repeated deletion and repeated like/unlike requests, not
  only sequential happy paths.
- Handle create-versus-article-delete and reply-versus-comment-delete races with
  a post-write parent check and scoped compensation/cleanup when necessary.
  Do not leave a successful response for an orphaned write.
- Preserve per-user desired-state semantics for likes. An initial unlike and
  repeating an existing state are no-ops, not decrements/increments.
  Inspect the native status helper's catch-all error handling before reuse;
  genuine persistence
  failures must not be reported as a successful no-op. Catch only identified
  duplicate-state conflicts in a blog adapter if that is necessary.
- Follow the confirmed native notification/audit execution order. Await required
  promises and expose failures; do not silently claim complete success.
  Record that a notification, audit entry, or persistence step may already have
  succeeded. Do not automatically retry the whole operation and duplicate messages.
- No distributed transaction, replica-set requirement, delivery queue, or
  crash-safe exactly-once claim is included. The existing environment uses
  standalone disposable MongoDB. Document residual multi-document partial-failure
  limitations rather than claiming atomic counters, cascades, likes, and messages.

## Handler and UI Contracts

Keep comment mutations on the blog detail URL using Hydro's operation dispatch:

| Operation | Input | Result |
| --- | --- | --- |
| `reply` | Validated content | Create top-level comment; native-compatible result containing `drid`. |
| `tail_reply` | `drid`, validated content | Append a nested reply to a verified comment. |
| `delete_reply` | `drid` | Authorized cascade deletion after native confirmation. |
| `delete_tail_reply` | `drid`, `drrid` | Authorized nested deletion. |
| `like` | `drid`, optional `drrid`, required `liked` Boolean | Set the requesting user's target state; return target identity, resulting like count, and own liked state. |

Do not register edit, lock, raw, or history endpoints. Forged edit/lock
operations must fail without mutation. Do not accept the generic `reaction`
operation or arbitrary emoji input as an alternative liking path.

Every target-bearing request must verify system domain, blog comment type,
article parent type/ID, and nested reply membership. Apply these checks to likes
as well as replies/deletes; never accept an arbitrary document ID.
Keep exact URL-author checks and apply readability before querying comment data,
status side effects, or returning content. A request using an article-A URL
with article-B's comment must fail without writes or messages, even if the
requester could separately access both articles.

Extend detail GET with positive-page validation, top-level comment pagination,
page count/total, batched author lookup (including nested authors), current-user
like state for both levels, and server-derived controls. Use the native reply pagination
setting, whose inspected default is 50; avoid making global blog behavior depend
on the currently visited domain's permission or data scope. Keep navigation
domain-aware while resolving identities and data in the system domain.

Use `Types.Content`, `Types.ObjectId`, positive-page and required-Boolean
validation, preserving explicit JSON `false`/`0` handling and the existing
content-validator patch. Use a separate centralized blog-comment creation rate
bucket modeled on the official `3600, 60` call, shared by top-level and nested
creation rather than consuming article-creation or official-discussion quota.
Keep framework limit-key behavior, configuration overrides, and unlimited-access
privilege bypass. Likes/unlikes use existing global limiting, without a new
feature-specific quota.

Add `templates/partials/blog_comments.html` to render native DOM contracts with
blog policy booleans. Reuse the native Markdown renderer, user displays,
timestamps, paginator, empty state, CommentBox, and delete confirmation.
Add a small `frontend/blog-comments.page.ts` controller for two-level
like/unlike requests and state/count feedback, using existing Hydro request,
notification, icon, and button patterns. Do not emit the native emoji-menu hooks
or edit/history/lock controls and raw URLs.

Keep the hidden native editor/reply template available for users who may reply.
Provide readable comments and valid moderation controls when creation is denied
or the article is a draft. Such users cannot invoke like/unlike. Existing like
counts/state remain visible without an actionable control. Having replies never
disables an otherwise authorized reply or like/unlike action.

Browser verification must prove that the installed AutoloadPages initialize on
the blog detail page; do not reimplement those native controllers. The dedicated
like controller is an intentional adaptation, not a fallback for failed emoji
initialization. No frontend framework, CSS redesign, or dependency upgrade is planned.

## Notifications and Audit

Use Hydro's established mention syntax and MessageModel rich-text/unread API.
Extract and deduplicate existing user targets from new top-level/nested content.
Resolve identities in the system domain. Notify all existing mentioned users
as the native handler does, without a recipient-readability filter.
Do not add author/subscription notifications or new self-mention filtering.

Keep native ordering: after request validation/access checks and rate limiting,
send mentions BEFORE inserting a new comment/reply. For authorized deletion,
start deletion, any applicable moderation message, and deletion audit together
as in the official handler and await all required work. This intentionally
differs from the existing article/settings audit-after-persistence convention;
do not refactor those unrelated paths.

For deletion by somebody other than the target's author, notify that author.
Match native cascade scope: deleting a top-level comment sends a notice for that
top-level target, not a notification storm to
every embedded-reply author. Self-deletion sends no moderation notice. Deleting
an entire article does not fan out comment-deletion messages.

Generate proper blog links instead of discussion URLs or blindly concatenating
domain prefixes. Preserve native deletion-notice content: actor information,
short deleted-content excerpt, article title, and link. Do not redact based on
the recipient's current readability. The link still enforces current access;
the message is not a content-recovery endpoint. Translate blog-specific wording.

Centralize deletion audit event names for the two levels. Do NOT add creation,
like, or unlike operation logs. Test native ordering, recipients, and payloads,
including partial failures: failed persistence may follow an already sent mention,
and concurrent deletion work may partially succeed. No rollback or guaranteed
exactly-once message delivery is promised.

## Implementation Work and Dependencies

| ID | Work | Prerequisites |
| --- | --- | --- |
| `comment-contracts` | Add types, constants, four stable permission bits, permission family, labels/defaults, and exact native deletion helpers. | None |
| `comment-persistence` | Implement blog-scoped comment/reply/two-level-like storage, scoped indexes, counters without activity timestamps, and both article-delete cleanup paths. | `comment-contracts` |
| `comment-handlers` | Add detail loading and five operations with validation, access/ownership checks, rate limiting, notifications, and audit. | `comment-contracts`, `comment-persistence` |
| `comment-ui` | Add native-compatible comment partial, two-level like controller, and detail/matrix presentation, without edit/lock/history/emoji-menu surfaces. | `comment-contracts`, `comment-handlers` |
| `comment-unit-tests` | Extend model/handler/policy/settings tests and fixtures; add focused comment suites if existing files become unwieldy. | `comment-persistence`, `comment-handlers` |
| `comment-e2e` | Add real browser/persistence comment and matrix regressions using isolated runtime; perform declared Playwright MCP checks. | `comment-ui`, `comment-unit-tests` |
| `comment-delivery` | Run applicable checks, inspect final diff, update behavior/testing/structure/plan docs, and record actual evidence and missing checks. | `comment-unit-tests`, `comment-e2e` |

Expected implementation surfaces:
`features/constants.ts`, `types.ts`, `permission.ts`, `model.ts`, `handler.ts`,
`handler.base.ts`, `i18n.ts`, `index.ts`; focused
`features/comments.model.ts` and `features/comments.handler.ts` if needed to
keep article code cohesive; `templates/blog_detail.html`,
`templates/partials/blog_comments.html`, `frontend/blog-comments.page.ts`,
and the existing permission matrix.
Reuse settings persistence/parser unless a specific required change is proven.

Test surfaces: `tests/helpers/hydro.ts`, fixture types, existing
model/handler/permission/settings tests, a focused comment suite,
`tests/e2e/comments.spec.ts`, and affected permission E2E cases.
Extend `vitest.config.mjs` coverage inclusion when adding comment logic files.
Do not introduce a new test harness.

## Acceptance and Verification

### Policy and settings UT

- The four new grants round-trip through the real matrix parser and stored masks.
  Unknown indices still fail; index 17 is no longer an invalid-input fixture.
- Existing permission meanings/indices remain stable; root cannot be changed;
  all-unchecked columns save zero; stale matrix saves still fail.
- Fresh defaults include normal commenting but not global deletion; old role
  masks and assignments are unchanged.
- Test guest authentication gates, missing access/article-read, posting/liking
  sharing one grant, and all exact native deletion branches. In particular:
  own-article management can remove a self-authored top-level comment but cannot
  remove a nested reply; the global deletion grant cannot replace own deletion
  for a self-authored top-level comment but CAN for a self-authored nested reply.
- A user without `CREATE_COMMENT` can still read comments and perform separately
  authorized deletion; existing article own/others semantics remain unchanged.
- `MANAGE_SETTINGS` or article ownership alone cannot grant moderation.

### Model and handler UT

- Validate IDs/content/required like state/page before side effects; reject
  nonexistent or mismatched articles, foreign comments, and foreign nested replies.
- Drafts deny creation, likes, and unlikes; reading/deletion follow confirmed policy.
- Deleted/missing parents are not upserted or resurrected.
- Counts reflect top-level creation/deletion only; repeated deletion does not
  decrement twice; no comment operation changes article timestamps or adds an
  activity timestamp.
- Cascade cleanup covers comment statuses and both article-delete methods.
- Likes are independent per user AND per target at both levels. Initial unlike,
  repeated desired states, and already-replied-to targets behave correctly.
- Notification targets and payloads follow the native policy without read
  filtering/redaction. Validation/authorization failures precede side effects;
  mention delivery precedes persistence. Test partial failures without falsely
  asserting that every failed write sends no message.
- Deletion audit runs in the confirmed concurrent group. No creation/like audit.
- Forged edit, history/raw, and lock requests expose no supported feature.

### Real Hydro E2E

- Publish an article, comment as another user, add nested and mention replies,
  reload, and verify Markdown, author information, ordering, and persistence.
- Cross a top-level page boundary through normal authenticated writes using
  the isolated profile's configured three-item reply page; do not disable rate
  limiting to seed assertions. Nested replies remain attached to the correct page/thread.
- Use native confirmation to cancel/complete own and moderator deletion at both
  levels; verify sibling preservation, cascade deletion, and like-status cleanup.
- Like/unlike both levels as distinct users; verify repeat desired-state requests,
  initial unlike, already-replied-to targets, and reloaded count/self state.
- Verify immutable content: no edit controls, no raw/history UI, and direct edit
  operations denied even to root. Verify no locking controls or accepted API.
- Withdraw/republish articles; comments survive, new posts are denied on drafts,
  likes/unlikes are also denied, unauthorized draft requests expose no comments,
  and timestamp/sort invariants remain intact with no added activity field.
- Change each relevant matrix grant using actual sudo/settings forms; confirm
  persistence, control visibility, server denial, the exact asymmetric native
  deletion branches, and separation from article/settings rights. Verify
  granting/revoking posting affects reply AND both like directions.
- Verify guest reading when explicitly configured, anonymous mutation denial,
  and restricted-domain blog URLs using system-domain identities/data.
- Check delivered mention/moderation notifications through the real message
  model/UI, without session or persistence stubs.
- Exercise concurrent/repeated delete/like cases and creation/deletion races
  against real persistence, separately from mocked UT assertions.
- Deleting an article removes its comment tree/statuses and preserves existing
  article view/star/publication regressions.

### Commands and manual evidence

Run `yarn lint`, focused `yarn test` selectors for changed logic, and
`yarn test:coverage` when verifying the expanded shared-policy coverage.
Run focused `yarn test:e2e --grep ...` cases during iteration; include existing
article/permission flows affected by the new catalog and detail/deletion paths.
Run `yarn typecheck` separately from Vitest transformation and lint; its
[project-source boundary](../validation.md#type-checking) does not certify
upstream implementation sources.

Use local Hydro/Playwright and only a disposable MongoDB container, with the
existing runtime's isolated writable paths. Use the declared Playwright MCP to
inspect Chinese/English labels, narrow layouts, role-specific controls, editor
cancellation/keyboard behavior, notifications, and browser errors. Clean only
run-owned resources. Record automated E2E and MCP evidence separately.

The original planning session performed source analysis only. Implementation
verification and its remaining boundaries are recorded in the delivery section
below; planned assertions are not automatically passing evidence.

## Delivery Record

Implemented on `users/antares/blog-comments` against the pinned source baseline:
four appended permission bits and a 21-row matrix; independent type-71 comments;
native immutable two-level reply/deletion UI; two-level desired-state likes;
native notification ordering and deletion-only audits; scoped indexes and cleanup.
Existing non-root masks remain unchanged and require explicit comment grants
after upgrade. New installations include the normal default comment grants.

The isolated fixture now sets Hydro's existing reply page size to 3 instead of
creating more than 50 comments. This tests configured pagination without changing
rate limits; the default IP-based limiter means changing fixture users alone
would not create independent buckets.

Local verification on 2026-11-06 used Node 24.22.1, Yarn 1.22.22,
Hydro 5.0.7, default UI 4.58.5, Chrome, and run-owned MongoDB.

| Check | Result and evidence |
| --- | --- |
| `yarn lint` | Passed across the repository. |
| `yarn test:coverage` | Passed: 162 tests in five files, including 46 comment-specific UT. Coverage includes both new comment logic files. |
| `yarn test:e2e` | Passed: 27 cases (three authentication and 24 business cases). Final run artifacts: `test-results/hydro-blog-29632-e8c2303c/`. |
| Declared Playwright MCP | Verified real login, Markdown comment/reply submission, both levels' like state/count feedback, English/Chinese labels, 390px layout, focused-editor Esc cancellation, and the four Chinese permission rows with root disabled. |
| MCP console | No errors on the final comment page. An earlier exploratory request to an unsupported preference URL produced a 404, unrelated to comment behavior. |
| Cleanup | MCP page closed; both temporary MCP Hydro runtimes exited normally and cleaned their owned MongoDB/configuration/storage. Automated runs also completed their cleanup. |
| Project-scoped TypeScript check | Added in the subsequent type-check follow-up and passed for 32 project files. See the [scope and evidence](self-validation.md#project-scoped-type-checking); this is not a full upstream-source build. |
| Remote CI | Tracked in the implementation PR's checks and verification summary, scoped to the exact verified commit. The local runs recorded here are not remote CI evidence. |

The browser regressions caught and fixed an initial like-script registration
using a route name instead of the actual `blog_detail` template page name.
Anonymous tests explicitly clear inherited authentication state and check Hydro's
HTTP-200 JSON login handoff plus unchanged data. Existing matrix-order checks
now preserve prior legitimate default/guest configuration rather than assuming
the first matrix save in a fresh process. No production authorization change was
made to accommodate those fixture corrections.

All implementation work items above are complete locally. The retained limits
remain intentional: no cross-document/message transaction or exactly-once
guarantee, no independent pagination for embedded replies, and no deployment-wide
compatibility claim. The initial local delivery did not create a commit or PR.
Subsequent commit and PR verification are recorded on GitHub; merging is not
part of this delivery.

## Non-goals and Known Limits

- No edit, history, raw editing, lock, review/approval workflow, soft-delete
  recovery, subscription system, generic emoji menu, or article reaction feature.
- No independent comment-reading/liking grants, activity timestamp, recipient
  readability filter, notice redaction, creation audit, or persistence-first
  notification sequencing.
- No domain membership/role changes, automatic existing-role grants, legacy
  comment migration, broad refactoring, dependency upgrade, or PR merge.
- Native embedded replies have no application pagination and share a parent
  document's storage limits. This is the explicitly selected native behavior,
  not a claim of unlimited scalability or uniformly bounded response sizes.
- Multi-step database, audit, and message writes are not transactionally atomic.
  Healthy-runtime race/repeat checks do not prove crash-safe exactly-once behavior.
- If implementation requires changing these approved boundaries, amend this
  plan and confirm the changed product behavior before proceeding.
