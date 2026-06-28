# Relay R5 — rfa-541-data-freshness-visibility

**Date:** 2026-06-28  
**Branch:** `rfa-541-data-freshness-visibility`  
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-541-data-freshness-visibility`  
**Coordinator label:** `Coordinator`  
**PR:** #572 — https://github.com/motioneso/Jarv1s/pull/572

## Status

PR #572 is open, rebased on origin/main @ f6ebaf4d (#539 merged cleanly). Dual QA returned RED:

- **GLM RED**: test fix only (mechanical)
- **Codex RED**: same test + functional SSE/fallback fix

**Coordinator instruction:** Fix both, push, report done. Coordinator re-triggers dual QA after push.

## Two Fixes Required

### Fix 1 — Test assertion (mechanical, 2 lines)

**File:** `tests/unit/chat-session-manager-provenance.test.ts`, line 79–80

**Problem:** `recordTurn` 5th arg was changed from bare `answerProvenance?:
AnswerProvenanceMetadataV1` to `opts?: { invokedToolNames?, answerProvenance? }`. Test
destructures as `provenance` and asserts `toBeUndefined()` — but now it's an object.

**Current (broken):**

```ts
const [, , , , provenance] = calls[0] as unknown[];
expect(provenance).toBeUndefined();
```

**Fix:**

```ts
const [, , , , opts] = calls[0] as unknown[];
expect((opts as { answerProvenance?: unknown } | undefined)?.answerProvenance).toBeUndefined();
```

Also update the comment on line 78 from `// 5th arg is answerProvenance — undefined when no
retrieval configured` to `// 5th arg is opts — answerProvenance is undefined when no retrieval
configured`.

### Fix 2 — SSE events + fallback records missing sourceFreshness

**Problem:** The "reply" SSE event and the POST fallback record don't carry `sourceFreshness`, so
the `ChatFreshnessFooter` only renders after history reload (when `listChatThreadMessages` returns
`ChatMessageDto` which includes `sourceFreshness`).

**Key discovery:** `SendChatTurnResponse` in `packages/shared/src/chat-api.ts` line 89 **already
has `sourceFreshness?: SourceFreshnessV1 | null`** — the shared contract is ready. Need to wire
it through the backend and use it on the frontend.

**Chain of changes (all straightforward):**

#### A. `packages/chat/src/live/chat-session-manager.ts`

1. Update `ChatPersistencePort.recordTurn` return type (add `sourceFreshness?`):

```ts
): Promise<{
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly sourceFreshness?: SourceFreshnessV1 | null;
} | undefined>;
```

Need `import type { SourceFreshnessV1 } from "@jarv1s/shared"` in this file (check if already imported).

2. After `recordTurn` call in `runTurn`, emit a post-store reply SSE event:

```ts
const stored = await this.deps.persistence.recordTurn(...);
// ... existing code ...
// Post-store: re-emit reply with messageId + sourceFreshness so live UI picks it up
if (stored?.assistantMessageId && stored.sourceFreshness !== undefined) {
  this.emit(actorUserId, {
    kind: "reply",
    text: reply,
    messageId: stored.assistantMessageId,
    sourceFreshness: stored.sourceFreshness
  });
}
```

3. Return `sourceFreshness` from `runTurn`:

```ts
return {
  reply,
  userMessageId: stored?.userMessageId,
  assistantMessageId: stored?.assistantMessageId,
  sourceFreshness: stored?.sourceFreshness
};
```

#### B. `packages/chat/src/live/persistence.ts`

Return `sourceFreshness` from `recordTurn`:

```ts
// After computing sourceFreshness and calling recordCompletedTurn:
if (!result) return undefined;
return {
  userMessageId: result.userMessage.id,
  assistantMessageId: result.assistantMessage.id,
  sourceFreshness
};
```

Currently the function returns `result` directly after `recordCompletedTurn` — find the return
statement for the stored result and add `sourceFreshness`.

#### C. `packages/chat/src/live/types.ts`

Add `sourceFreshness?` to `TranscriptRecord` so the backend can include it in emitted SSE events:

```ts
import type { SourceFreshnessV1 } from "@jarv1s/shared";

