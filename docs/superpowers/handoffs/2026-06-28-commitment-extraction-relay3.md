# Relay 3 — Commitment Extraction (Tasks 12–13)

**Date:** 2026-06-28  
**Branch/worktree:** `rfa-537-commitment-extraction`  
`~/Jarv1s/.claude/worktrees/rfa-537-commitment-extraction`  
**Spec:** `docs/superpowers/specs/2026-05-31-commitment-extraction.md`  
**Coordinator label:** `Coordinator`  
**Coordinator session:** `5e1a6b62-a480-4b5c-9706-e476cfe77044`  
**Risk tier:** normal

---

## What is done (committed)

| Commit     | Task                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- |
| `5075e1ae` | Task 1+2+3: pg-boss ALLOWED_PAYLOAD_KEYS + SQL migration 0125 + foundation + module-registry |
| `369e1fdb` | Task 4: Kysely types for all 4 commitment tables                                             |
| `b12bc2ca` | Task 5: prefilter trigger phrases + candidate signature                                      |
| `f3d33c1a` | Task 6: AI commitment extractor with prefilter guard                                         |
| `1e9009f3` | Task 7: extraction job payload + worker registration                                         |
| `4f720dd8` | Task 8: 7 REST routes (candidates CRUD + extract + state)                                    |
| `8de73cd5` | Task 9: 5 assistant tools (list, get, accept, reject, snooze)                                |
| `523a7cc1` | Task 10: full manifest with tools + module-registry wiring                                   |
| `7b0e421f` | Task 11: chat + notes CommitmentExtractionProvider stubs                                     |
| `d7d6d2de` | Task 12 WIP: integration test written (blocked on migration RLS fix)                         |

---

## Active task: Task 12 — Integration tests (FAILING — fix required)

`tests/integration/commitments.test.ts` exists and has 6 tests. All fail with:

```
error: new row violates row-level security policy for table "commitment_candidates"
```

### Root cause: 4 bugs in `packages/commitments/sql/0125_commitment_candidates.sql`

**Bug 1 — Wrong RLS function (primary cause of test failure):**  
All `app_runtime` USING/WITH CHECK clauses use:

```sql
current_setting('app.current_user_id', true)
```

Must be:

```sql
app.current_actor_user_id()
```

The session variable set by `DataContextRunner.withDataContext` is `app.actor_user_id`,
accessed via the `app.current_actor_user_id()` helper (not `current_setting('app.current_user_id', true)`).
This affects 4 tables × 2 clauses each = 8 occurrences to replace.

**Bug 2 — `owner_user_id` column type:**  
All 4 tables have `owner_user_id TEXT NOT NULL`. Must be:

```sql
owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE
```

(Consistent with `app.tasks`, `app.briefings`, all other modules. The `@jarv1s/db` Kysely
types already use `string` which maps correctly to uuid.)

