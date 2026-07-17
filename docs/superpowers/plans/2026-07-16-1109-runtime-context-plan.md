# Runtime Current-View Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax.

**Goal:** Replace per-turn page-context injection with an actor-scoped, live, redacted current-view store that Jarvis reads only through a bounded gateway tool when the current screen is relevant.
**Architecture:** The authenticated web shell debounces the existing Tier‑1 DOM projection to a dedicated update route; a TTL-backed in-memory store owns the latest projected view for the one live chat session per actor. `chat.getCurrentView` reads that store under the gateway’s existing `withDataContext`, adds server-authoritative build/platform/model-capability facts, and returns a recursively allow-listed 16K-capped result; the chat turn contract and engine prompt no longer carry `<page_context>`.
**Tech Stack:** TypeScript 6, Fastify 5, React 19, React Router, Vitest 4, Playwright, pnpm, existing Jarv1s live-chat runtime and assistant gateway

## Global Constraints

1. #1000 UAT harness e2e (Playwright driving the REAL dev UI) is a HARD exit criterion for every UI/UX task — specs' §8 UAT criteria are mandatory tasks.
2. Structured error contract is a HARD dependency: `{ code, class: "prerequisite"|"transient"|"validation"|"permission"|"bug", remediationRef? }`. class:"prerequisite" resolves remediationRef in the map to a named fix; every other class → classify honestly, never fabricate a settings fix.
3. Closed-world framing: base system prompt must NOT contain ambient app facts; app knowledge lives ONLY behind the map/snapshot tools. Removing ambient app description is a task.
4. Load-bearing dependency declaration (#1110 F3): `hasJsonModel` (module-registry/src/index.ts:1380) DERIVES from the same `requires:{service,capability,tier}` declaration — advertised == enforced.
5. Two enforcement gates on required `description`: TS-required field AND registration-time non-empty/length assertion at module load (mirrors gateway requiresServices; covers third-party modules).
6. Redaction floor on #1109 Tier-2 (F2): full-DOM tier passes the SAME projection/redaction/cap pipeline as Tier 1 (no raw innerHTML to model); screenshot tier user-gated per-capture, never model-initiated — DROP screenshots from v1 if consent UX isn't in scope. No model self-escalation.
7. Capability-level model exposure only (#953): capabilities not raw model identity, unless model name already user-facing in settings.
8. Map + snapshot tools are `risk:"read"` gateway tools: sliced + renderAndCap 16k cap + sanitizeAssistantToolResult allow-list, run under actor withDataContext; map slice visibility-filtered by isInstanceAdmin (F5 — enforce in tool not prompt).
9. Build agents will be Sonnet 5 (claude-sonnet-5) — write for an implementer weak on the domain: exact paths, complete code per step, exact commands + expected output, TDD, frequent commits, NO placeholders.
10. Shared-tree safety: commit only own files by explicit path; never git add -A/stash/reset on shared checkout; do NOT disturb PROD (jarv1s-prod / :1533 / /home/ben/JarvisProd).

---

## Scope Check

Keep #1109 as one independently testable runtime plan, sequenced after #1110. It consumes #1110’s `JarvisError`, `AppMapReadService.getBuildInfo()`, closed-world persona, and News DOM metadata, but owns the upload/store/tool/removal path end to end and defines `AppBuildInfo` here. Ship Tier 1 only in v1: neither a fuller-DOM tool nor a screenshot endpoint/tool is created. This deliberately deviates from design spec §6 by deferring the DOM tier to an approved follow-up; Tier-1-only is the safer MVP, and any future DOM tier must reuse the projection/redaction pipeline with a 16KB ceiling. Screenshot capture remains out of scope until a separate per-capture consent UX is approved.

## File Structure

- Create `packages/chat/src/live/page-context-store.ts` — actor-keyed TTL storage around the already-tested `resolveCachedPageContext` policy.
- Create `packages/chat/src/live/current-view.ts` — compose the stored view with build/platform/model capabilities.
- Create `packages/chat/src/current-view-tool.ts` — `chat.getCurrentView` handler and recursive output schema.
- Create `apps/web/src/chat/use-page-context-sync.ts` — debounce route/DOM changes to the authenticated update endpoint.
- Create `tests/unit/page-context-store.test.ts` — replacement unit coverage for TTL/reuse previously embedded in `ChatSessionManager`.
- Create `tests/unit/current-view-tool.test.ts` — actor isolation, server facts, schema allow-list, cap, and no-model-identity tests.
- Create `tests/uat/specs/runtime-context.uat.spec.ts` — real UI/API News grounding, idle-turn, and no-screenshot acceptance.
- Modify `packages/shared/src/chat-api.ts` — snapshot error metadata, current-view DTOs, and the update request; remove `SendChatTurnRequest.pageContext`.
- Modify `apps/web/src/chat/page-context.ts` — collect only validated structured error attributes through the existing bounded projection.
- Modify `packages/chat/src/live/page-context.ts` — project error envelopes and delete prompt rendering.
- Modify `packages/chat/src/live-routes.ts` — add authenticated `PUT /api/chat/page-context`; remove page context from `/api/chat/turn`.
- Modify `apps/web/src/api/client.ts`, `apps/web/src/chat/chat-drawer.tsx`, and `apps/web/src/shell/app-shell.tsx` — live-sync snapshots independently and send text-only turns.
- Modify `packages/chat/src/manifest.ts`, `packages/chat/src/routes.ts`, and `packages/module-registry/src/index.ts` — expose and wire the read-only tool service.
- Modify `packages/chat/src/live/chat-session-manager.ts` and `packages/chat/src/live/engine-text.ts` — remove manager cache, turn parameters, and `<page_context>` injection.
- Delete `tests/unit/chat-session-manager-page-context.test.ts` — obsolete push/cache behavior; its still-relevant TTL cases move to `page-context-store.test.ts`.
- Modify `tests/unit/chat-page-context.test.ts`, `tests/unit/page-context.test.ts`, `tests/integration/chat-live.test.ts`, and related chat call sites — pin the pull contract and redaction floor.

### Task 1: Carry structured UI errors through the bounded Tier‑1 projection

**Files:** Modify `packages/shared/src/chat-api.ts:75-125`; Modify `apps/web/src/chat/page-context.ts:1-330`; Modify `packages/chat/src/live/page-context.ts:1-145`; Modify `tests/unit/page-context.test.ts`; Modify `tests/unit/chat-page-context.test.ts`.
**Interfaces:** Consumes #1110’s exported `JarvisError` / Produces `PageContextSnapshotDto.errors: readonly JarvisError[]`, client `collectPageContextErrors(root): readonly JarvisError[]`, and server-side projection limited to 10 validated errors.

- [ ] Step 1: Add failing browser and server projection tests

```ts
// tests/unit/page-context.test.ts — add import and cases
import { projectPageContextErrorAttributes } from "../../apps/web/src/chat/page-context.js";

it("projects declared data-jarvis attributes without visible prose inference", () => {
  expect(
    projectPageContextErrorAttributes({
      code: "news.add_source.no_json_model",
      errorClass: "prerequisite",
      remediationRef: "news.add_source.configure_json_model"
    })
  ).toEqual({
    code: "news.add_source.no_json_model",
    class: "prerequisite",
    remediationRef: "news.add_source.configure_json_model"
  });
  expect(
    projectPageContextErrorAttributes({
      code: "news.add_source.discovery_unavailable",
      errorClass: "transient",
      remediationRef: null
    })
  ).toEqual({
    code: "news.add_source.discovery_unavailable",
    class: "transient"
  });
});

it("drops malformed error classes and prerequisite errors without remediation", () => {
  expect(
    projectPageContextErrorAttributes({
      code: "bad.one",
      errorClass: "other",
      remediationRef: null
    })
  ).toBeNull();
  expect(
    projectPageContextErrorAttributes({
      code: "bad.two",
      errorClass: "prerequisite",
      remediationRef: null
    })
  ).toBeNull();
});
```

```ts
// tests/unit/chat-page-context.test.ts — add to projectPageContextSnapshot describe
it("re-projects structured errors and strips undeclared keys", () => {
  const projected = projectPageContextSnapshot(
    validSnapshot({
      errors: [
        {
          code: "news.add_source.no_json_model",
          class: "prerequisite",
          remediationRef: "news.add_source.configure_json_model",
          secret: "drop"
        },
        {
          code: "news.add_source.discovery_unavailable",
          class: "transient",
          remediationRef: "must-drop"
        }
      ]
    })
  );
  expect(projected?.errors).toEqual([
    {
      code: "news.add_source.no_json_model",
      class: "prerequisite",
      remediationRef: "news.add_source.configure_json_model"
    },
    { code: "news.add_source.discovery_unavailable", class: "transient" }
  ]);
  expect(JSON.stringify(projected)).not.toContain("secret");
});
```

- [ ] Step 2: Run them, verify they FAIL

Run: `pnpm vitest run tests/unit/page-context.test.ts tests/unit/chat-page-context.test.ts`

Expected: exit 1 because `collectPageContextErrors` is not exported and `PageContextSnapshotDto` has no `errors` field.

- [ ] Step 3: Add error collection and repeat the same validation server-side

```ts
// packages/shared/src/chat-api.ts
import type { JarvisError } from "@jarv1s/module-sdk";

export type { JarvisError, JarvisErrorClass } from "@jarv1s/module-sdk";

export interface PageContextSnapshotDto {
  readonly route: string;
  readonly pageTitle: string;
  readonly headings: readonly string[];
  readonly buttons: readonly string[];
  readonly labels: readonly string[];
  readonly visibleText: readonly string[];
  readonly focused: PageContextFocusedElementDto | null;
  readonly selectedText: string | null;
  readonly errors: readonly JarvisError[];
  readonly capturedAt: string;
}
```

```ts
// apps/web/src/chat/page-context.ts
import type { JarvisError, JarvisErrorClass } from "@jarv1s/shared";

const ERROR_CLASSES = new Set<JarvisErrorClass>([
  "prerequisite",
  "transient",
  "validation",
  "permission",
  "bug"
]);
const MAX_CONTEXT_ERRORS = 10;

export function collectPageContextErrors(root: ParentNode): readonly JarvisError[] {
  const errors: JarvisError[] = [];
  const nodes = root.querySelectorAll<HTMLElement>(
    "[data-jarvis-error-code][data-jarvis-error-class]"
  );
  for (const node of nodes) {
    if (errors.length === MAX_CONTEXT_ERRORS) break;
    const projected = projectPageContextErrorAttributes({
      code: node.dataset.jarvisErrorCode ?? null,
      errorClass: node.dataset.jarvisErrorClass ?? null,
      remediationRef: node.dataset.jarvisErrorRemediationRef ?? null
    });
    if (projected) errors.push(projected);
  }
  return errors;
}

export function projectPageContextErrorAttributes(input: {
  readonly code: string | null;
  readonly errorClass: string | null;
  readonly remediationRef: string | null;
}): JarvisError | null {
  const code = input.code?.trim().slice(0, 160);
  const errorClass = input.errorClass as JarvisErrorClass | null;
  const remediationRef = input.remediationRef?.trim().slice(0, 160);
  if (!code || !errorClass || !ERROR_CLASSES.has(errorClass)) return null;
  if (errorClass === "prerequisite") {
    return remediationRef ? { code, class: errorClass, remediationRef } : null;
  }
  return { code, class: errorClass };
}
```

Add an `errors` parameter to `buildPageContextSnapshot`, call `collectPageContextErrors(document.body)` inside `capturePageContextSnapshot`, and include it in every fallback as `errors: []`.

```ts
// packages/chat/src/live/page-context.ts — add beside boundedFocused
const ERROR_CLASSES = new Set(["prerequisite", "transient", "validation", "permission", "bug"]);

function boundedErrors(value: unknown): PageContextSnapshotDto["errors"] {
  if (!Array.isArray(value)) return [];
  const errors: Array<PageContextSnapshotDto["errors"][number]> = [];
  for (const entry of value) {
    if (errors.length === 10) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const source = entry as Record<string, unknown>;
    const code = boundedString(source.code, 160);
    const errorClass = typeof source.class === "string" && ERROR_CLASSES.has(source.class) ? source.class : null;
    if (!code || !errorClass) continue;
    if (errorClass === "prerequisite") {
      const remediationRef = boundedString(source.remediationRef, 160);
      if (!remediationRef) continue;
      errors.push({ code, class: errorClass, remediationRef });
    } else {
      errors.push({ code, class: errorClass });
    }
  }
  return errors;
}

// inside projectPageContextSnapshot's object
errors: boundedErrors(source.errors),
```

Include `errors` in the smallest fallback returned by `capToByteBudget`; never drop structured errors before visible prose because the error code is the grounding key.

- [ ] Step 4: Run projection and type tests, verify PASS

Run: `pnpm vitest run tests/unit/page-context.test.ts tests/unit/chat-page-context.test.ts && pnpm typecheck`

Expected: exit 0; malformed envelopes are absent, non-prerequisite remediation references are stripped, and all snapshot fixture builders now supply `errors: []`.

- [ ] Step 5: Commit

```bash
git add packages/shared/src/chat-api.ts apps/web/src/chat/page-context.ts packages/chat/src/live/page-context.ts tests/unit/page-context.test.ts tests/unit/chat-page-context.test.ts
git commit -m "feat(context): project structured screen errors"
```

### Task 2: TTL-backed current-view store and authenticated update route

**Files:** Create `packages/chat/src/live/page-context-store.ts`; Create `tests/unit/page-context-store.test.ts`; Modify `packages/shared/src/chat-api.ts:110-140`; Modify `packages/chat/src/live-routes.ts:55-135`; Modify `packages/chat/src/manifest.ts:120-175`; Modify `tests/integration/chat-live.test.ts`.
**Interfaces:** Consumes `projectPageContextSnapshot(raw)` and `resolveCachedPageContext(cached,incoming,now,ttlMs)` / Produces `PageContextStore.update(actorUserId,raw,platform): boolean`, `PageContextStore.get(actorUserId): StoredCurrentView | undefined`, `PageContextStore.delete(actorUserId): void`, and authenticated `PUT /api/chat/page-context` returning 204.

- [ ] Step 1: Write failing store and route tests

```ts
// tests/unit/page-context-store.test.ts
import { describe, expect, it } from "vitest";
import { PageContextStore } from "../../packages/chat/src/live/page-context-store.js";

const snapshot = {
  route: "/news",
  pageTitle: "News",
  headings: [],
  buttons: [],
  labels: [],
  visibleText: ["Unavailable"],
  focused: null,
  selectedText: null,
  errors: [],
  capturedAt: "2026-07-16T00:00:00.000Z"
};

it("stores a projected actor view and expires it through the existing TTL policy", () => {
  let now = 1000;
  const store = new PageContextStore({ now: () => now, ttlMs: 300_000 });
  expect(store.update("actor-a", snapshot, "web")).toBe(true);
  expect(store.get("actor-a")).toMatchObject({ snapshot: { route: "/news" }, platform: "web" });
  expect(store.get("actor-b")).toBeUndefined();
  now += 300_001;
  expect(store.get("actor-a")).toBeUndefined();
});

it("rejects malformed input without replacing the last valid view", () => {
  const store = new PageContextStore({ now: () => 1000, ttlMs: 300_000 });
  store.update("actor-a", snapshot, "web");
  expect(store.update("actor-a", { route: "/missing-title" }, "web")).toBe(false);
  expect(store.get("actor-a")?.snapshot.route).toBe("/news");
});
```

```ts
// tests/integration/chat-live.test.ts — add to authenticated live routes
it("updates only the authenticated actor's current view", async () => {
  const response = await app.inject({
    method: "PUT",
    url: "/api/chat/page-context",
    headers: actorHeaders,
    payload: { snapshot }
  });
  expect(response.statusCode).toBe(204);
  expect(pageContextStore.get(actorId)?.snapshot.route).toBe("/news");
  expect(pageContextStore.get(otherActorId)).toBeUndefined();
});

it("rejects an unauthenticated current-view update", async () => {
  const response = await app.inject({
    method: "PUT",
    url: "/api/chat/page-context",
    payload: { snapshot }
  });
  expect(response.statusCode).toBe(401);
});
```

- [ ] Step 2: Run them, verify they FAIL

Run: `pnpm vitest run tests/unit/page-context-store.test.ts && pnpm test:chat`

Expected: exit 1 because `page-context-store.ts` and `/api/chat/page-context` do not exist.

- [ ] Step 3: Implement the store and route without persistence

```ts
// packages/chat/src/live/page-context-store.ts
import type { PageContextSnapshotDto } from "@jarv1s/shared";
import {
  projectPageContextSnapshot,
  resolveCachedPageContext,
  type CachedPageContext
} from "./page-context.js";

export interface StoredCurrentView {
  readonly snapshot: PageContextSnapshotDto;
  readonly platform: "web";
}

export class PageContextStore {
  private readonly views = new Map<string, { cached: CachedPageContext; platform: "web" }>();
  constructor(private readonly options: { readonly now: () => number; readonly ttlMs: number }) {}

  update(actorUserId: string, raw: unknown, platform: "web"): boolean {
    const snapshot = projectPageContextSnapshot(raw);
    if (!snapshot) return false;
    const { nextCached } = resolveCachedPageContext(
      undefined,
      snapshot,
      this.options.now(),
      this.options.ttlMs
    );
    if (!nextCached) return false;
    this.views.set(actorUserId, { cached: nextCached, platform });
    return true;
  }

  get(actorUserId: string): StoredCurrentView | undefined {
    const current = this.views.get(actorUserId);
    const { resolved, nextCached } = resolveCachedPageContext(
      current?.cached,
      undefined,
      this.options.now(),
      this.options.ttlMs
    );
    if (!resolved || !nextCached || !current) {
      this.views.delete(actorUserId);
      return undefined;
    }
    current.cached = nextCached;
    return { snapshot: resolved, platform: current.platform };
  }

  delete(actorUserId: string): void {
    this.views.delete(actorUserId);
  }
}
```

```ts
// packages/shared/src/chat-api.ts
export interface UpdatePageContextRequest {
  readonly snapshot: PageContextSnapshotDto;
}
```

```ts
// packages/chat/src/live-routes.ts — dependency and route
readonly pageContextStore: PageContextStore;

server.put("/api/chat/page-context", async (request, reply) => {
  const access = await resolveOr401(dependencies, request, reply);
  if (!access) return reply;
  const body = request.body as { readonly snapshot?: unknown } | undefined;
  if (!dependencies.pageContextStore.update(access.actorUserId, body?.snapshot, "web")) {
    return reply.code(400).send({ error: "Invalid page context snapshot" });
  }
  return reply.code(204).send();
});
```

Add `{ method:"PUT", path:"/api/chat/page-context", permissionId:"chat.message" }` to the Chat manifest. Instantiate one `PageContextStore({now:Date.now,ttlMs:300_000})` at the start of `registerChatRoutes` and pass the same instance to both `registerChatLiveRoutes` and Task 4’s current-view service. Do not add a database table, worker job, or pg-boss payload.

- [ ] Step 4: Run store and real route tests, verify PASS

Run: `pnpm vitest run tests/unit/page-context-store.test.ts && pnpm test:chat`

Expected: exit 0; the unit suite passes and integration output includes the authenticated 204/unauthenticated 401 cases.

- [ ] Step 5: Commit

```bash
git add packages/chat/src/live/page-context-store.ts packages/shared/src/chat-api.ts packages/chat/src/live-routes.ts packages/chat/src/manifest.ts packages/chat/src/routes.ts tests/unit/page-context-store.test.ts tests/integration/chat-live.test.ts
git commit -m "feat(context): store authenticated live views"
```

### Task 3: Debounced live synchronization independent of chat turns

**Files:** Create `apps/web/src/chat/use-page-context-sync.ts`; Modify `apps/web/src/api/client.ts:820-850`; Modify `apps/web/src/shell/app-shell.tsx:1-155`; Modify `apps/web/src/chat/chat-drawer.tsx:195-220`; Create `tests/unit/page-context-sync.test.ts`; Create `tests/unit/chat-api-client.test.ts`.
**Interfaces:** Consumes `capturePageContextSnapshot()` and `PUT /api/chat/page-context` from Task 2 / Produces `updatePageContext(snapshot): Promise<void>` and `usePageContextSync()` with a 250ms trailing debounce on route, DOM, focus, and selection changes.

- [ ] Step 1: Write failing hook and turn-payload tests

```ts
// tests/unit/page-context-sync.test.ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDebouncedPageContextSync } from "../../apps/web/src/chat/use-page-context-sync.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("debounces repeated changes into one snapshot upload", async () => {
  const upload = vi.fn().mockResolvedValue(undefined);
  const sync = createDebouncedPageContextSync({
    capture: () => ({ route: "/news" }) as never,
    upload,
    delayMs: 250
  });
  sync.schedule();
  sync.schedule();
  await vi.advanceTimersByTimeAsync(249);
  expect(upload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(upload).toHaveBeenCalledTimes(1);
  sync.stop();
});
```

```ts
// tests/unit/chat-api-client.test.ts
import { afterEach, expect, it, vi } from "vitest";
import { sendChatTurn } from "../../apps/web/src/api/client.js";

afterEach(() => vi.unstubAllGlobals());

it("sends chat turns without page context", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ reply: "hello" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  await sendChatTurn("hello");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/chat/turn",
    expect.objectContaining({ body: JSON.stringify({ text: "hello" }) })
  );
});
```

- [ ] Step 2: Run them, verify they FAIL

Run: `pnpm vitest run tests/unit/page-context-sync.test.ts tests/unit/chat-api-client.test.ts`

Expected: exit 1 because `use-page-context-sync.ts` and `updatePageContext` do not exist and `sendChatTurn` still accepts a page-context argument.

- [ ] Step 3: Add the live hook and make turn submission text-only

```ts
// apps/web/src/api/client.ts
export async function updatePageContext(snapshot: PageContextSnapshotDto): Promise<void> {
  await requestJson<void>("/api/chat/page-context", { method: "PUT", body: { snapshot } });
}

export async function sendChatTurn(text: string): Promise<SendChatTurnResponse> {
  return requestJson<SendChatTurnResponse>("/api/chat/turn", { method: "POST", body: { text } });
}
```

```ts
// apps/web/src/chat/use-page-context-sync.ts
import { useEffect } from "react";
import { useLocation } from "react-router";
import { updatePageContext } from "../api/client.js";
import { capturePageContextSnapshot } from "./page-context.js";

const SYNC_DEBOUNCE_MS = 250;

export function createDebouncedPageContextSync(input: {
  readonly capture: typeof capturePageContextSnapshot;
  readonly upload: typeof updatePageContext;
  readonly delayMs: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => void input.upload(input.capture()).catch(() => undefined),
        input.delayMs
      );
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    }
  };
}

export function usePageContextSync(): void {
  const location = useLocation();
  useEffect(() => {
    const sync = createDebouncedPageContextSync({
      capture: capturePageContextSnapshot,
      upload: updatePageContext,
      delayMs: SYNC_DEBOUNCE_MS
    });
    const observer = new MutationObserver(sync.schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("focusin", sync.schedule);
    document.addEventListener("selectionchange", sync.schedule);
    sync.schedule();
    return () => {
      sync.stop();
      observer.disconnect();
      document.removeEventListener("focusin", sync.schedule);
      document.removeEventListener("selectionchange", sync.schedule);
    };
  }, [location.pathname, location.search]);
}
```

Call `usePageContextSync()` once near the top of authenticated `AppShell`. In `chat-drawer.tsx`, replace `sendChatTurn(trimmed, maybeCapturePageContext(trimmed))` with `sendChatTurn(trimmed)` and remove the `maybeCapturePageContext` import. Delete `asksAboutCurrentPage` and `maybeCapturePageContext` from `apps/web/src/chat/page-context.ts` only after Task 5 removes their unit cases.

- [ ] Step 4: Run hook, client, and browser-context tests, verify PASS

Run: `pnpm vitest run tests/unit/page-context-sync.test.ts tests/unit/chat-api-client.test.ts tests/unit/page-context.test.ts`

Expected: exit 0; one debounced upload occurs after 250ms and the turn request contains exactly `{text}`.

- [ ] Step 5: Commit

```bash
git add apps/web/src/chat/use-page-context-sync.ts apps/web/src/api/client.ts apps/web/src/shell/app-shell.tsx apps/web/src/chat/chat-drawer.tsx apps/web/src/chat/page-context.ts tests/unit/page-context-sync.test.ts tests/unit/chat-api-client.test.ts tests/unit/page-context.test.ts
git commit -m "refactor(context): sync current view outside turns"
```

### Task 4: `chat.getCurrentView` read tool with authoritative server facts

**Files:** Create `packages/chat/src/live/current-view.ts`; Create `packages/chat/src/current-view-tool.ts`; Create `tests/unit/current-view-tool.test.ts`; Modify `packages/shared/src/chat-api.ts:115-155`; Modify `packages/chat/src/manifest.ts:1-190`; Modify `packages/chat/src/routes.ts:90-135,661-746`; Modify `packages/module-registry/src/index.ts:1120-1165`; Modify `packages/settings/src/app-map.ts` from #1110 Task 5.
**Interfaces:** Consumes `PageContextStore`, `AiRepository.selectChatModelForUser(scopedDb)`, and #1110 `AppMapReadService.getBuildInfo()` / Produces `AppBuildInfo`, `CurrentViewSnapshotDto`, `CurrentViewReadService.get(scopedDb,actorUserId)`, and `chatGetCurrentViewExecute`.

- [ ] Step 1: Write failing actor-scope, capability, and schema tests

```ts
// tests/unit/current-view-tool.test.ts
import { describe, expect, it, vi } from "vitest";
import { sanitizeAssistantToolResult } from "@jarv1s/ai";
import {
  createCurrentViewReadService,
  chatGetCurrentViewExecute,
  chatGetCurrentViewOutputSchema
} from "@jarv1s/chat";

const snapshot = {
  route: "/news",
  pageTitle: "News",
  headings: ["Add source"],
  buttons: [],
  labels: [],
  visibleText: ["Unavailable"],
  focused: null,
  selectedText: null,
  errors: [
    {
      code: "news.add_source.no_json_model",
      class: "prerequisite" as const,
      remediationRef: "news.add_source.configure_json_model"
    }
  ],
  capturedAt: "2026-07-16T00:00:00.000Z"
};

it("returns only the requesting actor's view and model capabilities", async () => {
  const service = createCurrentViewReadService({
    store: {
      get: vi.fn((actor) => (actor === "u1" ? { snapshot, platform: "web" } : undefined))
    } as never,
    getModelCapabilities: vi.fn().mockResolvedValue(["chat", "tool-use"]),
    getBuildInfo: () => ({ version: "1.2.3", buildId: "abc123" })
  });
  const result = await service.get({} as never, "u1");
  expect(result).toMatchObject({
    available: true,
    view: { route: "/news" },
    serverFacts: { platform: "web", modelCapabilities: ["chat", "tool-use"] }
  });
  expect(JSON.stringify(result)).not.toMatch(/modelId|modelName|provider/i);
  expect((await service.get({} as never, "u2")).available).toBe(false);
});

it("runs through the read service and recursively strips undeclared fields", async () => {
  const get = vi.fn().mockResolvedValue({
    available: true,
    view: snapshot,
    serverFacts: {
      appVersion: "1.2.3",
      buildId: "abc123",
      platform: "web",
      modelCapabilities: ["chat"],
      modelName: "secret"
    }
  });
  const result = await chatGetCurrentViewExecute(
    {} as never,
    {},
    { actorUserId: "u1", requestId: "r1", chatSessionId: "u1" },
    { currentView: { get } }
  );
  const sanitized = sanitizeAssistantToolResult(chatGetCurrentViewOutputSchema, result);
  expect(get).toHaveBeenCalledWith(expect.anything(), "u1");
  expect(JSON.stringify(sanitized)).not.toContain("modelName");
});
```

- [ ] Step 2: Run it, verify it FAILS

Run: `pnpm vitest run tests/unit/current-view-tool.test.ts`

Expected: exit 1 with missing `createCurrentViewReadService` and `chatGetCurrentViewExecute` exports.

- [ ] Step 3: Implement the focused service, DTO, schema, and read tool

```ts
// packages/shared/src/chat-api.ts
export interface AppBuildInfo {
  readonly version: string;
  readonly buildId: string;
}

export interface CurrentViewServerFactsDto {
  readonly appVersion: string;
  readonly buildId: string;
  readonly platform: "web";
  readonly modelCapabilities: readonly AiModelCapability[];
}

export interface CurrentViewSnapshotDto {
  readonly available: boolean;
  readonly view: PageContextSnapshotDto | null;
  readonly serverFacts: CurrentViewServerFactsDto;
}
```

```ts
// packages/chat/src/live/current-view.ts
import type { AiModelCapability, AppBuildInfo, CurrentViewSnapshotDto } from "@jarv1s/shared";
import type { DataContextDb } from "@jarv1s/db";
import type { PageContextStore } from "./page-context-store.js";

export interface CurrentViewReadService {
  get(scopedDb: DataContextDb, actorUserId: string): Promise<CurrentViewSnapshotDto>;
}

export function createCurrentViewReadService(deps: {
  readonly store: Pick<PageContextStore, "get">;
  readonly getModelCapabilities: (scopedDb: DataContextDb) => Promise<readonly AiModelCapability[]>;
  readonly getBuildInfo: () => AppBuildInfo;
}): CurrentViewReadService {
  return {
    async get(scopedDb, actorUserId) {
      const stored = deps.store.get(actorUserId);
      const modelCapabilities = await deps.getModelCapabilities(scopedDb);
      const build = deps.getBuildInfo();
      return {
        available: stored !== undefined,
        view: stored?.snapshot ?? null,
        serverFacts: {
          appVersion: build.version,
          buildId: build.buildId,
          platform: stored?.platform ?? "web",
          modelCapabilities
        }
      };
    }
  };
}
```

```ts
// packages/chat/src/current-view-tool.ts
import type { ToolExecute } from "@jarv1s/module-sdk";
import type { CurrentViewReadService } from "./live/current-view.js";

const stringArray = { type: "array", items: { type: "string" } } as const;
const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "class"],
  properties: {
    code: { type: "string" },
    class: { type: "string" },
    remediationRef: { type: "string" }
  }
} as const;

export const chatGetCurrentViewOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["available", "view", "serverFacts"],
  properties: {
    available: { type: "boolean" },
    view: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "route",
            "pageTitle",
            "headings",
            "buttons",
            "labels",
            "visibleText",
            "focused",
            "selectedText",
            "errors",
            "capturedAt"
          ],
          properties: {
            route: { type: "string" },
            pageTitle: { type: "string" },
            headings: stringArray,
            buttons: stringArray,
            labels: stringArray,
            visibleText: stringArray,
            focused: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["tag", "role", "label"],
                  properties: {
                    tag: { type: "string" },
                    role: { anyOf: [{ type: "string" }, { type: "null" }] },
                    label: { anyOf: [{ type: "string" }, { type: "null" }] }
                  }
                }
              ]
            },
            selectedText: { anyOf: [{ type: "string" }, { type: "null" }] },
            errors: { type: "array", items: errorSchema },
            capturedAt: { type: "string" }
          }
        }
      ]
    },
    serverFacts: {
      type: "object",
      additionalProperties: false,
      required: ["appVersion", "buildId", "platform", "modelCapabilities"],
      properties: {
        appVersion: { type: "string" },
        buildId: { type: "string" },
        platform: { type: "string", enum: ["web"] },
        modelCapabilities: stringArray
      }
    }
  }
} as const;

export const chatGetCurrentViewExecute: ToolExecute = async (scopedDb, _input, ctx, services) => {
  const service = services?.currentView as CurrentViewReadService | undefined;
  if (!service) throw new Error("currentView read service is unavailable");
  return { data: await service.get(scopedDb as never, ctx.actorUserId) };
};
```

Add `getBuildInfo(): AppBuildInfo` to #1110’s `AppMapReadService`, returning the already-loaded artifact stamp. Keep the #1110 canonical DI seam at top-level `ChatRoutesDependencies.appMapService`; do not move it under `collaborators`. In `registerChatRoutes`, build `CurrentViewReadService` from the Task 2 store, the narrowed capability list returned by `AiRepository.selectChatModelForUser(scopedDb)`, and `appMapService.getBuildInfo`. Add it as `readToolServices.currentView`; do not put it in write-capable `toolServices`.

```ts
// packages/chat/src/routes.ts — imports
import { AI_MODEL_CAPABILITIES, type AiModelCapability } from "@jarv1s/shared";

// ChatRoutesDependencies — same top-level seam established by #1110 Task 5
readonly appMapService?: AppMapReadService;

// once near the start of registerChatRoutes
const pageContextStore = new PageContextStore({ now: Date.now, ttlMs: 300_000 });
const currentViewService = dependencies.appMapService
  ? createCurrentViewReadService({
      store: pageContextStore,
      getModelCapabilities: async (scopedDb) => {
        const model = await new AiRepository().selectChatModelForUser(scopedDb);
        return (model?.capabilities ?? []).filter(
          (c): c is AiModelCapability =>
            AI_MODEL_CAPABILITIES.includes(c as AiModelCapability)
        );
      },
      getBuildInfo: () => dependencies.appMapService!.getBuildInfo()
    })
  : undefined;

// buildChatGatewayDependencies collaborators
currentViewService,

// registerChatLiveRoutes dependencies
pageContextStore,
```

```ts
// packages/chat/src/routes.ts — add to the existing readToolServices object
...(args.collaborators.currentViewService
  ? { currentView: args.collaborators.currentViewService }
  : {})
```

Add this exact manifest tool:

```ts
{
  name: "chat.getCurrentView",
  description: "Read the active actor's latest bounded, redacted Jarvis web view and capability-level server facts.",
  permissionId: "chat.view",
  risk: "read",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  outputSchema: chatGetCurrentViewOutputSchema,
  execute: chatGetCurrentViewExecute
}
```

- [ ] Step 4: Run current-view, gateway, and output-cap tests, verify PASS

Run: `pnpm vitest run tests/unit/current-view-tool.test.ts tests/unit/gateway-read-tool.test.ts tests/unit/mcp-gateway-units.test.ts`

Expected: exit 0; actor `u2` sees no `u1` snapshot, model identity fields are absent, `withDataContext` remains exercised by the gateway test, and oversized rendered output ends in `[truncated tool result]` at 16,000 characters.

- [ ] Step 5: Commit

```bash
git add packages/shared/src/chat-api.ts packages/chat/src/live/current-view.ts packages/chat/src/current-view-tool.ts packages/chat/src/manifest.ts packages/chat/src/routes.ts packages/module-registry/src/index.ts packages/settings/src/app-map.ts tests/unit/current-view-tool.test.ts
git commit -m "feat(context): add actor-scoped current-view tool"
```

### Task 5: Delete the per-turn push and `<page_context>` prompt path

**Files:** Modify `packages/shared/src/chat-api.ts:105-140`; Modify `packages/chat/src/live-routes.ts:65-115`; Modify `packages/chat/src/live/chat-session-manager.ts:1-210,400-465,590-615`; Modify `packages/chat/src/live/engine-text.ts:1-135`; Modify `apps/web/src/chat/page-context.ts:1-330`; Delete `tests/unit/chat-session-manager-page-context.test.ts`; Create `tests/unit/chat-engine-text.test.ts`; Modify `tests/unit/chat-page-context.test.ts`; Modify `tests/integration/chat-live.test.ts`.
**Interfaces:** Consumes Task 2 store and Task 4 pull tool / Produces text-only `SendChatTurnRequest`, `ChatSessionManager.submitTurn(actorUserId,userName,text)`, `buildEngineText(deps,actorUserId,text)`, and no `renderPageContextBlock` export.

- [ ] Step 1: Write failing negative-contract tests

```ts
// tests/unit/chat-engine-text.test.ts
import { expect, it } from "vitest";
import { buildEngineText } from "../../packages/chat/src/live/engine-text.js";

it("never injects page context into ordinary engine text", async () => {
  const result = await buildEngineText({ persistence: {} as never }, "u1", "hello");
  expect(result.text).toBe("hello");
  expect(result.text).not.toContain("<page_context>");
});
```

```ts
// tests/integration/chat-live.test.ts — add to /api/chat/turn tests
it("ignores no client-selected page-context channel because the turn contract is text-only", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/chat/turn",
    headers: actorHeaders,
    payload: { text: "hello", pageContext: { route: "/forged", pageTitle: "Forged" } }
  });
  expect(response.statusCode).toBe(200);
  expect(manager.submitTurn).toHaveBeenCalledWith(actorId, expect.any(String), "hello");
});
```

Add a source-contract assertion to `tests/unit/chat-page-context.test.ts` that reads `packages/chat/src/live/engine-text.ts` and expects it not to contain `renderPageContextBlock` or `<page_context>`.

- [ ] Step 2: Run them, verify they FAIL

Run: `pnpm vitest run tests/unit/chat-engine-text.test.ts tests/unit/chat-page-context.test.ts && pnpm test:chat`

Expected: exit 1; `buildEngineText` still requires a fourth argument, the turn route calls `submitTurn` with page context, and engine source imports `renderPageContextBlock`.

- [ ] Step 3: Remove the push path from every layer

```ts
// packages/shared/src/chat-api.ts
export interface SendChatTurnRequest {
  readonly text: string;
}
```

```ts
// packages/chat/src/live-routes.ts — /api/chat/turn body
const { text } = textResult;
const userName = await runtime.resolveUserName(access.actorUserId);
const result = await runtime.manager.submitTurn(access.actorUserId, userName, text);
```

```ts
// packages/chat/src/live/chat-session-manager.ts
async submitTurn(actorUserId: string, userName: string, text: string): Promise<{
  reply: string;
  userMessageId?: string;
  assistantMessageId?: string;
  sourceFreshness?: SourceFreshnessV1 | null;
}> {
  if (this.turnsInFlight.has(actorUserId)) throw new ChatTurnInFlightError();
  this.turnsInFlight.add(actorUserId);
  try {
    return await this.runTurn(actorUserId, userName, text);
  } finally {
    this.turnsInFlight.delete(actorUserId);
  }
}
```

Remove `UserSession.lastPageContext`, `PAGE_CONTEXT_TTL_MS`, `resolvePageContext`, and imports of `PageContextSnapshotDto`, `CachedPageContext`, and `resolveCachedPageContext`. Change private `runTurn` to three arguments and call `buildEngineText(deps, actorUserId, text)`.

```ts
// packages/chat/src/live/engine-text.ts — signature and final composition
export async function buildEngineText(
  deps: EngineTextDeps,
  actorUserId: string,
  text: string
): Promise<{ text: string; pendingItems: AnswerSourceSupport[] }> {
  if (!deps.passiveRetrieval && !deps.crossToolRead) return { text, pendingItems: [] };
  const combined = combineHiddenContextBlocks(passiveResult.block, crossTool.block);
  return { text: combined ? `${combined}\n\n${text}` : text, pendingItems };
}
```

In the catch branch return `{text,pendingItems:[]}`. Delete `withPageContext`, the `PageContextSnapshotDto` and `renderPageContextBlock` imports, and `renderPageContextBlock` itself from `page-context.ts`. Delete `asksAboutCurrentPage`/`maybeCapturePageContext` from the browser file and their heuristic tests. Delete `tests/unit/chat-session-manager-page-context.test.ts`; Task 2’s store test retains its TTL and actor isolation value without coupling it to a turn.

- [ ] Step 4: Run all chat unit/integration tests and verify no prompt injection remains

Run: `pnpm vitest run tests/unit/chat-engine-text.test.ts tests/unit/chat-page-context.test.ts tests/unit/page-context-store.test.ts tests/unit/page-context.test.ts && pnpm test:chat && ! rg -n "<page_context>|renderPageContextBlock|maybeCapturePageContext|lastPageContext" packages/chat/src apps/web/src packages/shared/src`

Expected: exit 0; all tests pass and `rg` returns exit 1 (no matches). The only page-context transport is `PUT /api/chat/page-context`; `/api/chat/turn`, persisted messages, summaries, and job payloads remain text-only.

- [ ] Step 5: Commit

```bash
git add packages/shared/src/chat-api.ts packages/chat/src/live-routes.ts packages/chat/src/live/chat-session-manager.ts packages/chat/src/live/engine-text.ts packages/chat/src/live/page-context.ts apps/web/src/chat/page-context.ts tests/unit/chat-engine-text.test.ts tests/unit/chat-page-context.test.ts tests/unit/page-context.test.ts tests/integration/chat-live.test.ts
git rm tests/unit/chat-session-manager-page-context.test.ts
git commit -m "refactor(context): replace turn push with pull tool"
```

### Task 6: Prove the privacy floor and deliberate Tier‑1-only boundary

**Files:** Modify `tests/unit/page-context.test.ts`; Modify `tests/unit/current-view-tool.test.ts`; Modify `tests/unit/chat-runtime-persona.test.ts`.
**Interfaces:** Consumes the existing `elementPrivacySignals`, 6KB `projectPageContextSnapshot`, 16K `renderAndCap`, and #1110 closed-world persona / Produces executable negative guarantees: no field values, raw HTML, data-content attributes, screenshot schema, screenshot tool, or model-triggered capture.

- [ ] Step 1: Add failing privacy-boundary tests

```ts
// tests/unit/page-context.test.ts — add
it("contains no field-value, raw-HTML, or src reads", () => {
  const path = fileURLToPath(new URL("../../apps/web/src/chat/page-context.ts", import.meta.url));
  const source = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
  expect(source).not.toMatch(/\.value\b/);
  expect(source).not.toMatch(/\.innerHTML\b/);
  expect(source).not.toMatch(/\.src\b/);
});
```

```ts
// tests/unit/current-view-tool.test.ts — add
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

it("ships no screenshot or heavy-DOM request surface", () => {
  const schema = JSON.stringify(chatGetCurrentViewOutputSchema).toLowerCase();
  expect(schema).not.toContain("screenshot");
  expect(schema).not.toContain("innerhtml");
  expect(schema).not.toContain("src");
  expect(schema).not.toContain("value");
});

it("records the approved Tier-1-only deviation at the tool schema", () => {
  const path = fileURLToPath(
    new URL("../../packages/chat/src/current-view-tool.ts", import.meta.url)
  );
  expect(readFileSync(path, "utf8")).toContain("#1109 v1 intentionally ships Tier 1 only");
});
```

```ts
// tests/unit/chat-runtime-persona.test.ts — add
it("asks for pasted text rather than model-initiated capture", () => {
  expect(DEFAULT_JARVIS_PERSONA).toContain("ask the user to paste the exact text");
  expect(DEFAULT_JARVIS_PERSONA).toContain("never request or initiate a screenshot");
});
```

- [ ] Step 2: Run them, verify they FAIL

Run: `pnpm vitest run tests/unit/page-context.test.ts tests/unit/current-view-tool.test.ts tests/unit/chat-runtime-persona.test.ts`

Expected: exit 1 because `packages/chat/src/current-view-tool.ts` does not yet record the approved Tier‑1-only deviation at the schema boundary.

- [ ] Step 3: Record the intentional Tier-1 boundary and keep the runtime surface closed

Keep `CAPTURE_SELECTOR` limited to semantic headings/buttons/labels/text and keep `focusInfo` limited to `tag`, `role`, and accessible `label`; do not add serialization of attributes. Ensure the current-view input schema is exactly an empty object and the output schema contains only Tier‑1 fields from Task 4. If #1110 Task 7’s persona wording differs, use these exact two strings:

```ts
"If the visible snapshot lacks a needed detail, ask the user to paste the exact text; never request or initiate a screenshot.";
```

Add this comment above `chatGetCurrentViewOutputSchema` so the approved spec deviation is visible at the implementation seam, not only in this plan:

```ts
// #1109 v1 intentionally ships Tier 1 only. The DOM tier from design §6 is deferred to an
// approved follow-up and must reuse projection/redaction with a 16KB cap; screenshots require
// separate per-capture consent UX. Do not add model-controlled capture escalation here.
```

No screenshot API, image field, binary storage, full-DOM flag, capture-level input, or second tool is added in this task.

- [ ] Step 4: Run privacy tests and source scans, verify PASS

Run: `pnpm vitest run tests/unit/page-context.test.ts tests/unit/current-view-tool.test.ts tests/unit/chat-runtime-persona.test.ts && ! rg -n "\\.innerHTML\\b|captureLevel|fullDom|screenshot(URL|Data|:)" packages/chat/src/current-view-tool.ts apps/web/src/chat/page-context.ts packages/shared/src/chat-api.ts`

Expected: exit 0; tests pass and the negative source scan finds no screenshot/heavy-capture implementation in the runtime-context path.

- [ ] Step 5: Commit

```bash
git add tests/unit/page-context.test.ts tests/unit/current-view-tool.test.ts tests/unit/chat-runtime-persona.test.ts packages/chat/src/live/runtime.ts apps/web/src/chat/page-context.ts packages/chat/src/current-view-tool.ts
git commit -m "test(context): enforce tier-one privacy boundary"
```

### Task 7: Real #1000 runtime-context UAT and full exit gate

**Files:** Create `tests/uat/specs/runtime-context.uat.spec.ts`; Modify `package.json:40-50`.
**Interfaces:** Consumes the real prod-shaped UAT stack, News structured error, live update route, `chat.getCurrentView`, and `app.getMapSlice` / Produces `pnpm test:uat -- runtime-context` as the hard runtime UI/UX exit criterion.

- [ ] Step 1: Write the failing real-browser tests

```ts
// tests/uat/specs/runtime-context.uat.spec.ts
import { expect, test } from "@playwright/test";
import { UAT_ADMIN_EMAIL, UAT_ADMIN_PASSWORD } from "../seed/admin.js";

async function login(page: import("@playwright/test").Page) {
  await page.goto(process.env.JARVIS_UAT_BASE_URL!);
  await page.getByLabel("Email").fill(UAT_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(UAT_ADMIN_PASSWORD);
  await page.locator("form.auth-form").getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".jds-usermenu__trigger")).toBeVisible();
}

async function ask(page: import("@playwright/test").Page, text: string) {
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  await page.getByRole("textbox", { name: "Message Jarvis" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("News screen error is pulled and resolved against the map", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "News" }).click();
  await page.getByRole("link", { name: "Choose sources" }).click();
  await page.getByLabel("Publication homepage or domain").fill("example.com");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(
    page.locator('[data-jarvis-error-code="news.add_source.no_json_model"]')
  ).toBeVisible();
  await ask(page, "What does this error mean and how do I fix it?");
  await page.getByText("Behind the scenes").click();
  await expect(page.getByText("chat.getCurrentView", { exact: true })).toBeVisible();
  await expect(page.getByText("app.getMapSlice", { exact: true })).toBeVisible();
  await expect(page.getByText(/JSON-capable economy model/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Assistant & AI/i })).toHaveAttribute(
    "href",
    "/settings?section=assistant"
  );
});

test("ordinary chat turn sends no snapshot and performs no current-view pull", async ({ page }) => {
  await login(page);
  let turnBody: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/chat/turn"))
      turnBody = request.postDataJSON();
  });
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const priorCurrentViewSteps = await page.getByText(/chat\.getCurrentView/).count();
  await page.getByRole("textbox", { name: "Message Jarvis" }).fill("Say hello in three words.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/hello/i)).toBeVisible();
  expect(turnBody).toEqual({ text: "Say hello in three words." });
  await expect(page.getByText(/chat\.getCurrentView/)).toHaveCount(priorCurrentViewSteps);
});

test("no model-reachable screenshot path exists", async ({ page }) => {
  await login(page);
  const tools = await page.evaluate(async () => (await fetch("/api/ai/assistant-tools")).json());
  expect(JSON.stringify(tools).toLowerCase()).not.toContain("screenshot");
  await ask(page, "Take a screenshot so you can inspect this page.");
  await expect(page.getByText(/paste the exact text/i)).toBeVisible();
  await expect(page.getByText(/screenshot captured|taking screenshot/i)).toHaveCount(0);
});
```

- [ ] Step 2: Run it, verify it FAILS

Run: `pnpm test:uat -- runtime-context`

Expected: exit 1 before implementation completion: current chat either receives page context in the turn body, does not expose `chat.getCurrentView`, or cannot ground the News error.

- [ ] Step 3: Register the existing real UAT runner and keep browser networking unmocked

```json
// package.json — scripts; this is the same entry added by #1110 and remains idempotent
"test:uat": "tsx tests/uat/run-uat.ts"
```

Use the #1110 UAT chat-capable `admin+data` seed unchanged. Do not add `page.route`, Playwright request interception, a mock web server, or a fake `/api/chat` response.

- [ ] Step 4: Run UAT, focused suites, and the full foundation gate, verify PASS

Run: `pnpm test:uat -- runtime-context && pnpm vitest run tests/unit/page-context.test.ts tests/unit/chat-page-context.test.ts tests/unit/page-context-store.test.ts tests/unit/page-context-sync.test.ts tests/unit/current-view-tool.test.ts tests/unit/chat-engine-text.test.ts && pnpm test:chat && pnpm verify:foundation`

Expected: exit 0; Playwright reports `3 passed`, focused tests pass, chat integration passes, and the complete foundation gate is green. The real turn request is exactly `{text}`, the current-view/map tools appear only for the screen question, and no screenshot tool or action exists.

- [ ] Step 5: Commit

```bash
git add tests/uat/specs/runtime-context.uat.spec.ts package.json
git commit -m "test(context): prove pull-based awareness in real UAT"
```

Stage `package.json` only when it actually changed. Never stage the generated `dist/app-map.json`; it is a build artifact, not source.
