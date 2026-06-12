# Spec: Audit Slice H — Migration/Job Infrastructure

**Date:** 2026-06-12 (revised post-Fable review)
**Audit issues:** #124, #134, #135, #157, #174
**Tier:** `security` (pgboss grants, incognito trigger, payload guard) + `sensitive` (#124)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 2 versioned migrations (#134 chat REVOKE, #135 incognito trigger). The pgboss
grants fix (#174) updates a `runSqlFiles`-style grant file (not hash-checked versioned migration).
Migration numbers assigned at build time — do not pre-assign.
**Dependency:** Last on the migration spine (after A → B → G). Migration numbers must be higher
than all Slice A, B, and G migration numbers.

---

## Context

Five infrastructure hardening issues that share no overlap with application business modules:

- **#124 — `schema_migrations` version key collision, no cross-directory uniqueness check:**
  The migration runner keys the applied-set on `version` only (the numeric prefix, e.g. `0055`).
  If `infra/postgres/migrations/0055_foo.sql` and `packages/memory/sql/0055_bar.sql` are both
  loaded, whichever runs first records `version=0055`; the second is skipped. There are actually
  **two** distinct failure modes: (a) if the files have the same content (same hash) → silently
  skipped; (b) if the files differ → runner treats the second as "changed" and may error with
  "migration has changed". Both modes are dangerous with concurrent multi-agent landing.
  This is a live trap confirmed in agent-memory: "migration numbers global by landing order."
- **#134 — dead `UPDATE` grant on `chat_messages` to `jarvis_app_runtime`:**
  `packages/chat/sql/0035_chat_messages_update_grant.sql:5` granted `UPDATE ON app.chat_messages`
  to `jarvis_app_runtime`. No application route in `packages/chat/src/` uses this grant — only
  the worker (`jarvis_worker_runtime`) updates chat messages. The grant is dead but broadens
  the runtime surface. The `chat_messages_update` RLS policy also needs to be narrowed to
  `TO jarvis_worker_runtime` only.
- **#135 — `incognito` column not enforced immutable:**
  `packages/chat/sql/0042_chat_memory_settings.sql:35` adds the `incognito` column (verified
  column name — NOT `is_incognito`; do not use `is_incognito` anywhere in this spec). A comment
  claims immutability but no trigger or CHECK enforces it. The existing identity trigger
  (`packages/chat/sql/0014_chat_module.sql:53-72`) protects only `id`/`owner_user_id`/`created_at`.
- **#157 — metadata-only pg-boss payloads unenforced, send-side gap:**
  `packages/jobs/src/pg-boss.ts:14-16` defines `ActorScopedJobPayload { actorUserId: string }`.
  The hard invariant (CLAUDE.md #6) requires payloads to contain only metadata. Current
  consume-side guards in existing per-queue validators (`isDeferredTaskStatusPayloadMetadataOnly`,
  `isBriefingRunPayloadMetadataOnly`) validate inbound payloads — but there is no **send-side**
  guard that prevents non-metadata keys from being enqueued in the first place. Every raw
  `boss.send(...)` call site is an unguarded send path.
- **#174 — pgboss blanket `ALL TABLES` grant:**
  `infra/postgres/grants/0001_pgboss_runtime_grants.sql` grants `SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA pgboss` to both roles. The pgboss schema has ~20 tables; each role
  needs only a subset. **Critically: pg-boss v12 reads `pgboss.queue` on every `boss.send()` and
  `boss.work()` call** — this table must be in the grant matrix. Narrowing without including
  `pgboss.queue` breaks all job operations.

---

## Fix design

### #157 — Send-side `sendJob` wrapper (the high-priority fix — replaces raw `boss.send`)

**This is the primary fix for #157.** The consume-side guards are defense-in-depth; the send-side
wrapper is the prevention layer.

**New function in `packages/jobs/src/pg-boss.ts`:**

```typescript
export async function sendJob<T extends ActorScopedJobPayload>(
  boss: PgBoss,
  queue: string,
  payload: T,
): Promise<string | null> {
  assertMetadataOnlyPayload(payload);
  return boss.send(queue, payload);
}
```

**All raw `boss.send(` call sites must be migrated to `sendJob(boss, ...)`.** Build agent: grep
for `boss.send(` across all packages to enumerate call sites. Known call sites (verify against
actual code):
- `packages/chat/src/persistence.ts:137-138`
- `packages/tasks/src/routes.ts:270`
- `packages/briefings/src/routes.ts:136`
- Any others found by `grep -rn "boss\.send(" packages/ --include="*.ts"`

After migration, add a lint/grep gate to the PR exit criteria:
```
grep -rn "boss\.send(" packages/ --include="*.ts"
```
This must return zero matches (all `boss.send` calls replaced by `sendJob`).

### #157 — `assertMetadataOnlyPayload` guard

**Location:** `packages/jobs/src/pg-boss.ts`.

```typescript
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

**Real allowed keys (enumerated from live payloads):** build agent must grep for all
`boss.send(` / `sendJob(` call sites and enumerate the actual payload keys in use. Known
real keys from existing per-queue validators (the `isDeferredTaskStatusPayloadMetadataOnly`
and `isBriefingRunPayloadMetadataOnly` patterns in `packages/jobs/src/pg-boss.ts`):
`taskId`, `requestedStatus`, `definitionId`, `briefingRunId`, `runKind`, `threadId`,
`messageId`, `targetItemId`, `actorUserId`, `kind`, `resourceId`, `idempotencyKey`.

Extend this set (not contract the existing per-queue validators) if new payload shapes are
found. Any payload key that contains `content`, `prompt`, `body`, `text`, `secret`, `token`,
or `credential` is a hard blocker — escalate to coordinator.

The consume-side guards (`isDeferredTaskStatusPayloadMetadataOnly` etc.) remain unchanged —
they are defense-in-depth. The `sendJob` wrapper adds prevention.

### #124 — Cross-directory migration version uniqueness assertion

**Location and approach:**

The runner function `readMigrationFiles` in `packages/db/src/migrations/sql-runner.ts:118-141`
reads one directory at a time. A cross-directory uniqueness check must operate on the merged
file set. Two implementation options:

1. **Export `assertUniqueMigrationVersions(files: MigrationFile[]): void`** from
   `packages/db/src/migrations/sql-runner.ts` and call it in `scripts/migrate.ts` after loading
   all directories.
2. **Add the check inside the migrate script** without modifying the runner.

Choose option 1 if `readMigrationFiles` is easily exportable (check whether it is already
exported). Choose option 2 if the runner's internals are not easily testable.

**The directory source:** use `getBuiltInSqlMigrationDirectories()` (the existing function that
returns the canonical list of directories for the production migrate run) as the input. Do NOT
include the bootstrap (`infra/postgres/bootstrap/`) or grants (`infra/postgres/grants/`)
directories — those use `runSqlFiles` not the versioned migration runner.

**The assertion:**
```typescript
const versions = allFiles.map(f => f.version);
const seen = new Set<string>();
const duplicates = versions.filter(v => seen.size === seen.add(v).size);
if (duplicates.length > 0) {
  throw new Error(
    `Duplicate migration version numbers across directories: ${[...new Set(duplicates)].join(", ")}`
  );
}
```

Both failure modes (same-content silent skip AND different-content "has changed" error) are
prevented by this check, which fires before any migration runs.

### #134 — REVOKE dead UPDATE grant + narrow `chat_messages_update` RLS policy

**Migration:** `packages/chat/sql/<NNNN>_revoke_app_runtime_chat_update.sql`

```sql
-- Revoke the dead UPDATE grant on chat_messages from jarvis_app_runtime.
-- Granted by 0035; no app_runtime code updates chat messages (only jarvis_worker_runtime does).
REVOKE UPDATE ON app.chat_messages FROM jarvis_app_runtime;

-- Also narrow the chat_messages_update RLS policy to worker_runtime only.
-- (Recreate it rather than ALTER to avoid syntax gotchas.)
DROP POLICY IF EXISTS chat_messages_update ON app.chat_messages;
CREATE POLICY chat_messages_update ON app.chat_messages
  FOR UPDATE
  TO jarvis_worker_runtime
  USING (true)
  WITH CHECK (true);
```

**Note:** chat_threads is a chat-module-owned table (created in
`packages/chat/sql/0014_chat_module.sql:23`). Both this migration and #135's migration live in
`packages/chat/sql/` — the module owns its tables.

### #135 — `incognito` immutability trigger

**CRITICAL: The column name is `incognito`, NOT `is_incognito`.** Verified from
`packages/chat/sql/0042_chat_memory_settings.sql:35`. Every occurrence of `is_incognito` in
triggers, function names, comments, and tests must be `incognito`.

**Migration:** `packages/chat/sql/<NNNN>_chat_threads_incognito_immutable.sql`

(NOT in `infra/postgres/migrations/` — `chat_threads` is owned by the chat module at
`packages/chat/sql/0014_chat_module.sql:23`. Module-owned tables get their triggers in module
SQL directories.)

```sql
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

### #174 — Narrowed pgboss grants (least-privilege per role)

**Method:** update `infra/postgres/grants/0001_pgboss_runtime_grants.sql` (the `runSqlFiles`
grant file — not a versioned migration; re-applied idempotently on each `pnpm db:migrate` run).
Alternatively, add a layered `0002_pgboss_narrowed_grants.sql` in the same grants directory.
Specify which approach in the PR.

**Critical: include `pgboss.queue`.** pg-boss v12 reads `pgboss.queue` on every `boss.send()`
and `boss.work()`. Omitting it breaks all job dispatch.

**Also include `pgboss.job_archive` and `pgboss.partition` for the worker** — pg-boss v12 uses
these for completed-job archival.

Starting grant matrix (build agent: verify by running `\dt pgboss.*` on test DB and
cross-referencing actual usage in `packages/jobs/` and `packages/db/`):

| Table | `jarvis_app_runtime` | `jarvis_worker_runtime` |
|---|---|---|
| `pgboss.job` | SELECT, INSERT | SELECT, INSERT, UPDATE |
| `pgboss.queue` | SELECT | SELECT |
| `pgboss.schedule` | SELECT, INSERT, UPDATE, DELETE | — |
| `pgboss.subscription` | SELECT | SELECT |
| `pgboss.version` | SELECT | SELECT |
| `pgboss.job_archive` | — | SELECT, INSERT |
| `pgboss.partition` | — | SELECT, INSERT |
| All other pgboss tables | — | — |

**The REVOKE + re-GRANT must be idempotent.** Use `REVOKE IF GRANTED` pattern or plain REVOKE
(which is a no-op if not granted in Postgres). Do NOT use `CREATE OR REPLACE` for grants.

**Residual risk note:** grant narrowing removes over-broad table access but does not add
row-level scoping to pgboss tables (they have no RLS). Pairing with the #157 send-side
`sendJob` wrapper bounds the data-leakage risk: non-metadata payloads are rejected before
reaching the queue.

**Verification:** use `has_table_privilege(role, table, privilege)` or
`pg_catalog.pg_class/pg_roles/pg_privilege` queries — not `\dp` which is a psql CLI command
unavailable in CI:

```sql
SELECT has_table_privilege('jarvis_app_runtime', 'pgboss.job', 'update');
-- Must return false after narrowing
```

---

## Hard invariants

- **Never edit applied migrations.** `0035_chat_messages_update_grant.sql`,
  `0042_chat_memory_settings.sql`, and all earlier files are applied and hash-checked. New
  behavior goes in new migration files.
- **Column name is `incognito`, not `is_incognito`.** Every occurrence in triggers, function
  names, comments, and tests must use the correct column name.
- **#135 migration lives in `packages/chat/sql/`** — not `infra/postgres/migrations/`.
  The module owns `chat_threads`.
- **`boss.send(` is banned after this PR.** All send paths use `sendJob(boss, ...)`. The grep
  gate must pass.
- **`pgboss.queue` is in the grant matrix.** Omitting it breaks all job dispatch.
- **Grants file is idempotent.** Re-running `pnpm db:migrate` does not error on the REVOKE.
- **Migration spine position.** Slice H's two versioned migrations are last in this run.

---

## Tests

- **`pnpm verify:foundation`** and **`pnpm test:integration`** green.
- **`pnpm test:tasks`** (exercises deferred task status jobs) and **chat suite**
  (`vitest run tests/integration/chat*.test.ts`) green — verifies trigger and grant changes
  don't break existing flows.
- **#124 collision detection:** add a test that calls `assertUniqueMigrationVersions` (or the
  migrate script's entry point) with two migration files sharing a version prefix from different
  directories; expect an error with the duplicate version in the message.
- **#134 revoke:** after migration, `has_table_privilege('jarvis_app_runtime', 'app.chat_messages', 'update')` returns false.
- **#135 immutability:** `UPDATE app.chat_threads SET incognito = NOT incognito` raises `42501`.
  `UPDATE app.chat_threads SET title = 'x'` succeeds (trigger only fires on `incognito` change).
- **#157 send-side guard:** calling `sendJob(boss, "test-queue", { actorUserId: "x", content: "secret" })`
  throws `"Job payload contains non-metadata keys: content"`.
- **#174 narrowed grants:**
  `has_table_privilege('jarvis_app_runtime', 'pgboss.job', 'update')` → false;
  `has_table_privilege('jarvis_worker_runtime', 'pgboss.job', 'update')` → true;
  `has_table_privilege('jarvis_app_runtime', 'pgboss.queue', 'select')` → true.
- **grep gate (must pass before PR merge):**
  `grep -rn "boss\.send(" packages/ --include="*.ts"` → zero matches.

---

## Out of scope

- pgboss schema or version upgrades.
- New job types or worker additions.
- Full migration runner rewrite (targeted assertion only).
- `incognito` enforcement in application code beyond the DB trigger.
