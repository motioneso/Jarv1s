# #986 settings shell/navigation — relay 2 (mid-Task-4)

Spec: `docs/superpowers/specs/2026-07-12-settings-shell-navigation-ia-hardening.md`
Plan: `docs/superpowers/plans/2026-07-12-settings-shell-navigation.md` (10 tasks, TDD, read by
section per task — never front-to-back)
Worktree: `~/Jarv1s/.claude/worktrees/ux-986-settings-build`, branch `ux/986-settings-build`
Coordinator: label `UX Coordinator`, session `019f5a2e-03fd-71c3-95ab-1934cb1de973` (codex,
`gpt-5.6-sol`). Re-resolve pane fresh via `herdr pane list` before messaging — never trust a
baked-in pane id. Relay skill; report/escalate, never merge.
Prior relay doc (superseded, don't re-read in full): `docs/superpowers/handoffs/2026-07-12-986-settings-shell-relay.md`

Skip `pnpm install` — `node_modules` already present in this worktree.

## Done (3 tasks, all green, all committed)

- Task 1 `f67cf52b` — `SettingsSectionGroup<Section>` + `flattenSettingsGroups` added to
  `apps/web/src/settings/settings-navigation.ts`.
- Task 2 `56e8cb3d` — added `visibleConfigurableModules` to
  `apps/web/src/settings/settings-module-view-model.ts`, **kept** `visibleUserToggleModules`
  alive (deviation from plan text — see below).
- Task 3 `51f092a4` — `<RouterBackButton onBack={props.onBack} />` added to the
  successful-surface path in `packages/settings-ui/src/router.tsx`.

## Two deferred-deletion decisions in flight (both intentional, both documented in commits)

**1. `visibleUserToggleModules` (Task 2 → finish in Task 7).** Plan said "delete it," but its real
caller (`ModulesPane` in `settings-personal-data-panes.tsx:65,641`) isn't rewired to
`visibleConfigurableModules` until Task 7. Also found a **stray duplicate test file not in the
plan's file list**: `tests/unit/settings-module-view-model.test.ts` (no `web-` prefix) tests
`visibleUserToggleModules` directly with its own `mod()` helper. **When Task 7 rewires
`ModulesPane`, delete `visibleUserToggleModules` from `settings-module-view-model.ts` AND delete
or migrate that stray test file.**

**2. `GeneralPane` (Task 4, in progress — investigated, zero code written yet).** Plan's Task 4
says delete `GeneralPane` entirely, "must return zero grep results" as the acceptance check. Grep
shows it's referenced in two places the plan's Task-4 file list doesn't mention:
- `apps/web/src/settings/settings-page.tsx` — lazyPane def (~line 91-93), `PERSONAL_SECTIONS`
  entry `{ id: "general", ... }` (~line 143), `"general"` member of `PersonalSectionId` union, and
  the `SlidersHorizontal` lucide import (used ONLY at that one entry, becomes unused after removal).
  **Do NOT do the full Task-6 grouped-registry rewrite here** — only the minimal surgical removal
  of `general`/`GeneralPane` references, enough to satisfy Task 4's own zero-grep-results gate.
- `tests/unit/settings-quiet-hours-pane.test.tsx` — imports `isValidQuietHoursTime` from
  `settings-personal-data-panes.js` (needs repointing to wherever it moves to, i.e.
  `settings-personal-panes.js`) and has a `describe("GeneralPane quiet-hours controls", ...)` block
  (~lines 71-102) that renders `GeneralPane` directly — rewrite to render `ProfilePane` instead,
  keeping equivalent assertions (aria-label, checked state, 22:00/07:00 time values, absence of
  "coming soon"/BACKEND-TODO copy). The file's other two describe blocks (API client tests,
  `isValidQuietHoursTime` unit tests) don't touch `GeneralPane` — leave them, just fix the import
  path.

No escalation needed for either — both are mechanical task-sequencing completions, not
product/architecture forks. Coordinator already told: "found plan gap, folding fix into Task 4."

## Task 4 remaining work (investigated in full, nothing written yet)

Merge Account & preferences (personal) and remove General.

