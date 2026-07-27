# Settings write UI refresh (#1310) Implementation Plan

> **For agentic workers:** Driven inline by the coordinated-build agent itself (subagent-driven-development / executing-plans are disabled in this repo). Steps use checkbox syntax for tracking only.

**Goal:** A settings write made through chat (e.g. theme change) invalidates its React Query cache generically, so the UI updates without a manual refresh.

**Architecture:** Tools declare `affectsQueryKeys` (dot-path tokens into the frontend `queryKeys` object) on their manifest entry. The gateway threads that list into the `action_result` live-stream record only when the write executed. The frontend's chat-stream hook parses it, and one generic app-shell effect walks each token into the real TanStack query key and calls `invalidateQueries` — no per-tool hardcoding.

**Tech Stack:** TypeScript, Fastify, TanStack React Query, Vitest, Playwright.

## Global Constraints

- Do not broaden `theme-mode-tool.ts`'s enum (`light`/`dark` only) — owned by epic #1262.
- Do not touch `packages/settings/src/app-map-tool.ts` (#1265).
- No `git add -A`; stage explicit paths only.
- `JARVIS_PGDATABASE` isolated DB for any test/DB op.

---

### Task 1: Manifest + gateway type — declare and thread `affectsQueryKeys`

**Files:**
- Modify: `packages/module-sdk/src/index.ts` (`ModuleAssistantToolManifest`, add `readonly affectsQueryKeys?: readonly string[];` next to `externalContent`)
- Modify: `packages/ai/src/gateway/types.ts` (`GatewaySessionRecord`'s `action_result` variant, add same optional field)
- Modify: `packages/ai/src/gateway/gateway.ts` — at the 3 `result.ok`-gated `action_result` emits (yolo path ~L186, auto-run path ~L222, confirmAndRun path ~L574), spread `...(result.ok && found.tool.affectsQueryKeys ? { affectsQueryKeys: found.tool.affectsQueryKeys } : {})`
- Test: `tests/unit/gateway-action-result-invalidation.test.ts` (new, model on `tests/unit/gateway-action-preview.test.ts`'s `buildGateway` harness) — asserts a tool with `affectsQueryKeys: ["settings.themes"]` and `risk: "write"`/`executionPolicy: "auto"` emits an `action_result` record carrying `affectsQueryKeys: ["settings.themes"]` when it executes.

- [ ] Add the field to both type files.
- [ ] Thread it at the 3 gateway emit sites.
- [ ] Write + pass the gateway unit test.
- [ ] Commit: `git add packages/module-sdk/src/index.ts packages/ai/src/gateway/types.ts packages/ai/src/gateway/gateway.ts tests/unit/gateway-action-result-invalidation.test.ts`

### Task 2: Wire the theme tool + frontend generic invalidation

**Files:**
- Modify: `packages/settings/src/manifest.ts` — add `affectsQueryKeys: ["settings.themes"]` to the `settings.themeMode.set` tool entry (~L461-471).
- Modify: `apps/web/src/chat/use-chat-stream.ts` — add `readonly affectsQueryKeys?: readonly string[];` to `TranscriptRecord`, parse it in `parseRecord` (array of strings, else undefined).
- Modify: `apps/web/src/shell/app-shell.tsx` — add a generic `useEffect` that: tracks the last-processed record count in a ref; for each new record with `kind === "action_result" && record.outcome === "executed" && record.affectsQueryKeys`, resolves each token by walking `queryKeys` (split on `.`, index into the object) and calls `queryClient.invalidateQueries({ queryKey })` when the resolved value is an array.
- Test: `tests/e2e/app-shell.spec.ts` — new test in the existing `test.describe("Chat drawer — Approve/Reject card")` block (same SSE-mock technique as "granted-tier settings tool executes with no Approve/Reject card (#1264)"): feed a real-shaped `action_result` record (`toolName: "settings.themeMode.set"`, `outcome: "executed"`, `affectsQueryKeys: ["settings.themes"]`), mock `**/api/settings/themes` to return a changed theme on refetch, and assert the DOM (`data-theme` attribute or visible label) updates with no `page.reload()`.

- [ ] Add manifest field.
- [ ] Parse in use-chat-stream.ts.
- [ ] Add generic invalidation effect in app-shell.tsx.
- [ ] Write + pass the e2e test.
- [ ] Commit: `git add packages/settings/src/manifest.ts apps/web/src/chat/use-chat-stream.ts apps/web/src/shell/app-shell.tsx tests/e2e/app-shell.spec.ts`

### Task 3: Gate + wrap-up

- [ ] `pnpm verify:foundation` green, real exit code recorded.
- [ ] `coordinated-wrap-up`: push, open/update PR #1276, report to coordinator.
