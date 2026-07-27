# #1264 settings self-operation — relay (Task 0a DONE, Task 0b next)

**Branch/worktree:** `1264-settings-self-operation` (this worktree, reuse — do NOT `pnpm install`,
`node_modules` present). **Coordinator agent name:** `coord-1262` (resolve fresh via `herdr agent
list` / `herdr pane list` — label `Coordinator`). **Risk tier:** security (Opus QA before merge).

## State: plan approved incl. Task 13. Task 0a BUILT, TESTED, COMMITTED (`5851d825`,
manifest-array follow-up `96edbcaa`). 15 tasks left.

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`. Task 13 text
already appended (commit `4e8c1e8c`), positioned before Task 11. **Read the plan BY TASK SECTION
ONLY — never front-to-back.** Do not re-approve/re-litigate; already granted.

## Task 0a — what landed (don't redo)

- Migration `packages/structured-state/sql/0175_preferences_revision.sql` — `revision integer NOT
  NULL DEFAULT 1` on `app.preferences`.
- `PreferencesRepository.upsertWithRevision`/`getWithRevision` + `PreferenceRevisionConflictError`,
  exported from `packages/structured-state/src/index.ts`.
- `PreferencesTable.revision` added to `packages/db/src/types.ts`.
- CAS tests added to `tests/integration/structured-state.test.ts` (existing `PreferencesRepository`
  describe block) — 30/30 pass via `pnpm test:structured-state`.
- Full `pnpm typecheck` (root) passes clean.

## TRAP found this pass — do not re-derive, apply to every future migration in this PR

`tests/integration/foundation-schema-catalog.test.ts` has an exact `toEqual([...])` array of every
migration file, global landing order. **Every new migration file in this PR needs a matching row
added there too**, or that test fails. I added the 0175 row already. Task 0b needs a 0176 row,
Task 0c needs a 0177 row (confirm actual next numbers at write time — another lane may have landed
since; recheck with the `for d in packages/*/sql infra/postgres/migrations; do ls "$d"; done | grep
-E '^[0-9]{4}_' | sort -n | tail -5` command before assuming 0176/0177).

## Known pre-existing noise (not yours to fix)

`pnpm --filter <pkg> typecheck` run in isolation throws `TS6059 rootDir` errors across several
packages (module-sdk/db/vault cross-imports) — this is a pre-existing per-package tsconfig quirk,
unrelated to this PR. **Use root `pnpm typecheck` for real signal**, not the per-package filtered
command, even though some plan tasks suggest the latter.

## Plan task line map (from coordinator, avoids reading 1129-line plan whole)

`docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`:
0a=35-162 0b=163-187 0c=188-228 1=229-337 2=338-445 3=446-590 4=591-680 5=681-763
6=764-854 7=855-934 8=935-1038 9=1039-1087 10=1088-1113 11=1114-1129. (Task 13 was
appended before Task 11's heading, commit `4e8c1e8c` — read via `grep -n "^## Task 13"`.)
Migration numbering starts at 0175 (0175 used by Task 0a already).

## Immediate next step

1. Task 0b (`app.instance_settings` CAS revision column, `infra/postgres/migrations/`, forward
   infra, no consumer this PR) — read plan section `## Task 0b` only. Confirm next migration number
   fresh (see TRAP above), add the foundation-schema-catalog row.
2. Task 0c (widen audit outcome CHECK constraint + TS type, new migration in `packages/ai/sql/`,
   NEVER edit `0127_jarvis_action_audit_log.sql` directly) — read `## Task 0c` only.
3. Continue Task 1 → 10 → 13 → 11 per the plan, one task section at a time, per-task green commit.
   Full remaining task list unchanged from the epic — see git history of this file (commit
   `f19d5af4`) for the itemized rundown if needed, or the plan's own `## Task N` headers (`grep -n
   "^## Task" docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`).
4. Self-monitor context; relay again at the 70% meter warning or on seeing a compaction summary.
   Commit before relaying — reading is not progress.

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"` — has the Task 0a
completion fact plus the foundation-schema-catalog trap. Prior relay doc history (commits
`6e269049`, `91afad3c`, `05744bcc`) has the coordinator's full verbatim plan-approval ruling.
