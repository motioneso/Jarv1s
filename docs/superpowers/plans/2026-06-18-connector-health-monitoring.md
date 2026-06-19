# Connector Health Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist safe Google connector sync health and show it in admin connector oversight without leaking synced data, provider payloads, or secrets.

**Architecture:** Add nullable aggregate health columns to `app.connector_accounts`, expose them through existing owner/admin safe account DTOs, and update `runGoogleSync` at start/end/failure. Keep health labels bounded and counts aggregate-only. UI remains read-only and derives display from the new DTO fields.

**Tech Stack:** PostgreSQL SQL migrations, Kysely/DataContextDb, Fastify shared schemas, Vitest integration tests, React settings UI.

---

## File Structure

- Modify: `packages/connectors/sql/0099_connector_health_metadata.sql` (or coordinator-assigned next migration number before push): add nullable health columns, bounded status enum CHECK, JSON object CHECK, worker update grant.
- Modify: `packages/connectors/src/manifest.ts`: include new SQL migration.
- Modify: `packages/db/src/types.ts`: add `ConnectorSyncStatus` and new nullable connector account columns.
- Modify: `packages/shared/src/connectors-api.ts`: add `ConnectorSyncStatus`, `ConnectorSyncCounts`, DTO fields, JSON schema fields.
- Modify: `packages/connectors/src/repository.ts`: select health fields; add minimal `markSyncStarted` and `markSyncFinished` helpers.
- Modify: `packages/connectors/src/routes.ts`: serialize health fields for owner/admin routes.
- Modify: `packages/connectors/src/sync-jobs.ts`: write started/success/partial/failed health; bounded labels only.
- Modify: `tests/integration/connectors.test.ts`: assert migration columns default null and admin/owner safe DTO includes health without secrets.
- Modify: `tests/integration/google-sync-orchestration.test.ts`: assert success, partial, and top-level failure health writes.
- Modify: `apps/web/src/settings/settings-admin-panes.tsx`: display durable health badge, last finished time, bounded label only for partial/failed.

## Tasks

### Task 1: Migration + Types

**Files:**
- Create/modify: `packages/connectors/sql/0099_connector_health_metadata.sql`
- Modify: `packages/connectors/src/manifest.ts`
- Modify: `packages/db/src/types.ts`
- Test: `tests/integration/connectors.test.ts`

- [ ] **Step 1: Write failing migration assertion**

Add to existing connector migration test:

```ts
const columns = await client.query<{ column_name: string; is_nullable: string }>(`
  SELECT column_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'app'
    AND table_name = 'connector_accounts'
    AND column_name IN (
      'last_sync_started_at',
      'last_sync_finished_at',
      'last_sync_status',
      'last_sync_error',
      'last_sync_counts'
    )
  ORDER BY column_name
`);

expect(columns.rows).toEqual([
  { column_name: "last_sync_counts", is_nullable: "YES" },
  { column_name: "last_sync_error", is_nullable: "YES" },
  { column_name: "last_sync_finished_at", is_nullable: "YES" },
  { column_name: "last_sync_started_at", is_nullable: "YES" },
  { column_name: "last_sync_status", is_nullable: "YES" }
]);
```

Run: `JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm test:integration tests/integration/connectors.test.ts`
Expected: FAIL, missing columns.

- [ ] **Step 2: Add migration**

```sql
ALTER TABLE app.connector_accounts
  ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_status text,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS last_sync_counts jsonb;

ALTER TABLE app.connector_accounts
  DROP CONSTRAINT IF EXISTS connector_accounts_last_sync_status_check,
  ADD CONSTRAINT connector_accounts_last_sync_status_check
    CHECK (last_sync_status IS NULL OR last_sync_status IN ('success', 'partial', 'failed')),
  DROP CONSTRAINT IF EXISTS connector_accounts_last_sync_counts_object_check,
  ADD CONSTRAINT connector_accounts_last_sync_counts_object_check
    CHECK (last_sync_counts IS NULL OR jsonb_typeof(last_sync_counts) = 'object');

GRANT UPDATE (
  last_sync_started_at,
  last_sync_finished_at,
  last_sync_status,
  last_sync_error,
  last_sync_counts,
  updated_at
) ON app.connector_accounts TO jarvis_worker_runtime;
```

