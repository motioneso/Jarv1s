# Plan — 664: User message location when chatting with Jarvis

> **SUPERSEDED (2026-07-02):** The original "scroll visibility / setStickToBottom" root cause
> below is **WRONG** (user-corrected). Kept for history only — do NOT implement it. The
> revised, correct plan is in the "REVISED ROOT CAUSE" section at the bottom.

Issue #664. Risk tier: `routine` (pure UI/record-ordering, no chat lifecycle / API / RLS /
persistence touched).

## ❌ OLD (INVALID) ROOT CAUSE — scroll visibility

`apps/web/src/chat/chat-drawer.tsx`:

- `sendMessage` (line 179) sets `pendingUserText` (optimistic user bubble) on send. The
  optimistic record is appended at the END of `effectiveRecords` (line 238-244) — DOM order
  is correct (newest at bottom).
- Auto-scroll is gated by `stickToBottom` (line 263-267): `if (stickToBottom) scrollToLatest`.
- `stickToBottom` flips to `false` whenever the user scrolls >48px from the bottom.

**Invalidated.** The reported behavior is not a scroll problem.

---

## ✅ REVISED ROOT CAUSE — optimistic record spliced BEFORE fallback records

`apps/web/src/chat/chat-drawer.tsx`, lines 238-244:

```js
const effectiveRecords = reviewing
  ? displayRecords
  : [
      ...displayRecords, // SSE-delivered (props.records)
      ...(pendingUserText ? [{ kind: "user", text }] : []), // ⬅ optimistic: spliced HERE
      ...visibleFallbackRecords // ⬅ older POST fallbacks AFTER
    ];
```

`pendingUserText` (the optimistic just-sent bubble) is concatenated **before**
`visibleFallbackRecords`. Both are appended after `displayRecords` (the live SSE feed).

### Reproduction (send #2 while SSE lags)

1. Send #1. POST `/turn` resolves → `fallbackRecords = [user1, reply1]`,
   `pendingUserText = null`. SSE stream is slow / not yet delivered those records into
   `props.records`.
2. Send #2 before SSE has echoed `user1`/`reply1`. `pendingUserText = text2`.
3. `displayRecords` is empty (SSE lagging) →
   `effectiveRecords = [...[], pendingUser2, ...[user1, reply1]]`
   = **`[user2, user1, reply1]`**.
4. The just-sent `user2` bubble renders at the **top** (first / very-top position) — exactly
   the reported bug: "optimistic pending user message renders at very top / first-message
   position until Jarvis responds."
5. When SSE finally delivers, `displayRecords` grows and the fallbacks get filtered by
   `visibleFallbackRecords` (text+kind dedup); records settle into correct chronological
   order. Hence "then moves into correct chronological location with assistant reply."

The optimistic record is the **newest** item, so it must be appended **last** — after the
(older) fallback records.

### Why groupRecords / sort keys are NOT the cause

`groupRecords` (line 542) preserves array order and only coalesces consecutive
behind-the-scenes (thinking/tool/status/action_result) records. There is no sort key
elsewhere; ordering is fully determined by the `effectiveRecords` array concatenation above.
`recordsFromMessages` (line 650) only runs in history-review mode (`reviewing`), which is
unaffected.

## Fix

Swap the concatenation order so the optimistic pending record is appended **after** the
(older) fallback records — i.e. last, where a newest message belongs.

`apps/web/src/chat/chat-drawer.tsx` lines 240-244, change:

```js
: [
    ...displayRecords,
    ...(pendingUserText ? [{ kind: "user" as const, text: pendingUserText }] : []),
    ...visibleFallbackRecords
  ];
```

to:

```js
: [
    ...displayRecords,
    ...visibleFallbackRecords,
    ...(pendingUserText ? [{ kind: "user" as const, text: pendingUserText }] : [])
  ];
```

One-line reorder. No new state, no new effect. Does NOT change:

- the optimistic record's existence or clearing logic (#399),
- `fallbackRecords` append/dedup,
- chat transport / turn lifecycle / SSE consumption,
- persistence, or
- `groupRecords` / `sameTranscriptRecord`.

## Tasks (TDD, commit green per task)

### Task 1 — failing test: send #2 renders AFTER fallback records, not at the top

File: `tests/e2e/chat-drawer.spec.ts`.

Add a Playwright test that reproduces the ordering bug:

1. `mockApi` + a controllable SSE stream + controllable POST `/turn`.
2. **Send #1:** POST resolves immediately with `reply1`; SSE is held (not yet delivering) so
   `props.records` stays empty and `fallbackRecords = [user1, reply1]`.
3. Before SSE delivers anything, **send #2** (POST held pending).
4. Assert DOM order: the first `.chatd-msg` / `.chatd-msg--me` bubble text is `user1` (the
   older fallback), NOT `user2`. Concretely assert that the `user2` bubble appears AFTER the
   `reply1` bubble in the rendered transcript (e.g. via `locator.boundingBox` y-ordering, or
   by asserting the ordered list of user-bubble texts equals `[user1, user2]`, not
   `[user2, user1]`).
5. This FAILS today (`[user2, user1, reply1]` → user2 on top) and PASSES after the fix
   (`[user1, reply1, user2]`).

### Task 2 — fix: append optimistic record last

File: `apps/web/src/chat/chat-drawer.tsx`, lines 240-244. Reorder as shown above. Commit
message: `fix(chat): place optimistic user message after fallback records (#664)`.

### Task 3 — focused gate

```
pnpm format:check && pnpm lint && pnpm typecheck
pnpm exec playwright test tests/e2e/chat-drawer.spec.ts
```

All green. (Broader gate at wrap-up.)

## Exit criteria

- New e2e test passes (proves correct ordering under SSE lag); existing chat-drawer e2e
  tests stay green.
- `format:check`, `lint`, `typecheck` clean.
- No changes outside `chat-drawer.tsx` (fix) and `chat-drawer.spec.ts` (test).

## Out of scope

- Streamed-record autoscroll / `stickToBottom` (the discarded plan).
- Server / repository / routes / RLS / persistence.
- Redesigning fallback vs SSE reconciliation.
