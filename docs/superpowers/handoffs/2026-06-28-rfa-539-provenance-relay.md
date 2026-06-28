# Relay Handoff — rfa-539-source-backed-provenance

**Relay reason:** Compaction fired — tripwire.
**Branch:** `rfa-539-source-backed-provenance` (off origin/main @ 6835a9d0)
**Worktree:** `~/Jarv1s/.claude/worktrees/rfa-539-source-backed-provenance`
**Coordinator label:** `Coordinator` (session `5e1a6b62-a480-4b5c-9706-e476cfe77044`)
**Coordinator pane:** `w1:p59`
**GitHub issue:** #539

---

## State

**Plan written and committed:** `docs/superpowers/plans/2026-06-28-source-backed-provenance.md`
Commit: `201195ff`

**Spec placed on branch:** `docs/superpowers/specs/2026-06-28-source-backed-answers-provenance.md`
(copied from codex-539-540 worktree; original name had 2026-06-27 prefix)

**Status:** Plan ready for coordinator approval. **No code written yet.** Waiting for approval before Task 1.

**Gate pending:** Message coordinator "plan ready for rfa-539-source-backed-provenance: docs/superpowers/plans/2026-06-28-source-backed-provenance.md. Approve, or flag a fork." Then STOP until approved.

---

## What was done

1. `pnpm install` (node_modules was missing, completed in ~1s via shared pnpm store)
2. Read handoff doc in full
3. Read spec in full from codex-539-540 worktree (spec not on branch yet — copied it)
4. Verified spec premises against branch files:
   - `ChatMessageDto` — confirmed NO provenance/sources field (spec premise valid)
   - `chat-session-manager.ts` — `engineText()` returns `Promise<string>` (need to extend to return items)
   - `passive-retrieval.ts` — `retrieve()` returns `Promise<string>`, items not exposed
   - `cross-tool-reasoning.ts` — `collectCrossToolContext()` returns `Promise<string>`, items not exposed
   - `persistence.ts` — `recordTurn()` has no provenance param
   - `repository.ts` — `recordCompletedTurn()` inserts `toolMetadata: { selectedTools: [] }` (no provenance)
   - `routes.ts` — `serializeMessage()` reads no provenance; no provenance routes
5. Wrote full 8-task TDD plan covering all 16 acceptance criteria
6. Committed plan + spec

---

## Critical things to know

### Collision notes (from handoff)
- **No migration** — metadata-only, stored in existing `chat_messages.tool_metadata` JSONB
- **Parallel in-flight: #538, #540, #541**. Share `packages/shared/src/chat-api.ts` with #541 (freshness fields). Use disjoint field names.
- **DO NOT touch:** `packages/people/`, `packages/ai/src/gateway/`, `packages/briefings/`
- **Limit to:** `packages/chat/src/live/`, `packages/shared/src/chat-api.ts`
- `docs/coordination/` is coordinator-only — never commit there

### Key architectural choices in the plan
1. **`answer-provenance.ts`** — new module in `packages/chat/src/live/`; central sanitizer, marker parser, converters, finalizer
2. **`engineText()` returns `{ text, pendingItems }`** — extended from `Promise<string>` to carry evidence
3. **`collectCrossToolContextAndItems()` + `retrieveWithItems()`** — new functions that return items alongside the existing string block (backward compat: existing `collectCrossToolContext` / `retrieve` still work)
4. **`answerProvenanceV1`** stored in `chat_messages.tool_metadata.answerProvenanceV1`
5. **`citationToken` never leaves the backend** — `AnswerSourceSupportCard` (API DTO) omits it
6. **`answerProvenanceCitedIds`** added to `ChatMessageDto` alongside `answerProvenance` so frontend can distinguish cited vs context-checked items
7. **Provenance routes** are read-only, scoped by `owner_user_id` check against `actorUserId` from request context
8. Dereference route V1 returns `unavailable` — no providers registered in this PR; source modules register providers in follow-up work

### Plan tasks summary
| Task | Files | Deliverable |
|------|-------|-------------|
| 1 | `packages/shared/src/chat-api.ts` | Types + `ChatMessageDto` update |
| 2 | `packages/chat/src/live/answer-provenance.ts` + `tests/unit/chat-answer-provenance.test.ts` | Core module (sanitizer, parser, converters, finalizer) |
| 3 | `passive-retrieval.ts` + `cross-tool-reasoning.ts` + tests | Expose evidence items |
| 4 | `chat-session-manager.ts` + test | Wire provenance through `engineText()` → `runTurn()` |
| 5 | `persistence.ts` + `repository.ts` | Persist `answerProvenanceV1` in DB |
| 6 | `routes.ts` + integration test | API routes + `serializeMessage` update |
| 7 | `apps/web/src/chat/answer-provenance.tsx` + `markdown-message.tsx` | Frontend chips + marker strip |
| 8 | Gate: format:check + lint + typecheck + vitest |

### MemoryRecallItem fields (from `packages/memory/src/graph-types.ts`)
```ts
interface MemoryRecallItem {
  kind: "entity" | "fact" | "episode";
  id, title, text, score, confidence
  confidenceTier: "confirmed" | "high" | "medium" | "low"
  provenance: "volunteered" | "inferred" | "confirmed" | "imported"
  validFrom, validTo, staleAt: Date | null
  sources: MemorySourceSummary[]  // sourceKind: MemoryEpisodeKind = "chat"|"note"|"task"|"email"|"calendar"|"manual"
}
```

### CrossToolEvidenceItem fields (from `packages/chat/src/live/cross-tool-reasoning.ts`)
```ts
interface CrossToolEvidenceItem {
  source: "notes" | "email" | "calendar" | "tasks"
  title, summary, sourceLabel, relevance: "high"|"medium"|"low"
  occurredAt?, startsAt?, dueAt?: string  // ISO
}
```

---

## First thing successor must do

1. `herdr pane list` — confirm EXACTLY ONE pane with label `Coordinator`
2. Message coordinator: "plan ready for rfa-539-source-backed-provenance: docs/superpowers/plans/2026-06-28-source-backed-provenance.md. Approve, or flag a fork."
3. WAIT for approval.
4. After approval: begin Task 1 of the plan (shared types in `packages/shared/src/chat-api.ts`).

---

## Hard invariants
- `actorUserId` from request context only — never from stored metadata or client payload
- Provenance never blocks a chat turn — all collection errors silently dropped
- Snippets/titles/labels: plain text only, sanitized, capped
- No cross-module internal imports (chat must not import memory/notes internals)
- `git add` only explicit paths — never `git add -A`
- Never touch `docs/coordination/`
- Never assume migration number (no migration needed here)
