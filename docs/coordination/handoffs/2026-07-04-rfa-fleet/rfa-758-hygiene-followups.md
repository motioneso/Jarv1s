# Build Handoff — rfa-758-hygiene-followups

**Spec (approved):** GitHub issue #758 itself. Ben (2026-07-04) confirmed this audit-finding batch
is detailed enough to build from directly — no separate `docs/superpowers/specs/` doc; the issue
body IS the approved spec. Read `gh issue view 758` IN FULL before planning.
**GitHub issue:** #758 — `chore: hygiene follow-ups from 2026-07-04 adversarial PR review (LOW
findings)`. Eight independent LOW-severity checklist items (none security, none blocking):
IMAP onboarding state-clearing, muted-source chat evidence exclusion (or relabel), quiet-hours
empty-string PUT 400, dead CSS/token cleanup, orphaned settings-data-source-model.ts + dead
`email.capture-tasks` manifest entry, a defense-in-depth note on `upsertPersonProjection` (no code
change required, just confirm/comment), a dead-code note on `SportsOverviewResponse.degraded`, and
a missing `is-active` styling test for the sports team picker.
**Risk tier:** `routine` (all LOW severity, hygiene/cleanup only).
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-758-hygiene-followups` **Branch:**
`rfa-758-hygiene-followups` (off `origin/main@32f34d4b`, post-#737 merge)
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md` (follow this
exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `0f374652-df12-44cc-8592-881c421dfebb` (immutable authority; label is
only routing — if this session has since relayed, resolve the current holder fresh, don't trust
this value blindly).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read GitHub issue #758 IN FULL (`gh issue view 758`) — this is your spec.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify each checklist item's premise
   against your actual branch (some items may be partially stale — confirm before fixing) → plan
   (one PR covering the checklist, item-by-item TDD where a code change applies) → coordinator
   approval → build → **`coordinated-wrap-up`** (PR + report). It is fine if some items turn out to
   be comment-only / no-code (e.g. the `upsertPersonProjection` defense-in-depth note) — say so in
   your plan rather than forcing a change.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- This batch spans onboarding, chat priority, quiet hours, dead CSS/tokens, settings-data-source
  cleanup, people repository (comment/note only), and sports — but does NOT touch the People module
  UI/routes that #755 and #756 are actively editing in sibling worktrees. If any item's real fix
  touches a file #755/#756 also touch, stop that item and escalate rather than guessing at merge
  order.
- `packages/priority/src/scoring.ts` / `packages/chat/src/priority-consumer.ts` (the muted-sources
  item) and `quiet-hours-routes.ts` were last touched by already-merged #721/#733 — no other live
  agent is in those files right now, safe to proceed.
