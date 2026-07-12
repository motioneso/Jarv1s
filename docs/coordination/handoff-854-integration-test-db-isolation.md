# Build Handoff — #854 integration tests pollute shared dev DB

**Spec:** none — bug fix using an existing mechanism, not a new feature/module.
**GitHub issue:** #854
**Risk tier:** `routine` — test-harness-only change, no shared-table migration, no production
auth/RLS surface, isolated to integration-test setup. Standard QA + auto-merge on green.
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/854-integration-test-db-isolation
**Branch:** 854-integration-test-db-isolation (off origin/main @ babe07aa)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/worktrees/854-integration-test-db-isolation/.claude/skills/coordinated-build/SKILL.md
(follow this exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `e56b7c36-6f1b-4438-85ef-bb5cad9eed74` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Direction (confirmed by Ben)

Enforce a per-run isolated DB for `test:integration`, reusing the existing `JARVIS_PGDATABASE`
agent-isolation mechanism (already used to scope each fleet agent to its own database) rather than
a harness-refusal or cleanup-only approach. Concurrent integration-test runs across agents/sessions
currently share one dev Postgres and can crash it (recovery mode) or leave cross-run pollution —
the fix should make the integration-test harness always run against a dedicated, isolated database
per invocation (derived per-run, not the shared dev default), using the same mechanism already
proven for per-agent isolation elsewhere in the fleet tooling.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the issue (`gh issue view 854`) and find the existing `JARVIS_PGDATABASE` isolation
   mechanism (grep for it — it's already used elsewhere) before designing anything new.
3. Invoke **`coordinated-build`** and follow it end-to-end: plan → coordinator approval (do NOT
   write code before it) → TDD build → **`coordinated-wrap-up`** (PR + report). Escalation rules,
   gate commands, and comms are all defined there — this doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.
- **Do not touch anything sports-related** (`packages/sports/*`) or Park Press/#780 — out of scope.

## Collision notes (from the coordinator)

- No shared table/migration with #663 or #853 — all three are independent and may land in any
  order.
- Known trap: concurrent `test:integration` runs across agents can crash the shared dev Postgres
  (see agentmemory `multi-agent-pg-contention`) — this issue IS the fix for that; don't just paper
  over it with retry logic.