**Bug 3 — Missing `FORCE RLS`:**  
Before each `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, add:

```sql
ALTER TABLE app.<table_name> FORCE ROW LEVEL SECURITY;
```

Pattern used in every other secure module table.

**Bug 4 — Missing INSERT grant for worker:**  
`jarvis_worker_runtime` needs INSERT on:

- `commitment_candidates` (upsertCandidate does INSERT ON CONFLICT DO UPDATE)
- `commitment_candidate_sources` (addEvidenceRow does INSERT)
- `commitment_extraction_state` (upsertExtractionState does INSERT ON CONFLICT DO UPDATE)

Current grants only have `SELECT, UPDATE` for worker — missing INSERT.

### Fix procedure (Task 12, Step 1)

Edit `packages/commitments/sql/0125_commitment_candidates.sql`:

1. **4 tables** — change `owner_user_id TEXT NOT NULL` → `owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE`

2. **Before each** `ALTER TABLE app.<t> ENABLE ROW LEVEL SECURITY;` add:

   ```sql
   ALTER TABLE app.<t> FORCE ROW LEVEL SECURITY;
   ```

3. **Replace all** `current_setting('app.current_user_id', true)` → `app.current_actor_user_id()`
   (8 occurrences across 4 tables)

4. **Fix worker GRANTs:**

   ```sql
   -- commitment_candidates (currently: SELECT, UPDATE)
   GRANT INSERT, SELECT, UPDATE, DELETE ON app.commitment_candidates TO jarvis_app_runtime;
   GRANT INSERT, SELECT, UPDATE ON app.commitment_candidates TO jarvis_worker_runtime;

   -- commitment_candidate_sources (currently: SELECT, UPDATE)
   GRANT INSERT, SELECT, UPDATE, DELETE ON app.commitment_candidate_sources TO jarvis_app_runtime;
   GRANT INSERT, SELECT, UPDATE ON app.commitment_candidate_sources TO jarvis_worker_runtime;

   -- commitment_extraction_state (currently: SELECT, UPDATE)
   GRANT INSERT, SELECT, UPDATE ON app.commitment_extraction_state TO jarvis_app_runtime;
   GRANT INSERT, SELECT, UPDATE ON app.commitment_extraction_state TO jarvis_worker_runtime;
   ```

   Note: `commitment_candidate_events` worker only needs SELECT (no worker direct inserts — events
   are inserted by the repository on behalf of the app role). App runtime keeps INSERT, SELECT.

5. Also fix `actor_user_id TEXT NOT NULL` → `actor_user_id uuid NOT NULL` on the
   `commitment_candidate_events` table (line 111 in current file). This isn't causing test
   failures but is a correctness bug.

This migration is SAFE to edit — it's only on the feature branch (never applied to origin/main
or any deployed environment). Tests call `resetFoundationDatabase()` which drops and recreates
from scratch, so editing is safe.

### Fix procedure (Task 12, Step 2) — Re-run tests

```bash
JARVIS_PGDATABASE=jarvis_build_537 pnpm vitest run tests/integration/commitments.test.ts
```

Note: `resetFoundationDatabase()` calls `dropApplicationSchemas()` then re-applies all
migrations — so editing the migration and running the test is sufficient.

### Fix procedure (Task 12, Step 3) — Check `listCandidates` test logic

The `listCandidates` test (line 122 in the test file) has a potential logic issue:

- It creates `sig1` with status `pending_review`, then `accepts` it (via `updateStatus`)
- Then creates `sig2` which stays `pending_review`
- Asserts `pending.id` (sig1) is NOT in `pendingList` and IS in `acceptedList`

Confirm the test assertion logic is correct after the migration fix. If the test still fails,
re-read the test at `tests/integration/commitments.test.ts:122`.

### Commit for Task 12

```
fix(commitments): correct RLS policies + uuid owner column + worker INSERT grants

- Replace current_setting('app.current_user_id') with app.current_actor_user_id()
  in all four commitment table policies (8 occurrences)
- Change owner_user_id TEXT → uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE
- Add FORCE ROW LEVEL SECURITY before ENABLE on each table
- Add INSERT grant for jarvis_worker_runtime on candidates/sources/extraction_state
- Fix actor_user_id TEXT → uuid on commitment_candidate_events
```

---

## Next task: Task 13 — Pre-push gate + rebase + push

```bash
# 1. Format + lint + typecheck
pnpm format:check && pnpm lint && pnpm typecheck

# 2. Rebase
git fetch origin main && git rebase origin/main

# 3. Verify migration slot still free
grep "0125" packages/commitments/sql/0125_commitment_candidates.sql  # exists
# Check origin/main hasn't landed a 0125_* from another branch:
git log origin/main --oneline | head -5  # just orient

# 4. Run full test suite
JARVIS_PGDATABASE=jarvis_build_537 pnpm run test:unit
JARVIS_PGDATABASE=jarvis_build_537 pnpm vitest run tests/integration/foundation.test.ts
JARVIS_PGDATABASE=jarvis_build_537 pnpm run test:commitments

# 5. Push and open PR
git push -u origin rfa-537-commitment-extraction
# Then: coordinated-wrap-up skill
```

---

## Key invariants to remember

- `ToolExecute` returns `{ data: {...} } satisfies ToolResult` (NOT `renderToolResult` — that returns string)
- `AccessContext` = `{ actorUserId, requestId }` only
- RLS pattern: `app.current_actor_user_id()` (NOT `current_setting('app.current_user_id', true)`)
- Session var set by DataContextRunner: `app.actor_user_id`
- Lane DB for all integration tests: `JARVIS_PGDATABASE=jarvis_build_537`
- `resetFoundationDatabase()` is safe — feature-branch-only migration

---

## How to continue

```bash
# In the worktree:
[ -d node_modules ] || pnpm install
# Read this doc in full, then:
# 1. Fix packages/commitments/sql/0125_commitment_candidates.sql (all 4 bugs above)
# 2. Run JARVIS_PGDATABASE=jarvis_build_537 pnpm vitest run tests/integration/commitments.test.ts
# 3. Commit
# 4. Task 13 gate + push + coordinated-wrap-up
```
