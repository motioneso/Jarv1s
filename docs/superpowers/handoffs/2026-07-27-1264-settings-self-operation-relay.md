# #1264 settings self-operation — relay (0a/0b/0c DONE, Task 1 next)

**Branch/worktree:** `1264-settings-self-operation` (this worktree, reuse — do NOT `pnpm install`,
`node_modules` present). **Coordinator agent name:** `coord-1262` (resolve fresh via `herdr pane
list` — label `Coordinator`). **Risk tier:** security (Opus QA before merge).

## RUN RULE — read before ANY db command

**Every DB operation in this run uses an isolated database, never the shared dev DB.**

```bash
export JARVIS_PGDATABASE=jarvis_build_1264
```

Set in every new shell (does not persist). `pnpm db:migrate` has NO auto-isolation (unlike
`pnpm test:*`, which self-isolates into `jarvis_test_<random>` when this var is unset) — it
silently targets Ben's shared dev DB (`jarv1s@localhost:55433`) without this var. Violated once
this run already; coordinator ruling + full incident writeup: `memory_smart_search` project
`jarv1s`, query `"db:migrate isolated database run rule"`. Short version: DB `jarvis_build_1264`
already exists (created via `docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE
jarvis_build_1264"`) and has migrations through 0177 applied — reuse it, don't recreate.

## State: Tasks 0a, 0b, 0c DONE and committed, clean-verified. 12 tasks left (1 through 11+13).

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`. **Read BY
TASK SECTION ONLY.** Line map: 1=229-337 2=338-445 3=446-590 4=591-680 5=681-763 6=764-854
7=855-934 8=935-1038 9=1039-1087 10=1088-1113 11=1114-1129 (Task 13 inserted before 11's heading —
`grep -n "^## Task 13"`).

## Commits so far
`5851d825` 0a · `96edbcaa` 0a manifest-array follow-up · `c366b877` 0b (0176 migration + catalog
row) · `7a52e28d` 0c (0177 migration, widened outcome CHECK + 3 TS/schema unions in lockstep +
settings-activity-pane consumer fix — this last one was NOT called out in the plan, found only by
`pnpm typecheck`'s Record-exhaustiveness error; **always run full root `pnpm typecheck` before
declaring a task done, the plan's file list is not exhaustive**).

**0176 and 0177 are FROZEN** (checksum-recorded, applied). Any content change to either needs a
new migration file, never an in-place edit — ask the coordinator first if unsure.

## TRAP — apply to every future migration

`tests/integration/foundation-schema-catalog.test.ts` pins the full migration list via
`toEqual([...])`, globally ordered by version number (not grouped by owning package/module) — add
each new file's row in that global numeric position. Next free global version: **0178**.

## Known pre-existing noise (not yours to fix)

`pnpm --filter <pkg> typecheck` in isolation throws pre-existing `TS6059 rootDir` errors. Use root
`pnpm typecheck` (covers `apps/web` + `check:external-modules` too) for real signal — it's also
the only thing that caught the settings-activity-pane consumer gap in Task 0c, so don't skip it
even for a "just a migration" task.

## PR body MUST include (coordinator ruling, do not drop)

`structured-state/src/manifest.ts`'s migrations array had drifted pre-epic (0111, 0167 missing,
not caused by this work); corrected in `96edbcaa`; package still has **no pinning test** for that
array — tracked as issue **#1272**, cite it in the PR body.

## Immediate next step

1. `export JARVIS_PGDATABASE=jarvis_build_1264` in your shell before any db work.
2. Task 1 (extract notification-preference toggle to
   `packages/settings/src/notification-preference-application.ts`) — read `## Task 1` only (plan
   lines 229-337).
3. Continue Task 2 → 10 → 13 → 11, one section at a time, per-task green commit. Run root
   `pnpm typecheck` + `format:check` + `lint` before every commit, not just at wrap-up.
4. Self-monitor context; relay again at the 70% meter warning or on a compaction summary. Commit
   before relaying — reading is not progress.

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`.
