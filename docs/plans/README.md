# Project Plans

This directory retains project direction, implementation plans, and consequential delivery decisions. Plans are repository documentation, not temporary agent scratch notes.

## Plan Index

| Plan | Status | Scope |
| --- | --- | --- |
| [Behavior-preserving structure refactor](structure-refactor.md) | Completed locally | Feature ownership, enforced dependency/naming rules, uniform model initialization, typed locale catalogs and explicit entry points; local UT/E2E/MCP evidence by delivery phase. |
| [Blog article review](blog-review.md) | Completed locally; [PR #11](https://github.com/tywzoj/hydro-addon-blog/pull/11) | Three review modes, recoverable reports, review/reset permissions, native reminders/audit, confirmed disabling, localized dialogs, and lifecycle documentation. Local evidence and crash limits are retained; PR checks record commit-specific CI. |
| [Blog comments and permission matrix](blog-comments.md) | Completed locally | Immutable two-level comments, likes/unlikes, four global permission grants, native deletion/notification behavior, and local UT/E2E/MCP evidence. |
| [Global blog settings and permissions](blog-permissions.md) | Completed locally | Domain-independent roles, 17 permissions, self-only article creation, native UX audit/fixes, and local UT/E2E/MCP evidence. Review workflows remain deferred. |
| [Self-validation capabilities](self-validation.md) | In progress | Initial UT/E2E verified in PR #8 CI; local MCP and scoped type checking verified. Data-authorization extension passed 44 E2E cases; the confirmed IP-response fix passed 367 UT (99.84% branches) and nine focused E2E cases. Current-head CI and version-matrix checks remain pending. |
| [Self-validation investigation](self-validation-investigation.md) | Completed | Experiments, upstream research, container recommendation, and explicit unverified boundaries. |

A planned capability is not implemented or validated until the corresponding change supplies evidence. The index records delivery status; individual plans retain their baseline, decisions, and outcomes.

Source paths and line numbers in historical records refer to their recorded
revisions. For the current feature layout, use the
[project structure](../project-structure.md) and
[refactor path map](structure-refactor.md#source-path-map), rather than rewriting
historical evidence after a file move.

## Maintaining Plans

- Create a plan for work spanning multiple PRs or requiring durable scope, sequencing, or design decisions.
- Keep plans in English and use descriptive filenames.
- Include the goal, current baseline, scope, non-goals, milestones, acceptance criteria, validation approach, dependencies, and open decisions.
- Distinguish confirmed requirements from proposals. Do not invent deadlines, owners, approved tooling, or completion claims.
- Use `Proposed`, `Planned`, `In progress`, `Completed`, or `Deferred` consistently. Update the index when a plan's status changes.
- Add relevant PR links, important decisions and their rationale, and delivered outcomes as work progresses.
- Mark milestones complete only when their acceptance criteria have evidence.
- Retain completed or superseded plans. Explain changed direction rather than silently deleting its history.
- Keep current setup commands and operating rules in the main guides; link to them from plans.

## Reading a Plan

A plan describes intent and delivery state. It does not override the implemented scripts, current CI configuration, or the [validation guide](../validation.md).

When implementation reveals a conflict, update the plan and the relevant guide together so future contributors can distinguish current capability from future work.
