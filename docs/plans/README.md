# Project Plans

This directory retains project direction, implementation plans, and consequential delivery decisions. Plans are repository documentation, not temporary agent scratch notes.

## Plan Index

| Plan | Status | Scope |
| --- | --- | --- |
| [Self-validation capabilities](self-validation.md) | Planned | A separate PR for repeatable checks, regression testing, and CI integration. |

A planned capability is not implemented or validated until the corresponding change supplies evidence. The index records delivery status; individual plans retain their baseline, decisions, and outcomes.

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
