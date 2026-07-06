# 656 Sports Module Relay 4

Issue: #656
Provider lane: Claude
Worktree: `~/Jarv1s/.claude/worktrees/656-sports-module`
Branch: `coord/656-sports-module`
Coordinator: label `Coordinator`, Codex session `019f1f06-e858-7862-9245-ae8a22ea968c` (resolve
fresh by label + session id; pane number reflows). Relay threshold ~80–100k tokens / compaction.

Plan: `docs/superpowers/plans/2026-07-01-sports-module.md` (do NOT read in full; read the target
Task section only). Skill: resume via `coordinated-build`.

## Commits this session (Tasks 4–6, all green per commit)

- `30cdabe3` Task 4: `SportsSource` interface (`src/source/sports-source.ts`) + in-memory TTL
  `SportsCache<T>` (`src/sports-cache.ts`). Test `tests/unit/sports-cache.test.ts`.
- `2f485f5c` Task 5: `SportsFollowsRepository` (`src/repository.ts`, list/create/remove, exported
  `toDto`, whole-competition dup guard). Unit test `tests/unit/sports-repository.test.ts`.
- `3811fbc1` Task 6: `EspnSportsSource` all 5 methods + `createEspnSportsSource`
  (`src/source/espn-source.ts`), fixtures `src/source/__fixtures__/*.json`, test
  `tests/unit/espn-source.test.ts`. No live network.

## Next step: Task 7 (Sports service composition)

`docs/superpowers/plans/2026-07-01-sports-module.md` §Task 7 (~line 856). Then 8 (routes), 9
(briefing tool + manifest + package index), 10 (module-registry registration), 11 (briefing).
TDD, commit green per task, stage explicit paths only.

## Approved corrections (still binding — from relay r3 + Coordinator 2026-07-01)

- Migration number is `0133`. Tests live under root `tests/unit` / `tests/integration`, NOT
  `packages/sports/src/__tests__` (plan text still shows old paths — override it).
- **No `packages/sports/tsconfig.json`.** `pnpm --filter @jarv1s/sports typecheck` resolves to the
  ROOT tsconfig, so `noUncheckedIndexedAccess` applies to test files — use `?.` on `arr[0]` access
  in tests or tsc fails (bit me on the espn test).
- **DEFERRED to Task 10** (Coordinator sequencing fix): sports `sqlMigrationDirectories` is not
  registered until Task 10, so `app.sports_follows` does not exist in the itest DB until then. Task 5
  therefore shipped repo code + unit tests only, NO forced-failing RLS itest. At Task 10 add: (1) real
  RLS isolation integration test `tests/integration/sports-follows-repository.test.ts` (owner
  round-trip, cross-actor invisibility, whole-competition dup guard); (2) `foundation.test.ts`
  migration-row + `app.sports_follows` table assertions. Recorded in plan §Task 10 DEFERRED block.

## Constraints

- Do NOT touch `docs/coordination/`. No `git add .` / `git add -A`. Format + stage only changed files.
- Ignore untracked `.claude/context-meter.log` and `docs/coordination/handoffs/2026-07-01-656-sports-module.md`.
- Pre-push trio before any push: `pnpm format:check && pnpm lint && pnpm typecheck` + `git rebase origin/main`.
- Escalate blockers/done to `Coordinator` (caveman voice). Board/merge/close are the Coordinator's.
