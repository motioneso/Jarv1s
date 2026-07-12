# Build Handoff — skill-integration-chat (#760, Wave 3)

**Spec (approved):** docs/superpowers/specs/2026-07-05-skill-integration-chat.md — **Status:
Approved (2026-07-07, Ben)**, re-verified against `origin/main` @ `263716af` (post #873 merge) by
this coordinator before spawn.
**GitHub issue:** #760
**Risk tier:** `security` (spec self-labels `security-sensitive` — first user-authored content
deliberately fed back to the model as instructions; new owner-scoped RLS table `app.chat_skills`).
This PR gets adversarial Opus QA + Ben merge sign-off — build to that bar.
**Worktree:** `.claude/worktrees/760-skill-integration-chat` **Branch:**
`760-skill-integration-chat` (cut off `origin/main` @ `263716af`)
**Build skill path (absolute):**
`/home/ben/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/skills/coordinated-build/SKILL.md`
(follow this exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `58cd692d-ac30-4f76-9e47-a810041e358d` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the spec above IN FULL, then read the **pre-written plan**:
   `docs/superpowers/plans/2026-07-06-skill-integration-chat-plan.md` — it opens with "do not start
   code until Coordinator approves this plan." Verify it still matches your actual branch
   (drift-check against anything landed since 2026-07-06) before requesting approval — do not
   assume it's still current just because it exists.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify plan-vs-branch drift → coordinator
   approval (do NOT write code before it) → TDD build → **`coordinated-wrap-up`** (PR + report).
   Escalation rules, gate commands, and comms are all defined there — this doc does not restate
   them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- **You own this wave's only migration.** Highest module migration on `origin/main` as of spawn
  (`263716af`) is `0146` — your migration is `0147`. Re-check the highest number yourself
  immediately before writing the migration file (other lanes may land in the meantime) — never
  assume the number above is still current at write time.
- **Provider:** this is the 4th spawn in the "RFA wave" (#742, #744, #759, #760) — per the
  provider-mix directive the first 3 used Codex (all 3 slots now used); #760 reverts to **Claude
  Sonnet**.
- **#744/#759/#760 were flagged as a 3-way collision cluster** on shared chat-composer/route files
  (`live/cli-chat-engine.ts`, `routes.ts`, `settings-page.tsx`) — #744 and #759 are now BOTH merged
  (`ec0fbe4a`/#865 private-chat, `263716af`/#873 model-selector) so you are building against their
  landed state directly, not racing them. Expect your diff to touch the same files they touched;
  read current `origin/main` state of those files rather than assuming the pre-written plan's
  file-map is byte-exact after two intervening merges.
- **Storage model was Fable-reviewed 2026-07-05** per the spec header — treat `app.chat_skills`'s
  RLS/column shape as settled unless you find it's actually wrong against current schema
  conventions, not just stylistically different.
- Tier is `security` — when done: Opus adversarial QA → mandatory `gh pr comment` verdict → Ben's
  explicit merge sign-off before merge. Do not expect auto-merge even on green CI.
