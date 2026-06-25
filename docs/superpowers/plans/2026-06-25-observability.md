# Observability — Frontend Error Capture + Central API Error Handler + Structured Logging

> **For agentic workers:** drive this plan task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax. Each task ends with a green, focused commit (Co-Authored-By: Claude trailer); `git add` only that task's files.

**Goal:** Make client-side crashes and unhandled API errors observable without devtools. Approve spec `docs/superpowers/specs/2026-06-22-observability.md`.

**Architecture:**

1. Frontend `ErrorBoundary` + global unhandled-error/rejection hooks → fire-and-forget `POST /api/errors`.
2. `POST /api/errors` route in `apps/api/src/server.ts` (infrastructure, not a module) — validates body, safe structured log, 204.
3. Central Fastify `setErrorHandler` — extracts only `message`/`code`/`statusCode`, logs structured, returns safe client response (generic message on 5xx).
4. `createModuleLogger(base, module)` in `packages/module-sdk/src/logger.ts`, exported from the package index.
5. Migrate the 12 `console.*` calls across 9 module files to the pino logger.

**Tech Stack:** Fastify 5, React 19 class ErrorBoundary, pino (via Fastify logger), TypeScript, vitest.

**Risk tier:** `security` — network-exposed error endpoint, logging/redaction, no secret leakage. Defensive build: structural allowlist (never spread raw error / request body / headers), bounded payloads, fire-and-forget client reporting.

---

## Spec verification (done before planning)

All spec premises hold on `fix-413-observability` at `9aafadf`:

- No `apps/web/src/shell/error-boundary.tsx`, no `global-error-handler.ts`. `main.tsx` wraps `<App />` directly.
- No `POST /api/errors` route, no `setErrorHandler` in `apps/api/src/server.ts`.
- No `createModuleLogger` in `packages/module-sdk/src/`; `logger.ts` absent.
- 12 `console.*` calls across the 9 cited files (auth/index, briefings/compose×2+jobs+routes×2+schedule, chat/jobs, connectors/google-api-client+oauth+sync-jobs×2).

**One spec deviation (flagged for coordinator):** spec body cites Zod for `/api/errors` validation, but `zod` is not a direct dependency of `@jarv1s/api` or the root (only transitive via better-auth). Adding a direct dep for one tiny schema is over-scope. Plan uses a hand-rolled structural validator with the same security outcome (allowlist fields, type-check, bound lengths, reject malformed → 400 + not logged). If the coordinator prefers Zod, add `zod` to `apps/api/package.json` dependencies — one-line swap.

---

## Task 1 — `createModuleLogger` in module-sdk (TDD)

Foundation piece; later console migrations depend on it.

- [ ] 1.1 Create `packages/module-sdk/src/logger.ts`:

  ```typescript
  import type { FastifyBaseLogger } from "fastify";

  /**
   * Create a child logger tagged with `module`, for a module's setup-time singleton.
   * Modules receive the host Fastify base logger and store the returned child as a
   * module-level const; all module logging routes through it.
   */
  export function createModuleLogger(base: FastifyBaseLogger, module: string): FastifyBaseLogger {
    return base.child({ module });
  }
  ```

- [ ] 1.2 Export from `packages/module-sdk/src/index.ts`: `export { createModuleLogger } from "./logger.js";`
- [ ] 1.3 Test `tests/unit/module-logger.test.ts` — child carries `module` binding; passes through `error`/`warn`/`info`/`debug`. Use a fake `FastifyBaseLogger` (object with `child` spy + level methods) — no Fastify import needed.
- [ ] 1.4 `pnpm typecheck` (module-sdk + root). Commit.

**Files:** `packages/module-sdk/src/logger.ts`, `packages/module-sdk/src/index.ts`, `tests/unit/module-logger.test.ts`.

---

## Task 2 — `POST /api/errors` route + central `setErrorHandler` (TDD, security-critical)

Both live in `apps/api/src/server.ts` and are tested together — they share the redaction/security boundary.

- [ ] 2.1 Create `apps/api/src/client-errors.ts` exporting:
  - `ClientErrorPayload` type (`{ type: string; message: string; stack?: string }`).
  - `MAX_CLIENT_STACK_CHARS = 2000`.
  - `parseClientErrorPayload(body: unknown): ClientErrorPayload | null` — structural validator (allowlist only): returns the normalized payload, or `null` if the body is not a plain object, `type`/`message` are non-empty strings within bounds, or `stack` (if present) is a string. Never throws.
  - Pure, no Fastify dep — unit-testable directly.
- [ ] 2.2 Unit test `tests/unit/client-errors.test.ts`:
  - Accepts well-formed `{type,message}` and `{type,message,stack}`.
  - Rejects: non-object, array, null, missing type, empty message, non-string stack, overlong fields (truncates stack to 2000; rejects overlong type/message), extra fields survive but are dropped by the allowlist.
  - Returns `null` (never throws) for `JSON.parse`-hostile inputs.
