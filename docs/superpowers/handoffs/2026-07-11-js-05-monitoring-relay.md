# Relay — js-05-monitoring (#934) — continuation 2

**You are the Fable successor for the JS-05 build.** Same worktree
(`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/js-05-monitoring`),
branch `feat/js-05-monitoring`, security tier, zero migrations.

## Pointers (read by section, never in full)

- Build handoff (rules, bans, coordinator routing): `docs/coordination/2026-07-11-js-05-build-handoff.md` — short, read first.
- Spec: `docs/superpowers/specs/2026-07-10-job-search-js-05-monitoring.md` (~53 lines).
- **Plan: `docs/superpowers/plans/2026-07-11-js-05-monitoring.md`** — read ONE task at a time.
  `grep -n "^###"` fails on this file; locate tasks with `grep -anE "Task [0-9]+:"`.
  Offsets: Task 3 @ line 603, Task 4 @ 1108, Task 5 @ 1372, Task 6 @ 1481, wrap-up @ 1548.

## State

- **Coordinator APPROVED the plan and all three scope flags** (stale-marking deferred to JS-07;
  UTC/07:00 defaults preserved-on-update; run-now jobKind `job-search.monitor-run-now` with
  metadata-only `{ monitorId }` + platform singleton key). No re-approval needed — build.
- Coordinator routing: label `Coordinator`, session id authority
  `58a78927-385c-4b1d-8fa0-94db20255d6f`; verify EXACTLY ONE pane via fresh `herdr pane list`.
- **DONE (committed green):**
  - Task 1 — `17b19989` schedule domain (`src/domain/schedule.ts`, keys.ts `monitorSchedule`,
    barrel exports, deleteMonitor drops schedule state; 14 tests in
    `tests/unit/external-module-job-search-schedule.test.ts`).
  - Task 2 — `0de0116f` monitor.save timezone/dueTime (handler + manifest inputSchema + response
    echoes; pins updated in handlers-monitor + manifest tests).
- Full unit suite after Task 2: 353 files / 2792 passed / 2 skipped, zero regressions.
- Tree clean except `.claude/context-meter.log` (never stage it).

## Next: Task 3 (plan lines 603–1107)

WorkerPorts.fetch + discovery core: new `src/worker/handlers/run.ts` with `runMonitorDiscovery`
(JS-04 `fetchBoard` safe reader → `upsertOpportunity` → retention → `recordRun`), add `fetch` to
`WorkerPorts` in `ai-port.ts`, wire `ctx.fetch` → worker/index.ts. Test file to create:
`tests/unit/external-module-job-search-handlers-run.test.ts`. Then Task 4 (dispatch sweep +
run-now), Task 5 (manifest cron + allowManualRun), Task 6 (cross-owner isolation proof), then
pre-push trio + rebase, `coordinated-wrap-up` (PR `Closes #934`).

## Standing rules

TDD (RED before GREEN), green commit per task with `Co-Authored-By: Claude Fable 5
<noreply@anthropic.com>`, `git add` explicit paths ONLY. Metadata-only payloads/run records (error
CODES, never titles/URLs/transport text). All network via JS-04 `fetchBoard`; no network
primitives in capture.ts. Never touch `docs/coordination/` beyond reading; never merge/board.
Test command: `pnpm vitest run tests/unit/<file>`. Relay again only past ~80% real work.
