# Private Chat & History Trust Hardening (#984, Slices 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make private-chat activation server-confirmed and race-free, make explicit
thread-resume carry a bounded replay window even with `JARVIS_CHAT_REPLAY_K=0`, and make
History an exclusive, single-action (select = open + continue) surface.

**Architecture:** Reuse every existing mechanism — `clearChat({incognito:true})`'s
already-synchronous server confirmation, the existing `forceReplay`/`getSwitchReplayK` path
`switchProvider` already uses, and the existing `getCurrentThreadState` persistence port method
— rather than building new persistence, cleanup, or replay systems. Frontend changes are
confined to `chat-drawer.tsx` (owned) plus the private/history regions of `kit-chat.css`
(owned). Backend changes are confined to `chat-session-manager.ts`, `persistence.ts` (already
has the needed method), `live-routes.ts`, `manifest.ts`, and `packages/shared/src/chat-api.ts`.

**Tech Stack:** Fastify + Kysely (DataContextDb), React + TanStack Query, Vitest (unit +
integration via `app.inject`), Playwright (e2e via `tests/e2e/mock-chat-api.ts`).

## Global Constraints

- Slice 4 and final cross-engine acceptance are OUT OF SCOPE (#868-blocked) — do not touch or claim.
- Reuse the existing private-chat and forced-replay mechanisms; no second persistence, cleanup,
  or replay system (spec Decision 5).
- `AccessContext` stays `{ actorUserId, requestId }` only.
- Any new HTTP route needs a `manifest.ts` entry with a `permissionId`.
- Any new JSON response field needs its shared schema updated (`additionalProperties: false`
  silently strips undeclared fields).
- Stage only each task's explicit files; never `git add -A`.
- Do not edit: `packages/ai/src/gateway/gateway.ts`, `packages/chat/src/mcp-transport.ts`,
  `tests/integration/chat-mcp-transport.test.ts`, `apps/web/src/chat/action-request-card.tsx`,
  or `apps/web/src/chat/composer.tsx` (shared call sites outside chat-drawer.tsx).

---

### Task 1: Fix the private-activation race (Slice 1)

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx:90` (state), `:202` (sendMessage guard),
  `:330-344` (`startPrivateChat`), `:444` (render — add activating/error banners)
- Test: `tests/e2e/chat-drawer.spec.ts` (new test), `tests/e2e/mock-chat-api.ts` (controllable
  `/api/chat/clear` delay)

**Interfaces:**

- Consumes: `clearChat(options?: {incognito?: boolean}): Promise<void>` (existing,
  `apps/web/src/api/client.ts:851`) — already awaits full server-side incognito-thread creation.
- Produces: `activatingPrivate: boolean` and `privateActivationError: string | null` local state,
  read by Task 5 (exclusivity) — no other task depends on these yet.

- [ ] **Step 1: Add a controllable delay hook to the mock `/api/chat/clear` route**

In `tests/e2e/mock-chat-api.ts`, find the existing clear-route registration (grep
`api/chat/clear`) and add an optional gate the test can hold open:

```ts
export interface MockChatApiState {
  // ...existing fields...
  clearGate?: { release: () => void; promise: Promise<void> };
}
```

Before calling `route.fulfill` in the clear handler, await `state.clearGate?.promise` if set:

```ts
if (state.clearGate) {
  await state.clearGate.promise;
}
```

- [ ] **Step 2: Write the failing e2e test**

Add to `tests/e2e/chat-drawer.spec.ts`:

```ts
test("private activation blocks send until the server confirms, then allows it", async ({
  page
}) => {
  let releaseClear: (() => void) | undefined;
  const clearGate = {
    promise: new Promise<void>((resolve) => {
      releaseClear = resolve;
    }),
    release: () => releaseClear?.()
  };

  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    clearGate
  });

  let turnCalled = false;
  await page.route("**/api/chat/turn", async (route) => {
    turnCalled = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByRole("button", { name: "Start private chat" }).click();

  // While the server confirmation is held open, the private banner must not show yet,
  // and attempting to send must not reach POST /api/chat/turn.
  await expect(page.locator(".chatd-private").filter({ hasText: "not saved" })).toHaveCount(0);
  await page.getByPlaceholder(/message/i).fill("secret during race");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  expect(turnCalled).toBe(false);

  clearGate.release();

  await expect(page.locator(".chatd-private").filter({ hasText: "not saved" })).toBeVisible();
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @jarv1s/web exec playwright test chat-drawer -g "private activation blocks send"`
Expected: FAIL — private banner appears immediately today (no gating), so the pre-release
assertion (`toHaveCount(0)`) fails.

- [ ] **Step 4: Add `activatingPrivate` / `privateActivationError` state**

In `apps/web/src/chat/chat-drawer.tsx`, right after line 91 (`const [privateEnded, ...]`):

```tsx
const [activatingPrivate, setActivatingPrivate] = useState(false);
const [privateActivationError, setPrivateActivationError] = useState<string | null>(null);
```

- [ ] **Step 5: Make `startPrivateChat` await server confirmation before flipping truth**

Replace lines 330-344 (`const startPrivateChat = () => { ... };`):

```tsx
const startPrivateChat = () => {
  setReviewThreadId(null);
  setShowHistory(false);
  setIsSending(false);
  setSendError(null);
  setNeedsProvider(false);
  setDrainAfterStopText(null);
  setPendingUserText(null);
  setPrivateEnded(false);
  setPrivateActivationError(null);
  setActivatingPrivate(true);
  void (async () => {
    try {
      await clearChat({ incognito: true });
      setFallbackRecords([]);
      props.clearRecords();
      setPrivateMode(true);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
    } catch (caught) {
      setPrivateActivationError(
        caught instanceof Error ? caught.message : "Could not start a private chat"
      );
    } finally {
      setActivatingPrivate(false);
    }
  })();
};
```

Note: `setPrivateMode(true)` and `setFallbackRecords([])`/`props.clearRecords()` now happen
ONLY after the server confirms — a rejected `clearChat` leaves the prior ordinary thread and
its records fully intact (the "failure restores prior state" requirement).

- [ ] **Step 6: Gate `sendMessage` on `activatingPrivate`**

In `sendMessage` (line 202), change:

```tsx
if (!trimmed || isSending || privateEnded) return;
```

to:

```tsx
if (!trimmed || isSending || privateEnded || activatingPrivate) return;
```

Add `activatingPrivate` to the `useCallback` dependency array (line 238).

- [ ] **Step 7: Render an activating/error banner**

Right before the existing `{privateMode && !reviewing ? (...) : null}` block (line 444), add:

```tsx
{
  activatingPrivate ? (
    <div className="chatd-private is-activating">
      <span>Starting private chat…</span>
    </div>
  ) : null;
}
{
  privateActivationError ? (
    <div className="chatd-private is-error">
      <span>{privateActivationError}</span>
      <button type="button" onClick={() => setPrivateActivationError(null)}>
        Dismiss
      </button>
    </div>
  ) : null;
}
```

- [ ] **Step 8: Run the e2e test to confirm it passes**

Run: `pnpm --filter @jarv1s/web exec playwright test chat-drawer -g "private activation blocks send"`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx tests/e2e/chat-drawer.spec.ts tests/e2e/mock-chat-api.ts
git commit -m "fix(chat): block send until private activation is server-confirmed"
```

---

### Task 2: Server-confirmed privacy-state restore endpoint (Slice 1)

**Files:**

- Modify: `packages/shared/src/chat-api.ts` (new DTO + schema)
- Modify: `packages/chat/src/live/chat-session-manager.ts` (new public method)
- Modify: `packages/chat/src/live-routes.ts` (new GET handler)
- Modify: `packages/chat/src/manifest.ts:95` (register route)
- Modify: `apps/web/src/api/client.ts` (new client fn)
- Modify: `apps/web/src/api/query-keys.ts:74-81` (new query key)
- Modify: `apps/web/src/chat/chat-drawer.tsx` (mount-time truth sync)
- Test: `tests/integration/chat-live-api.test.ts` (new case)

**Interfaces:**

- Consumes: `ChatPersistencePort.getCurrentThreadState(actorUserId): Promise<{id, incognito} | undefined>`
  (already exists, `packages/chat/src/live/persistence.ts:285-292`).
- Produces: `GET /api/chat/privacy` → `{ incognito: boolean }`; `getChatPrivacyState(): Promise<{incognito: boolean}>` in `client.ts`.

- [ ] **Step 1: Add the shared DTO + schema**

In `packages/shared/src/chat-api.ts`, near `ListChatThreadsResponse`:

```ts
export interface GetChatPrivacyStateResponse {
  readonly incognito: boolean;
}
```

Near `listChatThreadsResponseSchema`:

```ts
export const getChatPrivacyStateResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["incognito"],
  properties: {
    incognito: { type: "boolean" }
  }
} as const;

export const getChatPrivacyStateRouteSchema = {
  response: {
    200: getChatPrivacyStateResponseSchema,
    401: errorResponseSchema
  }
} as const;
```

- [ ] **Step 2: Add `ChatSessionManager.getPrivacyState`**

In `packages/chat/src/live/chat-session-manager.ts`, right after `endPrivateSession` (line 665):

```ts
async getPrivacyState(actorUserId: string): Promise<{ readonly incognito: boolean }> {
  const currentThread = await this.deps.persistence.getCurrentThreadState?.(actorUserId);
  return { incognito: currentThread?.incognito ?? false };
}
```

- [ ] **Step 3: Write the failing integration test**

In `tests/integration/chat-live-api.test.ts`, add near the `/api/chat/private/end` test (after
line 425):

```ts
it("GET /api/chat/privacy returns the authenticated actor's current thread privacy state", async () => {
  const getPrivacyState = vi.fn().mockResolvedValue({ incognito: true });
  const app = Fastify({ logger: false });
  registerChatLiveRoutes(app, {
    resolveAccessContext: async () => userAContext(),
    runtime: {
      resolveUserName: async () => "User A",
      manager: { getPrivacyState }
    } as never
  });
  await app.ready();

  try {
    const response = await app.inject({ method: "GET", url: "/api/chat/privacy" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ incognito: true });
    expect(getPrivacyState).toHaveBeenCalledWith(ids.userA);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `pnpm --filter @jarv1s/api exec vitest run tests/integration/chat-live-api.test.ts -t "GET /api/chat/privacy"`
Expected: FAIL — route does not exist yet (404).

- [ ] **Step 5: Add the route handler**

In `packages/chat/src/live-routes.ts`, following the existing pattern used by the
`/api/chat/private/end` handler (same file — resolve access context, call the manager, reply),
add:

```ts
app.get("/api/chat/privacy", { schema: getChatPrivacyStateRouteSchema }, async (request, reply) => {
  const access = await deps.resolveAccessContext(request, reply);
  if (!access) return;
  const state = await deps.runtime.manager.getPrivacyState(access.actorUserId);
  return reply.send(state satisfies GetChatPrivacyStateResponse);
});
```

Import `getChatPrivacyStateRouteSchema` and `GetChatPrivacyStateResponse` from `@jarv1s/shared`
at the top of the file. Match the exact `resolveAccessContext`/`reply.send` idiom used by the
neighboring handlers in this file — read the surrounding 20 lines before writing this to match
whatever guard/error pattern they use verbatim.

- [ ] **Step 6: Register the route in the manifest**

In `packages/chat/src/manifest.ts`, add to the `routes` array (after the
`/api/chat/private/end` entry, line 113):

```ts
{
  method: "GET",
  path: "/api/chat/privacy",
  responseSchema: getChatPrivacyStateResponseSchema,
  permissionId: "chat.view"
},
```

Import `getChatPrivacyStateResponseSchema` from `@jarv1s/shared` at the top.

- [ ] **Step 7: Run the integration test to confirm it passes**

Run: `pnpm --filter @jarv1s/api exec vitest run tests/integration/chat-live-api.test.ts -t "GET /api/chat/privacy"`
Expected: PASS

- [ ] **Step 8: Add the frontend client function + query key**

In `apps/web/src/api/query-keys.ts`, add to the `chat` block (after `threads`, line 76):

```ts
privacy: ["chat", "privacy"] as const,
```

In `apps/web/src/api/client.ts`, near `clearChat` (line 851):

```ts
export async function getChatPrivacyState(): Promise<GetChatPrivacyStateResponse> {
  return fetchJson("/api/chat/privacy");
}
```

Import `GetChatPrivacyStateResponse` from `@jarv1s/shared` at the top of `client.ts` (match the
existing import style used for `ListChatThreadsResponse` etc.). Use whatever internal fetch
helper (`fetchJson` or equivalent) the neighboring `listChatThreads`/`clearChat` functions use —
read them first to match exactly.

- [ ] **Step 9: Sync `privateMode` from server truth on mount**

In `apps/web/src/chat/chat-drawer.tsx`, near the other `useQuery` calls (after `threadsQuery`,
line 187):

```tsx
const privacyStateQuery = useQuery({
  queryKey: queryKeys.chat.privacy,
  queryFn: () => getChatPrivacyState(),
  enabled: props.open
});

useEffect(() => {
  if (!privacyStateQuery.isSuccess) return;
  setPrivateMode(privacyStateQuery.data.incognito);
}, [privacyStateQuery.isSuccess, privacyStateQuery.data]);
```

Place this `useEffect` near the top of the component (after the `privateMode` state
declaration) so it runs before any other effect reads `privateMode`. Import `getChatPrivacyState`
from `../api/client.js`.

- [ ] **Step 10: Add e2e coverage for remount restore**

In `tests/e2e/mock-chat-api.ts`, add a `GET /api/chat/privacy` route returning
`{ incognito: state.incognito ?? false }` (add `incognito?: boolean` to `MockChatApiState`).

In `tests/e2e/chat-drawer.spec.ts`, add:

```ts
test("reloading the page restores private-mode indication from server truth", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    incognito: true
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open chat" }).click();

  await expect(page.getByRole("button", { name: "Start private chat" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
```

- [ ] **Step 11: Run the e2e tests to confirm they pass**

Run: `pnpm --filter @jarv1s/web exec playwright test chat-drawer -g "restores private-mode"`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add packages/shared/src/chat-api.ts packages/chat/src/live/chat-session-manager.ts \
  packages/chat/src/live-routes.ts packages/chat/src/manifest.ts apps/web/src/api/client.ts \
  apps/web/src/api/query-keys.ts apps/web/src/chat/chat-drawer.tsx \
  tests/integration/chat-live-api.test.ts tests/e2e/chat-drawer.spec.ts tests/e2e/mock-chat-api.ts
git commit -m "feat(chat): add server-confirmed privacy-state restore endpoint"
```

---

### Task 3: Force bounded replay on explicit resume (Slice 2)

**Files:**

- Modify: `packages/chat/src/live/chat-session-manager.ts:227` (field), `:446` (`runTurn`),
  `:673-695` (`resumeThread`)
- Test: `tests/unit/chat-session-manager-resume.test.ts`

**Interfaces:**

- Consumes: `ensureSession(actorUserId, userName, opts?: {forceReplay?: boolean})` (existing).
- Produces: no new public API — `resumeThread` now guarantees the NEXT `runTurn`'s relaunch
  passes `forceReplay: true`, exactly like `switchProvider` already does.

- [ ] **Step 1: Write the failing unit test**

In `tests/unit/chat-session-manager-resume.test.ts`, add (reuses `makeResumeDeps`/`FakeEngine`):

```ts
it("forces a replay on the next turn's relaunch after an explicit resume", async () => {
  const { deps, engine } = makeResumeDeps(true);
  const manager = new ChatSessionManager(deps);

  await manager.ensureSession("u1", "Ben");
  await manager.resumeThread("u1", "thread-abc");

  // Directly re-launch via ensureSession with no opts, mimicking runTurn's call —
  // it must have picked up the pending forced-replay flag from resumeThread.
  deps.persistence.listPriorTurns.mockClear();
  await manager.ensureSession("u1", "Ben");

  expect(deps.persistence.listPriorTurns).toHaveBeenCalledWith("u1", { forceReplay: true });
});

it("does not force replay on an ordinary relaunch with no prior resume", async () => {
  const { deps } = makeResumeDeps(true);
  const manager = new ChatSessionManager(deps);

  deps.persistence.listPriorTurns.mockClear();
  await manager.ensureSession("u1", "Ben");

  expect(deps.persistence.listPriorTurns).toHaveBeenCalledWith("u1", { forceReplay: undefined });
});
```

- [ ] **Step 2: Run it to confirm the first case fails**

Run: `pnpm --filter @jarv1s/chat exec vitest run tests/unit/chat-session-manager-resume.test.ts`
Expected: FAIL on the first new test — `resumeThread` sets no forced-replay signal today, so the
subsequent `ensureSession` call (no opts passed) calls `listPriorTurns` with
`{forceReplay: undefined}`, not `{forceReplay: true}`.

- [ ] **Step 3: Add a pending-forced-replay set + consume it in `ensureSession`**

In `packages/chat/src/live/chat-session-manager.ts`, add a field after `launching` (line 231):

```ts
/**
 * Actors whose NEXT relaunch must force a bounded replay window even if
 * JARVIS_CHAT_REPLAY_K is 0 — set by resumeThread (§Slice 2), consumed once by
 * ensureSession. Mirrors the explicit forceReplay switchProvider already passes.
 */
private readonly pendingForcedReplay = new Set<string>();
```

Change `ensureSession` (line 276-294) to consume the flag when the caller didn't already pass
an explicit `forceReplay`:

```ts
async ensureSession(
  actorUserId: string,
  userName: string,
  opts?: { readonly forceReplay?: boolean }
): Promise<UserSession> {
  const existing = this.sessions.get(actorUserId);
  if (existing) return existing;

  const inFlight = this.launching.get(actorUserId);
  if (inFlight) return inFlight;

  const forceReplay = opts?.forceReplay ?? this.pendingForcedReplay.delete(actorUserId);
  const launch = this.launchSession(actorUserId, userName, { forceReplay });
  this.launching.set(actorUserId, launch);
  try {
    return await launch;
  } finally {
    this.launching.delete(actorUserId);
  }
}
```

`Set.delete` returns `true` only if the actor was pending, and atomically clears it — so a
one-shot forced replay is consumed exactly once. Note: `launchSession` now always receives an
explicit `{ forceReplay }` object (never `opts` passed through raw), so `opts?.forceReplay ??`
in `launchSession` itself still works unchanged since we normalize to `{forceReplay: false}` at
worst, not `undefined` — the second test asserts `{forceReplay: undefined}` is what
`listPriorTurns` sees for the ordinary path today (line 338 uses `opts?.forceReplay`, and
`false` is falsy so this still resolves correctly downstream); if a stricter form is preferred,
match test expectations to `false` instead of `undefined` for the second case — pick whichever
this step's Run actually reports and align the test, don't guess blind.

- [ ] **Step 4: Set the flag in `resumeThread`**

In `resumeThread` (lines 673-695), after successfully dropping the session (end of the
`if (session) { ... }` block, before the function returns):

```ts
async resumeThread(actorUserId: string, threadId: string): Promise<void> {
  const found = await this.deps.persistence.touchExistingThread(actorUserId, threadId);
  if (!found) {
    throw new ChatThreadNotFoundError();
  }

  await this.stopTurn(actorUserId);

  const session = this.sessions.get(actorUserId);
  if (session) {
    try {
      await session.engine.kill();
    } catch {
      // best-effort: session is dropped below regardless
    }
    this.sessions.delete(actorUserId);
    this.deps.revokeMcpToken?.(actorUserId);
  }
  this.pendingForcedReplay.add(actorUserId);
}
```

- [ ] **Step 5: Run the unit tests to confirm they pass**

Run: `pnpm --filter @jarv1s/chat exec vitest run tests/unit/chat-session-manager-resume.test.ts`
Expected: PASS (all cases, including the two pre-existing ones — reconcile the second new
test's exact expected argument shape with what Step 3's Run actually printed if it diverges from
`{forceReplay: undefined}`).

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/live/chat-session-manager.ts tests/unit/chat-session-manager-resume.test.ts
git commit -m "fix(chat): force bounded replay on the turn after an explicit resume"
```

---

### Task 4: Unify History row selection with resume (Slice 2 UX + Slice 3 setup)

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx:116-124` (`resumeMutation`), `:421-443` (render),
  `:557-605` (`HistoryList`), remove `ReviewEmptyState`/`reviewing`-only composer readOnly gate
- Modify: `apps/web/src/styles/kit-chat.css` (remove `.chatd-review` styles, drop
  `.chatd-sess__resume` split-button styles if now unused)
- Test: `tests/e2e/chat-drawer.spec.ts`

**Interfaces:**

- Consumes: `resumeChat(threadId): Promise<void>` (existing, `client.ts:864`).
- Produces: selecting a History row now both displays the thread AND activates it as the live
  thread in one action — no `reviewing`/read-only intermediate state remains for later tasks to
  depend on.

- [ ] **Step 1: Write the failing e2e test**

In `tests/e2e/chat-drawer.spec.ts`, add a test seeding `chatThreads` with one past thread, opening
History, clicking the row (not a separate Play button), and asserting: (a) `POST
/api/chat/threads/:id/resume` was called, (b) the composer is NOT read-only afterward, (c) no
separate "Resume this conversation" banner/button exists in the DOM.

```ts
test("selecting a History row both opens and activates it — no separate resume step", async ({
  page
}) => {
  let resumeCalledWith: string | null = null;
  await mockApi(page, {
    authenticated: true,
    chatThreads: [
      {
        id: "t1",
        ownerUserId: "u1",
        title: "Old chat",
        incognito: false,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z"
      }
    ],
    chatMessages: { t1: [] },
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });
  await page.route("**/api/chat/threads/t1/resume", async (route) => {
    resumeCalledWith = "t1";
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByRole("button", { name: "Show chat history" }).click();
  await page.getByText("Old chat").click();

  await expect.poll(() => resumeCalledWith).toBe("t1");
  await expect(page.locator(".chatd-review")).toHaveCount(0);
  await expect(page.getByPlaceholder(/message/i)).toBeEditable();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @jarv1s/web exec playwright test chat-drawer -g "both opens and activates"`
Expected: FAIL — today selecting a row only sets `reviewThreadId` (read-only); resume requires a
separate Play click.

- [ ] **Step 3: Merge select+resume in `chat-drawer.tsx`**

Change the `HistoryList` render call (lines 421-428) to drop the separate `onResume`/`resuming`
props and pass a single combined handler:

```tsx
{
  showHistory ? (
    <HistoryList
      selectedThreadId={reviewThreadId}
      threads={threadsQuery.data?.threads ?? []}
      onSelect={(id) => {
        setReviewThreadId(id);
        resumeMutation.mutate(id);
      }}
      activating={resumeMutation.isPending}
    />
  ) : null;
}
```

Remove the entire `{reviewing ? (<div className="chatd-review">...</div>) : null}` block
(lines 430-443) — the standalone "Reviewing… / Resume this conversation" banner is gone; the
thread is now live immediately on selection.

Update `resumeMutation` (lines 116-124) to also clear `reviewThreadId` only after success (it
already does via `setReviewThreadId(null)` in `onSuccess` — keep that, since once resumed the
thread becomes the live thread and no longer needs "review" framing):

```tsx
const resumeMutation = useMutation({
  mutationFn: (threadId: string) => resumeChat(threadId),
  onSuccess: () => {
    props.clearRecords();
    setReviewThreadId(null);
    setShowHistory(false);
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
  },
  onError: () => {
    setReviewThreadId(null);
  }
});
```

Remove the now-unused `selectedThread`/`ReviewEmptyState` reference at line 458
(`reviewing ? <ReviewEmptyState /> : ...`) — replace with the ordinary empty/loading fallthrough
since `reviewing` as a read-only concept is gone. Delete the `reviewing` derivation's use in the
`Composer`'s `readOnly`/`disabled` props (line 538, 543, 547) — replace
`reviewing || privateEnded` with just `privateEnded` in both places. Keep `reviewThreadId` state
itself (still used to highlight the selected row and to gate the `messagesQuery`), but it no
longer implies read-only.

- [ ] **Step 4: Simplify `HistoryList`**

Replace the `HistoryList` function (lines 557-605) to drop the second Play button:

```tsx
function HistoryList(props: {
  readonly threads: readonly {
    readonly id: string;
    readonly title: string;
    readonly updatedAt: string;
  }[];
  readonly selectedThreadId: string | null;
  readonly onSelect: (threadId: string) => void;
  readonly activating: boolean;
}) {
  const locale = useUserLocale();
  if (props.threads.length === 0) return null;
  return (
    <div className="chatd-sess">
      <div className="chatd-sess__hd">History</div>
      {props.threads.map((thread) => (
        <button
          className={`chatd-sess__row${props.selectedThreadId === thread.id ? " is-selected" : ""}`}
          disabled={props.activating}
          key={thread.id}
          type="button"
          onClick={() => props.onSelect(thread.id)}
        >
          <span className="chatd-sess__ic">
            <MessageSquareText size={14} aria-hidden="true" />
          </span>
          <span className="chatd-sess__main">
            <span className="chatd-sess__title">{thread.title}</span>
          </span>
          <span className="chatd-sess__when">{formatShortDate(thread.updatedAt, locale)}</span>
        </button>
      ))}
    </div>
  );
}
```

Remove the now-unused `Play` icon import if `Play` is no longer referenced anywhere else in the
file (grep the file first — it may still be used elsewhere).

- [ ] **Step 5: Remove `ReviewEmptyState`**

Delete the `ReviewEmptyState` function (around line 967) if nothing else references it after
Step 3's changes (grep to confirm).

- [ ] **Step 6: Clean up `kit-chat.css`**

Remove the `.chatd-review` and `.chatd-review__resume` selector blocks and the
`.chatd-sess__resume` selector block (grep `kit-chat.css` for these three selectors first to
find their exact line ranges before deleting — do not guess line numbers).

- [ ] **Step 7: Run the e2e test to confirm it passes**

Run: `pnpm --filter @jarv1s/web exec playwright test chat-drawer -g "both opens and activates"`
Expected: PASS

- [ ] **Step 8: Run the full chat-drawer e2e suite to catch regressions from removing `reviewing`**

Run: `pnpm --filter @jarv1s/web exec playwright test chat-drawer`
Expected: PASS — fix any test still asserting the old separate-Play-button or read-only-review
behavior.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx apps/web/src/styles/kit-chat.css tests/e2e/chat-drawer.spec.ts
git commit -m "feat(chat): unify History row selection with resume — one action, not two"
```

---

### Task 5: Make History an exclusive surface (Slice 3)

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx:456-468` (render tree)
- Test: `tests/e2e/chat-drawer.spec.ts`

**Interfaces:**

- Consumes: `showHistory: boolean`, `threadsQuery` (existing).
- Produces: none — leaf UI change.

- [ ] **Step 1: Write the failing e2e test**

```ts
test("History hides the ordinary composer seeds while open", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [
      {
        id: "t1",
        ownerUserId: "u1",
        title: "Old chat",
        incognito: false,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z"
      }
    ],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByRole("button", { name: "Show chat history" }).click();

  await expect(page.locator(".chatd-empty")).toHaveCount(0);
  await expect(page.locator(".chatd-sess")).toBeVisible();
});
```

(Adjust the `.chatd-empty` selector to whatever class `EmptyState`'s root element actually
renders — grep `EmptyState` in `chat-drawer.tsx`/`kit-chat.css` to confirm before writing this.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @jarv1s/web exec playwright test chat-drawer -g "hides the ordinary composer seeds"`
Expected: FAIL — today `EmptyState`/`Thread`/`ConnectProviderEmpty` still render underneath
`HistoryList` when `effectiveRecords.length === 0`.

- [ ] **Step 3: Make the body render tree exclusive on `showHistory`**

Replace the render block (lines 456-468, the `effectiveRecords.length > 0 ? ... : ...` chain) so
it is skipped entirely while History is open:

```tsx
{
  showHistory ? null : effectiveRecords.length > 0 ? (
    <Thread records={effectiveRecords} />
  ) : onboardingStatusQuery.isSuccess && !chatAvailable ? (
    <ConnectProviderEmpty isFounder={props.isFounder} />
  ) : (
    <EmptyState
      onSend={sendMessage}
      isSending={isSending}
      lockedModelUnavailable={lockedModelUnavailable}
    />
  );
}
```

Also guard the private/activating/error banners (all now above this block, from Task 1/existing
code) the same way — wrap each with `!showHistory &&` — so private-mode chrome doesn't compete
with History's own surface. Add an own empty state to `HistoryList` for the zero-threads case
(currently it returns `null`, which combined with the change above would render a blank body):

In `HistoryList` (Task 4's version), change the early return:

```tsx
if (props.threads.length === 0) {
  return <div className="chatd-sess chatd-sess--empty">No past conversations yet.</div>;
}
```

- [ ] **Step 4: Run the e2e test to confirm it passes**

Run: `pnpm --filter @jarv1s/web exec playwright test chat-drawer -g "hides the ordinary composer seeds"`
Expected: PASS

- [ ] **Step 5: Run the full chat-drawer + full e2e suite**

Run: `pnpm --filter @jarv1s/web exec playwright test chat-drawer`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx tests/e2e/chat-drawer.spec.ts
git commit -m "fix(chat): make History an exclusive surface — no ordinary composer seeds underneath"
```

---

### Task 6: Full local gate + pre-push checks

- [ ] **Step 1: Run the full foundation gate**

Run: `pnpm verify:foundation`
Expected: PASS (exit 0). Record the exact exit code in the wrap-up report; if CI is unavailable
for any reason, record the local commands/exit codes used instead per CLAUDE.md.

- [ ] **Step 2: Pre-push trio + rebase**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

Expected: all green, rebase clean (resolve conflicts if any — none expected given the path locks).

- [ ] **Step 3: Hand off to `coordinated-wrap-up`**

Do not merge. Push, open the PR, and report the PR + verified evidence (gate exit codes, which
of the 5 non-negotiable checks from the handoff doc are proven by which task/test) to the UX
Coordinator.

---

## Self-Review

**Spec coverage (Slices 1-3 only):**

- Server-confirmed private-session truth, no send-race → Task 1.
- Private state restores from server truth after remount, never silently downgrades → Task 2.
- Reliable bounded continuation on resume, proof independent of `JARVIS_CHAT_REPLAY_K` → Task 3.
- History unifies select+resume into one action → Task 4.
- History does not render ordinary composer seeds; exclusive surface → Task 5.
- Full gate + pre-push checks → Task 6.
- Slice 4 / #868-gated / security-QA / Ben sign-off acceptance items: explicitly NOT claimed by
  this plan.

**Placeholder scan:** no TBD/TODO/"add appropriate"/"similar to Task N" left in any step; every
code step shows real code. Two spots intentionally instruct the implementer to grep/read actual
neighboring code before finalizing exact syntax (Task 2 Step 5 handler idiom, Task 4 Step 6 CSS
line ranges, Task 5's `.chatd-empty` selector) — these are read-then-match instructions, not
placeholders, since the plan couldn't safely guess file-local conventions/line numbers that may
shift by the time of execution; each names exactly what to confirm before writing.

**Type consistency:** `getChatPrivacyState(): Promise<GetChatPrivacyStateResponse>` (Task 2)
matches `{ incognito: boolean }` used in Task 2's Step 9 sync effect and Task 2's e2e mock.
`HistoryList`'s `onSelect`/`activating` props (Task 4) match the call site's
`onSelect={(id) => {...}}` / `activating={resumeMutation.isPending}`. `pendingForcedReplay`
(Task 3) is private to `ChatSessionManager`, consumed only inside `ensureSession` — no other
task references it.
