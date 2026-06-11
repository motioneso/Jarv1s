## Phase 26 — Integration Tests

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 1
- MED: 5
- LOW: 5
- INFO: 4

### Findings

#### [HIGH] Cross-test data contamination: foundation `app.shares` rows leak across tests with no teardown
**File:** `tests/integration/foundation.test.ts:208-235` (and the `beforeAll` seed at `:54-65`)  
**Invariant violated / concern:** Test isolation / cleanup — a test that can affect another test's data.  
**Detail:** The suite has a single `resetFoundationDatabase()` in `beforeAll` and no `beforeEach`/teardown, so every `it` mutates a shared, accumulating DB. The "allows probe access through a view share" test (`:208`) inserts an `app.shares` 'view' grant on `itemAOwnPrivate` from userA→userB that is never removed; the author even flagged this in a comment at `:211` ("this share persists for the remainder of the suite (no teardown)"). This is load-bearing on test *ordering*: the suite's own negative assertions only hold because no later test asserts "userB cannot see `itemAOwnPrivate`". If a future negative-isolation test for that item is added below line 235 (the natural place), it will pass or fail depending on position in the file rather than on RLS correctness — the exact failure mode that erodes trust in an RLS test suite. The known-good fix is per-test seed/cleanup of `app.shares`, or distinct resource ids per assertion group (the pattern `shares.test.ts:18-21` already uses correctly). Until then the share-visibility and negative-visibility assertions are coupled and the suite is order-dependent.  
**Suggested fix:** Give the share-visibility test its own dedicated probe row (seeded in `beforeAll`) or delete the share in an `afterEach`/at end of the test, mirroring `shares.test.ts`'s distinct-resource-id discipline. Do not rely on "no later test asserts X".

#### [MED] action_requests / notifications INSERT WITH CHECK policy not exercised through a runtime role
**File:** `tests/integration/notifications.test.ts:325-364`; `tests/integration/ai.test.ts:103-169`  
**Invariant violated / concern:** Coverage gap on a known trap (MEMORY.md "Test Traps — action_requests INSERT policy"); private-by-default INSERT enforcement.  
**Detail:** Notifications rows are seeded exclusively via the `bootstrap` (superuser) client (`seedNotificationData`, `:331`), which bypasses RLS entirely. No test attempts an INSERT through `jarvis_app_runtime`/`withDataContext` that should be rejected by a `WITH CHECK` policy (e.g. an actor inserting a notification with a `recipient_user_id` other than themselves, or a forged `actor_user_id`). The only INSERT-policy negative test in the whole suite is `shares.test.ts:115-126` ("forbids inserting a share that claims another user as owner"). Notifications, `ai_assistant_action_requests`, calendar/email cache rows, memory chunks, and structured-state tables all assert SELECT-side RLS (owner/recipient visibility) but never assert the INSERT/UPDATE `WITH CHECK` arm rejects a forged-owner write. Given the explicit "action_requests INSERT policy" trap in project memory, this is a real coverage hole: a regression that weakens a WITH CHECK to `USING(true)` would not be caught.  
**Suggested fix:** Add one negative INSERT test per protected module: under `withDataContext(userB)`, attempt to insert a row claiming userA as owner/recipient/actor and assert it rejects with `/row-level security/i` (the `shares.test.ts:115` pattern).

#### [MED] Dead fixture `itemBWorkspaceShared` seeded but never asserted; stale workspace-visibility naming
**File:** `tests/integration/test-database.ts:26, 115-116, 124`  
**Invariant violated / concern:** Dead code / stale concept (DEVELOPMENT_STANDARDS — remove dead vocabulary in the same pass).  
**Detail:** `ids.itemBWorkspaceShared` is inserted in `seedProbeData` (`:115`) but is referenced by **zero** assertions anywhere in `tests/integration/*.test.ts` (grep-confirmed). It is identical in every meaningful way (userB-owned, no share) to `itemBWorkspacePrivate`, which *is* used. The names `itemBWorkspaceShared` / `itemBWorkspacePrivate` / `workspaceAlpha` carry workspace-visibility semantics that were permanently removed by migration `0028_workspace_teardown` (visibility/workspace_id columns dropped; AccessContext.workspaceId removed in Slice 1f). The fixtures now just describe "userB-owned private items," so the names actively mislead a reader into thinking workspace-scoped visibility still exists. `workspaceAlpha`/`workspace_memberships` themselves are still live (admin-org config feature, used by `ai-tools.test.ts:678`, `notifications.test.ts:259`), so only the probe-item fixtures are stale — but the dead `itemBWorkspaceShared` should go.  
**Suggested fix:** Delete `itemBWorkspaceShared` (id + INSERT row), and rename `itemBWorkspacePrivate` → `itemBSecondPrivate` (or similar) to drop the dead "Workspace" vocabulary.

