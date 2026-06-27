# Confidence-Aware Memory Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this coordinated build, do not use subagent-driven-development/executing-plans; drive steps inline after Coordinator approval.

**Goal:** Add #532 confidence-aware graph memory metadata, recall gates, phrasing labels, and correction/status flows without creating a second memory store.

**Architecture:** Extend existing `app.memory_facts` and `MemoryGraphRepository` contracts in place. Keep inactive/stale/conflict filtering in graph recall, keep prompt rendering pure in chat, and expose backend-only routes for confirm/correct/status/mark-stale.

**Tech Stack:** TypeScript, Fastify schemas, Kysely SQL, Postgres RLS, Vitest integration/unit tests.

---

## Verified Branch State

- Current branch already has #528 graph tables in `packages/memory/sql/0118_memory_graph_substrate.sql` and #529 candidates in `0119_memory_candidates.sql`.
- `app.memory_facts` has `confidence`, `provenance`, `status`, `valid_from`, `valid_to`, `last_confirmed_at`, but lacks `record_kind`, `stale_at`, `superseded_by_fact_id`, `conflict_group_id`, and `memory_conflict_groups`.
- `MemoryRecallItem` lacks `recordKind`, `status`, `confidenceTier`, `staleAt`, `supersededByFactId`, and `conflictGroupId`.
- Recall only supports `includeInactive`; it does not support stale/low-confidence gates or conflicting group expansion.
- Hidden context renderer already emits `<retrieved_context>` and neutralizes delimiters, but labels only provenance/confidence/source.
- Graph routes exist for recall/core/create/pin/supersede/delete; confirm/correct/status/mark-stale routes do not exist.
- Candidate promotion already preserves confidence/provenance, but does not set `recordKind` or conflict/supersession metadata.

## File Structure

- Modify `packages/memory/sql/0121_confidence_aware_memory_records.sql`: additive migration for metadata columns, conflict groups, indexes, checks, FORCE RLS, grants.
- Modify `packages/memory/src/manifest.ts`: add `app.memory_conflict_groups` to owned tables and route manifest entries.
- Modify `packages/memory/src/graph-types.ts`: add record kind/status/tier/options/correction/status DTOs.
- Modify `packages/memory/src/graph-repository.ts`: map new fields, create facts with record kind/timestamps, recall filters, confirm/correct/status/mark-stale, conflict resolution, search-doc activation.
- Modify `packages/memory/src/graph-recall-service.ts`: confidence tier helper, recall option gates, core-memory criteria, correction/status service methods.
- Modify `packages/memory/src/graph-routes.ts` and `packages/shared/src/memory-graph-api.ts`: expose route schemas and handlers.
- Modify `packages/chat/src/live/passive-retrieval.ts`: render status/kind/tier/provenance/source labels and conflict/stale phrasing guidance.
- Modify `packages/chat/src/jobs.ts`: map candidate fact predicate/kind to graph `recordKind`; keep auto-promotion thresholds unchanged.
- Modify `packages/settings/src/data-export.ts`: export new fact/conflict metadata.
- Modify tests: `tests/integration/memory-graph.test.ts`, `tests/integration/memory-graph-export-delete.test.ts`, `tests/unit/chat-passive-retrieval.test.ts`, `tests/unit/route-coverage.test.ts`.

## Task 1: Types, Tiers, Legacy Adapter

**Files:**

- Modify: `packages/memory/src/graph-types.ts`
- Test: add assertions in `tests/integration/memory-graph.test.ts`

- [ ] **Step 1: Write failing type-level/runtime assertions**

Add integration expectations after a graph fact is created:

```ts
expect(fact).toMatchObject({
  recordKind: "preference",
  confidenceTier: "confirmed",
  status: "active",
  staleAt: null,
  supersededByFactId: null,
  conflictGroupId: null
});
```

- [ ] **Step 2: Run focused test to confirm fail**

Run: `pnpm vitest run tests/integration/memory-graph.test.ts --testNamePattern "source-backed facts"`

Expected: FAIL because `recordKind`/`confidenceTier` are missing.

- [ ] **Step 3: Add minimal exported contracts**

Add:

