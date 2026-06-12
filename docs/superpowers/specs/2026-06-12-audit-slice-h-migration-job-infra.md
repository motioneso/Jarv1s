# Spec: Audit Slice H — Migration/Job Infrastructure

**Date:** 2026-06-12
**Audit issues:** #124, #134, #135, #157, #174
**Tier:** `security` (pgboss grants, incognito trigger, payload guard) + `sensitive` (#124)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 2 versioned migrations (#134 chat REVOKE, #135 incognito trigger) + 1 grants-file addition (#174; runs via `runSqlFiles`, not hash-checked). Migration numbers assigned at build time — do not pre-assign.
**Dependency:** Last on the migration spine (after A → B → D(if migration) → G(#99 if migration)).
The three new migrations must be the last to be assigned numbers in this run.

---

## Context

Five infrastructure hardening issues that share no code overlap with application modules:

- **#124 — `schema_migrations` shared version key, no cross-directory collision guard:**
  `packages/db/src/migrations/sql-runner.ts:51-68` keys the applied-set on `version` only
  (the numeric-only prefix, e.g. `0055`). If `infra/postgres/migrations/0055_foo.sql` and
  `packages/memory/sql/0055_bar.sql` are both loaded, whichever runs first records `version=0055`;
  the second is silently skipped. With multi-agent concurrent migration landing this is a live
  trap — confirmed in agent-memory as "migration numbers global by landing order."
- **#134 — dead `UPDATE` grant on `chat_messages` to `jarvis_app_runtime`:**
  `packages/chat/sql/0035_chat_messages_update_grant.sql:5` granted `UPDATE ON app.chat_messages`
  to `jarvis_app_runtime`. There is no application code (routes/handlers) in `packages/chat/src/`
  that updates chat messages via the app_runtime path — only the worker does (via `jarvis_worker_runtime`
  in `0036`). The grant is dead but keeps the runtime role's surface wider than needed.
- **#135 — `is_incognito` not enforced immutable:**
  `packages/chat/sql/0042_chat_memory_settings.sql:33-35` adds `is_incognito` with a comment
  claiming immutability, but no trigger or CHECK enforces it. The existing identity trigger
  (`0014:53-72`) protects only `id`/`owner_user_id`/`created_at`.
- **#157 — metadata-only pg-boss payloads unenforced:**
  `packages/jobs/src/pg-boss.ts:14-16` defines `ActorScopedJobPayload { actorUserId: string }`.
  The hard invariant (CLAUDE.md #6) requires payloads to contain only metadata — no private
  content, prompts, or secrets. `registerDataContextWorker` (`:84-98`) has no runtime guard.
  Any worker that calls `sendJob` with extra payload keys silently violates the invariant.
- **#174 — pgboss blanket `ALL TABLES` grant:**
  `infra/postgres/grants/0001_pgboss_runtime_grants.sql` grants
  `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss` to both
  `jarvis_app_runtime` and `jarvis_worker_runtime`. The pgboss schema has ~20 tables; each role
  needs only a subset.

---

## Fix design

### #124 — Cross-directory migration version uniqueness assertion

**Location:** `packages/db/src/migrations/sql-runner.ts:118-141` (`readMigrationFiles`).

The migration runner is called with one `directory` at a time, so it sees only one directory's
files. The multi-directory ordering and uniqueness check must happen at the call site in
`scripts/migrate.ts` (or wherever the runner is invoked for all directories).

**Fix:** After loading all migration files from all directories, assert that version numbers
are globally unique:

```typescript
// In scripts/migrate.ts (or the migrate command):
const allFiles = [
  ...await readMigrationFilesFromDir(infraDir),
  ...await readMigrationFilesFromDir(memoryDir),
  // ... all module sql/ dirs
];

const versions = allFiles.map(f => f.version);
const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
if (duplicates.length > 0) {
  throw new Error(
    `Duplicate migration version numbers across directories: ${duplicates.join(", ")}`
  );
}
```

This turns the silent-skip failure into a loud error that blocks `pnpm db:migrate`.

**Alternative location:** add the check inside `runSqlMigrations` itself as a pre-flight if
the runner ever receives a merged file list. Prefer the call-site approach so the runner
remains single-directory.

### #134 — REVOKE dead UPDATE grant from `jarvis_app_runtime`

**Migration:** `packages/chat/sql/<NNNN>_revoke_app_runtime_chat_update.sql`

```sql
-- Revoke the UPDATE grant on chat_messages from jarvis_app_runtime.
-- No application code uses this grant; only jarvis_worker_runtime updates messages.
-- Granted by 0035_chat_messages_update_grant.sql; dead since 0036_chat_worker_runtime_grants.sql.
REVOKE UPDATE ON app.chat_messages FROM jarvis_app_runtime;
```

The `chat_messages_update` policy in `0036` already restricts UPDATE to `jarvis_worker_runtime`
(role-specific policy). Removing the grant at the GRANT level is the additional least-privilege step.

### #135 — Immutability trigger on `is_incognito`

**Migration:** `infra/postgres/migrations/<NNNN>_chat_threads_incognito_immutable.sql`

```sql
CREATE OR REPLACE FUNCTION app.chat_threads_guard_incognito()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_incognito IS DISTINCT FROM OLD.is_incognito THEN
    RAISE EXCEPTION 'is_incognito is immutable after creation'
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

**Why migration lives in `infra/postgres/migrations/`:** the trigger modifies `app.chat_threads`,
which was created there. The chat module's SQL directory (`packages/chat/sql/`) has module-owned
migrations; triggers on app-schema tables go in the infra migrations.

**Pattern consistency:** mirrors the `users_guard_admin_flag` trigger from Slice A (#97).

### #157 — `assertMetadataOnlyPayload` runtime guard in `registerDataContextWorker`

**Location:** `packages/jobs/src/pg-boss.ts:84-98`.

Define a guard function:

```typescript
const ALLOWED_PAYLOAD_KEYS = new Set(["actorUserId", "kind", "resourceId", "idempotencyKey"]);

function assertMetadataOnlyPayload(payload: Record<string, unknown>): void {
  const forbidden = Object.keys(payload).filter(k => !ALLOWED_PAYLOAD_KEYS.has(k));
  if (forbidden.length > 0) {
    throw new Error(
      `Job payload contains non-metadata keys: ${forbidden.join(", ")}. ` +
      `Payloads must contain only: ${[...ALLOWED_PAYLOAD_KEYS].join(", ")}`
    );
  }
}
```

Call it inside `registerDataContextWorker` on `job.data` before handing off to the handler:

```typescript
assertMetadataOnlyPayload(job.data as Record<string, unknown>);
```

**Allowed key list:** `actorUserId`, `kind`, `resourceId`, `idempotencyKey`, and any other
keys currently used in live job payloads across the codebase. Build agent: grep for
`sendJob(` / `schedule(` across all packages to enumerate actual payload shapes, then derive
the allowed-key set. If a legitimate job type needs a key not in the set, add it to the
allowed list (it must be metadata — no content, prompts, or secrets). Flag any payload that
contains `content`, `prompt`, `body`, `text`, `secret`, `token`, or `credential` as a blocker.

### #174 — Narrowed pgboss grants (least-privilege per role)

**Migration:** `infra/postgres/grants/<NNNN>_pgboss_narrowed_grants.sql`
(or replace the existing non-migration grant file if the runner supports it — the current
`0001_pgboss_runtime_grants.sql` is a plain SQL file run via `runSqlFiles`, not a versioned
migration; the fix file uses the same mechanism)

The pgboss schema tables and which role needs what:

| Table | `jarvis_app_runtime` | `jarvis_worker_runtime` |
|---|---|---|
| `pgboss.job` | SELECT, INSERT | SELECT, INSERT, UPDATE |
| `pgboss.schedule` | SELECT, INSERT, UPDATE, DELETE | — |
| `pgboss.subscription` | SELECT | SELECT |
| `pgboss.version` | SELECT | SELECT |
| All other pgboss tables | — | — |

Build agent: verify the actual table list by running `\dt pgboss.*` on a test DB and cross-
referencing which tables the app runtime and worker actually touch (grep for pgboss table
names in `packages/jobs/` and `packages/db/`). The table above is a starting point — adjust
to match actual usage.

**Fix:**
```sql
-- Revoke the blanket grant.
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss
  FROM jarvis_app_runtime, jarvis_worker_runtime;

-- Re-grant minimum required.
GRANT SELECT, INSERT ON pgboss.job TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE ON pgboss.job TO jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON pgboss.schedule TO jarvis_app_runtime;
GRANT SELECT ON pgboss.subscription TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT ON pgboss.version TO jarvis_app_runtime, jarvis_worker_runtime;
```

Because this is a `runSqlFiles`-style grant (not a versioned migration), it is re-applied on
every `pnpm db:migrate` run — the REVOKE + re-GRANT pattern must be idempotent.

---

## Hard invariants

- **Never edit applied migrations.** The three new migration files are new files. Never modify
  `0035_chat_messages_update_grant.sql`, `0042_chat_memory_settings.sql`, or any earlier file.
- **Migration spine position.** Slice H's migrations are last in this run's spine. Their numbers
  must be higher than all Slice A, B, and G migration numbers.
- **`assertMetadataOnlyPayload` blocks at startup.** The guard throws at job dispatch time,
  not silently at queue time. Build agents should be alerted: if a live job payload contains
  non-metadata keys, they must fix the payload in the same PR, not suppress the guard.
- **pgboss REVOKE is idempotent.** The grants file uses `REVOKE IF EXISTS`-style patterns and is
  safe to re-run. Do not use `CREATE OR REPLACE` for grants — use explicit REVOKE then GRANT.
- **`is_incognito` trigger must not block legitimate app flows.** The trigger fires BEFORE UPDATE
  on `chat_threads`. Any app code that UPDATEs `chat_threads` but does NOT change `is_incognito`
  is unaffected (trigger only fires if `NEW.is_incognito IS DISTINCT FROM OLD.is_incognito`).
  Verify the chat suite passes.

---

## Tests

- **`pnpm test:integration` / `pnpm test:tasks`** and **`pnpm verify:foundation`** must be green.
- **#124 collision detection:** add a test that passes two migration files with the same version
  prefix from different directories to the `readMigrationFiles` load path and confirms an error
  is thrown.
- **#134 revoke:** after migration, verify `jarvis_app_runtime` does NOT have UPDATE on
  `app.chat_messages` (`\dp app.chat_messages` in test DB).
- **#135 immutability:** a test that tries `UPDATE app.chat_threads SET is_incognito = NOT is_incognito`
  must raise `42501`. A test that UPDATEs only non-incognito columns must succeed.
- **#157 payload guard:** a test that calls `registerDataContextWorker` with a payload containing
  `content: "..."` must throw immediately.
- **#174 narrowed grants:** after migration, `\dp pgboss.*` must show only the explicitly
  granted privileges for each role — no blanket ALL.

---

## Out of scope

- pgboss schema or version upgrades.
- New job types or worker additions.
- The broader migration runner rewrite (the fix is a targeted assertion, not an architecture change).
- `is_incognito` enforcement in application code beyond the DB trigger.
