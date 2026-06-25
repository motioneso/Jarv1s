# Data Export Cleanup Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one worker-owned pg-boss cron that expires ready data-export jobs and deletes only their vault archive files.

**Architecture:** Keep cleanup inside `@jarv1s/settings`: one queue, one UTC cron, one worker handler. Add the smallest SQL migration needed for cross-user maintenance: a read-only security-definer function that returns expired export job IDs/owners, because the existing table is owner-only RLS and the operator schedule has no actor. Worker deletes each vault archive first via `VaultContextRunner` + `deleteVaultFile`, then marks that one row `expired` through normal owner-scoped `DataContextRunner`; failed deletes leave rows `ready` for retry.

**Tech Stack:** TypeScript, pg-boss, Kysely, Vitest, Postgres RLS/security-definer SQL, `@jarv1s/vault`.

---

## Verified Current State

- `packages/settings/src/data-export-jobs.ts` has `export.build`, archive write, and worker registration.
- `packages/settings/src/data-export-async-routes.ts` deletes an expired archive only when a user hits download, but does not mark the row `expired`.
- `packages/settings/sql/0108_data_export_jobs.sql` has `status = 'expired'` and `expires_at`, but owner-only RLS plus no worker `SELECT`, so one operator cleanup job cannot discover expired rows without a bounded maintenance function/policy.
- Worker/runtime roles stay `NOBYPASSRLS`; cleanup must not add `BYPASSRLS` or broaden table grants.
- Status must not change before vault deletion succeeds or the file is already absent; otherwise a failed delete loses retry.
- `packages/notes/src/schedule.ts` is the schedule pattern to mirror: `assertMetadataOnlyPayload`, UTC cron, `boss.schedule(...)`.

## Files

- Create: `packages/settings/sql/0112_data_export_cleanup_function.sql`
- Create: `packages/settings/src/data-export-schedule.ts`
- Modify: `apps/worker/src/worker.ts`
- Modify: `packages/module-registry/src/index.ts`
- Modify: `packages/settings/src/data-export-jobs.ts`
- Modify: `packages/settings/src/index.ts`
- Modify: `packages/settings/src/manifest.ts`
- Modify: `tests/integration/data-export.test.ts`

### Task 1: Migration For Bounded Listing Function

**Files:**

- Create: `packages/settings/sql/0112_data_export_cleanup_function.sql`
- Modify: `packages/settings/src/manifest.ts`
- Test: `tests/integration/data-export.test.ts`

- [ ] **Step 1: Write failing integration test**

Add tests that:

- create one expired-ready job and one future-ready job
- prove `jarvis_worker_runtime` cannot direct `SELECT * FROM app.data_export_jobs`
- call `app.list_expired_data_export_jobs(now())` as `jarvis_worker_runtime`
- expect only the expired job `id` and `ownerUserId`
- expect both rows to remain `ready` after the listing call

- [ ] **Step 2: Run test, expect missing function**

Run: `pnpm vitest run tests/integration/data-export.test.ts`
Expected: FAIL with function not found.

- [ ] **Step 3: Add minimal SQL function**

Create `packages/settings/sql/0112_data_export_cleanup_function.sql`:

```sql
CREATE OR REPLACE FUNCTION app.list_expired_data_export_jobs(cutoff timestamptz)
RETURNS TABLE(id uuid, "ownerUserId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT id, owner_user_id AS "ownerUserId"
  FROM app.data_export_jobs
  WHERE status = 'ready'
    AND expires_at IS NOT NULL
    AND expires_at <= cutoff
  ORDER BY expires_at ASC, id ASC
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION app.list_expired_data_export_jobs(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_expired_data_export_jobs(timestamptz) TO jarvis_worker_runtime;
```

The migration filename is proposed as `0112_data_export_cleanup_function.sql`; use the Coordinator-approved migration number before coding if ordering has changed.
Before shipping, verify ownership follows existing migration/definer patterns in this repo and does not grant `EXECUTE` to app/runtime/public.

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm vitest run tests/integration/data-export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/settings/sql/0112_data_export_cleanup_function.sql packages/settings/src/manifest.ts tests/integration/data-export.test.ts
git commit -m "fix(settings): add data export expiry function"
```

### Task 2: Cleanup Queue, Schedule, Worker

**Files:**

- Create: `packages/settings/src/data-export-schedule.ts`
- Modify: `apps/worker/src/worker.ts`
- Modify: `packages/module-registry/src/index.ts`
- Modify: `packages/settings/src/data-export-jobs.ts`
- Modify: `packages/settings/src/index.ts`
- Test: `tests/integration/data-export.test.ts`

- [ ] **Step 1: Write failing worker/schedule tests**

Add tests for:

- cleanup scheduled payload is `{ kind: "export.cleanup" }`
- handler deletes `exports/<jobId>.json` through `VaultContextRunner`
- handler ignores already-missing archive files and then marks row `expired`
- handler preserves `ready` status when `deleteVaultFile` throws a non-missing error, so next cron retries

- [ ] **Step 2: Run tests, expect missing exports**

Run: `pnpm vitest run tests/integration/data-export.test.ts`
Expected: FAIL on missing schedule/handler.

- [ ] **Step 3: Add minimal schedule helper**

Create `packages/settings/src/data-export-schedule.ts`:

```ts
import type { PgBoss } from "@jarv1s/jobs";
import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