- [ ] 2.3 In `apps/api/src/server.ts`, inside `server.after(...)` (BEFORE `registerStaticWeb`), register the route + handler:
  ```typescript
  server.post("/api/errors", async (request, reply) => {
    const payload = parseClientErrorPayload(request.body);
    if (payload === null) {
      // Malformed — 400, and do NOT log as a client error (would be log-spam / an
      // attacker-controlled channel). A 400 here still goes through setErrorHandler.
      return reply.code(400).send({ error: "Bad Request" });
    }
    request.log.error(
      {
        clientError: {
          type: payload.type,
          message: payload.message.slice(0, 500),
          stack: payload.stack?.slice(0, MAX_CLIENT_STACK_CHARS)
        }
      },
      "client error"
    );
    return reply.code(204).send();
  });
  ```
- [ ] 2.4 In `apps/api/src/server.ts`, after the `server.after(...)` block (or inside it, after route registration — anywhere before `ready`), set the central error handler:
  ```typescript
  server.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    request.log.error(
      {
        err: { message: error.message, code: error.code, statusCode },
        reqId: request.id
      },
      "request error"
    );
    const clientMessage = statusCode < 500 ? error.message : "Internal Server Error";
    return reply.status(statusCode).send({ error: clientMessage });
  });
  ```
  Structural allowlist only — never `...error`, never `request.body`/`request.headers`.
- [ ] 2.5 Integration-style test `tests/unit/api-error-handling.test.ts` using `createApiServer({ logger: false })` + `server.inject`:
  - `POST /api/errors` with valid payload → 204; (logger disabled, so assert status only).
  - `POST /api/errors` with malformed body (non-object / missing fields) → 400, response `{error:"Bad Request"}`.
  - An injected route that throws → 500, body `{error:"Internal Server Error"}`, no stack in body.
  - A `HttpError(404, ...)` thrown from a route → 404 with the error message (4xx keeps message).
  - **Secret-leak guard:** register a throwaway test route that throws an `Error` whose `message` and extra props contain fake secrets (`"password=hunter2"`, `stack` with a fake connection string); assert the 500 response body is exactly `{error:"Internal Server Error"}` and contains none of the secret substrings.
  - Note: these tests need no DB if we register the test route via the existing `server.after` seam or a fresh lightweight server. If `createApiServer` requires DB wiring, gate the route-throw test behind a minimal in-memory approach: confirm by reading `createApiServer` — it accepts injected `appDb`/`boss`/`authRuntime`; for the no-DB case pass fakes or skip the throw-route test and cover it via the unit-level handler extraction. **Verify feasibility in 2.1 build step; if `createApiServer` cannot boot without DB, extract `buildErrorHandler()` and `registerClientErrorsRoute(server)` into testable pure-ish helpers and unit-test those instead, with one inject-based smoke test using whatever boot path the existing tests use.**
- [ ] 2.6 `pnpm typecheck`. Commit.

**Files:** `apps/api/src/client-errors.ts`, `apps/api/src/server.ts`, `tests/unit/client-errors.test.ts`, `tests/unit/api-error-handling.test.ts`.

**Security review checklist (self-verify before commit):**

- [ ] No `...error` spread anywhere in the handler.
- [ ] No `request.body`, `request.headers`, `request.cookies` in any log call.
- [ ] 5xx response body is a fixed string, not error-derived.
- [ ] `/api/errors` 400 path does not log the rejected payload.
- [ ] Stack truncated to 2000 chars; message to 500.

---

## Task 3 — Frontend `ErrorBoundary` + global error hooks (TDD)

- [ ] 3.1 Create `apps/web/src/shell/global-error-handler.ts` exporting `reportClientError(payload)` and `registerGlobalErrorHandlers()`:
  - `reportClientError({type, message, stack?})` — `fetch("/api/errors", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({type,message,stack}), keepalive: true})` wrapped in try/catch that swallows all errors (never throws, never recurses).
  - `registerGlobalErrorHandlers()` adds the two `window.addEventListener` listeners (`error` → `uncaught_error`; `unhandledrejection` → `unhandled_promise_rejection`), calling `reportClientError`. Idempotent guard so double-register is a no-op.
- [ ] 3.2 Create `apps/web/src/shell/error-boundary.tsx` — React class component `ErrorBoundary`:
  - `state = { hasError: boolean }`.
  - `static getDerivedStateFromError()` → `{hasError:true}`.
  - `componentDidCatch(error, info)` → `reportClientError({type:"react_error", message: error.message, stack: error.stack})`.
  - Render: `hasError` → fallback UI ("Something went wrong." + Reload button calling `window.location.reload()`); else `children`.
- [ ] 3.3 Test `tests/unit/error-boundary.test.tsx` (renders with the React/jsdom env the existing root suite uses — confirm test runner config supports `.test.tsx`; the root `vitest.config.ts` includes `tests/**/*.test.tsx`):
  - Renders children normally.
  - A child that throws on render → fallback UI shows, reload button present.
  - `reportClientError` is called with `type:"react_error"`.
  - Use a spy on the fetch / on the module's exported `reportClientError`.
