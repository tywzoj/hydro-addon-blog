# Collaboration

## Branches

- Start new work branches from the latest `origin/main`.
- Branch names must match `users/*/xxx` or `features/*`.
- For maintainer-directed work in this repository, use `users/antares/<short-description>`.
- Do not overwrite or discard unrelated local changes.

## Commits and Pull Requests

- Keep commits and PR descriptions in English and focused on the requested change.
- Write PR titles in English using `type: description`, for example `feat: add pinned blog posts`, `fix: preserve publication timestamps`, or `test: add browser regression coverage`. Choose a prefix that matches the primary change; use `docs:` for documentation-only PRs.
- Summarize meaningful changes, validation performed, and any limitations.
- For behavioral changes, explain the acceptance criteria, regression coverage, and any unverified scenarios. Use the evidence requirements in the [validation guide](validation.md).
- Include official Hydro references when they support an implementation decision, as described in the [development guidelines](development.md).
- Keep documentation aligned with changes to setup, behavior, or contributor workflow.
- Do not commit generated lockfiles, secrets, or local environment artifacts.
- Do not merge a PR unless explicitly requested.

## Documentation Organization

- Keep `AGENTS.md` short: repository-wide basics and links to detailed guides.
- Store detailed agent documentation and rules under `docs/`, organized by topic.
- Extend an existing guide when possible instead of duplicating rules.
- Update the root index and affected cross-references when adding, moving, or renaming guides.
- Keep all documentation in English, even when discussion or reference material is in Chinese.

## Project Plans

- Retain project plans under [`docs/plans/`](plans/README.md). Do not keep the only copy of project direction or delivery decisions in agent session state or conversation history.
- Use plans for multi-PR initiatives, infrastructure work, migrations, and other work that needs durable scope or sequencing. A separate plan is not required for every small edit.
- Update the relevant plan when a PR changes its scope, decisions, acceptance criteria, or status.
- Retain completed plans and their outcomes as project history. Keep operational instructions in the topical guides rather than duplicating them in plans.
