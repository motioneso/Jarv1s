# Memory Distillation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat chat fact extraction with source-backed memory distillation candidates and safe auto-promotion into graph memory.

**Architecture:** Keep existing queue name `chat.extract-facts`, but make payload turn-specific with user/assistant message ids. Add one owner-scoped candidate table/repository, move chat-side parsing/gating/promotion into `packages/chat/src/memory-distillation.ts`, and write graph memory only through `MemoryGraphRepository`.

**Tech Stack:** TypeScript, Vitest, Kysely `sql`, DataContextDb, pg-boss, existing AI capability router, existing memory graph repository.

---

## Verified Current State

- `packages/chat/src/jobs.ts` still has flat `handleExtractFactsJob(scopedDb, ownerUserId, threadId, deps)` and `ExtractFactsJobPayload` only carries `threadId`.
- `packages/chat/src/live/persistence.ts` enqueues embed + extract only when `!thread.incognito`; extract payload needs `userMessageId` and `assistantMessageId`.
- `packages/memory/sql/0118_memory_graph_substrate.sql` exists; `packages/memory/sql/0119_memory_candidates.sql` does not.
- `packages/memory/src/candidates-repository.ts` and `packages/chat/src/memory-distillation.ts` do not exist.
- Export/delete enumerate graph tables but not candidates.

## Files

- Create: `packages/memory/sql/0119_memory_candidates.sql`
- Create: `packages/memory/src/candidates-repository.ts`
- Create: `packages/chat/src/memory-distillation.ts`
- Modify: `packages/memory/src/index.ts`
- Modify: `packages/memory/src/manifest.ts`
- Modify: `packages/chat/src/jobs.ts`
- Modify: `packages/chat/src/live/persistence.ts`
- Modify: `packages/settings/src/data-export.ts`
- Modify: `scripts/delete-user-data.ts`
- Modify: `tests/integration/foundation.test.ts`
- Modify: `tests/integration/memory-graph.test.ts`
- Modify: `tests/integration/memory-graph-export-delete.test.ts`
- Modify: `tests/integration/chat-live.test.ts`
- Add or modify: `tests/unit/chat-memory-distillation.test.ts`

### Task 1: Candidate Store

**Files:**

- Create: `packages/memory/sql/0119_memory_candidates.sql`
- Create: `packages/memory/src/candidates-repository.ts`
- Modify: `packages/memory/src/index.ts`
- Modify: `packages/memory/src/manifest.ts`
- Modify: `tests/integration/foundation.test.ts`
- Modify: `tests/integration/memory-graph.test.ts`

- [ ] **Step 1: Write failing schema/repository tests**

Add `memory_candidates` to the graph table list in `tests/integration/memory-graph.test.ts` and add tests for owner-scoped uniqueness plus status preservation:

```ts
import { MemoryCandidatesRepository, createMemoryCandidateSignature } from "@jarv1s/memory";

it("dedupes candidates by owner-scoped signature and preserves resolved status", async () => {
  const repo = new MemoryCandidatesRepository();
  await appDataContext.withDataContext(
    { actorUserId: ids.userA, requestId: "memory-candidates:repo" },
    async (db) => {
      const signature = createMemoryCandidateSignature({
        kind: "fact",
        action: "create",
        fact: { subject: "Jarvis", predicate: "related_to", objectText: "memory distillation" }
      });
      const first = await repo.insertPending(db, ids.userA, {
        episodeId: null,
        kind: "fact",
        action: "create",
        payloadJson: { kind: "fact", action: "create" },
        candidateSignature: signature,
        confidence: 0.6,
        importance: 0.5,
        provenance: "inferred"
      });
      await repo.markRejected(db, ids.userA, first.id, "review rejected");
      const second = await repo.insertPending(db, ids.userA, {
        episodeId: null,
        kind: "fact",
        action: "create",
        payloadJson: { kind: "fact", action: "create" },
        candidateSignature: signature,
        confidence: 0.9,
        importance: 0.9,
        provenance: "volunteered"
      });

      expect(second.id).toBe(first.id);
      expect(second.status).toBe("rejected");
      expect(await repo.listPending(db, ids.userA, 10)).toEqual([]);
    }
  );
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm vitest run tests/integration/memory-graph.test.ts -t "memory_candidates|dedupes candidates"`

