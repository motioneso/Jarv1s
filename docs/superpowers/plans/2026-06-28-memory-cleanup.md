# Memory Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six follow-up defects in the memory module — atomicity tests, supersession guard, self-entity 403, conflict routing, sourceRef privacy, and notes module-isolation violation.

**Architecture:** All changes are in `packages/memory/src/` (owned exclusively by this worktree) and `packages/notes/src/monitor-provider.ts`. No migrations needed. Every fix adds or extends an integration or unit test. The six tasks are independent and can land in any order, but Task 1 is tests-only (no production code changes). Atomicity comes free from `withDataContext`; the plan documents this and adds tests to prove it.

**Tech Stack:** TypeScript, Kysely, Fastify, Vitest, Postgres (via `@jarv1s/db` DataContextDb seam)

## Global Constraints

- Every repository method must receive `DataContextDb`; never accept a root `Kysely` instance.
- `assertDataContextDb(scopedDb)` at the top of every new method.
- All SQL uses `scopedDb.db` (the Kysely `Transaction` set by `withDataContext`).
- Never add admin bypass, cross-user access, or raw private field exposure.
- Error codes go on `(error as NodeJS.ErrnoException).code`; route handlers match on `.code`, never on message strings alone (except legacy patterns that already do).
- All test files use the existing integration-test bootstrap: `resetFoundationDatabase()`, `connectionStrings`, `ids` from `tests/integration/test-database.ts`.
- Run `pnpm format:check && pnpm lint && pnpm typecheck` before each commit.

---

### Task 1: #554 — Document and test transaction atomicity for confirmFact / correctFact / patchFactStatus

`withDataContext` (in `packages/db/src/data-context.ts`) wraps its callback in `this.rootDb.transaction().execute(...)`, so every SQL statement that uses `scopedDb.db` inside a route handler runs inside a single Postgres transaction. No structural code change is needed. This task adds a comment to document the guarantee and adds integration tests that prove any throw inside `withDataContext` rolls back all writes.

**Files:**

- Modify: `packages/memory/src/graph-repository.ts` (add class-level comment)
- Modify: `tests/integration/memory-graph.test.ts` (add atomicity tests)

**Interfaces:**

- Consumes: `MemoryGraphRepository`, `DataContextRunner.withDataContext`, existing test bootstrap
- Produces: nothing new (documentation + tests only)

- [ ] **Step 1: Add a short atomicity comment to `MemoryGraphRepository`**

  Open `packages/memory/src/graph-repository.ts`. Find the line:

  ```ts
  export class MemoryGraphRepository {
  ```

  Insert the comment immediately before it:

  ```ts
  // All multi-write methods (confirmFact, correctFact, patchFactStatus) assume the caller
  // provides a DataContextDb whose `.db` is already a Kysely Transaction — guaranteed by
  // withDataContext (packages/db/src/data-context.ts). If any write in the method throws,
  // the caller's transaction rolls back atomically. assertDataContextDb() enforces this seam.
  export class MemoryGraphRepository {
  ```

- [ ] **Step 2: Locate the right place in the test file**

  Open `tests/integration/memory-graph.test.ts`. Scroll to the end of the last `describe` block. Add a new block:

  ```ts
  describe("transaction atomicity", () => {
  ```