In `apps/web/src/settings/settings-personal-data-panes.tsx`:
- Delete the `GeneralPane` function (currently ~lines 762-904) and its entry in the
  `export { ConnectedPane, SourcesPane, ModulesPane, GeneralPane };` line (~906).
- Delete `DEFAULT_LOCALE_SETTINGS` (~102-106), `DEFAULT_QUIET_HOURS` (~108-113),
  `isValidQuietHoursTime` (~115-117) — move all three into `settings-personal-panes.tsx` (grep
  confirmed `isValidQuietHoursTime` has no other usage in this file besides inside `GeneralPane`).
- Remove now-unused imports: `getLocaleSettings, putLocaleSettings, getQuietHoursSettings,
  putQuietHoursSettings` (~37,40,42,43) and `LocaleSettingsDto, QuietHoursSettingsDto` type
  imports (~83-84) — **grep-verify each is truly unused elsewhere in the file first**.

In `apps/web/src/settings/settings-personal-panes.tsx`:
- `ProfilePane` (currently lines 87-166): rename `PaneHead title="Profile & account"` →
  `title="Account & preferences"`.
- Insert the moved Locale `Group` and Quiet-hours `Group` (the JSX body of the old `GeneralPane`,
  not its `PaneHead`) between the existing "Account" `Group` and `<Sessions />`.
- Add imports: `useMutation, useQuery` from `@tanstack/react-query` (file currently only imports
  `useQueryClient`), `getLocaleSettings, putLocaleSettings, getQuietHoursSettings,
  putQuietHoursSettings` from `../api/client`, `Select, Switch` (whatever primitive import path the
  old `GeneralPane` used — check the pre-deletion `settings-personal-data-panes.tsx` diff via `git
  show 51f092a4~0:apps/web/src/settings/settings-personal-data-panes.tsx` or `git log -p` if
  already deleted by the time you read this), and the feedback/toast hook `GeneralPane` used for
  mutation error handling — confirm whether `settings-personal-panes.tsx` already sits inside a
  `FeedbackProvider` context or needs its own import.

Then:
- Write/extend the failing test in a new `tests/unit/settings-personal-panes.test.tsx` per the
  plan's Task 4 Step 1 example (read that section fresh — Task 4 lines, plan file — for the exact
  assertions expected). Confirm FAIL before implementing, PASS after.
- Apply the `settings-page.tsx` and `settings-quiet-hours-pane.test.tsx` fixes described above.
- `grep -rn "GeneralPane" apps/web/src tests` → must return zero results.
- Explicit-file stage + commit: `feat(settings): merge General into Account & preferences` +
  `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.

## Then continue Tasks 5–10 (not yet read in detail — read each by section, not up front)

5. Merge People & access (admin), remove Identity.
6. Grouped shell registries (`PERSONAL_GROUPS`/`ADMIN_GROUPS`) + durable URL section state
   (`?section=` via `setSearchParams` push) in `settings-page.tsx` — the big rewrite.
7. Module list/detail URL contract + configurable visibility wiring — **this is where
   `visibleUserToggleModules` and the stray test file finally get deleted** (see above).
8. Bounded rail + shared detail-width CSS (`settings.css`).
9. Playwright acceptance spec `tests/e2e/settings-shell.spec.ts` (5 scenarios).
10. Full `pnpm verify:foundation` gate.

Then `coordinated-wrap-up`: clean tree, own gate, pre-push trio (`format:check && lint &&
typecheck` + `git fetch origin main && git rebase origin/main`), push, open PR, report PR +
evidence to `UX Coordinator` — **never merge, never touch the board.**

## Process reminders

- TDD per task: failing test → confirm FAIL → implement → confirm PASS → explicit `git add
  <files>` (never `-A`) → commit with Co-Authored-By trailer.
- `executing-plans`/`subagent-driven-development` disabled in this repo — drive the plan yourself.
- Watch the file-size gate (1000 lines/file): `settings-personal-data-panes.tsx` and
  `settings-admin-panes.tsx` are both close to the ceiling.
- Relay again on the context-meter 70% warning or immediately on seeing a compaction summary —
  don't trust felt %. Message `UX Coordinator` (re-resolved fresh) before relaying.
