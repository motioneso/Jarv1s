# Spike 0001: Auth To RLS Safety

Status: Completed
Date: 2026-06-06

M1 note: this spike remains historical proof. The current executable guardrails are now the real scaffold/product integration tests in `tests/integration/foundation.test.ts` and `tests/integration/tasks.test.ts`.

## Goal

Prove that Jarv1s can safely enforce user isolation through both app-layer authorization and Postgres row-level security across API requests, pooled Kysely connections, and background worker jobs.

This is the highest-risk architecture seam. Do this before full MVP scaffolding.

## Non-Goals

Do not build:

- Full UI
- Full module system
- Real Gmail/calendar connectors
- Full OAuth provider matrix
- oRPC or final API contract layer
- Full task system
- Full workflow engine

## Hypothesis

Jarv1s can use a transaction-scoped data context wrapper that sets Postgres local settings with `SET LOCAL`, then runs all repository queries inside that transaction.

The wrapper should make pooled-connection leaks impossible because `SET LOCAL` lasts only for the current transaction and clears at commit/rollback.

## Core Design To Prove

All application data access must go through a wrapper shaped like:

```ts
await withDataContext(accessContext, async (db) => {
  return repository.doWork(db, input);
});
```

Inside the wrapper:

```sql
SET LOCAL app.actor_user_id = '<uuid>';
SET LOCAL app.workspace_id = '<uuid or empty>';
SET LOCAL app.request_id = '<uuid>';
```

Repositories receive only the transaction-scoped database handle. They must not receive the root Kysely instance.

## Database Roles

The spike should separate at least:

- Migration/owner role
- Runtime app role
- Worker app role, if different

The runtime roles must not have `BYPASSRLS` and should not own protected tables.

If ownership makes RLS bypass possible in the spike, the spike must document the fix before continuing.

## Tables To Create

Use minimal probe tables:

- `users`
- `auth_sessions` or a stub session table
- `workspace_memberships`
- `resource_grants`
- `rls_probe_items`
- `jobs` tables from the job library, if pg-boss is included

`rls_probe_items` should include:

- `id`
- `owner_user_id`
- `workspace_id`
- `body`
- `created_at`

## Policies To Prove

At minimum:

- Missing app context denies access.
- User can read own private row.
- User cannot read another user's private row.
- Admin cannot read another user's private row by admin role alone.
- Explicit grant allows access.
- Workspace membership allows access only when the resource is workspace-shared.
- Worker job can access only data allowed by its stored actor/system context.

## Worker Posture

Workers do not bypass RLS by default.

Most jobs must run with one of:

- User actor context
- Workspace-scoped actor context
- Narrow system context

True system jobs must be rare, audited, and unable to read arbitrary private data by accident.

The spike must answer:

- Does the job library run queries through the same app database role?
- Are job metadata tables separate from protected user data?
- How is actor context stored on a job?
- Can a worker accidentally call repositories without `withDataContext`?

## Test Cases

Automated tests must prove:

1. No context means default deny.
2. User A sees User A private row.
3. User A cannot see User B private row.
4. Instance admin cannot see User B private row without explicit sharing.
5. Explicit grant allows User A to see User B shared row.
6. Workspace membership allows access only for workspace-shared rows.
7. Pooled connection does not leak identity from one request to the next.
8. Transaction rollback clears context.
9. Worker job with User A context cannot read User B private row.
10. Repository calls outside the data-context wrapper fail loudly or are structurally impossible.

## RLS Performance Guardrails

Avoid recursive policies that re-query protected tables directly.

Prefer simple indexed ownership checks where possible:

- `owner_user_id`
- `workspace_id`
- grant lookup keys

If policy helper functions are needed, evaluate `SECURITY DEFINER` functions that read narrow membership/grant tables and document their privileges carefully.

Add indexes for every key used by policies.

## Success Criteria

The spike succeeds only if:

- All tests pass.
- No root database handle reaches repositories.
- Runtime app role cannot bypass RLS.
- Missing context is default deny.
- Pooled connection identity leaks are proven absent.
- Worker jobs have an explicit RLS posture.
- The approach feels simple enough to make the default path for all future modules.

## Output

At completion, update this document with:

- Final approach
- Any rejected approaches
- Library choices confirmed or rejected
- Exact database role posture
- Any changes required to ADR 0001

## Result

Completed in `spikes/auth-rls-safety`.

Verification commands:

```txt
pnpm exec tsc --noEmit
pnpm spike:db:up
pnpm test:spike
```

Result:

```txt
Test Files  1 passed (1)
Tests       11 passed (11)
```