- [ ] **Step 3: Write failing tests for confirmFact, correctFact, patchFactStatus atomicity**

  Add these tests inside the new `describe` block. They simulate a failure AFTER each method's own writes complete but still within the same `withDataContext` transaction — proving the outer transaction is the rollback boundary.

  ```ts
  describe("transaction atomicity", () => {
    it("rolls back confirmFact writes when the outer withDataContext throws", async () => {
      const userId = ids.user1;
      // Setup: one active fact
      let factId!: string;
      await appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const repo = new MemoryGraphRepository();
        const self = await repo.ensureSelfEntity(scopedDb, userId);
        const result = await repo.createFact(scopedDb, userId, {
          subjectEntityId: self.id,
          predicate: "knows",
          objectText: "atomicity-test-confirm",
          recordKind: "fact",
          confidence: 0.8,
          provenance: "volunteered",
          importance: 1,
          pinned: false,
          source: {
            sourceKind: "manual",
            sourceRef: "test",
            sourceLabel: "Test",
            occurredAt: null,
            excerpt: ""
          }
        });
        factId = result.id;
      });

      // confirmFact succeeds internally but the outer callback throws → full rollback
      await expect(
        appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
          const repo = new MemoryGraphRepository();
          await repo.confirmFact(scopedDb, userId, factId);
          throw new Error("simulated mid-operation failure");
        })
      ).rejects.toThrow("simulated mid-operation failure");

      // Verify: fact is still in original state (provenance not changed to 'confirmed')
      const rows = await sql<{ provenance: string; confidence: string }>`
        SELECT provenance, confidence FROM app.memory_facts
        WHERE owner_user_id = ${userId}::uuid AND id = ${factId}::uuid
      `.execute(appDb);
      expect(rows.rows[0]?.provenance).toBe("volunteered");
      expect(Number(rows.rows[0]?.confidence)).toBeCloseTo(0.8, 2);
    });

    it("rolls back correctFact writes when the outer withDataContext throws", async () => {
      const userId = ids.user1;
      let factId!: string;
      await appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const repo = new MemoryGraphRepository();
        const self = await repo.ensureSelfEntity(scopedDb, userId);
        const result = await repo.createFact(scopedDb, userId, {
          subjectEntityId: self.id,
          predicate: "knows",
          objectText: "atomicity-test-correct-original",
          recordKind: "fact",
          confidence: 0.8,
          provenance: "volunteered",
          importance: 1,
          pinned: false,
          source: {
            sourceKind: "manual",
            sourceRef: "test",
            sourceLabel: "Test",
            occurredAt: null,
            excerpt: ""
          }
        });
        factId = result.id;
      });

      await expect(
        appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
          const repo = new MemoryGraphRepository();
          await repo.correctFact(scopedDb, userId, {
            targetFactId: factId,
            replacementText: "atomicity-test-correct-replacement"
          });
          throw new Error("simulated mid-operation failure");
        })
      ).rejects.toThrow("simulated mid-operation failure");

      // Verify: original fact NOT superseded, no replacement created
      const rows = await sql<{ id: string; status: string; object_text: string }>`
        SELECT id, status, object_text FROM app.memory_facts
        WHERE owner_user_id = ${userId}::uuid
          AND object_text IN ('atomicity-test-correct-original','atomicity-test-correct-replacement')
        ORDER BY created_at ASC
      `.execute(appDb);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.status).toBe("active");
      expect(rows.rows[0]?.object_text).toBe("atomicity-test-correct-original");
    });

    it("rolls back patchFactStatus writes when the outer withDataContext throws", async () => {
      const userId = ids.user1;
      let factId!: string;
      await appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const repo = new MemoryGraphRepository();
        const self = await repo.ensureSelfEntity(scopedDb, userId);
        const result = await repo.createFact(scopedDb, userId, {
          subjectEntityId: self.id,
          predicate: "knows",
          objectText: "atomicity-test-patch-status",
          recordKind: "fact",
          confidence: 0.8,
          provenance: "volunteered",
          importance: 1,
          pinned: false,
          source: {
            sourceKind: "manual",
            sourceRef: "test",
            sourceLabel: "Test",
            occurredAt: null,
            excerpt: ""
          }
        });
        factId = result.id;
      });

      await expect(
        appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
          const repo = new MemoryGraphRepository();
          await repo.patchFactStatus(scopedDb, userId, factId, { status: "stale" });
          throw new Error("simulated mid-operation failure");
        })
      ).rejects.toThrow("simulated mid-operation failure");

      // Verify: fact status unchanged (still active)
      const rows = await sql<{ status: string }>`
        SELECT status FROM app.memory_facts
        WHERE owner_user_id = ${userId}::uuid AND id = ${factId}::uuid
      `.execute(appDb);
      expect(rows.rows[0]?.status).toBe("active");
    });
  });
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  ```bash
  cd /home/ben/Jarv1s/.claude/worktrees/memory-cleanup
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts --reporter=verbose 2>&1 | tail -30
  ```

  Expected: the 3 new atomicity tests pass. If the database doesn't exist yet:

  ```bash
  docker exec jarv1s-postgres psql -U postgres -c 'CREATE DATABASE jarvis_build_memory_cleanup;'
  ```

  Then re-run.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/memory/src/graph-repository.ts tests/integration/memory-graph.test.ts
  git commit -m "test(memory): verify transaction atomicity via withDataContext rollback (#554)"
  ```

---

### Task 2: #555 — patchFactStatus: block reactivation of superseded records

**Files:**

- Modify: `packages/memory/src/graph-repository.ts` (add guard in `patchFactStatus`)
- Modify: `packages/memory/src/graph-routes.ts` (add error handler for new error code)
- Modify: `tests/integration/memory-graph.test.ts` (add regression test)

**Interfaces:**

- Consumes: `MemoryGraphRepository.patchFactStatus`, `handleMemoryGraphRouteError`
- Produces: `patchFactStatus` throws `{ code: "SUPERSEDED_REACTIVATION_BLOCKED" }` when attempting to set `status='active'` on a record with `superseded_by_fact_id IS NOT NULL`

