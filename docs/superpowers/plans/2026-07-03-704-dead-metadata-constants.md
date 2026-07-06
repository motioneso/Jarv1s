# Plan — 704 dead metadata constants

**Spec:** issue #704 **Risk tier:** `sensitive` **Branch:** `coord/704-dead-metadata-constants`
**Grounded on:** `origin/main` @ `8c0c98df` (verified 2026-07-03)

## Premise verification (all confirmed current)

| Constant                     | File:line                                            | Consumers (TS, excl. declaration)                                      | Verdict                                                                                               |
| ---------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `SETTINGS_EXPORT_QUEUE`      | `packages/settings/src/manifest.ts:5`                | 0                                                                      | dead — delete                                                                                         |
| `WELLNESS_EXPORT_QUEUE_NAME` | `packages/wellness/src/manifest.ts:32`               | 0 (pure alias of `WELLNESS_EXPORT_QUEUE`)                              | dead — delete                                                                                         |
| `WHEEL_VERSION`              | `packages/shared/src/wellness-api.ts:725`            | 0 (symbol unreferenced)                                                | dead — delete symbol; literal `"jarvis-emotion-v1"` stays where used independently (tests/migrations) |
| `PROACTIVE_SOURCE_DEFAULT`   | `packages/shared/src/proactive-monitoring-api.ts:55` | 0 (sibling `defaultProactiveMonitoringPreference` uses inline literal) | dead — delete                                                                                         |

No drift. No item already shipped. No stale premise.

## Out of scope (per handoff + CLAUDE.md invariants)

- No queue literal renames, no queue constant renames, no job-kind/payload-key/API-contract changes.
- No migration edits.
- No `docs/coordination/` writes from build branch (except untracked startup handoff, already present).
- Explicit staging only; no `git add -A`.

## Tasks

### Task 1 — delete `SETTINGS_EXPORT_QUEUE`

- **File:** `packages/settings/src/manifest.ts`
- **Change:** remove line 5 (`export const SETTINGS_EXPORT_QUEUE = "export.build";`) and the blank line 6.
- **Verify:** `pnpm typecheck` (no broken imports).

### Task 2 — delete `WELLNESS_EXPORT_QUEUE_NAME`

- **File:** `packages/wellness/src/manifest.ts`
- **Change:** remove line 32 (`export const WELLNESS_EXPORT_QUEUE_NAME = WELLNESS_EXPORT_QUEUE;`). Note: this is the only consumer of the alias; `WELLNESS_EXPORT_QUEUE` (imported from `./export-job.js`) is still used at line 236 in the manifest `jobs` array — **keep that import**.
- **Verify:** `pnpm typecheck`.

### Task 3 — delete `WHEEL_VERSION`

- **File:** `packages/shared/src/wellness-api.ts`
- **Change:** remove line 725 (`export const WHEEL_VERSION = "jarvis-emotion-v1";`). The preceding comment block (lines 719–723) describes the taxonomy reference wheel generally and is not specific to the constant — leave the comment block intact (it documents `EMOTION_POLARITY`/`moodIndex` below).
- **Verify:** `pnpm typecheck`. Literal `"jarvis-emotion-v1"` appears independently in `tests/e2e/wellness.spec.ts:181` and migration — untouched, still valid.

### Task 4 — delete `PROACTIVE_SOURCE_DEFAULT`

- **File:** `packages/shared/src/proactive-monitoring-api.ts`
- **Change:** remove lines 55–58 (the `export const PROACTIVE_SOURCE_DEFAULT = { ... };` declaration). The sibling `defaultProactiveMonitoringPreference()` (line 60+) uses inline literals and is the real default helper.
- **Verify:** `pnpm typecheck`.

## Verification (wrap-up gate)

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @jarv1s/settings test
pnpm --filter @jarv1s/wellness test
pnpm --filter @jarv1s/shared test
```

Record exact commands + exit codes in wrap-up report. If a filtered test command is a no-op (no test script), note that.

## Exit criteria

- 4 confirmed-dead constants removed; no orphan imports/comments left.
- `format:check && lint && typecheck` green.
- Filtered package tests green (or documented no-op).
- Pre-push trio + fresh rebase before push.
- PR opened against `origin/main`; report to coordinator.
