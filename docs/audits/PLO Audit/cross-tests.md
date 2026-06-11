# Integration Tests — Thermo-Nuclear Code Quality Audit

**Scope:** `tests/integration/` and `tests/integration/fixtures/`
**Date:** 2026-06-10
**Reviewer:** Automated subagent (claude-sonnet-4-6)

---

## Findings

---

### FINDING-01

**SEVERITY:** HIGH
**Title:** `connectors-google.test.ts` — three describe blocks mutate `JARVIS_CONNECTOR_SECRET_KEY` without saving/restoring
**File:** `tests/integration/connectors-google.test.ts` (lines ~127, ~190, ~310)
**Category:** Security / Test isolation

**Finding:**
Three separate `describe` blocks each contain a `beforeAll` that sets `process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key"`. None of the corresponding `afterAll` blocks restores the original value. Because Vitest runs all test files in the same process by default (unless `--pool=forks`), any suite that executes after `connectors-google.test.ts` in the same run will inherit the mutated env var. Conversely, `connectors.test.ts` and `ai.test.ts` both correctly save and restore their env vars, so the inconsistency is not symmetrical. If the Vitest worker order changes (or files are concatenated into a single run), other suites will silently decrypt with a mismatched key and produce flaky failures rather than deterministic errors.

**Evidence:**
```typescript
// Google connection repository describe (~line 127)
beforeAll(async () => {
  process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
  // ... no save, no afterAll restore
});
```
Compare with `connectors.test.ts` which does:
```typescript
const originalKey = process.env.JARVIS_CONNECTOR_SECRET_KEY;
beforeAll(() => { process.env.JARVIS_CONNECTOR_SECRET_KEY = ...; });
afterAll(() => { process.env.JARVIS_CONNECTOR_SECRET_KEY = originalKey; });
```

**Impact:**
Medium-term: test suite order dependency that silently affects sibling suites. If `JARVIS_CONNECTOR_SECRET_KEY` is unset in the real environment and `connectors-google.test.ts` runs before `connectors.test.ts`, the latter will see the google-test key instead of its own. More critically, any future suite relying on the env var being unset will silently pass or fail depending on execution order.

**Recommendation:**
Apply the same save/restore pattern used in `connectors.test.ts`. Extract a shared helper (e.g. `saveRestoreEnv(key)`) and use it in all three describe blocks in `connectors-google.test.ts`.

---

### FINDING-02

**SEVERITY:** HIGH
**Title:** `chat-live.test.ts` — 5 ms sleep used to enforce timestamp ordering is a flakiness bomb
**File:** `tests/integration/chat-live.test.ts` (lines ~67, ~93)
**Category:** Test quality / Flakiness

**Finding:**
The "thread recency ordering" test inserts two chat threads sequentially and relies on `await new Promise((resolve) => setTimeout(resolve, 5))` (5 ms) between inserts to ensure the second thread has a later `updated_at` timestamp in PostgreSQL. PostgreSQL's `now()` returns the transaction start time with microsecond precision. Under a loaded CI runner, 5 ms is well within the noise margin for context-switch latency plus any transaction commit delay. If both INSERTs land in the same wall-clock millisecond (possible in containers), `updated_at` values are equal and the ordering assertion is non-deterministic.

**Evidence:**
```typescript
await insertThread(userA);
await new Promise((resolve) => setTimeout(resolve, 5));  // ← insufficient
await insertThread(userA);
// then asserts threads[0].id === second.id (most recent first)
```

**Impact:**
Intermittent CI failures that are hard to reproduce locally. The test will pass 99% of the time on fast hardware and fail on slow CI nodes, eroding confidence in the test suite.

**Recommendation:**
Either (a) insert with an explicit `updated_at` parameter offset by 1 second, or (b) use a sequence/counter column rather than a timestamp for ordering, or (c) touch the thread row with a `touchThread()` call that forces an update cycle, then assert without relying on sub-millisecond precision.

---

### FINDING-03

**SEVERITY:** HIGH
**Title:** `chat-live.test.ts` second describe — `appDb` connection created without `afterAll` teardown
**File:** `tests/integration/chat-live.test.ts`
**Category:** Resource management

**Finding:**
The second `describe` block ("chat live runtime repository") creates a `DataContextRunner` and a Kysely `appDb` instance in `beforeAll` but has no corresponding `afterAll` to destroy the DB connection pool. The Vitest process will not exit cleanly if any connection is still open, and under certain configurations this causes the runner to hang after the suite completes. Unlike `mcp-gateway.test.ts` (which has the same issue) this file also contains state from the first describe block, making the leak cumulative.

**Evidence:**
```typescript
describe("chat live runtime repository", () => {
  let appDb: Kysely<JarvisDatabase>;
  beforeAll(async () => {
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    // ...
  });
  // No afterAll(() => appDb.destroy())
});
```

**Impact:**
Database connection pool exhaustion in long CI runs; Vitest process hang requiring `--forceExit`.

