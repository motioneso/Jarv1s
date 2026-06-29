# Chat history: latest conversation missing + resume past sessions (#508)

**Status:** draft
**Date:** 2026-06-29
**Owner:** Jim
**Issue:** #508
**Grounded on:** `~/Jarv1s/packages/chat/src/repository.ts:26-53, 126-140, 247-256`,
`~/Jarv1s/packages/chat/src/live/persistence.ts:137-162`,
`~/Jarv1s/packages/chat/src/live-routes.ts:62-137`,
`~/Jarv1s/apps/web/src/chat/chat-drawer.tsx:68-69, 114-123, 210-228, 346-357, 360-391`.
Grounded on commit `d894477566cb3dbb88b1cf2efc3926fe3049a1ca`.

---

## 1. Problem

Two distinct bugs share issue #508. They are independent fixes but cohesive in scope (chat
history usability), so they ship in one PR.

### 1a — Latest conversation missing from History

When a user opens the History panel, the active conversation is not at the top. Older, idle
threads appear above it.

**Root cause** (`repository.ts:26-53`):

- `GET /api/chat/threads` → `ChatRepository.listThreads()` orders by `updated_at DESC`.
- Every completed turn calls `touchThread()` (`repository.ts:247-256`), which bumps only
  `last_active_at` — **not** `updated_at`.
- `updated_at` is set once at thread creation and never changes thereafter.

Result: the active thread retains its creation-time `updated_at`, so any thread created more
recently (even an idle one) sorts above it in the History panel. The code comment in
`listThreadsByActivity` (`repository.ts:39-42`) explicitly acknowledges this divergence —
that method was added as a workaround for the briefings subsystem. The History panel was
never updated to follow suit.

### 1b — Past sessions are read-only; no way to resume

When a user clicks a history thread, they can read its messages but cannot continue the
conversation. The composer is hard-disabled.

**Root cause** (`chat-drawer.tsx:346-357`):

- Selecting a history thread sets `reviewThreadId` in local state.
- `reviewing = reviewThreadId !== null` → `Composer` receives `readOnly={reviewing}` →
  the send handler returns immediately if `readOnly`.
- No "Resume" action exists. There is no backend endpoint that switches the active thread;
  the only mutation is `POST /api/chat/clear`, which always creates a _new_ thread.

The mechanism to change the current thread exists in the DB layer (`touchThread` makes the
touched thread "current" for `getCurrentThread`, which keys on `last_active_at DESC`), but
it is not exposed for user-initiated resume.

---

## 2. Decision

Fix both bugs with minimal surface additions. No new tables. No changes to the
`AccessContext` shape or RLS policies.

### 2a — Fix ordering: sort history by `last_active_at`

Change `ChatRepository.listThreads()` to order by `last_active_at DESC` (same column
`getCurrentThread` and `listThreadsByActivity` already use). The `GET /api/chat/threads`
route uses `listThreads`, so the History panel immediately shows the active conversation
first.

This is a one-line repository change with no schema migration.

### 2b — Add resume: `POST /api/chat/threads/:id/resume`

Add a backend endpoint and a frontend "Resume" action.

**Backend endpoint** (`live-routes.ts`):

```
POST /api/chat/threads/:id/resume  →  204
```

- Resolve `AccessContext`; 401 when session missing.
- Verify the thread exists and `owner_user_id = actorUserId`; 404 otherwise.
- Call a new `ChatSessionManager.resumeThread(actorUserId, threadId)` method (see below).
- Return 204.
- Subject to `CHAT_MUTATION_MAX` rate limit.

**New `ChatSessionManager.resumeThread(actorUserId, threadId)` method:**

1. Stop any in-flight turn for the actor (idempotent, same as `stopTurn`).
2. Clear in-memory session state for the actor (same effect as the clear path, but without
   opening a new DB thread — skip `openNewConversation`).
3. Call `persistence.touchExistingThread(actorUserId, threadId)` — a new persistence method
   that bumps `last_active_at` on the target thread under the actor's data context.

`touchExistingThread` on the persistence layer calls `chatRepository.touchThread(scopedDb, threadId)` —
this already exists (`repository.ts:247-256`) and is idempotent. The method only needs to be
wired into `ChatPersistencePort` and `DataContextChatPersistence` so the session manager can
call it without bypassing the data-context boundary.

