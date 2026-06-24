# Handoff — Jarv1s Chat: `/clear` fix, global drawer, retire-legacy backend

**Date:** 2026-06-08
**Author:** prior session (Claude)
**Scope:** live chat `/clear` bugfix → global drawer (Phase A) → retiring the legacy
worker-backed chat model (Phase B, **in progress**).
**Related:** epic #22, spec `docs/superpowers/specs/2026-06-08-retire-legacy-chat-model.md`,
spec `docs/superpowers/specs/2026-06-08-jarvis-chat-design.md`.

---

## TL;DR / where things stand

- **Merged to `main`:** the live-chat `/clear` fix (PR #23) and the global non-modal chat
  drawer + retire-legacy spec (PR #25, was the auto-closed #24). Plus two pre-existing-debt
  fixes folded into #23 (prettier drift; `foundation.test.ts` migration manifest).
- **In progress on branch `feat/jarvis-chat-retire-legacy-backend`** (WIP commit `eb906b3`):
  Phase B legacy-backend removal. The **chat-package + worker** removal is done and `src`
  typechecks (the running app is fine); **AI-adapter slim, shared-schema removal, and test
  surgery remain** (34 test-only typecheck errors).
- **`main` is clean and green on `verify:foundation` locally.** CI's "Verify foundation and app"
  job still goes red on a separate pre-existing e2e/infra step — see "CI debt" below.

## What shipped to `main`

| PR  | Commit    | What                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #23 | `4aeb88e` | **`/clear` fix:** the live engine is dropped on New chat and relaunched (CLI `/clear` rotates the `--session-id`-pinned transcript, which the engine can't follow — it was replaying the previous reply then timing out). **+** prettier-drift fix on 8 files. **+** `foundation.test.ts` updated for migrations 0036–0038 (added by #20/#21 without updating the test). |
| #25 | `a02a95a` | **Global non-modal chat drawer (Phase A):** `ChatDrawer` mounted once in `app-shell.tsx`; `useChatStream` lifted to the shell so the transcript persists across navigation; "Chat" nav item is a toggle button; `/chat` route + `ChatPage` removed; full-screen scrim removed (non-modal, support-widget style). **+** the retire-legacy spec doc.                       |

Design decisions locked in those PRs: chat is a **global, per-user, non-modal toggle drawer**
that follows the user across pages (docked panel = future); **in-session** transcript persistence
(reload-persistence deferred, additive later); **keep `HttpApiAdapter`** as substrate for a future
API-key-in-drawer tie-in.

## Phase B — status

Branch: `feat/jarvis-chat-retire-legacy-backend`, WIP commit `eb906b3` (push it — see "Actions").

### Done (runtime compiles; app unaffected)

- Deleted `packages/chat/src/jobs.ts` (chat-execution worker) and removed its queue +
  `registerWorkers` wiring in `packages/module-registry/src/index.ts`; dropped `export * from
"./jobs.js"` in `packages/chat/src/index.ts`.
- `packages/chat/src/routes.ts`: slimmed to the live runtime (`registerChatLiveRoutes`) + read-only
  `GET /api/chat/threads` (drawer History). Removed thread/message CRUD routes, the pg-boss
  enqueue, and the now-unused `boss`/`listModuleManifests` deps (safe by contravariance — the
  framework passes the superset `BuiltInRouteDependencies`).
- `packages/chat/src/repository.ts`: trimmed to live-path methods (`listThreads`, `getThreadById`,
  `listMessages`, `insertMessage`, `getCurrentThread`, `openNewThread`, `recordCompletedTurn`,
  `touchThread`). Removed `createThread`, `appendUserMessage`, `updateMessageStatus`,
  `appendActivity`, `updateMessageComplete`, the enqueue/`ChatExecutionJobPayload`, and the
  capability-router plumbing (only the removed `resolveChatRoute` used it; the live path resolves
  providers in `live/persistence.ts`).
- `packages/chat/src/manifest.ts`: removed `CHAT_EXECUTION_QUEUE` + the 4 legacy route entries
  (kept `GET /threads`, the nav entry, permissions, tables).

### ⚠️ Spec corrections found while reading the code (the spec §5 inventory was wrong on these)

1. **`getThreadById` is NOT legacy-only** — the live `recordCompletedTurn` calls it. **Kept.**
2. **`tmux-bridge.ts` is shared IO infra** — the live runtime imports `createRealTmuxIo` + the
   `TmuxIo` type from it (`packages/chat/src/live/runtime.ts`, `cli-chat-engine` test). Only the
   `TmuxBridgeAdapter` _class_ is legacy. **Do NOT delete the file — slim it.**
3. **`createChatAdapter`** (the factory) is now referenced **only by tests** after `jobs.ts` went.
   Removing it means removing its unit test + the `chat.test.ts` injection.

### Remaining work (well-defined, mostly test surgery)

1. **AI adapters (`packages/ai/src`):**
   - `adapters/tmux-bridge.ts`: remove the `TmuxBridgeAdapter` class (and any helpers only it uses).
     **Keep** `TmuxIo`, `createRealTmuxIo`, and the transcript-glob helper the live engine imports.
   - `chat-adapter.ts`: remove `createChatAdapter` + the `TmuxBridgeAdapter` import/`cli` branch +
     `realTmuxIo`. **Keep** the `ChatProviderAdapter`/`ChatTurn`/`ChatActivityEvent`/
     `GenerateChatInput` types and the `HttpApiAdapter` re-export (substrate for the future
     API-key-in-drawer tie-in — note this in a comment so it isn't mistaken for dead code).
   - `index.ts`: keep `export * from "./adapters/tmux-bridge.js"` (still exports `TmuxIo`/
     `createRealTmuxIo`); verify nothing re-exports the removed symbols.
2. **Shared (`packages/shared/src/chat-api.ts`):** remove `createChatThread*`, `getChatThread*`,
   `listChatMessages*`, `appendChatUserMessage*` schemas + request/response/DTO types. **Keep**
   `listChatThreadsResponseSchema` + `ChatThreadDto`. Check `ChatMessageDto`/`ChatActivityEventDto`/
   `ChatModelRouteMetadataDto`/`ChatSelectedToolMetadataDto` usage before removing (were used by the
   removed `serializeMessage` + repository — likely removable, but grep first).
3. **Tests (the bulk):**
   - `tests/integration/chat.test.ts` — legacy worker/CRUD/RLS test. Mostly obsolete (live path is
     covered by `chat-live-api.test.ts`). Decide: delete, or salvage any chat-specific RLS coverage
     worth keeping (the RLS policies are unchanged). References `CHAT_EXECUTION_QUEUE`,
     `registerChatJobWorkers`, `invokeChatWorkerHandler`, `createThread`, `appendUserMessage`,
     `createChatAdapter`.
   - `tests/integration/chat-live.test.ts` — has legacy bits at lines ~120–159 (`appendUserMessage`,
     `updateMessageComplete`). Remove those cases; keep genuine live coverage.
   - `tests/unit/ai-tmux-bridge.test.ts` — remove the `TmuxBridgeAdapter` describe blocks; **keep**
     the transcript-reader tests (rename file to `ai-transcript-reader.test.ts` if it ends up
     transcript-only).
   - `tests/unit/ai-chat-adapter-factory.test.ts` — delete (the factory is gone).
   - `ai-tools` tests, if any assert the legacy chat job — adjust.
4. **Verify:** `pnpm verify:foundation` green (stop the dev worker first — see gotchas). Then open
   the Phase B PR → `main`.

There are **34 test-only typecheck errors** right now; `pnpm typecheck 2>&1 | grep "error TS"`
enumerates them and is the to-do list for step 3.

## Environment state (as left)

- Dev servers running on `:3000` (API) and `:5173` (web) via `tsx watch` / vite, plus `dev:worker`
  (restarted). They auto-reload the working tree. **Working tree is on
  `feat/jarvis-chat-retire-legacy-backend`** (compiles).
- Postgres up (`jarv1s-postgres`, db `jarv1s`). The dev DB was reset by integration-test runs —
  the pilot/test users are gone; the operator's account is the only real user (from manual testing).
- Logs: `~/webwright/jarvis-chat-phase1/logs/{api,web,worker}.log`. Manual UI-test
  screenshots + scripts under `~/webwright/jarvis-chat-phase1/`.

## CI debt (tracked, deferred — task #8, NOT this work's fault)

`main`'s CI has been fully red since before this work. `verify:foundation` is now green; the
remaining red in the "Verify foundation and app" job + `compose-smoke`:

1. **No `playwright install` in CI** — `.github/workflows/ci.yml` runs `pnpm test:e2e` without
   installing browsers → all e2e error with "Executable doesn't exist." Add
   `pnpm exec playwright install --with-deps chromium` before the e2e step.
2. **Stale e2e tests** — `app-shell.spec.ts` asserts `getByLabel("Workspace")` (selector removed in
   Slice 1f) and has a briefing tool-metadata test that fails. Remove/update.
3. **`compose-smoke`** — `onnxruntime-node` can't load `libonnxruntime.so.1` (`ERR_DLOPEN_FAILED`)
   in the CI container. Docker base-image / shared-libs fix.

## Gotchas (learned this session — save future-you the time)

- **CLI `/clear` rotates the transcript file.** The live engine pins its transcript path at launch
  (`--session-id`), so the drawer's "New chat" must drop+relaunch the engine, not send `/clear`.
  (Fixed in #23.)
- **Integration tests reset the shared dev DB.** Coordinate before running `test:integration` while
  someone is using the live app — it wipes users (this is why the operator account had to be recreated).
- **A running `dev:worker` steals pg-boss jobs** from integration tests → the "metadata-only job"
  foundation test times out. Stop the worker before `verify:foundation`.
- **Merging stacked PRs that use squash:** deleting the base branch _closes_ (not retargets) the
  child PR. Merge bottom PR, rebase the child onto `main` (`git rebase --onto origin/main <old-base>`),
  force-push, then open/merge the child fresh.

## Recommended next steps (in order)

1. **Finish Phase B** (steps 1–4 above) — it's ~half done and well-scoped; the test surgery is the
   bulk. Open the PR to `main` when `verify:foundation` is green.
2. **CI cleanup** (task #8) — small, high-leverage: add `playwright install` + remove the stale
   Workspace/briefing e2e tests so the foundation CI job goes green; file the onnxruntime fix
   separately.
3. Optionally fold the three spec corrections into
   `docs/superpowers/specs/2026-06-08-retire-legacy-chat-model.md` §5.
4. Then the epic-#22 roadmap continues: **Phase 2 (agentic MCP tools)** and **Phase 3 (recall)**.

## Key commands

```
pnpm db:up && pnpm db:migrate
pnpm dev:api ; pnpm --filter @jarv1s/web dev -- --host ; pnpm dev:worker
pnpm typecheck
pnpm verify:foundation            # stop dev:worker first
pnpm test:chat                    # chat module suite
npx playwright test tests/e2e/chat-drawer.spec.ts
git checkout feat/jarvis-chat-retire-legacy-backend   # resume Phase B
```
