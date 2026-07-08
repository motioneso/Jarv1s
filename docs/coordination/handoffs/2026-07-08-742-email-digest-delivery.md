# Build Handoff — email-digest-delivery (#742)

**Spec (approved):** docs/superpowers/specs/2026-07-05-email-digest-delivery.md
**GitHub issue:** #742
**Risk tier:** `routine` — standard QA (CI gate + `/code-review` + exit-criteria); auto-merges
after green, added to Ben's standing digest.
**Worktree:** ~/Jarv1s/.claude/worktrees/742-email-digest-delivery **Branch:**
`742-email-digest-delivery` (off `origin/main` @ `ec0fbe4a`)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md (follow this
exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `63c5023b-8368-49da-9f60-e875e7d60d7f` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the spec above IN FULL.
3. **No pre-written plan exists for this issue** — invoke **`coordinated-build`** and follow it
   end-to-end: verify the spec against your actual branch → author + submit your plan for
   coordinator approval (do NOT write code before it) → TDD build → **`coordinated-wrap-up`** (PR
   + report). Escalation rules, gate commands, and caveman-mode comms are all defined there — this
   doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt. This spec explicitly reuses the user's own
  connector credentials to send-as-user — never let a token, OAuth secret, or app-password reach a
  log, prompt, digest render, or PR body. A test must assert rendered digest output cannot contain
  secrets/credentials/raw private payload (spec §5).

## Collision notes (from the coordinator)

- **Isolated this wave** — no `packages/chat` overlap with the other 3 issues building in
  parallel (#744/#759/#760). Only faint contact: `settings-navigation.ts` /
  `settings-page.tsx` also get an additive pane registration from #760 (skill-integration-chat) —
  trivial, don't coordinate proactively, just keep your diff additive there.
- No migration expected per spec (prefers a generic `PreferencesRepository` key/value row; only
  add a table if fields genuinely don't fit a JSON blob) — if you do need a migration, message the
  coordinator for the next free number before writing it (do not assume one).