After `resumeThread` returns, the next `POST /api/chat/turn` will call `listPriorTurns`,
which calls `getCurrentThread` (sorts by `last_active_at DESC`) — the resumed thread is now
current, so its messages are loaded as context for the continued conversation.

**Frontend changes** (`chat-drawer.tsx`):

1. Add `resumeChat(threadId: string)` mutation calling `POST /api/chat/threads/:id/resume`.
2. In `HistoryList`, add a "Resume" button alongside each row (or make the row itself split
   into a read-only title click and an explicit Resume action — UX detail for the
   implementation pass).
3. On successful resume: call `props.clearRecords()` + `queryClient.invalidateQueries(threads)`
   - set `reviewThreadId = null` + `showHistory = false`. The chat view returns to live mode,
     empty (the resumed thread's history is in DB, loaded on the next turn via `listPriorTurns`).
4. When in review mode, show a "Resume this conversation" affordance above or below the
   read-only thread view.

---

## 3. Slices

### Slice A — Fix history ordering (repository only)

**Files:** `packages/chat/src/repository.ts`

- `listThreads()`: change `orderBy("updated_at", "desc")` → `orderBy("last_active_at", "desc")`.
- No migration. `last_active_at` is already populated for all rows (set on INSERT via
  `openNewThread`, bumped on every turn via `touchThread`).

Acceptance: `GET /api/chat/threads` returns threads newest-active-first; a thread receiving
a turn moves to position 1 even if an idle but more recently created thread exists.

### Slice B — Wire `touchExistingThread` into `ChatPersistencePort`

**Files:** `packages/chat/src/live/chat-session-manager.ts` (port interface),
`packages/chat/src/live/persistence.ts`.

- Add `touchExistingThread(actorUserId: string, threadId: string): Promise<void>` to
  `ChatPersistencePort`.
- Implement in `DataContextChatPersistence`: run under `withDataContext`, call
  `this.chat.touchThread(scopedDb, threadId)` (already exists), ignore undefined return.

Acceptance: the interface compiles; the implementation passes a typed call through to the
existing `touchThread` repository method.

### Slice C — `ChatSessionManager.resumeThread` + `POST /api/chat/threads/:id/resume`

**Files:** `packages/chat/src/live/chat-session-manager.ts`,
`packages/chat/src/live-routes.ts`.

- `resumeThread(actorUserId, threadId)`: stop in-flight turn → clear in-memory session state
  → call `persistence.touchExistingThread(actorUserId, threadId)`.
- Route: auth-check → ownership check → call `manager.resumeThread` → 204.

Acceptance: calling `POST /api/chat/threads/:id/resume` then `POST /api/chat/turn` produces
a reply that cites prior context from the resumed thread (verify with a thread that has at
least two stored turns and `JARVIS_CHAT_REPLAY_K > 0`).

### Slice D — Frontend resume affordance

**Files:** `apps/web/src/chat/chat-drawer.tsx`, `apps/web/src/api/client.ts`.

- Add `resumeChat` API client function calling `POST /api/chat/threads/:id/resume`.
- Add Resume button in `HistoryList` rows.
- When reviewing, show "Resume this conversation" above the read-only thread.
- On success: clear records, close history panel, return to live mode.
- Invalidate `queryKeys.chat.threads` so history reorders.

Acceptance: user can resume a past session and send a new turn without page reload; history
panel shows resumed thread at top.

---

## 4. Definition of Done

- [ ] `GET /api/chat/threads` returns active thread first (Slice A).
- [ ] `POST /api/chat/threads/:id/resume` returns 404 for a thread belonging to another
      user, 401 for unauthenticated, 204 on success.
- [ ] After resume + one turn, `listPriorTurns` loads the resumed thread's stored messages
      as context (verified locally with `JARVIS_CHAT_REPLAY_K=10`).
- [ ] Frontend Resume button visible in History panel and on the review banner.
- [ ] TypeScript clean, `pnpm verify:foundation` green.
- [ ] No new tables, no migration files.

---

## 5. Out of scope

- Renaming or re-titling a thread from the History panel.
- Pagination of the thread list (currently unbounded; a separate concern).
- Merging two past threads.
- Incognito thread history (incognito threads are never listed — correct by design).
- A "delete conversation" action.
