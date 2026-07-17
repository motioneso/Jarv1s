# #1109 runtime-context — relay checkpoint 4

Branch/worktree: `build/1109-runtime-context` @ `/home/ben/Jarv1s/.claude/worktrees/build-1109-runtime-context`.

Plan: `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md` (1152 lines, 7 tasks). Read
by SECTION per task, never in full.

## Done — Tasks 1-4, all committed, tree clean

Task 1 `1c1191a7`, Task 2 `62f8aaa9`, Task 3 `2c30dadf` (see relay-1/2/3 docs for detail). **Task 4**
(this session, commit `e5d57c6e`, msg "feat(context): add actor-scoped current-view tool"): added
`packages/chat/src/live/current-view.ts` (`createCurrentViewReadService`),
`packages/chat/src/current-view-tool.ts` (`chatGetCurrentViewOutputSchema`,
`chatGetCurrentViewExecute`), wired `currentViewService` into `buildChatGatewayDependencies`'s
`collaborators` (NOT top-level — deviates from plan's illustrative snippet, matches its own
`readToolServices` usage), constructed in `registerChatRoutes` next to `pageContextStore` gated on
`dependencies.appMapService`, added `chat.getCurrentView` to `packages/chat/src/manifest.ts`,
exported both new symbols from `packages/chat/src/index.ts`. Test `tests/unit/current-view-tool.test.ts`
green. Full verification run: `pnpm vitest run tests/unit/current-view-tool.test.ts
tests/unit/gateway-read-tool.test.ts tests/unit/mcp-gateway-units.test.ts` → 57/57 pass;
`pnpm --filter @jarv1s/chat exec tsc --noEmit`, `@jarv1s/shared`, `@jarv1s/module-registry` all
clean; prettier + eslint clean on touched files. One deviation from plan Step 3's illustrative code:
`chatGetCurrentViewExecute` must return `{ data: { ...(await service.get(...)) } }` (spread), not
the bare DTO — `ToolResult.data` is `Record<string, unknown>` and `CurrentViewSnapshotDto` has no
index signature, tsc rejects the bare return. Also dropped the plan snippet's unused `describe`
import from the test file (eslint `no-unused-vars`, no `describe()` block was ever added).
Per relay-3: **skipped** `packages/module-registry/src/index.ts` and `packages/settings/src/app-map.ts`
— both already satisfied the plan's requirements pre-existing (#1110), confirmed true, no edit needed.

## In progress — Task 5 (plan lines 859-963), NOT STARTED (investigation only, zero code changes)

Task 5 deletes the per-turn `pageContext` push path and `<page_context>` prompt injection now that
Task 4's pull tool exists. **Read plan lines 859-963 fresh before resuming** — do not trust summary
below for exact code, only for "where things live."

Investigation done this session (verified against actual branch state):

- `packages/chat/src/live/chat-session-manager.ts`: `UserSession.lastPageContext?: CachedPageContext`
  (line ~192, only read/written inside `resolvePageContext`, no other reset sites — safe to delete
  whole-cloth). `PAGE_CONTEXT_TTL_MS` const ~line 204. `submitTurn`/`runTurn` both take a 4th
  `pageContext?: PageContextSnapshotDto` param (~404-408, ~437-441); `runTurn` calls
  `this.resolvePageContext(session, pageContext)` (~458) then passes the resolved value as
  `buildEngineText`'s 4th arg (~459-469). `resolvePageContext` private method ~609-621, wraps
  `resolveCachedPageContext` (imported from `./page-context.js`). **`resolveCachedPageContext` and
  `CachedPageContext` must stay** — Task 2/3's `PageContextStore` (`page-context-store.ts`) also
  depends on them; only delete `renderPageContextBlock`, not the whole file.
- `packages/chat/src/live/engine-text.ts`: `buildEngineText(deps, actorUserId, text, pageContext)`
  takes pageContext as 4th arg, calls `renderPageContextBlock(pageContext)` (~line 41) and a local
  `withPageContext()` helper (~30-33) folds it in at 3 call sites (~43, 123, 125). Plan Step 3 drops
  the 4th param entirely and `withPageContext`/the block folding — new signature is 3-arg
  `(deps, actorUserId, text)`.