The spike proves the core hypothesis: a Kysely transaction wrapper can set Postgres local settings with `set_config(..., true)`, run repositories through a transaction-scoped branded handle, and let Postgres RLS enforce isolation without leaking identity across pooled connections.

## Final Approach

The data path is:

```txt
auth session -> AccessContext -> DataContextRunner.withDataContext()
  -> Kysely transaction -> transaction-local app.* settings
  -> repository receives only branded transaction handle
  -> Postgres RLS policy evaluates current actor/workspace
```

The wrapper sets:

```sql
app.actor_user_id
app.workspace_id
app.request_id
```

Repositories require a `DataContextDb` value created by the wrapper. Calling a repository without that value fails loudly with:

```txt
Repository access requires withDataContext
```

The RLS policy for `app.rls_probe_items` allows reads only when:

- the actor owns the row
- an explicit resource grant exists
- the row is workspace-visible, the active workspace matches the row, and the actor is a workspace member

Missing or invalid app context resolves to `NULL` and denies access.

Membership and grant checks use narrow `SECURITY DEFINER` helper functions instead of exposing direct lookup-table reads to runtime roles. The protected table has `FORCE ROW LEVEL SECURITY` enabled.

## Worker Result

The worker uses its own non-bypass runtime role. Job metadata is stored separately in `app.spike_jobs`; a worker loads the stored actor/workspace context, then calls normal repositories only through `withDataContext`.

The test suite proves a job stored with User A context cannot read User B private data. A direct worker-role query without context also returns no protected rows.

This answers the worker posture questions for the spike:

- The spike does not include pg-boss yet.
- Job metadata is separate from protected user data.
- Actor context is stored on the job row.
- Repositories are structurally typed to require the wrapper handle and also perform a runtime guard.

## Database Role Posture

Roles created by `spikes/auth-rls-safety/sql/000_roles.sql`:

- `jarvis_migration_owner`
- `jarvis_app_runtime`
- `jarvis_worker_runtime`

All three are:

```txt
NOSUPERUSER
NOCREATEDB
NOCREATEROLE
NOINHERIT
NOREPLICATION
NOBYPASSRLS
```

`jarvis_migration_owner` owns the `app` schema and protected tables. Runtime roles do not own protected tables.

Runtime grants are narrow:

- `jarvis_app_runtime`: schema usage, auth/session read, protected item read through RLS, helper function execution
- `jarvis_worker_runtime`: schema usage, job metadata read/update, protected item read through RLS, helper function execution

The Docker `postgres` superuser is used only for local spike bootstrap and fixture seeding. Because `FORCE ROW LEVEL SECURITY` is enabled, even the table owner is subject to policies. Future data migrations/backfills need an explicit maintenance posture instead of relying on ownership bypass.

## Test Coverage

Automated tests prove:

1. No context means default deny.
2. Runtime roles do not own protected tables and do not have `BYPASSRLS`.
3. A resolved auth session gives a user access to their own private row.
4. User A cannot read User B's unshared private row.
5. Instance admin cannot read User B's private row by admin role alone.
6. Explicit grants allow access.
7. Workspace membership works only for workspace-shared rows in the active workspace context.
8. Pooled connections do not leak identity between requests.
9. Transaction rollback clears context.
10. Worker job with User A context cannot read User B private data.
11. Repository calls outside the wrapper fail loudly.

## Library Choices

Confirmed for the security substrate:

- Kysely can support the transaction-scoped data context pattern.
- Postgres RLS with transaction-local settings is viable.
- Vitest is sufficient for the integration proof.

Deferred:

- Better Auth remains only an authn/session/OAuth candidate. The spike used a stub `auth_sessions` table.
- pg-boss remains a jobs candidate. The spike used a minimal `spike_jobs` table to prove worker RLS posture first.
- API contract tooling remains undecided.
- Final migration runner remains undecided.

## Rejected Or Deferred Approaches

Rejected for this layer:

- Allowing repositories to receive the root Kysely instance.
- Depending on app-layer admin checks to protect private data.
- Letting worker code use a privileged database role for normal jobs.
- Relying on table ownership to bypass RLS.

Deferred:

- pg-boss integration details.
- Full auth provider integration.
- Full module or API scaffold.

## ADR 0001 Impact

No foundational ADR decision needs to change.

Add one implementation note before MVP scaffolding: data migrations, backfills, and rare true system jobs need an explicit audited maintenance/system posture, because protected tables use `FORCE ROW LEVEL SECURITY` and ownership is not a private-data bypass.
