# #1264 settings self-operation — relay (Tasks 0a/0b/0c/1 DONE, Task 2 next)

**Branch/worktree:** `1264-settings-self-operation` (this worktree, reuse — do NOT `pnpm install`,
`node_modules` present). **Coordinator:** resolve fresh via `herdr pane list`, label `Coordinator`
(name `coord-1262` as of this writing, but re-resolve — names can change). **Risk tier:** security
(Opus QA before merge).

## RUN RULE — read before ANY db command

```bash
export JARVIS_PGDATABASE=jarvis_build_1264
```

Set in every new shell (does not persist). `pnpm db:migrate` has no auto-isolation — silently
targets Ben's shared dev DB without this var. DB `jarvis_build_1264` already exists, migrations
through 0177 applied — reuse, don't recreate.

## Coordinator rulings — binding, do not re-litigate

1. **Digest is OUT OF SCOPE.** Do not build `settings.digest.*` tools, do not rename/narrow that
   exclusion prefix (`packages/ai/src/gateway/self-operation.ts:153`) to route around it. Already
   reflected in the plan (line 19). A prior agent proposed a rename workaround; coordinator refused.
   Loosening the prefix is parked in `AWAITING-BEN.md` section 3b — Ben's call only.
2. **Rebase inventory counts on #1265's numbers, not main's.** #1265 bumped
   `tests/unit/self-operation-manifests.test.ts` to `grantedAtInstall=31, confirmAlways=5,
   userPromotable=4` (sum 40, commit `3408c1ee`), landing before this lane. When Task 10 touches
   that file, rebase on top of 40, not main's 38. Expect a rebase conflict there — normal, resolve
   don't loosen (never widen to a range/`toBeGreaterThan`/computed length — exactness is the guard).
   Counting gotcha: People module declares grants in `packages/people/src/tools.ts`, not a
   manifest.ts — walk `getBuiltInModuleManifests()`, don't grep manifest files (#1265 already does
   this).

## State: Tasks 0a, 0b, 0c, 1 DONE and committed. 11 tasks left (2 through 11+13).

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`. **Read BY
TASK SECTION ONLY.** Line map: 2=338-445 3=446-590 4=591-680 5=681-763 6=764-854 7=855-934
8=935-1038 9=1039-1087 10=1088-1113 11=1114-1129 (Task 13 inserted before 11's heading —
`grep -n "^## Task 13"`).

## Commits so far

`5851d825` 0a · `96edbcaa` 0a manifest-array follow-up · `c366b877` 0b (0176 migration + catalog
row) · `7a52e28d` 0c (0177 migration, widened outcome CHECK) · `c449e22c` Task 1 (extracted
`setNotificationPreferenceEnabled` to `packages/settings/src/notification-preference-application.ts`).

**0176 and 0177 are FROZEN** (checksum-recorded, applied). Any content change needs a new migration
file, never in-place edit.

## Two drifts found in Task 1 — apply the same checks to remaining tasks

1. **Plan's test-file path convention is stale.** Root `vitest.config.ts` `test.include` is only
   `spikes/**`, `tests/**`, `packages/people/src/__tests__/**` — a test colocated in
   `packages/settings/src/*.test.ts` (as several later task sections literally specify) **never
   runs**, silently. Use `tests/unit/settings-<feature>.test.ts` instead (matches the existing
   `tests/unit/settings-themes-routes.test.ts` convention). Check every remaining task's test-file
   path against this before writing it.
2. **Don't hand-roll module-active logic.** The plan's Task 1 pseudocode reimplemented the
   active-module check via raw deny-row scanning and silently dropped the
   `required`/`supportsUserDisable` manifest fields that `computeMyModuleDto`
   (`packages/settings/src/routes-serializers.ts`) already accounts for. Where a task extracts
   existing route logic, prefer calling the existing serializer/helper over re-deriving it — verify
   against the actual current route body, not just the plan's inline pseudocode, before implementing.
3. **`@jarv1s/settings` has no `test` script** — the plan's "Run: `pnpm --filter @jarv1s/settings
   test`" step is a no-op/error. Run the specific vitest file directly:
   `pnpm vitest run tests/unit/<file>.test.ts`, plus root `pnpm typecheck` before every commit.

## TRAP — apply to every future migration

`tests/integration/foundation-schema-catalog.test.ts` pins the full migration list via
`toEqual([...])`. Next free global version: **0178**.

## Known pre-existing noise (not yours to fix)

`pnpm --filter <pkg> typecheck` in isolation throws pre-existing `TS6059 rootDir` errors — use root
`pnpm typecheck`. `pnpm format:check` currently also flags 2 pre-existing files unrelated to this
lane (`docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`,
`tests/integration/structured-state.test.ts`) — not yours, don't reformat them.

## PR body MUST include (coordinator ruling, do not drop)

`structured-state/src/manifest.ts`'s migrations array had drifted pre-epic (0111, 0167 missing);
corrected in `96edbcaa`; package still has no pinning test for that array — tracked as **#1272**,
cite it in the PR body.

## Immediate next step

1. `export JARVIS_PGDATABASE=jarvis_build_1264` in your shell before any db work.
2. Task 2 — read `## Task 2` only (plan lines 338-445).
3. Continue Task 3 → 10 → 13 → 11, one section at a time, per-task green commit. Root
   `pnpm typecheck` + `format:check` + `lint` before every commit. Verify each task's file-path and
   logic claims against the actual current branch state before implementing (see drifts above).
4. Self-monitor context; relay again at the 70% meter warning or on a compaction summary. Commit
   before relaying — reading is not progress.

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`.