export interface TranscriptRecord {
  // ... existing fields ...
  readonly sourceFreshness?: SourceFreshnessV1 | null;
}
```

#### D. `packages/chat/src/routes.ts`

The `submitTurn` call returns `{ reply, userMessageId, assistantMessageId }`. Add `sourceFreshness`
to the POST response. Look for the route handler for `POST /api/chat/turn` — it calls
`session.submitTurn(...)` and returns the result. The return now needs to include
`stored?.sourceFreshness`.

Also verify `serializeTurnResponse` (or equivalent) serializes `sourceFreshness`. The Fastify
schema for the chat turn response may need `sourceFreshness` added — check `packages/shared/src/chat-api-schema.ts` (the Fastify schema file, if it exists) or the inline schema in routes.

Check line ~247 in `packages/shared/src/chat-api.ts` — there's already a `sourceFreshness` schema
entry there.

#### E. `apps/web/src/chat/use-chat-stream.ts`

1. Parse `sourceFreshness` in `parseRecord` (after the `outcome` field):

```ts
sourceFreshness:
  parsed.sourceFreshness && typeof parsed.sourceFreshness === "object"
    ? (parsed.sourceFreshness as SourceFreshnessV1)
    : undefined,
```

Or use `readSourceFreshness` from routes — but that's in the backend. Use a simple inline parse or
import from a shared util. The type is already imported at the top of the file.

2. Update `setRecords` to replace the in-flight reply (no messageId) with the stored reply (has
   messageId + sourceFreshness):

```ts
source.onmessage = (event) => {
  const record = parseRecord(event.data);
  if (record) {
    setRecords((current) => {
      if (record.kind === "reply" && record.messageId) {
        // Replace the last streaming reply (which has no messageId) with the stored version
        const lastUnstored = [...current]
          .reverse()
          .findIndex((r) => r.kind === "reply" && !r.messageId);
        if (lastUnstored !== -1) {
          const realIdx = current.length - 1 - lastUnstored;
          return current.map((r, i) => (i === realIdx ? record : r));
        }
      }
      return [...current, record];
    });
  }
};
```

#### F. `apps/web/src/chat/chat-drawer.tsx`

Include `sourceFreshness` in the fallback reply record:

```ts
const postResponseRecords: readonly TranscriptRecord[] = [
  { kind: "user", text: trimmed, messageId: result.userMessageId },
  {
    kind: "reply",
    text: result.reply,
    messageId: result.assistantMessageId,
    sourceFreshness: result.sourceFreshness
  }
];
```

`result` is `SendChatTurnResponse` which already has `sourceFreshness?` in the shared type.

## What is Done

All tasks 7–11 complete + committed + pushed. PR #572 open, rebased on main. Gate VF_EXIT=0
(second run; first had transient notes PG flake).

Commits on branch (newest first):

- `9bf53a88` docs: add spec and plan for rfa-541
- `3b5df3a9` fix(freshness): apply lint and format fixes (tasks 7-11)
- `9b90d818` feat(freshness): add ChatFreshnessFooter (#541)
- `45ad6be3` feat(freshness): add BriefingFreshnessList and BriefingStaleBanner (#541)
- `da7ec26d` feat(freshness): wire connectorSyncAt and vaultLastWriteAt (#541)
- `917e9345` feat(freshness): collect tool names and compute chat sourceFreshness (#541)
- `358c0b19` test(freshness): add failing unit tests for chat freshness persistence (#541)
- `01329e66` feat(freshness): add sourceFreshness to ChatMessageDto (#541)
- `d5c477a9` feat(freshness): populate sourceTimestamps in briefing sourceMetadata (#541)
- `cee97b4b` feat(freshness): add resolveBriefingFreshness resolver (#541)

## After Fixing

1. Run: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:unit`
2. Commit as: `fix(freshness): wire sourceFreshness through SSE and fallback records (#541)`
3. Push: `git push`
4. Message coordinator (label: `Coordinator`) via herdr-pane-message:
   `[R5-541] Both QA fixes applied: test assertion + SSE/fallback sourceFreshness wiring. PR #572 pushed. Gate: [exit codes]. Ready for dual QA re-trigger.`

## Collision Note

#539 already merged. Our rebase on f6ebaf4d resolved all conflicts. `answerProvenance` (#539) +
`sourceFreshness` (this PR) are in the same `opts` object in `recordTurn`. Both are preserved.

## Spec

`docs/superpowers/specs/2026-06-28-data-freshness-visibility.md`
