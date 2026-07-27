# #1264 settings self-operation — relay (Tasks 0a+0b DONE, Task 0c next)

**Branch/worktree:** `1264-settings-self-operation` (this worktree, reuse — do NOT `pnpm install`,
`node_modules` present). **Coordinator agent name:** `coord-1262` (resolve fresh via `herdr pane
list` — label `Coordinator`; it is ALSO supervising sibling lane #1265). **Risk tier:** security
(Opus QA before merge).

## RUN RULE — read before ANY db command

**Every DB operation in this run uses an isolated database, never the shared dev DB.** Before any
`pnpm db:migrate` / test / verify:

```bash
export JARVIS_PGDATABASE=jarvis_build_1264
```

Set it in every new shell for this lane (it does not persist across shells). This was violated
once this run (see incident below) — do not repeat it. `pnpm test:*` scripts are unaffected
(they self-isolate into `jarvis_test_<random>` automatically when `JARVIS_PGDATABASE` is unset),
but `db:migrate` is not — it silently targets `jarv1s@localhost:55433` (Ben's shared dev DB)
without this var set.

## State: Tasks 0a + 0b DONE and committed, clean-verified. 14 tasks left (0c through 11).

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`. Task 13 text
already appended (commit `4e8c1e8c`), positioned before Task 11. **Read the plan BY TASK SECTION
ONLY.** Line map (coordinator-supplied, don't re-derive): 0a=35-162 0b=163-187 0c=188-228
1=229-337 2=338-445 3=446-590 4=591-680 5=681-763 6=764-854 7=855-934 8=935-1038 9=1039-1087
10=1088-1113 11=1114-1129 (13 inserted before 11's heading, `grep -n "^## Task 13"`).

## Commits so far
`5851d825` Task 0a code · `96edbcaa` Task 0a manifest-array follow-up · `e9cc04e7` line-map doc ·
`c366b877` Task 0b (`infra/postgres/migrations/0176_instance_settings_revision.sql` + catalog row).

**0176 is FROZEN.** It is recorded as applied (checksum-pinned) in both the shared dev DB and the
isolated `jarvis_build_1264` DB. If it needs a content change, STOP and tell the coordinator —
never edit an applied migration file; add a new one instead.

## RESOLVED incident — 0175 shared-DB collision (do not re-litigate)

Earlier this run, `pnpm db:migrate` was run once with no `JARVIS_PGDATABASE` set → hit the shared
dev DB and failed with "Migration 0175_preferences_revision.sql has changed after being applied."
Coordinator investigated independently (searched all 2712 commits + all 44 `archive/2026-07-26/*`
tags): the only `0175` sql file anywhere in git history is this lane's own
`0175_preferences_revision.sql`; `origin/main`'s highest migration is `0174_chat_surface.sql`. The
shared DB's stale `0175_chat_messages_attachment_only_body.sql` row is dead orphaned state from
the 2026-07-26 repo reset (predates both #1264 and #1265, and #1265 ships no migration at all —
not a live collision). **Ruling: numbering 0175/0176 is correct, do not renumber.** Coordinator is
NOT cleaning the shared dev DB (Ben's environment, asleep, out of scope for delegated authority) —
parked for Ben.

**The real finding was the run-rule violation**, not the collision itself — db:migrate had been
run against the shared DB at all. Fixed: created isolated `jarvis_build_1264` DB (via
`docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE jarvis_build_1264"`), re-ran
`pnpm db:migrate` against it with `JARVIS_PGDATABASE=jarvis_build_1264` set — exit 0, clean, both
0175 and 0176 recorded with correct checksums, `revision` column confirmed present on
`app.instance_settings`. Task 0b's verification step is now genuinely green on isolated state.

**Task 0c's new migration**: pick the next free number (0177) — confirmed free by the same
coordinator search, no need to re-ask. Run its own db:migrate verification against
`jarvis_build_1264` (or a fresh isolated DB), never the shared DB.

## TRAP — apply to every future migration in this PR

`tests/integration/foundation-schema-catalog.test.ts` pins the full migration list via
`toEqual([...])`. Every new file needs a matching row (already true for 0175, 0176; 0177 next).

## Known pre-existing noise (not yours to fix)

`pnpm --filter <pkg> typecheck` in isolation throws pre-existing `TS6059 rootDir` errors unrelated
to this PR. Use root `pnpm typecheck` for real signal.

## PR body MUST include (coordinator ruling, do not drop)

State plainly: `manifest.ts` migrations array had drifted before this epic (0111, 0167 missing
pre-existing, not caused by this work); corrected in `96edbcaa`; structured-state still has **no
pinning test** — tracked as issue #1272. Cite #1272 in the PR body.

## Immediate next step

1. `export JARVIS_PGDATABASE=jarvis_build_1264` in your shell before any db work.
2. Task 0c (widen audit outcome CHECK + TS type, `packages/ai/sql/`, NEVER edit
   `0127_jarvis_action_audit_log.sql` directly, use `0177_...sql`) — read `## Task 0c` only (plan
   lines 188-228).
3. Continue Task 1 → 10 → 13 → 11, one section at a time, per-task green commit.
4. Self-monitor context; relay again at the 70% meter warning or on a compaction summary. Commit
   before relaying — reading is not progress.

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`.