**Recommendation:**
Add `afterAll(async () => { await appDb?.destroy(); })` to the second describe block.

---

### FINDING-04

**SEVERITY:** HIGH
**Title:** `mcp-gateway.test.ts` top-level describe — `appDb` created without `afterAll` teardown
**File:** `tests/integration/mcp-gateway.test.ts`
**Category:** Resource management

**Finding:**
The primary `describe` block in `mcp-gateway.test.ts` creates `appDb` in `beforeAll` but has no `afterAll` to call `appDb.destroy()`. This is distinct from `chat-live.test.ts`; it affects the MCP gateway test suite independently.

**Evidence:**
```typescript
beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  // ... no afterAll
});
```
Note: the second describe block ("HTTP resolve endpoint") in `chat-mcp-transport.test.ts` correctly calls `await appDb.destroy()` in `afterAll`, confirming the pattern is known.

**Impact:**
Same as FINDING-03: connection leak, potential Vitest hang.

**Recommendation:**
Add `afterAll(async () => { await appDb?.destroy(); })` to the top-level describe in `mcp-gateway.test.ts`.

---

### FINDING-05

**SEVERITY:** MEDIUM
**Title:** `mcp-gateway.test.ts` `tick()` — 50 ms timing assumption for write-blocking confirmation
**File:** `tests/integration/mcp-gateway.test.ts`
**Category:** Test quality / Flakiness

**Finding:**
The `tick()` helper (`const tick = () => new Promise((resolve) => setTimeout(resolve, 50))`) is used to give the `AssistantToolGateway` time to reach the blocking-write pending state before the test asserts it. 50 ms is an arbitrary wall-clock assumption. If the CI runner is slow, 50 ms may elapse before the gateway has processed the tool call and enqueued the confirmation, causing the subsequent assertion on `emitted.length === 1` to fail. The same 100 ms pattern appears in `chat-mcp-transport.test.ts`.

**Evidence:**
```typescript
// mcp-gateway.test.ts
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
await tick();
expect(emitted).toHaveLength(1);

// chat-mcp-transport.test.ts
await new Promise((r) => setTimeout(r, 100));
expect(emitted).toHaveLength(1);
```

**Impact:**
Flaky CI failures on slow hosts; hidden race condition that could mask real timing bugs in the gateway.

**Recommendation:**
Replace the fixed `setTimeout` with a polling loop with a deterministic timeout (e.g., `waitFor(() => emitted.length === 1, { timeout: 5000, interval: 10 })`). Vitest provides `waitFor` natively. This eliminates the hardcoded timing assumption.

---

### FINDING-06

**SEVERITY:** MEDIUM
**Title:** `structured-state.test.ts` — write-side ownership forge is not tested for CommitmentsRepository and PreferencesRepository
**File:** `tests/integration/structured-state.test.ts`
**Category:** Security / RLS coverage gap

**Finding:**
`CommitmentsRepository.create()` and `PreferencesRepository.upsert()` both accept `ownerUserId` as an explicit caller-supplied parameter. The tests verify that user A cannot *read* user B's preferences/commitments (read-isolation is correct). However, no test verifies that a caller who holds a valid `DataContextDb` scoped to their own identity but passes `ownerUserId: otherUserId` is blocked at the RLS INSERT/UPDATE policy level. If the INSERT policy only enforces `owner_user_id = app.current_actor_user_id()`, a malicious call `create(scopedDb, { ownerUserId: anotherUser, ... })` should fail at the DB level. This invariant is not tested.

**Evidence:**
```typescript
// structured-state.test.ts — only read isolation is tested:
it("preferences are owner-only: other user cannot read them", async () => {
  // userA writes with userA context (correct), then userB reads and sees nothing
  // BUT: no test for userA writing with userA context but ownerUserId=userB
});
```

**Impact:**
If the INSERT RLS policy is permissive (e.g., missing the `owner_user_id = current_actor_user_id()` check), a tenant can silently forge ownership of another user's preferences or commitments. This would be a data integrity violation that the current tests would not catch.

**Recommendation:**
Add tests that call `create(scopedDb, { ownerUserId: otherUserId, ... })` inside a DataContext scoped to a different actor, and assert that the call throws or returns no rows. Mirror the pattern in `shares.test.ts` ("forbids inserting a share that claims another user as owner").

---

### FINDING-07

**SEVERITY:** MEDIUM
**Title:** `memory.test.ts` — vector search owner-scoping is verified by absence, not by adversarial RLS block
**File:** `tests/integration/memory.test.ts`
**Category:** Security / RLS coverage quality

**Finding:**
The "vectorSearch returns chunks ranked by similarity (owner-scoped)" test inserts vectors for `userId` and then queries as `otherUserId`, asserting the result is empty. The test passes because `otherUserId` has no memory chunks — not because RLS explicitly denied the cross-user query. If an RLS policy is accidentally dropped or misconfigured, the test would still pass (otherUserId still has no data), failing to catch the regression.

