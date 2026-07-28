# Relay: #1264 settings self-operation — Task 8 done, Task 9 next

Branch/worktree: `1264-settings-self-operation` (this worktree, don't recreate).
Coordinator label: `Coordinator` (resolve fresh via `herdr pane list`, don't trust a pane number).
Skill: `coordinated-build`. Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md` — read BY SECTION only.

## Done (this session)

- Task 8 fully complete, 2 commits:
  - `7b43a1c5` — CAS-convert `setNotificationPreferenceEnabled` (step 3): new `NotificationPreferencesPort` (CAS pair) in `preferences-port.ts`, wired through `notification-preference-application.ts`, `notification-preferences-routes.ts` (409 on `PreferenceRevisionConflictError`), `routes.ts` fallback stub.
  - `127156d7` — undo stack (steps 4-6): new `packages/settings/src/undo-stack.ts` (`SettingsUndoStack`, cap 20/actor+chat, LIFO) + `tests/unit/settings-undo-stack.test.ts` (4 tests). Wired `settingsUndoStack.push(...)` into all 6 CAS tools: `theme-mode-tool.ts`, `locale-tools.ts` (both execute fns), `quiet-hours-tool.ts`, `weather-location-tool.ts`, `notification-preference-tool.ts`. Extended `setNotificationPreferenceEnabled`'s return with `previous: { value, revision }` (verified safe — REST response schema has `additionalProperties: false`, silently strips it) since that tool's actual write happens in shared application code, not the tool file. Updated `tests/unit/settings-notification-preference-tool.test.ts` fakes to include `previous`. Convention: explicit `import { randomUUID } from "node:crypto"` (bare `crypto.randomUUID()` is NOT used elsewhere in repo — checked).
  - Verified green: root `pnpm typecheck`, `format:check`, `eslint --max-warnings=0` on all touched files, unit tests (16 passed), integration tests for the 4 non-notification tools (18 passed, ran with `JARVIS_PGDATABASE=jarvis_build_1264`).

## Next: Task 9 — no-op suppression for CAS writes (plan lines 1039–1087)

**Correction to the plan's own pseudocode:** it references `packages/settings/src/assistant-tools/*.test.ts` — that directory does NOT exist. Tool files are flat: `packages/settings/src/theme-mode-tool.ts`, `locale-tools.ts`, `quiet-hours-tool.ts`, `weather-location-tool.ts`, `notification-preference-tool.ts`. Tests are `tests/integration/settings-*-tool.test.ts` (DB-backed) — no existing unit test files for these tools' execute fns. The plan's `ctx: any` / `ctx.preferencesRepository.getWithRevision` signature is also stale — real signature is `(scopedDb, input, ctx, services?)` with a module-level `const preferences = new PreferencesRepository();`, matching what's already in each file from Task 8.

Per-tool guard (5 tools, same pattern as Task 8's undo wiring): before `upsertWithRevision`, deep-equal `next` against `current?.value` (relevant subset for locale's two split tools) — if equal, skip both the write and the undo push, return current value with a no-change note. Notification-preference's write lives in `notification-preference-application.ts`, not the tool file — guard goes there.

Steps: extend each of the 4 integration test files (`settings-theme-mode-tool.test.ts`, `settings-locale-tools.test.ts`, `settings-quiet-hours-tool.test.ts`, `settings-weather-location-tool.test.ts`) plus a notification-preference test with a no-op case (seed value, call with same value, assert revision unchanged + no undo entry pushed — `settingsUndoStack` is directly importable in tests). Then add the guard, run `pnpm exec tsx scripts/test-integration.ts <files>` with `JARVIS_PGDATABASE=jarvis_build_1264`, typecheck/format/lint, commit.

## Then, in order (plan line map, confirmed via grep)

- **Task 10** (1088–1113): rebase self-operation manifest inventory test — must assert exactly `grantedAtInstall=31, confirmAlways=5, userPromotable=4` (sum 40) via exact `toBe`.
- **Task 13** (1114–1197): per-actor per-tool rate limiting (gateway-level).
- **Task 11** (1198–end): full local gate (`pnpm verify:foundation`) + UAT golden path, then `coordinated-wrap-up` (gate, push after pre-push trio, PR citing #1272, report to coordinator — never merge/board/close).

## Reminders

- `export JARVIS_PGDATABASE=jarvis_build_1264` before any db work.
- Stage only intentionally-touched files, never `git add -A`.
- Relay again on context-meter 70% warning or a compaction summary — commit + doc + spawn successor before continuing.
