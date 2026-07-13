# #986 settings shell/navigation — relay 3 (Task 4 done, start Task 5)

Spec: `docs/superpowers/specs/2026-07-12-settings-shell-navigation-ia-hardening.md`
Plan: `docs/superpowers/plans/2026-07-12-settings-shell-navigation.md` (10 tasks, TDD, read by
section per task — never front-to-back)
Worktree: `~/Jarv1s/.claude/worktrees/ux-986-settings-build`, branch `ux/986-settings-build`
Coordinator: label `UX Coordinator`, session `019f5a2e-03fd-71c3-95ab-1934cb1de973` (codex,
`gpt-5.6-sol`). Re-resolve pane fresh via `herdr pane list` before messaging — never trust a
baked-in pane id. Relay skill; report/escalate, never merge.
Prior relay docs (superseded, don't re-read): `docs/superpowers/handoffs/2026-07-12-986-settings-shell-relay.md`,
`docs/superpowers/handoffs/2026-07-12-986-settings-shell-relay2.md`

Skip `pnpm install` — `node_modules` already present.

## Done (4 tasks, all green, all committed)

- Task 1 `f67cf52b` — `SettingsSectionGroup<Section>` + `flattenSettingsGroups` in
  `apps/web/src/settings/settings-navigation.ts`.
- Task 2 `56e8cb3d` — added `visibleConfigurableModules` to `settings-module-view-model.ts`,
  **kept** `visibleUserToggleModules` alive (deviation — finish in Task 7, see below).
- Task 3 `51f092a4` — `<RouterBackButton onBack={props.onBack} />` on the successful-surface
  path in `packages/settings-ui/src/router.tsx`.
- Task 4 `3dd927b7` — merged `GeneralPane` (Locale + Quiet hours) into `ProfilePane` (now titled
  "Account & preferences"), deleted `GeneralPane` + its `settings-page.tsx` wiring
  (`SlidersHorizontal` import, `PERSONAL_SECTIONS` entry, `PersonalSectionId` union member).
  `grep -rn "GeneralPane" apps/web/src tests` → zero. Full `pnpm test:unit` (391 files) +
  `pnpm typecheck` both green before commit.

## One deferred-deletion decision still in flight

**`visibleUserToggleModules` (Task 2 → finish in Task 7).** Plan said "delete it," but its real
caller (`ModulesPane` in `settings-personal-data-panes.tsx`) isn't rewired to
`visibleConfigurableModules` until Task 7. Also a **stray duplicate test file not in the plan's
file list**: `tests/unit/settings-module-view-model.test.ts` (no `web-` prefix) tests
`visibleUserToggleModules` directly. **When Task 7 rewires `ModulesPane`, delete
`visibleUserToggleModules` from `settings-module-view-model.ts` AND delete/migrate that stray
test file.** No escalation needed — mechanical task-sequencing, coordinator already told.

## Next: Task 5 (read plan lines ~295-319 for exact steps, don't reread earlier tasks)

Merge People & access (admin), remove Identity — same shape as Task 4:
- `settings-admin-panes.tsx`: add `Group title="Registration"` (two `Row`s + `Switch`es from
  `IdentityPane`, same `regQuery`/`putMutation` wiring) as first `Group` in `PeoplePane`, before
  "Pending approval". Delete `IdentityPane` + now-unused imports (`Terminal` icon,
  `getRegistrationSettings`/`putRegistrationSettings` move into `PeoplePane`'s imports if not
  already there).
- Test: extend `tests/unit/settings-admin-panes.test.tsx` (read its existing harness first).
- `grep -rn "IdentityPane" apps/web/src tests` → must be zero before commit.
- Also check `settings-page.tsx` for an `IdentityPane` lazy-load entry/admin-section-id analogous
  to the Task 4 General cleanup (plan's Task 5 file list may not mention it — verify by grep
  before assuming it's out of scope, same trap as Task 4).
- Commit: `feat(settings): merge Identity registration into People & access` +
  `Co-Authored-By: Claude <noreply@anthropic.com>` trailer, explicit file staging.

## Then Tasks 6–10 (read each by section only, when you get there)

6. Grouped shell registries (`PERSONAL_GROUPS`/`ADMIN_GROUPS`) + durable `?section=` URL state —
   the big rewrite.
7. Module list/detail URL contract + configurable visibility wiring — delete
   `visibleUserToggleModules` + stray test file here (see above).
8. Bounded rail + shared detail-width CSS (`settings.css`).
9. Playwright acceptance spec `tests/e2e/settings-shell.spec.ts` (5 scenarios).
10. Full `pnpm verify:foundation` gate.

Then `coordinated-wrap-up`: clean tree, own gate, pre-push trio (`format:check && lint &&
typecheck` + `git fetch origin main && git rebase origin/main`), push, open PR, report PR +
evidence to `UX Coordinator` — **never merge, never touch the board.**

## Process reminders

- TDD per task: failing test → confirm FAIL → implement → confirm PASS → explicit `git add
  <files>` (never `-A`) → commit with Co-Authored-By trailer.
- `executing-plans`/`subagent-driven-development` disabled here — drive the plan yourself.
- Watch file-size gate (1000 lines/file): `settings-admin-panes.tsx` is close to the ceiling.
- Relay again on the context-meter 70% warning or immediately on a compaction summary — don't
  trust felt %. Message `UX Coordinator` (re-resolved fresh) before relaying.
- **Recurring trap (bit twice now):** plan's per-task file lists sometimes miss a lazy-load entry
  or section-id reference in `settings-page.tsx`. Grep before assuming a task's file list is
  complete.
