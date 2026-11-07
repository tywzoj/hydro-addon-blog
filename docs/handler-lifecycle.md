# Hydro Handler Lifecycle

## Scope and Source Basis

This guide describes the HTTP lifecycle used by this checkout, verified on
2026-11-07 against installed `hydrooj` 5.0.7, `@hydrooj/framework` 0.3.2 and
`@hydrooj/ui-default` 4.58.5. It is not a claim about the latest upstream version,
WebSocket handlers, or every Hydro release.

The official reference is Hydro commit
`3bae56fe8edddff12346bcb1c8281269c94688d8`:

- [HTTP dispatcher and error path](https://github.com/hydro-dev/Hydro/blob/3bae56fe8edddff12346bcb1c8281269c94688d8/framework/framework/server.ts#L535-L623).
- [Parameter decorators](https://github.com/hydro-dev/Hydro/blob/3bae56fe8edddff12346bcb1c8281269c94688d8/framework/framework/decorators.ts#L58-L96).
- [Sudo decorator](https://github.com/hydro-dev/Hydro/blob/3bae56fe8edddff12346bcb1c8281269c94688d8/packages/hydrooj/src/service/server.ts#L55-L72).

The installed dispatcher matches the referenced lifecycle implementation. Its
full source file differs in two unrelated CORS `Vary` header calls; it is not
byte-identical to the upstream file. Relevant parameter/sudo implementations
were also checked locally. Recheck these sources when changing dependencies.
The [official documentation](https://docs.hydro.ac/zh/docs/Hydro) supplies general
extension context; the dispatcher is the authority for the detailed ordering.

## HTTP Dispatch Order

Hydro constructs the handler and merges route arguments. It emits
`handler/create` and `handler/create/http`, runs the route checker, then checks
method/operation availability. The ordered stages below follow:

| Order | Handler methods and context events |
| --- | --- |
| 1 | `init`, then `handler/init`. |
| 2 | `handler/before-prepare/{name}#{method}`, `handler/before-prepare/{name}`, `handler/before-prepare`. |
| 3 | `__prepare`, `_prepare`, `prepare`. |
| 4 | `handler/before/{name}#{method}`, `handler/before/{name}`, `handler/before`. |
| 5 | `all`, then the HTTP method such as `get` or `post`. |
| 6 | For a POST operation: `handler/before-operation/{name}`, `handler/before-operation`, then `postXxx`. |
| 7 | `after`, then the method-specific, handler-specific and generic `handler/after` events. |
| 8 | `cleanup`, then the method-specific, handler-specific and generic `handler/finish` events. |

`name` is Hydro's resolved handler name, not necessarily the route identifier.
`method` is lowercase. Missing methods are skipped; method steps and serial
context events are awaited. Internal `log/*` steps record timestamps in handler
arguments rather than invoking addon hooks.

For example, `operation=review_settings` selects `postReviewSettings`.
The generic `post` runs first when present. Supplying an unsupported operation
normally fails the availability check before preparation; an `all` method
changes that preflight check and is not an addon shortcut around authorization.

## Ownership and Inheritance

**Hydro owns lifecycle invocation. Handler actions must not call lifecycle
methods themselves.** In particular, do not call `this.prepare()`, `this.post()`,
`super.prepare()`, or another framework entry point from an operation method.
Do not manually run `after` or `cleanup` to simulate dispatch.

The dispatcher looks up each method on the handler instance. Normal inheritance
selects the most-derived implementation; Hydro does not walk and invoke every
ancestor implementation of the same hook. The distinct preparation names
provide separate stages, not an automatic chain of overrides.

Keep reusable work in ordinary, clearly named helpers. This addon uses
`loadBlog()`, `requireRead()` and policy methods for that purpose. For example,
both base and user-specific preparation can call `loadBlog()` rather than one
hook invoking another. Share an authorization helper only when genuinely needed;
do not repeat a preparation check in every action merely to support direct UT
calls.

A manual hook call bypasses the dispatcher's event ordering and handling of
return values. It can repeat queries/checks, run async preparation without
awaiting it, or ignore a control-flow result. Removing such calls must preserve
the hook definition and all action-specific authorization.

## Responsibilities in This Addon

| Stage or method | Responsibility |
| --- | --- |
| `BlogBaseHandler.__prepare` | Load policy and require blog access through `loadBlog()`. |
| `BlogUserBaseHandler.__prepare` | Load policy and resolve the URL user in the system domain. |
| `BlogUserPostBaseHandler._prepare` | Load the article and validate URL-author binding. |
| Create handler `prepare` | Require self-only creation, including for system editors. |
| Edit handler `prepare` | Require authentication and article readability. |
| Article/comment `post` | Require authentication and readability before specific write actions. |
| Review-list/detail `prepare` | Require authentication and the independent review grant. |
| Reset handler `prepare` | Require authentication and the independent reset grant. |
| Report handler `post` | Require authentication; the report operation separately handles readability and own-receipt acknowledgement. |
| Settings handler `prepare` | Require authentication and settings-management authority. |
| `get` / `postXxx` | Apply operation-specific permissions, validated parameters and business logic. |

Do not move every check into a broad inherited hook. For example, read visibility
for an ordinary article is not the same as a reviewer's scoped pending-content
access. A reporter's existing-receipt acknowledgement must not expose a hidden
article. Independent pin/publish/delete permissions must not acquire an edit
requirement. Sudo decorators retain their existing placement and exceptions.

The addon's `handler/before` listener runs **after preparation but before the
HTTP method and operation**. Its UI context is available to rendering/actions,
not to earlier preparation stages. Keep initialization that preparation itself
requires in an earlier stage.

## Arguments, Control Flow and Failure

Hydro passes the request argument object to method stages. `@param` validates
and converts arguments when its decorated method is reached; it does not
independently run authorization hooks. Passing positional values directly can
bypass that wrapper, so validator tests use raw arguments with `domainId`.

A falsy stage result advances to the next stage. A truthy result must identify
an existing dispatch step. Invalid targets throw; backward jumps are warned
about and may repeat stages. Do not return an article or arbitrary success object
from an action: assign `response.body` and use the normal response helpers.

`@requireSudo` can record a redirect and return `cleanup` without calling its
wrapped method. Hydro interprets that result and jumps to cleanup/finish.
Calling decorated handlers as ordinary helper functions is not equivalent to
that control flow.

An exception enters the handler-specific and generic `handler/error` events,
then `onerror`. Failure in error handling produces the framework's fallback
500 response. Normal `after`, `cleanup` and finish stages are **not guaranteed
after an exception**; `cleanup` is not a JavaScript `finally` block. Use scoped
resource management or `try/finally` in ordinary helpers for resources that must
always be released. Native active-handler bookkeeping has its own `finally`.
None of these stages makes persistence, audit and notifications transactional.

## Testing Boundary

Unit fixtures explicitly hydrate users, policy and target documents.
`dispatchHandler` in `tests/helpers/hydro.ts` then invokes `prepare`, optional
generic `post`, and the tested action in order. Authorization-boundary cases
use this helper; spies verify that actions do not invoke the hooks again.
Operation-only UT may assume already-prepared state when testing conversion,
persistence or failure handling.

This helper is intentionally not a second Hydro server: it does not reproduce
route checks, hydration, context events, control-flow jumps, rendering, CSRF or
the complete error lifecycle. Real-Hydro E2E verifies those integrations,
including denied requests and native sudo. See [testing requirements](testing.md).
