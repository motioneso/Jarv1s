# #1109 runtime-context — relay checkpoint 2

Branch/worktree: `build/1109-runtime-context` @ `/home/ben/Jarv1s/.claude/worktrees/build-1109-runtime-context`.

Plan: `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md` (1152 lines, 7 tasks). Read
by SECTION per task, never in full — a full read burns context before any code is written.

## Coordinator — RESOLVED this checkpoint

`herdr pane list` (fresh, 2026-07-16 23:2x) shows exactly one live match: label
`Coord-1109-1110-g5`, session id `435f7c1a-1c09-493b-b091-af1cf10919f0`, cwd
`coord-2026-06-30-rfa-fleet`, `agent_status: "idle"`, `focused: true`. Prior checkpoint (relay-1)
saw this same pane as `"done"` — it is alive now. **Successor: re-resolve by label + session id
fresh anyway before escalating; do not reuse the session id above without re-checking
`herdr pane list`** (pane numbers reflow; session ids don't, but re-verify aliveness).

Also present in the fleet: a second pane in THIS worktree, label `Build-1109-RuntimeContext`
(session `3dda4630-...`), `agent_status: "idle"` — this is the earlier predecessor that relayed to
me (session `c3c3b78e-...`, label `Build-1109-RuntimeContext-2`). It should already have asked the
coordinator to reap it; not this checkpoint's concern unless it's still around next checkpoint too.

## Done — Task 1 (commit `1c1191a7`) + Task 2 (commit `62f8aaa9`)

Task 1: see relay-1 checkpoint doc for detail (structured screen errors through Tier-1 pipeline).

**Task 2** (this session, commit `62f8aaa9`): TTL-backed actor-keyed `PageContextStore`
(`packages/chat/src/live/page-context-store.ts`) wrapping the existing
`resolveCachedPageContext`/`projectPageContextSnapshot` in `packages/chat/src/live/page-context.ts`
— no reimplemented TTL logic. Authenticated `PUT /api/chat/page-context` route added to
`packages/chat/src/live-routes.ts` (same rate-limit config pattern as sibling mutation routes:
`CHAT_MUTATION_MAX` / `sessionRateLimitKey`), manifest entry in `packages/chat/src/manifest.ts`.
One shared `pageContextStore` instance created in `packages/chat/src/routes.ts` — **Task 4 must
reuse this same local variable** for `chat.getCurrentView`, not construct a second store. New
`UpdatePageContextRequest` DTO in `packages/shared/src/chat-api.ts`. Deleted
`tests/unit/chat-session-manager-page-context.test.ts` (obsolete per-turn-push tests); its two
TTL-expiry cases ported into new `tests/unit/page-context-store.test.ts` (5 tests, actor isolation
+ TTL expiry/retention + malformed-input rejection + delete()). Two new integration tests in
`tests/integration/chat-live-api.test.ts` covering the PUT route + actor isolation + 400 on
malformed body. Fixed the required-field cascade this created across all 6
`registerChatLiveRoutes(...)` call sites (5 in `chat-live-api.test.ts`, 1 in
`route-local-rate-limit.test.ts`).

Verified green this session: `pnpm vitest run tests/unit/page-context-store.test.ts` (5/5),
`pnpm exec tsx scripts/test-integration.ts tests/integration/chat-live-api.test.ts
tests/integration/route-local-rate-limit.test.ts` (24/24 — **note:** this needs
`dist/app-map.json`; if missing, run `pnpm build:app-map` first, then re-run — a fresh worktree
won't have this built yet), full `pnpm vitest run tests/unit` (3473 passed, 2 skipped, **1
pre-existing unrelated failure**: `tests/unit/module-web-browser-safety.test.ts` — module "news"
reaches `fastify`/`node:crypto` via `packages/module-sdk/src/{logger,rate-limit-key,route-errors}.ts`;
confirmed via `git log` that none of those files were touched by Task 1 or 2, so this predates this
build — **do not try to fix it as part of #1109**, just note it if it's still there), `pnpm
format:check` clean, `pnpm lint` clean (0 errors), `pnpm typecheck` clean (root + `@jarv1s/web` +
`external-modules/job-search`).

## Next — Tasks 3-7, in order, plan line ranges

1. **Task 3** (plan lines 418-559): debounced live sync off the chat-turn path. New
   `apps/web/src/chat/use-page-context-sync.ts`; modifies `apps/web/src/api/client.ts` (add a
   client method hitting `PUT /api/chat/page-context`), `apps/web/src/chat/chat-drawer.tsx`,
   `apps/web/src/shell/app-shell.tsx`. Read this plan section fresh — don't assume shape from this
   doc.
2. **Task 4** (lines 560-858): `chat.getCurrentView` risk:"read" tool. New
   `packages/chat/src/live/current-view.ts`, `packages/chat/src/current-view-tool.ts`; new
   `tests/unit/current-view-tool.test.ts`; modifies `packages/chat/src/manifest.ts`,
   `packages/chat/src/routes.ts` (**reuse the existing `pageContextStore` local variable**, don't
   construct a second store instance), `packages/module-registry/src/index.ts`. Must consume
   `dependencies.appMapService.getBuildInfo()` (top-level DI field from #1110, verified present).
3. **Task 5** (lines 859-964): delete the per-turn push + `<page_context>` prompt path. Remove
   `pageContext` from `SendChatTurnRequest`/`/api/chat/turn`; delete `renderPageContextBlock` and
   related in `packages/chat/src/live/page-context.ts`; strip cache/turn params + injection from
   `packages/chat/src/live/chat-session-manager.ts` and `engine-text.ts`.
4. **Task 6** (lines 965-1051): privacy-floor + Tier-1-only boundary tests (actor isolation,
   redaction floor, no raw-DOM/screenshot leakage).
5. **Task 7** (lines 1052-1152): real `tests/uat/specs/runtime-context.uat.spec.ts` Playwright UAT
   (News grounding, idle-turn, no-screenshot acceptance) + full `pnpm verify:foundation` gate.

## Process reminders

- TDD per task: red → green → format/lint → commit, `git add` explicit paths only (never `-A`).
- Relay again on context-meter 70% warning or compaction-summary sighting — don't wait for felt %.
- Never merge/board/close, never touch `docs/coordination/`.
- `node_modules` already present in this worktree — skip `pnpm install`.
