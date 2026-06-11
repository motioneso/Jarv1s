# E2E Tests & Operator Scripts — Thermo-Nuclear Quality Audit

**Auditor:** Claude Sonnet 4.6 (subagent)
**Date:** 2026-06-10
**Scope:** `tests/e2e/`, `tests/slow/`, `scripts/`

---

## Summary

The e2e test suite and operator scripts are largely well-structured with clear intent. However,
there are several significant gaps and a few hard-invariant violations. The most critical issues
are: (1) the `audit-release-hardening` script omits 12+ RLS-protected tables from its coverage
check — a hard-invariant violation — and (2) `delete-user-data.ts` does not delete vault
filesystem files, leaving orphaned user data after a deletion operation. Additionally, the
`backup-full.sh` script uses `eval` with an operator-controlled environment variable, which is a
code-injection vector.

---

## Findings

---

### [CRITICAL] audit-release-hardening omits 12 RLS-protected tables

- **File:** `scripts/audit-release-hardening.ts:30-45`
- **Category:** Security
- **Finding:** The `protectedTables` list in the audit script covers only 14 tables. At least 12
  additional tables in the `app` schema have `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL
  SECURITY` applied in their migrations, but are never checked by the audit. The audit claims to
  verify the "hard invariants" around forced RLS and DELETE privilege restrictions but silently
  skips a large portion of the schema.
- **Evidence:**
  Tables with FORCE RLS that are not in `protectedTables` or `transientTables`:
  ```
  app.memory_chunks           (packages/memory/sql/0030_memory_index.sql)
  app.memory_links            (packages/memory/sql/0030_memory_index.sql)
  app.memory_file_index       (packages/memory/sql/0032_memory_embedding_768.sql)
  app.chat_memory_facts       (packages/memory/sql/0041_memory_facts.sql)
  app.chat_user_memory_settings (packages/chat/sql/0042_chat_memory_settings.sql)
  app.task_lists              (packages/tasks/sql/0039_tasks_foundation.sql)
  app.task_tags               (packages/tasks/sql/0039_tasks_foundation.sql)
  app.task_tag_assignments    (packages/tasks/sql/0039_tasks_foundation.sql)
  app.task_preferences        (packages/tasks/sql/0039_tasks_foundation.sql)
  app.connector_definitions   (packages/connectors/sql/0009_connectors_module.sql)
  app.commitments             (packages/structured-state/sql/0031_structured_state.sql)
  app.entities                (packages/structured-state/sql/0031_structured_state.sql)
  app.preferences             (packages/structured-state/sql/0031_structured_state.sql)
  ```
  The integration test at `tests/integration/release-hardening.test.ts:174` asserts
  `report.passed === true`, which passes today only because the gaps are not checked.
- **Impact:** If any of these tables has its FORCE RLS accidentally removed, or if
  `jarvis_app_runtime` or `jarvis_worker_runtime` is inadvertently granted DELETE, the audit will
  not catch it. The audit's `passed: true` result gives false confidence. This directly violates
  the "No admin private-data bypass" and "Private by default" hard invariants.
- **Recommendation:** Add all 13 tables above to `protectedTables` (or `transientTables` for
  `connector_definitions`, `preferences` if appropriate). Maintain a sync mechanism — e.g., a
  comment listing the authoritative set — so new modules must update the audit when they add an
  RLS table. The integration test should also assert a minimum table count so silent omissions
  are caught.

---

### [HIGH] delete-user-data does not delete vault filesystem files

- **File:** `scripts/delete-user-data.ts` (entire file)
- **Category:** Security
- **Finding:** `deleteUserData` deletes all database rows for a user but makes no attempt to
  remove the user's vault directory at `{JARVIS_VAULT_ROOT}/{userId}/`. The vault stores raw
  markdown files — personal notes, imported content — on disk.
- **Evidence:** `VaultContextRunner` creates per-user directories at `join(this.vaultsBaseDir, accessContext.actorUserId)` (`packages/vault/src/vault-context.ts:31`). The delete script has no reference to vault, VaultContext, or filesystem operations.
  Database memory tables (`memory_chunks`, `memory_links`, `memory_file_index`,
  `chat_memory_facts`) cascade-delete via FK on `app.users`, so the DB side is handled. But the
  flat files backing those embeddings remain on disk permanently after user deletion.
