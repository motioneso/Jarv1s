# Process Crash-Safety + an Honest /health — Design (P1 #54)

**Status:** Approved for build (2026-06-09)
**Date:** 2026-06-09  **Owner:** Ben  **Issue:** #54 (Part of epic #46)

## Context

Three operational gaps in the API and worker:

1. **`/health` lies.** `apps/api/src/server.ts` registers
   `server.get("/health", async () => ({ ok: true }))` — it returns `200 {ok:true}` even when
   Postgres or pg-boss is down. A supervisor / LAN healthcheck can't tell a live-but-broken process
   from a healthy one.
2. **No process-level crash handlers.** Neither `apps/api/src/server.ts` nor `apps/worker/src/worker.ts`
   installs `unhandledRejection` / `uncaughtException` handlers. An unhandled async error can leave a
   zombie process (event loop alive, work stalled) instead of exiting for the supervisor to restart.
   The worker installs only `SIGINT`/`SIGTERM` shutdown; the API installs neither at the process level.
3. **DB pool has no connection timeout.** `packages/db/src/database.ts` builds `new Pool({ connectionString, max })`
   with no `connectionTimeoutMillis`. If Postgres is unreachable, a checkout can hang indefinitely
   rather than failing fast (which also makes a readiness check hang instead of reporting unhealthy).

Single-instance deploy: `infra/docker-compose.yml` runs one `api` + one `worker` + one `postgres`.
The intended recovery model is "crash → supervisor restarts the container," so a clean non-zero exit
on fatal error is the correct behavior (not in-process error swallowing).

## Goals

1. Make `/health` honest: split **liveness** (process is up) from **readiness** (DB + pg-boss reachable).
2. Install `unhandledRejection` + `uncaughtException` handlers in **both** `apps/api` and `apps/worker`:
   structured log, then clean process exit so the supervisor restarts.
3. Add a DB-pool `connectionTimeoutMillis` so an unreachable Postgres fails fast.
4. Test the health **failure** path (readiness reports unhealthy when DB is down).

## Non-Goals

