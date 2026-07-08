# Build Handoff — private-chat-mode (#744)

**Spec (approved):** docs/superpowers/specs/2026-07-05-private-chat-mode.md
**GitHub issue:** #744
**Risk tier:** `security` — this PR gets adversarial Opus QA + a mandatory `gh pr comment`
verdict + Ben's explicit merge sign-off before merge. Never auto-merged. Build to that bar: the
spec's core invariant is that private mode writes **zero** `chat_messages` rows, **zero** memory
jobs, and purges the on-disk CLI transcript + bookkeeping row on every session-end path (explicit
end route AND the idle reaper) — treat any code path that could leave a residual trace as a
blocking defect in your own self-review before wrap-up.
**Worktree:** ~/Jarv1s/.claude/worktrees/744-private-chat-mode **Branch:**
`744-private-chat-mode` (off `origin/main` @ `ec0fbe4a`)
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
3. **A pre-written build-ready plan already exists:**
   `docs/superpowers/plans/2026-07-06-private-chat-mode-plan.md`. Read it against the spec and
   against current `origin/main` (it predates this build by ~2 days) — if it still matches the
   spec's locked decisions and the code it references still exists as described, submit it as-is
   for coordinator approval (do NOT start code before that approval — the plan itself says so). If
   it's drifted from current `main` or you find a genuine fork the spec didn't settle, escalate to
   the coordinator with `[DESIGN-FORK]` rather than silently deviating.
4. Invoke **`coordinated-build`** and follow it end-to-end through the approval gate → TDD build →
   **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and caveman-mode
   comms are all defined there — this doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt. Nothing in private mode may loosen existing
  secret filters or redaction paths — this is a hard spec invariant, not a suggestion.

## Collision notes (from the coordinator)

- **You are first in a 3-way collision cluster** with #759 (chat-model-selector) and #760
  (skill-integration-chat) — all three touch `apps/web/src/chat/chat-drawer.tsx` +
  `composer.tsx`, plus backend overlap in `live/chat-session-manager.ts` and
  `live/cli-chat-engine.ts`. You are landing FIRST specifically because #759/#760 build on your
  incognito/ephemerality semantics — land clean, land soon; #759 is waiting on your merge to
  rebase its `switchProvider`/chat-drawer touches against yours.
- No migration expected (extends the existing `chat_threads.incognito` column) — if you find you
  need one, message the coordinator for the next free number (currently `0145` on `origin/main` as
  of this handoff, but re-check — don't assume).
- `#742` (email-digest-delivery) is building in parallel in a sibling worktree — no file overlap
  expected, no coordination needed.
