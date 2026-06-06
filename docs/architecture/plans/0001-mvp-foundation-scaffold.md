# Plan 0001: MVP Foundation Scaffold

Status: Implemented
Date: 2026-06-06

## Purpose

Create the smallest runnable Jarv1s application foundation that preserves the security and job posture proven by Spike 0001 and Spike 0002.

This plan is an execution guide, not a new architecture decision. ADR 0001 and ADR 0002 remain the source of truth for system direction and hard invariants.

## Inputs

Read these before implementation:

- `docs/architecture/decisions/0001-foundation.md`
- `docs/architecture/decisions/0002-maintenance-system-posture.md`
- `docs/architecture/spikes/0001-auth-rls-safety.md`
- `docs/architecture/spikes/0002-pg-boss-worker-rls.md`

Reference proof code:

- `spikes/auth-rls-safety/`
- `spikes/pg-boss-rls/`

## Scope

Build a minimal foundation scaffold:

- pnpm workspace layout
- root TypeScript, Vitest, and package scripts
- Docker Compose services for API, worker, Postgres, and migrations
- explicit raw SQL migration runner
- versioned SQL migrations for the proven RLS role/table/policy posture
- `packages/db` with Kysely setup, database types, `AccessContext`, and `withDataContext()`
- `packages/jobs` with pg-boss client construction, metadata-only payload conventions, and worker registration helpers
- `apps/api` with a minimal Fastify process and health route
- `apps/worker` with a minimal pg-boss worker process and probe job
- integration tests against Postgres that prove the real packages preserve the spike guarantees

## Non-Scope

Do not build yet:

- full UI
- full module system
- real OAuth providers
- real connectors
- task, email, calendar, notes, chat, briefing, or notification modules
- final API contract layer unless a small local route is needed for integration testing
- arbitrary workflow engine
- maintenance UI
- production-grade pg-boss hardening beyond the role posture needed for the scaffold

## Package Shape

Use this first-pass structure unless implementation details strongly justify a small deviation:

```txt
apps/api/
apps/worker/
packages/db/
packages/auth/
packages/jobs/
packages/shared/
infra/docker-compose.yml
infra/postgres/
```

`packages/auth` and `packages/shared` can be skeletal if the foundation does not need real auth yet. Avoid building product features to justify them.

## Migration Runner Decision

Decision: use a project-local TypeScript SQL runner built on `pg`.

Implementation:

- `packages/db/src/migrations/sql-runner.ts`
- `scripts/migrate.ts`
- migration ledger table: `app.schema_migrations`
- bootstrap SQL directory: `infra/postgres/bootstrap/`
- versioned app SQL migration directory: `infra/postgres/migrations/`
- post-pg-boss runtime grant SQL directory: `infra/postgres/grants/`

Rationale:

- keeps raw SQL explicit and reviewable
- avoids adopting a migration framework before the foundation needs one
- separates role bootstrap from normal migrations
- lets app/worker startup run without schema, table, function, policy, or queue creation privileges
- keeps pg-boss schema creation under the migration role while runtime clients use `migrate: false`

The runner applies ordered `.sql` files, stores version/checksum records, and rejects edited migrations after application. pg-boss still uses pg-boss's own schema migration path under `jarvis_migration_owner`, followed by explicit SQL grants that keep runtime roles from creating queues.

Original selection requirements:

Minimum requirements:

- runs ordered versioned SQL files
- tracks applied migrations in Postgres
- can run separately from API and worker startup
- uses the migration/owner role, not app or worker runtime roles
- does not require runtime roles to create schemas, tables, functions, queues, or policies
- works in Docker Compose and local development

This can be promoted to an ADR later if migration policy becomes more complex.

## Implementation Order

1. Choose the raw SQL migration runner and add a short rationale.
2. Create the pnpm workspace, package layout, and root scripts.
3. Add TypeScript, Vitest, lint/format basics, and shared config only as needed.
4. Move the proven RLS SQL into versioned migrations.
5. Move the proven `AccessContext` and `withDataContext()` implementation into `packages/db`.
6. Add Kysely connection construction for app, worker, and migration contexts.
7. Add Docker Compose services and role/database environment wiring.
8. Add pg-boss schema/queue migration setup under the migration role.
9. Add `packages/jobs` pg-boss client helpers with `migrate: false` for runtime clients.
10. Add the minimal Fastify API process.
11. Add the minimal worker process and probe job.
12. Add integration tests against the scaffold packages.
13. Keep spike tests runnable until equivalent scaffold tests pass.

## Security Invariants

The scaffold must preserve these rules:

- runtime app and worker roles are non-superuser, non-owner, and `NOBYPASSRLS`
- protected app tables keep `FORCE ROW LEVEL SECURITY`
- missing or invalid app context denies protected reads
- admin/owner status does not grant private-data read access
- cross-user private-data access requires explicit grants or workspace membership on workspace-visible resources
- repositories accept only a branded transaction-scoped data handle
- root Kysely instances do not reach repositories
- `withDataContext()` sets transaction-local `app.actor_user_id`, `app.workspace_id`, and `app.request_id`
- pooled connections do not leak actor/workspace context
- pg-boss payloads contain operational metadata only
- worker handlers enter `withDataContext()` before touching protected app repositories
- runtime pg-boss clients use `migrate: false` and cannot create queues at runtime

## Job Payload Convention

Job payloads may contain:

- actor user id
- workspace id, when required
- resource ids
- job kind
- idempotency keys
- small command parameters

Job payloads must not contain:

- secrets
- private bodies
- raw connector payloads
- prompts containing private content
- model-visible private content
- arbitrary module-owned blobs

## Integration Acceptance Criteria

Add a single scaffold verification command that proves, from real packages rather than spike code:

- migrations apply from an empty database
- app and worker roles lack `BYPASSRLS`
- runtime roles do not own protected tables
- missing context denies protected reads
- a user can read their own private row
- a user cannot read another user's unshared private row
- instance admin cannot read another user's private row by admin role alone
- explicit grant allows access
- workspace membership works only for workspace-visible rows in the active workspace context
- pooled context does not leak between requests
- rollback clears transaction-local context
- repository calls outside `withDataContext()` fail loudly or are structurally impossible
- pg-boss can enqueue and process a metadata-only job with runtime `migrate: false`
- a worker handler with User A context cannot read User B private data
- runtime queue creation fails for app/worker roles

## Expected Commands

```txt
pnpm install
pnpm typecheck
pnpm db:up
pnpm db:migrate
pnpm test:integration
```

Keep the current spike verification working until the scaffold tests fully cover the same substrate:

```txt
pnpm spike:db:up
pnpm exec tsc --noEmit
pnpm test:spike
```

Known-good result after implementation:

```txt
pnpm typecheck
pnpm db:up
pnpm db:migrate
pnpm test:integration
pnpm spike:db:up
pnpm test:spike
```

```txt
Integration Test Files  1 passed (1)
Integration Tests       15 passed (15)
Spike Test Files        2 passed (2)
Spike Tests             15 passed (15)
```

## Completion Criteria

The foundation scaffold is complete when:

- Docker Compose can start Postgres, API, worker, and migration flow
- migrations can build the database from scratch
- API exposes at least a health endpoint
- worker starts and can process the minimal probe job
- integration tests pass against the real scaffold packages
- spike directories remain intact
- the handoff doc points to the new scaffold verification command
- no product module work has been introduced

## Deferred Decisions

Keep these undecided unless needed for the scaffold:

- Better Auth integration details
- final API contract layer
- full module manifest and SDK shape
- connector framework
- AI provider router details
- production maintenance UI and audit workflow
- detailed Jarv1s shell visual design
