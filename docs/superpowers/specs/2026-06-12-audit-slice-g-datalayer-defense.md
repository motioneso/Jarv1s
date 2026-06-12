# Spec: Audit Slice G — Data-Layer Defense-in-Depth

**Date:** 2026-06-12
**Audit issues:** #102, #144, #99
**Tier:** `security` (#102 is the same silent-denial failure mode that made #98 a live breakage)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** maybe (if #99's structured-state app-layer fix requires a schema change;
expected 0 — the DB WITH CHECK is already in place)
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
  (`vectorSearch`) filters only by `embedding IS NOT NULL AND source_kind = …`. It has no
  `WHERE owner_user_id = ownerUserId` clause. Every other query in the same file filters by
  `owner_user_id`. The missing predicate means a misconfigured or buggy caller could retrieve
  embedding-matched memory chunks from any user. The chunks feed directly into AI prompts.
- **#99 — caller-supplied `ownerUserId` in structured-state repos:**
  `packages/structured-state/src/commitments-repository.ts:30`,
  `entities-repository.ts:29`, and `preferences-repository.ts:13` write `input.ownerUserId`
  (caller-supplied) verbatim into the `owner_user_id` column. The DB `WITH CHECK` predicate
  (`0031:58,108,149`) enforces `owner_user_id = current_actor_user_id()`, so a mismatch
  causes an error rather than a successful cross-user write. However, the app layer
  should not accept a caller-supplied owner — it should derive it from the DataContext GUC,
  matching the tasks-module pattern.

---

## Fix design

### #102 — Add `assertDataContextDb` to memory and structured-state repos

**`packages/memory/src/repository.ts`:**
Add `import { assertDataContextDb } from "@jarv1s/db"` (already imports `DataContextDb`).
Add `assertDataContextDb(scopedDb)` as the first statement of every public method that
accepts `scopedDb: DataContextDb`. There are approximately 10 such methods (all methods except
any that take only primitive arguments).

**`packages/structured-state/src/commitments-repository.ts`**,
**`packages/structured-state/src/entities-repository.ts`**,
**`packages/structured-state/src/preferences-repository.ts`:**
Same pattern — add the import and the guard at method entry. These repos likely have
`create`, `update`, `delete`, `list`, and `get` methods.

**Reference:** `packages/tasks/src/repository.ts` — all public methods follow this pattern exactly.

### #144 — Add owner predicate to `vectorSearch`

**Location:** `packages/memory/src/repository.ts:72-95`.

**Current WHERE clause (approximate):**
```sql
WHERE embedding IS NOT NULL
  AND source_kind = ${sourceKind}
ORDER BY embedding <=> ${embedding}
LIMIT ${limit}
```

**Fix:** Add `AND owner_user_id = ${ownerUserId}::uuid` before the ORDER BY:

```sql
WHERE embedding IS NOT NULL
  AND owner_user_id = ${ownerUserId}::uuid
  AND source_kind = ${sourceKind}
ORDER BY embedding <=> ${embedding}
LIMIT ${limit}
```

The `ownerUserId` parameter is already accepted by `vectorSearch` — it is used in the
`callerId`/caller-scoping logic. Confirm the parameter name in the actual function signature
and use it. If the function takes `actorUserId` from the `DataContext` instead of as a
parameter, use `app.current_actor_user_id()` in SQL:

```sql
AND owner_user_id = app.current_actor_user_id()
```

The WITH CHECK policies on `memory_chunks` use `app.current_actor_user_id()` — the owner
predicate should be consistent with them.

**Performance note:** `owner_user_id` should be indexed (confirm the index exists in
`packages/memory/sql/`). If not, add the index in the same PR. The existing vector index is
already per-table; adding `owner_user_id` to the WHERE is a filter pre-step before the ANN
scan and should improve query performance.

### #99 — Replace caller-supplied `ownerUserId` with DB-derived value

**Affected files:**
- `packages/structured-state/src/commitments-repository.ts` — `create` method, ≈ line 30:
  `owner_user_id: input.ownerUserId`
- `packages/structured-state/src/entities-repository.ts` — `create` method, ≈ line 29:
  `owner_user_id: input.ownerUserId`
- `packages/structured-state/src/preferences-repository.ts` — `upsert` method, ≈ line 13:
  `owner_user_id: ownerUserId`

**Fix:** Replace the caller-supplied value with `sql\`app.current_actor_user_id()\`` (using
Kysely's `sql` template tag), matching the pattern in `packages/tasks/src/repository.ts:125`:

```typescript
// commitments-repository.ts create:
owner_user_id: sql<string>`app.current_actor_user_id()`,
```

Remove `ownerUserId` from the `CreateCommitmentInput`, `CreateEntityInput`, and `upsertPreferences`
parameter types (or from the relevant `input` object fields). Update all callers to stop passing
`ownerUserId` — they no longer need to supply it.

**Why this is safe:** the DB `WITH CHECK` already enforces `owner_user_id = current_actor_user_id()`,
so any value that isn't the current actor's ID errors out. The app-layer change makes the intent
explicit and removes the parameter surface that could be misused.

---

## Hard invariants

- **`assertDataContextDb` at every public method entry** in memory and structured-state repos.
  No exceptions.
- **`vectorSearch` must be owner-scoped.** After this PR, it is impossible to retrieve
  `memory_chunks` from a different user via vector search.
- **No caller-supplied `owner_user_id`** in structured-state INSERTs. The value comes only from
  `app.current_actor_user_id()`.
- **Guard after Slice A (#98) RLS policies are live.** The memory worker policies (added by
  Slice A's migration) are required for the worker to function. Slice G must land on top of a
  `main` that includes Slice A.
- **Slice G migration position.** If a new migration is needed (e.g., to add a composite index
  on `(owner_user_id, source_kind)` for vectorSearch), it lands at the next available number
  after Slice A's migrations and after Slice B's DROP migration.

---

## Tests

- **`pnpm test:memory`** — run the full memory suite; confirm worker write + cross-user
  read-rejection tests pass.
- **vectorSearch owner isolation:** a test that calls `vectorSearch` with user A's actor
  context must not return chunks owned by user B. Write this test if it doesn't exist.
- **structured-state create with wrong owner:** a test that tries to insert a commitment with
  `owner_user_id` != current actor (old API) must fail at compile time (parameter removed) or
  at runtime with a `WITH CHECK` violation.
- **`pnpm verify:foundation`** green.
- **assertDataContextDb grep:** after the PR, every public method in `packages/memory/src/repository.ts`
  and `packages/structured-state/src/*.ts` must contain `assertDataContextDb(scopedDb)` as
  the first line of the body.

---

## Out of scope

- Adding `owner_user_id` indexes if they already exist (confirm before adding).
- Full memory search UI or recall feature changes.
- The broader structured-state `contribute`/`manage` permission model (manifest narrowing is
  Slice B's `#152` fix).
- Worker memory job scheduling changes.
