# Relay Handoff — rfa-539-source-backed-provenance (R2→R3)

**Relay reason:** Context at 70% after Tasks 1–4 — proactive handoff before compaction.
**Branch:** `rfa-539-source-backed-provenance`
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-539-source-backed-provenance`
**Coordinator label:** `Coordinator` (session `5e1a6b62-a480-4b5c-9706-e476cfe77044`)
**Coordinator pane:** `w1:p59`
**GitHub issue:** #539

---

## State

**Plan:** `docs/superpowers/plans/2026-06-28-source-backed-provenance.md`
**Spec:** `docs/superpowers/specs/2026-06-28-source-backed-answers-provenance.md`

**Tasks completed (all committed):**

- ✅ Task 1 — shared types + `ChatMessageDto` update (`df7f1db8`)
- ✅ Task 2 — `answer-provenance.ts` module + unit tests (`f95609c8`)
- ✅ Task 3 — `retrieveWithItems` + `collectCrossToolContextAndItems` + tests (`cf4370b9`)
- ✅ Task 4 — wire provenance into `ChatSessionManager.runTurn` (`f7b5e467`)

**Remaining:**

- [ ] Task 5 — persist `answerProvenanceV1` in `persistence.ts` + `repository.ts`
- [ ] Task 6 — chat provenance API routes + `serializeMessage` update
- [ ] Task 7 — frontend: `answer-provenance.tsx` + `markdown-message.tsx`
- [ ] Task 8 — full gate verification + cleanup

**Gate status:** `pnpm typecheck` clean, 60 unit tests passing after Task 4.

---

## What was done (this session)

1. Read coordinator approval, began Task 1.
2. **Task 1:** Added `AnswerProvenanceSourceKind`, `AnswerProvenanceState`, `AnswerSourceSupport`, `AnswerSourceSupportCard`, `AnswerProvenanceMetadataV1`, `AnswerProvenanceProvider`, `AnswerProvenanceDereference` types + optional `answerProvenance` and `answerProvenanceCitedIds` fields to `ChatMessageDto` + updated `chatMessageSchema` in `packages/shared/src/chat-api.ts`.
3. **Task 2:** Created `packages/chat/src/live/answer-provenance.ts` with sanitizer, marker parser, converters (`crossToolItemToSupport`, `memoryItemToSupport`), finalizer, and DTO conversion. Created `tests/unit/chat-answer-provenance.test.ts` — 25 tests pass.
4. **Task 3:** Added `retrieveWithItems` method to `PassiveContextRetriever` and `collectCrossToolContextAndItems` function to `cross-tool-reasoning.ts`. Exported both from `packages/chat/src/index.ts`. Extended `tests/unit/chat-passive-retrieval.test.ts` and `tests/unit/chat-cross-tool-reasoning.test.ts` — 34 tests pass.
5. **Task 4:** In `chat-session-manager.ts`: added imports, updated `ChatPersistencePort.recordTurn` interface (optional 5th `answerProvenance`), added `retrieveWithItems?` to `PassiveRetrievalPort`, refactored `engineText()` to return `{ text, pendingItems }`, updated `runTurn()` to compute provenance and pass it to `recordTurn` when non-undefined. Created `tests/unit/chat-session-manager-provenance.test.ts` — 2 new tests pass; existing 57 pass.

---

## Critical things to know

### Collision notes (unchanged)

- **No migration** — metadata-only, stored in `chat_messages.tool_metadata` JSONB
- **Parallel in-flight: #538, #540, #541**. Use disjoint fields.
- **DO NOT touch:** `packages/people/`, `packages/ai/src/gateway/`, `packages/briefings/`
- **Limit to:** `packages/chat/src/live/`, `packages/shared/src/chat-api.ts`, `packages/chat/src/`, `apps/web/src/chat/`
- `docs/coordination/` is coordinator-only — never commit there

### Key decisions made

- `engineText()` now returns `{ text, pendingItems: AnswerSourceSupport[] }` — backward-compatible
- `recordTurn(...)` gets 5th arg only when non-undefined (preserves existing 4-arg tests)
- `PassiveRetrievalPort.retrieveWithItems` is **optional** (`?`) — backward-compatible
- `collectCrossToolContextAndItems` added alongside `collectCrossToolContext` (both exported)

### What Task 5 must do

In `packages/chat/src/live/persistence.ts`:

- Import `AnswerProvenanceMetadataV1` from `@jarv1s/shared`
- Update `recordTurn` signature to accept optional 5th `answerProvenance?: AnswerProvenanceMetadataV1`
- Pass `answerProvenance` through to `this.chat.recordCompletedTurn()`

In `packages/chat/src/repository.ts`:

- Find `recordCompletedTurn` — it currently inserts `toolMetadata: { selectedTools: [] }`
- Add optional `answerProvenance?: AnswerProvenanceMetadataV1` param
- Spread `answerProvenance` into `tool_metadata`: `{ selectedTools: [], ...(answerProvenance !== undefined ? { answerProvenanceV1: answerProvenance } : {}) }`

Then typecheck + run existing tests (no new test file needed per plan — just verify existing chat tests pass).

### What Task 6 must do

In `packages/chat/src/routes.ts`:

- Import `readStoredProvenance`, `provenanceCards` from `./live/answer-provenance.js`
- Import `AnswerSourceSupportCard` from `@jarv1s/shared`
- Update `serializeMessage` to call `readStoredProvenance` and `provenanceCards` and populate `answerProvenance` + `answerProvenanceCitedIds`
- Add 2 new GET routes: `/api/chat/messages/:messageId/provenance` and `/api/chat/messages/:messageId/provenance/:supportId/dereference`
- Create `tests/integration/chat-provenance-routes.test.ts` with auth and 404 tests

Check `routes.ts` for: `asRecord` helper (used for `tool_metadata` access), `handleRouteError`, `repository.getMessageById` (may need to add if missing).

### What Task 7 must do

Create `apps/web/src/chat/answer-provenance.tsx` — `SourceChips` + `SourceTray` components.
Modify `apps/web/src/chat/markdown-message.tsx` — strip `[[S1]]` markers, render `<SourceChips>` below cited assistant messages.
Use `message.answerProvenanceCitedIds` as the `citedIds` prop (distinguishes cited from context-checked).

### Hard invariants

- `actorUserId` from request context only — never from stored metadata or client payload
- Provenance never blocks a chat turn — all collection errors silently dropped
- Snippets/titles/labels: plain text only, sanitized, capped
- No cross-module internal imports
- `git add` only explicit paths — never `git add -A`
- Never touch `docs/coordination/`
- Never assume migration number (no migration needed here)

---

## First thing successor must do

1. `herdr pane list` — confirm EXACTLY ONE pane with label `Coordinator`
2. Message coordinator: "[RFA-539-R3] continuing Tasks 5–8. No approval needed — plan already approved."
3. Begin Task 5 immediately (persistence.ts + repository.ts)
