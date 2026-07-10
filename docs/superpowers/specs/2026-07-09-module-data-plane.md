# Module data plane — per-module migration ledger, privileged install, module-owned tables

**Status:** Draft — awaiting Ben approval
**Date:** 2026-07-09
**Owner:** Ben
**GitHub:** #914 (part of epic #860; unblocks #913 platform prerequisites 3, 4, and 9)
**Grounded on:** `origin/main` @ `260ac0ae`, verified against a detached read-only worktree

---

## Goal

Let an externally installed module (per the approved #818 open-module-system spec) own real
relational tables: carry its own SQL migrations, have them applied by a privileged operator action,
read and write only its own tables under RLS, and participate in export/delete/disable/purge — all
through generic contracts with nothing consumer-specific in core.

This is the deepest #860 coupling. Today every migration lives in one global monotonic `NNNN_`
namespace shared across `infra/postgres/migrations/` and every built-in module's `sql/` dir, and an
externally installed module cannot participate in that sequence.

## Current state (verified)

- `runSqlMigrations` (`packages/db/src/migrations/sql-runner.ts`) discovers `.sql` files, sorts
  alphabetically, SHA-256 hash-checks applied files against `app.schema_migrations`
  (`version text PK, name, checksum, applied_at`), and serializes under advisory lock
  `hashtext('jarv1s:migrations')`.
- `assertUniqueMigrationVersions` enforces one global `NNNN_` filename namespace across the core
  dir plus every module dir collected via `BuiltInModuleRegistration.sqlMigrationDirectories`
  (`packages/module-registry/src/index.ts`). The manifest's `database.migrations` /
  `migrationDirectories` fields are declarative only — never read at runtime.
- `tests/integration/foundation.test.ts` asserts the **full** applied-migration list with `toEqual`
  (currently `0001`…`0151`).
- Migrations run via `scripts/migrate.ts` as `jarvis_migration_owner` (non-superuser,
  `NOBYPASSRLS`, sole `CREATE ON DATABASE` grant), invoked in prod as the one-shot Compose service
  `migrate` under `profiles: ["ops"]` — the app and workers never run DDL. **The privileged-install
  seam already exists**; this spec extends it rather than inventing a new one.
- Owned-table pattern (e.g. `packages/sports/sql/0133_sports_follows.sql`): table in `app` schema,
  `ENABLE` + `FORCE ROW LEVEL SECURITY`, per-verb policies `TO jarvis_app_runtime` guarded by
  `owner_user_id = app.current_actor_user_id()`, explicit grants.
- Repositories accept only the branded `DataContextDb` (`packages/db/src/data-context.ts`);
  `withDataContext` opens a transaction and sets `app.actor_user_id` / `app.request_id`.
- `manifest.dataLifecycle` exists for built-ins, but `ModuleExportSection.collect` is a
  **function** — an external JSON manifest cannot carry it (the same problem #818 solved for
  assistant tools with handler ids).

## Decisions

### D1. External modules get a namespaced ledger; built-ins stay on the global one

New table `app.module_schema_migrations` with `PRIMARY KEY (module_id, version)`. Each external
module numbers its own migrations from `0001` in its package's `sql/` directory, independent of the
global sequence and of every other module. Hash-checking, transaction-per-file, and the advisory
lock behave exactly as in `runSqlMigrations` today (the runner is parameterized, not duplicated).

Core and built-in module migrations are **not** renumbered and **not** moved to the new ledger.
Applied migrations are immutable; rewriting ledger history for working built-ins is risk with no
consumer. The global-sequence coupling is broken where it matters — for externally installed
modules. If a built-in module is later extracted into a package, its migration history migrates in
that extraction's own spec.

Consequence for tests: `foundation.test.ts`'s full-list assertion continues to cover core +
built-ins unchanged. External-module coverage is per-module invariants (see Verification), never a
hardcoded global list.

### D2. Install is an extension of the existing ops seam

Module install/upgrade DDL runs only through a new `scripts/module-install.ts`, exposed as a
Compose ops-profile one-shot service alongside `migrate` (same image, same
`jarvis_migration_owner` connection, same advisory lock). It:

1. Discovers packages in `JARVIS_MODULES_DIR` (reusing the #818 Slice 1 loader and validation —
   manifest schema, id prefixes, path bounds, package hash).
2. Applies the selected module's pending migrations to the namespaced ledger.
3. Generates roles, RLS policies, and grants (D3) and runs post-apply verification (D4) in the
   same transaction; any violation rolls everything back.
4. Records the applied package hash so runtime hash-drift auto-disable (#818) and the data plane
   agree on what is installed.

`app_runtime`, `worker_runtime`, and the module's own worker process can never execute DDL. There
is no install-from-web-UI path; the runtime surfaces install state read-only.

### D3. Owner-only by construction: the platform generates RLS, policies, and grants

External module SQL is deliberately narrow in v1. A module's migrations may only create/alter
tables and indexes in the `app` schema whose names start with the module's **table prefix**
(derived from the module id, e.g. `jarv1s.job-search` → `job_search_`; collisions with existing
tables or other modules' prefixes are rejected at install). Every table MUST have
`owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE`.

The install runner — not the module — then generates for every module-owned table:

- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`;
- per-verb owner-only policies (`owner_user_id = app.current_actor_user_id()`), named
  `<table>_<verb>` per the existing convention;
- grants to the module's dedicated runtime role (D5) only.

Module authors cannot write policies, grants, `SECURITY DEFINER` functions, triggers on foreign
tables, or DDL outside their prefix. Owner-only is the only shareability class for external module
tables in v1 — matching the #913 consumer, which declares no sharing. Owner-or-share and
recipient-only classes for external modules are follow-on scope with their own spec.

### D4. Verified, not trusted: catalog diff inside the install transaction

Within the install transaction, the runner snapshots `pg_catalog` state (tables, policies, grants,
functions, triggers) before and after applying the module's SQL and asserts:

- every created/altered object is a table or index under the module's prefix in `app`;
- every module table has `rowsecurity` and `relforcerowsecurity` true and carries
  `owner_user_id`;
- no grants exist beyond the generated ones; no objects were created outside the prefix;
- every table is listed in the manifest's `database.ownedTables` (which becomes **authoritative
  and enforced** for external modules, not declarative).

Any assertion failure aborts the transaction — the database is untouched and the module is not
recorded as installed. This is enforcement by construction plus verification, not review-only
trust.

### D5. Per-module runtime role + parent-side scoped access

Each installed module gets a dedicated Postgres role (`jarvis_mod_<slug>_runtime`, created at
install, `NOSUPERUSER … NOBYPASSRLS` like all runtime roles) with grants on exactly its own
tables. Module worker handlers still receive no DB handle (#818 invariant). They access their
tables through a parent-process storage RPC:

- `ctx.db.query(sql, params)` — parameterized SQL executed by the trusted parent inside
  `withDataContext(accessContext)` with `SET LOCAL ROLE jarvis_mod_<slug>_runtime`.
- Enforcement is DB-level, not parser-level: the module role simply has no privileges on any other
  table, and RLS owner policies bind rows to the invocation's `actorUserId`. A malicious or buggy
  query fails on privileges, not on string inspection.
- The RPC refuses multi-statement strings and statements outside a read/write allowlist
  (`SELECT/INSERT/UPDATE/DELETE`) as defense-in-depth; the role is the real boundary.

Rejected alternative: a declarative CRUD/record API. It would grow into a second ORM to satisfy
real modules (upserts, dedup queries, aggregate reads — all needed by the first consumer) while
providing no stronger guarantee than the role + RLS boundary already gives.

### D6. Lifecycle derived from structure, no module code

Because every external module table is owner-only with a mandatory `owner_user_id`:

- **Export:** the platform contributes one export section per module listing each owned table's
  rows for the actor, collected under the actor's `DataContextDb` (RLS-scoped). No `collect`
  function needed — this closes the function-in-JSON-manifest gap.
- **Account deletion:** every owned table is automatically included with the existing default
  predicate (`owner_user_id = $1::uuid`), feeding the same `MODULE_DELETION_TABLES` path used
  today.
- **Disable:** runtime deactivation only (#818); data is preserved, role grants stay in place but
  nothing executes.
- **Uninstall purge:** a separate explicit ops action (same `module-install.ts` entrypoint) that
  drops the module's tables, ledger rows, runtime role, and #818 status/credential/KV rows. Never
  implied by disable or by deleting the package directory.

## Data model

New platform SQL (core migration, normal global sequence, next free `NNNN`):

- `app.module_schema_migrations` — `module_id text`, `version text`, `name text`,
  `checksum text`, `applied_at timestamptz`, `PRIMARY KEY (module_id, version)`. Owned by
  `jarvis_migration_owner`; no runtime role has any grant (install-path only).
- `app.module_installs` — `module_id text PK`, `package_hash text`, `table_prefix text UNIQUE`,
  `runtime_role text UNIQUE`, `installed_at`, `updated_at`. Read-only visibility for admin
  settings via the existing settings-module patterns.

Both rows are metadata only — no user content. The core migration adds its rows to the
`foundation.test.ts` full-list assertion, and full `test:integration` runs (not focused tests).

## Build slices

1. **Ledger + runner:** `app.module_schema_migrations`, parameterized namespaced runner, unit +
   integration coverage for hash-drift, duplicate versions within a module, and cross-module
   independence.
2. **Install entrypoint:** `scripts/module-install.ts` + Compose ops service; #818 loader reuse;
   prefix/collision validation; `app.module_installs`.
3. **Generated security:** per-module role creation, generated RLS/policies/grants, catalog-diff
   verification, rollback tests (a hostile fixture module must fail closed).
4. **Storage RPC + lifecycle:** `ctx.db.query` through the parent under `SET LOCAL ROLE` +
   `withDataContext`; derived export/deletion registration; uninstall purge; end-to-end fixture
   module proving cross-module and cross-user denial.

Slices 1–3 depend only on #818 Slice 1 (the loader). Slice 4's RPC lands with the #818 Slice 3
worker runtime.

## Non-goals

- No renumbering or ledger migration of applied core/built-in migrations, ever.
- No sharing classes beyond owner-only for external module tables in v1.
- No module-authored policies, functions, triggers, or grants in v1.
- No DDL from app runtime, workers, module workers, or any web-initiated path.
- No cryptographic package signing (marketplace follow-on; #818 hash pinning stands in).
- Nothing job-search-specific: no consumer tables, prefixes, or carve-outs in core.

## Security and invariants

- **No admin private-data bypass:** install grants configuration power only; module runtime roles
  are `NOBYPASSRLS`; generated policies are owner-only for all actors including admins.
- **Private by default:** owner-only by construction; there is no path to a cross-user grant.
- **DataContextDb only:** the storage RPC executes inside `withDataContext`; module code never
  sees a Kysely instance or connection string.
- **Secrets never escape:** install/ledger rows are metadata; the storage RPC result path carries
  module table data only to the module's own trusted handler.
- **Never edit applied migrations:** hash checks apply per module exactly as globally; a changed
  applied file aborts install.
- **Module isolation:** DB-level — a module's role has no privileges on core or foreign module
  tables; verified by integration tests that attempt the access.

## Verification

- Unit: namespaced version parsing, per-module duplicate detection, prefix derivation and
  collision rejection, checksum drift abort.
- Integration: install a fixture module end-to-end; assert ledger rows, generated policies
  (`rowsecurity`/`relforcerowsecurity`), grants limited to the module role; re-run install is a
  no-op; modified applied file aborts.
- Security: hostile fixture module (table outside prefix, missing `owner_user_id`, extra GRANT,
  `SECURITY DEFINER` function) fails the catalog diff and leaves no trace; module role cannot
  read core tables or another module's tables; RPC under user A cannot read user B's rows.
- Lifecycle: export contains the actor's module rows; account deletion purges them; uninstall
  purge drops tables/role/ledger; disable preserves data.
- Gates: `pnpm verify:foundation` + full `test:integration`; `foundation.test.ts` list updated for
  the two new core migrations only.

## Approval state

Draft. Open questions for Ben: none blocking — D1 (external-only ledger scope) and D3 (owner-only
by construction, platform-generated security) are the two decisions worth a deliberate yes.
