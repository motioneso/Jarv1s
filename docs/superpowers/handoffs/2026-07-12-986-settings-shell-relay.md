# Relay — #986 settings shell/navigation

**Worktree:** `~/Jarv1s/.claude/worktrees/ux-986-settings-build` (branch `ux/986-settings-build`)
**Spec:** `docs/superpowers/specs/2026-07-12-settings-shell-navigation-ia-hardening.md`
**Handoff:** `docs/coordination/handoff-986-settings-shell.md`
**Plan (committed, self-contained — do not re-derive):** `docs/superpowers/plans/2026-07-12-settings-shell-navigation.md`
**Supervising coordinator:** label `UX Coordinator`, session `019f5a2e-03fd-71c3-95ab-1934cb1de973`
(re-resolve pane fresh via `herdr pane list` — never trust a baked-in `w…-N`)

## Status

- Spec premises reverified current on this branch (grounded against `origin/main` `3ca138eb`).
- Primary Coordinator gave collision-clearance to open `settings-admin-panes.tsx`,
  `settings-page.tsx`, shared Playwright fixtures, settings selectors.
- 10-task plan written and committed (`60b8cfae`), covering all 4 build slices with exact file
  paths, code, and commit messages.
- Plan-ready message sent + **queued** (busy agent) to UX Coordinator via `herdr-pane-message`.
- **No code written yet.** No plan approval received yet.

## Next action

1. Poll/wait for UX Coordinator's reply (re-resolve pane by label `UX Coordinator` fresh, `herdr
   pane read <pane> --source recent --lines 12`).
2. On approval: execute the plan Task 1 → Task 10 via `superpowers:test-driven-development`
   (self-driven — `executing-plans`/`subagent-driven-development` disabled in this repo). Commit
   per task, `Co-Authored-By: Claude` trailer, stage only each task's explicit files (never
   `git add -A`).
3. Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
4. On Exit Criteria met: full verification gate (Task 10 in the plan doc), then
   `coordinated-wrap-up` — PR + report to UX Coordinator. Never merge.
5. If the plan itself needs a fork/change, escalate to UX Coordinator before deviating.

## Exclusions (unchanged)

Never touch `InstanceModulesPane` behavior, install/run controls, `RunNowButton`,
`external-module-jobs.ts`, `module-jobs.ts`, #1000 seed/harness code, `apps/api`, `apps/worker`,
`packages/module-registry`, database/migrations/Compose/prod-deploy files, or `docs/coordination/`.
