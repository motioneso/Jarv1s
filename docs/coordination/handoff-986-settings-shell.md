# Build Handoff — #986 settings shell and navigation

**Spec (approved):** `docs/superpowers/specs/2026-07-12-settings-shell-navigation-ia-hardening.md`
**Approval:** Fable verdict on PR #1008
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-986-settings-build`
**Branch:** `ux/986-settings-build` from green `origin/main` `3ca138eb`
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Supervising coordinator:** label `UX Coordinator`, session
`019f5a2e-03fd-71c3-95ab-1934cb1de973`
**Final merge authority:** label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f`

## Start

1. Run `[ -d node_modules ] || pnpm install`.
2. Invoke `coordinated-build`; read only the spec sections needed for the current task.
3. Ground the current flow with codebase-memory MCP.
4. Send a compact plan to `UX Coordinator` for approval before feature edits.
5. Build, run focused checks, then invoke `coordinated-wrap-up`; never merge.

## Locks

- Own the settings shell/chrome/navigation, the two approved destination merges, configurable-module
  visibility, and shell-owned contributed-module back navigation described by the spec.
- Do not edit `InstanceModulesPane` behavior, install/run controls, `RunNowButton`,
  `external-module-jobs`, `module-jobs.ts`, or #1000 seed/harness code.
- Re-resolve and message the primary `Coordinator` before opening `settings-admin-panes.tsx`,
  `settings-page.tsx`, shared Playwright fixtures, or settings selectors. Its #1007 lane may drive
  Instance-modules in Playwright but will not edit shell/chrome/nav.
- #987 is held behind your `settings-personal-data-panes.tsx` lock. Report when that path is stable
  or released.
- Work only here; stage explicit paths. Never edit `docs/coordination/`, run repo-wide formatting,
  update tracking, or merge.