**Evidence:**
```typescript
// memory.test.ts
// otherUserId has no memory chunks inserted — the empty result is not proof of RLS block
const results = await dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
  repo.vectorSearch(scopedDb, otherUserId, embedding, 5)
);
expect(results).toHaveLength(0);
```

**Impact:**
RLS regression on `memory_chunks` would not be detected by this test; a leaked row would only be caught if otherUserId happened to share an embedding dimension with the target user's data.

**Recommendation:**
The most adversarial test is to insert a chunk for `otherUserId` via the bootstrap connection (bypassing RLS), then query as `userId` and assert the other user's chunk is not returned. This directly tests that RLS blocks the cross-user query, not just that the table is empty. Compare with how `foundation.test.ts` explicitly inserts `itemBGrantedToA` and verifies cross-user denial.

---

### FINDING-08

**SEVERITY:** MEDIUM
**Title:** `ai-tools.test.ts` — `seedConnectorBackedRows` uses a literal ciphertext placeholder, not real AES-256-GCM encryption
**File:** `tests/integration/ai-tools.test.ts`
**Category:** Security / Test fidelity

**Finding:**
`seedConnectorBackedRows()` inserts `'{"ciphertext":"hidden-connector-ciphertext"}'::jsonb` as the `encrypted_secret` for connector accounts. This is a literal JSON string that mimics the AES-256-GCM envelope structure but is not actual ciphertext. The tests then assert the API response does not contain `"hidden-connector-ciphertext"`, which only tests that the API layer does not echo back whatever is stored in the column. It does not test that real AES-256-GCM encryption is applied or that real decryption works in this flow.

**Evidence:**
```typescript
// ai-tools.test.ts seedConnectorBackedRows
await client.query(`
  INSERT INTO app.connector_accounts (..., encrypted_secret)
  VALUES ($1, '{"ciphertext":"hidden-connector-ciphertext"}'::jsonb)
`);
// assertion:
expect(response.body).not.toContain("hidden-connector-ciphertext");
```
Compare with `connectors.test.ts` which uses real `createConnectorSecretService` to encrypt and then verifies round-trip decryption.

**Impact:**
The `ai-tools.test.ts` assertions would pass even if the application accidentally echoed the raw JSONB column — they would fail only if it literally printed the sentinel string. The real encryption is tested in `connectors.test.ts` but not in the AI tool flow.

**Recommendation:**
Either (a) use the real `ConnectorSecretService` to produce real ciphertext in the seed function, or (b) add a comment clearly stating this is an API-layer exclusion test and not an encryption fidelity test, pointing to `connectors.test.ts` for the real encryption coverage.

---

### FINDING-09

**SEVERITY:** MEDIUM
**Title:** `foundation.test.ts` — share seeded inside test body persists for the remainder of the suite with no cleanup
**File:** `tests/integration/foundation.test.ts`
**Category:** Test isolation

**Finding:**
The "allows probe access through a view share" test seeds an `app.shares` row (view grant from userB to userA for `itemAOwnPrivate`) inside the test body. The test file comment acknowledges: "NOTE: this share persists for the remainder of the suite (no teardown)." This means subsequent tests in the suite run against a subtly different database state than if they ran in isolation. While no current test appears to be broken by this, the comment itself is a warning sign — a future test that asserts `userA cannot see itemAOwnPrivate without a share` would silently pass or fail depending on test ordering.

**Evidence:**
```typescript
// foundation.test.ts — inside test body, no cleanup:
await bootstrapClient.query(`
  INSERT INTO app.shares (...) VALUES ($1, $2, 'view', $3)
  ON CONFLICT DO NOTHING
`, [itemAOwnPrivate, ids.userA, ids.userB]);
// comment: "NOTE: this share persists for the remainder of the suite (no teardown)"
```

**Impact:**
Latent test-order dependency. Low immediate risk but creates a maintenance trap for anyone adding tests below this one.

**Recommendation:**
Move the share seed into the `beforeAll` alongside the existing `itemBGrantedToA` share, and add a corresponding cleanup in the suite's `afterAll` or use `resetFoundationDatabase()` at the describe boundary.

---

### FINDING-10

**SEVERITY:** MEDIUM
**Title:** `auth-settings.test.ts` — admin resource-grant for tasks is asserted as INERT with a comment stub but the dead API surface is not removed
**File:** `tests/integration/auth-settings.test.ts` (lines ~371–374)
**Category:** Code quality / Dead code

**Finding:**
The "creates resource grants without giving admins private-data bypass" test contains a comment block that explicitly states the admin resource-grants-for-tasks path is "INERT" (Slice 1b/1f retirement) and asserts `afterGrantResponse.statusCode === 404`. This means the test is asserting that an admin action (grant creation returns 200) has no effect (grantee still gets 404). The test is correct but it documents a dead API path that the project has apparently not cleaned up. The admin resource-grants API still accepts and records the grant (200), but the grant is silently ignored by the tasks module.

