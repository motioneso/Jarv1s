# Chat Composer Stop Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat composer send arrow with Stop while a response is running, support one staged next message, and drain it after explicit Stop.

**Architecture:** Keep this local to the existing chat drawer. `Composer` owns draft text and the depth-1 `queuedText` chip because the chip lives in the composer; `ChatDrawer` owns the actual stop/drain flow because `sendMessage` and `cancelChatTurn` already live there. Add one `drainAfterStopText` state plus an effect so the queued send waits until `isSending` has really flipped false.

**Tech Stack:** React state/effects, existing `lucide-react` icons, existing `chatd-*` CSS, Playwright e2e.

---

## Verified Current State

- `~/Jarv1s/apps/web/src/chat/chat-drawer.tsx`: `pendingUserText` exists and is the optimistic sent-message echo, not a queue.
- `~/Jarv1s/apps/web/src/chat/chat-drawer.tsx`: `queuedText` does not exist.
- `~/Jarv1s/apps/web/src/chat/chat-drawer.tsx`: `Composer.send()` returns early while `props.isSending`.
- `~/Jarv1s/apps/web/src/chat/chat-drawer.tsx`: the composer send button is disabled while `props.isSending`.
- `~/Jarv1s/apps/web/src/chat/chat-drawer.tsx`: Stop is currently a separate `.chatd-stop` button inside `.chatd-loading`.
- `~/Jarv1s/apps/web/src/styles/kit-chat.css`: existing `.chatd-send`, `.chatd-stop`, `.chatd-input`, and `.chatd-loading` styles are available.
- `~/Jarv1s/tests/e2e/chat-drawer.spec.ts`: existing Playwright chat drawer coverage can be extended without new test dependencies.

## File Structure

- Modify `apps/web/src/chat/chat-drawer.tsx`
  - Add `useCallback` import.
  - Move `sendMessage` above the `if (!props.open)` return as a `useCallback`.
  - Add `drainAfterStopText` and an effect that sends it only after `isSending` becomes false.
  - Change `stopSending` to accept optional queued text and request drain after cancel.
  - Remove the separate Stop button from the loading row.
  - Add `queuedText` state, staging, stop button morphing, and editable/dismissable chip inside `Composer`.
- Modify `apps/web/src/styles/kit-chat.css`
  - Add compact chip styles only.
  - Reuse `.chatd-send` for both send and stop slot.
- Modify `tests/e2e/chat-drawer.spec.ts`
  - Add one focused Playwright regression covering morphing, stage/update/edit/discard, Shift+Enter newline, and Stop-drain ordering.

## Task 1: Composer Stop Queue

**Files:**

- Modify: `tests/e2e/chat-drawer.spec.ts`
- Modify: `apps/web/src/chat/chat-drawer.tsx`
- Modify: `apps/web/src/styles/kit-chat.css`

- [ ] **Step 1: Write the failing Playwright test**

Add this test after the first live chat drawer test in `tests/e2e/chat-drawer.spec.ts`:

```ts
test("stages next message while response is running and sends it after stop", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  const turnTexts: string[] = [];
  let cancelRequests = 0;
  let releaseFirstTurn: (() => void) | null = null;
  const firstTurnStopped = new Promise<void>((resolve) => {
    releaseFirstTurn = resolve;
  });

  await page.route("**/api/chat/turn", async (route) => {
    const body = route.request().postDataJSON() as { readonly text: string };
    turnTexts.push(body.text);

    if (body.text === "First question") {
      await firstTurnStopped;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reply: `Reply for ${body.text}` })
    });
  });

  await page.route("**/api/chat/turn/cancel", async (route) => {
    cancelRequests += 1;
    releaseFirstTurn?.();
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("**/api/chat/clear", (route) => route.fulfill({ status: 204, body: "" }));

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  const composerInput = drawer.getByLabel("Message Jarvis");

  await composerInput.fill("First question");
  await composerInput.press("Enter");

  const composerAction = drawer.locator(".chatd-input .chatd-send");
  await expect(composerAction).toHaveAttribute("aria-label", "Stop generating");
  await expect(drawer.locator(".chatd-loading .chatd-stop")).toHaveCount(0);

  await composerInput.fill("Line one");
  await composerInput.press("Shift+Enter");
  await expect(composerInput).toHaveValue("Line one\n");
  await composerInput.type("Line two");
  await composerInput.press("Enter");
  await expect(composerInput).toHaveValue("");
  await expect(drawer.getByText('Next: "Line one\\nLine two"')).toBeVisible();

  await composerInput.fill("Replacement next");
  await composerInput.press("Enter");
  await expect(drawer.getByText('Next: "Replacement next"')).toBeVisible();
  await expect(drawer.getByText(/Line one/)).toHaveCount(0);

  await drawer.getByRole("button", { name: "Edit queued message" }).click();
  await expect(composerInput).toHaveValue("Replacement next");
  await expect(drawer.getByText(/Next:/)).toHaveCount(0);

  await composerInput.press("ControlOrMeta+A");
  await composerInput.fill("Discard me");
  await composerInput.press("Enter");
  await drawer.getByRole("button", { name: "Discard queued message" }).click();
  await expect(drawer.getByText(/Next:/)).toHaveCount(0);

  await composerInput.fill("Drained queued");
  await composerInput.press("Enter");
  await expect(drawer.getByText('Next: "Drained queued"')).toBeVisible();

  await composerAction.click();

  await expect.poll(() => turnTexts).toEqual(["First question", "Drained queued"]);
  expect(cancelRequests).toBe(1);
  await expect(drawer.getByText(/Next:/)).toHaveCount(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm exec playwright test tests/e2e/chat-drawer.spec.ts --project=chromium -g "stages next message"
```

Expected: FAIL because `.chatd-input .chatd-send` still has `aria-label="Send"` and is disabled while `isSending`; the old separate `.chatd-loading .chatd-stop` button still exists.

- [ ] **Step 3: Implement parent stop/drain state**

In `apps/web/src/chat/chat-drawer.tsx`, change the React import:

```ts
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
```

Add drain state beside the existing send state:

```ts
const [isSending, setIsSending] = useState(false);
const [sendError, setSendError] = useState<string | null>(null);
const [needsProvider, setNeedsProvider] = useState(false);
const [drainAfterStopText, setDrainAfterStopText] = useState<string | null>(null);
```

Move `sendMessage` above `if (!props.open) return null;` and wrap it with `useCallback`:

```ts
const sendMessage = useCallback(
  (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setSendError(null);
    setNeedsProvider(false);
    setIsSending(true);
    setPendingUserText(trimmed);
    void (async () => {
      try {
        const result = await sendChatTurn(trimmed);
        setPendingUserText(null);
        const postResponseRecords: readonly TranscriptRecord[] = [
          { kind: "user", text: trimmed },
          { kind: "reply", text: result.reply }
        ];
        setFallbackRecords((current) =>
          [...current, ...postResponseRecords].filter(
            (fallback) => !props.records.some((record) => sameTranscriptRecord(record, fallback))
          )
        );
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
  },
  [isSending, props.records, queryClient]
);
```

Add the drain effect immediately after `sendMessage`:

```ts
useEffect(() => {
  if (isSending || drainAfterStopText === null) return;
  const nextText = drainAfterStopText;
  setDrainAfterStopText(null);
  sendMessage(nextText);
}, [drainAfterStopText, isSending, sendMessage]);
```

Update `startNewChat` to clear pending drain state:

```ts
setDrainAfterStopText(null);
```

Change `stopSending` to accept the staged message and schedule drain only for explicit Stop:

```ts
const stopSending = (queuedText: string | null): void => {
  if (queuedText !== null) {
    setDrainAfterStopText(queuedText);
  }
  void cancelChatTurn().catch(() => {
    // best-effort: the turn ends server-side regardless; a network error here just means the
    // local isSending flag clears when the POST /turn promise settles.
  });
};
```

Remove this old loading-row button from `.chatd-loading`:

```tsx
<button
  aria-label="Stop generating"
  className="chatd-stop"
  title="Stop"
  type="button"
  onClick={stopSending}
>
  <Square size={13} aria-hidden="true" fill="currentColor" />
  <span>Stop</span>
</button>
```

Pass the stop callback into `Composer`:

```tsx
<Composer
  readOnly={reviewing}
  isFounder={props.isFounder}
  initialText={props.initialText}
  isSending={isSending}
  sendError={sendError}
  needsProvider={needsProvider}
  onSend={sendMessage}
  onStop={stopSending}
/>
```

- [ ] **Step 4: Implement composer queue, morph button, and chip**

Change `Composer` props:

```ts
function Composer(props: {
  readonly readOnly: boolean;
  readonly isFounder: boolean;
  readonly initialText?: string;
  readonly isSending: boolean;
  readonly sendError: string | null;
  readonly needsProvider: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: (queuedText: string | null) => void;
}) {
```

Add queue state after text state:

```ts
const [queuedText, setQueuedText] = useState<string | null>(null);
```

Replace `send` with:

```ts
const send = () => {
  if (props.readOnly) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  if (props.isSending) {
    setQueuedText(trimmed);
    setText("");
    return;
  }

  props.onSend(trimmed);
  setText("");
};
```

Add chip helpers:

```ts
const restoreQueuedText = () => {
  if (queuedText === null) return;
  setText(queuedText);
  setQueuedText(null);
};

const discardQueuedText = () => setQueuedText(null);

const stop = () => {
  props.onStop(queuedText);
  setQueuedText(null);
};
```

Change the action button:

```tsx
<button
  aria-label={props.isSending ? "Stop generating" : "Send"}
  className="chatd-send"
  disabled={props.readOnly || (!props.isSending && !text.trim())}
  title={props.isSending ? "Stop" : "Send"}
  type="button"
  onClick={props.isSending ? stop : send}
>
  {props.isSending ? (
    <Square size={15} aria-hidden="true" fill="currentColor" />
  ) : (
    <ArrowUp size={17} aria-hidden="true" />
  )}
</button>
```

Render the chip directly below `.chatd-input`:

```tsx
{
  queuedText !== null ? (
    <div className="chatd-next" aria-live="polite">
      <button
        aria-label="Edit queued message"
        className="chatd-next__text"
        type="button"
        onClick={restoreQueuedText}
      >
        Next: &quot;{queuedText}&quot;
      </button>
      <button
        aria-label="Discard queued message"
        className="chatd-next__x"
        title="Discard queued message"
        type="button"
        onClick={discardQueuedText}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  ) : null;
}
```

- [ ] **Step 5: Add chip styles**

Add below the `.chatd-send:disabled` rule in `apps/web/src/styles/kit-chat.css`:

```css
.chatd-next {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--text-subtle);
}
.chatd-next__text {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  color: inherit;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12.5px;
  line-height: 1.35;
  overflow: hidden;
  padding: 6px 8px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chatd-next__text:hover {
  border-color: var(--border);
  color: var(--text);
}
.chatd-next__x {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-subtle);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.chatd-next__x:hover {
  background: var(--surface-2);
  color: var(--text);
}
```

- [ ] **Step 6: Run focused test to verify pass**

Run:

```bash
pnpm exec playwright test tests/e2e/chat-drawer.spec.ts --project=chromium -g "stages next message"
```

Expected: PASS.

- [ ] **Step 7: Run relevant regression file**

Run:

```bash
pnpm exec playwright test tests/e2e/chat-drawer.spec.ts --project=chromium
```

Expected: PASS.

- [ ] **Step 8: Run required local gate**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit scoped files**

Run:

```bash
git add apps/web/src/chat/chat-drawer.tsx apps/web/src/styles/kit-chat.css tests/e2e/chat-drawer.spec.ts docs/superpowers/plans/2026-06-25-chat-composer-stop-queue.md
git commit -m "feat: queue next chat message after stop" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Expected: commit succeeds with only this spec's files staged.

## Self-Review

- Spec coverage: send arrow morphs to Stop, textarea remains editable, Enter stages one queued message, second Enter replaces it, Stop drains after cancel settles, idle Enter remains through same `send()` path, Shift+Enter remains browser newline because `onKeyDown` ignores shift, chip restores/discards, and old separate Stop button is removed.
- Placeholder scan: no `TBD`, `TODO`, or "implement later" placeholders.
- Type consistency: `queuedText` is local composer state; `drainAfterStopText` is parent-only state; `onStop` carries `string | null`.
