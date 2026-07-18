# #1109 runtime-context — relay checkpoint 5

Branch/worktree: `build/1109-runtime-context` @ `/home/ben/Jarv1s/.claude/worktrees/build-1109-runtime-context`.

Plan: `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md` (1152 lines, 7 tasks). Task 5
= lines 859-963. Read by SECTION per task, never in full.

## Done — Tasks 1-4 committed (see relay-1..4 docs). Task 5 IN PROGRESS, uncommitted WIP on disk.

**Task 5 Step 1 (RED tests) is written but UNCOMMITTED** — same worktree, files are on disk, no
`git stash`/`git add` needed, just continue:

- NEW `tests/unit/chat-engine-text.test.ts` — one test, `buildEngineText({persistence:{} as
  never}, "u1", "hello")` (3-arg call) asserts `result.text === "hello"`, no `<page_context>`.
  **Currently passes already** (pageContext arg just becomes `undefined`, JS doesn't enforce arg
  count) — the real RED signal for this file will come from `tsc`, not vitest, once Step 3 makes
  the 4th param non-optional-but-absent a type error. Not a bug, just noted so you don't chase it.
- MODIFIED `tests/unit/chat-page-context.test.ts` — removed `renderPageContextBlock` import + its
  whole `describe("renderPageContextBlock", ...)` block (4 tests, was ~line 135-178); added
  `describe("engine-text source contract (#1109 ...)")` at file end that `readFileSync`s
  `packages/chat/src/live/engine-text.ts` and asserts it does NOT contain `"renderPageContextBlock"`
  or `"<page_context>"`. **Confirmed RED**: this assertion currently fails (source still has both)
  — verified via `pnpm vitest run tests/unit/chat-page-context.test.ts` → 1 failed/15 passed.