**Evidence:**
```typescript
// auth-settings.test.ts
// Slice 1b: tasks now use the owner-or-share model and no longer consult
// app.resource_grants. The admin resource-grants API still records the grant
// (200 above), but it is INERT for tasks — the grantee gains no task access.
// This assertion and the admin resource-grants-for-tasks path are retired in Slice 1f.
expect(afterGrantResponse.statusCode).toBe(404);
```

**Impact:**
Dead API surface: the admin can create grants that are silently ignored, which could confuse operators. The test correctly documents this but the underlying API should be removed or made to return an error for task resource types.

**Recommendation:**
Either remove the `/api/admin/resource-grants` route for task resource types (returning 422) or delete the dead `resource_grants` integration entirely and update the test. Per the project's "no stale concepts" rule, dead vocabulary should be removed in the same pass.

---

### FINDING-11

**SEVERITY:** MEDIUM
**Title:** `tasks-web-contract.test.ts` — three separate describe blocks each start a `pg-boss` client against the same database in the same test run
**File:** `tests/integration/tasks-web-contract.test.ts`
**Category:** Architecture / Resource management

**Finding:**
The file contains three describe blocks ("task_preferences vertical slice", "subtasks read route", "tasks route parser"), each with its own `beforeAll` that calls `createPgBossClient(connectionStrings.app)` and `appBoss.start()`. All three run against the same underlying database. While each block cleans up in `afterAll`, all three run sequentially in the same process, which means three separate pg-boss start/stop cycles hit the same schema. This is not incorrect, but it is wasteful and risks pg-boss lock conflicts if test ordering changes.

**Evidence:**
```typescript
// tasks-web-contract.test.ts — three times:
appBoss = createPgBossClient(connectionStrings.app);
await appBoss.start();
// ...
afterAll(async () => {
  await appBoss?.stop({ graceful: false });
});
```

**Impact:**
Minor: extra DB overhead, theoretical pg-boss scheduling conflicts if the three blocks ever run in parallel.

**Recommendation:**
Consolidate into a single `describe` block with a shared setup, or move the pg-boss setup into a module-level `beforeAll`/`afterAll`. The first describe block ("tasks status contract") is a pure unit test with no DB interaction and should remain separate.

---

### FINDING-12

**SEVERITY:** MEDIUM
**Title:** `chat-recall.test.ts` — `ChatMemoryFactsRepository` "RLS isolation" test is weak (same empty-result flaw as FINDING-07)
**File:** `tests/integration/chat-recall.test.ts` (lines ~177–189)
**Category:** Security / RLS coverage quality

**Finding:**
The "respects RLS — userB cannot see userA facts" test in `ChatMemoryFactsRepository` inserts a fact for `userA` and then queries as `userB`, asserting `facts.every((f) => f.ownerUserId === userBId)`. Because userB has no facts at all, this assertion is trivially true (an empty array satisfies `every`). The test does not verify that userA's fact was blocked by RLS; it only verifies that userB's query returns whatever userB owns (nothing).

**Evidence:**
```typescript
await dataContext.withDataContext(ctx(userBId), async (scopedDb) => {
  const facts = await repo.listActiveFacts(scopedDb, userBId);
  expect(facts.every((f) => f.ownerUserId === userBId)).toBe(true);
  // passes trivially if facts is [] — no actual RLS validation
});
```

**Impact:**
Same as FINDING-07: an RLS regression on `chat_memory_facts` would not be detected.

**Recommendation:**
Insert a fact for userA via bootstrap connection, then assert that `listActiveFacts` scoped to userB does NOT contain userA's fact ID. This tests the RLS policy directly.

---

### FINDING-13

**SEVERITY:** LOW
**Title:** `ai.test.ts` — `cliAvailable` assertion is trivially weak
**File:** `tests/integration/ai.test.ts`
**Category:** Test quality / Assertion quality

**Finding:**
The test `expect(typeof provider.cliAvailable).toBe("boolean")` only verifies that `cliAvailable` is a boolean, not that it reflects the actual availability of the Claude CLI. This assertion passes regardless of whether the CLI is installed or not, and regardless of whether the detection logic is correct. It is effectively a type-check assertion rather than a behavioral assertion.

**Evidence:**
```typescript
expect(typeof provider.cliAvailable).toBe("boolean");
```

**Impact:**
Low: the test provides minimal signal. The CLI detection logic could return `true` unconditionally and this test would pass.

**Recommendation:**
If the test is running in an environment where the CLI is known to be absent, assert `expect(provider.cliAvailable).toBe(false)`. If the CLI status is environment-dependent, either skip the assertion or document that it is intentionally a type-shape check and nothing more.

---

### FINDING-14

**SEVERITY:** LOW
**Title:** `test-database.ts` — workspace seed data is dead weight after AccessContext workspace removal
**File:** `tests/integration/test-database.ts`
**Category:** Code quality / Dead code

