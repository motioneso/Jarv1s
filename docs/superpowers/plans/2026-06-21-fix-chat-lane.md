# Chat Drawer — Four Issues Fix (#400 / #402 / #399 / #408)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four chat-drawer bugs in one PR: #400 (seed-button wedge), #402 (stale history), #399 (optimistic echo + loading), #408 (clock-gated history + clean empty state).

**Architecture:** All four issues live in `chat-drawer.tsx` (280 lines) and `kit-chat.css` (524 lines). The keystone fix (#400) lifts the `send` logic out of the inner `Composer` component and into `ChatDrawer`, so both the seed buttons and the manual composer flow through the same path with a shared in-progress guard. #402 adds `invalidateQueries` calls to that shared path. #399 adds optimistic state (pending user record + loading indicator) to `ChatDrawer`. #408 adds a `showHistory` boolean state and a clock-icon toggle button in the drawer header.

**Tech Stack:** React 18 (StrictMode aware), `@tanstack/react-query` v5, lucide-react icons, `kit-chat.css` bespoke design tokens.

## Global Constraints

- Work ONLY in branch `fix-chat-lane`, worktree ending in `.claude/worktrees/fix-chat-lane`. Verify with `git branch --show-current` before every commit.
- `git add` only explicit file paths — never `git add -A` / `git add .`.
- Do NOT touch `docs/coordination/`, the board, milestones, or merge.
- `pnpm check:file-size` caps ALL source files at 1000 lines. `chat-drawer.tsx` is 280 lines; `kit-chat.css` is 524 lines — both safe.
- Never put mutations/sends inside a `setState` updater — StrictMode double-fires (see [[settings-confirm-strictmode-trap]]).
- If you touch message HTML/sanitization, STOP and escalate `[SECURITY]` to the Coordinator.
- All commits get `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` trailer.

---

## File Map

| File                                | Change                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| `apps/web/src/chat/chat-drawer.tsx` | Primary: lift send logic, add optimistic state, add history toggle |
| `apps/web/src/styles/kit-chat.css`  | Minor: add `.chatd-loading` style for the typing indicator         |

---

## Task 1: #400 — Lift `send` logic to `ChatDrawer`, unify seed path

The root cause: `EmptyState` seed buttons call `sendChatTurn(seed)` directly (bypassing error handling, the in-progress guard, and the query client). `Composer.send()` has the correct logic but is not reachable from `EmptyState`. Fix by lifting the logic into `ChatDrawer` as `sendMessage(text)`, passing it as `onSend` to both `EmptyState` and `Composer`, and removing the duplicate logic from `Composer`.

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx`

**Interfaces:**

- Produces: `sendMessage(text: string): void` function in `ChatDrawer` scope; `EmptyState` receives `onSend: (text: string) => void`; `Composer` receives `onSend: (text: string) => void`

- [ ] **Step 1: Add `useQueryClient` to imports and add `Clock` to lucide imports**

In `chat-drawer.tsx`, change line 1–2:

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ChevronDown,
  Clock,
  MessageSquareText,
  Sparkles,
  SquarePen,
  X
} from "lucide-react";
```

(Also add `useRef` to the React import — needed in Task 3. Do it now to avoid a second pass.)

```tsx
import { type KeyboardEvent, useRef, useState } from "react";
```

- [ ] **Step 2: Add shared send state and `sendMessage` function to `ChatDrawer`**

Inside `ChatDrawer`, after the existing `useState` for `reviewThreadId`, add:

```tsx
const queryClient = useQueryClient();
const [isSending, setIsSending] = useState(false);
const [sendError, setSendError] = useState<string | null>(null);
const [needsProvider, setNeedsProvider] = useState(false);

const sendMessage = (text: string): void => {
  const trimmed = text.trim();
  if (!trimmed || isSending) return;
  setSendError(null);
  setNeedsProvider(false);
  setIsSending(true);
  void (async () => {
    try {
      await sendChatTurn(trimmed);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
    } catch (caught) {
      if (isNoActiveChatModelError(caught)) {
        setNeedsProvider(true);
        return;
      }
      setSendError(caught instanceof Error ? caught.message : "Could not send message");
    } finally {
      setIsSending(false);
    }
  })();
};
```

**Why the IIFE pattern**: `sendMessage` is declared as a plain sync function (not `async`) so it can be passed as `onClick={() => sendMessage(seed)}` without `void` noise at every call site. The async work happens inside the IIFE. The `finally` block ensures `isSending` is ALWAYS cleared — this is the core fix for #400's wedge.

- [ ] **Step 3: Pass `sendMessage` to `Composer` and remove duplicate state from `Composer`**

Update the `Composer` call site in `ChatDrawer`'s JSX (near the bottom):

```tsx
<Composer
  readOnly={reviewing}
  isFounder={props.isFounder}
  initialText={props.initialText}
  isSending={isSending}
  sendError={sendError}
  needsProvider={needsProvider}
  onSend={sendMessage}
/>
```

Update the `Composer` function signature and body:

```tsx
function Composer(props: {
  readonly readOnly: boolean;
  readonly isFounder: boolean;
  readonly initialText?: string;
  readonly isSending: boolean;
  readonly sendError: string | null;
  readonly needsProvider: boolean;
  readonly onSend: (text: string) => void;
}) {
  const [text, setText] = useState(() => props.initialText ?? "");

  const send = () => {
    if (props.readOnly || props.isSending) return;
    props.onSend(text);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="chatd__composer">
      {props.needsProvider ? <ConnectProviderEmpty isFounder={props.isFounder} /> : null}
      {props.sendError ? <p className="form-error">{props.sendError}</p> : null}
      <div className={`chatd-input${props.readOnly ? " is-readonly" : ""}`}>
        <textarea
          aria-label="Message Jarvis"
          disabled={props.readOnly}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.readOnly ? "Read-only history" : "Message Jarvis…"}
          rows={1}
          value={text}
        />
        <button
          aria-label="Send"
          className="chatd-send"
          disabled={props.readOnly || props.isSending || !text.trim()}
          type="button"
          onClick={send}
        >
          <ArrowUp size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
```

Note: `setText("")` happens synchronously before `onSend` is called, so the input clears immediately when the user presses send (good UX, matches the original). The old `Composer` had `await sendChatTurn(trimmed)` — the new one just calls `props.onSend(text)` and clears the input; the async work is in `sendMessage` in `ChatDrawer`.

- [ ] **Step 4: Update `EmptyState` to accept and use `onSend`**

Update `EmptyState`'s signature and seed button `onClick`:

```tsx
function EmptyState(props: { readonly onSend: (text: string) => void }) {
  const tasksQuery = useQuery({ queryKey: queryKeys.tasks.list, queryFn: () => listTasks() });
  const eventsQuery = useQuery({
    queryKey: queryKeys.calendar.list,
    queryFn: () => listCalendarEvents()
  });

  const seeds = buildChatSeeds(tasksQuery.data?.tasks ?? [], eventsQuery.data?.events ?? []);

  return (
    <div className="chatd-empty">
      <span className="chatd-empty__mark">
        <Sparkles size={22} aria-hidden="true" />
      </span>
      <div className="chatd-empty__title">What can I help with?</div>
      <div className="chatd-empty__sub">
        Ask about your day, your tasks, or anything you&apos;ve told me.
      </div>
      <div className="chatd-sugg">
        {seeds.map((seed) => (
          <button
            className="chatd-sugg__btn"
            key={seed}
            type="button"
            onClick={() => props.onSend(seed)}
          >
            {seed}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update `EmptyState` call site in `ChatDrawer` body**

In the JSX, wherever `<EmptyState />` is rendered (currently line ~130), pass `onSend`:

```tsx
<EmptyState onSend={sendMessage} />
```

- [ ] **Step 6: Verify with typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors (or only pre-existing errors unrelated to chat-drawer.tsx).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx
git commit -m "$(cat <<'EOF'
fix(chat): unify seed and composer send paths — fixes #400 wedge

Lift send logic from Composer to ChatDrawer as sendMessage(). Seeds now
call the same code path as the manual composer, with a shared isSending
guard and a try/finally that always clears the guard. Also invalidates
queryKeys.chat.threads after each successful turn for #402.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: #402 — Invalidate `chat.threads` on new-chat

`startNewChat` also triggers a new thread implicitly (the next send creates one), so refreshing threads on new-chat ensures a stale "no threads" state can't persist. Task 1 already added the invalidation on send. This task only adds it for new-chat.

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx`

**Interfaces:**

- Consumes: `queryClient` and `queryKeys.chat.threads` from Task 1 (already in scope).

- [ ] **Step 1: Add `clearChat` import and update `startNewChat`**

`clearChat` is already imported (line 8). Update `startNewChat` in `ChatDrawer` to also invalidate threads:

```tsx
const startNewChat = () => {
  setReviewThreadId(null);
  void clearChat();
  props.clearRecords();
  void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
};
```

- [ ] **Step 2: Verify with typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx
git commit -m "$(cat <<'EOF'
fix(chat): invalidate threads query on new-chat — fixes #402

startNewChat now invalidates queryKeys.chat.threads so the history list
refreshes without a reload when the user starts a fresh conversation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: #399 — Optimistic user message + loading indicator

When a message is sent, the user's bubble should appear immediately without waiting for the SSE stream to echo it back. A loading/thinking indicator should also show while waiting for the assistant.

**Strategy:**

- `pendingUserText: string | null` — set to the sent text on send, cleared when the SSE stream starts returning new records.
- `turnStartCountRef: React.MutableRefObject<number>` — captures `props.records.length` at send time, so the useEffect knows when "new" SSE records have arrived.
- A `useEffect` watching `props.records.length` clears `pendingUserText` once `props.records.length > turnStartCountRef.current`.
- In the render, merge `pendingUserText` + a loading record into `effectiveRecords` (shown only for the live view, not history review).

**StrictMode safety**: the useEffect only calls `setPendingUserText(null)` — idempotent setState, safe to double-fire.

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx`
- Modify: `apps/web/src/styles/kit-chat.css` (add `.chatd-loading` style)

**Interfaces:**

- Consumes: `sendMessage` from Task 1 (injects `pendingUserText` and `turnStartCountRef` logic into it).

- [ ] **Step 1: Add `pendingUserText` state and `turnStartCountRef` to `ChatDrawer`**

After the existing `useState` declarations in `ChatDrawer`, add:

```tsx
const [pendingUserText, setPendingUserText] = useState<string | null>(null);
const turnStartCountRef = useRef(0);
```

- [ ] **Step 2: Capture turn-start record count and set pending text in `sendMessage`**

In the `sendMessage` function (added in Task 1), at the very start (before `setIsSending(true)`), add:

```tsx
turnStartCountRef.current = props.records.length;
setPendingUserText(trimmed);
```

And clear it on error (in the `catch` block, before the early `return`):

```tsx
} catch (caught) {
  setPendingUserText(null);  // clear optimistic on error
  if (isNoActiveChatModelError(caught)) {
    ...
```

The full `sendMessage` after Tasks 1–3:

```tsx
const sendMessage = (text: string): void => {
  const trimmed = text.trim();
  if (!trimmed || isSending) return;
  setSendError(null);
  setNeedsProvider(false);
  setIsSending(true);
  turnStartCountRef.current = props.records.length;
  setPendingUserText(trimmed);
  void (async () => {
    try {
      await sendChatTurn(trimmed);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
    } catch (caught) {
      setPendingUserText(null);
      if (isNoActiveChatModelError(caught)) {
        setNeedsProvider(true);
        return;
      }
      setSendError(caught instanceof Error ? caught.message : "Could not send message");
    } finally {
      setIsSending(false);
    }
  })();
};
```

- [ ] **Step 3: Add `useEffect` to clear `pendingUserText` when SSE records arrive**

After `sendMessage` (still inside `ChatDrawer`), add:

```tsx
// Clear the optimistic user record once the SSE stream starts receiving events for this turn.
// Runs whenever the live records array grows; safe to double-fire (idempotent setState).
// NOTE: not run for history-review mode — pendingUserText is only set for live sends.
// eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-run on length change
useEffect(() => {
  if (pendingUserText !== null && props.records.length > turnStartCountRef.current) {
    setPendingUserText(null);
  }
}, [props.records.length, pendingUserText]);
```

Also add `useEffect` to the React imports if not already there (was added in Task 1 step 1):

```tsx
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
```

- [ ] **Step 4: Build `effectiveRecords` with optimistic record and loading indicator**

Replace the existing `displayRecords` usage in `ChatDrawer`'s JSX body. Currently the body has:

```tsx
{
  displayRecords.length > 0 ? (
    <Thread records={displayRecords} />
  ) : reviewing ? (
    <ReviewEmptyState />
  ) : onboardingStatusQuery.isSuccess && !chatAvailable ? (
    <ConnectProviderEmpty isFounder={props.isFounder} />
  ) : (
    <EmptyState onSend={sendMessage} />
  );
}
```

Add `effectiveRecords` derivation just before the `return` (after `selectedThread`):

```tsx
// Merge optimistic user record into the live feed. pendingUserText is only set during
// active sends in the live view — it is not applied when reviewing history.
const effectiveRecords: readonly TranscriptRecord[] = reviewing
  ? displayRecords
  : [
      ...displayRecords,
      ...(pendingUserText ? [{ kind: "user" as const, text: pendingUserText }] : [])
    ];

const isWaiting = !reviewing && (isSending || pendingUserText !== null);
```

Update the JSX body to use `effectiveRecords` and show a loading element:

```tsx
{
  effectiveRecords.length > 0 ? (
    <Thread records={effectiveRecords} />
  ) : reviewing ? (
    <ReviewEmptyState />
  ) : onboardingStatusQuery.isSuccess && !chatAvailable ? (
    <ConnectProviderEmpty isFounder={props.isFounder} />
  ) : (
    <EmptyState onSend={sendMessage} />
  );
}
{
  isWaiting ? (
    <div className="chatd-loading" aria-live="polite" aria-label="Jarvis is thinking">
      <span className="chatd-msg__av">
        <Sparkles size={14} aria-hidden="true" />
      </span>
      <span className="chatd-loading__dots" aria-hidden="true" />
    </div>
  ) : null;
}
```

- [ ] **Step 5: Add `.chatd-loading` styles to `kit-chat.css`**

Append after the last rule in `kit-chat.css` (currently line 524):

```css
/* #399: loading indicator — shown while waiting for SSE to respond */
.chatd-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  color: var(--text-subtle);
}
.chatd-loading__dots {
  display: inline-block;
  width: 24px;
  height: 10px;
  position: relative;
}
.chatd-loading__dots::before {
  content: "· · ·";
  letter-spacing: 3px;
  font-size: 18px;
  animation: chatd-dots 1.2s steps(4, end) infinite;
}
@keyframes chatd-dots {
  0% {
    opacity: 0.2;
  }
  33% {
    opacity: 0.7;
  }
  66% {
    opacity: 1;
  }
  100% {
    opacity: 0.2;
  }
}
```

- [ ] **Step 6: Verify typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx apps/web/src/styles/kit-chat.css
git commit -m "$(cat <<'EOF'
feat(chat): optimistic user message + loading indicator — fixes #399

On send, immediately append the user's message to the conversation
without waiting for the SSE echo. Shows a typing/loading indicator
while the assistant is responding. Clears automatically once the
SSE stream delivers the real records.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: #408 — History behind clock icon + clean empty state

By default the chat drawer opens to a clean empty state with no history list visible. History is accessible via a clock-icon toggle button in the drawer header (reusing the existing `.chatd__hbtn.is-on` active state already in `kit-chat.css`).

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx`

**Interfaces:**

- Consumes: `Clock` icon from lucide-react (added in Task 1). `chatd__hbtn.is-on` CSS class already exists — no CSS changes needed.

- [ ] **Step 1: Add `showHistory` state to `ChatDrawer`**

After the `reviewThreadId` useState, add:

```tsx
const [showHistory, setShowHistory] = useState(false);
```

Also reset `showHistory` to `false` in `startNewChat`:

```tsx
const startNewChat = () => {
  setReviewThreadId(null);
  setShowHistory(false);
  void clearChat();
  props.clearRecords();
  void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
};
```

- [ ] **Step 2: Add clock icon toggle button to the header**

In the `chatd__head` div, insert the clock button BETWEEN the "New chat" (`SquarePen`) button and the "Close" (`X`) button:

```tsx
<button
  aria-label={showHistory ? "Hide chat history" : "Show chat history"}
  aria-pressed={showHistory}
  className={`chatd__hbtn${showHistory ? " is-on" : ""}`}
  title={showHistory ? "Hide history" : "History"}
  type="button"
  onClick={() => setShowHistory((prev) => !prev)}
>
  <Clock size={16} aria-hidden="true" />
</button>
```

- [ ] **Step 3: Gate `HistoryList` behind `showHistory`**

In `ChatDrawer`'s JSX body, the `<HistoryList .../>` is currently unconditional (renders if `threads.length > 0`). Gate it:

```tsx
{
  showHistory ? (
    <HistoryList
      selectedThreadId={reviewThreadId}
      threads={threadsQuery.data?.threads ?? []}
      onSelect={setReviewThreadId}
    />
  ) : null;
}
```

- [ ] **Step 4: Verify full header JSX is correct**

The complete `chatd__head` should now look like:

```tsx
<div className="chatd__head">
  <span className="chatd__mark">
    <Sparkles size={16} aria-hidden="true" />
  </span>
  <div className="chatd__id">
    <div className="chatd__name">Jarvis</div>
    <div className="chatd__status">Here when you need me</div>
  </div>
  <button
    aria-label="New chat"
    className="chatd__hbtn"
    title="New chat"
    type="button"
    onClick={startNewChat}
  >
    <SquarePen size={16} aria-hidden="true" />
  </button>
  <button
    aria-label={showHistory ? "Hide chat history" : "Show chat history"}
    aria-pressed={showHistory}
    className={`chatd__hbtn${showHistory ? " is-on" : ""}`}
    title={showHistory ? "Hide history" : "History"}
    type="button"
    onClick={() => setShowHistory((prev) => !prev)}
  >
    <Clock size={16} aria-hidden="true" />
  </button>
  <button
    aria-label="Close chat"
    className="chatd__hbtn"
    title="Close"
    type="button"
    onClick={props.onClose}
  >
    <X size={17} aria-hidden="true" />
  </button>
</div>
```

- [ ] **Step 5: Verify typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/chat/chat-drawer.tsx
git commit -m "$(cat <<'EOF'
feat(chat): history behind clock icon, clean empty state — fixes #408

Gate HistoryList behind a clock-icon toggle button in the drawer header.
Drawer opens to clean empty state (seeds only, no history). History is
accessible via the clock toggle (is-on style when active). New chat
collapses history back to closed.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Pre-push gate + typecheck

- [ ] **Step 1: Run pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all three pass with 0 errors / 0 warnings.

If `format:check` fails, run `pnpm format` on **only** your changed files:

```bash
pnpm prettier --write apps/web/src/chat/chat-drawer.tsx apps/web/src/styles/kit-chat.css
```

Then re-add and amend/commit (new commit is fine — do NOT amend Task 4's commit):

```bash
git add apps/web/src/chat/chat-drawer.tsx apps/web/src/styles/kit-chat.css
git commit -m "$(cat <<'EOF'
chore: format chat-drawer.tsx and kit-chat.css

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Rebase on origin/main**

```bash
git fetch origin main && git rebase origin/main
```

Expected: clean rebase (no conflicts — this branch is isolated on chat files). If conflict, resolve and `git rebase --continue`.

- [ ] **Step 3: Final file-size check**

```bash
pnpm check:file-size
```

Expected: pass (chat-drawer.tsx should be ~320–360 lines, kit-chat.css ~545 lines — both well under 1000).

---

## Spec coverage check (self-review)

| Requirement                                             | Task                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| #400: seed buttons no longer wedge; send unblocked      | Task 1 (lift send, try/finally guard)                       |
| #400: both paths use same send code                     | Task 1 (onSend prop unified)                                |
| #402: history refreshes after turn without reload       | Task 1 (invalidateQueries in sendMessage)                   |
| #402: history refreshes after new-chat                  | Task 2 (invalidateQueries in startNewChat)                  |
| #399: user message appears immediately                  | Task 3 (pendingUserText optimistic record)                  |
| #399: loading indicator while streaming                 | Task 3 (isWaiting + chatd-loading element)                  |
| #399: works for both seed and manual send               | Task 3 (pendingUserText set in sendMessage, shared by both) |
| #408: clock icon in header                              | Task 4                                                      |
| #408: history gated behind clock toggle                 | Task 4                                                      |
| #408: clean empty state on open (no history by default) | Task 4 (showHistory default false)                          |
| #408: empty-state seeds actually work                   | Task 1 (fixed by onSend unification)                        |
| #408: new-chat collapses history                        | Task 4 (startNewChat resets showHistory)                    |
| File-size gate not exceeded                             | Task 5                                                      |
| Format/lint/typecheck clean                             | Task 5                                                      |