#### [MED] `package.json` `test:notes` script points at a deleted test file
**File:** `package.json:42` (`"test:notes": "vitest run tests/integration/notes.test.ts"`)  
**Invariant violated / concern:** Dead code / stale concept — the notes module was torn down (`0027_notes_teardown.sql`; MEMORY.md "No Note Viewer").  
**Detail:** `tests/integration/notes.test.ts` does not exist (the notes module was removed). Running `pnpm test:notes` errors with "no test files found" rather than running anything meaningful. A dangling script for a deleted feature is exactly the stale-scaffolding smell the standards call out, and it can mask a real intent ("did notes coverage silently disappear?").  
**Suggested fix:** Remove the `test:notes` script line.

#### [MED] No integration coverage for `module-registry` / `module-sdk` collaboration boundary
**File:** `tests/integration/` (absence) — closest touch points `notifications.test.ts:115-122`, `foundation.test.ts:42-48`  
**Invariant violated / concern:** Coverage gap — Module isolation (modules collaborate only through declared public APIs/events).  
**Detail:** The module-isolation hard invariant (no module imports another's internals / queries its tables) has no dedicated integration test. Tests load `getBuiltInModuleManifests()` / `getBuiltInSqlMigrationDirectories()` for *setup*, and assert a manifest loads (`notifications.test.ts:115`), but nothing verifies the boundary itself: e.g. that a module's queue definitions, public API surface, and SQL-dir registration are internally consistent, or that cross-module event wiring routes only through declared events. A module that started importing another's repository or querying its tables directly would be caught only by lint/codegraph, not by the integration suite.  
**Suggested fix:** Add a small `module-registry.test.ts` asserting each registered module exposes only its declared public API, its `sql/` dir matches its manifest, and queue/event names are unique across modules.

#### [LOW] Weak negative RLS assertion: `.every(... !== ...)` instead of `toHaveLength(0)`
**File:** `tests/integration/memory.test.ts:223`; `tests/integration/structured-state.test.ts:92, 185`; `tests/integration/chat-recall.test.ts:187`  
**Invariant violated / concern:** Trivially-weak assertion (Tests dimension G) on a security boundary.  
**Detail:** Cross-user isolation is asserted as e.g. `expect(otherResults.every((r) => r.sourcePath !== path)).toBe(true)` (`memory.test.ts:223`). Because the "other user" has no seeded data in these cases, the strictly stronger and more honest assertion is `expect(otherResults).toHaveLength(0)`. `.every()` over an array that *should* be empty passes vacuously and would also pass if RLS leaked rows belonging to a *third* identity — it only catches a leak of this one specific row. For a private-by-default security assertion, prefer proving emptiness.  
**Suggested fix:** Where the other user genuinely has no data, assert `toHaveLength(0)` / `toEqual([])`. Where they do have data, keep `.every()` but also assert the count excludes the foreign id.

#### [LOW] Obscure structural assertion on frontmatter delimiter offsets
**File:** `tests/integration/structured-state.test.ts:327`  
**Invariant violated / concern:** Incidental complexity / unclear intent in a test assertion (Code quality C).  
**Detail:** `expect(content.indexOf("---")).not.toBe(content.lastIndexOf("---") - 3)` is a brittle, hard-to-read way to assert "old frontmatter was replaced, not duplicated." The `- 3` magic number couples the assertion to exact whitespace and will silently stop testing anything meaningful if the writer changes its delimiter spacing. The intent ("exactly one frontmatter block remains") deserves an explicit check.  
**Suggested fix:** Assert the count of `---` delimiters directly, e.g. `expect(content.match(/^---$/gm)?.length).toBe(2)`, which states the invariant plainly.

#### [LOW] `let x: string` then non-null-asserted `x!` across `withDataContext` boundaries
**File:** `tests/integration/structured-state.test.ts:84-92, 96-112, 116-136, 172-185`  
**Invariant violated / concern:** Unjustified non-null assertions muddying the real contract (TypeScript dimension D).  
**Detail:** The pattern `let title: string; await withDataContext(...,() => { title = ... }); ... title!` assigns inside an async callback and reads with `!` afterward. It works only because `withDataContext` awaits synchronously-completing assignment, but the `!` hides that the compiler cannot prove definite assignment — if a future refactor made the assignment conditional, the test would silently read `undefined` and the `.every(c => c.title !== title!)` check would compare against `undefined` (vacuously passing). This is the same vacuous-pass risk as the LOW above, introduced by the typing workaround.  
**Suggested fix:** Capture the created row's id as the *return value* of `withDataContext` (`const { id } = await withDataContext(...)`) and drop the `let` + `!` entirely.

#### [LOW] Two module-scope `afterAll` hooks in one file (vault, structured-state, memory)
**File:** `tests/integration/vault.test.ts:55, 107`; `tests/integration/structured-state.test.ts:54, 62`  
**Invariant violated / concern:** Incidental complexity / surprising lifecycle (Code quality C).  
**Detail:** Each file registers two top-level `afterAll` hooks (one for the DB pool, one to `rm` a tmp vault dir). Both run, so behavior is correct, but two file-scoped teardown hooks is a footgun: a reader can miss the second, and ordering between them is implicit. `structured-state.test.ts` even adds the second `afterAll` (`:62`) with a comment "add alongside existing afterAll," acknowledging the awkwardness.  
**Suggested fix:** Consolidate cleanup into a single `afterAll` per file that tears down all resources in one place.

#### [LOW] `tasks-view.test.ts` and `vault.test.ts` are pure/unit tests living under `tests/integration/`
**File:** `tests/integration/tasks-view.test.ts:1-55`; `tests/integration/vault.test.ts:1-182`  
**Invariant violated / concern:** Feature/layer placement — a pure-function/tmpdir test in the DB-integration tier.  
**Detail:** `tasks-view.test.ts` exercises only pure functions (`groupByPriority`, `quadrantOf`, `PRIORITY_LEVELS`) with no DB. `vault.test.ts` uses only `tmpdir()` and `node:fs`, no Postgres. They run inside `pnpm test:integration` (which requires `db:up`), inflating the "integration" tier with tests that have no DB dependency and could run far faster in `tests/unit`. This isn't wrong, but it blurs the tier boundary and slows the integration gate.  
**Suggested fix:** Move `tasks-view.test.ts` to `tests/unit/`; consider the same for `vault.test.ts` (it is filesystem-integration, defensible either way).  

#### [INFO] RLS cross-user isolation is genuinely and broadly tested — reviewed, strong
**File:** `tests/integration/foundation.test.ts:184-309`; `connectors.test.ts:340-352`; `tasks.test.ts`; `briefings.test.ts:275-303`; `calendar-email.test.ts:275-327`; `structured-state.test.ts:83-206`  
**Invariant violated / concern:** None — positive note.  
**Detail:** "User A cannot see user B's private row," "admin has no role-based bypass" (`foundation.test.ts:237`), and "view-share grants visibility / revoke removes it" are tested per module against the real Postgres runtime roles (`jarvis_app_runtime`, `jarvis_worker_runtime`) — not mocks. The worker-job path (`foundation.test.ts:292-356`) proves a pg-boss job re-applies RLS via stored actor context and that the worker cannot see unshared rows. No improper DB mocking exists anywhere in the suite (only `StubEmbeddingProvider`, injected `fetchFn`, and one `stubBoss` for a health-failure path — all legitimate). This is the strongest part of the suite.  

#### [INFO] Secret-never-escape assertions are present and meaningful across connectors/AI/calendar/auth
**File:** `tests/integration/connectors.test.ts:246-291,350-352,459-472`; `ai.test.ts:263-270,399-400,540`; `ai-tools.test.ts:418-421`; `auth-settings.test.ts:155-156`; `calendar-email.test.ts:426-427`; `connectors-google.test.ts:464-465`  
**Invariant violated / concern:** None — positive note.  
**Detail:** Tests assert plaintext secrets (`secret-access-token`, `secret-ai-api-key`, `clientSecret`, `accessToken`) and the `encrypted_secret`/`encrypted_credential` column names never appear in REST response bodies, list endpoints, or serialized payloads — across create, list, update, revoke, and admin-view paths. Briefings additionally proves pg-boss `job_common.data` payloads are metadata-only and contain no body/summary/prompt (`briefings.test.ts:356-385`, `foundation.test.ts:311-356`). Hardcoded credential-looking literals in the test files are all test-only fakes (`sk-test`, `test-ai-secret-key`); no real secrets are committed.  

#### [INFO] Shared-DB collision is mitigated by `fileParallelism: false` + `pool: "forks"`
**File:** `vitest.config.ts:` (test block, `fileParallelism: false`); `tests/integration/test-database.ts:30-50`  
**Invariant violated / concern:** None — confirms a latent risk is currently contained.  
**Detail:** Every integration file calls `resetFoundationDatabase()` / `resetEmptyFoundationDatabase()`, which `DROP SCHEMA ... CASCADE` and re-migrates the *single shared* database. This would catastrophically corrupt concurrent files, but `fileParallelism: false` serializes files and `pool: "forks"` isolates `process.env` mutations (rate-limit/AI-secret-key tests rely on this). The safety is therefore a config invariant: flipping `fileParallelism` to true, or adding per-file parallelism, would silently break the entire suite. Worth a comment in `vitest.config.ts` or `test-database.ts` documenting this dependency so it isn't lost.  

#### [INFO] Bearer-token auth path used by module tests is a real production path, not a test bypass — reviewed
**File:** `tests/integration/ai-tools.test.ts:671-690`; `packages/auth/src/index.ts:208-231`; `packages/db/src/auth-session.ts:11-31`  
**Invariant violated / concern:** None — confirms test fidelity.  
**Detail:** Module API tests authenticate via `authorization: Bearer ${ids.sessionA}` (a seeded `app.auth_sessions` UUID). This initially looks like a test-only auth shortcut, but `resolveRequestAccessContext` honors a Bearer token as the legacy-session primary path in *production* code (`auth/src/index.ts:217-218`, the CLI-bridge backup auth per MEMORY.md "Jarv1s Chat"), resolving through the SECURITY DEFINER `app.resolve_auth_session` (`db/src/auth-session.ts:17`). So these tests exercise a genuine code path, and `auth-settings.test.ts` separately covers the Better Auth cookie path. No fidelity gap.
