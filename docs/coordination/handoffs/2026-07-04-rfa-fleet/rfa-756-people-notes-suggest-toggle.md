# Build Handoff — rfa-756-people-notes-suggest-toggle

**Spec (approved):** GitHub issue #756 itself. Ben (2026-07-04) confirmed this audit-finding bug
report is detailed enough to build from directly — no separate `docs/superpowers/specs/` doc for
this one; the issue body IS the approved spec. Read `gh issue view 756` IN FULL before planning.
**GitHub issue:** #756 — `bug(people/settings): people.notes.suggest-updates is default-on with no
reachable UI toggle`
**Risk tier:** `routine` (board-triaged P1, but pure bug fix — no schema/auth/secret surface).
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-756-people-notes-suggest-toggle` **Branch:**
`rfa-756-people-notes-suggest-toggle` (off `origin/main@32f34d4b`, post-#737 merge)
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md` (follow this
exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `0f374652-df12-44cc-8592-881c421dfebb` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read GitHub issue #756 IN FULL (`gh issue view 756`) — this is your spec.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify the issue's premises against
   your actual branch → plan → coordinator approval (do NOT write code before it) → TDD build →
   **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and comms are all
   defined there — this doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- Scope is the `people.notes.suggest-updates` toggle: it needs a reachable UI control in People
  settings (default-on with no way to turn it off today). Stay inside the People/Settings module's
  own files.
- No overlap expected with #755 (also People module, but the archive/PATCH 500 repro path) or #758
  (broad hygiene batch, not touching People per the coordinator's collision check) — both are
  running in parallel in sibling worktrees. If you find yourself touching a file also claimed by
  #755's archive-path fix, stop and escalate to the coordinator before proceeding.
