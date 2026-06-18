# Spec - OTNR P1 production-safe database role bootstrap

**Issue:** #117
**Status:** approved for build planning
**Date:** 2026-06-18

## Goal

Finish the live residual from the OTNR P1 DB/RLS audit by making database role password
provisioning production-safe. `pnpm db:migrate` must not create or reset runtime roles with
committed development passwords when pointed at a real environment.

## Current State

Already fixed and out of scope for this slice:

- `app.instance_settings` and `app.admin_audit_events` have `ENABLE` and `FORCE` RLS through
  `infra/postgres/migrations/0059_admin_tables_rls.sql`.
- Missing `TO <role>` clauses on chat/memory policies were corrected in
  `packages/chat/sql/0060_chat_memory_settings_to_role.sql` and
  `packages/memory/sql/0061_memory_facts_to_role.sql`.
- The old workspace/resource-grant subsystem has been torn down by
  `infra/postgres/migrations/0056_drop_dead_workspace_subsystem.sql` and the follow-up module
  cleanup in `packages/tasks/sql/0006_tasks_drop_workspace_grants.sql`.

Live residual:

- `scripts/migrate.ts` runs every SQL file in `infra/postgres/bootstrap` on every migration through
  `runSqlFiles`.
- `infra/postgres/bootstrap/0000_roles.sql` currently creates and alters role passwords with
  committed literals:
  - `migration_password`
  - `app_password`
  - `worker_password`
  - `auth_password`
- Because bootstrap SQL is re-run, a production migration can reset runtime roles back to development
  passwords unless the bootstrap path is made environment-driven or explicitly guarded.

## Build Scope

### 1. Move role password values out of committed SQL

The bootstrap path must no longer contain `CREATE ROLE ... PASSWORD '<dev literal>'` or
`ALTER ROLE ... PASSWORD '<dev literal>'` statements for Jarvis runtime roles.

Acceptable implementations include either:

- generating/executing the role create/update statements from TypeScript using configured
  production database URLs or explicit role-password environment variables; or
- passing role password values into SQL through a safe parameterized/substitution path that is owned
  by the migration runner.

The implementation must preserve the existing role hardening attributes, database grants, and
`GRANT jarvis_auth_runtime TO jarvis_migration_owner` behavior.

### 2. Keep local development zero-friction

Local Docker/dev should still work without requiring developers to manually provision role passwords.
The existing local defaults in `getJarvisDatabaseUrls` may remain as development-only fallbacks when
`NODE_ENV` is not `production`.

Production must continue to require explicit database URLs through `getJarvisDatabaseUrls`.

### 3. Make production migration behavior safe on repeated runs

Running `pnpm db:migrate` repeatedly against a production-like configuration must not reset roles to
committed development credentials.

The production path should either:

- set role passwords from the configured production secrets every time; or
- create roles with configured secrets only when missing and leave existing role passwords untouched
  unless an explicit rotation path is invoked.

Whichever behavior is chosen must be documented in the release-hardening operations docs.

### 4. Add regression coverage

Add tests that make this impossible to regress silently. Coverage should include:

- bootstrap SQL does not contain committed Jarvis role-password literals;
- production database URL requirements still fail closed when missing;
- the migration/bootstrap role-password plan derives runtime role passwords from configured secrets,
  or refuses to proceed when production role secrets are missing or still set to development
  defaults;
- local development defaults still produce the expected role URLs.

## Acceptance Criteria

- No committed bootstrap SQL assigns `migration_password`, `app_password`, `worker_password`, or
  `auth_password` to database roles.
- `pnpm db:migrate` still bootstraps required roles, grants, and attributes for a fresh local
  database.
- Production migration requires explicit non-development role credentials and cannot silently run the
  role bootstrap with committed dev passwords.
- The chosen password-rotation behavior is documented in `docs/operations/release-hardening.md`.
- Existing DB/RLS tests continue to pass.
- `pnpm verify:foundation` passes.

## Non-Goals

- Reopening the RLS fixes already shipped in migrations `0059`, `0060`, and `0061`.
- Reintroducing the retired workspace/resource-grant model.
- Building a full secrets manager for database role rotation.
- Changing application runtime database privilege boundaries beyond the bootstrap password handling.
