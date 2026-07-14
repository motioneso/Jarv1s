# Relay — #984 private chat & history trust hardening (relay 3)

**Trigger:** context-meter 70% warning right after Task 2 GREEN commit.

**Worktree/branch:** `/home/ben/Jarv1s/.claude/worktrees/ux-984-private-history`,
branch `ux/984-private-history`.

**Progress:** Task 1 (`a0989815`) and Task 2 (`e67d53f6`, just committed) both done, both
green. Task 2 added `GET /api/chat/privacy` (shared DTO/schema in `chat-api.ts`, manager method
`getPrivacyState`, route in `live-routes.ts`, manifest registration, frontend client fn +
query key + mount-time `useEffect` sync in `chat-drawer.tsx`, integration test, e2e test). All
11 `chat-drawer.spec.ts` e2e pass; `pnpm typecheck` clean.

**Next concrete steps (in order):**
1. Continue via `superpowers:test-driven-development`, reading
   `docs/superpowers/plans/2026-07-12-private-chat-history-trust-hardening.md` **by section**
   for the current task only:
   - Task 3 (line ~446): bounded replay after `resumeThread` via `pendingForcedReplay` Set.
   - Task 4 (line ~589): unify History row select+resume.
   - Task 5 (line ~775): make History exclusive.
   - Task 6 (line ~869): full gate + pre-push trio + rebase + `coordinated-wrap-up`.
2. Commit each task green, `Co-Authored-By: Claude`, explicit files only (never `git add -A`).
   `.claude/context-meter.log` is pre-existing dirty from before this work started — never
   stage/commit it.
3. Pre-push trio + rebase before any push: `pnpm format:check && pnpm lint && pnpm typecheck`
   then `git fetch origin main && git rebase origin/main`.
4. `coordinated-wrap-up`: full gate, push, open PR, report to UX Coordinator (label
   `UX Coordinator`). Do not merge — merge authority is a separate Coordinator session (label
   `Coordinator`).

**Test-runner gotchas learned this relay:**
- Integration tests: use `pnpm test:integration <path> -t "<name>"` from repo root (not
  `pnpm --filter @jarv1s/api exec vitest ...` — the api package has no local vitest config
  matching that filter path and returns "No test files found"). `test:integration` isolates a
  throwaway Postgres DB per run so it's safe to run standalone even with other agents active.
- E2E: use `pnpm exec playwright test <spec> -g "<name>"` from repo root (not
  `pnpm --filter @jarv1s/web exec playwright test ...` — same "No tests found" issue; the
  playwright config/script lives at repo root, not in `apps/web`).

**Constraints still binding:** Slice 4 / #868-gated acceptance out of scope. Path locks/bans
in `docs/coordination/handoff-984-private-history.md` apply verbatim (no editing
`packages/ai/src/gateway/gateway.ts`, `packages/chat/src/mcp-transport.ts`,
`tests/integration/chat-mcp-transport.test.ts`, `apps/web/src/chat/action-request-card.tsx`,
or shared true-menu call sites outside `chat-drawer.tsx`; `activityVerb()` released to #985 —
don't reclaim without flagging UX Coordinator). Never edit `docs/coordination/`. Never
`git add -A`. Never merge.

**Skip `pnpm install`** — `node_modules` already present.

**Outstanding from this relay:** report successor label/session to UX Coordinator and request
this pane be reaped once the successor confirms it's driving.
