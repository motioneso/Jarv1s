# Build Handoff — chat-model-selector (#759)

**Spec (approved):** docs/superpowers/specs/2026-07-05-chat-model-selector.md
**GitHub issue:** #759
**Risk tier:** `routine` — spec self-labels `routine`, no secret/auth surface. Standard QA
(CI gate + `/code-review` + exit-criteria); auto-merges after green.
**Worktree:** ~/Jarv1s/.claude/worktrees/759-chat-model-selector **Branch:**
`759-chat-model-selector` (off `origin/main` @ `791ce5e4`, verified CI green before cut)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md (follow this
exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `4727de9a-8e93-4bd6-a684-7320d6a54a5a` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the spec above IN FULL.
3. **A pre-written build-ready plan already exists:**
   `docs/superpowers/plans/2026-07-06-chat-model-selector-plan.md`. Read it against the spec and
   against current `origin/main` (#744 private-chat-mode has just landed — the plan predates that
   merge, so re-check `apps/web/src/chat/chat-drawer.tsx`, `composer.tsx`, and
   `packages/chat/src/live/chat-session-manager.ts` for drift against what the plan assumes). If it
   still matches the spec's locked decisions and the code it references still exists as described,
   submit it as-is for coordinator approval (do NOT start code before that approval — the plan
   itself says so). If it's drifted from current `main` or you find a genuine fork the spec didn't
   settle, escalate to the coordinator with `[DESIGN-FORK]` rather than silently deviating.
4. Invoke **`coordinated-build`** and follow it end-to-end through the approval gate → TDD build →
   **`coordinated-wrap-up`** (PR + report). Escalation rules, gate commands, and caveman-mode
   comms are all defined there — this doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- You are **Wave 2** of a 3-way collision cluster with #744 (private-chat-mode, already merged
  `791ce5e4`) and #760 (skill-integration-chat, not yet spawned — Wave 3). All three touch
  `apps/web/src/chat/chat-drawer.tsx` + `composer.tsx`, plus backend overlap in
  `live/chat-session-manager.ts`. #744 landed first specifically so you could build on its
  incognito/ephemerality semantics — rebase onto current `origin/main` (already done at worktree
  creation) and re-verify your plan's touches to `chat-drawer.tsx` against what #744 actually
  shipped, not just what the plan assumed.
- Your same-provider "relaunch-with-replay" switch mechanism (Task 3: `POST /api/chat/switch`,
  `chat-session-manager.ts`, `persistence.ts`) is new backend surface `#760` will build on next —
  land it clean; #760 is waiting on your merge.
- No migration expected — this reuses the existing `chat.modelOverride` preference path
  (`AiRepository.getChatModelOverridePreference`) and existing provider/model discovery
  infrastructure. If you find you need one, message the coordinator for the next free number —
  don't assume.
- **Provider-mix directive (Ben, 2026-07-07):** you are the 3rd of 3 Codex build-agent slots this
  run (Build-742 and Build-744 were the first two). Wave 3 (#760) reverts to Claude Sonnet.
