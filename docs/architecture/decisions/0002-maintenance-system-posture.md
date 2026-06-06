# ADR 0002: Maintenance And System Job Posture

Status: Accepted
Date: 2026-06-06

## Context

Spike 0001 proved that protected app tables should use Postgres RLS with transaction-local app context and `FORCE ROW LEVEL SECURITY`.

Spike 0002 proved that pg-boss can be used for durable jobs without giving normal workers a private-data bypass.

This creates an important boundary: normal app and worker code must not rely on ownership, admin status, or broad runtime roles to read private data. At the same time, real systems need migrations, backfills, purges, repairs, and rare system jobs.

## Decision

Normal app and worker code must run through the standard data-context wrapper and non-bypass runtime roles.

Normal jobs must run under one of:

- user actor context
- workspace-scoped actor context
- narrow system actor context

pg-boss job payloads are operational metadata. They may contain actor ids, workspace ids, resource ids, job kind, idempotency keys, and small command parameters. They must not contain secrets, private bodies, raw connector payloads, or model-visible private content.

Maintenance/backfill/purge operations are separate from normal worker jobs. They require an explicit maintenance entrypoint, named purpose, narrow scope, operator/audit record, and reviewed SQL or code path.

Disabling RLS, using a superuser, or using a role with `BYPASSRLS` is break-glass only. It must run outside the app runtime and must not become a product-facing capability.

## Consequences

- Runtime app and worker roles remain non-superuser, non-owner, and `NOBYPASSRLS`.
- Instance admin remains configuration power, not private-data read power.
- Module code cannot define its own privileged maintenance bypass.
- The migration runner must support explicit SQL and role separation.
- Backfills that need protected data must be designed deliberately instead of hidden inside normal workers.
- Audit logging for maintenance operations is required before production use.

## Implementation Notes

The v1 scaffold should include:

- a shared `withDataContext()` package
- a typed job payload convention that stores context and resource ids only
- a migration/maintenance command surface separate from app and worker runtime
- a documented break-glass procedure for self-hosted operators
- tests that prove runtime roles cannot bypass protected RLS
