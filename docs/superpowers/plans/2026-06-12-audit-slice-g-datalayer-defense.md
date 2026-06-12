# Audit Slice G — Data-Layer Defense-in-Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the memory and structured-state repositories against the three identified data-layer gaps: missing `assertDataContextDb` guards (#102), a missing owner predicate in `vectorSearch` (#144), and caller-supplied `owner_user_id` in structured-state INSERT operations (#99).

**Architecture:** Every public method in `packages/memory/src/repository.ts` and `packages/structured-state/src/` gains `assertDataContextDb(scopedDb)` at entry, matching the pattern already enforced in `packages/tasks/src/repository.ts`. The `vectorSearch` SQL WHERE clause adds `AND owner_user_id = app.current_actor_user_id()` as an explicit app-layer predicate (defense-in-depth on top of the existing FORCE RLS). All three structured-state `create`/`upsert` methods replace the caller-supplied `ownerUserId` argument with `sql<string>`app.current_actor_user_id()`` and remove that field from their input interfaces, with corresponding updates to the single calling test file.

**Tech Stack:** TypeScript, Kysely `sql` template tag, Vitest integration tests, Postgres FORCE RLS, `assertDataContextDb` from `@jarv1s/db`.

---

## Dependency note

This slice **must land on top of a `main` that already includes Slice A** (issue #98 worker memory RLS policies). Do not merge until Slice A is in `main`. No migration is authored in this slice — migration count stays 0.

---

### Task 1: Add `assertDataContextDb` guard to `packages/memory/src/repository.ts` (9 methods)

**Files:**

- Modify: `packages/memory/src/repository.ts` (lines 1–196)
- Test: `tests/integration/memory.test.ts`

The file currently imports `DataContextDb` from `@jarv1s/db` but does not import or call `assertDataContextDb`. All 9 public methods (`upsertFileChunks`, `deleteFileChunks`, `deleteAllForUser`, `vectorSearch`, `replaceFileLinks`, `getFileIndex`, `upsertFileIndex`, `deleteFileIndex`, `listIndexedPaths`) need the guard as their first statement.

- [ ] **Write the failing test.** Append a new `describe` block at the very end of `tests/integration/memory.test.ts` (after the last existing `describe`). Note: the file's `afterAll` is at line 138 near the top — appending at end-of-file is correct and does not interfere with it.

  ```typescript
  describe("MemoryRepository — assertDataContextDb guard", () => {
    const repo = new MemoryRepository();

    it("throws when an unbranded handle is passed to upsertFileChunks", async () => {
      await expect(
        repo.upsertFileChunks(appDb as unknown as DataContextDb, "u1", "p.md", [], "stub", "0")
      ).rejects.toThrow("Repository access requires withDataContext");
    });

    it("throws when an unbranded handle is passed to vectorSearch", async () => {
      await expect(repo.vectorSearch(appDb as unknown as DataContextDb, [], 5)).rejects.toThrow(
        "Repository access requires withDataContext"
      );
    });

    it("throws when an unbranded handle is passed to listIndexedPaths", async () => {
      await expect(
        repo.listIndexedPaths(appDb as unknown as DataContextDb, "u1", "vault")
      ).rejects.toThrow("Repository access requires withDataContext");
    });
  });
  ```

  The `appDb` variable is already declared and assigned in the `beforeAll` at line 134 of the test file. `DataContextDb` is already imported at line 13.

- [ ] **Run the test — expect FAIL:**

  ```bash
  cd ~/Jarv1s && set -o pipefail && pnpm test:memory 2>&1 | grep -A3 "assertDataContextDb guard"
  ```

  Expected: the 3 new guard tests fail. Pre-fix, the methods do not call `assertDataContextDb`, so
  the raw Kysely handle (which has no `.db` property) makes `sql\`…\`.execute(undefined)`throw a`TypeError`instead of the expected`"Repository access requires withDataContext"` message —
  Vitest reports a message-mismatch assertion failure. Either way the tests are red; do not proceed
  to the fix until you see them fail.

- [ ] **Implement the fix.** Add `assertDataContextDb` to the import and to every public method entry in `packages/memory/src/repository.ts`:

  ```typescript
  // The import block (lines 1–3) becomes:
  import { sql } from "kysely";

  import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
  ```

  Then add `assertDataContextDb(scopedDb);` as the first line of each public method body:

  `upsertFileChunks` (line 24): insert after the opening brace on line 32 (before `await this.deleteFileChunks`):

  ```typescript
  async upsertFileChunks(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourcePath: string,
    chunks: readonly NewChunkData[],
    embedModelName: string,
    embedModelVersion: string,
    sourceKind: string = "vault"
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await this.deleteFileChunks(scopedDb, ownerUserId, sourcePath, sourceKind);
    // ... rest unchanged
  ```

  `deleteFileChunks` (line 49): insert after opening brace:

  ```typescript
  async deleteFileChunks(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourcePath: string,
    sourceKind: string = "vault"
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
  ```

  `deleteAllForUser` (line 63): insert after opening brace:

  ```typescript
  async deleteAllForUser(scopedDb: DataContextDb, ownerUserId: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
  ```

  `vectorSearch` (line 72): insert after opening brace:

  ```typescript
  async vectorSearch(
    scopedDb: DataContextDb,
    embedding: number[],
    limit: number,
    sourceKind: string = "vault"
  ): Promise<RetrievedChunk[]> {
    assertDataContextDb(scopedDb);
    const vectorLiteral = `[${embedding.join(",")}]`;
  ```

  `replaceFileLinks` (line 106): insert after opening brace:

  ```typescript
  async replaceFileLinks(
    scopedDb: DataContextDb,
    ownerUserId: string,
    fromPath: string,
    toPaths: readonly string[]
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
  ```

  `getFileIndex` (line 126): insert after opening brace:

  ```typescript
  async getFileIndex(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string,
    sourcePath: string
  ): Promise<{ fileHash: string; embedModelName: string } | null> {
    assertDataContextDb(scopedDb);
    const result = await sql<
  ```

  `upsertFileIndex` (line 143): insert after opening brace:

  ```typescript
  async upsertFileIndex(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string,
    sourcePath: string,
    fileHash: string,
    chunkCount: number,
    embedModelName: string,
    embedModelVersion: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
  ```

  `deleteFileIndex` (line 169): insert after opening brace:

  ```typescript
  async deleteFileIndex(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string,
    sourcePath: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await sql`
  ```

  `listIndexedPaths` (line 183): insert after opening brace:

  ```typescript
  async listIndexedPaths(
    scopedDb: DataContextDb,
    ownerUserId: string,
    sourceKind: string
  ): Promise<string[]> {
    assertDataContextDb(scopedDb);
    const result = await sql<
  ```

- [ ] **Run the test — expect PASS (assert exit 0):**

  ```bash
  cd ~/Jarv1s && pnpm test:memory; echo "exit=$?"
  ```

  Expected: `exit=0` — all memory tests pass including the 3 new guard tests.

- [ ] **Commit:**

  ```bash
  git add packages/memory/src/repository.ts tests/integration/memory.test.ts
  git commit -m "fix(memory): add assertDataContextDb guard to all 9 public methods (#102)"
  ```

---

### Task 2: Add owner predicate to `vectorSearch` (#144)

**Files:**

- Modify: `packages/memory/src/repository.ts` (lines 86–94, the SQL block inside `vectorSearch`)
- Verify: `tests/integration/memory.test.ts` line 206–224 (existing test; no change needed)

The existing test at line 206 (`"vectorSearch returns chunks ranked by similarity (owner-scoped)"`) already passes via FORCE RLS. It cannot be made red-before-green for the app-layer predicate because RLS already enforces the same constraint. Acceptance is code-inspection: after this task, the SQL must contain `app.current_actor_user_id()`.

- [ ] **Verify the current SQL is missing the owner predicate (expected: match):**

  ```bash
  grep -A 15 "async vectorSearch" ~/Jarv1s/packages/memory/src/repository.ts | grep "owner_user_id"
  ```

  Expected: no output (the predicate is absent before this task).

- [ ] **Implement the fix.** In `packages/memory/src/repository.ts`, replace the WHERE clause inside `vectorSearch`. The current SQL block (lines 86–94) is:

  ```sql
  WHERE embedding IS NOT NULL
    AND source_kind = ${sourceKind}
  ORDER BY embedding <=> ${vectorLiteral}::vector
  LIMIT ${limit}
  ```

  Replace with:

  ```sql
  WHERE embedding IS NOT NULL
    AND owner_user_id = app.current_actor_user_id()
    AND source_kind = ${sourceKind}
  ORDER BY embedding <=> ${vectorLiteral}::vector
  LIMIT ${limit}
  ```

  Full updated `vectorSearch` body after both Task 1 and Task 2 changes:

  ```typescript
  async vectorSearch(
    scopedDb: DataContextDb,
    embedding: number[],
    limit: number,
    sourceKind: string = "vault"
  ): Promise<RetrievedChunk[]> {
    assertDataContextDb(scopedDb);
    const vectorLiteral = `[${embedding.join(",")}]`;
    const result = await sql<{
      id: string;
      source_path: string;
      line_start: number;
      line_end: number;
      text: string;
      similarity: number;
    }>`
      SELECT id, source_path, line_start, line_end, text,
             1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM app.memory_chunks
      WHERE embedding IS NOT NULL
        AND owner_user_id = app.current_actor_user_id()
        AND source_kind = ${sourceKind}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `.execute(scopedDb.db);

    return result.rows.map((r) => ({
      id: r.id,
      sourcePath: r.source_path,
      lineStart: r.line_start,
      lineEnd: r.line_end,
      text: r.text,
      similarity: r.similarity
    }));
  }
  ```

- [ ] **Run acceptance grep — expect match:**

  ```bash
  grep -A 20 "async vectorSearch" ~/Jarv1s/packages/memory/src/repository.ts | grep "owner_user_id = app.current_actor_user_id()"
  ```

  Expected: one matching line printed.

- [ ] **Run the test suite — expect PASS (assert exit 0):**

  ```bash
  cd ~/Jarv1s && pnpm test:memory; echo "exit=$?"
  ```

  Expected: `exit=0` — all memory tests pass (the existing owner-scoped vectorSearch test at line 206 continues to pass).

- [ ] **Verify callers are unaffected (no signature change):**

  ```bash
  grep -n "vectorSearch" ~/Jarv1s/packages/memory/src/retrieval.ts ~/Jarv1s/packages/chat/src/recall-port.ts
  ```

  Expected: calls at `retrieval.ts:19` and `recall-port.ts:76` match `vectorSearch(scopedDb, queryEmbedding, limit, sourceKind)` — no `ownerUserId` argument needed or added.

- [ ] **Commit:**

  ```bash
  git add packages/memory/src/repository.ts
  git commit -m "fix(memory): add owner_user_id predicate to vectorSearch SQL (#144)"
  ```

---

### Task 3: Add `assertDataContextDb` guard to `packages/structured-state/src/` (3 repos, 14 methods)

**Files:**

- Modify: `packages/structured-state/src/commitments-repository.ts` (lines 1–88, 5 public methods)
- Modify: `packages/structured-state/src/entities-repository.ts` (lines 1–87, 5 public methods)
- Modify: `packages/structured-state/src/preferences-repository.ts` (lines 1–47, 4 public methods)
- Test: `tests/integration/structured-state.test.ts`

- [ ] **Write the failing test.** Append a new `describe` block at the end of
      `tests/integration/structured-state.test.ts` (after the final `VaultWriteBackService` describe,
      before the file ends). The `appDb` variable is declared at line 33 and assigned in `beforeAll` at
      line 50. `Kysely` is already imported at line 6. `DataContextRunner` is imported at line 10.
      `userId` is declared at line 26 (module scope).

  ```typescript
  // ── assertDataContextDb guards ────────────────────────────────────────────────

  describe("assertDataContextDb guards — structured-state repos", () => {
    it("CommitmentsRepository.create throws on unbranded handle", async () => {
      const repo = new CommitmentsRepository();
      await expect(
        repo.create(appDb as unknown as import("@jarv1s/db").DataContextDb, {
          ownerUserId: userId,
          title: "x",
          provenance: "volunteered"
        })
      ).rejects.toThrow("Repository access requires withDataContext");
    });

    it("EntitiesRepository.listVisible throws on unbranded handle", async () => {
      const repo = new EntitiesRepository();
      await expect(
        repo.listVisible(appDb as unknown as import("@jarv1s/db").DataContextDb)
      ).rejects.toThrow("Repository access requires withDataContext");
    });

    it("PreferencesRepository.upsert throws on unbranded handle", async () => {
      const repo = new PreferencesRepository();
      await expect(
        repo.upsert(appDb as unknown as import("@jarv1s/db").DataContextDb, userId, "k", "v")
      ).rejects.toThrow("Repository access requires withDataContext");
    });
  });
  ```

  **These guard tests are written against the CURRENT (pre-Task-4) signatures:** the `create`
  input still includes the required `ownerUserId: userId` field (`CreateCommitmentInput` requires
  it at `packages/structured-state/src/commitments-repository.ts:5`), and `upsert` takes the 4-arg
  form `upsert(scopedDb, userId, "k", "v")` (`preferences-repository.ts:4-9`). Task 4 updates these
  two tests alongside the other call sites when it removes `ownerUserId`. Writing them this way
  keeps `pnpm typecheck` green at the Task 3 commit (tsconfig includes `tests/**/*.ts`, so a
  signature mismatch here would fail the gate). `userId` is already declared in this test file's
  setup and is in scope for the appended describe block.

- [ ] **Run the test — expect FAIL:**

  ```bash
  cd ~/Jarv1s && set -o pipefail && pnpm test:structured-state 2>&1 | grep -A3 "assertDataContextDb guards"
  ```

  Expected: 3 tests fail (methods do not throw on unbranded input yet).

- [ ] **Implement the fix: `commitments-repository.ts`.** Add import and guard to all 5 public methods:

  ```typescript
  // Line 1 becomes:
  import { assertDataContextDb, type Commitment, type DataContextDb } from "@jarv1s/db";
  import type { CommitmentSourceKind, CommitmentStatus, ProvenanceKind } from "./types.js";
  ```

  `create` (line 26): add `assertDataContextDb(scopedDb);` as first statement of body:

  ```typescript
  async create(scopedDb: DataContextDb, input: CreateCommitmentInput): Promise<Commitment> {
    assertDataContextDb(scopedDb);
    const result = await scopedDb.db
  ```

  `listVisible` (line 44): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async listVisible(scopedDb: DataContextDb): Promise<Commitment[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
  ```

  `get` (line 53): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async get(scopedDb: DataContextDb, id: string): Promise<Commitment | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
  ```

  `update` (line 62): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async update(
    scopedDb: DataContextDb,
    id: string,
    input: UpdateCommitmentInput
  ): Promise<Commitment | undefined> {
    assertDataContextDb(scopedDb);
    const updates: Record<string, unknown> = { updated_at: new Date() };
  ```

  `delete` (line 85): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async delete(scopedDb: DataContextDb, id: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db.deleteFrom("app.commitments").where("id", "=", id).execute();
  ```

- [ ] **Implement the fix: `entities-repository.ts`.** Add import and guard to all 5 public methods:

  ```typescript
  // Line 1 becomes:
  import { assertDataContextDb, type DataContextDb, type Entity } from "@jarv1s/db";
  import type { EntityType, ProvenanceKind } from "./types.js";
  ```

  `create` (line 25): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async create(scopedDb: DataContextDb, input: CreateEntityInput): Promise<Entity> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
  ```

  `listVisible` (line 43): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async listVisible(scopedDb: DataContextDb): Promise<Entity[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
  ```

  `get` (line 52): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async get(scopedDb: DataContextDb, id: string): Promise<Entity | undefined> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
  ```

  `update` (line 61): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async update(
    scopedDb: DataContextDb,
    id: string,
    input: UpdateEntityInput
  ): Promise<Entity | undefined> {
    assertDataContextDb(scopedDb);
    const updates: Record<string, unknown> = { updated_at: new Date() };
  ```

  `delete` (line 84): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async delete(scopedDb: DataContextDb, id: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db.deleteFrom("app.entities").where("id", "=", id).execute();
  ```

- [ ] **Implement the fix: `preferences-repository.ts`.** Add import and guard to all 4 public methods:

  ```typescript
  // Line 1 becomes:
  import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
  ```

  `upsert` (line 4): add `assertDataContextDb(scopedDb);` as first statement of body:

  ```typescript
  async upsert(
    scopedDb: DataContextDb,
    ownerUserId: string,
    key: string,
    value: unknown
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
  ```

  `get` (line 27): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async get(scopedDb: DataContextDb, key: string): Promise<unknown> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
  ```

  `list` (line 36): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async list(scopedDb: DataContextDb): Promise<Record<string, unknown>> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
  ```

  `delete` (line 44): add `assertDataContextDb(scopedDb);` as first statement:

  ```typescript
  async delete(scopedDb: DataContextDb, key: string): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db.deleteFrom("app.preferences").where("key", "=", key).execute();
  ```

- [ ] **Run the test — expect PASS (assert exit 0):**

  ```bash
  cd ~/Jarv1s && pnpm test:structured-state; echo "exit=$?"
  ```

  Expected: `exit=0` — all structured-state tests pass including the 3 new guard tests. The guard
  tests were written against the current signatures (Task 4 has not run yet), so `CreateCommitmentInput.ownerUserId`
  and the 4-arg `upsert` are still in effect and the new tests compile cleanly.

- [ ] **Run typecheck — expect clean (prove the intermediate Task 3 commit is gate-green):**

  ```bash
  cd ~/Jarv1s && pnpm typecheck; echo "exit=$?"
  ```

  Expected: `exit=0`. tsconfig includes `tests/**/*.ts`, so this proves the appended guard tests
  match the not-yet-changed repository signatures. Do not commit until this is `exit=0`.

- [ ] **Commit:**

  ```bash
  git add packages/structured-state/src/commitments-repository.ts \
         packages/structured-state/src/entities-repository.ts \
         packages/structured-state/src/preferences-repository.ts \
         tests/integration/structured-state.test.ts
  git commit -m "fix(structured-state): add assertDataContextDb guard to all 14 public methods (#102)"
  ```

---

### Task 4: Remove caller-supplied `ownerUserId` from structured-state INSERT/UPSERT paths (#99)

**Files:**

- Modify: `packages/structured-state/src/commitments-repository.ts` (lines 1–13 interface; line 30 `create` body)
- Modify: `packages/structured-state/src/entities-repository.ts` (lines 1–13 interface; line 29 `create` body)
- Modify: `packages/structured-state/src/preferences-repository.ts` (lines 4–9 signature; line 13 `upsert` body)
- Modify: `tests/integration/structured-state.test.ts` (all call sites passing `ownerUserId`)

The `sql` template tag must be imported in `commitments-repository.ts` and `entities-repository.ts` (they do not currently import it). `preferences-repository.ts` also does not currently import `sql`. `packages/tasks/src/repository.ts:125` is the reference pattern: `owner_user_id: sql<string>`app.current_actor_user_id()`,`.

- [ ] **Verify current compile state — expect TypeScript errors after the interface change.** Before editing, confirm the test file call count:

  ```bash
  grep -c "ownerUserId" ~/Jarv1s/tests/integration/structured-state.test.ts
  ```

  Expected: 15 — the 14 pre-existing call sites plus the 1 `ownerUserId: userId` added in the Task 3
  `CommitmentsRepository.create` guard test. (The spec's "≈14 call sites" predates the Task 3 guard
  tests.) Every one of these 15 must be removed in this task.

- [ ] **Implement the fix: `commitments-repository.ts`.** Remove `ownerUserId` from `CreateCommitmentInput` and replace `input.ownerUserId` with the GUC in `create`:

  Remove `readonly ownerUserId: string;` from `CreateCommitmentInput` (line 5). The interface becomes:

  ```typescript
  export interface CreateCommitmentInput {
    readonly title: string;
    readonly provenance: ProvenanceKind;
    readonly counterparty?: string;
    readonly dueAt?: Date;
    readonly sourceKind?: CommitmentSourceKind;
    readonly sourceRef?: string;
    readonly lifeArea?: string;
  }
  ```

  Add `sql` to the import from `kysely` (this file does not currently import it; add it):

  ```typescript
  import { sql } from "kysely";

  import { assertDataContextDb, type Commitment, type DataContextDb } from "@jarv1s/db";
  import type { CommitmentSourceKind, CommitmentStatus, ProvenanceKind } from "./types.js";
  ```

  In `create`, replace `owner_user_id: input.ownerUserId,` (line 30) with:

  ```typescript
  owner_user_id: sql<string>`app.current_actor_user_id()`,
  ```

  Full updated `.values({...})` block in `create`:

  ```typescript
  .values({
    owner_user_id: sql<string>`app.current_actor_user_id()`,
    title: input.title,
    provenance: input.provenance,
    counterparty: input.counterparty ?? null,
    due_at: input.dueAt ?? null,
    source_kind: input.sourceKind ?? "manual",
    source_ref: input.sourceRef ?? null,
    life_area: input.lifeArea ?? null
  })
  ```

- [ ] **Implement the fix: `entities-repository.ts`.** Remove `ownerUserId` from `CreateEntityInput` and replace `input.ownerUserId` with the GUC in `create`:

  Remove `readonly ownerUserId: string;` from `CreateEntityInput` (line 5). The interface becomes:

  ```typescript
  export interface CreateEntityInput {
    readonly type: EntityType;
    readonly name: string;
    readonly provenance: ProvenanceKind;
    readonly attributes?: Record<string, unknown>;
    readonly vaultNotePath?: string;
    readonly connectorRefs?: Record<string, unknown>;
    readonly lifeArea?: string;
  }
  ```

  Add `sql` to the import from `kysely`:

  ```typescript
  import { sql } from "kysely";

  import { assertDataContextDb, type DataContextDb, type Entity } from "@jarv1s/db";
  import type { EntityType, ProvenanceKind } from "./types.js";
  ```

  In `create`, replace `owner_user_id: input.ownerUserId,` (line 29) with:

  ```typescript
  owner_user_id: sql<string>`app.current_actor_user_id()`,
  ```

  Full updated `.values({...})` block in `create`:

  ```typescript
  .values({
    owner_user_id: sql<string>`app.current_actor_user_id()`,
    type: input.type,
    name: input.name,
    provenance: input.provenance,
    attributes: JSON.stringify(input.attributes ?? {}),
    vault_note_path: input.vaultNotePath ?? null,
    connector_refs: input.connectorRefs ? JSON.stringify(input.connectorRefs) : null,
    life_area: input.lifeArea ?? null
  })
  ```

- [ ] **Implement the fix: `preferences-repository.ts`.** Remove the positional `ownerUserId` parameter from `upsert` and replace `owner_user_id: ownerUserId` with the GUC. Note: the `onConflict` columns `['owner_user_id', 'key']` remain unchanged.

  Add `sql` to the import from `kysely`:

  ```typescript
  import { sql } from "kysely";

  import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
  ```

  Updated `upsert` signature — remove the `ownerUserId` positional parameter (was second positional after `scopedDb`):

  ```typescript
  async upsert(
    scopedDb: DataContextDb,
    key: string,
    value: unknown
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .insertInto("app.preferences")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        key,
        value_json: JSON.stringify(value),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(["owner_user_id", "key"]).doUpdateSet({
          value_json: JSON.stringify(value),
          updated_at: new Date()
        })
      )
      .execute();
  }
  ```

- [ ] **Update `tests/integration/structured-state.test.ts`.** Remove all `ownerUserId: userId,` arguments from `repo.create(...)` calls and remove `ownerUserId` from `repo.upsert(...)` calls.

  For `CommitmentsRepository` calls (lines 73–74, 87, 98–100, 118–120, 141–143): remove `ownerUserId: userId,` from each `create` input object.

  Example: line 73–77 becomes:

  ```typescript
  await repo.create(scopedDb, {
    title: "Call Alice back",
    provenance: "volunteered"
  });
  ```

  Line 87 becomes:

  ```typescript
  await repo.create(scopedDb, { title, provenance: "volunteered" });
  ```

  Lines 98–102 become:

  ```typescript
  const c = await repo.create(scopedDb, {
    title: `Shared-${randomUUID()}`,
    provenance: "volunteered"
  });
  ```

  Lines 118–122 become:

  ```typescript
  const c = await repo.create(scopedDb, {
    title: `Revoked-${randomUUID()}`,
    provenance: "volunteered"
  });
  ```

  Lines 141–144 become:

  ```typescript
  const c = await repo.create(scopedDb, {
    title: "Track status",
    provenance: "volunteered"
  });
  ```

  For `EntitiesRepository` calls (lines 160–163, 174–177, 191–195, 211–214, 225–229, 286–290, 313–317, 335–339, 352–356): remove `ownerUserId: userId,` from each `create` input object.

  Example: lines 160–164 become:

  ```typescript
  await repo.create(scopedDb, {
    type: "person",
    name: "Alice Smith",
    provenance: "volunteered"
  });
  ```

  For `PreferencesRepository.upsert` calls (lines 244, 252, 253, 268): remove the second positional argument (`userId`).

  Line 244 becomes:

  ```typescript
  await repo.upsert(scopedDb, "persona.name", "Jarvis");
  ```

  Line 252 becomes:

  ```typescript
  await repo.upsert(scopedDb, "persona.tone", "formal");
  ```

  Line 253 becomes:

  ```typescript
  await repo.upsert(scopedDb, "persona.tone", "casual");
  ```

  Line 268 becomes:

  ```typescript
  await repo.upsert(scopedDb, "persona.directness", "high");
  ```

  **Also update the two guard tests added in Task 3** (they were written against the pre-Task-4
  signatures and now need the `ownerUserId` removed to match the new ones):
  - In the `CommitmentsRepository.create throws on unbranded handle` test, remove the
    `ownerUserId: userId,` line from the `create` input object so it becomes:
    ```typescript
    repo.create(appDb as unknown as import("@jarv1s/db").DataContextDb, {
      title: "x",
      provenance: "volunteered"
    });
    ```
  - In the `PreferencesRepository.upsert throws on unbranded handle` test, remove the `userId`
    positional argument so it becomes:
    ```typescript
    repo.upsert(appDb as unknown as import("@jarv1s/db").DataContextDb, "k", "v");
    ```

  The `EntitiesRepository.listVisible` guard test takes no `ownerUserId` and needs no change.

- [ ] **Run typecheck — expect clean (assert exit 0):**

  ```bash
  cd ~/Jarv1s && pnpm typecheck; echo "exit=$?"
  ```

  Expected: `exit=0`. `pnpm typecheck` is the authoritative net here: any production or test caller
  of the changed `CreateCommitmentInput` / `CreateEntityInput` / `upsert` signatures would fail to
  compile. If errors appear they will be in `structured-state.test.ts` at any remaining `ownerUserId`
  reference — fix those call sites until `exit=0`.

- [ ] **Run the test — expect PASS (assert exit 0):**

  ```bash
  cd ~/Jarv1s && pnpm test:structured-state; echo "exit=$?"
  ```

  Expected: `exit=0` — all tests pass.

- [ ] **Confirm no production callers remain with `ownerUserId` in structured-state context:**

  ```bash
  grep -rn "ownerUserId" ~/Jarv1s/packages/structured-state/src/ --include="*.ts"
  ```

  Expected: no output (field removed from all interfaces and method signatures).

  Confirm no caller anywhere instantiates these three repos (scans both `apps/` and `packages/`,
  and filters by symbol name in the match — not by path keyword, so a caller in
  `apps/api/src/routes.ts` would not be silently skipped):

  ```bash
  grep -rn "CommitmentsRepository\|EntitiesRepository\|PreferencesRepository" \
    ~/Jarv1s/apps ~/Jarv1s/packages --include="*.ts" \
    | grep -v "structured-state/src\|tests/"
  ```

  Expected: no output. (`PreferencesRepository` here is the structured-state class; the tasks
  module uses its own distinct `TaskPreferencesRepository` in `packages/tasks/src/preferences.ts`,
  which this grep does not match.) Note: `pnpm typecheck` above is the authoritative net — any
  production caller of the changed interfaces would have already failed to compile.

- [ ] **Commit:**

  ```bash
  git add packages/structured-state/src/commitments-repository.ts \
         packages/structured-state/src/entities-repository.ts \
         packages/structured-state/src/preferences-repository.ts \
         tests/integration/structured-state.test.ts
  git commit -m "fix(structured-state): derive owner_user_id from GUC, remove caller-supplied field (#99)"
  ```

---

### Task 5: Acceptance greps and full verification gate

**Files:** none (read-only verification)

- [ ] **Grep: every public method in `memory/repository.ts` has `assertDataContextDb(scopedDb)` at entry:**

  ```bash
  grep -n "assertDataContextDb(scopedDb)" ~/Jarv1s/packages/memory/src/repository.ts
  ```

  Expected: 9 lines printed (one per public method: `upsertFileChunks`, `deleteFileChunks`, `deleteAllForUser`, `vectorSearch`, `replaceFileLinks`, `getFileIndex`, `upsertFileIndex`, `deleteFileIndex`, `listIndexedPaths`).

- [ ] **Placement check: the guard is the FIRST statement of each method body, before any `await`.**
      Counting occurrences is not enough — a guard placed after the first `await` would read/write
      through an unverified handle and still pass the count grep. Assert that the line immediately
      after each method's opening `{` is the guard. The reliable signal is that no `await` precedes any
      `assertDataContextDb` within a method. Run:

  ```bash
  # No await may appear on the line before an assertDataContextDb call (guard must be first):
  grep -B1 "assertDataContextDb(scopedDb)" ~/Jarv1s/packages/memory/src/repository.ts \
    | grep -c "await"
  ```

  Expected: `0`. Then visually confirm in the diff that for all 9 methods the body opens with
  `assertDataContextDb(scopedDb);` directly under the signature's `{` — no statement (especially no
  `await`, `const x = await …`, or `sql\`…\`.execute`) appears before it.

- [ ] **Grep: every public method in `structured-state/src/*.ts` has `assertDataContextDb(scopedDb)` at entry:**

  ```bash
  grep -rn "assertDataContextDb(scopedDb)" ~/Jarv1s/packages/structured-state/src/
  ```

  Expected: 14 lines printed (5 in `commitments-repository.ts`, 5 in `entities-repository.ts`, 4 in `preferences-repository.ts`).

- [ ] **Placement check (structured-state): the guard is the FIRST statement, before any `await`:**

  ```bash
  grep -rB1 "assertDataContextDb(scopedDb)" ~/Jarv1s/packages/structured-state/src/ \
    | grep -c "await"
  ```

  Expected: `0`. Then visually confirm in the diff that all 14 methods open their body with
  `assertDataContextDb(scopedDb);` directly under the signature, with no `await`/`const … = await`/
  `scopedDb.db` access preceding it.

- [ ] **Grep: `vectorSearch` SQL contains the owner predicate:**

  ```bash
  grep -A 20 "async vectorSearch" ~/Jarv1s/packages/memory/src/repository.ts | grep "owner_user_id = app.current_actor_user_id()"
  ```

  Expected: one matching line printed.

- [ ] **Grep: no caller-supplied `ownerUserId` remains in structured-state interfaces or INSERT `.values()` calls:**

  ```bash
  grep -rn "ownerUserId" ~/Jarv1s/packages/structured-state/src/ --include="*.ts"
  ```

  Expected: no output.

- [ ] **Confirm no migration was added (migration count stays 0 for this slice).** Use git, not
      `find -newer` (mtimes are unreliable in a fresh worktree/clone and would make this check
      vacuously pass or spuriously fail):

  ```bash
  cd ~/Jarv1s && git status --porcelain \
    packages/memory/sql packages/structured-state/sql infra/postgres/migrations
  cd ~/Jarv1s && git diff --stat main -- \
    packages/memory/sql packages/structured-state/sql infra/postgres/migrations
  ```

  Expected: no output from either command — no SQL file added, modified, or deleted vs. `main`.

- [ ] **Run full foundation gate (assert exit 0):**

  ```bash
  cd ~/Jarv1s && pnpm verify:foundation; echo "exit=$?"
  ```

  Expected: `exit=0` — lint, format:check, check:file-size, typecheck, db:migrate, test:integration
  all pass. The gate's real exit code is the pass/fail signal; do not pipe it through `tail`/`grep`
  (that would mask a failing suite behind the pipe's exit code — see the project's
  verification-discipline standard).