Add migration to manifest after `sql/0069_connector_worker_runtime_grants.sql`.

- [ ] **Step 3: Add DB types**

```ts
export type ConnectorSyncStatus = "success" | "partial" | "failed";

export interface ConnectorAccountsTable {
  // existing fields...
  last_sync_started_at: NullableTimestampColumn;
  last_sync_finished_at: NullableTimestampColumn;
  last_sync_status: ConnectorSyncStatus | null;
  last_sync_error: string | null;
  last_sync_counts: JsonColumn | null;
}
```

- [ ] **Step 4: Run focused check**

Run: `JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm test:integration tests/integration/connectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/sql/0099_connector_health_metadata.sql packages/connectors/src/manifest.ts packages/db/src/types.ts tests/integration/connectors.test.ts
git commit -m "feat(connectors): add connector sync health columns"
```

### Task 2: Safe DTO Exposure

**Files:**
- Modify: `packages/shared/src/connectors-api.ts`
- Modify: `packages/connectors/src/repository.ts`
- Modify: `packages/connectors/src/routes.ts`
- Test: `tests/integration/connectors.test.ts`

- [ ] **Step 1: Write failing DTO assertions**

Extend owner/admin account assertions:

```ts
expect(listResponse.json<{ accounts: Array<{ lastSyncStatus: null }> }>().accounts[0]).toMatchObject({
  lastSyncStartedAt: null,
  lastSyncFinishedAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  lastSyncCounts: null
});
expect(adminResponse.body).not.toContain("encrypted_secret");
expect(adminResponse.body).not.toContain("provider response");
```

Run: `JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm test:integration tests/integration/connectors.test.ts`
Expected: FAIL, fields absent.

- [ ] **Step 2: Add shared DTO/schema fields**

```ts
export type ConnectorSyncStatus = "success" | "partial" | "failed";
export interface ConnectorSyncCounts {
  readonly calendarUpserted?: number;
  readonly emailUpserted?: number;
  readonly emailFailures?: number;
  readonly escalations?: number;
  readonly truncated?: boolean;
}
```

Add required nullable DTO fields: `lastSyncStartedAt`, `lastSyncFinishedAt`, `lastSyncStatus`, `lastSyncError`, `lastSyncCounts`.

- [ ] **Step 3: Select + serialize fields**

Select `accounts.last_sync_*` in `safeAccountQuery`, include same columns in `app.list_connector_account_safe_metadata()`, and serialize:

```ts
lastSyncStartedAt: serializeNullableDate(account.last_sync_started_at),
lastSyncFinishedAt: serializeNullableDate(account.last_sync_finished_at),
lastSyncStatus: account.last_sync_status,
lastSyncError: account.last_sync_error,
lastSyncCounts: account.last_sync_counts as ConnectorSyncCounts | null
```

- [ ] **Step 4: Run focused check**

Run: `JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm test:integration tests/integration/connectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/connectors-api.ts packages/connectors/src/repository.ts packages/connectors/src/routes.ts tests/integration/connectors.test.ts packages/connectors/sql/0010_connector_admin_safe_metadata.sql
git commit -m "feat(connectors): expose safe connector health metadata"
```

### Task 3: Sync Health Writes

**Files:**
- Modify: `packages/connectors/src/repository.ts`
- Modify: `packages/connectors/src/sync-jobs.ts`
- Test: `tests/integration/google-sync-orchestration.test.ts`

- [ ] **Step 1: Write failing sync health tests**

Add tests for:

```ts
expect(health.last_sync_status).toBe("success");
expect(health.last_sync_error).toBeNull();
expect(health.last_sync_counts).toMatchObject({ calendarUpserted: 1, emailUpserted: 1 });

expect(partial.last_sync_status).toBe("partial");
expect(partial.last_sync_error).toBe("calendar-item-error");
expect(JSON.stringify(partial)).not.toContain("Inverted times");

expect(failed.last_sync_status).toBe("failed");
expect(failed.last_sync_error).toBe("auth-error");
expect(JSON.stringify(failed)).not.toContain("raw provider body");
```

Run: `JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm test:integration tests/integration/google-sync-orchestration.test.ts`
Expected: FAIL, fields unchanged.

- [ ] **Step 2: Add repository helpers**

```ts
async markSyncStarted(scopedDb: DataContextDb, accountId: string, startedAt: Date): Promise<void>
async markSyncFinished(scopedDb: DataContextDb, accountId: string, input: {
  finishedAt: Date;
  status: "success" | "partial" | "failed";
  error: string | null;
  counts: Record<string, number | boolean>;
}): Promise<void>
```

Both update only the actor-visible account row and never modify `status`/`revoked_at`.

- [ ] **Step 3: Wire `runGoogleSync`**

After active account lookup, call `markSyncStarted`. On auth/top-level token failure, call `markSyncFinished(... failed, "auth-error", zero counts)`. Before normal return, status is `partial` when `errors.length > 0`, else `success`; error is first bounded label or null.

Counts object:

```ts
{
  calendarUpserted,
  emailUpserted,
  emailFailures,
  escalations,
  truncated
}
```

- [ ] **Step 4: Run focused check**

Run: `JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm test:integration tests/integration/google-sync-orchestration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/repository.ts packages/connectors/src/sync-jobs.ts tests/integration/google-sync-orchestration.test.ts
git commit -m "feat(connectors): persist google sync health"
```

### Task 4: Admin UI

**Files:**
- Modify: `apps/web/src/settings/settings-admin-panes.tsx`
- Test: `pnpm typecheck`; manual UI check if server run is practical.

- [ ] **Step 1: Update display helper inline**

Use tiny local helpers in `OversightPane`:

```ts
const health =
  account.status === "revoked"
    ? { label: "Revoked", tone: "neutral" as const, indicator: "idle" as const }
    : account.lastSyncStatus === "partial"
      ? { label: "Partial", tone: "amber" as const, indicator: "error" as const }
      : account.lastSyncStatus === "failed" || account.status === "error"
        ? { label: "Needs attention", tone: "amber" as const, indicator: "error" as const }
        : { label: "Healthy", tone: "pine" as const, indicator: "ready" as const };
```

Show `lastSyncFinishedAt` when present and `lastSyncError` only for `partial`/`failed`.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/settings/settings-admin-panes.tsx
git commit -m "feat(web): show connector sync health"
```

### Task 5: Final Gate + Rebase Prep

**Files:** none expected.

- [ ] **Step 1: Focused tests**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_deploy_254 pnpm test:integration tests/integration/connectors.test.ts tests/integration/google-sync-orchestration.test.ts
```

Expected: PASS.

- [ ] **Step 2: Pre-push trio**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Fresh rebase**

Run:

```bash
git fetch origin main && git rebase origin/main
```

Expected: rebase clean; if migration number collides, renumber new connector health SQL above landed main before rerunning focused tests.

- [ ] **Step 4: Wrap up**

Invoke `coordinated-wrap-up`: full local gate, push, PR, report evidence to coordinator.

## Self-Review

- Spec coverage: migration/default-null, safe admin/owner DTOs, success/partial/failed sync health, bounded labels, aggregate counts, non-admin admin route, read-only UI are covered.
- Placeholder scan: no TBD/TODO/fill-later steps.
- Type consistency: DB snake_case, DTO camelCase, statuses `success | partial | failed`, bounded labels match existing sync labels.
- Ponytail simplification: no new service layer, no new UI component file, no per-item health records.
