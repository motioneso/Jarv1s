# Relay — #984 private chat & history trust hardening

**Trigger:** context-meter 70% warning. Zero feature code written — this is a pre-build relay.

**Worktree/branch:** `/home/ben/Jarv1s/.claude/worktrees/ux-984-private-history`,
branch `ux/984-private-history` (from `origin/main` `3ca138eb`).

**Handoff doc:** `docs/coordination/handoff-984-private-history.md` (read it first — path
locks, bans, non-negotiable checks).

**Spec:** `docs/superpowers/specs/2026-07-12-private-chat-history-trust-hardening.md`.

**Plan (written, untracked — commit it as your first action):**
`docs/superpowers/plans/2026-07-12-private-chat-history-trust-hardening.md` — 6 tasks, full
TDD steps, no placeholders:
1. Fix `startPrivateChat` race in `chat-drawer.tsx` (await `clearChat` before flipping
   `privateMode`; gate `sendMessage` on new `activatingPrivate` state).
2. `GET /api/chat/privacy` server-truth restore endpoint (wraps existing
   `persistence.getCurrentThreadState`, new manager method `getPrivacyState`, new shared DTO,
   frontend `useQuery` syncs `privateMode` on mount).
3. Force bounded replay after `resumeThread` via a new `pendingForcedReplay` Set on
   `ChatSessionManager`, consumed once by `ensureSession` — mirrors the `forceReplay` pattern
   `switchProvider` already uses. No new replay system.
4. Unify History row select+resume into one action; delete the separate Play button and the
   `.chatd-review` banner.
5. Make History exclusive — suppress ordinary `EmptyState`/composer-seed content while
   `showHistory` is true.
6. Full gate + pre-push trio + rebase + `coordinated-wrap-up` (PR + report, no merge).

**Coordinator approval status: APPROVED.** UX Coordinator (label `UX Coordinator`, session
`019f5a2e-03fd-71c3-95ab-1934cb1de973` — resolve pane fresh by label, never a baked `…-N`)
approved the plan as summarized: T1-T6 stay within #984 Slices 1-3, reuse existing
privacy/replay seams, no fork. Directive: preserve owner-scoped server truth, one-shot bounded
replay, the exact path locks, and the Slice 4/#868 exclusion. Successor may start building
immediately — no need to re-confirm approval.

**Next concrete steps (in order):**
1. `git add docs/superpowers/plans/2026-07-12-private-chat-history-trust-hardening.md
   docs/superpowers/handoffs/2026-07-12-ux-984-private-history-relay.md && git commit` (explicit
   paths only, never `-A`).
2. Build Tasks 1-6 via `superpowers:test-driven-development` (NOT `executing-plans` /
   `subagent-driven-development` — disabled in this repo), one task at a time, commit each green
   with `Co-Authored-By: Claude`, staging only that task's explicit files.
4. Pre-push trio + rebase before any push: `pnpm format:check && pnpm lint && pnpm typecheck` then
   `git fetch origin main && git rebase origin/main`.
5. `coordinated-wrap-up`: full gate, push, open PR, report to UX Coordinator. Do not merge —
   merge authority is a separate Coordinator session (label `Coordinator`,
   session `58a78927-385c-4b1d-8fa0-94db20255d6f`).

**Constraints still binding:** Slice 4 / #868-gated acceptance out of scope, do not claim or
close. Path locks/bans from `docs/coordination/handoff-984-private-history.md` apply verbatim
(no editing `packages/ai/src/gateway/gateway.ts`, `packages/chat/src/mcp-transport.ts`,
`tests/integration/chat-mcp-transport.test.ts`, `apps/web/src/chat/action-request-card.tsx`, or
shared true-menu call sites outside `chat-drawer.tsx`). Never edit `docs/coordination/`. Never
`git add -A`.

**Skip `pnpm install`** — `node_modules` already present in this worktree.
