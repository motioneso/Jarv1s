# Observability — frontend error capture, centralized API error handler, structured logging

**Status:** Approved design — ready to build
**Date:** 2026-06-22
**Owner:** Ben
**GitHub:** #413 (observability); part of #382
**Grounded on:** `origin/main` @ `15448ba` (current branch `docs/update-stale-documentation`,
docs-only ahead, source tree unchanged).

---

## Goal

Make client-side crashes and API errors visible without opening devtools. Every unhandled frontend
error must reach the API log. Every unhandled API error must return a consistent, safe response
and produce a structured log entry. The 12 stray `console.*` calls across 9 module files must
route through the pino logger.

Success = on the deployed instance: a React crash produces a log line in `docker compose logs
api`; an unhandled API exception returns `{"error":"Internal Server Error"}` with no stack/secret
leakage; `docker compose logs api` is the single place to look when something breaks.

---

## Design decisions (interview-confirmed)

| #   | Decision                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------- |
| D1  | Frontend errors → POST to `/api/errors` → pino log. No DB table, no external service.                           |
| D2  | Log persistence: **ephemeral** — `docker compose logs api` only. DB table deferred to admin diagnostics (#255). |
| D3  | All 12 `console.*` calls across 9 files migrated to structured pino in this build.                              |

---

## Architecture

### 1. Frontend error capture (`apps/web/src/`)

#### `ErrorBoundary` component (`apps/web/src/shell/error-boundary.tsx`)

Top-level React `ErrorBoundary` wrapping `<App />` in `main.tsx`. On `componentDidCatch`:

- POSTs `{ type: "react_error", message, stack, componentStack }` to `/api/errors`
- Renders a minimal fallback: "Something went wrong. Reload the page." with a reload button.
- No visual redesign — functional default; visual pass deferred.

#### Global unhandled-error hook (`apps/web/src/shell/global-error-handler.ts`)

Registered once at app boot (in `main.tsx`, before `createRoot`):

```typescript
window.addEventListener("error", (event) => {
  reportClientError({ type: "uncaught_error", message: event.message, stack: event.error?.stack });
});
window.addEventListener("unhandledrejection", (event) => {
  reportClientError({
    type: "unhandled_rejection",
    message: String(event.reason),
    stack: event.reason?.stack
  });
});
```

`reportClientError` fires-and-forgets a `fetch` POST to `/api/errors`. Never throws — errors
during error reporting are swallowed (to avoid infinite loops).

#### `/api/errors` endpoint

A lightweight route added directly to `apps/api/src/server.ts` (infrastructure, not a module):

```typescript
server.post("/api/errors", async (request, reply) => {
  const { type, message, stack } = request.body as ClientErrorPayload;
  request.log.error(
    { clientError: { type, message, stack: stack?.slice(0, 2000) } },
    "client error"
  );
  return reply.status(204).send();
});
```

- No auth required (errors can happen before auth state is known; the endpoint only logs, stores nothing).
- Stack truncated to 2000 chars before logging — caps log volume.
- Body validated with a Zod schema; malformed payloads return 400 and are not logged.

### 2. Centralized API error handler (`apps/api/src/server.ts`)

```typescript
server.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode ?? 500;

  // Log structured error — never spread the raw error object (stack may contain paths/internals)
  request.log.error(
    {
      err: { message: error.message, code: error.code, statusCode },
      reqId: request.id
    },
    "request error"
  );

  // Safe response — no stack, no internal message on 5xx
  const clientMessage = statusCode < 500 ? error.message : "Internal Server Error";
  return reply.status(statusCode).send({ error: clientMessage });
});
```

**Secrets-never-escape invariant:** the handler extracts only `message`, `code`, and `statusCode`
from the error object. It never spreads `error`, never logs `request.body` or `request.headers`,
never forwards stack traces to the client. This is structural, not a denylist — unknown fields
are simply never included.

### 3. Structured logging convention

#### Module logger utility (`packages/module-sdk/src/logger.ts`)

```typescript
import type { FastifyBaseLogger } from "fastify";

export function createModuleLogger(base: FastifyBaseLogger, module: string): FastifyBaseLogger {
  return base.child({ module });
}
```

Exported from `@jarv1s/module-sdk/index.ts`. Modules call this in their setup function and
store the child logger as a module-level const.

#### Log level convention

| Level   | Use                                                          |
| ------- | ------------------------------------------------------------ |
| `error` | Unhandled exceptions, failed jobs, security violations       |
| `warn`  | Degraded operation (e.g. provider unavailable, retry needed) |
| `info`  | Significant lifecycle events (module init, job start/end)    |
| `debug` | Per-request detail; only emitted when `LOG_LEVEL=debug`      |

No `console.*` calls in production code. The `console` global is available in test files only.

#### Migration: 9 files → structured pino

| File                                           | Current call         | Fix                                                 |
| ---------------------------------------------- | -------------------- | --------------------------------------------------- |
| `packages/auth/src/index.ts`                   | `console.error`      | Thread logger from module setup; use `logger.error` |
| `packages/briefings/src/compose.ts` (×2)       | `console.error/warn` | Module already receives logger; pass through        |
| `packages/briefings/src/jobs.ts`               | `console.error`      | Use job's existing `logger` param                   |
| `packages/briefings/src/routes.ts` (×2)        | `console.error`      | Use `request.log`                                   |
| `packages/briefings/src/schedule.ts`           | `console.error`      | Use module logger                                   |
| `packages/chat/src/jobs.ts`                    | `console.error`      | Use job's existing `logger` param                   |
| `packages/connectors/src/google-api-client.ts` | `console.error`      | Thread logger from module setup                     |
| `packages/connectors/src/oauth.ts`             | `console.error`      | Thread logger from module setup                     |
| `packages/connectors/src/sync-jobs.ts` (×2)    | `console.error`      | Use job's existing `logger` param                   |

All replacements are mechanical — no logic changes.

---

## What this is NOT

- Not a user-facing audit/activity log (#223) — this is dev/ops observability only.
- Not an error tracking service (Sentry, Datadog, etc.) — out of scope for a self-hosted instance.
- Not a DB-persisted error store — deferred to admin diagnostics (#255).
- Not a log viewer UI — logs live in `docker compose logs api`.

---

## Sequencing note

Issue body flags collision risk with the active v0.1.6 wave (`#319` touches `server.ts`,
`#398/#411` touch `app.tsx`). Build this **after** the v0.1.6 wave lands on main to avoid
merge conflicts on those shared files.

---

## Acceptance criteria

- [ ] A thrown React error in a component is caught by `ErrorBoundary`; fallback UI renders;
      `docker compose logs api` shows a `client error` log line with `type: "react_error"`
- [ ] An unhandled promise rejection in the browser is captured; appears in `docker compose logs api`
- [ ] An unhandled exception in an API route returns `{"error":"Internal Server Error"}` with
      status 500; no stack trace or internal detail in the response body
- [ ] `docker compose logs api` shows a structured log entry for every unhandled API error
- [ ] No connector credentials, session tokens, password hashes, or prompts appear in any log line
- [ ] Zero `console.*` calls remain across the 9 migrated files
- [ ] `createModuleLogger` is exported from `@jarv1s/module-sdk`
- [ ] `pnpm verify:foundation` green
