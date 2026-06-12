# Spec: Audit Slice G — Data-Layer Defense-in-Depth

**Date:** 2026-06-12 (revised post-Fable review)
**Audit issues:** #102, #144, #99
**Tier:** `security` (#102 is the same silent-denial failure mode that made #98 a live breakage)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 0 (code-only; no index migration needed — `owner_user_id` indexes already exist at `packages/memory/sql/0030_memory_index.sql:18,21`)
**Dependency:** Must land after Slice A (#98 worker memory RLS policies must be in place before
#102 asserts the guard). Parallel-safe with Slice B, C, E, F.

---

## Context

Three independent gaps in the data-layer defense that share a single root cause: code that
bypasses the `assertDataContextDb` + `WITH CHECK` ownership enforcement pattern established by
the rest of the codebase:

- **#102 — missing `assertDataContextDb` in memory + structured-state repos:** Every method in
  `packages/memory/src/repository.ts` and `packages/structured-state/src/` accepts a
  `DataContextDb` type parameter but never calls `assertDataContextDb(scopedDb)`. The guard is
  the compile-time + runtime double-check that no one accidentally passes a raw `Kysely`
  instance. Without it, the same silent-RLS-denial failure that caused the live #98 breakage
  can recur in a worker context if the GUC is not set.
- **#144 — `vectorSearch` has no owner predicate:** `packages/memory/src/repository.ts:72-95`
  (`vectorSearch`) filters only by `embedding IS NOT NULL AND source_kind = …`. There is no
  `ownerUserId` parameter in the actual signature (verified: signature is
  `vectorSearch(scopedDb: DataContextDb, embedding: number[], limit: number, sourceKind: string = "vault")`).
  The missing predicate means a misconfigured or buggy caller could retrieve embedding-matched
  memory chunks from any user. The chunks feed directly into AI prompts. Defense-in-depth: RLS
  with FORCE already enforces owner scope, but the app-layer predicate should be explicit.
- **#99 — caller-supplied `ownerUserId` in structured-state repos:**
  `packages/structured-state/src/commitments-repository.ts:30`,
  `entities-repository.ts:29`, and `preferences-repository.ts:13` write `input.ownerUserId`
  (or positional `ownerUserId`) verbatim into the `owner_user_id` column. The DB `WITH CHECK`
  predicate (`0031:58,108,149`) enforces `owner_user_id = current_actor_user_id()`, so a
  mismatch causes an error rather than a successful cross-user write. However, the app layer
  should not accept a caller-supplied owner — it should derive it from the DataContext GUC,
  matching the tasks-module pattern.

---

## Fix design

### #102 — Add `assertDataContextDb` to memory and structured-state repos

**`packages/memory/src/repository.ts`:**
Add `import { assertDataContextDb } from "@jarv1s/db"` (already imports `DataContextDb`).
Add `assertDataContextDb(scopedDb)` as the first statement of every public method that
accepts `scopedDb: DataContextDb`. There are 9 public methods.

**`packages/structured-state/src/commitments-repository.ts`**,
**`packages/structured-state/src/entities-repository.ts`**,
**`packages/structured-state/src/preferences-repository.ts`:**
Same pattern — add the import and the guard at method entry.

Actual method counts (verified):

- `commitments-repository.ts`: create, listVisible, get, update, delete (5 methods)
- `entities-repository.ts`: create, listVisible, get, update, delete (5 methods)
- `preferences-repository.ts`: upsert, get, list, delete (4 methods)
- `memory/repository.ts`: 9 public methods (verify names by reading the file — do not guess)

**Reference:** `packages/tasks/src/repository.ts` — all public methods follow this pattern exactly.

### #144 — Add owner predicate to `vectorSearch`

**Location:** `packages/memory/src/repository.ts:72-95`.

The function signature does NOT have an ownerUserId parameter. The `DataContextDb` passed in
carries the actor via the GUC (`app.current_actor_user_id()`), consistent with how every other
query in this file enforces owner scope. Use the GUC directly in SQL:

**Current WHERE clause (approximate):**

```sql
WHERE embedding IS NOT NULL
  AND source_kind = ${sourceKind}
ORDER BY embedding <=> ${embedding}
LIMIT ${limit}
```

**Fix:** Add `AND owner_user_id = app.current_actor_user_id()` before the ORDER BY:

```sql
WHERE embedding IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND source_kind = ${sourceKind}
ORDER BY embedding <=> ${embedding}
LIMIT ${limit}
```

**No caller changes.** The two callers — `packages/memory/src/retrieval.ts:19` and
`packages/chat/src/recall-port.ts:76` (chat module, via the memory public API) — do not pass
`ownerUserId` and are unaffected. Do not change their signatures.

**Why no new index:** `owner_user_id` indexes already exist:

- `packages/memory/sql/0030_memory_index.sql:18` — `(owner_user_id)`
- `packages/memory/sql/0030_memory_index.sql:21` — `(owner_user_id, source_path)`

The ANN query uses the hnsw embedding index with post-filtering; adding an explicit app-layer
predicate does not change query plan or performance vs. the FORCE RLS path. **Migration count
stays 0.**

### #99 — Replace caller-supplied `ownerUserId` with DB-derived value

**Affected files:**

- `packages/structured-state/src/commitments-repository.ts` — `create` method, ≈ line 30:
  `owner_user_id: input.ownerUserId`
- `packages/structured-state/src/entities-repository.ts` — `create` method, ≈ line 29:
  `owner_user_id: input.ownerUserId`
- `packages/structured-state/src/preferences-repository.ts` — `upsert` method, ≈ line 13:
  positional `owner_user_id: ownerUserId` (note: this is a positional parameter, not part of
  an input object — remove the positional param, not an object field)

**Fix:** Replace the caller-supplied value with `sql\`app.current_actor_user_id()\``(using
Kysely's`sql`template tag), matching the pattern in`packages/tasks/src/repository.ts:125`:

```typescript
// commitments-repository.ts create:
owner_user_id: sql<string>`app.current_actor_user_id()`,
```

Remove `ownerUserId` from `CreateCommitmentInput`, `CreateEntityInput`, and the positional
`ownerUserId` parameter from `preferences-repository.ts`'s `upsert()`. The `onConflict` columns
`['owner_user_id', 'key']` in preferences remain unchanged.

**Production callers = none.** A codebase-wide search confirms: no production code calls
`create`/`upsert` on these repos — packages/tasks uses its own `TaskPreferencesRepository`
(`packages/tasks/src/preferences.ts`). The ONLY file that calls these methods is
`tests/integration/structured-state.test.ts` (≈14 call sites at lines 74–353). That test file
will have compile errors after the parameter removal; update only that file.

---

## Hard invariants

- **`assertDataContextDb` at every public method entry** in memory and structured-state repos.
  No exceptions.
- **`vectorSearch` must be owner-scoped.** After this PR, it is impossible to retrieve
  `memory_chunks` from a different user via vector search even without RLS.
- **No caller-supplied `owner_user_id`** in structured-state INSERTs. The value comes only from
  `app.current_actor_user_id()`.
- **No new index migration.** The existing indexes at 0030:18,21 are sufficient. Do not burn a
  migration number on an unneeded index.
- **Guard after Slice A (#98) RLS policies are live.** The memory worker policies (added by
  Slice A's migration) are required for the worker to function. Slice G must land on top of a
  `main` that includes Slice A.

---

## Tests

- **`pnpm test:memory`** — run the full memory suite; confirm worker write + cross-user
  read-rejection tests pass.
- **`pnpm test:structured-state`** (i.e., `vitest run tests/integration/structured-state.test.ts`)
  — this is the ONLY caller file that changes after #99 parameter removal; it must compile and pass.
- **vectorSearch owner-isolation acceptance (code inspection, not TDD):** The existing test at
  `tests/integration/memory.test.ts:206-224` ('vectorSearch returns chunks ranked by similarity
  (owner-scoped)') already passes today via FORCE RLS — it cannot detect the missing app-layer
  predicate. Acceptance for #144 is code inspection: after the PR, grep that `vectorSearch`'s SQL
  contains `app.current_actor_user_id()` in the WHERE clause. No new behavioral test is needed or
  possible to make red-before-green.
- **`assertDataContextDb` negative tests (per package):** Add one negative test per affected
  package (memory, structured-state) asserting that passing an unbranded handle throws the
  'Repository access requires withDataContext' error.
- **`pnpm verify:foundation`** green.
- **assertDataContextDb grep:** after the PR, every public method in `packages/memory/src/repository.ts`
  and `packages/structured-state/src/*.ts` must contain `assertDataContextDb(scopedDb)` as the
  first line of the body.

---

## Out of scope

- Adding `owner_user_id` indexes (already exist — confirmed at 0030:18,21).
- Full memory search UI or recall feature changes.
- The broader structured-state `contribute`/`manage` permission model (manifest narrowing is
  Slice B's `#152` fix).
- Worker memory job scheduling changes.