Expected: FAIL because table/repository exports do not exist.

- [ ] **Step 3: Add migration**

Create `0119_memory_candidates.sql` with:

```sql
CREATE TYPE app.memory_candidate_kind AS ENUM ('entity', 'fact', 'alias', 'supersession', 'conflict');
CREATE TYPE app.memory_candidate_action AS ENUM ('create', 'update', 'link', 'supersede', 'reject');
CREATE TYPE app.memory_candidate_status AS ENUM ('pending', 'promoted', 'rejected', 'merged', 'suppressed');

CREATE TABLE app.memory_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES app.memory_episodes(id) ON DELETE SET NULL,
  kind app.memory_candidate_kind NOT NULL,
  action app.memory_candidate_action NOT NULL,
  payload_json JSONB NOT NULL,
  candidate_signature TEXT NOT NULL,
  status app.memory_candidate_status NOT NULL DEFAULT 'pending',
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  importance NUMERIC(4,3) NOT NULL CHECK (importance >= 0 AND importance <= 1),
  provenance app.memory_fact_provenance NOT NULL,
  promotion_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (owner_user_id, candidate_signature)
);

ALTER TABLE app.memory_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_candidates FORCE ROW LEVEL SECURITY;

CREATE POLICY memory_candidates_owner_app ON app.memory_candidates
  FOR ALL TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY memory_candidates_owner_worker ON app.memory_candidates
  FOR ALL TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_candidates TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_candidates TO jarvis_worker_runtime;
```

Also add `{ version: "0119", name: "0119_memory_candidates.sql" }` to `tests/integration/foundation.test.ts`.

- [ ] **Step 4: Add repository**

Implement `MemoryCandidatesRepository` with `assertDataContextDb(scopedDb)`, `ON CONFLICT (owner_user_id, candidate_signature) DO UPDATE SET updated_at = app.memory_candidates.updated_at RETURNING *`, and methods from spec. Export repository + signature helper from `packages/memory/src/index.ts`; add `app.memory_candidates` to memory manifest `ownedTables`.

- [ ] **Step 5: Run test to verify GREEN**

Run: `pnpm vitest run tests/integration/memory-graph.test.ts -t "memory_candidates|dedupes candidates"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/memory/sql/0119_memory_candidates.sql packages/memory/src/candidates-repository.ts packages/memory/src/index.ts packages/memory/src/manifest.ts tests/integration/foundation.test.ts tests/integration/memory-graph.test.ts
git commit -m "feat(memory): add memory candidate store" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: Distillation Helpers

**Files:**

- Create: `packages/chat/src/memory-distillation.ts`
- Modify: `packages/chat/src/index.ts`
- Add: `tests/unit/chat-memory-distillation.test.ts`

- [ ] **Step 1: Write failing unit tests**

Cover:

- `shouldDistillTurn("hi", "hello") === false`
- explicit `remember`, preference, decision, correction phrases return true
- long concrete text with date/action returns true
- `parseMemoryCandidates("not json")` returns `[]`
- invalid shapes are rejected
- signature normalization collapses whitespace/case
- promotion decision promotes volunteered explicit command at `0.70`, leaves inferred/sensitive/commitment pending

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm vitest run tests/unit/chat-memory-distillation.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement helpers**

Implement exported types/functions:

```ts
export function shouldDistillTurn(userText: string, assistantText: string): boolean;
export function buildDistillationPrompt(input: BuildDistillationPromptInput): string;
export function parseMemoryCandidates(text: string): MemoryCandidate[];
export function decideCandidatePromotion(input: PromotionDecisionInput): PromotionDecision;
```

Keep helpers deterministic. Prompt must say discard credentials, tokens, passwords, OAuth data, financial account numbers; return JSON only.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm vitest run tests/unit/chat-memory-distillation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/memory-distillation.ts packages/chat/src/index.ts tests/unit/chat-memory-distillation.test.ts
git commit -m "feat(chat): add memory distillation helpers" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: Worker Integration And Promotion

**Files:**

- Modify: `packages/chat/src/jobs.ts`
- Modify: `packages/chat/src/live/persistence.ts`
- Modify: `tests/integration/chat-live.test.ts`

- [ ] **Step 1: Write failing integration tests**

Update existing `handleExtractFactsJob` tests to expect:

- metadata payload uses `threadId`, `userMessageId`, `assistantMessageId`
- handler loads those exact messages, not latest two
- social/noise turn skips adapter call and writes no candidate
- invalid JSON resolves without throwing
- high-confidence volunteered preference promotes through graph tables
- inferred candidate remains pending only
- correction supersedes only owner-scoped active graph fact id

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm test:chat`