```ts
export type MemoryRecordKind =
  | "fact"
  | "preference"
  | "goal"
  | "constraint"
  | "decision"
  | "relationship"
  | "alias"
  | "inference";
export type MemoryFactStatus =
  | "active"
  | "stale"
  | "expired"
  | "superseded"
  | "rejected"
  | "conflicting";
export type MemoryConfidenceTier = "confirmed" | "high" | "medium" | "low";
export interface MemoryRecallOptions {
  readonly limit?: number;
  readonly includeStale?: boolean;
  readonly includeInactive?: boolean;
  readonly includeLowConfidence?: boolean;
}
```

Extend fact/recall DTOs with `recordKind`, `confidenceTier`, `staleAt`, `supersededByFactId`, and `conflictGroupId`. Add `MemoryCorrectionInput` and `MemoryStatusPatchInput`.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`

Expected: FAIL at repository/service mappings, proving all call sites are found.

## Task 2: Schema Migration

**Files:**

- Create: `packages/memory/sql/0121_confidence_aware_memory_records.sql`
- Modify: `packages/memory/src/manifest.ts`
- Test: `tests/integration/memory-graph.test.ts`

- [ ] **Step 1: Write failing schema/RLS expectations**

Extend `graphTables` with `"memory_conflict_groups"` and assert `memory_facts` columns include:

```ts
expect(columns).toEqual(
  expect.arrayContaining([
    "record_kind",
    "stale_at",
    "superseded_by_fact_id",
    "conflict_group_id",
    "last_confirmed_at"
  ])
);
```

- [ ] **Step 2: Run migration test**

Run: `pnpm vitest run tests/integration/memory-graph.test.ts --testNamePattern "schema and RLS"`

Expected: FAIL because table/columns do not exist.

- [ ] **Step 3: Add additive migration**

Create `0121_confidence_aware_memory_records.sql` with:

```sql
CREATE TABLE IF NOT EXISTS app.memory_conflict_groups (
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY (owner_user_id, id)
);

ALTER TABLE app.memory_facts
  ADD COLUMN IF NOT EXISTS record_kind TEXT NOT NULL DEFAULT 'fact',
  ADD COLUMN IF NOT EXISTS stale_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_fact_id UUID,
  ADD COLUMN IF NOT EXISTS conflict_group_id UUID;
```

Add check constraints for allowed `record_kind` and expanded `status`; add owner-scoped composite FKs for `superseded_by_fact_id` and `conflict_group_id`; add indexes for owner/status/stale/conflict; enable/FORCE RLS and owner policy/grants for conflict groups.

- [ ] **Step 4: Register ownership**

Add `"app.memory_conflict_groups"` to `ownedTables`.

- [ ] **Step 5: Run schema/RLS test**

Expected: PASS.

## Task 3: Repository Metadata + Status Flows

**Files:**

- Modify: `packages/memory/src/graph-repository.ts`
- Test: `tests/integration/memory-graph.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests for:

```ts
await repo.confirmFact(db, ids.userA, fact.id);
await repo.patchFactStatus(db, ids.userA, fact.id, { status: "stale" });
await repo.correctFact(db, ids.userA, fact.id, { replacementText: "new value" });
```

Assert confirm raises confidence to `>= 0.9`, stale keeps search doc active, reject/expire/supersede deactivate search doc, correct creates replacement and marks old fact superseded.

- [ ] **Step 2: Run focused repository tests**

Run: `pnpm vitest run tests/integration/memory-graph.test.ts --testNamePattern "MemoryGraphRepository"`

Expected: FAIL because methods do not exist.

- [ ] **Step 3: Implement minimal repository methods**

Add methods:

```ts
confirmFact(scopedDb, ownerUserId, factId): Promise<MemoryFactRecord | undefined>
patchFactStatus(scopedDb, ownerUserId, factId, input): Promise<MemoryFactRecord | undefined>
markFactStale(scopedDb, ownerUserId, factId): Promise<MemoryFactRecord | undefined>
correctFact(scopedDb, ownerUserId, factId, input): Promise<MemoryFactRecord | undefined>
```

Use one transaction per operation through existing `scopedDb.db.transaction()`. Reject generic status changes when `conflict_group_id IS NOT NULL`. Update search document status in same transaction: active for active/stale, inactive for expired/rejected/superseded.

- [ ] **Step 4: Implement conflict resolution helpers**

Confirm on `conflicting` fact: target becomes active, siblings become superseded by target, target conflict cleared, group resolved. Correct on conflicting fact: replacement active, all group facts superseded by replacement, group resolved.

