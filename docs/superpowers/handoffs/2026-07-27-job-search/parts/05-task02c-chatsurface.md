### Task 2c: Honour the chat surface the shell already anticipates

**Read this before assuming scope.** Per-surface chat is **already built end-to-end** (H1–H5):
`ChatSurface` is a branded string with `DEFAULT_CHAT_SURFACE = "drawer"` and `normalizeChatSurface()`
(`packages/shared/src/chat-api.ts`); `useChatStream(surface)` opens `EventSource(chatStreamUrl(surface))`
and lists threads per surface; the turn route and privacy start/end/state all read it
(`packages/chat/src/live-routes.ts`); sessions and subscriptions are keyed by **actor + surface**
(`gateway-notifier.ts`), so no cross-surface transcript path exists; migration `sql/0174_chat_surface.sql`
has shipped. The **only** gap is `apps/web/src/shell/app-shell.tsx`, which calls `useChatStream()` with
no surface and returns `recordsForSurface: () => records` — its own comment says so. This task closes
that one file. Bounded shell wiring, not a new subsystem.

**Depends on:** nothing. Tasks 17 and 22 depend on it.

**Files**

- Create: `apps/web/src/shell/chat-surface-key.ts`
- Modify: `apps/web/src/shell/app-shell.tsx` (~100–190)
- Modify: `apps/web/src/app.tsx` — `ExternalModuleMount` binds the surface handle to the module id
  alone today; accept a module-supplied **key** (never a surface)
- Modify: `apps/web/src/chat/assistant-surface/{contracts.ts,handle.ts}` — `setSurfaceKey`,
  `seedContext`
- Modify: `packages/chat/src/live-routes.ts` — the generic seed route
- Modify: `packages/shared/src/chat-api.ts` — its client function
- Test: `tests/unit/app-shell-chat-surface.test.tsx`, `tests/unit/chat-seed-route.test.ts`

**Contracts**

```ts
// apps/web/src/shell/chat-surface-key.ts
export function moduleChatSurface(moduleId: string, key: string): string;

// AssistantSurfaceHandleV1
/** Called when the active profile changes; `null` returns the shell to the drawer. */
setSurfaceKey(key: string | null): void;
/** Frames the thread on this surface BEFORE the user's first turn. Surface is curried
 *  by the handle, exactly as submitTurn already does — the module never names one. */
seedContext(seed: string, idempotencyKey: string): Promise<void>;
```

`POST /api/chat/seed` — body `{ seed: string, idempotencyKey: string, surface?: string }`, returns
**204 with no body**; `400` on a seed that is empty or over 8000 characters, on an
`idempotencyKey` that is empty or over 128, and on a surface `normalizeChatSurface` rejects; `401`
unauthenticated. Same rate-limit bucket and `keyGenerator` as the other chat mutations. It delegates
to the existing `ChatSessionManager.seedContext(actorUserId, userName, seed, idempotencyKey?, surface?)`
(`packages/chat/src/live/chat-session-manager.ts:376-392`).

**Constraints**

- **The surface string is not free-form.** `chat-api.ts:14` constrains it to
  `/^[a-z][a-z0-9-]{1,31}$/` — 2–32 chars, lowercase, digits and hyphens, **no colons**, must start
  with a letter — and every chat route runs `normalizeChatSurface`, which throws `Invalid chat
  surface`. The obvious `module:job-search:profile-1` would 400 **every single turn** (H3). Neither
  input can be concatenated in: `MODULE_ID_RE` (`validate.ts:28`) is unbounded and may start with a
  digit, and the module-supplied key is arbitrary text.
- **So the shell derives the wire surface by hashing, and the module never supplies one.**
  `moduleChatSurface` computes 64-bit **FNV-1a** over `` `${moduleId}:${key}` `` — two 32-bit lanes,
  one over the input forwards and one backwards — and returns `` `m-${hi}${lo}` `` with each lane as
  8 zero-padded hex characters: 18 characters, leading letter guaranteed, under the 32 cap. `:` is a
  safe separator precisely because `MODULE_ID_RE` forbids it in a module id, so `(id, key)` pairs
  cannot alias. FNV rather than sha256 because this runs in a **synchronous render path** and
  `crypto.subtle` is async; collision resistance is not a security boundary here — surfaces are
  namespaces inside one user's own account and both inputs are host-known.
