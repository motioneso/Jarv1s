# Relay — js-05-monitoring (#934) — continuation 3

**You are the Fable successor for the JS-05 build.** Same worktree
(`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/js-05-monitoring`),
branch `feat/js-05-monitoring`, security tier, zero migrations.

## Pointers (read by section, never in full)

- Build handoff (rules, bans, coordinator routing): `docs/coordination/2026-07-11-js-05-build-handoff.md` — short, read first.
- Spec: `docs/superpowers/specs/2026-07-10-job-search-js-05-monitoring.md` (~53 lines).
- **Plan: `docs/superpowers/plans/2026-07-11-js-05-monitoring.md`** — read ONE task at a time.
  `grep -n "^###"` fails on this file; locate tasks with `grep -anE "Task [0-9]+:"`.
  Offsets: Task 5 @ line 1372, Task 6 @ 1481, wrap-up @ 1548.

## State

- **Coordinator APPROVED the plan and all three scope flags** (stale-marking deferred to JS-07;
  UTC/07:00 defaults preserved-on-update; run-now jobKind `job-search.monitor-run-now` with
  metadata-only `{ monitorId }` + platform singleton key). No re-approval needed — build.
- Coordinator routing: label `Coordinator`, session id authority
  `58a78927-385c-4b1d-8fa0-94db20255d6f`; verify EXACTLY ONE pane via fresh `herdr pane list`.
- **DONE (committed green):**
  - Task 1 — `17b19989` schedule domain (schedule.ts, keys, barrels, 14 tests).
  - Task 2 — `0de0116f` monitor.save timezone/dueTime (handler + manifest + pins).
  - Task 3 — `3c020956` discovery core: `src/worker/handlers/run.ts`
    (`runMonitorDiscovery`, `deriveRunId`, `postingToOpportunity`), `WorkerPorts.fetch`
    (optional-nullable `AdapterFetch`) in ai-port.ts, `ctx.fetch → fetchFromWorkerContext`
    wired in worker/index.ts; tests in
    `tests/unit/external-module-job-search-handlers-run.test.ts`.
  - Task 4 — `606f7b9c` `monitorRunHandler` dispatch (`job-search.monitor-sweep` /
    `job-search.monitor-run-now`), registry wires `"monitor.run"`; sweep/run-now tests added;
    capture + onboarding test pins updated.
- Module sweep after Task 4: 27 test files / 366 tests green. Tree clean except
  `.claude/context-meter.log` (never stage it).

## Learnings from Tasks 3–4 (already applied — context, not TODOs)

- `upsertOpportunity.suppressed` = tombstone only; idempotent re-sighting is detected by
  comparing pre/post `contentHash` (see run.ts ingest loop comment). Plan text was wrong here;
  the fix is committed and tested.
- capture.test.ts's old compile-time "no fetch member on WorkerPorts" pin was flipped to an
  optional-fetch proof + source-level `\bfetch\b` grep on capture.ts (fetch port now exists).
- `ctx.fetch` is already typed required on `ModuleWorkerContext` — no cast needed; guard
  `ctx.fetch ? … : null` kept for older hosts (degrades to `fetch_unavailable` run record).

## Next: Task 5 (plan lines 1372–1480)

Manifest cron + `allowManualRun`. Then Task 6 (cross-owner isolation proof, lines 1481–1547),
then wrap-up (line 1548+): pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`)
+ `git fetch origin main && git rebase origin/main`, then `coordinated-wrap-up`
(PR `Closes #934`, report to Coordinator; never merge/board).

## Standing rules

TDD (RED before GREEN), green commit per task with `Co-Authored-By: Claude Fable 5
<noreply@anthropic.com>`, `git add` explicit paths ONLY. Metadata-only payloads/run records (error
CODES, never titles/URLs/transport text). All network via JS-04 `fetchBoard`; no network
primitives in capture.ts. Never touch `docs/coordination/` beyond reading; never merge/board.
Test command: `pnpm vitest run tests/unit/<file>`. Relay again only past ~80% real work.