- **Impact:** After an operator runs `pnpm delete:user`, the user's vault directory survives
  indefinitely. This is a data-completeness failure for GDPR-style right-to-erasure requests and
  leaves potentially sensitive personal content orphaned on the host filesystem.
- **Recommendation:** Add a `--vault-root` parameter (or read `JARVIS_VAULT_ROOT`) and
  `rm -rf {vaultRoot}/{userId}` as part of the deletion flow, gated on the same `--execute`
  confirmation flag. Also update the release-hardening integration test to seed a vault file and
  assert it is gone after deletion.

---

### [HIGH] backup-full.sh uses eval with operator-controlled environment variable

- **File:** `scripts/backup-full.sh:112-114`
- **Category:** Security
- **Finding:** The off-host copy command is executed via:
  ```bash
  eval "${OFFHOST_CMD/\{\}/$ARCHIVE}"
  ```
  `OFFHOST_CMD` is read directly from the environment. Any shell metacharacters in `OFFHOST_CMD`
  or in `$ARCHIVE` (the timestamped archive path) are executed as shell code.
- **Evidence:**
  ```bash
  OFFHOST_CMD="${JARVIS_BACKUP_OFFHOST_CMD:-}"
  ...
  eval "${OFFHOST_CMD/\{\}/$ARCHIVE}"
  ```
  If `JARVIS_BACKUP_OFFHOST_CMD` contains `; rm -rf /` or similar, `eval` will execute it.
  While this is an operator script rather than a network-facing surface, production deployments
  often set environment variables via CI/CD pipelines, config management tools, or shared
  `.env` files where an injection could be introduced unintentionally.
- **Impact:** Code injection / arbitrary command execution on the backup host. The backup process
  runs with whatever privilege level the operator script uses — potentially root in a Docker
  context.
- **Recommendation:** Replace `eval` with an explicit array-based invocation. The `{}` placeholder
  pattern can be supported safely:
  ```bash
  run_offhost() {
    local cmd="${OFFHOST_CMD/\{\}/$ARCHIVE}"
    # Use read -ra to split on whitespace without eval
    local -a parts
    read -ra parts <<< "$cmd"
    "${parts[@]}"
  }
  ```
  Or document that `JARVIS_BACKUP_OFFHOST_CMD` must be a simple command with `{}` as a literal
  placeholder and validate that no shell metacharacters are present before calling it.

---

### [HIGH] smoke-compose polls /health (unconditional 200) instead of /health/ready (DB + pg-boss check)

- **File:** `scripts/smoke-compose.ts:27`
- **Category:** Tests
- **Finding:** The smoke test waits for `http://localhost:{port}/health`. The server unconditionally
  returns `{ ok: true }` from `/health` regardless of database connectivity or worker state.
  The meaningful health check is at `/health/ready`, which verifies DB reachability and pg-boss
  status and returns 503 if either is unhealthy.