- **The host owns the binding** (#1196, `apps/web/src/app.tsx:353`: "the surface name comes from the
  host mount, never from module code"). `setSurfaceKey` takes a key; the shell combines it with the
  **host-held** module id. Deterministic across reloads, so a profile's transcript stays re-findable.
  The surface is opaque on the wire; the human-readable scope pill comes from the module's label.
- **`recordsForSurface(surface)` returns `records` only when `surface === activeSurface`, `[]`
  otherwise.** Ben's ruling: a job-search thread must never appear in the main drawer.
  **Superseded in part on 2026-07-28 — see ruling N52 (#1332).** `recordsForSurface` itself is
  unchanged and still answers `[]` for any non-active surface. What changed is the argument the
  drawer passes: it asks for the **live** surface rather than a fixed `DEFAULT_CHAT_SURFACE`
  literal, so the header control opens the thread you are actually in. "Never in the main drawer"
  turns out to mean a module's transcript must not survive your **leaving** the module, which the
  surface key enforces by construction — it is also the history lookup key all the way down.
- **Reset to `DEFAULT_CHAT_SURFACE` on `null` and on unmount.**
- **Why a seed seam, and why this one.** A module-owned thread that opens with no framing is a
  generic assistant that happens to render inside Job Search. The three existing mechanisms are each
  wrong: `hostActions.openAssistant({starterPrompt})` and `seedComposer` insert an **editable draft**
  the user reads as their own text and can delete (I5) — right for "help me tighten this search",
  wrong for framing; `submitTurn` posts the seed as a visible user message. `seedContext` submits to
  the engine **without a visible user turn**, and its `idempotencyKey` (`session.seededContextKeys`)
  makes a re-seed a no-op, so a remount cannot re-frame a live conversation.
- **Generalise the evening-interview route rather than copying it.** `seedContext`'s only caller today
  is a route dedicated to one feature (`live-routes.ts:387-402`). One generic route serves every
  surface owner.
- **Trust note — put it in the code comment too.** The seed is module-authored text entering the
  model's context and carries exactly the authority a user turn carries, no more. It must never be
  described as, or given the standing of, a system prompt: an installed module that could rewrite the
  assistant's instructions is a privilege escalation.
- **The 8000-character cap is checked server-side** because the browser is not the trust boundary.
- **204 with no body is deliberate** — a Fastify response schema silently drops undeclared fields
  (I8), and a route with no body has nothing to lose.

**Tests**

`tests/unit/app-shell-chat-surface.test.tsx` — mock `useChatStream` so the assertions are about the
**surface argument the shell passes**, not SSE behaviour. Mock the specifier `app-shell.tsx:43`
actually imports (`../chat/use-chat-stream`); there is no `shell/use-chat-stream`, and mocking a path
that resolves to nothing silently does nothing while the real hook opens an EventSource in jsdom
(K7). Write `renderWithModuleMount` inline against real exports — do not add a test-only export to
production code.

1. **Opens `"drawer"` by default.**
2. **Switches to the module surface when a module sets a key** — last call equals
   `moduleChatSurface("job-search", "profile-1")`.
3. **Derives a surface the server will actually accept** — feed the derived value to the **real**
   `normalizeChatSurface`, unmocked, and assert it does not throw. Deliberately not a golden string:
   this is the assertion that rejected the original `module:<id>:<key>` scheme.
4. **Derives a legal surface from hostile inputs** — a module id starting with a digit and 120
   characters long, plus a key containing spaces, punctuation and an emoji, still normalizes.
5. **Two profiles of the same module get different surfaces.**
6. **Module records stay out of the drawer transcript** — with a module surface active,
   `recordsForSurface("drawer")` is `[]`.
7. **Unmount returns the shell to `"drawer"`.**

`tests/unit/chat-seed-route.test.ts` — `app.inject` against the real route:

8. **Seeds the requested surface and returns 204** — assert `manager.seedContext` received the actor,
   the seed, the key, **and the surface**, in that positional order.
9. **A repeat with the same idempotency key still reaches the manager** — assert the *second* call's
   arguments. The manager owns the dedupe; the route's job is to pass the key through. This guards the
   real failure: a module remount re-framing a conversation already in progress.
10. **An 8001-character seed is a 400.**
11. **An illegal surface is a 400, not a 500** — `module:job-search:p1` must be mapped by
    `handleLiveRouteError`, not escape as an unhandled throw.
12. **An unauthenticated call is a 401.**

**Verify**

```bash
pnpm vitest run tests/unit/app-shell-chat-surface.test.tsx tests/unit/chat-seed-route.test.ts  # exit 0
pnpm --filter @jarv1s/web typecheck                                                             # exit 0
```

---
