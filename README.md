# Hydro Addon Blog

This is a fork of [Hydro Official Blog Addon](https://github.com/hydro-dev/Hydro/tree/master/packages/blog).

## Features

- Blog home and per-user lists with pagination and sorting by publication time, update time, or views.
- Post creation and editing with draft and per-user pinning options.
- Per-user view tracking and star state.
- Immutable two-level comments with Markdown, likes/unlikes, native notifications, and role-based deletion.
- Global blog roles and a permission matrix independent of Hydro domain roles.
- Integration with Hydro navigation, user profiles, templates, and localization.

See the [behavior reference](docs/blog-behavior.md) for precise rules and implementation boundaries.

## Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/tywzoj/hydro-addon-blog.git
    cd hydro-addon-blog
    ```

2. Install addon dependencies using the [development setup instructions](docs/validation.md#environment-and-dependencies).

3. Apply the addon to your Hydro instance:

    ```bash
    hydrooj addon add /path/to/hydro-addon-blog
    pm2 restart hydrooj
    ```

The commands above assume an existing Hydro deployment managed by PM2. For development prerequisites, runtime verification, and other deployment considerations, see the [Hydro smoke-testing guide](docs/hydro-smoke-testing.md).

## Development and Project Documentation

Start with [AGENTS.md](AGENTS.md) for repository-wide rules and the documentation index.

Run `yarn typecheck` for project-scoped TypeScript checking and `yarn test` for UT.
The type check uses installed dependency types without checking upstream
implementations; see the [scope and limitations](docs/validation.md#type-checking).
With Docker and local Chrome available, use `yarn dev` for a disposable local Hydro server or `yarn test:e2e` for managed browser tests. Only MongoDB is containerized; no root access is needed. See the [runtime guide](docs/verification-environment.md) for prerequisites, writable storage, and cleanup.

- [Project structure](docs/project-structure.md)
- [Development guidelines and official Hydro references](docs/development.md)
- [Validation commands and dependency troubleshooting](docs/validation.md)
- [Testing requirements](docs/testing.md)
- [Isolated verification environment and Playwright MCP](docs/verification-environment.md)
- [Collaboration guidelines](docs/collaboration.md)
- [Project plans and delivery status](docs/plans/README.md)

## License

This project is distributed under the AGPL-3.0-only License with [additional terms](https://github.com/hydro-dev/Hydro#%E5%BC%80%E6%BA%90%E8%AE%B8%E5%8F%AF). See the [LICENSE](LICENSE) file for details.