- MODIFIED `tests/integration/chat-live-api.test.ts` — added
  `"POST /api/chat/turn ignores an attached pageContext field — the turn contract is text-only
  (#1109)"` right before the existing 401 test (~line 248 pre-edit), inside the first `describe`
  block (real `createApiServer` + `FakeLiveEngine` whose `submit(text)` echoes back exactly what
  the server sent it — that's the assertion surface, there's no mocked `manager.submitTurn` to spy
  on in this describe block, unlike the plan's illustrative snippet). Sends
  `{text:"hello text-only", pageContext:{route:"/forged",pageTitle:"Forged"}}`, asserts 200 and
  `reply === "echo:hello text-only"` (proves no `<page_context>` block leaked into engine text).
  **Not yet confirmed red/green** — this file needs `pnpm test:chat` (or the matching per-suite
  script), not a direct `vitest run`, because `resetFoundationDatabase()` refuses to run against
  the shared `jarv1s` DB outside that harness (see `tests/integration/test-database.ts:53`). Run
  it fresh on resume.
- **`tests/unit/chat-session-manager-page-context.test.ts` does NOT exist on this branch** — the
  plan's Task 5 file list names it for deletion, but grepped and confirmed absent; no test
  currently references `lastPageContext`/`resolvePageContext` at all. **Skip that `git rm`** —
  confirmed stale plan inventory, not a gap to fill.

## Investigation already done (Step 3 target state — re-verify fresh, don't trust line numbers)

- `packages/chat/src/live/chat-session-manager.ts`: delete `UserSession.lastPageContext` (~192),
  `PAGE_CONTEXT_TTL_MS` (~204), private `resolvePageContext` method (~609-621), the
  `PageContextSnapshotDto` import (line 5) and the `resolveCachedPageContext, type
  CachedPageContext` import (line 16) — **confirmed both only used inside what's being deleted**.
  `submitTurn`/`runTurn` go 3-arg (drop `pageContext` param at ~408/~441), `runTurn` drops the
  `resolvePageContext` call (~458) and its 4th arg to `buildEngineText` (~468).
- `packages/chat/src/live/page-context.ts`: delete `renderPageContextBlock` only (~192-236).
  **`resolveCachedPageContext`/`CachedPageContext` MUST STAY** — confirmed still imported/used by
  `packages/chat/src/live/page-context-store.ts` (Task 2's store), which is untouched by Task 5.
- `packages/chat/src/live/engine-text.ts`: `buildEngineText` drops 4th param `pageContext`, deletes
  `withPageContext()` helper (~30-33) and its 3 call sites (~43, 123, 125 — catch branch just
  returns `{text, pendingItems: []}`), deletes the `renderPageContextBlock` import (line 19) and
  the `pageContextBlock` local (line 41).
- `packages/chat/src/live-routes.ts`: delete the `rawPageContext`/`pageContext` extraction block
  (~103-108) and the `projectPageContextSnapshot` import (line 44) — **confirmed dead after this
  deletion**, the only other use of that function is inside `page-context-store.ts`'s own `update`
  method (PUT `/api/chat/page-context` handler at ~328-349 calls `pageContextStore.update(...)`
  directly, doesn't import the projector itself). Turn handler becomes
  `runtime.manager.submitTurn(access.actorUserId, userName, text)` (3-arg).
- `packages/shared/src/chat-api.ts`: `SendChatTurnRequest` (~133-136) drops `pageContext?` field →
  `{ readonly text: string }` only. **Confirmed unused elsewhere** (`grep -rn
  SendChatTurnRequest packages apps` → only the declaration, wire contract only, not imported by
  route/client code — safe to edit without touching callers). The doc comment above
  `PageContextFocusedElementDto` (~104-113) is now stale (describes turn-attach behavior); worth a
  light edit but not load-bearing — use judgement, don't burn a cycle on prose polish if time-tight.
- `apps/web/src/chat/page-context.ts`: delete `asksAboutCurrentPage` (~250-252) and
  `maybeCapturePageContext` (~388-390) — **confirmed dead**, `grep -rn
  "asksAboutCurrentPage|maybeCapturePageContext" apps/web/src` outside this file returns nothing;
  `sendChatTurn` in `apps/web/src/api/client.ts:835` already sends `{text}` only (Task 3 already
  made the client text-only), push now lives in `updatePageContext`/`usePageContextSync` (separate
  file, untouched). Their tests live in `tests/unit/page-context.test.ts` (NOT
  `chat-page-context.test.ts` — different file, browser-side heuristic tests, `describe("asksAboutCurrentPage
  (#679 on-demand-only heuristic)")` ~line 203-224) — delete that describe block + the import.

## Next steps — resume exactly here

1. Re-read plan lines 859-963 fresh (don't trust this doc's line numbers without re-grepping).
2. Run `pnpm test:chat` to confirm the new integration test in `chat-live-api.test.ts` is
   currently RED for the right reason (it may already pass if pageContext truly does nothing today
   — check `packages/chat/src/live/page-context.ts`'s `projectPageContextSnapshot` requires more
   than `route`+`pageTitle` to project non-null; if the minimal payload in the test projects to
   `null`, the test is accidentally green before the refactor — if so keep it but note it isn't a
   red-signal test, or beef up the payload so it round-trips into a real block pre-refactor).
3. Implement Step 3 deletions exactly per the "Investigation already done" section above, file by
   file. Also delete `asksAboutCurrentPage`/`maybeCapturePageContext` describe block from
   `tests/unit/page-context.test.ts` (not `chat-page-context.test.ts`) and their import.
4. Run Step 4's full command incl. the `rg` negative-grep across `packages/chat/src apps/web/src
   packages/shared/src` for `<page_context>|renderPageContextBlock|maybeCapturePageContext|
   lastPageContext` — must exit 1.
5. Commit. File list per plan Step 5, MINUS the `git rm` (file doesn't exist — see above), PLUS
   `tests/unit/page-context.test.ts` (browser heuristic test deletions) which the plan's Task 5
   file header omitted.
6. Continue to Task 6 (privacy-boundary tests, plan lines 965+) then Task 7 (~1050-1152, unread)
   in order.

## Coordinator

Re-resolve fresh via `herdr pane list` before escalating — don't reuse any session id from prior
checkpoint docs.

## Process reminders

- TDD per task: red → green → format/lint → commit, `git add` explicit paths only (never `-A`).
- Relay again on context-meter 70% warning or compaction-summary sighting — don't wait for felt %.
- Never merge/board/close, never touch `docs/coordination/`.
- `node_modules` already present in this worktree — skip `pnpm install`.
