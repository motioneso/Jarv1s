# Build Handoff — #984 private chat and history trust

**Spec (approved):** `docs/superpowers/specs/2026-07-12-private-chat-history-trust-hardening.md`
**GitHub issue:** #984
**Risk tier:** `security`
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-984-private-history`
**Branch:** `ux/984-private-history` from `origin/main` `3ca138eb`
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Supervising coordinator:** label `UX Coordinator`, session
`019f57d6-8fff-7783-974a-f40333a52632`
**Final merge authority:** label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f`

## Start

1. Run `[ -d node_modules ] || pnpm install`.
2. Invoke `coordinated-build` and read the approved spec by the sections needed for the current
   task.
3. Ground the current flow with codebase-memory MCP before editing.
4. Produce a compact implementation plan and send it to `UX Coordinator` for approval. Do not write
   feature code before that approval.
5. Build with focused tests, then use `coordinated-wrap-up` to push and open the PR. Do not merge.

## Approved scope

- Build #984 Slices 1–3 only: server-confirmed private-session truth, reliable bounded continuation,
  and exclusive/readable History presentation.
- Slice 4 and final cross-engine privacy acceptance remain blocked on #868. Do not claim or close
  them.
- Reuse the existing private-chat and forced-replay mechanisms; no second persistence, cleanup, or
  replay system.

## Path locks

This lane owns:

- `apps/web/src/chat/chat-drawer.tsx`
- `apps/web/src/api/client.ts`
- the private/history regions of `apps/web/src/styles/kit-chat.css`
- chat session manager, persistence, live routes, and focused private/resume tests

Do not edit these #985-owned surfaces:

- `packages/ai/src/gateway/gateway.ts`
- `packages/chat/src/mcp-transport.ts`
- `tests/integration/chat-mcp-transport.test.ts`
- `apps/web/src/chat/action-request-card.tsx`
- shared true-menu call sites outside `chat-drawer.tsx`

If the implementation genuinely requires one of those paths, stop and message `UX Coordinator`.
The other Coordinator's job-search persistence fix owns infra Compose/module-data-volume paths; do
not touch Instance-modules UI or module install/run behavior.

## Non-negotiable checks

- Prove immediate send cannot race private activation onto an ordinary thread.
- Prove private state restores from server truth after remount/reload.
- Prove explicit resume carries bounded prior context even with `JARVIS_CHAT_REPLAY_K=0`.
- Prove History does not render ordinary composer seeds and row selection activates continuation.
- Preserve owner isolation, DataContextDb, private no-write, and minimum action-audit boundaries.

## Run-specific bans

- Work only in this worktree/branch; stage explicit paths only. Never `git add -A` or run repo-wide
  formatting.
- Never edit `docs/coordination/`, the project board, milestones, or merge state.
- Never edit applied migrations or weaken authentication, authorization, RLS, secret handling,
  provider capability, or audit invariants.
- No secrets or private content in docs, logs, tests, jobs, or prompts.
