# Audit Slice H — Migration/Job Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden migration/job infrastructure by adding cross-directory version uniqueness enforcement, revoking a dead UPDATE grant on `chat_messages`, enforcing `incognito` column immutability via a DB trigger, adding a `sendJob` send-side wrapper that blocks non-metadata payloads, and narrowing pgboss runtime grants to least-privilege.

**Architecture:** Five targeted infrastructure fixes — two versioned SQL migrations (in `packages/chat/sql/`, last on the migration spine), one grants-file update (`infra/postgres/grants/`), a TypeScript send-side guard exported from `packages/jobs`, and a cross-directory version uniqueness assertion exported from `packages/db/src/migrations/sql-runner.ts` and called in `scripts/migrate.ts`. All code changes are confined to the specified files; no module's internal tables or APIs are touched across module boundaries.

**Tech Stack:** TypeScript, Postgres 17, pg-boss v12, Kysely, Vitest, Fastify REST

---

## Serialization note

This slice's two versioned migrations (`packages/chat/sql/`) must land AFTER all Slice A, B, and G migration files. Migration version numbers are assigned at build time — do not pre-assign them, and scan ALL migration directories globally (not just `packages/chat/sql/`) when picking them, because the runner keys `schema_migrations` on the numeric `version` prefix across every directory (current global max is `0055`). The migration prefix (`NNNN`) used in SQL file names below is a placeholder; substitute the next available global number when creating the files.