**Finding:**
`seedProbeData()` inserts rows into `workspaces` and `workspace_memberships` tables (`workspaceAlpha`, membership of `userA` as `owner`). The workspace concept was removed from `AccessContext` in Slice 1f (confirmed in CLAUDE.md: "workspaceId was permanently removed"). The seed data remains in the foundation fixture but is never referenced by any assertion in the test suite. It occupies space in every reset cycle and could mislead future contributors into thinking workspace membership still affects access control.

**Evidence:**
```typescript
// test-database.ts seedProbeData
await client.query(
  `INSERT INTO app.workspaces (id, name, slug) VALUES ($1, 'Alpha', 'alpha')`,
  [ids.workspaceAlpha]
);
await client.query(
  `INSERT INTO app.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
  [ids.workspaceAlpha, ids.userA]
);
```
No test in the suite asserts anything about `workspaceAlpha` affecting data visibility.

**Impact:**
Low: dead seed data, minor confusion risk for future maintainers.

**Recommendation:**
Remove the `workspaceAlpha` and `workspace_memberships` seed rows from `seedProbeData()`. Remove corresponding `ids.workspaceAlpha` if only used in seeding. Per the project's "no stale concepts" rule, this should be cleaned up.

---

### FINDING-15

**SEVERITY:** LOW
**Title:** `example-tool-module.ts` — intentional secret-shaped string confuses static secret scanners
**File:** `tests/integration/fixtures/example-tool-module.ts` (line ~66)
**Category:** Security tooling / Code quality

**Finding:**
The `example.boom` tool deliberately throws `new Error("SECRET internal detail postgres://user:pw@host/db")` to test error sanitization. This is intentional and functionally correct — it tests that internal error details (including connection strings) are not leaked to the MCP response. However, the string `postgres://user:pw@host/db` and the word `SECRET` in combination will trigger any static secret scanner (GitHub advanced security, truffleHog, gitleaks) as a credential leak in the source code, generating false positives.

**Evidence:**
```typescript
// example-tool-module.ts
throw new Error("SECRET internal detail postgres://user:pw@host/db");
```

**Impact:**
Low functional impact; high noise impact on secret-scanning tooling. Could cause CI to block on secret scanner alerts or cause scanner fatigue (reviewers learn to dismiss these and then miss real leaks).

**Recommendation:**
Replace the connection string with a clearly non-parseable sentinel, e.g. `postgres://REDACTED:REDACTED@localhost/testdb` or `postgres://[intentionally-not-a-real-credential]`. Add a comment marking the string as an intentional test fixture. Alternatively, add the file path to scanner allowlist rules.

---

### FINDING-16

**SEVERITY:** LOW
**Title:** `release-hardening.test.ts` — `beforeEach` calls `resetEmptyFoundationDatabase()` on every test, which is expensive and unnecessary
**File:** `tests/integration/release-hardening.test.ts` (line 27)
**Category:** Code quality / Test performance

