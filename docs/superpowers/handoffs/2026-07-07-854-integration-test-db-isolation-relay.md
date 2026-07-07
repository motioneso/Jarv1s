# Relay — #854 integration tests pollute shared dev DB

**Issue:** #854 — `test:integration` writes fixture users (incl. `is_instance_admin: true`) into
the shared dev Postgres `jarv1s` database, breaking first-owner bootstrap for anyone running the
suite locally.
**Spec:** none — bug fix, `routine` tier. See `docs/coordination/handoff-854-integration-test-db-isolation.md`
(read that IN FULL too — this doc only supplements it, doesn't replace it).
**Branch/worktree:** `854-integration-test-db-isolation`,
`/home/ben/Jarv1s/.claude/worktrees/854-integration-test-db-isolation` (this worktree).
**Coordinator:** label `Coordinator`, session id `e56b7c36-6f1b-4438-85ef-bb5cad9eed74`. Resolve
fresh by label+session id from `herdr pane list` every time — never a cached `…-N`.
**Relay trigger used:** context-meter 70% warning.

## What's done

Research only — **no code changes, no commits yet**. Root cause fully confirmed by reading:
- `tests/integration/test-database.ts` — `connectionStrings = getJarvisDatabaseUrls()` computed
  once at module load; `resetFoundationDatabase()`/`seedProbeData()` (used by 105 of ~140
  integration test files) drops+reseeds `app`/`pgboss` schemas with hardcoded fixture users
  (`user-a@example.test`, `user-b@example.test`, `admin@example.test` w/ `is_instance_admin: true`)
  — exact match to the issue.
- `packages/db/src/urls.ts` — `getJarvisDatabaseUrls()` defaults `JARVIS_PGDATABASE` to the literal
  shared name `"jarv1s"` when unset. This is the single source of the shared-DB behavior.
- `scripts/migrate.ts` — connects directly to the target DB name; does **not** create it. Any
  "ensure DB exists" logic must query `pg_database` first (PG17 has no `CREATE DATABASE IF NOT
  EXISTS` — that's PG18+), then `CREATE DATABASE`, connecting via the `postgres` maintenance DB
  (always exists on the cluster regardless of `docker-compose`'s `POSTGRES_DB: jarv1s`).
- `infra/docker-compose.yml` — postgres service confirmed PG17 (`pgvector/pgvector:pg17`).
- `.github/workflows/ci.yml` — CI is **not** affected (fresh ephemeral `pnpm db:up` container per
  run, no persisted volume, no `JARVIS_PGDATABASE` set). This bug is purely a local persistent-dev-
  Postgres problem — fix's value is local-only.
- `tests/unit/db-urls.test.ts` — 3 existing unit tests pin `getJarvisDatabaseUrls()`'s contract
  (dev fallback params, prod fail-closed, prod full-override). Any change to `urls.ts` must keep
  these green or update them deliberately.
- `vitest.config.ts` — `pool: "forks"`, `fileParallelism: false`, `setupFiles: ["tests/setup-env.ts"]`.
  Confirmed: mutating `process.env.JARVIS_PGDATABASE` from inside a per-file module loaded by
  vitest (like `test-database.ts`) is unreliable for guaranteeing every forked worker sees it
  consistently — the isolation should be set in the **parent** process before vitest even starts.
- `package.json` — `"test:integration": "vitest run tests/integration"` (no wrapper today). Existing
  prior art for manual isolation: `"test:commitments": "JARVIS_PGDATABASE=jarvis_build_537 vitest
  run tests/integration/commitments.test.ts"` — fully manual, no automated "ensure DB exists"
  helper exists anywhere in the repo yet.
- Saved as agentmemory `bug`-type memory (project `jarv1s`, id `mem_mrb5t6bq_53f86d99bd08`) covering
  this same root-cause analysis — recall it (`memory_smart_search "jarv1s integration test trap"`)
  rather than re-deriving from scratch.

Also confirmed still current on this branch at read time: issue #854 still open, all cited files
still match the description above (no drift since the handoff was written).

## What's left (in order)

1. **Write the TDD plan** via `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-07-854-integration-test-db-isolation.md`.
   Planned two-part design (not yet approved, not yet built — treat as a starting proposal, verify
   it still makes sense before committing to it):
   - **Part A — wrapper script** replacing the raw `vitest run tests/integration` invoked by
     `test:integration` (and ideally the other per-suite scripts that call `vitest run
     tests/integration/<file>.test.ts` directly, if in scope): when `JARVIS_PGDATABASE` is **not**
     already explicitly set in the environment, auto-generate a per-invocation isolated DB name
     (e.g. `jarvis_test_<pid>_<random>` or similar — avoid `Date.now()`/timestamps sourced from
     inside a vitest config since that's a static file, this is fine in a plain Node/tsx script),
     ensure it exists (connect to `postgres` maintenance DB as superuser, check `pg_database`, then
     `CREATE DATABASE` if absent), set `JARVIS_PGDATABASE` in the **parent** process env before
     spawning vitest as a child (so all forked workers inherit it via normal env inheritance,
     regardless of `pool`/`fileParallelism` internals), then run `db:migrate` + `vitest run
     tests/integration` as children, and in a `finally` block drop the ephemeral database
     afterward — but **only** for auto-generated names, never for an explicitly pre-set
     `JARVIS_PGDATABASE` (preserves existing fleet/agent-set isolation conventions, e.g.
     `jarvis_build_537`).
   - **Part B — defense-in-depth guard** inside `tests/integration/test-database.ts`: hard-refuse
     (throw) in `resetFoundationDatabase()`/`resetEmptyFoundationDatabase()` if the resolved
     database name is literally the shared default `"jarv1s"` — covers any direct `vitest`
     invocation that bypasses the Part A wrapper.
   - Keep `tests/unit/db-urls.test.ts` green throughout; add new unit coverage for any new
     "ensure database exists" helper and for the Part B guard.
2. **Message the coordinator** (label `Coordinator`, verify exactly one pane holds it, resolve
   session id fresh) with the plan path. **STOP and wait for approval before writing any code.**
3. **Implement with `superpowers:test-driven-development`**, task by task, green commits, `git add`
   by explicit path only.
4. **Pre-push checks** before any push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
5. **`coordinated-wrap-up`** — clean tree, full gate, push, open PR, report PR + evidence to the
   coordinator. Do not merge, touch the board, or close the issue myself.

## Run-specific bans (carried over from the handoff — still binding)

`git add` by explicit path only (never `-A`); never touch `docs/coordination/`, the board,
milestones, or merge; no secrets in any doc/payload/log; do not touch `packages/sports/*` or Park
Press/#780.
