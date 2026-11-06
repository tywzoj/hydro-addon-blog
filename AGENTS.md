# Agent Guidelines

These guidelines apply to the entire repository. This project is a Hydro blog addon, not a standalone application.

## Basics

- Conversation with maintainers may be in Chinese. Write all documentation, new code comments, commit messages, and PR descriptions in English.
- Preserve application translations in their intended languages.
- Read the relevant guides below before changing code or configuration.
- Keep changes focused on the request and preserve unrelated work.
- Consult the official Hydro source before implementing Hydro-dependent behavior. Follow the research requirements in the development guide.
- Define acceptance criteria and verify changed behavior before declaring implementation work complete. Report missing checks explicitly.
- Cover project behavior with unit tests (UT) and end-to-end tests (E2E). Run Hydro and Playwright locally with isolated writable paths; only MongoDB needs Docker in the default verification environment. Use the declared Playwright MCP for agent-assisted browser checks.
- Keep project plans under `docs/plans/` and update relevant plans when scope, decisions, or delivery status changes.
- Do not merge a PR unless explicitly requested.

## Documentation Index

- [Project structure](docs/project-structure.md): repository layout and responsibilities.
- [Development guidelines](docs/development.md): upstream references, implementation rules, and behavioral invariants.
- [Blog behavior](docs/blog-behavior.md): source-derived contracts, permissions, and implementation boundaries.
- [Validation](docs/validation.md): environment setup, automated checks, and manual verification.
- [Hydro smoke testing](docs/hydro-smoke-testing.md): runtime prerequisites, fixtures, and reproducible manual checks.
- [Testing requirements](docs/testing.md): regression coverage, test design, and handling missing infrastructure.
- [Verification environment](docs/verification-environment.md): low-impact runtime isolation and the project Playwright MCP declaration.
- [Collaboration](docs/collaboration.md): branches, commits, and pull requests.
- [Project plans](docs/plans/README.md): retained plans, decisions, and delivery status.

Keep detailed rules in the relevant guide rather than expanding this index. Update the index when adding or moving a guide.
