# Relay — #984 private chat & history trust hardening (relay 2)

**Trigger:** context-meter 73% warning mid-Task-1 GREEN fix.

**Worktree/branch:** `/home/ben/Jarv1s/.claude/worktrees/ux-984-private-history`,
branch `ux/984-private-history`.

**Progress since prior relay
(`docs/superpowers/handoffs/2026-07-12-ux-984-private-history-relay.md`):**
Task 1 done and committed (`a0989815`) — fixed the `startPrivateChat` race in
`apps/web/src/chat/chat-drawer.tsx` (await `clearChat({incognito:true})` before flipping
`privateMode`; new `activatingPrivate`/`privateActivationError` state gates `sendMessage`).
New e2e test in `tests/e2e/chat-drawer.spec.ts` passes. Also touched
`tests/e2e/mock-chat-api.ts` (centralized default `/api/chat/clear` mock + `clearGate` for
race testing — not in the original plan's file list, but necessary support, included in the
commit) and `tests/e2e/mock-api.ts` (`MockApiState.clearGate` field passthrough).

**Trap hit + fixed (saved to agentmemory):** Playwright `page.route("**/api/chat/clear", ...)`
does not match request URLs with a query string (`?incognito=true`) — glob requires an exact
literal-suffix match. Fixed by matching on `(url) => url.pathname.endsWith("/api/chat/clear")`
instead of a glob string.

**Lock resolved:** UX Coordinator asked whether #984 needs `activityVerb()` in
`chat-drawer.tsx` (line ~715) before releasing it to #985 (widening `action_result` outcome
with `allowed`). Confirmed via grep — #984's Task 1 diff never touches that function. Hunk is
released to #985 free and clear. If Tasks 2-6 ever need it, flag UX Coordinator first.

**Next concrete steps (in order):**
1. Continue via `superpowers:test-driven-development` (not `executing-plans` /
   `subagent-driven-development`), reading
   `docs/superpowers/plans/2026-07-12-private-chat-history-trust-hardening.md` **by section**
   for the current task only:
   - Task 2 (line ~223): `GET /api/chat/privacy` server-truth restore endpoint.
   - Task 3 (line ~446): bounded replay after `resumeThread` via `pendingForcedReplay` Set.
   - Task 4 (line ~589): unify History row select+resume.
   - Task 5 (line ~775): make History exclusive.
   - Task 6 (line ~869): full gate + pre-push trio + rebase + `coordinated-wrap-up`.
2. Commit each task green, `Co-Authored-By: Claude`, explicit files only (never `git add -A`).
3. Pre-push trio + rebase before any push: `pnpm format:check && pnpm lint && pnpm typecheck`
   then `git fetch origin main && git rebase origin/main`.
4. `coordinated-wrap-up`: full gate, push, open PR, report to UX Coordinator (label
   `UX Coordinator`). Do not merge — merge authority is a separate Coordinator session (label
   `Coordinator`).

**Constraints still binding:** Slice 4 / #868-gated acceptance out of scope. Path locks/bans
in `docs/coordination/handoff-984-private-history.md` apply verbatim (no editing
`packages/ai/src/gateway/gateway.ts`, `packages/chat/src/mcp-transport.ts`,
`tests/integration/chat-mcp-transport.test.ts`, `apps/web/src/chat/action-request-card.tsx`,
or shared true-menu call sites outside `chat-drawer.tsx`; `activityVerb()` released to #985 —
don't reclaim without flagging). Never edit `docs/coordination/`. Never `git add -A`.

**Skip `pnpm install`** — `node_modules` already present.

**Outstanding from this relay:** report successor label/session to UX Coordinator and request
this pane be reaped once the successor confirms it's driving.
