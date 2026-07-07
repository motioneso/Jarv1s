# Build Handoff — untangle jobs↔settings↔proactive-monitoring dependency cycle (#834)

**Spec (approved):** docs/superpowers/specs/2026-07-04-module-web-registry.md (module-isolation
follow-up from the #798 combined security review; the module-boundary enforcement work in that
epic is the governing spec for this fix)
**GitHub issue:** #834
**Risk tier:** `sensitive` — module-isolation boundary work (package dependency graph). No
auth/RLS/secret surface, but regression risk against the module-isolation invariant and the
`check-package-deps` gate. Build to that bar; QA will do an explicit invariant check, not just CI.
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/834-jobs-settings-cycle`
**Branch:** `834-jobs-settings-cycle` off `origin/main` @ `616b9ed1`
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; verify `herdr pane list`
shows EXACTLY ONE pane with this label, resolved fresh (never a cached pane number).
**Coordinator session id:** `f64fd971-3fad-4880-a2fd-6dbb7aba935e`
**Relay trigger:** context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store).
2. Read the issue in full: `gh issue view 834 --repo motioneso/jarv1s`. Confirmed cycle:
   `settings→proactive-monitoring→jobs→settings` (plus a direct `settings↔jobs` edge).
3. Read the spec above IN FULL.
4. Invoke **`coordinated-build`** and follow it end-to-end: verify the acceptance criteria
   (`pnpm verify:foundation` green; no import cycle among the three packages; optional gate
   extension fails red on a reintroduced cycle) against your actual branch → plan → coordinator
   approval (do NOT write code before it) → TDD build → **`coordinated-wrap-up`** (PR + report).

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- You own `packages/jobs`, `packages/settings`, `packages/proactive-monitoring` for this run.
  #835 touches `packages/settings-ui` (a different package — no overlap). #832/#833/#836
  (datasets chain) and #837 (sports web) are fully disjoint. Confirmed by the Phase-0 collision
  map in the run manifest.
