# Build Handoff — 2026-07-08-sports-followed-team-dedupe

**Spec (approved):** docs/superpowers/specs/2026-07-08-sports-followed-team-dedupe.md
**GitHub issue:** #855
**Risk tier:** `routine` — standard QA (CI gate + `/code-review` + exit-criteria), auto-merge
after green.
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/855-sports-dedupe **Branch:** `build/855-sports-dedupe` (off `origin/main` @ `33270eef`)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (follow this
exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging,
verify `herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never
a cached `…-N` pane number — they reflow).
**Coordinator session id:** `dd8b3920-6924-4eaf-b2bf-4120f187c7a3` (immutable authority; label is only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the spec above IN FULL.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify the spec against your actual
   branch → plan → coordinator approval (do NOT write code before it) → TDD build →
   **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and caveman-mode
   comms are all defined there — this doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- **You are the blocking predecessor for #858** (a sibling build queued for after your PR merges).
  #858 re-keys the same `getOverview()` dedup/caps region you're rewriting
  (`packages/sports/src/sports-service.ts`, ~lines 188–347) — get your PR merged cleanly and
  promptly; #858's worktree branches from `main` only after you land.
- **No collision with #866** — different modules entirely, build in either order relative to it.
- **Minor QA flag (Opus review, non-blocking for you but worth building correctly):** your
  "most recently created follow" primary-competition-selection logic assumes a `created_at`-style
  ordering column exists on `sports_follows` (migration 0133) — confirm it during your own build
  rather than assuming.