- [ ] 3.4 Test `tests/unit/global-error-handler.test.ts`:
  - `registerGlobalErrorHandlers()` then dispatch synthetic `error` and `unhandledrejection` events on `window` → `fetch` called with `/api/errors` POST and correct payload shape.
  - `reportClientError` swallows a failing `fetch` (mock `fetch` to throw) — no unhandled rejection.
  - Idempotency: calling register twice wires listeners once (assert via listener-count spy).
- [ ] 3.5 Wire into `apps/web/src/main.tsx`: call `registerGlobalErrorHandlers()` before `createRoot`; wrap `<App />` with `<ErrorBoundary>` inside `<QueryClientProvider>` (boundary outside query provider so a query error doesn't crash the boundary — but the spec says top-level; place boundary immediately around `<App />`, inside providers, per spec diagram).
- [ ] 3.6 `pnpm typecheck` (incl. `@jarv1s/web typecheck`). Commit.

**Files:** `apps/web/src/shell/global-error-handler.ts`, `apps/web/src/shell/error-boundary.tsx`, `apps/web/src/main.tsx`, `tests/unit/global-error-handler.test.ts`, `tests/unit/error-boundary.test.tsx`.

---

## Task 4 — Migrate `console.*` → pino logger (mechanical)

For each file, thread/obtain the logger and replace the `console.*` call. No logic changes.

- [ ] 4.1 `packages/briefings/src/compose.ts` (×2, lines ~203 and ~393): the module already receives a logger via setup — confirm and pass through; replace `console.error(JSON.stringify({...}))` with `logger.error({...}, "briefing_tool_failed")`.
- [ ] 4.2 `packages/briefings/src/jobs.ts` (~168): use the job's existing `logger` param.
- [ ] 4.3 `packages/briefings/src/routes.ts` (×2, ~82, ~251): use `request.log`.
- [ ] 4.4 `packages/briefings/src/schedule.ts` (~99): use the module logger (thread from setup if not already).
- [ ] 4.5 `packages/chat/src/jobs.ts` (~264): use the job's existing `logger` param.
- [ ] 4.6 `packages/connectors/src/google-api-client.ts` (~78): currently `deps.logger ?? {error: (d,m)=>console.error(m,d)}` — thread logger from module setup; drop the console fallback (require the logger).
- [ ] 4.7 `packages/connectors/src/oauth.ts` (~64): thread logger from module setup.
- [ ] 4.8 `packages/connectors/src/sync-jobs.ts` (×2, ~120-121): use the job's existing `logger` param (the fallback `{warn:..., info:...}` console object — replace with the real logger).
- [ ] 4.9 `packages/auth/src/index.ts` (×2, ~535, ~614): thread the logger the module already receives (authRuntime takes a `logger` — see server.ts:123 `logger: server.log`).
- [ ] 4.10 Verify zero remaining `console.*` in the 9 files: `grep -rn "console\." packages/{auth,briefings,chat,connectors}/src` → empty.
- [ ] 4.11 Run any existing focused tests for these packages if present; `pnpm typecheck`. Commit.

**Files:** the 9 cited files. **Stage only these files** for this commit.

---

## Task 5 — Full gate + wrap-up

- [ ] 5.1 `pnpm format:check` (run `pnpm format` if drift).
- [ ] 5.2 `pnpm lint`.
- [ ] 5.3 `pnpm typecheck`.
- [ ] 5.4 `pnpm test:unit` (covers all new unit tests).
- [ ] 5.5 `grep -rn "console\." packages/{auth,briefings,chat,connectors}/src apps/web/src/shell apps/api/src` → only intentional (none expected in migrated files; test files may use console).
- [ ] 5.6 Secret-leak self-audit: re-read `setErrorHandler` and `/api/errors` handler; confirm no body/header/cookie/raw-error logging.
- [ ] 5.7 `coordinated-wrap-up`: push branch, open PR, report to coordinator with evidence.

**DB gate:** not required for this spec (no DB-backed log store). If `pnpm test:integration` is invoked by the wrap-up gate and needs DB, use `JARVIS_PGDATABASE=jarvis_build_413`. The new tests are unit-level (no DB).

---

## Exit Criteria (from spec) — all mapped

| Spec acceptance criterion                                                                            | Task                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------ |
| React error caught by `ErrorBoundary`, fallback renders, logs `client error` w/ `type:"react_error"` | 3                        |
| Unhandled promise rejection captured, reaches API log                                                | 3                        |
| Unhandled API exception → `{"error":"Internal Server Error"}`, 500, no stack                         | 2                        |
| `docker compose logs api` shows structured entry per unhandled API error                             | 2                        |
| No creds/tokens/hashes/prompts in any log line                                                       | 2 (structural allowlist) |
| Zero `console.*` in the 9 migrated files                                                             | 4                        |
| `createModuleLogger` exported from `@jarv1s/module-sdk`                                              | 1                        |
| `pnpm verify:foundation` green                                                                       | 5                        |

---

## Out of scope (per spec)

- No DB-backed log store, log viewer UI, external error-tracking service, or visual redesign.
- No changes to `docs/coordination/`, project boards, milestones, or main-worktree docs.
