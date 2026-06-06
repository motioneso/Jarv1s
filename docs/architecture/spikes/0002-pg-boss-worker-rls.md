# Spike 0002: pg-boss Worker RLS Posture

Status: Completed
Date: 2026-06-06

M1 note: this spike remains historical proof. The current executable guardrails are now the real scaffold/product integration tests in `tests/integration/foundation.test.ts` and `tests/integration/tasks.test.ts`.

## Goal

Prove whether pg-boss can fit the auth/RLS posture from Spike 0001 without giving worker code a private-data bypass.

## Non-Goals

Do not build:

- Full worker framework
- Full job taxonomy
- Full module scheduler
- Final migration runner
- Full maintenance UI or admin workflow

## Questions To Answer

- Can pg-boss schema creation and queue creation happen under the migration/owner posture?
- Can API and worker runtimes use pg-boss with `migrate: false`?
- Can job handlers load actor/workspace context from job payload and use `withDataContext` before touching protected tables?
- Does pg-boss metadata need RLS, or can it remain separate metadata with strict payload rules?
- What maintenance/system posture is required after `FORCE ROW LEVEL SECURITY`?

## Success Criteria

- pg-boss can enqueue and process a job without runtime migration privileges.
- A worker handler with User A actor context cannot read User B private data.
- A worker handler can read data allowed by grants or ownership.
- pg-boss job metadata is separate from protected app tables.
- The recommended maintenance/system posture is documented.

## Result

Completed in `spikes/pg-boss-rls`.

Verification commands:

```txt
pnpm exec tsc --noEmit
pnpm spike:db:up
pnpm test:spike
```

Result:

```txt
Test Files  2 passed (2)
Tests       15 passed (15)
```

pg-boss fits the worker RLS posture if its schema is treated as operational metadata and job handlers are required to enter the normal app data context before touching protected app tables.

## Final Approach

The pg-boss path is:

```txt
migration owner creates pg-boss schema and queues
  -> app runtime starts pg-boss with migrate: false
  -> app runtime enqueues minimal job metadata
  -> worker runtime starts pg-boss with migrate: false
  -> worker handler reads actor/workspace context from job payload
  -> handler calls withDataContext()
  -> protected app repositories run through normal RLS
```

The spike uses pg-boss `12.18.2` with:

```ts
{
  schema: "pgboss",
  schedule: false,
  supervise: false,
  migrate: false,
  createSchema: false
}
```

Schema creation and queue creation are performed only by the migration owner during setup. Runtime roles can start pg-boss, enqueue jobs, fetch jobs, and complete jobs without owning the pg-boss schema.

Runtime queue creation is intentionally blocked by revoking pg-boss function execution from `PUBLIC` and not granting it to runtime roles. The test suite verifies `appBoss.createQueue("runtime-created-queue")` fails with a permission error.

## Metadata Boundary

pg-boss tables live in the separate `pgboss` schema. Protected user data remains in the `app` schema and stays under RLS.

pg-boss metadata is not protected by app RLS in this spike. That is acceptable only if job payloads are treated as operational metadata, not private content.

Job payload rule:

- include actor id
- include workspace id when needed
- include resource ids and command metadata
- do not include private bodies, secrets, raw connector payloads, prompts containing private content, or model-visible content

The spike test verifies the queued payload contains actor/resource identifiers and does not include the protected item body.

## Worker Result

The worker runtime role processes jobs through pg-boss, but the handler opens a separate Kysely worker connection and calls `withDataContext()` before repository access.

Tests prove:

- User A job context cannot read User B private item.
- User A job context can read User A private item.
- User A job context can read User B item with an explicit grant.
- Workspace-scoped User A job context can read a workspace-shared row.
- Workspace-scoped User A job context still cannot read a private row that merely belongs to the same workspace.

## Role Posture

Roles from Spike 0001 remain valid:

- `jarvis_migration_owner`
- `jarvis_app_runtime`
- `jarvis_worker_runtime`

pg-boss-specific posture:

- `jarvis_migration_owner` creates and owns the `pgboss` schema and queues.
- `jarvis_app_runtime` receives `USAGE` on schema/type and DML on pg-boss tables.
- `jarvis_worker_runtime` receives `USAGE` on schema/type and DML on pg-boss tables.
- Runtime roles do not receive function execution on pg-boss schema functions.
- Runtime roles start pg-boss with `migrate: false`.

This is enough for queue use, but it is not a complete least-privilege pg-boss hardening pass. pg-boss expects broad table access within its metadata schema. Treat that schema as operational infrastructure, keep payloads minimal, and do not let modules query pg-boss tables directly.

## Maintenance And System Job Posture

`FORCE ROW LEVEL SECURITY` remains the right default for protected app tables. The consequence is that migrations, backfills, purges, and rare true system jobs need an explicit posture:

- Normal jobs run as a user actor, workspace-scoped actor, or narrow system actor through `withDataContext()`.
- Normal workers do not receive `BYPASSRLS`.
- pg-boss payloads store context and resource ids, not private content.
- Maintenance/backfill code is not normal worker code and does not run through public module APIs.
- Any operation that needs broader access must be an explicit maintenance command with a named purpose, reviewed SQL or code path, operator/audit record, and narrow scope.
- Disabling RLS or using a superuser is break-glass only, outside the app runtime, and must not become a product feature.

## Library Choices

Confirmed:

- pg-boss is viable for v1 durable jobs.
- pg-boss can run with a separate schema and runtime `migrate: false`.
- pg-boss workers can preserve the RLS posture when handlers use the app data-context wrapper.

Still deferred:

- Final migration runner.
- Full pg-boss operational hardening.
- Queue naming and module-owned job registration conventions.
- Schedule/supervise/BAM settings for production.

## ADR Impact

ADR 0001 does not need a reversal.

Update the implementation direction from "pg-boss candidate pending spike" to "pg-boss viable for v1, with metadata-only payloads and handlers required to enter `withDataContext()` before app data access."
