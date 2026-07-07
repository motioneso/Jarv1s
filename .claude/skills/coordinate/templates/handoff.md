# Build Handoff — <spec slug>

**Spec (approved):** docs/superpowers/specs/<slug>.md
**GitHub issue:** #NN
**Risk tier:** `routine` | `sensitive` | `security` (see `coordinate` Risk tiering. `security` ⇒
this PR gets adversarial Opus QA + Ben merge sign-off — build to that bar.)
**Worktree:** <repo>/.claude/worktrees/<slug> **Branch:** <branch off origin/main>
**Build skill path (absolute):** <repo>/.claude/skills/coordinated-build/SKILL.md (follow this
exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging,
verify `herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never
a cached `…-N` pane number — they reflow).
**Coordinator session id:** `<agent_session.value>` (immutable authority; label is only routing).
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

- <e.g. "Your migration lands AFTER #NN's — do not assume a migration number; the coordinator
  assigns landing order." / "You share `app.tasks` with <spec> — coordinate schema changes.">
