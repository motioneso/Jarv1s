# #1264 settings self-operation — relay (PLAN APPROVED, Task 13 folded, BUILD NOW)

**Branch/worktree:** `1264-settings-self-operation` (this worktree). **Coordinator agent name:**
`coord-1262` (resolve fresh via `herdr agent list` / `herdr pane list` — label `Coordinator`).
**Risk tier:** security (Opus QA required before merge).

## State: plan approved, Task 13 required, ZERO tasks built yet. Prior lane relayed at 71% during grounding — no code written, nothing to lose.

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md` (committed
`05744bcc`). Full approval + Task 13 requirement text lives in git history at commit `6e269049`
of this same file — **read that commit if you need the coordinator's verbatim ruling**; not
repeated here to keep this doc short. Read the PLAN by task section only, never front-to-back.

## Two corrections found during Task 0a grounding — save yourself re-deriving these

1. **Next migration number is 0175, not 0167/0168 as the plan assumes.** Global landing-order max
   across ALL `packages/*/sql/` + `infra/postgres/migrations/` is currently 0174
   (`packages/chat/sql/0174_chat_surface.sql`). Re-check with
   `for d in packages/*/sql infra/postgres/migrations; do ls "$d"; done | grep -E '^[0-9]{4}_' | sort -n | tail -5`
   before creating Task 0a/0b/0c's migration files — another lane may have landed since.
2. **Plan's per-package test file/command instructions are wrong for this repo.** Neither
   `packages/structured-state/package.json` nor `packages/settings/package.json` has a `test`
   script, and root `vitest.config.ts`'s `test.include` does NOT cover `packages/*/src/*.test.ts`
   (only `spikes/**`, `tests/**`, `packages/people/src/__tests__/**`). Real convention: extend the
   EXISTING root-level `tests/integration/*.test.ts` file for each domain, run via
   `tsx scripts/test-integration.ts tests/integration/<file>.test.ts` (or the narrow
   `pnpm test:<domain>` root script if one exists — check `package.json` scripts block first).
   Confirmed existing files to extend (verify each still matches at task time, don't assume):
   - Task 0a (`app.preferences` CAS): `tests/integration/structured-state.test.ts` already has a
     `describe("PreferencesRepository", ...)` block (~line 347) — add CAS tests there.
   - Task 2 (themeMode): `tests/integration/settings-themes.test.ts`
   - Task 3 (locale): `tests/integration/settings-locale.test.ts`
   - Task 4 (quietHours): `tests/integration/settings-quiet-hours.test.ts`
   - Task 5 (weatherLocation): `tests/integration/weather.test.ts`
   - Task 6 (notificationPreference): `tests/integration/notification-preferences.test.ts`
   - Task 7 (chat.setResponseStyle): `tests/integration/chat-settings.test.ts`
   This is a mechanical/procedural self-correction (not a product/architecture fork) — noted here,
   not escalated; call it out briefly in the PR body.

## Immediate next step

1. **Do not re-message coordinator for approval — already granted, do not re-litigate.**
2. Task 13 (rate limiting) text has NOT yet been appended to the plan file itself — still needs
   writing into `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`,
   positioned before Task 11 (final gate), without renumbering existing tasks. Pull the exact
   requirement text from commit `6e269049` of this doc. Do this first, then build Task 0a onward.
3. Build via `superpowers:test-driven-development`, Task 0a onward, per-task green commits.
   `packages/structured-state/src/preferences-repository.ts` (69 lines, read already) needs
   `upsertWithRevision`/`getWithRevision` + `PreferenceRevisionConflictError` added — existing
   `upsert`/`get`/`getWithMetadata`/`list`/`delete` untouched. Table def in
   `packages/structured-state/sql/0031_structured_state.sql` line 127 (`app.preferences`) — column
   list not yet re-read, check it before writing the ALTER TABLE migration.
4. Self-monitor context; relay again at the 70% meter warning or on seeing a compaction summary.
   Reading is not progress — build and commit before the next relay.

## Full task list (16 items, all pending — none started)

Task 0a (prefs CAS) → 0b (`app.instance_settings` CAS, `infra/postgres/migrations/`, forward-only,
no consumer this PR) → 0c (widen audit outcome CHECK constraint + TS type, new migration in
`packages/ai/sql/`, NEVER edit `0127_jarvis_action_audit_log.sql` directly) → 1 (extract
notification-preference toggle to `packages/settings/src/notification-preference-application.ts`;
confirm in Step 1 whether `packages/ai/src/gateway/gateway.ts`'s dispatch wrapper auto-records
audit rows or app code must call an audit port explicitly) → 2 (`settings.themeMode.set`) → 3
(`settings.locale.setRegionAndDateFormat` + `setTimezone`, IANA validation) → 4
(`settings.quietHours.set`) → 5 (`settings.weatherLocation.set`) → 6
(`settings.notificationPreference.setEnabled`) → 7 (`chat.setResponseStyle` on CHAT's own
manifest — verify `ChatResponseStyle` enum is closed/no free-text field first; if not closed, STOP
and escalate) → 8 (undo stack, key `${actorUserId}:${chatId}`, 20-entry cap, confirmed correct by
coordinator, do not simplify; `chat.setResponseStyle` gets NO undo entry — state plainly in PR
body) → 9 (no-op suppression for CAS writes) → 10 (update
`tests/unit/self-operation-manifests.test.ts` inventory counts: add 6 settings tool names + 1 chat
tool name to `grantedAtInstall`, bump `.length`/sum; do not touch `confirmAlways`/
`userPromotable` counts; note sibling #1265 merge-conflict risk in PR body) → 13 (rate limiting,
gateway-level, generic per-`(actorUserId, toolName)` bucket in
`packages/ai/src/gateway/gateway.ts` or `policy.ts`, applies to write tools, module-agnostic,
outcome `denied` on limit hit — NOT a new outcome value, last task before gate) → 11 (full local
gate `pnpm verify:foundation`, MUST include `format:check` explicitly, never pipe through
tail/head; UAT golden-path: drive all 7 new tools on a running dev instance, confirm no
confirmation card, confirm boot-time `assertBuiltInSelfOperationManifests` passes — run AFTER
Task 13).

## Full detail if needed

`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"`. Prior relay doc
(commit `6e269049`, still in history) has the coordinator's full verbatim approval ruling.