import { EXPORT_CLEANUP_QUEUE } from "./data-export-jobs.js";

export const EXPORT_CLEANUP_CRON = "17 * * * *";
const EXPORT_CLEANUP_TZ = "UTC";
const EXPORT_CLEANUP_KEY = "data-export-cleanup";

export async function reconcileDataExportCleanupSchedule(boss: PgBoss): Promise<void> {
  const data = { kind: "export.cleanup" as const };
  assertMetadataOnlyPayload(data);
  await boss.schedule(EXPORT_CLEANUP_QUEUE, EXPORT_CLEANUP_CRON, data, {
    tz: EXPORT_CLEANUP_TZ,
    key: EXPORT_CLEANUP_KEY
  });
}
```

- [ ] **Step 4: Add minimal handler + registration**

In `data-export-jobs.ts`, add:

- `EXPORT_CLEANUP_QUEUE = "export.cleanup"`
- payload type `{ kind: "export.cleanup" }`
- queue definition
- `listExpiredJobs(workerDb, cutoff)` using `sql` to call `app.list_expired_data_export_jobs(cutoff)`
- `handleExportCleanupJob(workerDb, dataContext)` that lists expired jobs, deletes `exports/<id>.json` with `VaultContextRunner` for each owner, then marks only successfully cleaned/missing-file rows `expired` via `dataContext.withDataContext({ actorUserId: ownerUserId, ... })`
- `registerSettingsJobWorkers(...)` schedules cleanup and registers cleanup worker with raw `boss.work`

Do not put actor IDs, job IDs, vault paths, archive content, or errors containing private content in the pg-boss payload or logs.

- [ ] **Step 5: Pass worker DB through module registry**

Add `rootDb: Kysely<JarvisDatabase>` to `BuiltInWorkerDependencies`, pass `workerDb` from `apps/worker/src/worker.ts`, and forward it only to `registerSettingsJobWorkers`.

- [ ] **Step 6: Export schedule helper**

Export `data-export-schedule.js` from `packages/settings/src/index.ts`.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run tests/integration/data-export.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/worker.ts packages/module-registry/src/index.ts packages/settings/src/data-export-schedule.ts packages/settings/src/data-export-jobs.ts packages/settings/src/index.ts tests/integration/data-export.test.ts
git commit -m "fix(settings): schedule data export cleanup"
```

### Task 3: Gate

**Files:**

- No new edits unless checks fail.

- [ ] **Step 1: Run focused tests**

Run: `pnpm vitest run tests/integration/data-export.test.ts`
Expected: PASS.

- [ ] **Step 2: Run required checks**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Sensitive invariant check**

Verify:

- pg-boss cleanup payload is metadata-only and contains no actor private data.
- pg-boss cleanup payload is exactly `{ kind: "export.cleanup" }`.
- Cleanup reads expired job IDs/owners only via bounded SQL function with `SECURITY DEFINER`, `SET search_path = app, pg_temp`, `REVOKE PUBLIC`, and `GRANT EXECUTE` only to `jarvis_worker_runtime`.
- Worker/runtime roles remain `NOBYPASSRLS`.
- Worker role cannot direct `SELECT` all export jobs and can only use the bounded cleanup function.
- Vault deletes use `VaultContextRunner` and `deleteVaultFile`.
- Rows are marked `expired` only after archive deletion succeeds or the file is already absent; failed deletes preserve retry.
- No archive content, secrets, or vault paths are logged.
- PR is security-tier and cannot auto-merge.

## Self-Review

- Spec coverage: one operator cron, metadata-only payload, fire-time expired-job resolution, vault deletion before row expiry, retry preservation, worker-role RLS constraints, notes schedule shape mirrored.
- Placeholder scan: no placeholders.
- Type consistency: queue constants and payload names are defined before use.