**Finding:**
The `release-hardening` suite wraps all tests in a single `describe` block with `beforeEach` (not `beforeAll`) that calls `resetEmptyFoundationDatabase()` followed by `seedLifecycleData()`. Because each reset triggers DROP SCHEMA CASCADE, runs all migrations, pg-boss migrate, and grants, this adds significant time per test. Most tests in this file do not mutate state in ways that require a full reset between each test (e.g., the backup-plan, restore-plan, and compose-plan tests are pure functions that don't touch the DB at all). The full-reset `beforeEach` also prevents any parallelism between tests.

**Evidence:**
```typescript
beforeEach(async () => {
  await resetEmptyFoundationDatabase();  // full DROP SCHEMA CASCADE + all migrations
  await seedLifecycleData();
});
```
Tests like "builds backup, restore, and Docker Compose smoke plans without exposing database passwords" and "defines CI automation for foundation, release hardening, audit, web, and Compose smoke" read static files and require no DB state at all.

**Impact:**
Test suite is significantly slower than necessary. The `deleteUserData` test is the only one that requires a fresh database state.

**Recommendation:**
Move the reset to `beforeAll` (one reset for the whole suite). Tests that require clean state after mutation (specifically "deletes one user only after exact confirmation") should arrange their own cleanup or use a transaction-scoped setup. Alternatively, split mutating tests into their own nested describe with `beforeAll`.

---

### FINDING-17

**SEVERITY:** LOW
**Title:** `calendar-email.test.ts` — share seeded inside test body without cleanup affects subsequent test state
**File:** `tests/integration/calendar-email.test.ts` (lines ~309–325, ~327–343)
**Category:** Test isolation

**Finding:**
Two consecutive tests ("allows calendar event read through a view share" and "allows email message read through a view share") each call `sharesRepository.grant()` inside the test body, creating share rows that persist for the remainder of the suite. The following test ("serves read-only Calendar and Email APIs...") explicitly notes "at this point bWorkspace rows have been shared to userA by the two preceding share tests, so they appear in all userA list responses." This is an intentional sequential state dependency — the API test relies on state created by the two share tests.

**Evidence:**
```typescript
// calendar-email.test.ts
it("serves read-only Calendar and Email APIs...", async () => {
  // NOTE: at this point bWorkspace rows have been shared to userA by the two
  // preceding share tests, so they appear in all userA list responses.
```

**Impact:**
Low: the dependency is acknowledged by a comment. However, if the two share tests are skipped or run in a different order, the API test will fail silently with wrong data (the shared rows won't appear in the list). This is an order-dependency that the test framework does not enforce.

**Recommendation:**
Either (a) seed the shares in `beforeAll` unconditionally so the API test has guaranteed state, or (b) create the shares directly in the API test via the repository before making the API calls. The current approach works but creates a fragile order dependency.

---

### FINDING-18

**SEVERITY:** LOW
**Title:** `tasks.test.ts` — update-denied-by-RLS test is ambiguous (silent failure vs. actual RLS block)
**File:** `tests/integration/tasks.test.ts`
**Category:** Test quality / Assertion quality

**Finding:**
The test "does not let a view-share grantee update the task" relies on `repository.update()` returning `undefined` when RLS prevents the row from being visible in the UPDATE's implicit SELECT. While the behavior is correct (RLS causes 0 rows affected → undefined return), the test would also pass if the update silently failed for unrelated reasons (e.g., the task ID doesn't exist, a bug in the update query). The test does not first verify that the task IS visible to the view-share grantee (read works) before asserting that write is blocked.

**Evidence:**
```typescript
// tasks.test.ts
const updateResult = await repository.update(viewGranteeDb, taskId, { title: "hijacked" });
expect(updateResult).toBeUndefined();
// No prior assertion that the grantee CAN read the task
```

**Impact:**
Low: the test is correct in intent but could mask a different failure mode. If the task doesn't exist at all, the assertion still passes.

**Recommendation:**
Before the update assertion, assert that the grantee can read the task (i.e., `repository.getById(viewGranteeDb, taskId)` returns the task). This confirms RLS allows read but not write, which is the policy being tested.

---

### FINDING-19

**SEVERITY:** INFO
**Title:** `test-database.ts` — parallel execution is structurally impossible due to shared `resetFoundationDatabase()`
**File:** `tests/integration/test-database.ts`
**Category:** Architecture / Test infrastructure

**Finding:**
Every test suite calls `resetFoundationDatabase()` or `resetEmptyFoundationDatabase()` which performs DROP SCHEMA CASCADE on the `app` and `pgboss` schemas. This is a destructive, non-atomic operation. If Vitest ever runs two integration test files concurrently (e.g., with `--pool=threads` and multiple workers sharing the same test database), interleaved resets would corrupt each other. The current vitest configuration presumably runs integration tests sequentially, but this constraint is not enforced at the code level — a future configuration change would produce mysterious failures.

**Evidence:**
```typescript
// test-database.ts
export async function resetFoundationDatabase(): Promise<void> {
  await dropApplicationSchemas(bootstrapDb);  // DROP SCHEMA CASCADE
  await runBootstrapSql(bootstrapDb);
  // ... all migrations ...
}
```

**Impact:**
Info: not an immediate bug. The structural impossibility of parallel execution limits test suite performance. As the suite grows, test run time will scale linearly with the number of files.

**Recommendation:**
Document the sequential-only constraint in `test-database.ts` with a comment. If parallel execution is ever desired, the architecture requires per-test-suite database namespacing (e.g., per-file `JARVIS_PGDATABASE` env var isolation, as mentioned in `fleet-operations` memory). The current approach is correct for a single-database sequential run.

---

### FINDING-20

**SEVERITY:** INFO
**Title:** `tasks-view.test.ts` — file is in `tests/integration/` but contains no integration (DB) assertions
**File:** `tests/integration/tasks-view.test.ts`
**Category:** Code quality / Organization

**Finding:**
`tasks-view.test.ts` tests pure functions (`quadrantOf`, `groupByPriority`, `PRIORITY_LEVELS`) from `@jarv1s/shared` with no database interaction, no server injection, and no network calls. It belongs in a unit test suite rather than the integration suite. Running it as part of the integration suite (which requires a running PostgreSQL instance) wastes DB setup time and obscures the distinction between unit and integration tests.

**Evidence:**
```typescript
// tasks-view.test.ts — no imports from test-database.ts, no DB or server usage
import { groupByPriority, PRIORITY_LEVELS, quadrantOf, type TaskDto } from "@jarv1s/shared";
describe("tasks-view", () => { /* pure function tests only */ });
```

**Impact:**
Info: no correctness issue. The tests are correct and valuable; they're just in the wrong location.

**Recommendation:**
Move `tasks-view.test.ts` to `tests/unit/` or a `packages/shared/__tests__/` location where it can run without requiring a PostgreSQL instance.

---

### FINDING-21

**SEVERITY:** INFO
**Title:** `chat-recall.test.ts` — multiple describe blocks use `resetFoundationDatabase()` vs `resetEmptyFoundationDatabase()` inconsistently across file sections
**File:** `tests/integration/chat-recall.test.ts`
**Category:** Test infrastructure / Consistency

**Finding:**
The file opens with `describe("Phase 3 Recall migrations")` using `resetEmptyFoundationDatabase()` (no seed users). The next two describes ("ChatMemoryFactsRepository", "ChatUserMemorySettingsRepository") each call `resetFoundationDatabase()` (with seed users including `ids.userA`). The final describe ("Memory controls REST API") also uses `resetFoundationDatabase()`. The first describe leaves the database in an empty state; the second describe then resets it again with seed data. This is correct but potentially surprising to a reader who expects the migration assertions (empty DB) to remain in scope.

**Evidence:**
```typescript
// First describe:
beforeAll(async () => { await resetEmptyFoundationDatabase(); });
// Second describe:
beforeAll(async () => { await resetFoundationDatabase(); });  // resets and seeds
```

**Impact:**
Info: no bug. The pattern is correct — each describe is self-contained with its own reset. The inconsistency in reset type is intentional (migration tests don't need seed users).

**Recommendation:**
Add brief comments to each `beforeAll` explaining why `resetEmpty` vs `resetFull` is chosen, to make the intent explicit for future maintainers.

---

## Coverage Gaps

The following areas lack integration test coverage or have weak coverage:

### GAP-01: action_requests INSERT RLS policy not directly tested
**Severity:** MEDIUM
The `ai_assistant_action_requests` INSERT RLS policy (the known "action_requests INSERT policy trap" from project memory) is tested indirectly through the API layer in `ai-tools.test.ts`. However, there is no direct test that a DataContext-scoped user cannot insert an `action_request` row claiming a different `owner_user_id`. The `shares.test.ts` pattern ("forbids inserting a share that claims another user as owner") should be replicated for `ai_assistant_action_requests`. The `release-hardening.test.ts` verifies `forceRls: true` for this table, which is good, but the INSERT policy shape is not tested.

### GAP-02: No test for `better_auth_sessions` token lifecycle (create, expire, invalidate)
**Severity:** MEDIUM
`release-hardening.test.ts` verifies that `app_runtime` and `worker_runtime` cannot SELECT from `auth_sessions` and `auth_verifications`. `auth-settings.test.ts` tests sign-up and sign-in flows through Better Auth. However, no test verifies the full session lifecycle: that a revoked/expired session token is rejected by `AuthSessionResolver`, or that session invalidation (sign-out) immediately prevents subsequent API calls. This is a critical auth correctness gap.

### GAP-03: No test for vault path traversal with unicode or null-byte injection
**Severity:** LOW
`vault.test.ts` tests `../` path traversal blocking. It does not test unicode normalization attacks (e.g., `%2F`, `/`, or null-byte injection `filename\x00.txt`). The VaultContextRunner implementation may or may not handle these; without a test, a future refactor could accidentally introduce a traversal vector.

### GAP-04: No integration test for the MCP allowlist enforcement
**Severity:** LOW
`mcp-gateway.test.ts` tests that read tools execute and write tools block pending confirmation. It does not test that a tool not on the allowlist is rejected. The `example-tool-module.ts` fixture includes `example.declaration-only` which is excluded from `tools/list`, but there is no test that directly calling `tools/call` with `example.declaration-only` returns an error rather than silently succeeding.

### GAP-05: No test for concurrent session token registry collision
**Severity:** LOW
`chat-mcp-transport.test.ts` tests single-actor token flows. No test verifies that two concurrent sessions with the same `chatSessionId` (e.g., duplicate mint) are handled correctly, or that token expiry is enforced.

### GAP-06: `briefings.test.ts` — `isBriefingRunPayloadMetadataOnly` is tested by calling the library's own validator
**Severity:** LOW
The briefing worker payload test calls `isBriefingRunPayloadMetadataOnly(payload ?? {})` to assert that the payload is metadata-only. This is circular — it uses the same library function that the production code uses to validate its own output. If the validator has a bug that accepts non-metadata fields, both the production code and the test would accept it. A more robust test would assert the payload keys directly (enumerate acceptable fields and reject any others).

---

## Summary Table

| ID | Severity | Title | File |
|----|----------|-------|------|
| FINDING-01 | HIGH | `connectors-google.test.ts` env var leak — no save/restore | `tests/integration/connectors-google.test.ts` |
| FINDING-02 | HIGH | 5 ms sleep for timestamp ordering — flakiness risk | `tests/integration/chat-live.test.ts` |
| FINDING-03 | HIGH | `appDb` created without `afterAll` teardown | `tests/integration/chat-live.test.ts` |
| FINDING-04 | HIGH | `appDb` created without `afterAll` teardown | `tests/integration/mcp-gateway.test.ts` |
| FINDING-05 | MEDIUM | 50 ms timing assumption for write-blocking confirmation | `tests/integration/mcp-gateway.test.ts` |
| FINDING-06 | MEDIUM | Write-side ownership forge not tested (CommitmentsRepository/PreferencesRepository) | `tests/integration/structured-state.test.ts` |
| FINDING-07 | MEDIUM | Vector search RLS tested by absence, not adversarial block | `tests/integration/memory.test.ts` |
| FINDING-08 | MEDIUM | Connector secret fixture is a literal sentinel, not real encryption | `tests/integration/ai-tools.test.ts` |
| FINDING-09 | MEDIUM | Share seeded in test body persists without cleanup | `tests/integration/foundation.test.ts` |
| FINDING-10 | MEDIUM | Dead admin resource-grants-for-tasks API not removed | `tests/integration/auth-settings.test.ts` |
| FINDING-11 | MEDIUM | Three pg-boss start/stop cycles for unrelated describe blocks | `tests/integration/tasks-web-contract.test.ts` |
| FINDING-12 | MEDIUM | ChatMemoryFactsRepository RLS test is trivially empty-array | `tests/integration/chat-recall.test.ts` |
| FINDING-13 | LOW | `cliAvailable` assertion is a type-check, not behavioral | `tests/integration/ai.test.ts` |
| FINDING-14 | LOW | Workspace seed data is dead weight post-Slice-1f | `tests/integration/test-database.ts` |
| FINDING-15 | LOW | Intentional connection string in fixture triggers secret scanners | `tests/integration/fixtures/example-tool-module.ts` |
| FINDING-16 | LOW | `beforeEach` full DB reset is unnecessary for pure-function tests | `tests/integration/release-hardening.test.ts` |
| FINDING-17 | LOW | Share seeded in test body creates order dependency (acknowledged) | `tests/integration/calendar-email.test.ts` |
| FINDING-18 | LOW | Update-denied-by-RLS test does not first confirm read visibility | `tests/integration/tasks.test.ts` |
| FINDING-19 | INFO | Parallel execution structurally impossible — not documented | `tests/integration/test-database.ts` |
| FINDING-20 | INFO | Pure-function tests in integration suite — should be in unit suite | `tests/integration/tasks-view.test.ts` |
| FINDING-21 | INFO | `resetEmpty` vs `resetFull` choice undocumented in multi-describe file | `tests/integration/chat-recall.test.ts` |
| GAP-01 | MEDIUM | No direct test for `action_requests` INSERT RLS ownership forge | `tests/integration/ai-tools.test.ts` |
| GAP-02 | MEDIUM | No test for expired/revoked session token rejection | (missing) |
| GAP-03 | LOW | No vault traversal test for unicode/null-byte injection | `tests/integration/vault.test.ts` |
| GAP-04 | LOW | No test for calling a declaration-only tool via `tools/call` | `tests/integration/mcp-gateway.test.ts` |
| GAP-05 | LOW | No test for concurrent session token registry collision | `tests/integration/chat-mcp-transport.test.ts` |
| GAP-06 | LOW | Briefing payload validation is circular (validator tests itself) | `tests/integration/briefings.test.ts` |

---

## Strengths

The following patterns are done well and should be preserved or replicated:

- **Correct env var save/restore** in `connectors.test.ts`, `ai.test.ts`, `api-rate-limit.test.ts`, `auth-settings.test.ts`, and `chat-live-api.test.ts`. The `connectors-google.test.ts` gap is the exception, not the rule.
- **Bootstrap connection for seed data** used consistently across all suites. Seeding through the bootstrap role (bypassing RLS) rather than through the app role is the correct approach for test setup.
- **Dedicated user UUIDs per describe block** in `memory.test.ts` (0x11 through 0x18) prevents cross-describe data collisions — an excellent isolation pattern that should be replicated in other multi-describe files.
- **Cross-user IDOR guard test** in `chat-mcp-transport.test.ts` ("cross-user resolve does NOT unblock the owner's pending call") is a strong adversarial security test.
- **`shares.test.ts` INSERT RLS forge prevention** test is the gold standard for ownership enforcement testing.
- **`release-hardening.test.ts`** provides a comprehensive mechanical check of role privileges, forced RLS, and DELETE grant absence — these assertions catch infrastructure regressions that would otherwise require manual DB inspection.
- **`foundation.test.ts` SET LOCAL leakage test** ("identity set in one transaction does not leak to the next query after rollback") directly tests the RLS session-variable isolation invariant.
- **`VaultContextRunner` path traversal test** covers the basic attack vector with clear assertions.
- **Worker payload isolation tests** in `tasks.test.ts` and `briefings.test.ts` correctly verify that pg-boss payloads contain only metadata IDs, not private content.