- **Evidence:**
  ```typescript
  // smoke-compose.ts:27
  healthUrl: `http://localhost:${apiPort}/health`,
  ```
  ```typescript
  // apps/api/src/server.ts:68
  server.get("/health", async () => ({ ok: true }));  // never 503

  server.get("/health/ready", async (_, reply) => {   // checks db + pgboss
    const healthy = dbStatus === "ok" && pgbossStatus === "ok";
    .code(healthy ? 200 : 503)
  ```
  The integration test at `tests/integration/release-hardening.test.ts:328` asserts
  `composePlan.healthUrl === "http://localhost:3900/health"`, which codifies the incorrect URL.
- **Impact:** The compose smoke test can pass (and report "Compose smoke passed") even when the
  API cannot reach the database. A Postgres misconfiguration, failed migration, or pg-boss
  bootstrap failure would be invisible to the smoke check.
- **Recommendation:** Change `healthUrl` to `/health/ready` and update the integration test
  assertion to match. If the readiness endpoint is not yet reliably settling within the 60s
  window, investigate and fix the readiness logic rather than using the trivial endpoint.

---

### [MEDIUM] Mock admin routes ignore authentication state

- **File:** `tests/e2e/mock-api.ts:104-120`
- **Category:** Tests
- **Finding:** `mockApi` registers handlers for `/api/admin/auth/providers`,
  `/api/admin/workspaces`, and `/api/admin/connectors/accounts` that always return 200 regardless
  of `state.authenticated`. By contrast, `/api/me` and `/api/modules` correctly return 401 when
  `!state.authenticated`.
- **Evidence:**
  ```typescript
  // Always 200, no auth check:
  await page.route("**/api/admin/auth/providers", (route) =>
    fulfillJson(route, 200, { providers: [...] })
  );
  await page.route("**/api/admin/workspaces", (route) =>
    fulfillJson(route, 200, { workspaces: meResponse.workspaces })
  );
  ```
  vs.
  ```typescript
  // Correct auth gating:
  await page.route("**/api/me", (route) =>
    state.authenticated
      ? fulfillJson(route, 200, meResponse)
      : fulfillJson(route, 401, { error: "Session is missing or expired" })
  );
  ```
- **Impact:** E2E tests that begin with `authenticated: false` (sign-in flow) will never discover
  if the frontend inadvertently calls admin endpoints before the session is established. Any
  regression where the settings page issues admin API calls before authentication is complete
  would pass the e2e suite silently.
- **Recommendation:** Apply the same `state.authenticated` guard to all admin route mocks:
  ```typescript
  await page.route("**/api/admin/auth/providers", (route) =>
    state.authenticated
      ? fulfillJson(route, 200, { providers: [...] })
      : fulfillJson(route, 401, { error: "Session is missing or expired" })
  );
  ```

---

### [MEDIUM] delete-user-data pre-deletion count report omits memory and new module tables

- **File:** `scripts/delete-user-data.ts:28-49`
- **Category:** Quality
- **Finding:** The `userScopedCountQueries` array — which generates the `countsBeforeDelete`
  report — does not include any of the memory module tables
  (`memory_chunks`, `memory_links`, `memory_file_index`, `chat_memory_facts`),
  `chat_user_memory_settings`, `connector_oauth_pending`, or structured-state tables
  (`commitments`, `entities`, `preferences`). These tables are correctly cleaned up by CASCADE
  FK constraints when `app.users` is deleted, but their before-delete counts are invisible in
  the audit report.
- **Evidence:**
  The count queries list 20 entries, none of which are memory-module tables, despite those
  tables holding per-user data (with `ON DELETE CASCADE` on `owner_user_id`).
- **Impact:** Operators reviewing the deletion audit output cannot confirm that memory-index
  rows, facts, and structured-state items were present and have been removed. This makes
  post-deletion verification harder and can mask situations where the CASCADE did not behave as
  expected (e.g., if the FK was accidentally dropped in a future migration).
- **Recommendation:** Add all CASCADE-linked per-user tables to `userScopedCountQueries`. This
  is reporting-only (the deletion itself is correct via CASCADE), but the report should be
  complete. Also add an assertion in the integration test that these counts are
  non-zero before deletion and zero after.

---

### [MEDIUM] export-user-data omits memory-module and chat memory tables

- **File:** `scripts/export-user-data.ts:110-131`
- **Category:** Quality
- **Finding:** The user data export does not include rows from `memory_chunks`,
  `memory_links`, `memory_file_index`, `chat_memory_facts`, or `chat_user_memory_settings`.
  These tables hold user-authored content (vault notes ingested as searchable chunks, extracted
  facts from chat sessions, and memory toggle preferences) and are integral to the user's stored
  profile.
- **Evidence:** `readExportTables` at line 110 lists 19 tables. Memory module tables are absent.
  The `UserDataExportTables` interface likewise has no corresponding fields.
- **Impact:** A user exercising a GDPR data access request would receive an incomplete picture
  of their stored data. Specifically, they would not see the text excerpts and embeddings derived
  from their vault notes, nor the facts extracted from their chat history.
- **Recommendation:** Add queries for `memory_chunks`, `chat_memory_facts`,
  `chat_user_memory_settings` to the export. (Raw vector embeddings in `memory_file_index` are
  not human-readable; consider including the `source_path` and `source_hash` columns but
  omitting the embedding vector itself to keep the export useful.) Update the integration test
  to seed and assert these tables.

---

### [MEDIUM] readSelectedTools in mock-chat-api throws on any tool other than tasks.updateStatus

- **File:** `tests/e2e/mock-chat-api.ts:197-211`
- **Category:** Tests
- **Finding:** `readSelectedTools` contains a hard-coded allowlist of exactly one tool
  (`tasks.updateStatus`). Any test that sends a chat POST with a different `selectedToolNames`
  entry will throw `Error: Unknown mock assistant tool: <name>`, crashing the mock handler and
  causing the test to fail with a confusing 500-style error rather than a useful assertion.
- **Evidence:**
  ```typescript
  return [...new Set(selectedToolNames)].map((name) => {
    if (name !== "tasks.updateStatus") {
      throw new Error(`Unknown mock assistant tool: ${name}`);
    }
    ...
  });
  ```
- **Impact:** As the assistant tool surface grows (additional modules register tools), any e2e
  test that exercises those tools will fail silently with a generic error. New tools are
  enumerated in `createMockAiAssistantTools()` in `mock-api.ts` but are not handled in the
  chat POST handler.
- **Recommendation:** Either expand `readSelectedTools` to handle all tools listed in
  `createMockAiAssistantTools()`, or make it return a generic metadata record for any unknown
  tool name with `risk: "read"` as a safe default, logging a warning rather than throwing.

---

### [MEDIUM] E2E coverage gap: no tests for chat memory settings, facts management, or provider switch

- **File:** `tests/e2e/` (all spec files)
- **Category:** Tests
- **Finding:** The following real API surfaces have zero e2e test coverage:
  - `GET/PATCH /api/chat/memory/settings` — toggle memory on/off per user
  - `GET /api/chat/memory/facts` — list extracted facts
  - `DELETE /api/chat/memory/facts/:id` — delete a specific fact
  - `PATCH /api/chat/memory/facts/:id` — edit a fact
  - `POST /api/chat/switch` — re-launch chat on a different provider
  - All admin workspace/membership/resource-grant/audit-events management routes
  None of these endpoints have corresponding mock route handlers in `mock-chat-api.ts` or
  `mock-api.ts`, meaning any e2e test that accidentally triggered them would fall through to the
  real Vite dev server and likely 404.
- **Evidence:** Searching `tests/e2e/` for `chat/memory`, `chat/switch` returns no matches.
  `packages/chat/src/routes.ts:158-212` registers five memory-related endpoints.
- **Impact:** Regressions in these flows — broken UI toggle, missing delete confirmation,
  failed switch — would not be caught by the e2e suite.
- **Recommendation:** Add mock handlers in `registerMockChatRoutes` for all memory and switch
  routes. Add at least one e2e test exercising the memory toggle (enable/disable via settings)
  and verifying that facts list renders. The admin flows can be deferred but should be tracked
  as a gap.

---

### [MEDIUM] E2E coverage gap: task delete, status transitions, subtask creation not tested

- **File:** `tests/e2e/tasks.spec.ts`, `tests/e2e/app-shell.spec.ts`
- **Category:** Tests
- **Finding:** The task e2e tests only cover: creating a task, viewing the priority view, and
  toggling to the matrix view. The following task flows have no e2e coverage:
  - Completing a task (status → "done") and confirming it disappears from the default filter
  - Deleting a task
  - Creating and viewing a subtask
  - Assigning tags
  - Setting/changing the due date via the UI
  - Drag-to-reorder in the matrix view (only the toggle is tested, not interactions within it)
  The mock returns an empty array for `GET /api/tasks/*/subtasks` but no test exercises the
  subtask creation flow.
- **Evidence:** `handleTaskDetailRoute` supports `PATCH` (update) but there is no `DELETE`
  handler for tasks in the mock, and no test calls a PATCH that changes status to "done".
- **Impact:** These are the highest-traffic task flows. Regressions in task completion, deletion,
  or tag assignment would not be caught before deployment.
- **Recommendation:** Add e2e tests for task completion (status change to "done" with UI
  confirmation), task deletion, and at least a stub for subtask display. Extend
  `handleTaskDetailRoute` to handle `DELETE`.

---

### [LOW] Export file written without restrictive permissions

- **File:** `scripts/export-user-data.ts:101`
- **Category:** Security
- **Finding:** The export JSON file is written with `writeFile(outputFile, ..., "utf8")` using no
  explicit `mode` argument. The file will be created with the process umask (typically `0o644` or
  `0o666 & ~umask`), meaning it may be group- or world-readable on shared servers.
- **Evidence:**
  ```typescript
  await writeFile(outputFile, `${JSON.stringify(userExport, null, 2)}\n`, "utf8");
  ```
  The export contains auth account metadata, session records (without raw tokens, but with
  timestamps and IP addresses), and full task/calendar/email content for the user.
- **Impact:** On a multi-user server or in CI environments where the export directory is shared,
  another user or process could read the export before the operator moves or deletes it.
- **Recommendation:** Use `{ mode: 0o600 }` in the `writeFile` call (owner-read/write only):
  ```typescript
  await writeFile(outputFile, `${JSON.stringify(userExport, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  ```

---

### [LOW] rewrap-secrets mixes bootstrap connection with DataContextRunner RLS context

- **File:** `scripts/rewrap-secrets.ts:28,31,65-68`
- **Category:** Architecture
- **Finding:** The script creates a Kysely database using the `bootstrap` (postgres superuser)
  connection, then passes that instance to `DataContextRunner`. Inside
  `dataContext.withDataContext(accessContext, ...)`, the session local variables
  `app.actor_user_id` and `app.request_id` are set, but the underlying role is still the
  postgres superuser — which is the table owner and bypasses FORCE RLS. The comment at line 33
  correctly documents this for the owner-enumeration queries, but the same bypass applies to the
  per-user `SELECT ... FOR UPDATE` and `UPDATE` queries inside the `withDataContext` callback.
  This is architecturally inconsistent: the code signals "this is a scoped user operation" via
  `DataContextRunner` but is actually running as a superuser without RLS filtering.
- **Evidence:**
  ```typescript
  const db = createDatabase({ connectionString: getJarvisDatabaseUrls().bootstrap });
  const dataContext = new DataContextRunner(db);  // injects bootstrap db
  ...
  await dataContext.withDataContext(accessContext, async (scopedDb) => {
    // scopedDb.db is still running as postgres superuser — RLS is bypassed
    const connectorRows = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select(["id", "encrypted_secret"])
      .forUpdate()
      .execute();
  ```
- **Impact:** This is intentional (the rewrap script needs to see all users' rows) but
  architecturally deceptive. Future maintainers may not realize that `withDataContext` here
  provides no RLS isolation. Additionally, using the bootstrap connection for the
  `FOR UPDATE` locks means holding a superuser connection open for potentially long-running
  operations.
- **Recommendation:** Either: (a) drop the `DataContextRunner` wrapper entirely and use the raw
  `db` Kysely instance directly with explicit comments about the superuser bypass, or (b)
  document clearly in a top-of-function comment that this script intentionally bypasses RLS
  via the bootstrap role. The current code is misleading about the isolation level in effect.

---

### [LOW] mock-api.ts handleTaskDetailRoute applies UpdateTaskRequest spread without type safety

- **File:** `tests/e2e/mock-api.ts:689-696`
- **Category:** TypeScript
- **Finding:** The PATCH handler spreads the incoming `UpdateTaskRequest` directly onto the
  `TaskDto` object:
  ```typescript
  const updatedTask: TaskDto = {
    ...task,
    ...input,
    completedAt: input.status === "done" ? "2026-06-06T12:00:00.000Z" : task.completedAt,
    updatedAt: "2026-06-06T12:00:00.000Z"
  };
  ```
  `UpdateTaskRequest` is a partial with optional fields. Spreading it will set fields that are
  `undefined` in the input to `undefined` on the task DTO, potentially overwriting non-optional
  fields. TypeScript catches some of this but the cast to `TaskDto` suppresses the structural
  check.
- **Evidence:** If a test sends `{ status: "done" }` as the PATCH body, `title`, `description`,
  and other required `TaskDto` fields will be overwritten with `undefined` because
  `UpdateTaskRequest` includes them as optional.
- **Impact:** Mock state diverges from what the real API would return, making some behavioral
  assertions unreliable (the mock shows `undefined` title while the real API preserves it).
- **Recommendation:** Spread only defined keys from `input`:
  ```typescript
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined)
  );
  const updatedTask: TaskDto = { ...task, ...patch, updatedAt: "..." };
  ```

---

### [LOW] chat-drawer.spec.ts mocks /api/chat/turn but drawer no longer uses it

- **File:** `tests/e2e/chat-drawer.spec.ts:60-65`
- **Category:** Quality
- **Finding:** The chat drawer spec mocks `POST /api/chat/turn` with a reply body. The spec
  comment explicitly states "the drawer ignores this body; the stream renders." The mock is
  registered but the test never asserts anything about the response from `/api/chat/turn` — the
  turn mock exists solely to prevent a fall-through to the dev server.
- **Evidence:**
  ```typescript
  // POST /api/chat/turn → { reply } (the drawer ignores this body; the stream renders).
  await page.route("**/api/chat/turn", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reply: "Hello from the assistant" })
    })
  );
  ```
- **Impact:** Low: the mock is harmless. But it introduces a misleading test comment (the
  response body is never used) and masks the fact that the test does not verify the actual turn
  POST request is made (URL, body, method). A regression where the frontend stops calling
  `/api/chat/turn` entirely would not be detected.
- **Recommendation:** Either remove the mock and just `await page.route("**/api/chat/turn", ...)
  => route.fulfill({ status: 200 })` without a body, or add an assertion via
  `page.waitForRequest("**/api/chat/turn")` to verify the POST is actually sent.

---

### [LOW] connect-google.spec.ts does not verify the connector account appears after completion

- **File:** `tests/e2e/connect-google.spec.ts:27-30`
- **Category:** Tests
- **Finding:** The test verifies that the "Open Google consent" link disappears after
  `Finish connecting` is clicked, but does not assert that a new connector account is visible in
  the settings UI. The mock `handleGoogleCompleteRoute` adds an account to `state.connectorAccounts`,
  but the test never checks that the connector account panel reflects this.
- **Evidence:**
  ```typescript
  await page.getByRole("button", { name: "Finish connecting" }).click();
  // Only asserts link is gone — does not assert account appeared
  await expect(page.getByRole("link", { name: /Open Google consent/ })).not.toBeVisible();
  ```
- **Impact:** A regression where the "connected" state is not reflected in the UI (e.g., missing
  re-render after completion, wrong list query key) would pass this test.
- **Recommendation:** After the `not.toBeVisible()` assertion, add:
  ```typescript
  await expect(
    page.getByRole("region", { name: "Connector Accounts" }).getByText("Google")
  ).toBeVisible();
  ```

---

### [INFO] slow/memory-local-embed.test.ts correctly skipped from foundation gate

- **File:** `tests/slow/memory-local-embed.test.ts`
- **Category:** Tests
- **Finding:** This test downloads a model on first run and is correctly isolated in `tests/slow/`
  outside the `pnpm verify:foundation` gate. The test is meaningful and covers the critical
  semantic geometry invariant and idempotency of re-ingestion. The use of `TIMEOUT = 300_000`
  is appropriate. No issues found.

---

### [INFO] backup-database.ts correctly isolates PGPASSWORD from command-line arguments

- **File:** `scripts/backup-database.ts:46-51`
- **Category:** Security
- **Finding:** The backup plan correctly separates `PGPASSWORD` into an env object rather than
  passing it as a command-line argument. The integration test at `release-hardening.test.ts:318`
  verifies the password does not appear in the `args` array. This is the correct pattern.
  No issues found.

---

### [INFO] delete-user-data.ts correctly uses double-confirmation gate

- **File:** `scripts/delete-user-data.ts:56-57`
- **Category:** Security
- **Finding:** The script requires `confirmUserId === userId` before executing. This prevents
  accidental deletion when `--user-id` and `--confirm-user-id` are transposed. The dry-run
  default (`dryRun: true`) means invocation without `--execute` is always safe. The integration
  test covers this guard. No issues found.

---

## Coverage Map

| Area | Covered by e2e | Notable gaps |
|---|---|---|
| Auth sign-in/sign-out | Yes | Real session cookie lifecycle not tested |
| Tasks CRUD | Create, view | Delete, status transition, subtasks, tags |
| Notifications | List, mark read, mark all read | None major |
| Calendar/Email | Coming-soon state only | All API interactions |
| Connector settings | Add, revoke | Error recovery, re-auth flow |
| AI provider/model config | Full CRUD, capability routing | Multi-provider switching |
| Briefings | Create, edit, run | Scheduled briefings, cadence UI |
| Chat drawer | Open, send, clear | Memory settings, facts, provider switch |
| Chat action requests (approve/deny) | Yes | Timeout/expiry, concurrent requests |
| Admin routes | None (auth not tested for admin routes) | All admin flows |
| Memory settings | None | Toggle, facts list, edit/delete |

