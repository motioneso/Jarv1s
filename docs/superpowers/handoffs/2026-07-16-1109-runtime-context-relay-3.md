# #1109 runtime-context — relay checkpoint 3

Branch/worktree: `build/1109-runtime-context` @ `/home/ben/Jarv1s/.claude/worktrees/build-1109-runtime-context`.

Plan: `docs/superpowers/plans/2026-07-16-1109-runtime-context-plan.md` (1152 lines, 7 tasks). Read
by SECTION per task, never in full.

## Done — Task 1 (`1c1191a7`), Task 2 (`62f8aaa9`), Task 3 (`2c30dadf`)

Tasks 1-2: see relay-1/relay-2 checkpoint docs. **Task 3** (this session, commit `2c30dadf`):
debounced client sync hook `apps/web/src/chat/use-page-context-sync.ts`
(`createDebouncedPageContextSync` + `usePageContextSync`, 250ms trailing debounce on
route/DOM/focus/selection changes), wired into `AppShell` (top of the function body,
`apps/web/src/shell/app-shell.tsx`). `client.ts`: added `updatePageContext()` (PUT
`/api/chat/page-context`, body `{ snapshot }`), made `sendChatTurn(text)` text-only (dropped the
`pageContext` param — `PageContextSnapshotDto` import stays, still used by `updatePageContext`).
`chat-drawer.tsx`: dropped the `maybeCapturePageContext` import + call, turn now sends `text` only.
Tests: `tests/unit/page-context-sync.test.ts` (debounce), `tests/unit/chat-api-client.test.ts`
(turn body is `{text}` only) — both new, both green. Full command run and verified green:
`pnpm vitest run tests/unit/page-context-sync.test.ts tests/unit/chat-api-client.test.ts
tests/unit/page-context.test.ts` (36/36), `pnpm --filter @jarv1s/web typecheck` clean, prettier +
eslint clean on touched files.

**Not yet deleted** (intentional, per plan Step 3 note): `asksAboutCurrentPage` and
`maybeCapturePageContext` still live in `apps/web/src/chat/page-context.ts` — Task 5 deletes them
once their unit cases are removed too. Don't delete early.

## In progress — Task 4 (plan lines 560-858), UNCOMMITTED

One file has an uncommitted, verified-safe edit: **`packages/shared/src/chat-api.ts`** — added
`AppBuildInfo`, `CurrentViewServerFactsDto`, `CurrentViewSnapshotDto` interfaces right after
`UpdatePageContextRequest` (~line 138). Verified: `pnpm --filter @jarv1s/shared exec tsc --noEmit`
clean. This is deliberately left uncommitted (TDD discipline: no green test consumes it yet) — pick
up from here, don't redo the investigation below.

**Investigation already done this session (verified against actual branch state, trust these, don't
re-derive):**

- `packages/chat/src/live/page-context-store.ts` (`PageContextStore`, Task 2) exists exactly as
  the plan assumes — `update(actorUserId, raw, platform)` / `get(actorUserId)`.