- `packages/chat/src/live/page-context.ts`: `renderPageContextBlock` ~line 192-236 (to delete).
  `projectPageContextSnapshot` (~44) and `resolveCachedPageContext`/`CachedPageContext` (~239-260+)
  stay — still used by `PageContextStore` and (until this task lands) by chat-session-manager.
- `packages/chat/src/live-routes.ts`: `/api/chat/turn` handler ~line 93-124 reads
  `request.body.pageContext` via `projectPageContextSnapshot` (~107-108) and passes it as
  `submitTurn`'s 4th arg (~117). Plan Step 3 drops both — text-only call. A second `submitTurn` call
  site at ~317 (evening-interview seed path) already passes only 3 args — leave as-is, don't touch.
- **Not yet located this session** (do first on resume): `apps/web/src/chat/page-context.ts`
  (browser file — `asksAboutCurrentPage`/`maybeCapturePageContext` to delete, per relay-3's note
  these were deliberately left alive through Task 4), and their unit test cases in whichever test
  file covers them (relay-3 didn't name it — grep first). Also un-audited:
  `tests/unit/chat-session-manager-page-context.test.ts` (to `git rm`),
  `tests/integration/chat-live.test.ts` (add the negative-contract turn test).

## Next steps — resume Task 5 exactly here

1. Re-read plan lines 859-963 fresh (Step 1 test snippets, Step 3 exact deletions/signatures —
   don't trust memory of it, don't trust this doc's line numbers without re-grepping first, code
   may have shifted).
2. Grep `apps/web/src/chat/page-context.ts` for `asksAboutCurrentPage`/`maybeCapturePageContext`
   and their test file before writing anything — relay-3 flagged these as intentionally-undeleted
   leftovers from Task 3, this task deletes them.
3. Write the plan's Step 1 failing tests (`tests/unit/chat-engine-text.test.ts` new,
   `tests/integration/chat-live.test.ts` addition, `tests/unit/chat-page-context.test.ts`
   source-contract addition). Run, confirm RED per Step 2's `pnpm vitest run ... && pnpm test:chat`.
4. Implement Step 3 exactly: text-only `SendChatTurnRequest` in `packages/shared/src/chat-api.ts`;
   3-arg `submitTurn`/`runTurn` in `chat-session-manager.ts` (delete `lastPageContext`,
   `PAGE_CONTEXT_TTL_MS`, `resolvePageContext`, the `PageContextSnapshotDto`/`CachedPageContext`/
   `resolveCachedPageContext` imports — verify nothing else in the file needs them first); 3-arg
   `buildEngineText` in `engine-text.ts` (delete `withPageContext`, the page-context imports/call);
   delete `renderPageContextBlock` from `page-context.ts`; text-only turn body in `live-routes.ts`;
   delete the two browser functions + their tests.
5. Run Step 4's full command incl. the `rg` negative-grep for `<page_context>|renderPageContextBlock|
   maybeCapturePageContext|lastPageContext` across `packages/chat/src apps/web/src packages/shared/src`
   — must exit 1 (no matches).
6. Commit per Step 5's exact file list (`git rm tests/unit/chat-session-manager-page-context.test.ts`
   separately).
7. Continue to Task 6 (privacy-boundary tests, plan lines 965+) then Task 7 (plan lines ~1050-1152,
   unread this session) in order.

## Coordinator

Re-resolve fresh via `herdr pane list` before escalating — don't reuse any session id from prior
checkpoint docs. This session found exactly one pane labeled `Coord-1109-1110-g5`
(`w1:pSX`, agent_status was `done`) — re-verify status/label fresh, don't assume it's still there
or still that pane id.

## Process reminders

- TDD per task: red → green → format/lint → commit, `git add` explicit paths only (never `-A`).
- Relay again on context-meter 70% warning or compaction-summary sighting — don't wait for felt %.
- Never merge/board/close, never touch `docs/coordination/`.
- `node_modules` already present in this worktree — skip `pnpm install`.