**Constraint — extend, never contract, the consume-side guards.** The per-queue inbound validators live in `packages/tasks/src/jobs.ts:52` (`isDeferredTaskStatusPayloadMetadataOnly`) and `packages/briefings/src/jobs.ts:55` (`isBriefingRunPayloadMetadataOnly`) — NOT in `packages/jobs/src/pg-boss.ts` (the spec's location claim is wrong). This slice ADDS the send-side `sendJob` guard; it must not weaken or remove those consume-side validators.

**Test-file note.** Tasks 4, 5, and 6 each add a `describe` with its own `resetFoundationDatabase()` in `beforeAll`, so `foundation.test.ts` resets the DB up to four times. Sequential execution within one file makes this safe, but each reset wipes prior describes' seeds — keep every describe fully self-seeding (e.g. Task 5 re-inserts its own thread after its reset).

---

### Task 1: Export `assertUniqueMigrationVersions` + `loadMigrationFiles` from `packages/db/src/migrations/sql-runner.ts`

**Files:**

- Modify: `packages/db/src/migrations/sql-runner.ts` (currently 179 lines — promote `MigrationFile` to an export, add `assertUniqueMigrationVersions` and an exported `loadMigrationFiles` wrapper after `runSqlFiles`)
- Modify: `scripts/migrate.ts` (currently 47 lines — load all migration directories and assert uniqueness BEFORE the first `runSqlMigrations` call)
- Test: `tests/integration/foundation.test.ts` (add describe block to existing file)

**Why the assertion must run BEFORE any migration runs:** the primary collision mode (same `version`, different content) makes `runSqlMigrations` throw `"Migration X has changed after being applied"` (`sql-runner.ts:63`) _inside_ its run loop, so wiring the check after the migration loop never executes it — the script dies first with a misleading error. The same-content mode is only detectable after the first duplicate is already applied. The check therefore loads the files from every migration directory up front and asserts on the merged set before the first `runSqlMigrations` call. This requires exporting a file-loading helper (`loadMigrationFiles`), not deriving the set from `applied`+`skipped`.

#### Steps

- [ ] **Step 1.1 — Write the failing test.**

  Add to `tests/integration/foundation.test.ts` a new `describe` block after all existing tests. Import `assertUniqueMigrationVersions` and the `MigrationFile` type from `@jarv1s/db` (the package's `exports` map only exposes `"."` and `"./probes"` — `@jarv1s/db/migrations/sql-runner` is NOT a valid subpath and would fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`, so import from the package root from the start):

  ```typescript
  import { assertUniqueMigrationVersions, type MigrationFile } from "@jarv1s/db";
  // ... (add to top-level imports if not already present)

  describe("assertUniqueMigrationVersions (#124)", () => {
    it("throws when two migration files from different directories share the same version prefix", () => {
      const files: MigrationFile[] = [
        { version: "0055", name: "0055_foo.sql", checksum: "aaa", sql: "SELECT 1;" },
        { version: "0055", name: "0055_bar.sql", checksum: "bbb", sql: "SELECT 2;" }
      ];
      expect(() => assertUniqueMigrationVersions(files)).toThrow(
        "Duplicate migration version numbers across directories: 0055"
      );
    });

    it("does not throw when all version prefixes are unique", () => {
      const files: MigrationFile[] = [
        { version: "0054", name: "0054_a.sql", checksum: "aaa", sql: "SELECT 1;" },
        { version: "0055", name: "0055_b.sql", checksum: "bbb", sql: "SELECT 2;" }
      ];
      expect(() => assertUniqueMigrationVersions(files)).not.toThrow();
    });
  });
  ```

  Run the failing test:

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: FAIL — `assertUniqueMigrationVersions` is not exported from `@jarv1s/db`.

- [ ] **Step 1.2 — Export `MigrationFile`, `assertUniqueMigrationVersions`, and `loadMigrationFiles` from `packages/db/src/migrations/sql-runner.ts`.**

  In `packages/db/src/migrations/sql-runner.ts`:
  1. Change the `MigrationFile` interface (currently `interface MigrationFile` at line 27) to `export interface MigrationFile` so the test and `scripts/migrate.ts` can use the type:

  ```typescript
  export interface MigrationFile {
    readonly version: string;
    readonly name: string;
    readonly checksum: string;
    readonly sql: string;
  }
  ```

  2. Add the new exports after `runSqlFiles` (after line 116, before `async function readMigrationFiles` at line 118). `loadMigrationFiles` is a thin exported wrapper over the existing private `readMigrationFiles` so the migrate script can load directories without re-implementing checksum logic; `readMigrationFiles` itself stays private:

  ```typescript
  export async function loadMigrationFiles(directory: string): Promise<MigrationFile[]> {
    return readMigrationFiles(directory);
  }

  export function assertUniqueMigrationVersions(files: MigrationFile[]): void {
    const seen = new Set<string>();
    const duplicates = files.map((f) => f.version).filter((v) => seen.size === seen.add(v).size);
    if (duplicates.length > 0) {
      throw new Error(
        `Duplicate migration version numbers across directories: ${[...new Set(duplicates)].join(", ")}`
      );
    }
  }
  ```

  Run the test:

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: PASS on the new tests, all existing tests still pass.

- [ ] **Step 1.3 — Wire the assertion into `scripts/migrate.ts` BEFORE the first `runSqlMigrations` call.**

  `scripts/migrate.ts` imports `getJarvisDatabaseUrls, runSqlFiles, runSqlMigrations` from `@jarv1s/db` (line 4). Add `assertUniqueMigrationVersions` and `loadMigrationFiles`:

  ```typescript
  import {
    assertUniqueMigrationVersions,
    getJarvisDatabaseUrls,
    loadMigrationFiles,
    runSqlFiles,
    runSqlMigrations
  } from "@jarv1s/db";
  ```

  The current file declares `migrationsDirectory` (line 12) and then calls `runSqlMigrations` for the root dir (lines 17-22) and each module dir from `getBuiltInSqlMigrationDirectories()` (lines 24-31). Insert the uniqueness check AFTER `runSqlFiles(urls.bootstrap, …)` (line 15) but BEFORE the `const migrationResults = [ … ]` block (line 17). It loads files from the same directory set the runner will use and asserts on the merged list — so a cross-directory collision aborts the run before any migration is applied or hash-checked:

  ```typescript
  const allMigrationDirectories = [migrationsDirectory, ...getBuiltInSqlMigrationDirectories()];
  const allMigrationFiles = (
    await Promise.all(allMigrationDirectories.map((dir) => loadMigrationFiles(dir)))
  ).flat();
  assertUniqueMigrationVersions(allMigrationFiles);
  ```

  `getBuiltInSqlMigrationDirectories` is already imported at line 6. Do NOT include `bootstrapDirectory` or `grantsDirectory` — those run via `runSqlFiles`, not the versioned migration runner, and may legitimately reuse numeric prefixes.

- [ ] **Step 1.4 — Confirm the re-export path.**

  `packages/db/src/index.ts` line 5 already contains `export * from "./migrations/sql-runner.js"`, so `assertUniqueMigrationVersions`, `loadMigrationFiles`, and `MigrationFile` are automatically available from `@jarv1s/db` once exported from `sql-runner.ts`. No change to `index.ts` is needed.

  Run:

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: PASS.

  Then run typecheck:

  ```
  pnpm typecheck
  ```

  Expected: no errors related to the new exports.

- [ ] **Step 1.5 — Commit.**
  ```
  git add packages/db/src/migrations/sql-runner.ts scripts/migrate.ts tests/integration/foundation.test.ts
  git commit -m "feat(db): cross-dir migration version collision guard, asserted before any migration runs (#124)"
  ```

---

### Task 2: `sendJob` send-side wrapper in `packages/jobs/src/pg-boss.ts`

**Files:**

- Modify: `packages/jobs/src/pg-boss.ts` (currently 109 lines — add `ALLOWED_PAYLOAD_KEYS`, `assertMetadataOnlyPayload`, `sendJob` after `FOUNDATION_QUEUES`, line 36)
- Test: `tests/integration/foundation.test.ts` (add `describe` block for #157 send-side guard)

#### Steps

- [ ] **Step 2.0 — Enumerate the real payload keys in use (spec-required verification, not optional).**

  The spec (#157) requires the build agent to enumerate the actual payload keys at every send site and escalate if any carries content. Do this before hardcoding `ALLOWED_PAYLOAD_KEYS`:
  1. List every send site:

     ```
     grep -rn "boss\.send(" packages/ --include="*.ts"
     ```

     (Today: `packages/chat/src/live/persistence.ts:137-138`, `packages/tasks/src/routes.ts:270`, `packages/briefings/src/routes.ts:136`.)

  2. For each, read the payload type/literal and enumerate its keys. Verified key sources:
     - `EmbedTurnJobPayload` (`packages/chat/src/jobs.ts:26-29`): `actorUserId`, `threadId`, `messageId`.
     - `ExtractFactsJobPayload` (`packages/chat/src/jobs.ts:31-33`): `actorUserId`, `threadId`.
     - `DeferredTaskStatusPayload` (`packages/tasks/src/jobs.ts`; literal built at `packages/tasks/src/routes.ts:257-269`): `actorUserId`, `taskId`, `requestedStatus`, `idempotencyKey`.
     - `BriefingRunPayload` (`packages/briefings/src/jobs.ts`; literal at `packages/briefings/src/routes.ts`): `actorUserId`, `briefingRunId`, `definitionId`, `runKind`, `idempotencyKey`.
     - `RlsProbeJobPayload` (`packages/jobs/src/pg-boss.ts:18-20`): `actorUserId`, `targetItemId`.

  3. Diff the union of those keys against `ALLOWED_PAYLOAD_KEYS` in Step 2.2. The set below already covers every key found today. **Hard-blocker escalation rule (spec #157):** if any send-site payload key name contains `content`, `prompt`, `body`, `text`, `secret`, `token`, or `credential`, STOP and escalate to the coordinator — do not add it to the allow-list. (No such key exists today; this guard protects against drift between plan-writing and build time.)

- [ ] **Step 2.1 — Write the failing test.**

  Add to `tests/integration/foundation.test.ts` (unit-style, no DB needed):

  ```typescript
  import { sendJob } from "@jarv1s/jobs";
  // (add to top-level imports)

  describe("sendJob send-side guard (#157)", () => {
    it("throws when payload contains a forbidden key 'content'", async () => {
      // Use a real PgBoss instance is not required — the guard fires before boss.send()
      const fakeBoss = { send: async () => "fake-id" } as unknown as import("pg-boss").PgBoss;
      await expect(
        sendJob(fakeBoss, "test-queue", {
          actorUserId: "00000000-0000-4000-8000-000000000001",
          content: "secret"
        } as unknown as import("@jarv1s/jobs").ActorScopedJobPayload)
      ).rejects.toThrow("Job payload contains non-metadata keys: content");
    });

    it("does not throw for a valid metadata-only payload", async () => {
      let sent = false;
      const fakeBoss = {
        send: async () => {
          sent = true;
          return "fake-id";
        }
      } as unknown as import("pg-boss").PgBoss;
      await sendJob(fakeBoss, "test-queue", {
        actorUserId: "00000000-0000-4000-8000-000000000001",
        taskId: "some-task-id",
        requestedStatus: "done",
        idempotencyKey: "k1"
      } as unknown as import("@jarv1s/jobs").ActorScopedJobPayload);
      expect(sent).toBe(true);
    });
  });
  ```

  Run:

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: FAIL — `sendJob is not exported from @jarv1s/jobs`.

- [ ] **Step 2.2 — Add `ALLOWED_PAYLOAD_KEYS`, `assertMetadataOnlyPayload`, and `sendJob` to `packages/jobs/src/pg-boss.ts`.**

  Insert after the `FOUNDATION_QUEUES` constant (after line 36) and before `createPgBossClient` (line 38):

  ```typescript
  /**
   * The complete set of allowed metadata keys for all pg-boss payloads in this codebase.
   * Enumerated from all live boss.send() / sendJob() call sites.
   * Hard invariant: no key that carries content, prompts, secrets, or tokens may appear here.
   */
  export const ALLOWED_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
    "actorUserId",
    "taskId",
    "requestedStatus",
    "definitionId",
    "briefingRunId",
    "runKind",
    "threadId",
    "messageId",
    "targetItemId",
    "kind",
    "resourceId",
    "idempotencyKey"
  ]);

  function assertMetadataOnlyPayload(payload: Record<string, unknown>): void {
    const forbidden = Object.keys(payload).filter((k) => !ALLOWED_PAYLOAD_KEYS.has(k));
    if (forbidden.length > 0) {
      throw new Error(
        `Job payload contains non-metadata keys: ${forbidden.join(", ")}. ` +
          `Payloads must contain only: ${[...ALLOWED_PAYLOAD_KEYS].join(", ")}`
      );
    }
  }

  /**
   * Send-side wrapper that enforces the metadata-only payload invariant before
   * delegating to boss.send(). Use this everywhere instead of raw boss.send().
   * The optional `options` passthrough preserves pg-boss send semantics
   * (singletonKey/startAfter/retryLimit) so future callers never need to bypass
   * the wrapper and re-violate the boss.send ban.
   */
  export async function sendJob<T extends ActorScopedJobPayload>(
    boss: PgBoss,
    queue: string,
    payload: T,
    options?: PgBoss.SendOptions
  ): Promise<string | null> {
    assertMetadataOnlyPayload(payload as unknown as Record<string, unknown>);
    return options === undefined ? boss.send(queue, payload) : boss.send(queue, payload, options);
  }
  ```

  Note: `PgBoss` is imported as a value at the top of this file (line 2, from `pg-boss`); the `PgBoss.SendOptions` namespace type is available without a new import.

  Run:

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: PASS on the new tests.

- [ ] **Step 2.3 — Commit.**
  ```
  git add packages/jobs/src/pg-boss.ts tests/integration/foundation.test.ts
  git commit -m "feat(jobs): sendJob send-side wrapper — metadata-only payload enforcement (#157)"
  ```

---

### Task 3: Migrate all raw `boss.send()` call sites to `sendJob`

**Files:**

- Modify: `packages/chat/package.json` (add `@jarv1s/jobs` dependency — see Step 3.0)
- Modify: `packages/chat/src/live/persistence.ts` (lines 137–138)
- Modify: `packages/tasks/src/routes.ts` (line 270)
- Modify: `packages/briefings/src/routes.ts` (line 136)

#### Steps

- [ ] **Step 3.0 — Declare the `@jarv1s/jobs` dependency in `packages/chat/package.json`.**

  `packages/chat/package.json` does NOT currently declare `@jarv1s/jobs` (its deps are `@jarv1s/ai`, `@jarv1s/db`, `@jarv1s/module-sdk`, `@jarv1s/shared`, `fastify`, `kysely`). Without this, `import { sendJob } from "@jarv1s/jobs"` in `persistence.ts` fails to resolve under pnpm strict workspace resolution and both typecheck and the chat suites break. Add to the `dependencies` block:

  ```json
  "@jarv1s/jobs": "workspace:*",
  ```

  Then run `pnpm install` to update the lockfile. (`packages/tasks` and `packages/briefings` already declare `@jarv1s/jobs` — verified — so only chat needs this.) Include `packages/chat/package.json` and `pnpm-lock.yaml` in the Step 3.7 commit.

- [ ] **Step 3.1 — Migrate `packages/chat/src/live/persistence.ts` (lines 137–138).**

  Add a new `@jarv1s/jobs` import at the top of the file (the file currently imports only `PgBoss` from `pg-boss` at line 13 and `EmbedTurnJobPayload`/`ExtractFactsJobPayload` from `../jobs.js` at lines 15-20 — there is no existing `@jarv1s/jobs` import, so add one):

  ```typescript
  import { sendJob } from "@jarv1s/jobs";
  ```

  Replace lines 137–138:

  ```typescript
  // Before:
  await this.boss.send(CHAT_EMBED_TURN_QUEUE, embedPayload);
  await this.boss.send(CHAT_EXTRACT_FACTS_QUEUE, extractPayload);

  // After:
  await sendJob(this.boss, CHAT_EMBED_TURN_QUEUE, embedPayload);
  await sendJob(this.boss, CHAT_EXTRACT_FACTS_QUEUE, extractPayload);
  ```

- [ ] **Step 3.2 — Migrate `packages/tasks/src/routes.ts` (line 270).**

  `packages/tasks` already declares `@jarv1s/jobs` as a dependency, but line 26 imports `isDeferredTaskStatusPayloadMetadataOnly` from the LOCAL `./jobs.js`, not from `@jarv1s/jobs` — the file has no `@jarv1s/jobs` import today. Add a new import:

  ```typescript
  import { sendJob } from "@jarv1s/jobs";
  ```

  Replace line 270:

  ```typescript
  // Before:
  const jobId = await dependencies.boss.send(TASKS_DEFERRED_STATUS_QUEUE, payload);

  // After:
  const jobId = await sendJob(dependencies.boss, TASKS_DEFERRED_STATUS_QUEUE, payload);
  ```

- [ ] **Step 3.3 — Migrate `packages/briefings/src/routes.ts` (line 136).**

  Add `sendJob` to the `@jarv1s/jobs` import in `packages/briefings/src/routes.ts`:

  ```typescript
  import { sendJob } from "@jarv1s/jobs";
  ```

  Replace line 136:

  ```typescript
  // Before:
  const jobId = await dependencies.boss.send(BRIEFINGS_RUN_QUEUE, payload);

  // After:
  const jobId = await sendJob(dependencies.boss, BRIEFINGS_RUN_QUEUE, payload);
  ```

- [ ] **Step 3.4 — Run the grep gate to confirm zero remaining raw `boss.send()` calls.**

  ```
  grep -rn "boss\.send(" packages/ --include="*.ts"
  ```

  Expected: zero matches. If any remain, migrate them before proceeding.

- [ ] **Step 3.5 — Run typecheck.**

  ```
  pnpm typecheck
  ```

  Expected: no errors.

- [ ] **Step 3.6 — Run the affected module suites.**

  ```
  vitest run tests/integration/tasks.test.ts
  vitest run tests/integration/briefings.test.ts
  vitest run tests/integration/chat-live.test.ts tests/integration/chat-live-api.test.ts tests/integration/chat-recall.test.ts tests/integration/chat-mcp-transport.test.ts tests/integration/chat-token-budgets.test.ts
  ```

  Expected: all PASS.

- [ ] **Step 3.7 — Commit.**
  ```
  git add packages/chat/package.json pnpm-lock.yaml packages/chat/src/live/persistence.ts packages/tasks/src/routes.ts packages/briefings/src/routes.ts
  git commit -m "refactor(jobs): replace raw boss.send with sendJob at all call sites (#157)"
  ```

---

### Task 4: Migration — REVOKE dead UPDATE grant on `chat_messages` + narrow RLS policy (#134)

**Files:**

- Create: `packages/chat/sql/<NNNN>_revoke_app_runtime_chat_update.sql` (NNNN = next available number after all Slice A/B/G migrations)
- Test: `tests/integration/foundation.test.ts` (add `describe` block for #134 privilege check)

#### Steps

- [ ] **Step 4.1 — Write the failing test.**

  Add to `tests/integration/foundation.test.ts` (requires DB — use `connectionStrings.bootstrap` for privilege queries, run after `resetFoundationDatabase()` — place inside an existing `beforeAll`-backed describe or create a self-contained one):

  This describe asserts BOTH halves of the migration: the grant revoke AND the RLS-policy shape. The grant-only test would pass even if the policy were botched to `USING (true)` (the blocker-2 regression), so the `pg_policies` assertion is mandatory — it pins the role list to `jarvis_worker_runtime` only and confirms the owner-scoping predicate survives.

  ```typescript
  describe("chat_messages UPDATE grant revoked + policy narrowed (#134)", () => {
    beforeAll(async () => {
      await resetFoundationDatabase();
    });

    it("jarvis_app_runtime cannot UPDATE app.chat_messages after migration", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
      await client.connect();
      try {
        const result = await client.query<{ has_privilege: boolean }>(
          `SELECT has_table_privilege('jarvis_app_runtime', 'app.chat_messages', 'update') AS has_privilege`
        );
        expect(result.rows[0]?.has_privilege).toBe(false);
      } finally {
        await client.end();
      }
    });

    it("chat_messages_update policy targets only jarvis_worker_runtime and keeps owner scoping", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
      await client.connect();
      try {
        const result = await client.query<{
          roles: string[];
          qual: string | null;
          with_check: string | null;
        }>(
          `SELECT roles, qual, with_check
             FROM pg_policies
            WHERE schemaname = 'app'
              AND tablename = 'chat_messages'
              AND policyname = 'chat_messages_update'`
        );
        const policy = result.rows[0];
        expect(policy).toBeDefined();
        // Role list narrowed: jarvis_app_runtime must be gone, worker present.
        expect(policy?.roles).toContain("jarvis_worker_runtime");
        expect(policy?.roles).not.toContain("jarvis_app_runtime");
        // Owner scoping preserved on BOTH USING (qual) and WITH CHECK — NOT `true`.
        expect(policy?.qual).toContain("owner_user_id = current_actor_user_id()");
        expect(policy?.with_check).toContain("owner_user_id = current_actor_user_id()");
      } finally {
        await client.end();
      }
    });
  });
  ```

  Note: `pg_policies.qual`/`with_check` render the predicate with the function call as `app.current_actor_user_id()` collapsed to its resolved form — Postgres typically prints it as `(owner_user_id = current_actor_user_id())` (the `app.` schema qualifier is dropped in the deparsed expression when `app` is on the search_path). Match on the substring `owner_user_id = current_actor_user_id()`; if the local Postgres prints the schema-qualified form, widen the assertion to also accept `app.current_actor_user_id()`. The load-bearing check is that it is NOT `true`.

  Run:

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: FAIL — `has_privilege` is `true` (the grant from `0035_chat_messages_update_grant.sql` is still present); the policy row still lists `jarvis_app_runtime`.

- [ ] **Step 4.2 — Determine the next available migration number (GLOBAL scan — not chat-only).**

  Migration versions are GLOBAL across all directories — the runner keys `schema_migrations` on `version` only. Scanning `packages/chat/sql/` alone (max `0049`) would pick `0050`, which COLLIDES with the already-applied `0050_multi_user_accounts.sql` and triggers the exact "has changed"/silent-skip trap this slice's #124 fix exists to prevent. Scan every migration directory:

  ```
  ls infra/postgres/migrations/*.sql packages/*/sql/*.sql | sed 's|.*/||' | sort | tail -1
  ```

  Current global max is `0055_users_guard_admin_flag_v2.sql`. Pick a number strictly greater than `0055` AND strictly greater than every new Slice A/B/G migration present on the integration branch at build time (this slice is last on the migration spine). The file is referred to here as `<NNNN>_revoke_app_runtime_chat_update.sql`; substitute the real number at build time.

- [ ] **Step 4.3 — Create `packages/chat/sql/<NNNN>_revoke_app_runtime_chat_update.sql`.**

  ```sql
  -- Revoke the dead UPDATE grant on chat_messages from jarvis_app_runtime.
  -- Granted by 0035; no app_runtime code path updates chat messages (only jarvis_worker_runtime does).
  REVOKE UPDATE ON app.chat_messages FROM jarvis_app_runtime;

  -- Narrow the chat_messages_update RLS policy to worker_runtime only.
  -- Recreated (not ALTER) to avoid syntax gotchas; DROP IF EXISTS is safe.
  -- The owner-scoped USING/WITH CHECK predicate is PRESERVED VERBATIM from
  -- 0036_chat_worker_runtime_grants.sql:58-59 — this ONLY drops jarvis_app_runtime
  -- from the role list. Replacing it with USING (true) would let the worker update
  -- any user's chat messages regardless of the withDataContext actor, violating the
  -- "RLS applies to all actors / private-by-default" hard invariant.
  DROP POLICY IF EXISTS chat_messages_update ON app.chat_messages;
  CREATE POLICY chat_messages_update ON app.chat_messages
    FOR UPDATE
    TO jarvis_worker_runtime
    USING (owner_user_id = app.current_actor_user_id())
    WITH CHECK (owner_user_id = app.current_actor_user_id());
  ```

- [ ] **Step 4.4 — Run `pnpm db:migrate` and confirm migration is applied.**

  ```
  pnpm db:migrate
  ```

  Expected: the new migration file appears in the applied list. No errors.

- [ ] **Step 4.5 — Re-run the test.**

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: PASS — `has_privilege` is `false`.

- [ ] **Step 4.6 — Verify existing chat suites still pass.**

  ```
  vitest run tests/integration/chat-live.test.ts tests/integration/chat-live-api.test.ts tests/integration/chat-recall.test.ts tests/integration/chat-mcp-transport.test.ts tests/integration/chat-token-budgets.test.ts
  ```

  Expected: all PASS.

- [ ] **Step 4.7 — Commit.**
  ```
  git add "packages/chat/sql/<NNNN>_revoke_app_runtime_chat_update.sql" tests/integration/foundation.test.ts
  git commit -m "fix(chat): revoke dead UPDATE grant + narrow chat_messages_update RLS to worker (#134)"
  ```

---

### Task 5: Migration — `incognito` immutability trigger on `chat_threads` (#135)

**Files:**

- Create: `packages/chat/sql/<NNNN+1>_chat_threads_incognito_immutable.sql` (must have a higher number than Task 4's migration)
- Test: `tests/integration/foundation.test.ts` (add `describe` block for #135 trigger)

#### Steps

- [ ] **Step 5.1 — Write the failing test.**

  Add to `tests/integration/foundation.test.ts` (requires DB — inside a describe that has `resetFoundationDatabase()` in `beforeAll`; a new self-contained describe is fine):

  ```typescript
  describe("chat_threads incognito immutability trigger (#135)", () => {
    const threadId = "99000000-0000-4000-8000-000000000001";

    beforeAll(async () => {
      await resetFoundationDatabase();
      // Seed: insert a chat thread as userA via the migration role (to bypass RLS for setup).
      const client = new pg.Client({ connectionString: connectionStrings.migration });
      await client.connect();
      try {
        await client.query(
          `INSERT INTO app.chat_threads (id, owner_user_id, title, incognito)
           VALUES ($1, $2, 'Test Thread', false)`,
          [threadId, ids.userA]
        );
      } finally {
        await client.end();
      }
    });

    it("raises 42501 when attempting to UPDATE incognito on an existing chat_thread", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.migration });
      await client.connect();
      try {
        await expect(
          client.query(`UPDATE app.chat_threads SET incognito = true WHERE id = $1`, [threadId])
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await client.end();
      }
    });

    it("does NOT raise on UPDATE of a non-incognito column (title)", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.migration });
      await client.connect();
      try {
        await expect(
          client.query(`UPDATE app.chat_threads SET title = 'Renamed Thread' WHERE id = $1`, [
            threadId
          ])
        ).resolves.not.toThrow();
      } finally {
        await client.end();
      }
    });
  });
  ```

  Run:

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: FAIL — the UPDATE of `incognito` does NOT raise `42501` (trigger not yet created).

- [ ] **Step 5.2 — Determine the migration number (GLOBAL scan).**

  Apply the same global-scan rule as Step 4.2 — the file must have a prefix strictly greater than Task 4's migration (and therefore greater than `0055` and every Slice A/B/G migration). Re-run the global scan after Task 4's file exists:

  ```
  ls infra/postgres/migrations/*.sql packages/*/sql/*.sql | sed 's|.*/||' | sort | tail -1
  ```

  Take the next number above that. Referred to as `<NNNN+1>_chat_threads_incognito_immutable.sql` here.

- [ ] **Step 5.3 — Create `packages/chat/sql/<NNNN+1>_chat_threads_incognito_immutable.sql`.**

  ```sql
  -- Enforce immutability of the incognito column on chat_threads after row creation.
  -- The column name is 'incognito' (not 'is_incognito') — verified from 0042_chat_memory_settings.sql.
  CREATE OR REPLACE FUNCTION app.chat_threads_guard_incognito()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.incognito IS DISTINCT FROM OLD.incognito THEN
      RAISE EXCEPTION 'incognito is immutable after creation'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS chat_threads_guard_incognito ON app.chat_threads;
  CREATE TRIGGER chat_threads_guard_incognito
    BEFORE UPDATE ON app.chat_threads
    FOR EACH ROW EXECUTE FUNCTION app.chat_threads_guard_incognito();
  ```

- [ ] **Step 5.4 — Run `pnpm db:migrate` and confirm migration is applied.**

  ```
  pnpm db:migrate
  ```

  Expected: the new migration file appears in the applied list. No errors.

- [ ] **Step 5.5 — Re-run the test.**

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: PASS — `42501` is raised for `incognito` update; title update succeeds.

- [ ] **Step 5.6 — Verify chat suites.**

  ```
  vitest run tests/integration/chat-live.test.ts tests/integration/chat-live-api.test.ts tests/integration/chat-recall.test.ts tests/integration/chat-mcp-transport.test.ts tests/integration/chat-token-budgets.test.ts
  ```

  Expected: all PASS.

- [ ] **Step 5.7 — Confirm `is_incognito` never appears in new files.**

  ```
  grep -rn "is_incognito" packages/chat/sql/ tests/
  ```

  Expected: zero matches.

- [ ] **Step 5.8 — Commit.**
  ```
  git add "packages/chat/sql/<NNNN+1>_chat_threads_incognito_immutable.sql" tests/integration/foundation.test.ts
  git commit -m "fix(chat): add incognito immutability trigger on chat_threads (#135)"
  ```

---

### Task 6: Narrowed pgboss runtime grants (#174)

**Files:**

- Modify: `infra/postgres/grants/0001_pgboss_runtime_grants.sql` (currently 9 lines — replace blanket `ALL TABLES` grant with per-table grants)
- Test: `tests/integration/foundation.test.ts` (add `describe` block for #174 privilege checks)

#### Steps

- [ ] **Step 6.1 — Write the failing tests.**

  Add to `tests/integration/foundation.test.ts`:

  ```typescript
  describe("pgboss narrowed grants (#174)", () => {
    beforeAll(async () => {
      await resetFoundationDatabase();
    });

    it("jarvis_app_runtime cannot UPDATE pgboss.job after narrowing", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
      await client.connect();
      try {
        const result = await client.query<{ has_privilege: boolean }>(
          `SELECT has_table_privilege('jarvis_app_runtime', 'pgboss.job', 'update') AS has_privilege`
        );
        expect(result.rows[0]?.has_privilege).toBe(false);
      } finally {
        await client.end();
      }
    });

    it("jarvis_worker_runtime can UPDATE pgboss.job after narrowing", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
      await client.connect();
      try {
        const result = await client.query<{ has_privilege: boolean }>(
          `SELECT has_table_privilege('jarvis_worker_runtime', 'pgboss.job', 'update') AS has_privilege`
        );
        expect(result.rows[0]?.has_privilege).toBe(true);
      } finally {
        await client.end();
      }
    });

    it("jarvis_app_runtime can SELECT pgboss.queue (required for boss.send)", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
      await client.connect();
      try {
        const result = await client.query<{ has_privilege: boolean }>(
          `SELECT has_table_privilege('jarvis_app_runtime', 'pgboss.queue', 'select') AS has_privilege`
        );
        expect(result.rows[0]?.has_privilege).toBe(true);
      } finally {
        await client.end();
      }
    });

    it("jarvis_app_runtime cannot DELETE from pgboss.job", async () => {
      const client = new pg.Client({ connectionString: connectionStrings.bootstrap });
      await client.connect();
      try {
        const result = await client.query<{ has_privilege: boolean }>(
          `SELECT has_table_privilege('jarvis_app_runtime', 'pgboss.job', 'delete') AS has_privilege`
        );
        expect(result.rows[0]?.has_privilege).toBe(false);
      } finally {
        await client.end();
      }
    });
  });
  ```

  Run:

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: FAIL — `jarvis_app_runtime` still has UPDATE on `pgboss.job` (blanket grant not yet narrowed).

- [ ] **Step 6.2a — Verify the live pgboss table set BEFORE writing the matrix (mandatory — do not hardcode table names from memory).**

  pg-boss 12.18.2 does NOT have `job_archive` or `partition` tables (those names are from older pg-boss versions). Granting on a non-existent table makes `runSqlFiles` throw `relation "pgboss.job_archive" does not exist`, which fails `pnpm db:migrate` AND `resetFoundationDatabase()` (`tests/integration/test-database.ts:49` re-applies the grants dir), breaking every integration suite. Query the live schema first:

  ```
  pnpm db:up   # if not already running
  ```

  Then, against the dev DB (bootstrap connection), enumerate the real tables:

  ```sql
  SELECT relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'pgboss'
     AND c.relkind IN ('r', 'p')
   ORDER BY relname;
  ```

  In pg-boss 12.18.2 this returns exactly: `bam`, `job` (partitioned), `job_common`, `queue`, `schedule`, `subscription`, `version`, `warning`. Build the grant matrix ONLY from tables that appear here. There is no `job_archive` and no `partition` — do not reference them.

- [ ] **Step 6.2b — Rewrite `infra/postgres/grants/0001_pgboss_runtime_grants.sql`.**

  Replace the entire file contents with the narrowed per-table grant matrix built from the verified table set. The file is re-applied idempotently on each `pnpm db:migrate` run (via `runSqlFiles`), so plain REVOKE is safe (it is a no-op in Postgres if the privilege is not held). Both client roles run `schedule:false` and `supervise:false` (`packages/jobs/src/pg-boss.ts:45-46`), so no maintenance DELETE grants are needed — confirm via the Step 6.5 suites:

  ```sql
  GRANT USAGE ON SCHEMA pgboss TO jarvis_app_runtime, jarvis_worker_runtime;

  GRANT USAGE ON TYPE pgboss.job_state TO jarvis_app_runtime, jarvis_worker_runtime;

  -- Revoke the blanket ALL TABLES grant before applying narrowed per-table grants.
  -- REVOKE is a no-op if the privilege is not currently held, so this is idempotent.
  REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM jarvis_app_runtime, jarvis_worker_runtime;

  -- pgboss.job: app_runtime sends (SELECT+INSERT); worker_runtime processes (SELECT+INSERT+UPDATE).
  -- NOTE: pgboss.job is a partitioned table — granting on the parent cascades to partitions.
  GRANT SELECT, INSERT ON pgboss.job TO jarvis_app_runtime;
  GRANT SELECT, INSERT, UPDATE ON pgboss.job TO jarvis_worker_runtime;

  -- pgboss.queue: both roles need SELECT (pg-boss v12 reads queue on every send/work call)
  GRANT SELECT ON pgboss.queue TO jarvis_app_runtime, jarvis_worker_runtime;

  -- pgboss.subscription: both roles need SELECT
  GRANT SELECT ON pgboss.subscription TO jarvis_app_runtime, jarvis_worker_runtime;

  -- pgboss.version: both roles need SELECT (version handshake)
  GRANT SELECT ON pgboss.version TO jarvis_app_runtime, jarvis_worker_runtime;

  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC;
  ```

  Note: `pgboss.schedule` is intentionally omitted — no code calls `boss.schedule()` and both client roles run `schedule:false`, so neither role needs access to it. `pgboss.bam`, `pgboss.job_common`, and `pgboss.warning` are internal/maintenance tables not touched by the app/worker send-and-work paths; leave them with no runtime grant (they fall under the blanket REVOKE). If Step 6.5's suites reveal a missing privilege, add the minimal grant the failing query needs — do not re-add a blanket grant.

- [ ] **Step 6.3 — Run `pnpm db:migrate` and confirm grants file is re-applied.**

  ```
  pnpm db:migrate
  ```

  Expected: no errors. The grants file is always re-applied by `runSqlFiles`.

- [ ] **Step 6.4 — Re-run the tests.**

  ```
  vitest run tests/integration/foundation.test.ts
  ```

  Expected: PASS on all four new privilege tests.

- [ ] **Step 6.5 — Run the full integration suite to confirm pgboss job dispatch still works.**

  ```
  pnpm test:tasks
  vitest run tests/integration/briefings.test.ts
  ```

  Expected: all PASS (job dispatch uses `pgboss.queue` and `pgboss.job`; grant matrix retains correct access).

- [ ] **Step 6.6 — Commit.**
  ```
  git add infra/postgres/grants/0001_pgboss_runtime_grants.sql tests/integration/foundation.test.ts
  git commit -m "fix(infra): narrow pgboss runtime grants to least-privilege per role (#174)"
  ```

---

### Task 7: Acceptance greps + final gate

**Files:**

- No source changes — verification only.

#### Steps

- [ ] **Step 7.1 — Grep gate: zero raw `boss.send()` calls in packages.**

  ```
  grep -rn "boss\.send(" packages/ --include="*.ts"
  ```

  Expected: zero matches.

- [ ] **Step 7.2 — Grep gate: `is_incognito` never used anywhere in chat SQL or tests.**

  ```
  grep -rn "is_incognito" packages/ tests/ --include="*.ts" --include="*.sql"
  ```

  Expected: zero matches.

- [ ] **Step 7.3 — Grep gate: `0035_chat_messages_update_grant.sql` is not modified (NEVER edit applied migrations).**

  ```
  git diff HEAD -- packages/chat/sql/0035_chat_messages_update_grant.sql
  git diff HEAD -- packages/chat/sql/0042_chat_memory_settings.sql
  ```

  Expected: both diffs are empty (no changes to applied migrations).

- [ ] **Step 7.4 — Grep gate: confirm new chat migrations live in `packages/chat/sql/`, NOT `infra/postgres/migrations/`.**

  ```
  ls infra/postgres/migrations/ | grep -E "revoke_app_runtime_chat|incognito_immutable"
  ```

  Expected: zero matches (the files must be in `packages/chat/sql/`, not here).

- [ ] **Step 7.5 — Grep gate: `pgboss.queue` is present in the grants file.**

  ```
  grep "pgboss.queue" infra/postgres/grants/0001_pgboss_runtime_grants.sql
  ```

  Expected: at least one match confirming `pgboss.queue` has an explicit GRANT.

- [ ] **Step 7.6 — Run `pnpm test:tasks` and the full chat suite.**

  ```
  pnpm test:tasks
  vitest run tests/integration/chat-live.test.ts tests/integration/chat-live-api.test.ts tests/integration/chat-recall.test.ts tests/integration/chat-mcp-transport.test.ts tests/integration/chat-token-budgets.test.ts
  ```

  Expected: all PASS.

- [ ] **Step 7.7 — Run `pnpm verify:foundation`.**
  ```
  pnpm verify:foundation
  ```
  Expected: green (lint, format:check, check:file-size, typecheck, db:migrate, test:integration all pass).
