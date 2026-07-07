# Build Handoff — settings-ui scanner: reject shell-reserved route collisions (#835)

**Spec (approved):** docs/superpowers/specs/2026-07-04-module-web-registry.md
**GitHub issue:** #835
**Risk tier:** `routine`
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/835-scanner-reserved-paths`
**Branch:** `835-scanner-reserved-paths` off `origin/main` @ `616b9ed1`
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; verify `herdr pane list`
shows EXACTLY ONE pane with this label, resolved fresh (never a cached pane number).
**Coordinator session id:** `f64fd971-3fad-4880-a2fd-6dbb7aba935e`
**Relay trigger:** context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store).
2. Read the issue in full: `gh issue view 835 --repo motioneso/jarv1s`. Fix: add a shell-reserved
   path denylist to `scanModuleWeb` (throw at build time, same style as the existing duplicate-path
   error), sourced from or asserted against the shell entries in
   `apps/web/src/app-route-metadata.ts` so the two can't drift.
3. Read the spec above IN FULL.
4. Invoke **`coordinated-build`** and follow it end-to-end: verify the acceptance criteria
   (fixture test: module declaring a shell-reserved path fails `scanModuleWeb` with a clear error;
   a drift-guard unit test ties the denylist to the shell entries) against your actual branch →
   plan → coordinator approval (do NOT write code before it) → TDD build →
   **`coordinated-wrap-up`** (PR + report).

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- You own `packages/settings-ui/src/scanner.ts` and `apps/web/src/app-route-metadata.ts` for this
  run. #834 touches `packages/settings` (a different package — no overlap). #832/#833/#836
  (datasets chain) and #837 (sports web) are fully disjoint. Confirmed by the Phase-0 collision
  map in the run manifest.