- A metrics/Prometheus endpoint, tracing, or structured-logging framework swap (use Fastify's logger).
- Auto-reconnect/retry loops inside the app (supervisor restart is the recovery model; we only add a
  bounded connection timeout, not an app-level retry policy).
- Graceful in-flight request draining beyond what Fastify `onClose` already does.
- Health checks for downstream connectors (Google), the embedding model, or the vault.
- Worker-side HTTP health endpoint (worker has no HTTP server; its "health" is process liveness +
  crash handlers).

## Resolved Decisions

| # | Decision | Choice | Why |
| - | -------- | ------ | --- |
| 1 | Liveness check shape | `GET /health` → always `200 {ok:true}` (process is up). | Cheap; never touches DB; safe for an aggressive supervisor probe. |
| 2 | Readiness check shape | `GET /health/ready` → checks DB + pg-boss; `200` when all healthy, `503` with per-component status when not. | Standard liveness/readiness split; lets a probe distinguish "restart me" from "don't route traffic yet." |
| 3 | DB readiness probe | `SELECT 1` via the existing `appDb` Kysely handle (no DataContext needed — pre-auth infra check). | Minimal, RLS-irrelevant connectivity probe. |
| 4 | pg-boss readiness probe | A lightweight liveness call on the existing `boss` handle (e.g. `boss.getQueue(RLS_PROBE_QUEUE)` / `isInstalled`), guarded so a "not started" boss reports unhealthy rather than throwing. | Reuses the already-constructed boss; no new connection. |
| 5 | Crash-handler exit | Log structured error, then `process.exit(1)` after a best-effort flush. | Clean non-zero exit = unambiguous "restart me" signal to compose/systemd. |
| 6 | DB connection timeout | `connectionTimeoutMillis` default ~5000ms, env-overridable (`JARVIS_DB_CONNECT_TIMEOUT_MS`). | Fail fast on unreachable DB so readiness returns 503 instead of hanging. |

## Resolved Decisions (was open)

**(A) Health split → two endpoints.** `GET /health` is liveness (always `200`, DB-independent) and
`GET /health/ready` is readiness (checks DB + pg-boss; `200` when healthy, `503` with per-component
status when not). Two tiny route handlers in the same file. This is the convention every supervisor
(compose `healthcheck`, k8s later) expects: liveness must never depend on DB (or a DB blip
restart-loops the process), while readiness must. The split makes that guarantee structural.

**(B) Crash-handler policy → log + best-effort drain + `process.exit(1)`.** Install both
`unhandledRejection` and `uncaughtException` handlers in `apps/api` and `apps/worker`. On either,
emit a structured log, kick off a best-effort, time-boxed (~2s) shutdown (`server.close()` /
`boss.stop()`), then `process.exit(1)` regardless. On `uncaughtException` the process is in an
undefined state, so resuming is never an option — a half-dead process that still passes liveness is
the exact failure this issue exists to kill. Also add a DB pool `connectionTimeoutMillis` so an
unreachable Postgres fails fast instead of hanging the readiness probe.

## Approach

**`packages/db/src/database.ts`:**
- Add `connectionTimeoutMillis` to the `Pool` options, default from `JARVIS_DB_CONNECT_TIMEOUT_MS`
  (fallback 5000). Optional: surface via `DatabaseOptions.connectionTimeoutMillis`. This is the only
  shared-package edit; it benefits both API and worker pools.

**`apps/api/src/server.ts`:**
- Replace the single `/health` handler with:
  - `server.get("/health", ...)` → `{ ok: true }` (unchanged liveness semantics).
  - `server.get("/health/ready", ...)` → run DB `SELECT 1` and the pg-boss probe; return
    `200 { ok:true, db:"ok", pgboss:"ok" }` or `503 { ok:false, db, pgboss }` with each component's
    status. Wrap each probe in try/catch so one failure is reported, not thrown.
- In the `import.meta.url === ...` CLI bootstrap block (the part that calls `server.listen`), install
  `process.on("unhandledRejection", ...)` and `process.on("uncaughtException", ...)` using the handler
  policy from decision B. Keep handlers in the entrypoint block so test usage (`createApiServer` via
  `server.inject`) does not register process-global handlers.

**`apps/worker/src/worker.ts`:**
- Install `process.on("unhandledRejection", ...)` / `process.on("uncaughtException", ...)` alongside
  the existing `SIGINT`/`SIGTERM` handlers, reusing the same structured-log-then-exit(1) policy and the
  existing `shutdown()` (time-boxed). The worker already has `boss.stop` + `workerDb.destroy` in
  `shutdown()`.

**Shared handler helper (optional):** to avoid duplicating the crash-handler body across api+worker
without crossing module boundaries, a tiny exported helper may live in `@jarv1s/jobs` or a small util;
if that adds coupling, inline it in both entrypoints (each is ~10 lines). Recommend inline to keep
module isolation clean.

## Collision notes

- **#54 ↔ #53 share `apps/api/src/server.ts`.** #54 rewrites the `/health` handler and adds the
  process-handler block in the entrypoint; #53 adds a `server.register(@fastify/rate-limit)` call.
  These touch different regions but the same file. **Land #54 first**; #53 rebases its single
  registration line on top.
- **#54 touches `packages/db/src/database.ts` and `apps/worker/src/worker.ts`** — neither is touched by
  #53. #54 does **not** add an npm dependency, so it does **not** collide with #51/#58 on package.json.
- No migration, no schema, no RLS change — zero collision with DB-migration-touching issues.

## Exit Criteria

1. `GET /health` returns `200 {ok:true}` without touching the DB (liveness).
2. `GET /health/ready` returns `200` when DB + pg-boss are reachable, and `503` with per-component
   status when the DB is unreachable — **the failure path is covered by an integration test** (e.g.
   point the server at a dead/destroyed pool or a bad connection string and assert `503`).
3. `apps/api` and `apps/worker` each install `unhandledRejection` + `uncaughtException` handlers that
   log structured error context and exit non-zero (verified by inspection / a focused unit check).
4. The DB pool is constructed with a `connectionTimeoutMillis`; an unreachable DB fails fast rather
   than hanging the readiness probe.
5. `pnpm verify:foundation` green.

## Hard Invariants honored

- Plain Fastify + shared TS contracts preserved — health routes are plain `server.get` handlers.
- DataContextDb only — the readiness probe uses a bare `SELECT 1` infra check on the existing handle;
  it reads no private data and bypasses no RLS (returns no row content).
- Secrets never escape — health responses expose only `ok` / `"ok"|"down"` component flags; never the
  connection string, error stack to clients, or any credential. Stacks go to the structured log only.
- AccessContext shape untouched; no new fields.
- Module isolation — crash-handler logic stays in the two app entrypoints (or a shared util via a
  declared API), never reaching into another module's internals.