- [ ] **Step 1: Write the failing regression test**

  In `tests/integration/memory-graph.test.ts`, add a new test inside (or after) an existing `describe` block — a new `describe("patchFactStatus guards", ...)` is cleanest:

  ```ts
  describe("patchFactStatus guards", () => {
    it("returns 400 when reactivating a superseded fact", async () => {
      const userId = ids.user1;

      // Create a fact, then supersede it via correctFact (which sets superseded_by_fact_id)
      let originalFactId!: string;
      await appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const repo = new MemoryGraphRepository();
        const self = await repo.ensureSelfEntity(scopedDb, userId);
        const fact = await repo.createFact(scopedDb, userId, {
          subjectEntityId: self.id,
          predicate: "knows",
          objectText: "original-fact-for-555",
          recordKind: "fact",
          confidence: 0.8,
          provenance: "volunteered",
          importance: 1,
          pinned: false,
          source: {
            sourceKind: "manual",
            sourceRef: "test",
            sourceLabel: "Test",
            occurredAt: null,
            excerpt: ""
          }
        });
        originalFactId = fact.id;
        await repo.correctFact(scopedDb, userId, {
          targetFactId: originalFactId,
          replacementText: "replacement-fact-for-555"
        });
      });

      // Now try to reactivate the superseded fact via the route
      const response = await graphServer.inject({
        method: "POST",
        url: `/api/memory/graph/facts/${originalFactId}/status`,
        headers: { "x-test-user-id": userId },
        payload: { status: "active" }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toMatch(/superseded/i);
    });
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts -t "reactivating a superseded" 2>&1 | tail -20
  ```

  Expected: FAIL — currently returns 200 or 204, not 400.

- [ ] **Step 3: Add the guard in `patchFactStatus`**

  Open `packages/memory/src/graph-repository.ts`. Find `patchFactStatus` starting at the line:

  ```ts
  async patchFactStatus(
  ```

  The method currently reads:

  ```ts
  const existing = await this.getFact(scopedDb, ownerUserId, factId);
  if (!existing) return undefined;
  if (existing.conflictGroupId) {
    throw new Error("conflict-group memory must be resolved with confirm or correct");
  }
  ```

  Add the supersession guard immediately after the `conflictGroupId` check:

  ```ts
  if (existing.supersededByFactId != null && input.status === "active") {
    throw Object.assign(
      new Error("Cannot reactivate a superseded memory record; create a new fact instead"),
      { code: "SUPERSEDED_REACTIVATION_BLOCKED" }
    );
  }
  ```

- [ ] **Step 4: Add the error handler in `graph-routes.ts`**

  Open `packages/memory/src/graph-routes.ts`. Find `handleMemoryGraphRouteError`. It currently ends with:

  ```ts
  if (error instanceof Error && error.message.includes("conflict-group memory")) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
  ```

  Add before `throw error`:

  ```ts
  if (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "SUPERSEDED_REACTIVATION_BLOCKED"
  ) {
    return reply.code(400).send({ error: error.message });
  }
  ```

- [ ] **Step 5: Run the test to verify it passes**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts -t "reactivating a superseded" 2>&1 | tail -20
  ```

  Expected: PASS.

- [ ] **Step 6: Run format check + lint + typecheck**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  ```

  Fix any issues before committing.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/memory/src/graph-repository.ts packages/memory/src/graph-routes.ts \
    tests/integration/memory-graph.test.ts
  git commit -m "fix(memory): block reactivation of superseded facts in patchFactStatus (#555)"
  ```

---

### Task 3: #560 — Self-entity delete/forget returns 403

**Files:**

- Modify: `packages/memory/src/graph-dashboard-repository.ts` (add self-entity guard in `forgetEntity`)
- Modify: `packages/memory/src/dashboard-routes.ts` (add error handler for new error code → 403)
- Modify: `tests/integration/memory-graph.test.ts` (add integration test)

**Interfaces:**

- Consumes: `MemoryGraphDashboardRepository.forgetEntity`, `handleDashboardRouteError`
- Produces: `forgetEntity` throws `{ code: "SELF_ENTITY_PROTECTED" }` when the target entity has `kind = 'self'`; route returns HTTP 403

- [ ] **Step 1: Write the failing test**

  In `tests/integration/memory-graph.test.ts`, add:

  ```ts
  describe("entity delete guards", () => {
    it("returns 403 when deleting the self entity", async () => {
      const userId = ids.user1;

      // Ensure the self entity exists
      let selfEntityId!: string;
      await appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const repo = new MemoryGraphRepository();
        const self = await repo.ensureSelfEntity(scopedDb, userId);
        selfEntityId = self.id;
      });

      const response = await dashboardServer.inject({
        method: "DELETE",
        url: `/api/memory/graph/entities/${selfEntityId}`,
        headers: { "x-test-user-id": userId }
      });

      expect(response.statusCode).toBe(403);
    });
  });
  ```

  Note: the test uses `dashboardServer`. You need to set one up in `beforeAll` if not present. Check if `memory-graph.test.ts` already registers dashboard routes — if not, add:

  ```ts
  let dashboardServer: FastifyInstance;
  // in beforeAll:
  dashboardServer = Fastify();
  registerMemoryDashboardRoutes(dashboardServer, {
    dataContext: appDataContext,
    resolveAccessContext
  });
  await dashboardServer.ready();
  // in afterAll:
  await dashboardServer?.close();
  ```

  Import `registerMemoryDashboardRoutes` from `@jarv1s/memory` (already exported in `index.ts`).

- [ ] **Step 2: Run to verify it fails**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts -t "deleting the self entity" 2>&1 | tail -20
  ```

  Expected: FAIL — currently returns 409 (fact-count check fires) or 404.

