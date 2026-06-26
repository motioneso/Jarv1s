# Chat composer: stop button + queued next message (#479)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/apps/web/src/chat/chat-drawer.tsx` — `Composer` (line 579): send button
(`ArrowUp`) disabled while `isSending` (line 625); `send()` early-returns on `isSending` (line 594) so
Enter during a response is a no-op; `stopSending()` (line 172) calls `cancelChatTurn` and exists as a
separate `.chatd-stop` button in the streaming indicator; textarea is editable during sending (only
`readOnly` disables it). `pendingUserText` state (line 67) already optimistically shows a just-sent
user message — distinct concept (optimistic send echo), not a queue.

## 1. Decision

A clean composer state machine so the user can prepare the next message while Jarvis responds, with a
clear stop affordance. Four changes, all in `apps/web/src/chat/chat-drawer.tsx`:

1. **Send button → Stop button when responding.** The `ArrowUp` send button morphs into the existing
   Stop control (Square icon → `cancelChatTurn`) while `isSending`. No separate stop button in the
   streaming indicator (it moves into the send slot; the streaming indicator keeps its animation).
2. **Editable composer during response.** Already true (textarea isn't disabled by `isSending`) —
   keep it. Remove the `isSending` disable from the send button (it becomes Stop, which is enabled).
3. **Depth-1 queue.** Enter while `isSending` stages the typed text as the single queued "next
   message" (state: `queuedText`), clears the textarea, shows a **"Next: \<text\>"** chip below the
   composer. A second Enter while something is already queued updates the staged text (replaces, not
   appends — depth stays 1).
4. **Stop drains the queue.** Pressing Stop cancels the current response AND, if `queuedText` is set,
   immediately sends it (calls `onSend(queuedText)`, clears the queue). Stop with no queue just
   cancels (today's behavior).

## 2. State machine (full)

States are derived from `isSending` + `queuedText` + textarea `text`:

| `isSending` | `queuedText` | Send button renders as | Enter does | Textarea |
|---|---|---|---|---|
| false | — | Send (ArrowUp), enabled when `text.trim()` | sends `text`, clears | editable |
| true | null | **Stop** (Square), enabled | stages `text` → `queuedText`, clears textarea | editable |
| true | set | **Stop** (Square), enabled | updates `queuedText` from current `text`, clears textarea | editable (can revise the staged msg by typing + Enter) |

**Stop press:**
- `isSending && queuedText === null` → `cancelChatTurn()` only (today's behavior).
- `isSending && queuedText !== null` → `cancelChatTurn()` then `onSend(queuedText)` + clear queue.
  (The cancel's `try/finally` clears `isSending`; the queued send then runs as a normal turn. Order
  matters — cancel must settle before the next send starts, or `isSending` re-entrancy wedges — see
  the existing `try/finally` guard at line 121.)

**Edge cases (the issue's list):**
- **Empty input while responding** → Enter is a no-op (nothing to queue). Stop still cancels.
- **Stop with no queued message** → just cancels (above).
- **Keyboard parity:** Enter = stage (while sending) / send (while idle); Shift+Enter = newline
  always; the Stop button is click/tap; Esc is unchanged (whatever it does today — verify, don't
  alter). Click/tap on the Stop button == Enter-while-sending's drain path when a queue exists.
- **Send error mid-response** → `sendError` shows as today; the queued message is NOT auto-sent on
  error (only on explicit Stop). The user can dismiss the error and either Stop (drains queue) or
  edit.

## 3. The "Next: …" chip

Below the textarea, when `queuedText !== null`:
```
Next: "<queuedText>"  ×
```
- Click the chip text → restores `queuedText` into the textarea (so the user can edit), clears the
  queue (depth-1 means it's now back in the textarea, not double-staged).
- Click × → discards the queued message (clears `queuedText`).
- Subtle styling (reuse existing `chatd-*` classes), non-modal, doesn't block the textarea.

## 4. Relationship to `pendingUserText`

`pendingUserText` (existing) is the **optimistic echo** of a message already sent — it shows in the
chat record list until the real server record arrives (line 67-80). It is **not** the queue. The new
`queuedText` is a message **not yet sent** — it's the next turn, staged. Keep them distinct:

- `pendingUserText` = "sent, awaiting server confirmation" → shows in the record list.
- `queuedText` = "not sent, staged for after Stop" → shows as the composer chip, never in the record
  list.

When Stop drains the queue (`onSend(queuedText)`), the existing `sendMessage` flow sets
`pendingUserText` as usual — so a drained-queue message transitions cleanly: chip → record list echo
→ real record.

## 5. Acceptance criteria (from #479)

- [ ] During a response, the send arrow is replaced by a Stop button (same slot, not a second button).
- [ ] The textarea remains editable during a response.
- [ ] Enter during a response stages the typed text as a single queued message (clears textarea,
      shows "Next: …" chip). A second Enter updates the staged text, not appends.
- [ ] Stop with a queued message cancels the current response AND immediately sends the queued
      message. Stop with no queue just cancels.
- [ ] Existing idle send behavior (Enter to send, Shift+Enter newline) is unchanged.
- [ ] The chip is dismissable (×) and editable (click to restore to textarea).
- [ ] Keyboard parity: Enter/click-Stop behave consistently; Shift+Enter always newline.
- [ ] No re-entrancy wedge: cancel settles before the queued send starts.

## 6. Security & invariants

- Pure frontend state-machine change. No API, route, DB, or permission changes.
- No change to `cancelChatTurn` / the SSE stop path (line 170-176) — the existing cancel logic is
  reused as-is.
- The queued message is client-only state until sent; nothing is persisted until `onSend` runs.

## 7. Rollout / blast radius

- `apps/web/src/chat/chat-drawer.tsx` — `Composer` component: add `queuedText` state, morph
  send/stop button, Enter-while-sending stages, Stop-drains-queue, the chip. All changes localized
  to this file (the composer + its parent state for `isSending`/`stopSending`/`sendMessage` already
  wired).
- Possibly `apps/web/src/styles/*.css` — minor chip styling (reuse existing classes where possible).

No backend changes. No migrations. No new permissions. Fully reversible (frontend only).

## 8. Out of scope

- **Unbounded queue** (depth > 1) — explicitly depth-1 (turn-based coherence).
- **Editing an in-flight message** — once sent, a message can't be edited; only the queued (unsent)
  next message is editable.
- **Autosuggest / draft persistence** across drawer open/close — the queue lives in component state;
  closing the drawer discards it (matches today's textarea behavior — verify, don't assume).
- **Mobile keyboard affordances** beyond the existing composer's mobile handling.