Expected: FAIL on old payload/flat facts behavior.

- [ ] **Step 3: Implement minimal worker path**

In `ExtractFactsJobPayload`, add:

```ts
readonly userMessageId: string;
readonly assistantMessageId: string;
```

In `DataContextChatPersistence.recordTurn`, set those from `result.userMessage.id` and `result.assistantMessage.id`. In `handleExtractFactsJob`, call distillation helpers, insert candidates with `MemoryCandidatesRepository`, and auto-promote only allowed low-risk candidates through `MemoryGraphRepository.createEntity/createFact/addAlias` or `supersede`. Keep catch logger metadata-only.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm test:chat`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/jobs.ts packages/chat/src/live/persistence.ts tests/integration/chat-live.test.ts
git commit -m "feat(chat): wire memory distillation worker" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 4: Export/Delete Coverage

**Files:**

- Modify: `packages/settings/src/data-export.ts`
- Modify: `scripts/delete-user-data.ts`
- Modify: `tests/integration/memory-graph-export-delete.test.ts`

- [ ] **Step 1: Write failing export/delete test**

Extend `memory-graph-export-delete.test.ts` seed data with one user A and one user B candidate, then assert `userExport.tables.memoryCandidates` includes A only and delete counts/remove candidates for A only.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm vitest run tests/integration/memory-graph-export-delete.test.ts`

Expected: FAIL because export type/query/delete counts omit candidates.

- [ ] **Step 3: Add export/delete rows**

Add `memoryCandidates` to `UserDataExportTables`, `readExportTables`, and a `memoryCandidatesQuery(userId)` selecting no secrets beyond private candidate data already in DB. Add `["app.memory_candidates", "owner_user_id = $1::uuid"]` to `userScopedCountQueries`.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm vitest run tests/integration/memory-graph-export-delete.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/data-export.ts scripts/delete-user-data.ts tests/integration/memory-graph-export-delete.test.ts
git commit -m "feat(memory): include candidates in export deletion" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 5: Targeted Gate

**Files:** none unless fixes needed.

- [ ] **Step 1: Run targeted checks**

```bash
pnpm vitest run tests/unit/chat-memory-distillation.test.ts
pnpm test:chat
pnpm test:memory
pnpm vitest run tests/integration/memory-graph-export-delete.test.ts
pnpm lint
pnpm format:check
pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 2: Commit any test/fix fallout**

```bash
git status --short
git add <explicit changed paths>
git commit -m "fix(memory): stabilize distillation checks" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Skip commit if tree clean.

## Self-Review

- Acceptance criteria mapped: episode/candidate store in Tasks 1/3; social skip, parsing, signatures, promotion thresholds in Task 2; worker failure/no-block and exact message ids in Task 3; RLS/export/delete in Tasks 1/4.
- Out of scope preserved: no review UI, passive retrieval, commitment task creation, non-chat distillation, model-based meaningfulness classifier.
- Ponytail simplification: no new queue, no new service abstraction, no dashboard/API for pending candidates. Add review APIs only when #533 needs them.
