# Blog Article Review

## Status and Goal

Completed locally. Product decisions and the protocols below were reviewed with
the maintainer against pinned official Hydro source and implemented on
`users/antares/blog-post-review`. Local verification and its explicit limits are
recorded below; this does not claim CI or exhaustive crash/deployment coverage.

Delivery PR: [#11](https://github.com/tywzoj/hydro-addon-blog/pull/11).
Its Checks tab and validation summary record commit-specific CI results;
the local verification records below describe evidence available at each stage.

Add global disabled, pre-publication, and post-publication review modes, reports,
independent review/reset permissions, native notifications, and Oplog records.
Preserve global blog roles, domain independence, existing article permissions,
and unrelated functionality.

This document is the retained project source of truth. Operational task status
is tracked separately.

## Current Baseline

Repository revision: `2f0b6e2a4fe297bfb49df4573ba13e4794fff336`.

| Location | Existing behavior and integration requirement |
| --- | --- |
| `features/constants.ts` | 21 permission bits plus routes, operations, audit events, messages, and defaults. Append new bits without changing persisted masks. |
| `features/settings.model.ts` | Global configuration/roles and revision-checked saves. Existing masks are not automatically augmented; root has an immutable all-permissions mask. |
| `features/model.ts` | System-domain type-70 articles; `draft` controls publication. Checked writes compare `updateAt` and `draft`, but not review versions/counters. |
| `features/handler.ts` | Published creation, content submission, and independent publish are separate paths. All must honor review; pin/delete/withdraw permissions remain independent. |
| `features/permission.ts`, `features/handler.base.ts` | Public/draft readability is enforced before detail/status side effects. Review must not grant unrestricted draft reading or editing. |
| `templates/blog_detail.html` | Report currently links to contact help; no report persistence or review exists. |
| `features/comments.handler.ts` | Native `MessageModel.send` and `OplogModel.log` patterns. Persistence, messages, and audit are separate writes. |
| Tests and runtime scripts | Vitest, scoped type checking, real-Hydro Playwright, and declared MCP exist. The isolated launcher currently passes `--disableWorker`. |

`firstPublishAt` is assigned on actual publication and retained across withdrawal
and republishing. Existing articles without review metadata must preserve their
behavior and legacy timestamp fallback.

## Confirmed Product Decisions

| Topic | Contract |
| --- | --- |
| Scope | Global article review, independent of Hydro domains; no comment review. |
| Defaults | Review disabled; report limit 3; rejection limit 3; reviewer reminders enabled; summary interval 1440 minutes. |
| Configuration | Existing `MANAGE_SETTINGS`, revision checks, and compatible sudo conventions. |
| New permissions | Independent `REVIEW` and `RESET_REVIEW_COUNTERS` entries in the current matrix. They do not grant ordinary edit/publish/settings operations. |
| Self-review | Allowed for reviewers. Root/admin publication is not automatically exempt from review. |
| Reporting eligibility | Authenticated non-author users who can read the current public article. No additional report grant; no anonymous or unpublished-article reports. |
| Report-count visibility | Requires authenticated access and `REVIEW`; authors and reset-only users do not receive counts in HTML or JSON without that grant. Reset authority remains independent. |
| Report deduplication | One accepted report per user per content version, including concurrent/repeated requests. |
| Report count | Accumulates across content versions until approval or authorized force reset. Hide only when count is strictly greater than the limit. |
| Rejection count | Increment once per rejected review across versions. At or above the limit, forbid further publication/submission. |
| Approval | Clears both counters. Only report-review approval exempts the current content version from further reports. |
| Force reset | Clear both counts without publishing, approving, granting immunity, erasing receipt deduplication, removing a pending entry, or clearing an existing review hold. |
| Content version | Title/body changes advance it; pin, views, stars, comments, and review metadata do not. |
| Pending edits | Keep the article queued; invalidate obsolete decisions and review current content. Editing cannot restore report-hidden content. |
| Withdrawal | Explicit authorized withdrawal cancels the queue entry but preserves counts, receipts, and any review hold. |
| Mode changes | A confirmed disabled save approves current pending entries through normal approval, with notices and audit. New reports are disabled and review navigation is hidden. Rejected/held articles outside the queue remain unchanged; other mode changes affect subsequent operations. |
| Resubmission | Only approval clears `requiresReview`. Editing, withdrawal, reset, and disabled mode cannot bypass it. Publishing a held unpublished article submits for review; the rejection limit still blocks submission until reset. |
| Author notices | Native notifications for approval, rejection, threshold hiding, and report-review restoration. Rejection may include optional comments. |
| Reviewer notices | Once after successful login, then periodic summaries; send only for nonzero pending count, not on every enqueue. Queue pages show live counts. |
| Reminder switch | Enabled by default; controls reviewer login notices and periodic summaries only. Author notices, queue operations, report recovery, and deletion cleanup are unaffected. |
| Summary cadence | Global positive-integer-minute interval, default 1440. Login does not reset it. Coalesce missed periods to one current summary; log partial failures without replaying that occurrence. |
| Default-role notices | Effective default users receive notices when default has the required access/review grants. No special prohibition, opt-in, or silent population cap. Administrators bear the consequences of broad permission configuration. Batching changes resource usage, not eligibility. |
| Concurrent review | First valid successful database conditional write wins, not necessarily first network arrival. Losers produce no second decision/count effect/decision notice. |
| Native failure policy | Await native calls and propagate mutation failures; document partial writes. No transaction, notification outbox, or crash-safe exactly-once delivery guarantee. |
| Login exception | Explicitly catch/log this addon's login-summary failures and preserve login success; Hydro does not isolate those failures automatically. |
| Report persistence | Independent immutable receipts plus one bounded pending-write slot on the article, recovered idempotently without recounting. |
| Deletion boundary | Explicit native-style cascade of the article and owned dependent data, including reports. Failures propagate; no transaction, whole-site orphan sweeper, or guarantee of zero crash-window residual records. |

## Official-Source Review Findings

The original design needed the following corrections. Evidence IDs refer to
the source register below; this is source analysis, not runtime verification.

| Priority | Finding | Design response |
| --- | --- | --- |
| P1 | Embedded report histories can grow without bound across edits/resets. Read pagination does not bound BSON storage; document helpers do not supply a cross-document transaction (H1, M1). | Independent receipts and one bounded pending write, detailed in Design A. |
| P1 | Workers delete a due task, reinsert recurrence, then run its handler. Recurrence advances from the old due time; failures are logged without an execution lease or delivery retry (H4). | Separate maintenance wake-ups from persisted summary due/claim state, detailed in Design B. |
| P1 | `auth/login` is awaited before login response setup completes; rejection reaches HTTP error handling (H5, H6). | Explicit addon-only exception isolation for login summaries. |
| P1 | `DocumentModel.set` upserts and cannot express review-version predicates; status helpers update another record and one catches all persistence errors (H1). | Scoped non-upserting article CAS, not ordinary `set` or status helpers. |
| P1 | Hydro runs `prepare`, generic `post`, then `postOperation` (H6). Relaxing inherited read gates could expose unrelated writes; retaining them could deny reviewer-only roles. | Restricted review/report/reset handlers and lifecycle-aware authorization tests. |
| P2 | `OplogModel.log` uses the request domain, overriding payload `domainId`; sanitization applies to request args, not arbitrary supplied data (H3). | Allowlisted audit data and explicit global article-domain identity; audit is not report persistence or a recovery journal. |
| P2 | Retired assignments fall back to default in the existing policy. | Include those users when their effective default role qualifies. |
| P2 | `ensureIndexes` is primary-instance-gated and logs index creation failures (H7). | Do not infer safety from a resolved helper call; use native unique `_id` identities and verify supporting indexes. |

Also preserve the native localized message format (H2, H8), and distinguish
pending publication intent from the editor's `draft: true` checkbox. An ordinary
pending edit must not implicitly cancel review.

## State and Publication

Keep publication (`draft`) separate from review status. Centralize modes,
reasons, decisions, operations, settings, and messages in `as const` catalogs
with derived types.

Article metadata represents `writeRevision`, `contentVersion`, `counterEpoch`,
queue identity/generation/reason and enqueue time, report/rejection counts,
report-approved content version, last decision, `requiresReview`, its origin,
and at most one `pendingReportWrite`. Keep queue/count/publication authoritative
on the article, not in a second mutable queue record.

| Event | Required transition |
| --- | --- |
| Save an ordinary draft | Remain unpublished without creating a queue entry. |
| Publish unrestricted article with review disabled | Publish normally unless rejection count blocks it. |
| Publish with pre-publication review | Set hold and publication intent, remain unpublished, enqueue current content. |
| Publish unrestricted article with post-publication review | Publish immediately without initial review. |
| Publish held unpublished article in any mode | Remain unpublished and enqueue; reject when at the rejection limit. |
| First accepted report | Set hold and enqueue/retain report review; remain visible until threshold exceeded. |
| Further accepted report | Increment once; keep one queue entry. Hide/notify only on the initial threshold crossing. |
| Publication-review approval | Publish current content, clear counts/hold, consume queue, notify; no report immunity. |
| Report-review approval | Restore current content, clear counts/hold, consume queue, exempt this version, notify. |
| Review rejection | Keep/set unpublished and held, increment rejection count once, consume queue, notify with optional comments. |
| Explicit withdrawal | Keep/set unpublished, cancel queue, retain counts/hold/receipts. |
| Force reset | Clear counts only; retain visibility, queue, hold, immunity, and receipts. |

Apply the state machine to published creation, full-form submission, independent
publication, and edits that stay public. Pre-publication mode hides changed
public content and submits it; do not retain an old public revision.
Post-publication mode keeps ordinary public edits public and renews report
eligibility. Pending report review remains pending after edits in either mode.

Report-hidden/rejected articles cannot bypass review through editing, pinning,
withdraw-and-publish, reset-and-publish, or mode-change-and-publish. A reported
article below the hiding threshold may remain public in post-publication mode;
the hold blocks restoration/publication bypass, not pre-threshold visibility.

Persist pending publication intent separately from `draft`. Saving changed
pending content with its existing draft checkbox preserves the queue;
cancellation requires an explicit authorized withdrawal operation. Preserve a
report-review reason across edits and withdrawal/resubmission, including its
approval-immunity semantics. Preserve enqueue age where possible and advance
decision generation when the review snapshot changes.

New actions read current settings/permissions. An already admitted in-flight
action may complete under its validated request snapshot; do not invent a
cross-collection settings transaction. Later configuration changes never erase
a committed hold or accepted report.

Assign `firstPublishAt` only on actual first visibility, not review submission.
Preserve the original value after withdrawal/republication and compatible
defaults for legacy articles/settings. New permission bits do not augment
existing stored role masks.

## Design A: Independent Reports With One Bounded Pending Write

### Storage

Use the typed `blog.report` collection through `ctx.db.collection`. Each
immutable report contains:

- A deterministic `_id` from system-domain/type/article ID, content version,
  and reporter ID; the native unique `_id` index supplies deduplication.
- Article/reporter identity, content version, optional validated comment,
  acceptance time, counter epoch, operation ID, and accepted article revision.
- Only an accepted payload, not a separately inserted unaccepted reservation.

The article's single `pendingReportWrite` contains the complete immutable
receipt payload needed for materialization. It is not a growing history/user
list or whole-article snapshot. Optional comments use compatible Hydro content
validation with an explicit bounded length; blank/missing comments are valid.
All report payloads are private, with paginated reviewer reads.

This maintainer-approved recoverable business write is not a notification
outbox, lease-based article lock, or cross-collection transaction.

### Acceptance Protocol

1. Authenticate and authorize the target. An accepted duplicate may return only
   an own-receipt acknowledgement, never hidden content. New reports still
   require a readable public non-owned article.
2. Materialize any existing pending slot before admitting another report or
   content/publication/review/reset/delete mutation.
3. Read the fresh article revision **before** querying the deterministic receipt
   ID, using primary reads. An existing receipt is an already-reported result;
   never replace its comment or increment its count.
4. Validate content version, policy/settings snapshot, visibility, immunity,
   safe counter arithmetic, and empty pending slot.
5. Perform one non-upserting article CAS against that revision/version/state.
   Atomically increment the report count once, enqueue/retain review, apply
   threshold hiding, advance write/decision generation, and store the complete
   pending receipt payload. **This CAS is the report acceptance point.**
6. Materialize the immutable receipt with `_id`-scoped `$setOnInsert`. Repeated
   helpers match the same operation/payload; conflicting payload for that ID is
   an integrity error, not something to overwrite.
7. Clear only the matching pending slot conditionally and advance
   `writeRevision` again. Do not increment counts again or change content/version/
   first-publication time during materialization.
8. Only the original acceptance winner attempts normal report/hiding Oplog and
   author notices after materialization. Duplicate requests/recovery helpers
   do not emit another transition notice/log.

Reading the article before the receipt is essential: a stale "receipt absent"
result cannot succeed after another report committed and its slot cleared,
because clearing changes the revision. Every addon-owned content/publication/
review mutation participates in this protocol; views, stars, and comment
statistics do not overwrite its fields.

Conflicts return existing stale-state/reload feedback. Never retry a decision
against a newer generation or silently replace a report's content version.
Any internal report retry must repeat article-then-receipt reading and validate
eligibility; no unbounded retry loop. Initial legacy CAS predicates must
distinguish absent revision metadata from explicit stored values.

### Recovery and Reset

Retries, subsequent authorized article mutations, and native maintenance share
the same idempotent materializer. A pending slot proves acceptance before receipt
insertion. Review details materialize it before presenting the complete report
list; persistent report-store failure must not hide an accepted report or allow
approval of an incomplete snapshot.

Maintenance scans pending slots with blog-scoped indexes and bounded pages,
seeking by article ID through a start-of-run upper bound. Continue past logged
individual failures and retry unresolved slots on a later pass. Recovery never
depends on the original HTTP process or on the reviewer-reminder switch.

Reset/approval first settle the slot, then atomically clear counts and advance
`counterEpoch`. They preserve receipt identities, so clearing counts does not
permit the same reporter/content version again. Pre-reset stale requests fail
their revision predicate; genuinely new reports after reset use the new epoch.

| Failure/interleaving | Required outcome |
| --- | --- |
| Before acceptance CAS | No count, queue change, hidden state, or receipt created. |
| Crash after CAS, before receipt insertion | Slot preserves acceptance/threshold state; helper inserts without recounting. |
| Crash after insertion, before slot clearing | Idempotent insertion matches the receipt; helper clears matching slot only. |
| Two identical reporters read no receipt | One CAS wins; stale request cannot count again after materialization. |
| Two materializers | One immutable receipt; conditional clearing succeeds once; no repeated business side effects. |
| Edit/reset/review during materialization | Settle, reload, and apply expected token/revision; no stale action on a new snapshot. |
| Notice/Oplog failure after materialization | State/receipt remain committed; propagate failure without rollback/reapplying decision. |
| Crash before native notice/Oplog | Business data can recover; notice/audit may be missing under the accepted native boundary. |

### Deletion

Follow Hydro's explicit non-transactional cascade and this addon's parent-first
order. Extend both `del` and `deleteChecked`: settle the slot, delete the article
with the appropriate predicate, and await cleanup of article statuses, comments/
replies/likes, and independent reports. The slot disappears with its parent.
Never recreate the article through upsert or leave a persistent article lock.

A materializer resuming after another helper cleared its slot and the parent
was deleted rechecks the parent after receipt insertion and removes its own
late receipt. Cleanup/compensation are idempotent; report success only after
the current operation's required work finishes and propagate failures.

No whole-site orphan sweeper, deletion outbox, or transactional deletion is
added. Crashes between separate cleanup/compensation writes may leave residual
records, as with native cascades. They are never readable through an absent
article or included in the live queue. This explicitly confirmed boundary is
not a guarantee of zero residual records at every crash instant.

## Design B: Native Wake-Ups and Summary Eligibility

### Maintenance and Runtime State

Use an addon-scoped native maintenance task with a fixed one-minute heartbeat.
It recovers pending report writes independently, then attempts a reviewer
summary only when enabled and due. No process-local timer replaces native
scheduling and no Hydro worker patch is required.

One typed `blog.review.runtime` document under a fixed `_id` stores the native
`taskId` allocated once, applied reminder-configuration revision,
`nextSummaryAt`, optional summary `runId`/lease expiry, and diagnostic outcomes.
Initialize using `_id`-scoped `$setOnInsert` and read the persisted winner's task
ID. Use native `_id` uniqueness. Runtime updates must not invalidate role/matrix
configuration forms.

### Initialization and Native Races

- Register through `ctx.inject(["worker"], ...)` on each worker context.
  Bootstrap on the designated native primary instance using the persisted task
  ID and exposed `ScheduleModel.coll` with `$setOnInsert`.
  `ScheduleModel.add` allocates its own ID and cannot preserve a supplied one.
- The task row has that ID, addon subtype, fixed recurrence, and due time.
  Do not delete/recreate it when settings/reminder enablement change.
- Cold startup may restore a missing row under the same ID. If this races native
  delete/reinsert, bootstrap may win and native reinsert may log duplicate-key,
  skipping that wake. The replacement row survives for the next heartbeat;
  this is not exactly-once native task execution.
- Catch only verified own-ID duplicate creation races in addon initialization
  and reread the row; propagate unrelated errors. Do not suppress native worker
  diagnostics or change its error handling.
- At handler entry, conditionally move an already overdue reinserted row to the
  next heartbeat, matching ID/subtype/due time, without upsert. If another worker
  temporarily removed it, that handler applies the same coalescing after
  reinsert. Do not replay a notification per missed period.
- At most one persisted recurrence row can have the stored ID, but handlers can
  overlap. Report recovery is idempotent; summary claims guard delivery.

### Claim and Delivery

1. Read current reminder settings. Disabled mode skips claims/messages but not
   maintenance. An enabled due occurrence advances cadence even for an empty
   queue, while sending no message; later enqueueing alone does not trigger a
   summary.
2. Apply only a strictly newer reminder-configuration revision using runtime
   CAS; stale readers reload, never roll it back. This revision changes only
   for reminder enablement/interval edits, not role edits. Record configuration
   change time using database server time. Enabling/changing interval schedules
   from that change; disabling removes future eligibility. Applying new config
   invalidates an old run token.
3. When due, atomically claim expected config revision with a unique `runId` and
   absent/expired owner. Advance `nextSummaryAt` to current time plus interval
   **before sending**, consuming the occurrence rather than creating a retry job.
4. Use a renewable lease, initially five minutes. Check/renew it and check the
   switch before each recipient batch. Use MongoDB server time for due/lease
   comparisons/extensions. A stale owner cannot clear a newer claim. Runtime
   update expressions use generated values, not user-supplied expression trees.
5. Keyset-page eligible profiles/assignments, initially 100 profiles per page,
   through a start-of-run user-ID upper bound. Resolve current effective grants
   per batch. Traverse all pages: this is a page size, not a recipient cap.
6. Recheck nonzero queue count and reminder enablement before dispatch.
   Permission/configuration changes affect the next check, not an already
   in-flight native message.
7. Release only this `runId` on finish/failure. Log failures and keep the
   occurrence consumed. The next interval starts a fresh complete traversal;
   do not resume/retry a failed recipient list.

Login reminders do not consume/reset the periodic schedule; a login notice
near a scheduled summary is valid. Global interval is a positive integer number
of minutes, default 1440. No default-role exemption or population cutoff applies.

The lease prevents normal overlapping scans. Native worker timeout does not
cancel the underlying promise, so a runner losing ownership stops before the
next batch. A blocked/in-flight native send cannot be atomically recalled or
fenced; lease/crash boundaries may cause partial/late delivery, not crash-safe
exactly-once notifications.

### Configuration and Lifecycle

Turning reminders off stops new login reminders/summary batches, not author
decision/hiding notices, queues, report recovery, or deletion cleanup.
Re-enabling starts a fresh interval rather than replaying disabled periods;
login may still notify immediately. A running scan stops at its next check
after a switch/interval change, and stale completion cannot overwrite new state.

Coalesce downtime to at most one current due summary. Native task/message
failures are logged without durable delivery retries. Respect context disposal
and do not clear a newer run's ownership during cleanup.

Test simultaneous bootstrap, the native delete/reinsert window, two consumers,
long summaries, lease expiry/stale completion, config changes mid-run, off/on,
empty queues, downtime, native send failure, and disposal. The startup-race
case permits the documented native duplicate-key diagnostic but must prove a
surviving recurrence row and later wake recovery.

## Permissions, Routes, and UX

- Append `REVIEW` and `RESET_REVIEW_COUNTERS` bits. Root gets them through its
  existing mask; existing/default custom masks remain unchanged until configured.
- Queue/decisions require authentication, `ACCESS`, and `REVIEW`. This grants
  scoped pending content/report access, not general draft reading/editing.
  Approval's publication effect uses `REVIEW`, not an additional ordinary
  `PUBLISH_OWN/OTHERS` grant; it does not grant standalone publication.
- Authors still need existing own-draft reading permissions for unpublished
  content. Ordinary public readers must not receive reporter identities,
  report/rejection comments, or private review metadata in HTML/JSON.
- Use a restricted handler base, not an edit handler with relaxed readability.
  Generic `post` and operation dispatch must enforce the same allowed actions.
  Reset remains independent of review/settings and can target non-pending
  rejected articles without exposing full draft content.
- Add paginated `/blog/review` and target-bound detail/actions before generic
  `/blog/:uid` routes. Show reason/version/counts and submit review/version
  tokens with decisions.
- Replace contact-help Report with a native dialog and target-bound endpoint,
  independent of detail's unconditional read gate. Previously accepted own
  receipt acknowledgement does not authorize hidden-content reading or a new
  hidden-article report. Hide/disable ineligible, duplicate, immune, unpublished,
  and review-disabled reporting controls.
- Add approve/reject, optional rejection comments, and independent confirmed
  force reset. No arbitrary bulk moderation; confirmed disabling automatically
  approves the current pending queue.
- Add mode, report/rejection limits, reviewer-reminder switch, and interval
  controls to existing settings. Allow report limit 0; require positive rejection
  limit and integer interval minutes. Validate numeric range/date arithmetic,
  use revision checks/sudo, and explain the author-notification exception.
- Group review/reset permissions in a dedicated Blog review family. Order list
  home sidebar buttons Create, My Blog, Review, Settings. My Blog is independently
  available to authenticated readers and targets the signed-in user. User-list
  sidebars retain only the owner's title and an authorized self-create button,
  without the three home navigation buttons.
- Show pending/rejected/blocked states and explicit withdrawal controls; preserve
  pending edits despite the draft checkbox.
- Reuse Hydro forms, dialogs, requests, feedback, pagination, navigation, and
  rendering. Avoid native-template overrides/custom CSS without need. Preserve
  translations and English documentation/new comments.

## Concurrency, Audit, and Native Messages

Use scoped `DocumentModel.coll.findOneAndUpdate`, expected state/content/review
generation, `returnDocument: "after"`, and no upsert for article decisions.
Advance revisions/timestamps monotonically. Direct collection writes do not
emit `document/set`, matching current checked edits; do not invent that guarantee.

Approval/rejection consumes a pending review atomically with counts/publication.
Only the winner emits decision side effects. Edits, reports, withdrawal, reset,
and deletion share compatible predicates: stale decisions cannot approve old
text, restore withdrawn content, discard new reports, or resurrect an article.

Record successful decisions, accepted reports/automatic hiding, resets, and
moderation settings changes with explicit `blog.*` Oplog events. Allowlist
article ID, `articleDomainId: SYSTEM_DOMAIN`, review/version/reason, decision,
before/after counts, and applicable comments. Native Oplog retains request-domain
context; do not fake handler arguments or rely on payload `domainId`. Do not
log whole article/report arrays or substitute `OplogModel.add` for handler-aware
logging. Preserve existing create/edit/delete logs and creation rate limits.

After authoritative persistence, await required native messages/audit and
propagate failure without rollback/reapplying decisions. A crash may leave
missing side effects. Notifications describe the committed transition/version,
not a promise that no newer transition exists; concurrent messages can arrive
out of order. Current article/queue state remains authoritative.

Use common `auth/login` for password, WebAuthn, OAuth, and registration login;
not sudo/logout/failed login/ordinary reads. Resolve the event user's fresh
policy instead of the earlier per-handler anonymous cache. Explicitly catch/log
only addon login-summary failure so core login succeeds.

Recipient resolution includes forced/assigned root, custom roles, and qualified
default users, including retired and legacy-guest assignment fallback. Exclude
guest and missing `ACCESS`/`REVIEW`; deduplicate root. Do not reuse `listUsers`,
which intentionally excludes default. Recheck current policy per batch and
traverse the complete eligible set without an extra opt-in or population cap.

Use native `MessageModel.send(1, recipients, JSON.stringify({ message, params }),
flags)` with rich-text/unread flags. `sendInfo` is ephemeral; `sendNotification`
selects a different system privilege. Default UI localizes the key and renders
parameters with `:link` placeholders. Comments are text parameters, not raw HTML
or supplied links. Background jobs use verified canonical system-blog routing,
not an assumed request `this.url`. Native message persistence/unread updates
are separate and not all-or-nothing.

## Files and Implementation Todos

| Files | Planned responsibility |
| --- | --- |
| `features/constants.ts`, `features/types.ts` | Modes, permissions, operations, messages, review/report/runtime contracts, compatible defaults and validation. |
| New `features/review.model.ts`, existing `features/model.ts` | Article transitions, receipt materialization, queries/indexes, checked writes, and cascade cleanup; avoid circular model dependencies. |
| New `features/review.handler.ts`, existing handlers/base/policy | Restricted review/report/reset routes, decision tokens, all publication paths, withdrawal, projections, author messages/Oplog. |
| New `features/review.notifications.ts`, `index.ts`, `features/ui.ts` | Login reminders, native maintenance/summary handler, due/lease state, recovery scan, lifecycle and navigation. |
| Existing settings model/handler | Modes/limits/switch/interval, reminder-config revision, compatibility, sudo/revision checks, audit. |
| Existing article/settings templates, new review templates and `frontend/blog-review.page.ts`, existing settings frontend and i18n | Native controls, dialogs, state labels, navigation, and translations. |
| Existing UT, new review/notification UT | Actual state/policy logic, write protocol, fault injection, permissions, scheduling races. |
| New `tests/e2e/review.spec.ts`, fixtures/runtime scripts | Real UI/routes/persistence/concurrency and opt-in native worker verification. |
| Plan index and behavior/testing/runtime guides | Retained decisions, delivered contracts, exact evidence, and limitations. |

Use dedicated typed report/runtime collections. Query indexes support bounded
reads; shared document indexes remain system-blog-scoped. Safety identities use
native `_id` uniqueness, and supporting indexes must be verified. No new
dependency or generic workflow engine is planned.

1. **Defining contracts**: maintain this plan; finalize typed metadata, transition
   predicates, bounds, defaults, permission bits, and compatible references.
2. **Implementing settings/policy**: compatible settings, independent grants,
   switch/interval/reminder revision, sudo and preservation across role saves.
3. **Implementing persistence**: atomic article decisions, Design A, receipt
   identity, epochs, immunity, hold, indexes, timestamps, and deletion.
4. **Integrating endpoints**: every publication path, restricted review/report/
   reset actions, private projections, author messages, and Oplog.
5. **Implementing reviewer reminders**: login exception isolation, Design B,
   current-policy recipients, recovery, switch/interval, and lifecycle.
6. **Implementing UX**: native settings/queue/detail/dialog/reset/withdrawal
   controls, state labels, navigation, and translations.
7. **Adding UT**: actual model/handler/policy/settings/notification contracts and
   deterministic failure/concurrency cases.
8. **Verifying and recording delivery**: real-Hydro E2E, native scheduler checks,
   lint/types/UT/MCP, final diff, and guide/plan evidence updates.

Dependencies: 2 and 3 require 1; 4 and 5 require 2 and 3; 6 requires 4 and 5;
7 requires 2, 3, 4, and 5; 8 requires 6 and 7. No subagent workflow or PR merge
is requested.

## Acceptance and Verification

### Unit Tests

- All modes/publication paths, legacy articles/settings, and timestamps.
- Boundaries: reports 3/4, rejections 2/3, zero report limit, cross-version
  accumulation, approval and independent reset.
- Duplicate/concurrent reports, version immunity, content-change renewal versus
  metadata changes, and receipt preservation across resets.
- Reviewer-only/reset-only roles, no general draft/edit/publish bypass, author/
  anonymous reporting denial, and full generic-post/operation lifecycle.
- Winner/loser decisions and races with edits, reports, withdrawal, reset,
  deletion, and stale settings.
- Every pending-write failure stage, idempotent recovery, reset epochs, stale
  absent-receipt reads, conflicting payloads, and native side-effect failures.
- Login exception isolation and fresh identity, no sudo/logout/page-read notices,
  retired/default/root selection, and batches beyond the first page.
- Reminder switch/interval/config revision races, leases/stale completions,
  overdue wakes, worker overlap, native startup races, and index failure handling.
- Persistent hold across edit/withdraw/reset/disabled-mode resubmission; only
  approval clears it, and report-review origin survives queue cancellation.
- Request-domain audit context plus global article identity.

### Real-Hydro Playwright and Manual Evidence

- Pre-publication content stays absent from public list/detail/JSON until
  approved; reviewer-only users can inspect current pending content.
- Author outcome notices identify the correct article and optional comments.
- Post-publication reports enqueue once; the fourth accepted distinct report
  hides and notifies without deleting the comment thread.
- Report approval restores visibility and blocks unchanged-version reports;
  content changes renew eligibility and pending edits stay queued.
- Three rejections block publication despite edits; reset clears both counts
  without publishing, cancelling a queue, or removing a hold.
- Concurrent approve/reject yields one decision/count effect and one
  normal-execution decision notice/log.
- Actual role/sudo/restricted-domain/direct requests exercise independent grants.
- Login/nonzero summaries, default-role recipients, actual native periodic
  consumption, complete pagination, and enabled/1440 settings defaults.
- Reminder off/on and interval changes have the specified cadence; author
  notices and pending-report recovery continue while reminders are disabled.
- Withdraw/reset/mode-change plus publish never bypasses an existing hold.
- Successful cascade removes article/status/comment/reply/like/report data;
  late materializers compensate without recreating the parent.
- Private report/rejection data never enters ordinary HTML/JSON.

Use run-owned synthetic authors, multiple distinct reporters, and two reviewers.
All business fixtures go through real authenticated routes; MongoDB access is
read-only assertion evidence. Restore shared fixture settings after failures.
Run local Hydro/Playwright with disposable MongoDB and isolated writable paths.

Enable worker consumption only in an explicit isolated verification mode. Keep
`CI` removed only in the Hydro child, as today; otherwise the native worker
suppresses consumption. Exercise the real task handler, not a mocked delivery
or production test endpoint. Do not add a judge or alter global host services.

Planned checks: `yarn lint`, `yarn typecheck`, focused `yarn test` selectors,
`yarn test:coverage`, and `yarn test:e2e --grep review`. Include affected shared
article/comment/permission E2E where visibility/publication changes. Use declared
Playwright MCP for translated/narrow-screen settings/review/report UI; promote
discovered regressions into executable tests.

Record exact commands/outcomes, runtime versions, concurrency evidence, MCP
checks, and omissions. Fault-injection UT does not prove process-kill/restart
recovery; record a run-owned runtime reproduction before claiming it verified,
or explicitly leave that check unverified. The delivery record distinguishes
completed local checks from those remaining outside verified coverage.

## Local Delivery Record

Verified on 2026-11-07 with Node `24.22.1`, Yarn `1.22.22`, Hydro `5.0.7`,
default UI `4.58.5`, MongoDB driver `7.7.0`, the isolated `mongo:7-jammy`
runtime, and the local Chrome channel. No dependencies were added.

| Check | Outcome and scope |
| --- | --- |
| `yarn lint` | Passed on the final implementation. |
| `yarn typecheck` | Passed for 39 project files against installed dependency types. |
| `yarn test:coverage` | 219 tests passed in seven files, including publication, receipt recovery, native handler failures, settings, and reminder lifecycle/recipient cases. |
| `yarn test:e2e` | 36 passed: six real logins and thirty business cases. Artifact run: `hydro-blog-84744-29097ae8`. Includes the actual native periodic reminder, not a mocked timer. |
| `yarn test:e2e --grep 'draft publication\|review before publication\|review rejection limit'` | Nine passed after the legacy publication-timestamp fix. Artifact run: `hydro-blog-81294-0f06ef44`. |
| `yarn test:e2e --grep 'review reports\|review concurrent\|review anonymous'` | Nine passed after the final report-materialization concurrency refinement. Artifact run: `hydro-blog-86473-45f6597b`. |
| Declared Playwright MCP | Real login/sudo, root-owned pre-publication submission, English/Chinese review/settings UI at 390 by 844, rejection feedback, reset cancellation/confirmation without publication, resubmission, and self-approval. Review-page console check had no errors. |
| Diff/documentation | Whitespace and changed local documentation links checked; no commits or PR merge performed. |

E2E artifacts are under ignored `test-results/<run-id>/`. The MCP development
run was `hydro-blog-69318-372e4e84`; its ignored screenshot is
`.playwright-mcp/review-mobile-zh.png`. Browser pages and the run-owned server,
container, and temporary directory were cleaned up.

### Verification-Driven Adjustments

- The first settings-save MCP flow reached sudo after editing and lost the
  selected values. The settings GET now requires sudo before displaying the
  form; fresh-session E2E verifies the corrected flow.
- Receipt materialization is separate from loading a stable follow-up write
  snapshot. An accepted report can finish after a subsequent reset without
  overwriting it or losing its successful outcome; stale subsequent writes
  still fail. A focused regression covers this ordering.
- Management operations preserve the in-memory first-publication fallback of
  legacy public articles before refreshing timestamps, without bulk migration.
- A complete run passed 35 cases before the old 300-second suite deadline
  prevented completion of the real-timer case. Global/parent bounds are now
  480/510 seconds and the CI E2E step is twelve minutes. Retries remain zero;
  ordinary per-test/action/navigation limits were not relaxed.
- A later run exposed existing `load` waits stalled by third-party resources
  after page content was available. Browser navigation now waits for
  `domcontentloaded` and retains real DOM, permission, and persistence assertions.
  No routes, authentication, persistence, or application responses were mocked.

### Remaining Verification Limits

- Process-kill/restart recovery was not exercised; recovery fault injection is
  UT evidence, not proof of every crash window.
- Multi-process native scheduler bootstrap/reinsert races, exhaustive lease
  expiry/in-flight delivery scenarios, and the full supported deployment/version
  matrix were not exercised end to end.
- The initial local delivery predates PR CI; consult PR #11 for commit-specific
  CI results rather than treating local results as GitHub-run evidence.
- Native message/Oplog delivery and cross-collection deletion retain their
  documented partial-failure semantics. No crash-safe exactly-once delivery or
  global orphan cleanup is claimed.

### Sidebar and Count-Visibility Follow-up

The home sidebar orders available buttons Create a Post, My Blog, Blog review,
and Blog settings. My Blog targets the authenticated user independently of
create/review grants. Following the maintainer's subsequent refinement, user-list
sidebars omit My Blog, Review, and Settings, keeping the owner's title and the
self-create button when authorized. They never enable creation for another owner.
Review/reset matrix rows use their own Blog review family without changing
permission bits or stored masks.

Report counts now require `REVIEW` in list/detail/editor/reset HTML and JSON.
Authorship or reset-only authority does not grant count access; rejection
feedback and the independent reset action remain available as before.

Follow-up verification: lint and project typecheck passed; `yarn test` passed
226 tests. `yarn test:e2e --grep 'review before publication|review reports|review rejection limit'`
passed nine tests in `hydro-blog-4759-b711a444`, including sidebar order/current
user routing, distinct permission family, author JSON filtering across four
routes, reviewer count access, and reset-only privacy. Declared MCP verified
desktop/narrow sidebar layout and the native family table in a separate
isolated runtime. The existing development instance was not restarted, to
preserve its temporary test data.

The subsequent homepage-only navigation refinement passed lint/typecheck and
`yarn test:e2e --grep 'review before publication'` (seven tests,
`hydro-blog-10618-0b30a1a6`). It covers the full home button set, owner-only
creation on user lists, and omission of home navigation even for root on another
author's list. MCP confirmed the Chinese home/own/other-user sidebars on the
existing development instance; this template-only change loaded without a restart.

### Critical-Action Confirmation Follow-up

The maintainer requested secondary confirmation for easily misclicked critical
actions. Use the installed default UI's `confirm()` helper, not browser-native
`window.confirm` or a custom modal. Official source inspected at Hydro revision
`3bae56fe8edddff12346bcb1c8281269c94688d8`:
`packages/ui-default/components/dialog/index.tsx` (`ConfirmDialog`, `confirm`),
`components/discussion/comments.page.tsx` (native deletion confirmation), and
`components/form/form.page.ts` (click throttling).
The installed helper has the same Yes/No design. Hydro hotkeys may emit a
jQuery-only submit, so confirmation must preserve the default editor submitter.

Acceptance scope: article deletion from detail/editor; explicit publication and
withdrawal (including pending review); published-content updates and publication
changes through the editor; approve/reject; and the existing counter reset.
Cancellation must send no mutation, preserve entered content/comments, and leave
review/publication state unchanged. Acceptance must retain the selected action,
hidden version/revision fields, normal validation and native navigation, with no
recursive confirmation or duplicate submission. Draft-only saves and lightweight
pin/star toggles remain uninterrupted; existing report/comment dialogs are not
stacked with another confirmation. Server permissions and CAS remain unchanged.

The first E2E run exposed Hydro's five-second submit-button click throttle:
it consumes a cancelled submission and prevents immediate retries. Only
confirmation-gated submit-button clicks stop bubbling to that document handler;
the addon's pending-dialog guard prevents repeated submission while confirming.
Ordinary draft saves retain the existing native guard.

Verification passed: `yarn lint`, `yarn typecheck` (41 project files),
`yarn test tests/unit/confirmation.test.ts` (three cases), and
`yarn test:e2e --grep 'draft publication|deletion removes|critical action|article policy|publishing and unpublishing|visible unchecked|review before publication|review rejection limit|review reports'`
(15 cases including six authentication setups). The passing artifact run is
`hydro-blog-18776-ea05f7ca`. No timeout increase or retry was used.

Declared MCP verified Chinese publication/deletion dialogs, cancellation and
immediate retry, retained editor content, and accepted publication/deletion in
the separate `hydro-blog-19138-ccdaf09b` runtime. At 390 by 844, the native
dialog's message and both action buttons remain within the viewport; the native
minimum-width frame slightly extends beyond its edges. No custom dialog CSS was
added. The deletion-page console had no errors. Screenshot:
`.playwright-mcp/critical-confirmation-zh.png`.
The managed browser and both temporary preview processes were closed; their
run-owned MongoDB containers and temporary directories were verified removed.

The entire automated suite and current-head CI were not rerun for this UI-only
follow-up; the focused run covers the changed article/review/reset paths.
The existing port-8888 instance remains untouched and serves its old compiled
entry bundle. Loading the new frontend requires a restart; the temporary preview
loads the new bundle. Do not restart the existing disposable instance implicitly,
because its normal launcher shutdown removes its test data.

### Confirmation Localization Follow-up

The maintainer observed untranslated confirmation messages after a development
restart. The server's `lang-zh.js` already contained the Chinese strings.
Official UI source at the pinned revision uses a UI-package-version language
asset URL and `Cache-Control: public, max-age=86400`; frontend `i18n()` falls back
to the input key when that browser catalog lacks a message. An older catalog
therefore explains English confirmation text alongside translated HTML.
Evidence: `packages/ui-default/backendlib/builder.ts:128-132,155-163`,
`templates/layout/html5.html:62`, and `utils/base.ts:14-16`.

Blog preparation sends confirmation strings in `UiContext`, using
the native request's `Handler.translate` method. The dialog prefers this
request-local mapping and retains the native catalog only as a compatibility
fallback. This avoids replacing native templates, patching dependencies, changing
global cache policy, or embedding a second client-side translation catalog.
Native request-language selection was verified in
`packages/hydrooj/src/service/server.ts:162-169`.

The stale-catalog Simplified Chinese regression failed before the fix:
`hydro-blog-52806-574cfb47` displayed the English publication question instead
of Chinese. The new browser cases also cover Traditional Chinese and Korean,
with native preference changes and client-catalog fault injection. Full browser
cache expiration is not claimed.

Verification passed: `yarn lint`, `yarn typecheck`,
`yarn test tests/unit/handler.test.ts tests/unit/review.test.ts tests/unit/confirmation.test.ts`
(107 tests), and
`yarn test:e2e --grep 'stale catalog|critical action|review before publication|review rejection limit'`
(12 cases including six authentication setups). Passing E2E artifacts:
`hydro-blog-53933-30487665`. The full suite and current-head CI were not rerun.

Declared MCP reproduced a missing browser-catalog publication key while the
page's request-local translation and actual native dialog remained Chinese.
All eight confirmation keys had translated page values; cancellation retained
editor content and the page console had no errors. The isolated preview was
`hydro-blog-53653-01c08b5f`; its browser, process, MongoDB container and temporary
directory were cleaned up.

The existing port-8888 runtime and its data remain untouched. Its server already
serves the correct language catalog, so a browser hard refresh can load the
current translations immediately. The request-local fallback code requires a
subsequent application restart to be loaded into that existing instance.

### Disabled-Mode Workflow Follow-up

The maintainer explicitly superseded the previous rule that closing review
preserved every pending entry: disabling must now approve pending articles,
after a warning confirmation. Home, user-dropdown and article review/reset
entry points are hidden while disabled; reporting remains disabled. Publication,
published-edit and withdrawal wording reflects whether review actually applies.
Existing rejected articles outside the queue retain their holds and limits.

The settings POST requires `confirmDisable` whenever saving disabled mode, plus
existing management permission, sudo and revision checks. The native localized
warning explains publication of all pending articles (including reported ones),
counter resets, author notices and irreversible consequences. Cancelling leaves
both settings and articles unchanged.

After committing settings and their audit, a keyset-paged sweep captures an
enqueue-time cutoff and the initial greatest queued article ID as bounds, and
processes at most 100 records per batch. A freshly requeued article beyond that
cutoff is not approved by the earlier sweep; legacy missing enqueue times remain
eligible. Each entry is freshly read and approved through the existing
settle/decision CAS. A concurrent completed decision/withdrawal/deletion wins;
pending content conflicts are retried at most three times. Only successful
approvals emit normal author notices and request-aware `blog.review` audit,
including automatic/setting-mode/revision provenance and system article identity.
There is no silent population cap or unbounded retry loop.

This is not a transaction, durable job or notification outbox. A failure propagates
after any completed writes; another explicitly confirmed disabled save processes
remaining queue entries, not already completed decisions. Requests admitted under
an older settings snapshot may finish after the bounded sweep. The change does
not add perpetual approval of later held-article resubmissions. Existing native
partial-notification/audit and request-snapshot limits remain explicit.

Final checks passed: `yarn lint`, `yarn typecheck`, and
`yarn test tests/unit/handler.test.ts tests/unit/settings.test.ts tests/unit/review.test.ts tests/unit/confirmation.test.ts`
(146 tests). Unit coverage includes 101 queued articles across batch boundaries,
receipt settlement, a competing rejection, edited/requeued content, bounded
conflicts, required acknowledgement, settings revisions and partial failures.

The broader
`yarn test:e2e --grep 'review|critical action|stale catalog|draft publication|publishing and unpublishing'`
run (`hydro-blog-63800-7ca66396`) passed 18 cases, including real periodic
notifications, and exposed one test-isolation assumption: the report-hiding
notice count included the new scenario's earlier notice. The assertion now
filters by its own article. The final
`yarn test:e2e --grep 'disabling review|review reports'` run passed eight cases
including authentication (`hydro-blog-71722-d34a6e29`), also exercising the final
enqueue-time cutoff. No retries or timeout increases were added. The full suite
and current-head CI were not rerun; process-kill recovery and large real-runtime
batch performance remain unverified.

Declared MCP verified Chinese review-submission wording, the complete disable
warning at 390 by 844, cancellation preserving enabled mode, automatic publication
after confirmation, hidden review/report entry points, and ordinary withdrawal
text without review wording. Article JSON confirmed public/nonpending/no-hold
state; the page console had no errors. Screenshot:
`.playwright-mcp/disable-review-warning-zh.png`. The preview
`hydro-blog-64720-a44897eb`, managed browser, MongoDB container and temporary files
were cleaned up. The existing port-8888 runtime and data remain unchanged;
restarting it is required to load this implementation.

### Framework-Owned Handler Lifecycle Follow-up

The maintainer requested removing manual lifecycle invocation and documenting
Hydro's current design. The official HTTP dispatcher confirms that preparation,
the generic HTTP method and operation dispatch are separate awaited stages.
Four handler files contained 14 manual `prepare()` / `post()` calls; these were
removed without deleting hook-based authorization or operation-specific grants.
Models' unrelated `get()` / `cleanup()` helpers were not changed.

Authorization-focused unit cases now use a post-hydration dispatcher fixture,
with call-count checks for preparation and generic POST. Direct operation tests
remain useful for isolated conversion/persistence behavior, not proof of routing.
`docs/handler-lifecycle.md` records the installed versions, pinned official
sources, exact HTTP order, inheritance, control-flow returns, error/cleanup
limitations and test boundaries. The documentation indexes and development
guidelines link to it.

`yarn lint`, `yarn typecheck` and `yarn test` passed (244 tests in eight files).
The complete `yarn test:e2e` run passed all 41 cases, including article/comment
denials, native sudo, settings, report/review authority, automatic approval on
disable, localization and real scheduled reminders. Artifacts:
`hydro-blog-77097-30df7a19`. The run-owned MongoDB container and temporary directory
were verified removed. Documentation links and whitespace checks passed.
Current-head CI was not run; prior crash/multi-process limits remain unchanged.
The existing port-8888 development instance and its data are unchanged.

## Source Evidence and Compatibility

Baseline package APIs inspected: Hydro `5.0.7`, default UI `4.58.5`, MongoDB
driver `7.7.0`. Dependency declarations remain unchanged.

Pinned official Hydro revision:
`3bae56fe8edddff12346bcb1c8281269c94688d8`.

Official source was retrieved through `gh api`. The Hydro documentation landing
page and MongoDB documentation were fetched directly. Hydro's landing page
confirms extensibility, not detailed scheduler/auth/concurrency contracts.

Six installed files match the pinned official source byte-for-byte:
`model/message.ts`, `model/oplog.ts`, `model/schedule.ts`, `service/worker.ts`,
`service/db.ts`, and `handler/user.ts`. `model/document.ts` differs only by an
additional upstream `contestTeam` index; examined mutation APIs match. This is
not whole-package compatibility certification.

All Hydro paths below refer to that revision; local paths refer to the baseline.

| ID | Source | Evidence |
| --- | --- | --- |
| H1 | `packages/hydrooj/src/model/document.ts:100-117,298-340,410-416` | Upserting set; separate status writes; catch-all conditional-status errors; single-record revision CAS. |
| H2 | `packages/hydrooj/src/model/message.ts:17-35,62-69` | Persisted send, separate broadcast/unread update, ephemeral info, system-privilege recipient selection. |
| H3 | `packages/hydrooj/src/model/oplog.ts:20-57` | Request-argument sanitization, audit hook, request-domain override, separate insert. |
| H4 | `packages/hydrooj/src/service/worker.ts:24-78,80-87`; `packages/hydrooj/src/model/schedule.ts:33-39,64-102` | Disable/CI behavior, delete/reinsert recurrence, logging, disposable registration, primary-instance initialization. |
| H5 | `packages/hydrooj/src/handler/user.ts:33-49,105-108,218-220,340-341,502-511` | Awaited successful-auth event and password/WebAuthn/registration/OAuth callers. |
| H6 | `framework/framework/server.ts:570-610` | Prepare/generic-method/operation order and HTTP error propagation. |
| H7 | `packages/hydrooj/src/service/db.ts:107-150` | Instance-gated index setup and logged creation failures. |
| H8 | `packages/ui-default/components/messagepad/MessagePadDialogueContentContainer.jsx:41-63`; `packages/hydrooj/src/handler/discussion.ts:278-299` | Localized native message rendering and moderation notice/audit caller. |
| H9 | `packages/hydrooj/src/model/discussion.ts:101-115`; `packages/hydrooj/src/model/document.ts:120-126` | Explicit dependent-record cascade without a transaction. |
| M1 | MongoDB Manual, Documents: Document Size Limit and The `_id` Field | 16 MiB BSON limit; native standard-collection unique `_id`; pagination does not bound stored size. |
| M2 | MongoDB Manual, Atomicity and Transactions | Atomic expected-state single-document writes, not implicit cross-document atomicity. |
| L1 | `features/settings.model.ts:83-99,120-126` | Effective-role fallback and per-handler cached policy. |
| L2 | `features/handler.ts:207-267`; `features/handler.base.ts:39-55` | Existing read gates, checkbox semantics, target preparation. |
| L3 | `scripts/hydro-runtime.mjs:138-149` | Isolated primary-instance child, removed `CI`, currently disabled worker. |

Verify additional compatible UI/routing callers during implementation. Protocol
and race tests above are planned evidence, not completed validation.

## Non-Goals

No comment/attachment moderation, automatic classification, email/push, arbitrary
bulk decisions beyond confirmed disabling, membership system, domain-role mutation, automatic review of all
existing articles, root review bypass, strict network-arrival ordering,
cross-write transaction, notification outbox, crash-safe exactly-once messages,
whole-site orphan sweeper, judge services, dependency patches, or automatic merge.
The bounded pending-report write is the explicitly accepted business recovery
mechanism, not the excluded notification outbox.
