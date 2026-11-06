# Project Structure

This repository is a fork of the official Hydro blog addon. It runs within a Hydro instance and integrates with Hydro's persistence, handlers, permissions, localization, and UI.

| Path | Responsibility |
| --- | --- |
| `index.ts` | Addon initialization, index setup, and feature registration. |
| `features/handler.ts` | Routes and request handling. |
| `features/handler.base.ts` | Shared user and post preparation. |
| `features/model.ts` | Blog persistence, document status, and database indexes. |
| `features/types.ts` | Blog document and status types. |
| `features/constants.ts` | Shared route names, template names, domain, and sorting constants. |
| `features/i18n.ts` | Application translations. |
| `features/ui.ts` | Server-side UI integration. |
| `features/utils.ts` | Shared helpers. |
| `frontend/` | Browser-side integration with the Hydro UI. |
| `templates/` | Page templates and reusable components. |
| `patches/` | Dependency patches applied by `patch-package` during installation. |
| `.github/workflows/validation.yml` | PR validation workflow. |

Keep changes in the existing layer. When changing a shared contract, update its dependent handlers, types, templates, frontend code, and translations as needed.