- `packages/chat/src/routes.ts:179` already has `const pageContextStore = new PageContextStore(...)`
  — reuse this local, do not construct a second one (per relay-2's note, re-verified true).
- `packages/settings/src/app-map.ts:22` already has `getBuildInfo(): { version, buildId }` on
  `AppMapReadService` (#1110, ships pre-built) — **no changes needed there**, contrary to the plan's
  file list which lists it as "Modify".
- `packages/module-registry/src/index.ts:1280` already passes `appMapService: deps.appMapService`
  into `registerChatRoutes(...)` — **no changes needed there either**, contrary to the plan's file
  list. `ChatRoutesDependencies.appMapService` (top-level field) already exists at
  `packages/chat/src/routes.ts` (search `readonly appMapService?: AppMapReadService`).
- `AI_MODEL_CAPABILITIES` / `type AiModelCapability` import cleanly from `"@jarv1s/shared"` (via
  `ai-api.ts` → `ai-types.ts` re-export chain) — confirmed by existing usage in
  `packages/ai/src/capability-route-map.ts`.
- `sanitizeAssistantToolResult` imports cleanly from `"@jarv1s/ai"` (barrel → `gateway/index.ts` →
  `gateway/output-validation.ts`) — confirmed.
- `ToolExecute` / `ToolContext` / `ToolServices` types in `packages/module-sdk/src/index.ts` match
  the plan's usage exactly (`ToolContext.chatSessionId` exists).
- `AiRepository.selectChatModelForUser(scopedDb)` exists at `packages/ai/src/repository.ts:1390`,
  returns `AiConfiguredModelSafeRow | null` with a `.capabilities` field — matches plan usage.
- **One real deviation from the plan's illustrative code**: the plan's snippet shows
  `buildChatGatewayDependencies`'s `collaborators` object gaining a `currentViewService` field
  (`args.collaborators.currentViewService`), NOT a top-level field like `appMapService`. Looked at
  the actual `buildChatGatewayDependencies` (`packages/chat/src/routes.ts:692-760`): `appMapService`
  is a top-level arg (separate from `collaborators`), but `readToolServices` is assembled from a mix
  of both top-level (`args.appMapService`) and `collaborators.*` (`featureGrantService`,
  `sourceContextService`). Simplest correct move: add `currentViewService` to the `collaborators`
  type (matching the plan's own `readToolServices` snippet, which explicitly reads
  `args.collaborators.currentViewService`), NOT top-level — this only requires touching the
  `collaborators` object type and the `readToolServices` ternary, not `ChatRoutesDependencies`
  itself.

## Next steps — resume Task 4 exactly here

1. Re-read plan lines 560-858 fresh (don't trust memory of it).
2. Write `tests/unit/current-view-tool.test.ts` per plan Step 1 verbatim (imports
   `sanitizeAssistantToolResult` from `@jarv1s/ai`, `createCurrentViewReadService`,
   `chatGetCurrentViewExecute`, `chatGetCurrentViewOutputSchema` from `@jarv1s/chat`). Run, confirm
   it FAILS (missing exports).
3. Create `packages/chat/src/live/current-view.ts` (`createCurrentViewReadService`) and
   `packages/chat/src/current-view-tool.ts` (`chatGetCurrentViewOutputSchema`,
   `chatGetCurrentViewExecute`) per plan Step 3 verbatim.
4. In `packages/chat/src/routes.ts`:
   - Add `currentView` to `buildChatGatewayDependencies`'s `collaborators` type and destructure it
     into the `readToolServices` ternary (see deviation note above) as `{ currentView: ... }`.
   - Near the existing `const pageContextStore = ...` (line 179), add
     `const currentViewService = dependencies.appMapService ? createCurrentViewReadService({...}) :
     undefined;` using `dependencies.appMapService.getBuildInfo` and
     `new AiRepository().selectChatModelForUser(scopedDb)` filtered through `AI_MODEL_CAPABILITIES`.
   - Pass `currentViewService` into the `buildChatGatewayDependencies({...collaborators: {...,
     currentViewService}})` call at line ~207-225.
5. Export the new symbols from `packages/chat/src/index.ts` (check current barrel — plan's test
   imports them from `@jarv1s/chat`, so they must be re-exported; verify barrel pattern first,
   don't assume).
6. Add the `chat.getCurrentView` manifest tool entry to `packages/chat/src/manifest.ts` exactly as
   plan Step 3 shows (name, description, `permissionId: "chat.view"`, `risk: "read"`).
7. **Skip modifying** `packages/module-registry/src/index.ts` and `packages/settings/src/app-map.ts`
   — both already satisfy the plan's requirements (see investigation notes above). Don't let the
   plan's stale file list send you editing files that don't need it.
8. Run `pnpm vitest run tests/unit/current-view-tool.test.ts tests/unit/gateway-read-tool.test.ts
   tests/unit/mcp-gateway-units.test.ts`, verify PASS (actor isolation, no model-identity leakage,
   16,000-char truncation still works).
9. Commit per plan Step 5's file list (drop `packages/module-registry/src/index.ts` and
   `packages/settings/src/app-map.ts` from the `git add` list since untouched; add
   `packages/chat/src/index.ts` if you touch the barrel).
10. Continue to Tasks 5-7 (plan lines 859-1152) in order — same as prior checkpoints' next-steps.

## Coordinator

Re-resolve fresh via `herdr pane list` before escalating — don't reuse any session id from prior
checkpoint docs (panes/sessions come and go; re-verify every time).

## Process reminders

- TDD per task: red → green → format/lint → commit, `git add` explicit paths only (never `-A`).
- Relay again on context-meter 70% warning or compaction-summary sighting — don't wait for felt %.
- Never merge/board/close, never touch `docs/coordination/`.
- `node_modules` already present in this worktree — skip `pnpm install`.
