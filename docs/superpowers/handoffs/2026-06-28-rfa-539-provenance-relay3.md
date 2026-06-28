# Relay Handoff — rfa-539-source-backed-provenance (R3→R4)

**Relay reason:** Context at 70% after Tasks 5–7 — proactive handoff before compaction.
**Branch:** `rfa-539-source-backed-provenance`
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-539-source-backed-provenance`
**Coordinator label:** `Coordinator` (session `fa1a543f-55a4-46a3-9c52-36b642aa0c62`)
**Coordinator pane:** `w1:p50` (re-resolve by label at run time — pane numbers reflow)
**GitHub issue:** #539

---

## State

**Plan:** `docs/superpowers/plans/2026-06-28-source-backed-provenance.md`
**Spec:** `docs/superpowers/specs/2026-06-28-source-backed-answers-provenance.md`

**Tasks completed (all committed and typechecked):**

- ✅ Task 1 — shared types + `ChatMessageDto` update (`df7f1db8`)
- ✅ Task 2 — `answer-provenance.ts` module + unit tests (`f95609c8`)
- ✅ Task 3 — `retrieveWithItems` + `collectCrossToolContextAndItems` + tests (`cf4370b9`)
- ✅ Task 4 — wire provenance into `ChatSessionManager.runTurn` (`f7b5e467`)
- ✅ Task 5 — persist `answerProvenanceV1` in `persistence.ts` + `repository.ts` (`9d2c0ad1`)
- ✅ Task 6 — chat provenance API routes + `serializeMessage` update (`f1b2bc4d`)
- ✅ Task 7 — frontend: `answer-provenance.tsx` + `markdown-message.tsx` (`1f8ed313`)

**Remaining:**

- [ ] Task 8 — full gate verification + cleanup (coordinated-wrap-up)

**Gate status after Task 7:**
- `pnpm typecheck` clean ✅
- `pnpm test:unit` → 169 files, 1176 tests pass ✅
- `tests/integration/chat-provenance-routes.test.ts` → 5 tests pass ✅

---

## What Task 8 must do

This is the full verification + PR gate. Run these in order:

```bash
pnpm format:check
# If fails: pnpm format && git add <changed files> && git commit -m "fix(chat): format cleanup (#539)"

pnpm lint
# Fix any errors

pnpm typecheck
# Expected: 0 errors

pnpm test:unit --reporter=dot
# Expected: all pass

pnpm vitest run tests/integration/chat-provenance-routes.test.ts
# Expected: 5 pass

pnpm test:chat
# Expected: no regressions

pnpm test:memory
# Expected: no regressions
```

Then invoke `coordinated-wrap-up` skill to push + open PR + report to coordinator.

---

## Key changes made in this session

### Task 5 (`packages/chat/src/repository.ts`, `packages/chat/src/live/persistence.ts`)
- `recordCompletedTurn` now accepts optional `answerProvenance?: AnswerProvenanceMetadataV1`
- Spreads as `{ answerProvenanceV1: answerProvenance }` into assistant message `tool_metadata`
- `DataContextChatPersistence.recordTurn` threads 5th arg through to repository

### Task 6 (`packages/chat/src/routes.ts`, `packages/chat/src/manifest.ts`)
- `serializeMessage` reads `answerProvenanceV1` from `tool_metadata` → populates `answerProvenance` (cards, `citationToken` stripped) + `answerProvenanceCitedIds`
- `GET /api/chat/messages/:messageId/provenance` → `{ cards: AnswerSourceSupportCard[] }`
- `GET /api/chat/messages/:messageId/provenance/:supportId/dereference` → V1 stub (returns `unavailable`)
- Both routes declared in `manifest.ts` with `chat.view` permission (required by route-coverage guard)

### Task 7 (`apps/web/src/chat/`)
- `answer-provenance.tsx` — `SourceChips` + `SourceTray` + `stripDisplayMarkers`
- `markdown-message.tsx` — strips `[[S1]]` markers, renders `<SourceChips>` below assistant body
- `use-chat-stream.ts` — added optional `answerProvenance` + `answerProvenanceCitedIds` to `TranscriptRecord`
- `chat-drawer.tsx` — populates provenance fields in `recordsFromMessages`; passes to `MarkdownMessage`

---

## Collision notes (unchanged)

- **No migration** — metadata-only, stored in `chat_messages.tool_metadata` JSONB
- **Parallel in-flight: #538, #540, #541**. Use disjoint fields. #541 touches `chat-api.ts` (`sourceFreshness` field — disjoint from ours). Second to merge needs rebase.
- **DO NOT touch:** `packages/people/`, `packages/ai/src/gateway/`, `packages/briefings/`
- `docs/coordination/` is coordinator-only — never commit there

## Hard invariants

- `actorUserId` from request context only — never from stored metadata or client payload
- Provenance never blocks a chat turn — all collection errors silently dropped
- Snippets/titles/labels: plain text only, sanitized, capped
- No cross-module internal imports
- `git add` only explicit paths — never `git add -A`
- Never touch `docs/coordination/`

---

## First thing successor (R4) must do

1. `herdr pane list` — confirm EXACTLY ONE pane with label `Coordinator`
2. Message coordinator: "[RFA-539-R4] continuing Task 8 (full gate + wrap-up). Plan already approved."
3. Run the gate sequence above
4. Invoke `coordinated-wrap-up` skill