- [ ] **Step 3: Add self-entity guard in `forgetEntity`**

  Open `packages/memory/src/graph-dashboard-repository.ts`. Find `forgetEntity`. It starts with:

  ```ts
  async forgetEntity(
    scopedDb: DataContextDb,
    ownerUserId: string,
    entityId: string
  ): Promise<{ deleted: boolean; blockedByFacts: boolean }> {
    assertDataContextDb(scopedDb);

    const factCount = await sql<{ cnt: string }>`
  ```

  Insert a self-entity check BEFORE the factCount query:

  ```ts
  async forgetEntity(
    scopedDb: DataContextDb,
    ownerUserId: string,
    entityId: string
  ): Promise<{ deleted: boolean; blockedByFacts: boolean }> {
    assertDataContextDb(scopedDb);

    const entityResult = await sql<{ kind: string }>`
      SELECT kind FROM app.memory_entities
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND id = ${entityId}::uuid
    `.execute(scopedDb.db);
    if (entityResult.rows[0]?.kind === "self") {
      throw Object.assign(new Error("Cannot delete the self entity"), {
        code: "SELF_ENTITY_PROTECTED"
      });
    }

    const factCount = await sql<{ cnt: string }>`
  ```

- [ ] **Step 4: Add the error handler in `dashboard-routes.ts`**

  Open `packages/memory/src/dashboard-routes.ts`. Find `handleDashboardRouteError`. It currently ends with:

  ```ts
  if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EMPTY_OBJECT_TEXT") {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
  ```

  Add before `throw error`:

  ```ts
  if (error instanceof Error && (error as NodeJS.ErrnoException).code === "SELF_ENTITY_PROTECTED") {
    return reply.code(403).send({ error: error.message });
  }
  ```

- [ ] **Step 5: Run the test to verify it passes**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts -t "deleting the self entity" 2>&1 | tail -20
  ```

  Expected: PASS.

- [ ] **Step 6: Run format check + lint + typecheck**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add packages/memory/src/graph-dashboard-repository.ts \
    packages/memory/src/dashboard-routes.ts \
    tests/integration/memory-graph.test.ts
  git commit -m "fix(memory): return 403 when deleting self-entity via dashboard route (#560)"
  ```

---

### Task 4: #561 — acceptCandidate must route conflicts via correction path

When the user accepts a candidate, if an active fact already exists with the same subject-entity and predicate, the accept must call `correctFact` instead of creating a second active fact.

**Files:**

- Modify: `packages/memory/src/graph-repository.ts` (add `listActiveFactsBySubjectPredicate`)
- Modify: `packages/memory/src/dashboard-service.ts` (add conflict check in `acceptCandidate`)
- Modify: `tests/integration/memory-graph.test.ts` (add test)

**Interfaces:**

- Consumes: `MemoryGraphRepository`, `GraphMemoryRecallService.correct`
- Produces:
  - `MemoryGraphRepository.listActiveFactsBySubjectPredicate(scopedDb, ownerUserId, subjectEntityId, predicate): Promise<{ id: string }[]>` — returns active facts matching subject + predicate
  - `acceptCandidate` routes through `this.recallSvc.correct` when a conflict exists

- [ ] **Step 1: Write the failing test**

  In `tests/integration/memory-graph.test.ts`, add:

  ```ts
  describe("acceptCandidate conflict routing", () => {
    it("supersedes an existing active fact when accepting a conflicting candidate", async () => {
      const userId = ids.user1;

      // Create an existing active fact
      let existingFactId!: string;
      await appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const repo = new MemoryGraphRepository();
        const self = await repo.ensureSelfEntity(scopedDb, userId);
        const fact = await repo.createFact(scopedDb, userId, {
          subjectEntityId: self.id,
          predicate: "prefers",
          objectText: "original preference",
          recordKind: "preference",
          confidence: 0.8,
          provenance: "volunteered",
          importance: 1,
          pinned: false,
          source: {
            sourceKind: "manual",
            sourceRef: "test",
            sourceLabel: "Test",
            occurredAt: null,
            excerpt: ""
          }
        });
        existingFactId = fact.id;
      });

      // Create a pending candidate with the same predicate
      let candidateId!: string;
      await appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const candidatesRepo = new MemoryCandidatesRepository();
        const sig = createMemoryCandidateSignature({
          kind: "fact",
          predicate: "prefers",
          objectText: "updated preference"
        });
        candidateId = await candidatesRepo.createOrIgnore(scopedDb, userId, {
          kind: "fact",
          confidence: 0.9,
          provenance: "inferred",
          isSensitive: false,
          action: "add",
          supersedesIds: [],
          signatureHash: sig,
          payloadJson: {
            kind: "fact",
            fact: {
              predicate: "prefers",
              objectText: "updated preference",
              recordKind: "preference"
            }
          }
        });
      });

      // Accept the candidate — should route via correction path
      const response = await dashboardServer.inject({
        method: "POST",
        url: `/api/memory/candidates/${candidateId}/accept`,
        headers: { "x-test-user-id": userId },
        payload: {}
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { accepted: boolean };
      expect(body.accepted).toBe(true);

      // Verify: original fact is now superseded, NOT still active
      const rows = await sql<{ id: string; status: string }>`
        SELECT id, status FROM app.memory_facts
        WHERE owner_user_id = ${userId}::uuid
          AND predicate = 'prefers'
        ORDER BY created_at ASC
      `.execute(appDb);

      const original = rows.rows.find((r) => r.id === existingFactId);
      expect(original?.status).toBe("superseded");

      const replacement = rows.rows.find((r) => r.id !== existingFactId);
      expect(replacement?.status).toBe("active");
    });
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts -t "supersedes an existing active fact" 2>&1 | tail -20
  ```

  Expected: FAIL — currently both facts are active after accept.

- [ ] **Step 3: Add `listActiveFactsBySubjectPredicate` to `MemoryGraphRepository`**

  Open `packages/memory/src/graph-repository.ts`. Add this method after `ensureSelfEntity`:

  ```ts
  async listActiveFactsBySubjectPredicate(
    scopedDb: DataContextDb,
    ownerUserId: string,
    subjectEntityId: string,
    predicate: string
  ): Promise<{ id: string }[]> {
    assertDataContextDb(scopedDb);
    const result = await sql<{ id: string }>`
      SELECT id FROM app.memory_facts
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND subject_entity_id = ${subjectEntityId}::uuid
        AND predicate = ${predicate}
        AND status = 'active'
    `.execute(scopedDb.db);
    return result.rows;
  }
  ```

- [ ] **Step 4: Add conflict routing in `acceptCandidate` in `dashboard-service.ts`**

  Open `packages/memory/src/dashboard-service.ts`. Find the `if (kind === "fact" && factPayload)` branch in `acceptCandidate`. It currently does:

  ```ts
  const selfEntity = await this.graphRepo.ensureSelfEntity(scopedDb, ownerUserId);
  const result = await this.recallSvc.remember(scopedDb, ownerUserId, {
    subjectEntityId: selfEntity.id,
    predicate: predicate as MemoryFactPredicate,
    objectText,
    recordKind,
    confidence: 1.0,
    provenance: "confirmed",
    pinned: edited?.pinned,
    source: dashboardSource
  });
  ```

  Replace those lines with:

  ```ts
  const selfEntity = await this.graphRepo.ensureSelfEntity(scopedDb, ownerUserId);

  // #561: if an active fact with the same predicate already exists on the self-entity,
  // route through correctFact (supersede) instead of creating a duplicate active fact.
  const conflicts = await this.graphRepo.listActiveFactsBySubjectPredicate(
    scopedDb,
    ownerUserId,
    selfEntity.id,
    predicate
  );

  let rememberedFact: MemoryFactRecord;
  if (conflicts.length > 0 && conflicts[0]) {
    const corrected = await this.recallSvc.correct(scopedDb, ownerUserId, {
      targetFactId: conflicts[0].id,
      replacementText: objectText
    });
    if (!corrected) {
      const err = new Error("Conflict resolution failed") as NodeJS.ErrnoException;
      err.code = "CONFLICT_RESOLUTION_FAILED";
      throw err;
    }
    rememberedFact = corrected;
  } else {
    const result = await this.recallSvc.remember(scopedDb, ownerUserId, {
      subjectEntityId: selfEntity.id,
      predicate: predicate as MemoryFactPredicate,
      objectText,
      recordKind,
      confidence: 1.0,
      provenance: "confirmed",
      pinned: edited?.pinned,
      source: dashboardSource
    });
    rememberedFact = result.fact;
  }

  if (edited?.validFrom != null || edited?.validTo != null || edited?.staleAt != null) {
    await this.dashRepo.patchFactLifecycle(scopedDb, ownerUserId, rememberedFact.id, {
      validFrom: edited.validFrom ?? null,
      validTo: edited.validTo ?? null,
      staleAt: edited.staleAt ?? null
    });
  }
  ```

  Note: remove the existing lifecycle patch block that references `result.fact.id` below (since we unified it above). The method body up to the `markPromoted` call should end with the lifecycle patch, then fall through to `markPromoted`.

- [ ] **Step 5: Add `MemoryFactRecord` import if not present**

  In `dashboard-service.ts`, check the import from `./graph-types.js`. `MemoryFactRecord` should already be imported; if not, add it to the import list.

- [ ] **Step 6: Run the test to verify it passes**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts -t "supersedes an existing active fact" 2>&1 | tail -20
  ```

  Expected: PASS.

- [ ] **Step 7: Run format check + lint + typecheck**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add packages/memory/src/graph-repository.ts packages/memory/src/dashboard-service.ts \
    tests/integration/memory-graph.test.ts
  git commit -m "fix(memory): route acceptCandidate through correction path when conflict exists (#561)"
  ```

---

### Task 5: #562 — factToItem: no raw sourceRef fallback

When `sourceLabel` is absent and `sourceRef` looks like a UUID or internal ref, substitute the `sourceKind` label instead of exposing the raw ref.

**Files:**

- Modify: `packages/memory/src/dashboard-service.ts` (fix `factToItem`, add helper)

**Interfaces:**

- Produces: `factToItem` never exposes a raw UUID in `sourceSummary`

- [ ] **Step 1: Write the failing unit test**

  In `packages/memory/src/` there are no unit tests today; add one at `packages/memory/src/dashboard-service.test.ts`. But since the existing test infrastructure uses the integration tests directory, add a small targeted test in the existing `tests/integration/memory-graph.test.ts` instead:

  ```ts
  describe("factToItem sourceSummary privacy", () => {
    it("does not expose raw UUIDs in sourceSummary when sourceLabel is absent", async () => {
      const userId = ids.user1;
      const rawUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

      // Create a fact with a raw UUID as sourceRef and no sourceLabel
      let factId!: string;
      await appDataContext.withDataContext({ actorUserId: userId }, async (scopedDb) => {
        const repo = new MemoryGraphRepository();
        const self = await repo.ensureSelfEntity(scopedDb, userId);
        const fact = await repo.createFact(scopedDb, userId, {
          subjectEntityId: self.id,
          predicate: "knows",
          objectText: "source-ref-privacy-test",
          recordKind: "fact",
          confidence: 0.8,
          provenance: "volunteered",
          importance: 1,
          pinned: false,
          source: {
            sourceKind: "chat",
            sourceRef: rawUuid,
            sourceLabel: undefined,
            occurredAt: null,
            excerpt: ""
          }
        });
        factId = fact.id;
      });

      // Fetch dashboard and check sourceSummary
      const response = await dashboardServer.inject({
        method: "GET",
        url: `/api/memory/dashboard?status=active&limit=100`,
        headers: { "x-test-user-id": userId }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        items: Array<{ id: string; sourceSummary: string }>;
      };
      const item = body.items.find((i) => i.id === factId);
      expect(item).toBeDefined();
      expect(item?.sourceSummary).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(item?.sourceSummary).not.toBe(rawUuid);
    });
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts -t "raw UUIDs in sourceSummary" 2>&1 | tail -20
  ```

  Expected: FAIL — currently `sourceSummary` is the raw UUID.

- [ ] **Step 3: Add helper and fix `factToItem` in `dashboard-service.ts`**

  Open `packages/memory/src/dashboard-service.ts`. Add a helper function before `factToItem`:

  ```ts
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const INTERNAL_REF_PREFIX_RE = /^(?:memory|internal|ref|id):/i;

  function isRawInternalRef(ref: string): boolean {
    return UUID_RE.test(ref) || INTERNAL_REF_PREFIX_RE.test(ref);
  }

  function safeSourceSummary(source: MemorySourceSummary | undefined): string {
    if (!source) return "";
    if (source.sourceLabel) return source.sourceLabel;
    if (isRawInternalRef(source.sourceRef)) {
      // Substitute a safe display string derived from the sourceKind
      const kindLabels: Record<string, string> = {
        chat: "Chat",
        note: "Note",
        task: "Task",
        email: "Email",
        calendar: "Calendar",
        manual: "Manual"
      };
      return kindLabels[source.sourceKind] ?? "Memory";
    }
    return source.sourceRef;
  }
  ```

  Then in `factToItem`, change:

  ```ts
  sourceSummary: source?.sourceLabel ?? source?.sourceRef ?? "",
  ```

  to:

  ```ts
  sourceSummary: safeSourceSummary(source),
  ```

  `MemorySourceSummary` is already imported via `graph-types.ts`.

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts -t "raw UUIDs in sourceSummary" 2>&1 | tail -20
  ```

  Expected: PASS.

- [ ] **Step 5: Run format check + lint + typecheck**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add packages/memory/src/dashboard-service.ts tests/integration/memory-graph.test.ts
  git commit -m "fix(memory): prevent raw UUID/internal ref exposure in factToItem sourceSummary (#562)"
  ```

---

### Task 6: #565 — Module isolation: notes monitor-provider

The notes monitor-provider currently queries `app.memory_file_index` and `app.memory_chunks` directly. This violates module isolation. Fix: add `listRecentVaultFiles` to `MemoryRepository` (which already owns these tables) and update the notes monitor-provider to call it.

**Files:**

- Modify: `packages/memory/src/repository.ts` (add `listRecentVaultFiles` and return type)
- Modify: `packages/memory/src/index.ts` (export the new return type)
- Modify: `packages/notes/src/monitor-provider.ts` (replace direct queries with call to `MemoryRepository`)

**Interfaces:**

- Produces:

  ```ts
  interface VaultFileWithChunks {
    readonly sourcePath: string;
    readonly ingestedAt: Date;
    readonly fileHash: string;
    readonly chunks: readonly {
      readonly text: string;
      readonly lineStart: number;
      readonly updatedAt: Date;
    }[];
  }
  // MemoryRepository.listRecentVaultFiles(scopedDb, since, limit, chunksPerFile): Promise<VaultFileWithChunks[]>
  ```

- [ ] **Step 1: Add the interface and method to `MemoryRepository`**

  Open `packages/memory/src/repository.ts`. After the existing `RetrievedChunk` interface, add:

  ```ts
  export interface VaultFileChunk {
    readonly text: string;
    readonly lineStart: number;
    readonly updatedAt: Date;
  }

  export interface VaultFileWithChunks {
    readonly sourcePath: string;
    readonly ingestedAt: Date;
    readonly fileHash: string;
    readonly chunks: readonly VaultFileChunk[];
  }
  ```

  Then add this method to the `MemoryRepository` class (after the last existing method):

  ```ts
  async listRecentVaultFiles(
    scopedDb: DataContextDb,
    since: Date,
    limit: number,
    chunksPerFile: number = 5
  ): Promise<VaultFileWithChunks[]> {
    assertDataContextDb(scopedDb);

    const fileRows = await sql<{
      source_path: string;
      ingested_at: Date;
      file_hash: string;
    }>`
      SELECT source_path, ingested_at, file_hash
      FROM app.memory_file_index
      WHERE source_kind = 'vault'
        AND ingested_at >= ${since}
      ORDER BY ingested_at DESC
      LIMIT ${limit}
    `.execute(scopedDb.db);

    const results: VaultFileWithChunks[] = [];
    for (const file of fileRows.rows) {
      const chunkRows = await sql<{
        text: string;
        line_start: number;
        updated_at: Date;
      }>`
        SELECT text, line_start, updated_at
        FROM app.memory_chunks
        WHERE source_kind = 'vault'
          AND source_path = ${file.source_path}
        ORDER BY line_start ASC
        LIMIT ${chunksPerFile}
      `.execute(scopedDb.db);

      results.push({
        sourcePath: file.source_path,
        ingestedAt: file.ingested_at,
        fileHash: file.file_hash,
        chunks: chunkRows.rows.map((c) => ({
          text: c.text,
          lineStart: c.line_start,
          updatedAt: c.updated_at
        }))
      });
    }
    return results;
  }
  ```

- [ ] **Step 2: Export the new types from `packages/memory/src/index.ts`**

  Open `packages/memory/src/index.ts`. Find the existing line:

  ```ts
  export type { NewChunkData, RetrievedChunk } from "./repository.js";
  ```

  Change it to:

  ```ts
  export type {
    NewChunkData,
    RetrievedChunk,
    VaultFileChunk,
    VaultFileWithChunks
  } from "./repository.js";
  ```

- [ ] **Step 3: Update `monitor-provider.ts` to use `MemoryRepository`**

  Open `packages/notes/src/monitor-provider.ts`. Replace the entire `collectSignals` method body (the direct queries at lines 57–94) with a call to `listRecentVaultFiles`.

  First, add the import at the top of the file:

  ```ts
  import { MemoryRepository } from "@jarv1s/memory";
  ```

  Then replace the two direct query blocks (everything from `const recentFiles = await db.db.selectFrom...` through the end of the `for` loop body that calls `.selectFrom("app.memory_chunks")`) with:

  ```ts
  const memoryRepo = new MemoryRepository();
  const recentFiles = await memoryRepo.listRecentVaultFiles(db, since, 50, 5);

  if (recentFiles.length === 0) {
    return { signals: [], nextCursor: { checkedAt: input.now } };
  }

  const signals: ProactiveMonitorSignal[] = [];

  for (const file of recentFiles) {
    if (signals.length >= input.maxSignals) break;

    if (file.chunks.length === 0) continue;

    const fullText = file.chunks.map((c) => c.text).join(" ");
    const { matched, matchedLabel } = matchesAnchor(fullText, input.priorityAnchors);
    if (!matched) continue;
  ```

  Then the rest of the loop (signal construction) remains unchanged, but uses `file.sourcePath` instead of `file.source_path` and `file.chunks[0]?.updatedAt` instead of `chunks[0]?.updated_at`.

  The full replacement for the direct-query section:

  Replace:

  ```ts
  // Find recently ingested vault notes.
  const recentFiles = await db.db
    .selectFrom("app.memory_file_index")
    .select(["source_path", "ingested_at", "file_hash"])
    .where("source_kind", "=", "vault")
    .where("ingested_at", ">=", lookback)
    .orderBy("ingested_at", "desc")
    .limit(50)
    .execute();

  if (recentFiles.length === 0) {
    return { signals: [], nextCursor: { checkedAt: input.now } };
  }

  const signals: ProactiveMonitorSignal[] = [];

  for (const file of recentFiles) {
    if (signals.length >= input.maxSignals) break;

    // Load first chunks to check for anchor matches.
    const chunks = await db.db
      .selectFrom("app.memory_chunks")
      .select(["text", "line_start", "updated_at"])
      .where("source_kind", "=", "vault")
      .where("source_path", "=", file.source_path)
      .orderBy("line_start", "asc")
      .limit(5)
      .execute();

    if (chunks.length === 0) continue;

    const fullText = chunks.map((c) => c.text).join(" ");
    const { matched, matchedLabel } = matchesAnchor(fullText, input.priorityAnchors);
    if (!matched) continue;
  ```

  With:

  ```ts
  const memoryRepo = new MemoryRepository();
  const recentFiles = await memoryRepo.listRecentVaultFiles(db, lookback, 50, 5);

  if (recentFiles.length === 0) {
    return { signals: [], nextCursor: { checkedAt: input.now } };
  }

  const signals: ProactiveMonitorSignal[] = [];

  for (const file of recentFiles) {
    if (signals.length >= input.maxSignals) break;

    if (file.chunks.length === 0) continue;

    const fullText = file.chunks.map((c) => c.text).join(" ");
    const { matched, matchedLabel } = matchesAnchor(fullText, input.priorityAnchors);
    if (!matched) continue;
  ```

  Then update references inside the loop body. Find any use of `file.source_path`, `file.ingested_at`, `file.file_hash`, `chunks[N]`, `chunks[N].updated_at`, `chunks[N].line_start` and update to use `file.sourcePath`, `file.ingestedAt`, `file.fileHash`, `file.chunks[N]`, `file.chunks[N].updatedAt`, `file.chunks[N].lineStart`.

- [ ] **Step 4: Read the rest of monitor-provider.ts to confirm all field references are updated**

  Check the signal-construction section (around line 92–120 of the original) uses only `file.sourcePath`, `file.chunks`, etc.

  ```bash
  grep -n "source_path\|ingested_at\|file_hash\|\.updated_at\|\.line_start\|selectFrom.*memory" \
    /home/ben/Jarv1s/.claude/worktrees/memory-cleanup/packages/notes/src/monitor-provider.ts
  ```

  Expected: no matches (all raw queries removed).

- [ ] **Step 5: Run format check + lint + typecheck**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  ```

- [ ] **Step 6: Run the proactive-monitoring integration test**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/proactive-monitoring.test.ts --reporter=verbose 2>&1 | tail -20
  ```

  Expected: all existing proactive-monitoring tests still pass.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/memory/src/repository.ts packages/memory/src/index.ts \
    packages/notes/src/monitor-provider.ts
  git commit -m "fix(notes): route vault file queries through MemoryRepository (module isolation #565)"
  ```

---

## Final verification

After all 6 tasks are committed:

- [ ] **Run all memory and related tests**

  ```bash
  JARVIS_PGDATABASE=jarvis_build_memory_cleanup JARVIS_EMBED_PROVIDER=stub \
    pnpm vitest run tests/integration/memory-graph.test.ts \
      tests/integration/proactive-monitoring.test.ts \
      --reporter=verbose 2>&1 | tail -40
  ```

- [ ] **Run the full pre-push trio**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  ```

- [ ] **Rebase onto latest origin/main**

  ```bash
  git fetch origin main && git rebase origin/main
  ```

- [ ] **Invoke `coordinated-wrap-up` to create the PR and report to Coordinator**
