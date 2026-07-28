# Relay 10 — #1264 settings self-operation

Branch/worktree: `1264-settings-self-operation` (this worktree). Coordinator: agent name
`coord-1262` (resolve pane fresh via `herdr pane list` — do not trust any cached pane id).
`JARVIS_PGDATABASE=jarvis_build_1264` for all DB work. Integration tests only via
`pnpm exec tsx scripts/test-integration.ts <files>`, never raw vitest on integration files.

## Done (commit `277d9e81`, verified green)

Task 9: no-op-suppression guards added to `theme-mode-tool.ts`, `locale-tools.ts`,
`quiet-hours-tool.ts`, `weather-location-tool.ts`, `notification-preference-application.ts`
(+`-tool.ts`). Pattern: read current via `getWithRevision`, compare to requested value, skip both
`upsertWithRevision` and `settingsUndoStack.push` when identical. `NotificationPreferenceWriteService
.setEnabled` now returns `changed: boolean`. Fixed a pre-existing locale-tools test CAS-conflict bug
(seed-by-read instead of assumed-null revision). Full unit+integration+typecheck+lint green.
Undo-stack retention/collision fix (`3b0eebe1`) is separately done — do not touch.

## NEXT, in order — do NOT start Task 10 first

### 1. Undo-apply tool (mandatory, coordinator withdrew the follow-up-issue escape hatch)

Spec `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md` lines 168-183
is the exit criterion — UAT literally does "change theme → ... → change that back" and must undo
with **no confirmation card anywhere**. A GitHub follow-up issue does not satisfy this; it must ship
in this PR. `settingsUndoStack.pop()` currently has zero production callers — this tool is it.

Binding rules (coordinator, verbatim intent):
- Apply via `preferences.upsertWithRevision(scopedDb, entry.key, entry.previousValue,
  entry.previousRevision)`. **Never** re-read the current revision and force the write.
- On `PreferenceRevisionConflictError`: surface to the user as cancelled — "this setting changed
  since, not undoing" (spec :170, "undo after a later legitimate change is cancelled, not
  applied"). Never swallow it, never retry with a freshly-read revision.
- Absent-row case (`entry.previousValue === null && entry.previousRevision === null`, i.e. the row
  didn't exist before the original write): **delete** the current row rather than upserting the old
  default back in (spec :169, cites `runtime-config-keys.ts:10`). `PreferencesRepository` currently
  has a **non-CAS** `delete(scopedDb, key)` only — check whether the earlier CAS migration (spec
  :133-134 mentions "conditional update/delete... ON CONFLICT DO NOTHING for absent-row creation")
  already added a conditional/CAS delete path before writing a new migration. Never edit an applied
  migration.
- The undo-apply tool is itself a write tool → needs a `manifest.ts` entry: `permissionId:
  "settings.write"`, `risk: "write"`, `actionFamilyId: "settings.preference-write"` (existing
  pattern, `packages/settings/src/manifest.ts:444-528`). All 6 existing settings write tools are
  `granted_at_install`; matching that is the reasonable default unless the coordinator says
  otherwise — confirm with it if unsure, don't just guess and ship.
- Suggested shape: input is empty/no-arg (operates on the actor+chat's stack top via
  `settingsUndoStack.pop(ctx.actorUserId, ctx.chatSessionId)`); if the popped entry's key doesn't
  route through a CAS-governed repository you can call, that's the hard-stop case from ruling #5
  (message the coordinator, don't ship a mixed-consistency key).

### 2. Task 10 — rebase `tests/unit/self-operation-manifests.test.ts` exact counts

Do this **after** the undo-apply tool lands (adding it changes the counts). Current baseline on
this branch pre-undo-tool (verified at `277d9e81`, lines 340-353): **29 `granted_at_install` + 5
`confirm_always` + 4 `user_promotable` = 38**. This is `main`'s number too.

- **Do NOT copy #1265's "31/5/4=40"** — that's #1265's own branch total, unrelated to ours.
- Compute fresh from `getBuiltInModuleManifests()` (the real runtime registry) after adding this
  branch's own new tools (5 settings tools from Task 9 were already counted in the 38 baseline if
  they existed at `277d9e81` — confirm; the undo-apply tool is the delta to add).
- **Counting gotcha (has bitten this epic twice):** not every module declares grants in a
  `manifest.ts`. `packages/people/src/tools.ts` declares People's grants directly inline (confirmed:
  lines 137/154 `granted_at_install`, 172/191 `confirm_always`). A recount done by grepping only
  `manifest.ts` files under-counts. Enumerate via the actual registry function, not file greps.
- Exact `toBe`, never a range/`toBeGreaterThan` (standing rule).
- #1265 is currently RED with remediation + a UAT spec still to write — this branch will most
  likely land first; #1265 rebases onto us, not the reverse.

### 3. Task 13 — rate limiting

Not yet investigated. Spec section ~lines 144-148: per-actor and per-tool limits, no-op suppression
(already done in Task 9), bounded mutation retention, metrics on hard-exclusion hits and repeated
CAS failures.

### 4. Task 11 — wrap-up

Full `pnpm verify:foundation` + #1000-harness Playwright UAT on a real dev instance (spec exit
criterion, lines 175-183) + `coordinated-wrap-up` → PR citing #1272. Report PR + evidence to
coordinator. Never merge, never touch board, never close the issue.

## Standing bans (unchanged)

Never `git add -A`. Never commit `.claude/context-meter.log`. Never assume a migration number.
Read spec by section only, never in full.