- [ ] **Step 5: Run repository tests**

Expected: PASS.

## Task 4: Recall/Core Gates

**Files:**

- Modify: `packages/memory/src/graph-repository.ts`
- Modify: `packages/memory/src/graph-recall-service.ts`
- Test: `tests/integration/memory-graph.test.ts`

- [ ] **Step 1: Write failing recall tests**

Add tests for:

```ts
await service.recall(db, ids.userA, "topic");
await service.recall(db, ids.userA, "topic", { includeStale: true });
await service.recall(db, ids.userA, "topic", { includeInactive: true });
await service.recall(db, ids.userA, "exact weak text", { includeLowConfidence: true });
```

Assert default recall excludes stale/expired/rejected/superseded/low-confidence, includes active/conflicting, treats `stale_at <= now()` and `valid_to <= now()` as inactive gates, and core memory only includes confirmed/high or pinned `>= 0.70`.

- [ ] **Step 2: Run recall tests**

Run: `pnpm vitest run tests/integration/memory-graph.test.ts --testNamePattern "GraphMemoryRecallService"`

Expected: FAIL due missing options/filtering.

- [ ] **Step 3: Implement filters**

Extend repository options to `includeStale/includeInactive/includeLowConfidence`. Join search docs with inactive docs only when `includeInactive`. Default statuses: `active`, `conflicting`; stale allowed only with `includeStale`; expired/rejected/superseded excluded unless `includeInactive`.

- [ ] **Step 4: Implement tier mapping and low-confidence gate**

Tier function:

```ts
confirmed = provenance === "confirmed" || (lastConfirmedAt && confidence >= 0.9);
high = confidence >= 0.8;
medium = confidence >= 0.6;
low = confidence < 0.6;
```

Exclude low confidence unless `includeLowConfidence` or pre-penalty direct keyword score `>= 0.85`.

- [ ] **Step 5: Run recall tests**

Expected: PASS.

## Task 5: Candidate Promotion Mapping

**Files:**

- Modify: `packages/chat/src/jobs.ts`
- Test: `tests/unit/chat-memory-distillation.test.ts`

- [ ] **Step 1: Write failing promotion test**

Assert promoted candidate with `predicate: "prefers"` creates graph fact with `recordKind: "preference"` and preserves confidence/provenance.

- [ ] **Step 2: Run focused test**

Run: `pnpm vitest run tests/unit/chat-memory-distillation.test.ts`

Expected: FAIL because `recordKind` is not passed.

- [ ] **Step 3: Add predicate mapping**

Add local helper:

```ts
function recordKindForCandidate(candidate: MemoryCandidate): MemoryRecordKind {
  if (candidate.kind === "alias") return "alias";
  switch (candidate.fact?.predicate) {
    case "prefers":
      return "preference";
    case "has_goal":
      return "goal";
    case "has_constraint":
      return "constraint";
    case "decided":
      return "decision";
    case "alias_of":
      return "alias";
    case "related_to":
      return "relationship";
    default:
      return candidate.provenance === "inferred" ? "inference" : "fact";
  }
}
```

Pass `recordKind` into `createFactFromEpisode`. Do not change `decideCandidatePromotion`.

- [ ] **Step 4: Run test**

Expected: PASS.

## Task 6: API Routes + Schemas

**Files:**

- Modify: `packages/shared/src/memory-graph-api.ts`
- Modify: `packages/memory/src/graph-routes.ts`
- Modify: `packages/memory/src/manifest.ts`
- Modify: `tests/unit/route-coverage.test.ts`
- Test: `tests/integration/memory-graph.test.ts`

- [ ] **Step 1: Write failing route tests**

Add route assertions for:

```ts
POST /api/memory/graph/facts/:id/confirm
POST /api/memory/graph/facts/:id/correct
POST /api/memory/graph/facts/:id/status
POST /api/memory/graph/facts/:id/mark-stale
```

Assert user A gets 404 on user B fact for each route.

- [ ] **Step 2: Run route tests**

Run: `pnpm vitest run tests/unit/route-coverage.test.ts tests/integration/memory-graph.test.ts --testNamePattern "routes|graph facts"`

Expected: FAIL because routes missing.

- [ ] **Step 3: Add schemas and handlers**

Add shared schemas with strict bodies:

```ts
correct: { replacementText: string, correctionReason?: string }
status: { status: "active" | "stale" | "expired" | "rejected", reason?: string }
mark-stale: {}
confirm: {}
```

Handlers call service/repository methods inside `withDataContext`; 404 when scoped update finds no row; 400 on generic conflict-group status rejection.

- [ ] **Step 4: Register manifest routes**

Add four `memory.manage` route entries.

- [ ] **Step 5: Run route tests**

Expected: PASS.

## Task 7: Hidden Context Rendering

**Files:**

- Modify: `packages/chat/src/live/passive-retrieval.ts`
- Test: `tests/unit/chat-passive-retrieval.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Assert a rendered item contains:

```txt
[preference status=active confidence=0.94 tier=confirmed provenance=confirmed source=chat:2026-06-26]
```

Assert stale text is prefixed with `This may be outdated:` and conflicting records render conflict wording instead of silently choosing.

- [ ] **Step 2: Run renderer test**

Run: `pnpm vitest run tests/unit/chat-passive-retrieval.test.ts --testNamePattern "renderRetrievedContextBlock"`

Expected: FAIL because labels are incomplete.

- [ ] **Step 3: Update pure renderer**

Keep existing cap/token/delimiter behavior. Build labels from `recordKind/status/confidence/tier/provenance/source`, include `stale_at/valid_to` when present, and add header line: `Phrase claims according to status and confidence.`

- [ ] **Step 4: Run renderer test**

Expected: PASS.

## Task 8: Export/Delete Coverage

**Files:**

- Modify: `packages/settings/src/data-export.ts`
- Modify: `tests/integration/memory-graph-export-delete.test.ts`

- [ ] **Step 1: Write failing export assertions**

Seed conflict group and new fact fields. Assert export contains `recordKind`, `staleAt`, `supersededByFactId`, `conflictGroupId`, `lastConfirmedAt`, and `memoryConflictGroups`.

- [ ] **Step 2: Run export/delete test**

Run: `pnpm vitest run tests/integration/memory-graph-export-delete.test.ts`

Expected: FAIL because new fields/table are absent.

- [ ] **Step 3: Add export query/table**

Add new columns to `memoryFactsQuery()` and new `memoryConflictGroupsQuery()`; ensure delete script already table-driven via owned tables, or add explicit delete/count list if needed.

- [ ] **Step 4: Run export/delete test**

Expected: PASS.

## Task 9: Final Gates + Commits

**Files:** all above.

- [ ] **Step 1: Run focused checks**

```bash
pnpm vitest run tests/unit/chat-passive-retrieval.test.ts tests/unit/chat-memory-distillation.test.ts tests/unit/route-coverage.test.ts
pnpm vitest run tests/integration/memory-graph.test.ts tests/integration/memory-graph-export-delete.test.ts
```

- [ ] **Step 2: Run required local gate**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:memory
pnpm test:chat
```

- [ ] **Step 3: Commit explicit paths only**

```bash
git add packages/memory/sql/0121_confidence_aware_memory_records.sql \
  packages/memory/src/manifest.ts packages/memory/src/graph-types.ts \
  packages/memory/src/graph-repository.ts packages/memory/src/graph-recall-service.ts \
  packages/memory/src/graph-routes.ts packages/shared/src/memory-graph-api.ts \
  packages/chat/src/live/passive-retrieval.ts packages/chat/src/jobs.ts \
  packages/settings/src/data-export.ts tests/integration/memory-graph.test.ts \
  tests/integration/memory-graph-export-delete.test.ts \
  tests/unit/chat-passive-retrieval.test.ts tests/unit/chat-memory-distillation.test.ts \
  tests/unit/route-coverage.test.ts
git commit -m "feat(memory): add confidence-aware memory records"
```

Commit body includes `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Self-Review

- Spec coverage: metadata, legacy compatibility via derived DTO mapping, candidate promotion, recall gates, hidden context, correction/status flows, RLS, export/delete, and owner isolation are covered.
- Deliberate skip: no dashboard UI; #533 owns it.
- Deliberate skip: no auto-promotion threshold changes; #532 forbids lowering them.
- Risk: conflict ranking rule can stay minimal in V1 by expanding matched conflict group siblings and preserving existing score order; add heavier slot arbitration only if tests/spec review demands it.
