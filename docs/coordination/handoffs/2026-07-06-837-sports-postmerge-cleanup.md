# Build Handoff — Sports broadsheet post-merge cleanup (#837)

**Spec (approved):** docs/superpowers/specs/2026-07-05-sports-editorial-redesign.md
**GitHub issue:** #837
**Risk tier:** `routine` — pure styling/dead-code cleanup, no behavior change, all gates were
green at the merge this cleans up after.
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/837-sports-postmerge-cleanup`
**Branch:** `837-sports-postmerge-cleanup` off `origin/main` @ `616b9ed1`
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; verify `herdr pane list`
shows EXACTLY ONE pane with this label, resolved fresh (never a cached pane number).
**Coordinator session id:** `f64fd971-3fad-4880-a2fd-6dbb7aba935e`
**Relay trigger:** context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Heads up: another sports agent is active tonight

A separate, earlier-started build agent (pane `w1:p8Y`, worktree `829-sports-broadsheet`,
branch `worktree-829-sports-broadsheet`) is independently working sports ticket work and may PR
around the same time. Your issue (#837) is scoped to "Minor findings from the Fable 5 whole-change
review of PR #831/#839 (sp-fc raw literals, FollowedCard placement, dead empty-state rule)" — if
you find your target lines have already changed underneath you when you start, re-read the current
file state before planning; do not assume the file matches the issue body's line numbers. Flag to
the coordinator (do not silently skip) if your acceptance criteria no longer apply.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store).
2. Read the issue in full: `gh issue view 837 --repo motioneso/jarv1s`.
3. Read the spec above IN FULL.
4. Invoke **`coordinated-build`** and follow it end-to-end: verify the acceptance criteria
   against your actual branch (re-check file state per the note above) → plan → coordinator
   approval (do NOT write code before it) → TDD build → **`coordinated-wrap-up`** (PR + report).

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- You own the specific sports cleanup files named in #837 for this run. #834/#835 (different
  packages) and #832/#833/#836 (datasets chain) are fully disjoint. The OTHER active sports agent
  (`829-sports-broadsheet`, not part of this run) may also touch sports files — see the heads-up
  above; escalate to the coordinator if you see unexpected overlap.
