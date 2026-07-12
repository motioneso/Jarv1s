# Relay 2 — #854 integration tests pollute shared dev DB

**Supersedes:** `2026-07-07-854-integration-test-db-isolation-relay.md` (read that one only for
the original root-cause research narrative if this doc is unclear — but this doc's design section
overrides that one's Part A proposal, see "Design correction" below).
**Issue:** #854. **Spec:** none (bug fix, `routine` tier).
**Branch/worktree:** `854-integration-test-db-isolation`,
`/home/ben/Jarv1s/.claude/worktrees/854-integration-test-db-isolation` (this worktree).
**Coordinator:** label `Coordinator` — **resolve session id fresh from `herdr pane list` every
time**, it has already changed once (was `e56b7c36-...`, now `9fb2dc84-f605-4580-8ba3-510bbdef6f59`
as of this relay — don't trust either value, re-resolve).
**Relay trigger:** context-meter 70% warning. Coordinator already notified (queued, terse) that
this relay is happening — no action needed from it, next agent messages it when the plan is ready.

## Status: research complete, plan NOT yet written, NO code changes, nothing committed

Do not redo root-cause grounding — it's done and confirmed current on this branch. Go straight to
writing the plan (see "Next step" below) using the design in this doc.

## Root cause (confirmed, still accurate)

- `packages/db/src/urls.ts` `getJarvisDatabaseUrls()` defaults `JARVIS_PGDATABASE` to literal
  `"jarv1s"` (the shared dev DB) when unset.
- `tests/integration/test-database.ts` computes `connectionStrings = getJarvisDatabaseUrls()` once
  at module load, and `resetFoundationDatabase()` (used by the large majority of integration test
  files, directly or via shared harnesses) drops+recreates `app`/`pgboss` schemas then seeds fixture
  users `user-a@example.test`, `user-b@example.test`, `admin@example.test`
  (`is_instance_admin: true`) — this is the exact pollution in #854.
- No code currently creates isolated per-run databases automatically; the only existing precedent
  is fully manual: `"test:commitments": "JARVIS_PGDATABASE=jarvis_build_537 vitest run
  tests/integration/commitments.test.ts"`.

## Confirmed direction (Ben, via coordinator handoff)

Reuse the existing `JARVIS_PGDATABASE` mechanism: make `test:integration` (and sibling per-suite
scripts) always run against a dedicated, auto-generated, per-invocation database — not the shared
default — unless an operator/fleet-agent has already set `JARVIS_PGDATABASE` explicitly (that case
must keep working unchanged, e.g. `jarvis_build_537`).

## Design (fully grounded this session — write straight from this into the plan)

**Part A — new `scripts/test-integration.ts` wrapper**, mirroring the existing
`scripts/smoke-compose.ts` convention (pure plan function + imperative runner + entrypoint guard —
read that file and `tests/unit/prod-compose-plan.test.ts` for the exact pattern to copy):
- Export a pure `createDatabaseIsolationPlan(env: NodeJS.ProcessEnv): DatabaseIsolationPlan` —
  discriminated union `{ mode: "passthrough" } | { mode: "isolated", databaseName: string }`.
  `passthrough` when `env.JARVIS_PGDATABASE` is already set (never touch fleet/agent-set values);
  `isolated` with an auto-generated name (e.g. `` `jarvis_test_${process.pid}_${suffix}` `` — suffix
  needs *some* per-invocation entropy source; `process.pid` alone is fine since these are short-lived
  sequential child processes, or thread a random suffix in from the imperative caller, NOT from
  inside the pure function since `Math.random()`/`Date.now()` should stay out of the unit-tested
  pure core — generate entropy in `main()`, pass it in as a param) when unset.
- Imperative helpers (not unit tested, like `runCommand`/`waitForHealth` in smoke-compose.ts):
  - `ensureDatabaseExists(databaseName)`: connect to the `postgres` maintenance DB via
    `connectionStrings` derived the same way `urls.ts` does (swap the database segment to
    `postgres`), query `pg_database` for existence (PG17 has no `CREATE DATABASE IF NOT EXISTS`),
    `CREATE DATABASE` if absent.
  - `dropDatabaseIfExists(databaseName)`: same maintenance-DB connection, `DROP DATABASE IF EXISTS`
    — call this in a `finally` **only** for the `isolated` branch, never for `passthrough`.
  - `main()`: build the plan, if `isolated` call `ensureDatabaseExists`, set
    `process.env.JARVIS_PGDATABASE` in **this parent process** before spawning the child (vitest
    inherits it — confirmed necessary because `vitest.config.ts` uses `pool: "forks"` +
    `fileParallelism: false`, so env must be set before the child spawns, not mutated from inside a
    per-file module), spawn `vitest run <args from process.argv.slice(2)>` via the same
    `runCommand`-style spawn+exit-code pattern as smoke-compose.ts, then in `finally` drop the
    isolated DB if one was created. **No separate `db:migrate` step** — confirmed unnecessary:
    every DB-touching integration test file bootstraps its own schema via
    `resetFoundationDatabase()`/`resetEmptyFoundationDatabase()` in its own `beforeAll` (proven by
    `test:commitments`'s existing working isolated-DB convention, which also has no separate
    migrate step).
  - Entrypoint guard identical to smoke-compose.ts:
    `if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) { await main(); }`.
- **Unit test** `tests/unit/test-integration-plan.test.ts` (mirror
  `tests/unit/prod-compose-plan.test.ts`): import `createDatabaseIsolationPlan` directly, assert
  `passthrough` when `JARVIS_PGDATABASE` is set in the fake env, `isolated` with a `databaseName`
  when unset.

**Part B — defense-in-depth guard**, `tests/integration/test-database.ts`:
- Add `assertIsolatedTestDatabase()` (or inline the check) that throws if
  `connectionStrings`'s resolved database name equals the shared default — call it at the top of
  `resetFoundationDatabase()` and `resetEmptyFoundationDatabase()`. This catches any direct
  `vitest run tests/integration` invocation that bypasses the Part A wrapper.
- **DRY constant**: add `export const DEFAULT_JARVIS_DATABASE_NAME = "jarv1s";` to
  `packages/db/src/urls.ts`, use it both in `getJarvisDatabaseUrls()`'s fallback (line ~20,
  currently the literal `"jarv1s"`) and in the new guard's comparison — no drift between the two
  literals. Already re-exported automatically via `packages/db/src/index.ts`'s
  `export * from "./urls.js"`, no index.ts change needed.
- **Unit test additions**: extend `tests/unit/db-urls.test.ts` with one test asserting
  `DEFAULT_JARVIS_DATABASE_NAME === "jarv1s"` and that the no-env-var fallback in
  `getJarvisDatabaseUrls()` uses it (keep the 3 existing tests green, don't restructure them).
  Add a focused test file (or extend an existing one) for the new guard — since it needs a live DB
  connection to fully exercise, a lightweight unit-level check (call the guard function directly
  with a mocked/constructed connection string containing the default name, assert it throws
  synchronously before any I/O) is enough; don't require a real Postgres for this specific check if
  the guard can validate the database name from the connection string alone without connecting.

**Part C — reroute ~20 `package.json` `test:*` scripts** through the new wrapper. Read the current
full `package.json` `scripts` block fresh (don't trust a stale list) and change every script that
currently does `vitest run tests/integration...` (or is one of the "6 files that delegate to a
shared harness" mentioned in prior research, e.g. `briefings`) plus `test:memory:local` (confirmed
it imports `resetEmptyFoundationDatabase` from `../integration/test-database.js` directly) to invoke
`tsx scripts/test-integration.ts <same vitest args>` instead of `vitest run <args>` directly.
**Leave untouched:** `test:commitments` (already isolated via explicit `JARVIS_PGDATABASE`),
`test:unit`, `test:e2e`, `test:spike*` (separate DB entirely, own `test-database.ts`),
`db:migrate`, and the `verify:foundation` script itself (only what it calls changes, not its own
line). Also do not touch `spikes/auth-rls-safety/*` or `spikes/pg-boss-rls/*` — confirmed fully
separate DB/harness, out of scope.

## Design correction vs. Relay 1

Relay 1's Part A proposal included running `db:migrate` as a separate child step before `vitest
run`. This session confirmed (by reading `commitments.test.ts`'s working isolated-DB convention and
`test-database.ts`'s `resetEmptyFoundationDatabase()`) that this is unnecessary — drop it. Simpler
plan than Relay 1 described.

## Next step (exact)

1. Invoke `superpowers:writing-plans` → write
   `docs/superpowers/plans/2026-07-07-854-integration-test-db-isolation.md` using the design above,
   broken into bite-sized TDD tasks (test-first for the pure `createDatabaseIsolationPlan` function
   and the `DEFAULT_JARVIS_DATABASE_NAME`/guard addition; the imperative DB-creation/drop helpers and
   `package.json` rewiring don't need unit tests per the smoke-compose.ts precedent, but DO need a
   manual smoke-test step in the plan: run `pnpm test:integration` for real against a scratch DB and
   confirm (a) it passes, (b) `psql` shows the shared `jarv1s` DB's `app.users` table is untouched,
   (c) the isolated DB is dropped after the run).
2. **Message the coordinator** (label `Coordinator`, re-resolve session id fresh via
   `herdr pane list` — do not reuse `9fb2dc84-...` without reconfirming) with the plan file path.
   **STOP and wait for approval — no code before approval.**
3. On approval: TDD build via `superpowers:test-driven-development`, task by task, green commits
   with `Co-Authored-By: Claude` trailer, `git add` by explicit path only.
4. Before any push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
5. `coordinated-wrap-up`: full gate (`pnpm verify:foundation`), push, open PR, report to
   coordinator. Do not merge, touch the board, or close the issue.

## Run-specific bans (still binding)

`git add` by explicit path only (never `-A`); never touch `docs/coordination/`, the board,
milestones, or merge; no secrets in any doc/payload/log; do not touch `packages/sports/*` or Park
Press/#780.
