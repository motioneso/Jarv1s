# Build Handoff — error-explainability

**Spec (approved):** docs/superpowers/specs/2026-07-07-error-explainability.md
**GitHub issue:** #817
**Risk tier:** `security` — new `FORCE ROW LEVEL SECURITY` table + policies (D3) is a mechanical
security-tier trigger. This PR gets adversarial Opus QA + Ben's explicit merge sign-off — build to
that bar. Do not assume CI-green alone is enough.
**Worktree:** `.claude/worktrees/817-error-explainability` **Branch:** `817-error-explainability`
(cut off `origin/main` @ `eafb6ae5`)
**Build skill path (absolute):** `.claude/skills/coordinated-build/SKILL.md` (follow this exact
file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `2504c431-ecdc-4969-ba0e-fe0d5066af0a` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the spec above IN FULL — it has already been through two rounds of coordinator review
   (tier corrected `sensitive` → `security`; D4 stack-trace field mapping fixed to explicitly drop
   `stack` at the write boundary). Build to what D1–D5 actually say, not to the issue body alone.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify the spec against your actual
   branch → plan → coordinator approval (do NOT write code before it) → TDD build →
   **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and caveman-mode
   comms are all defined there — this doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt. Given the tier, be especially careful: the new
  `app.jarvis_error_log` table is user-queryable via a chat tool (D5) — no `stack` field, no raw
  internal exception text, ever reaches it or the chat tool's output.

## Collision notes (from the coordinator)

- None. No shared table, no shared module, no migration-number collision with anything currently
  in flight (#853 is the only other live build, in `packages/auth`, unrelated). New migration
  `0145_jarvis_error_log.sql` — confirm the next free migration number against `origin/main` at
  build time in case something else landed a migration since this handoff was written.
