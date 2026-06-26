# Build Handoff — chat-composer-stop-queue

**Spec (approved):** docs/superpowers/specs/2026-06-25-chat-composer-stop-queue.md
**GitHub issue:** #479
**Risk tier:** `routine` (isolated UI: chat-drawer.tsx state machine; no schema/auth/secret surface. Auto-merge after green QA.)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/chat-composer-stop-queue **Branch:** build/chat-composer-stop-queue (off origin/main @ 63681e9)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (use this exact path if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow when any pane opens/closes; re-resolve the live pane by label from `herdr pane list` each time.)
**Coordinator session id:** `ses_0fef45f35ffeEJBGhPxqAsabKB` (the immutable authority for this coordinator. Confirm this session id is still live before relying on the coordinator.)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing**.
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** For each spec item, grep/read the
   cited files on YOUR branch and confirm the gap/state it describes is still real. If drifted,
   escalate to the coordinator before proceeding.
5. Invoke the **`coordinated-build`** skill and follow it: plan → coordinator approval → build
   TDD/green → pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + rebase before
   push → **`coordinated-wrap-up`** (PR + report).

## Your compact (non-negotiable)

- **CI STATUS (temporary):** GitHub Actions billing is paused. Run the gate **locally**
  (`pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest) and record exit codes.
- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files.
- Plan approval comes from the **coordinator**. Do not write code before it.
- **Escalate to coordinator label `Coordinator`** on blocker / plan-ready / design-fork / done.
- **Never touch** the project board, milestones, or merge.
- **Self-monitor your context.** At ~80–100k tokens or compaction summary: message coordinator, then
  **`relay`**.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for status/escalations to the coordinator. Commit messages, PR bodies, code stay
  normal/conventional.

## Collision notes (from the coordinator)

- **You are wave-1, no collisions.** `apps/web/src/chat/chat-drawer.tsx` is touched by NO other spec.
- **Critical distinction from the spec:** `pendingUserText` (chat-drawer.tsx:67) is the _optimistic
  send echo_, NOT a queue. Your new `queuedText` must be a SEPARATE state variable. Do not conflate.
- The existing Stop button (separate from the send arrow) is the foundation — your work morphs
  send→Stop in-place and adds the depth-1 queue + "Next: …" chip on top.
- **Never touch** `docs/coordination/` (coordinator-only), and never run repo-wide
  `pnpm format` + broad `git add` — scope to your own changed paths only.
