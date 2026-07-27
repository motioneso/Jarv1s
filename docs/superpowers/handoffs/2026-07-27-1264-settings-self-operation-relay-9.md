# Relay 9 — Task 9 no-op suppression, mid-flight

Branch `1264-settings-self-operation`, worktree unchanged. `JARVIS_PGDATABASE=jarvis_build_1264`
for anything DB-touching. Coordinator = `coord-1262` (confirm via `herdr pane list` before
messaging — do not guess).

## Just landed (this session)
- `3b0eebe1` fix(settings): bound SettingsUndoStack retention + remove key collision —
  coordinator-ruling items 1+2 from
  `docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay-8-coordinator-rulings.md`
  (commit `971a9d55`, read it in full if you haven't). Nested
  `Map<actorUserId, Map<chatId, stack>>` + LRU chat eviction (`maxTrackedChats`) + `appliedAt` TTL
  sweep (`maxEntryAgeMs`). Public `push/pop/clear` API unchanged. 7/7 unit tests green, typecheck/
  lint/format clean.
- Ruling item 5 ("also re-check revision-CAS-only assumptions"): grepped, confirmed clean — no
  code elsewhere asserts revision stability across a plain `upsert()`; all such call sites either
  ignore revision or use the CAS pair consistently (incl. the existing `cas.raced` regression test
  in `tests/integration/structured-state.test.ts`). No fix needed, don't re-do this grep.
- Ruling items 3 (undo-apply CAS-replay-or-refuse) and 4 (undo-expose tool's `selfOperationGrant`
  impact on Task 10 counts) are for a future task that builds an undo-apply/expose tool — **not
  yet started, not part of Task 9**. Don't build it speculatively; just keep in mind for whichever
  task does.

## Task 9 state — tests written (red, TDD-correct), guards NOT YET implemented
No-op suppression tests already added to (all confirmed failing pre-guard, as expected):
- `tests/integration/settings-theme-mode-tool.test.ts`
- `tests/integration/settings-quiet-hours-tool.test.ts`
- `tests/integration/settings-weather-location-tool.test.ts`
- `tests/unit/settings-notification-preference-application.test.ts` (2 tests ref `result.changed`)
- `tests/unit/settings-notification-preference-tool.test.ts` (fakeService default now has
  `changed: true`; 2 new tests for push-suppression on `changed=false`/`true`)
- `tests/integration/settings-locale-tools.test.ts` — **has a bug**: both no-op tests reuse
  `ids.adminUser` + key `"locale"`; the 2nd test seeds with expected revision `null` but the 1st
  test's seed already wrote that row → throws `PreferenceRevisionConflictError`. Fix before
  running: read `current?.revision` first and pass it, or split the two no-op tests onto different
  actor ids.

## Next: implement the guards (not started)
Read each tool file, add `if (current && <changed-fields> match) return early with no write`,
before the `upsertWithRevision`/`push` calls:
- `packages/settings/src/theme-mode-tool.ts` — compare `mode`
- `packages/settings/src/locale-tools.ts` — 2 execute fns, compare only each one's own field subset
  (timezone; region+dateFormat) against normalized current
- `packages/settings/src/quiet-hours-tool.ts` — compare all 4 fields
- `packages/settings/src/weather-location-tool.ts` — compare lat/lon/label
- `packages/settings/src/notification-preference-application.ts` — add `changed: boolean` to
  `setNotificationPreferenceEnabled`'s return AND to the `NotificationPreferenceWriteService`
  interface's `setEnabled` return type; skip `upsertWithRevision` when requested `enabled` already
  matches current
- `packages/settings/src/notification-preference-tool.ts` — only `settingsUndoStack.push(...)`
  when `changed === true`

Then: fix the locale test bug above, run all 6 affected files green (integration via
`pnpm exec tsx scripts/test-integration.ts <files>` with `JARVIS_PGDATABASE=jarvis_build_1264`;
unit via `pnpm exec vitest run <files>`), typecheck/format:check/lint on touched files, commit as
`feat(settings): suppress no-op writes and undo entries in self-operation tools` (stage only
touched files, never `git add -A`).

## Then, per relay-7 (unchanged)
Task 10 (manifest inventory, exact `toBe` 31/5/4=40 baseline — NOT yet adjusted for any future
undo-expose tool, since that tool doesn't exist in this branch) → Task 13 (rate limiting) →
Task 11 (full gate + UAT + `coordinated-wrap-up`, PR citing #1272, report to coordinator — never
merge/board/close).

## Standing bans (repeat every relay)
No `defaultTier` widening (escalate). Never touch `docs/coordination/`. Never `git add -A`. Never
repo-wide `pnpm format` (scoped `format` on touched files only, `format:check` for the gate).
Isolated `JARVIS_PGDATABASE`. Never pipe a gate command through `tail`/`head`. Read plans by
SECTION only. Relay again at context-meter 70% or on seeing a compaction summary — commit real
work first, reading is not progress.
