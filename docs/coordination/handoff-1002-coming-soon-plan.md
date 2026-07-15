# Planning Handoff — #1002 Coming-soon inventory

**GitHub issue:** #1002
**Deliverable:** approved design spec and execution plan only; no product implementation
**Worktree:** `~/Jarv1s/.claude/worktrees/plan-1002-coming-soon`
**Branch:** `plan/ux-1002-coming-soon` from `origin/main`
`514e9b78b15a3740244e1da30923659988e0aae3`
**Coordinator label:** `UX Coordinator`
**Coordinator session:** `019f66e1-aefb-7df2-b339-c4168d3266c1`

## Locked product direction

- Treat every visible `Coming soon` promise as a commitment that maps to one concrete open GitHub
  issue with actionable scope and acceptance criteria.
- Do not remove promises as cleanup. Remove only capabilities explicitly declared not planned.
- Reconcile the issue's existing inventory and Ben's 2026-07-14 clarification, including the
  GitHub connected-account tracker #1061.

## Start

1. Run `pnpm install`.
2. Read `CLAUDE.md`, GitHub issue #1002 and its comments, then use the codebase-memory graph tools
   to inventory every user-visible promise and its owning surface. Recall `jarv1s current project
   state` before planning.
3. Verify every proposed tracker against live GitHub source of truth. Identify missing trackers,
   collisions, dependencies, and mechanical risk tiers; do not create or mutate trackers yet.
4. Write the minimum complete design spec and execution plan under `docs/superpowers/`. Keep
   implementation slices explicit enough for isolated build agents and include the required live
   UI verification for every changed user surface.
5. Commit and push the docs-only branch, open a PR, and send the PR plus one-line approval pointer
   to exact `UX Coordinator` session `019f66e1-aefb-7df2-b339-c4168d3266c1`.

## Bans

- No product code, migrations, GitHub issue mutations, merge, or board updates.
- Do not edit `docs/coordination/` or this handoff after starting.
- Stage explicit paths only; never `git add -A`, `git add .`, or repo-wide formatting.
- Use `~/Jarv1s` rather than an absolute local path in documentation.
