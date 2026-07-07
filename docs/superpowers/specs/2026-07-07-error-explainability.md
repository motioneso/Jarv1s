# Error Explainability

- **Issue:** #817 (Jarvis should be able to explain user-visible errors)
- **Brief:** confirmed by Ben 2026-07-07, slug `error-explainability`
- **Status:** DRAFT — awaiting Ben's approval before `/plan`/`/build`
- **Proposed tier:** `sensitive` (new cross-cutting data surface; not auth/RLS/secrets, but touches
  every module's error path and adds a new queryable store) — confirm against the coordinator's
  tiering table once scope is agreed.

## Context

Confirmed brief:

- **Problem:** silent breakage (e.g. "not all leagues could be loaded") gives no path to the
  underlying cause.
- **User:** everyone — anyone asking "what does X mean" should learn why.
- **Success:** Jarvis can identify the source of any error message and read/surface the relevant
  logs.
- **Non-goal:** no auto-fix — explain only.
- **MVP:** user asks a natural-language question about a symptom; Jarvis reads logs to answer.
  Load-bearing precondition: errors must actually be written to a log Jarvis can read.
- **Verification:** when an error occurs, ask Jarvis about it; confirm it explains the actual
  cause, not just the raw message.

Issue #817's suggested shape (from the report, not yet a commitment):

```json
{
  "timestamp": "2026-07-06T...",
  "feature": "sports",
  "league": "...",
  "operation": "fetch_scores",
  "error_category": "upstream_provider_unavailable",
  "retryable": true,
  "user_message": "Scores are temporarily unavailable for some leagues",
  "internal_summary": "Provider returned partial league data; schedules available, live scores missing"
}
```

**Load-bearing gap found during scoping:** the MVP precondition is not yet satisfied anywhere in
the codebase.

- `docs/superpowers/specs/2026-06-22-observability.md` (#413, approved & built) made an explicit
  decision (D2): log persistence is ephemeral (`docker compose logs api` only); DB persistence was
  explicitly deferred to "admin diagnostics (#255)."
- #255 is closed, but its actual scope (confirmed by reading `packages/settings/src/
  host-diagnostics.ts`) was wiring the settings-admin `HostPane` UI placeholders — live
  connectivity checks (DB/pg-boss/multiplexer), not an error-event table. No DB persistence of
  errors was ever built.
- Conclusion: **no structured, queryable error store exists today.** The only error trail is
  `docker compose logs api` (host-only, not app-queryable). This spec therefore designs new scope,
  not just a read path over existing data — flagged to Ben per the `/start` protocol.

## Goals

1. Every unhandled API request error and every client-reported error is persisted as a structured,
   queryable event (not just logged to stdout).
2. A chat tool lets Jarvis look up recent errors — by feature/operation, by rough time window, or
   "the error the user just saw" — and answer with cause, category, and retryability.
3. If no diagnostic data exists for what the user is asking about, Jarvis says so explicitly and
   names the missing instrumentation (per #817's acceptance criteria), instead of speculating.

## Non-Goals

- No auto-fix, no automated remediation, no alerting/paging.
- No raw provider payloads, stack traces, request bodies, headers, or cookies exposed to chat —
  same secrets-never-escape boundary #413 already established for logs.
- No cross-user visibility: a user can only ask about their own errors (owner-scoped, RLS-enforced,
  same as every other private-by-default resource).
- No change to the existing ephemeral `docker compose logs` behavior — this adds a parallel
  structured store, it doesn't replace host log access.
- No retention/alerting dashboard UI in this slice — chat is the only read surface for MVP.

## Resolved Decisions

- **D1 — New table, not a reuse of `jarvis_action_audit_log`.** `packages/ai/sql/
  0127_jarvis_action_audit_log.sql` audits *tool-call outcomes* (approval mode, action family) —
  a different concept from *unhandled request/client errors*. Reusing it would conflate action
  auditing with error diagnostics and violate its existing CHECK constraints (`outcome`,
  `approval_mode` don't fit an arbitrary API error). New table: `app.jarvis_error_log`.
- **D2 — Ownership: new minimal module, not an existing feature module.** Errors originate from
  every module plus `apps/api`'s own composition root, so this doesn't fit inside any single
  feature module (module-isolation invariant: modules collaborate only via declared public
  APIs/events, no module should own another's failures). `packages/settings` (home of #255's
  diagnostics) is admin/host config, not an event-data plane, and isn't the right home either.
  Proposal: a new `packages/observability` module owning the table, the write API, and the chat
  tool; `apps/api/src/error-handling.ts` (the central `setErrorHandler` + `/api/errors` client sink)
  and `createModuleLogger` call sites become its callers, which is consistent with how `apps/api`
  already wires every module's public API today.
- **D3 — Schema mirrors the `jarvis_action_audit_log` RLS/retention pattern.** Owner-scoped
  `FORCE ROW LEVEL SECURITY`, `SELECT`+`INSERT` only granted to the app runtime role, a
  `SECURITY DEFINER` purge function for retention (mirrors `packages/ai/sql/
  0127_jarvis_action_audit_log.sql`). Fields adapted from #817's suggested shape:
  `id, owner_user_id, occurred_at, feature, operation, error_category, retryable, user_message,
  internal_summary, request_id`. `owner_user_id` is nullable for errors that occur before auth is
  established (matches the existing unauthenticated `/api/errors` sink) — unauthenticated errors
  are visible only via a maintenance/service path, never surfaced to any user's chat tool.
- **D4 — Write path taps the two existing, already-secret-safe call sites.** `setJarvisErrorHandler`
  (`apps/api/src/error-handling.ts:133`) and `registerClientErrorsRoute`
  (`apps/api/src/error-handling.ts:99`) already construct allowlisted, secret-free structured
  objects before logging (`err: {message, code, statusCode}` / `clientError: {type, message,
  stack}`). The new write path reuses those same allowlisted objects — it does not introduce a
  new place where raw errors are handled, so the existing secrets-never-escape structural
  guarantee carries over unchanged. `feature`/`operation` are derived from route metadata already
  available at the error-handler call site (e.g. route pattern → module mapping), not from
  free-text error messages.
- **D5 — Read path is a chat tool, following the `packages/chat/src/tools.ts` convention.** Same
  shape as `chatListTodaysTurnsExecute`: a `ToolExecute` that calls `assertDataContextDb(scopedDb)`,
  queries the owner-scoped table via `DataContextDb`, and returns a bounded, recency-ordered result
  set (mirrors the existing `MAX_THREADS_SCANNED`/`MAX_TURNS` bounding pattern). No new module-SDK
  primitives needed — `ToolExecute`/`ToolResult` from `@jarv1s/module-sdk` already cover this.

## Architecture

```
apps/api error-handling.ts (setJarvisErrorHandler, registerClientErrorsRoute)
        │  allowlisted {message, code, statusCode} / {type, message, stack}
        ▼
packages/observability  (new)
  ├─ sql/0145_jarvis_error_log.sql   — table + RLS + purge fn (mirrors 0127 pattern)
  ├─ src/write.ts                    — recordError(scopedDb, {...}) public API
  ├─ src/tools.ts                    — errorExplainRecentExecute: ToolExecute
  └─ src/index.ts                    — module registration (public API + tool export)
        │
        ▼
packages/chat  — tool registry picks up the new ToolExecute like any module tool
```

Module SDK's existing `createModuleLogger` convention is untouched — this is additive persistence
on top of existing structured logging, not a replacement.

## What This Is NOT

- Not a replacement for `docker compose logs` — that stays the host-level ephemeral view.
- Not a general-purpose event/analytics table — scoped to error diagnostics only.
- Not an admin/ops dashboard — chat is the only consumer in this slice; a future settings-admin
  "recent errors" view is out of scope here and would be its own follow-up issue.
- Not alerting — no notification, paging, or proactive surfacing; the user must ask.

## Exit Criteria

- [ ] Migration `packages/observability/sql/0145_jarvis_error_log.sql` lands: table, indexes,
      owner-scoped RLS (`FORCE ROW LEVEL SECURITY`), purge function — modeled on 0127.
- [ ] `setJarvisErrorHandler` and `registerClientErrorsRoute` write a row via the new module's
      public API in addition to their existing log line, using only already-allowlisted fields.
- [ ] A chat tool exists that: given a natural-language question about a recent error, returns the
      matching structured event(s) bounded to the requesting user's own errors.
- [ ] When no matching error data exists, the tool result makes that explicit (not a guess) and
      names what instrumentation is missing, per #817's acceptance criteria.
- [ ] Secrets-never-escape: no raw stack trace, request body, header, cookie, or provider payload
      reaches the chat tool's output — verified by the same kind of structural test #413 used for
      `error-handling.ts`.
- [ ] Full local gate (`pnpm verify:foundation`) green, including a new migration-list assertion
      update in `foundation.test.ts` for the new migration row.
