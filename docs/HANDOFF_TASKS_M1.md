# Jarv1s M1 Tasks Handoff

Date: 2026-06-06

## Objective

Implement M1: the first real Tasks module vertical slice on top of the existing MVP foundation scaffold.

This should prove module-owned data, API routes, RLS-protected repositories, and worker jobs end to end. It should not become the full product MVP.

Status: Complete as of 2026-06-06.

## Required Reading

Read these first:

- `docs/HANDOFF.md`
- `docs/architecture/plans/0002-tasks-module-mvp.md`
- `docs/architecture/plans/0001-mvp-foundation-scaffold.md`
- `docs/architecture/decisions/0001-foundation.md`
- `docs/architecture/decisions/0002-maintenance-system-posture.md`

Useful implementation references:

- `packages/db/src/data-context.ts`
- `packages/db/src/migrations/sql-runner.ts`
- `packages/jobs/src/pg-boss.ts`
- `tests/integration/foundation.test.ts`
- `spikes/auth-rls-safety/`
- `spikes/pg-boss-rls/`

## Current State

The foundation scaffold and M1 Tasks slice exist and verify:

- app and worker roles are non-owner and `NOBYPASSRLS`
- protected reads deny without app context
- `withDataContext()` sets transaction-local app context
- pooled connection context does not leak
- admin does not bypass private data
- pg-boss runs with runtime `migrate: false`
- runtime queue creation fails
- worker handlers can touch protected data only after entering `withDataContext()`
- built-in module registry loads the Tasks manifest
- Tasks SQL is applied through the migration flow from `packages/tasks/sql`
- Tasks repository accepts only `DataContextDb`
- Tasks API derives actor context from `Authorization: Bearer <session-id>`
- the Tasks worker job uses metadata-only payloads and enters `withDataContext()`

Known-good commands:

```txt
pnpm db:up
pnpm verify:foundation
pnpm test:tasks
pnpm spike:db:up
pnpm test:spike
```

Current known-good results:

```txt
Foundation integration: 2 files, 28 tests passed
Tasks focused:          1 file, 13 tests passed
Spike tests:            2 files, 15 tests passed
```

## First Fixes

Completed:

1. Moved the migration advisory lock in `runSqlMigrations()` so it is acquired before checking `app.schema_migrations`.
2. Added `pnpm verify:foundation`.
3. Made the Compose subnet and API host port configurable and documented both in `README.md`.

These stayed small and did not redesign the foundation.

## Completed Execution

1. Ran the known-good foundation and spike verification commands.
2. Applied the small foundation fixes listed above.
3. Added tiny module manifest/registry types for built-in modules only.
4. Added the Tasks module package and manifest.
5. Added Tasks SQL migrations and wired them into the migration flow.
6. Added Tasks repository methods that require `DataContextDb`.
7. Added API context handling from `Authorization: Bearer <session-id>` to `AccessContext`, with optional workspace header.
8. Added Fastify Tasks routes.
9. Added one Tasks worker job with metadata-only payload.
10. Added integration tests for task RLS, API behavior, module loading, and worker posture.
11. Updated docs with the final verification commands and deferred decisions.

## Hard Constraints

- Do not import from `spikes/`.
- Do not delete the spike directories.
- Do not weaken `FORCE ROW LEVEL SECURITY`.
- Do not give app or worker runtime roles ownership or `BYPASSRLS`.
- Do not let repositories accept root Kysely instances.
- Do not accept `owner_user_id` from client payloads.
- Do not put task titles, descriptions, comments, prompts, secrets, or connector content into pg-boss payloads.
- Do not implement final OAuth or Better Auth provider setup unless it is necessary for session-to-context conversion.
- Do not build a UI yet.

## Minimal Deliverable

Delivered:

- a built-in Tasks module manifest
- task and task activity tables with RLS
- Tasks repository using only `DataContextDb`
- Fastify Tasks routes backed by session-derived context
- one Tasks worker job using metadata-only payloads
- integration tests proving privacy, sharing, API context, and worker posture
- `pnpm verify:foundation` plus any focused `pnpm test:tasks` command

## What To Do With Spikes

Leave the spike directories intact and frozen.

The new Tasks work should rely on real packages, not spike imports. Once Tasks integration tests prove the same substrate on a product table, update the spike docs to say the spike code is historical proof and the scaffold/product tests are the current executable guardrail.

This is now true: `tests/integration/foundation.test.ts` and `tests/integration/tasks.test.ts` are the current scaffold/product guardrails. The spike directories remain historical proof and still pass.

## Stop Conditions

Stop and ask for direction if any of these become necessary:

- choosing final API contract tooling
- adding real OAuth/OIDC providers
- changing the privacy model
- broadening admin access to private data
- introducing a workflow engine
- adding frontend application shell work
