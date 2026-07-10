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
global sequence and of every other module. Hash-checking and the `jarv1s:migrations` advisory lock
behave exactly as in `runSqlMigrations` today.

Unlike the core runner's transaction-per-file, an external module install/upgrade is **atomic per
operation**: all pending files for that module, plus the platform-generated security and the
catalog verification (D3/D4), are applied in a single transaction on the module's installer
connection. A later invalid file never leaves earlier files committed. "Installed" means the
ledger rows are committed (D2 phase C); every earlier failure either rolls back to zero trace or
is deterministically recoverable from the journaled intent row — the exact semantics are in D2.

Core and built-in module migrations are **not** renumbered and **not** moved to the new ledger.
Applied migrations are immutable; rewriting ledger history for working built-ins is risk with no
consumer. The global-sequence coupling is broken where it matters — for externally installed
modules. If a built-in module is later extracted into a package, its migration history migrates in
that extraction's own spec.

Consequence for tests: `foundation.test.ts`'s full-list assertion continues to cover core +
built-ins unchanged. External-module coverage is per-module invariants (see Verification), never a
hardcoded global list.

### D2. Install is an extension of the existing ops seam, with a narrow role-broker phase

Module install/upgrade runs only through a new `scripts/module-install.ts`, exposed as a Compose
ops-profile one-shot service alongside `migrate` (same image). It uses **three connections with
strictly separated powers**, mirroring how `scripts/migrate.ts` already splits superuser bootstrap
(`infra/postgres/bootstrap/`, idempotent, via `urls.bootstrap`) from `jarvis_migration_owner`
migrations:

**Roles (created in phase A, below).** `jarvis_migration_owner` is `NOCREATEROLE`
(`infra/postgres/bootstrap/0000_roles.sql`) and stays that way — it never creates roles. Instead,
per installed module the bootstrap connection creates exactly two roles from platform-generated
DDL (the module id is a validated slug; module-authored text never reaches role DDL):

- `jarvis_mod_<slug>_runtime` — `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`. Holds
  grants on exactly the module's tables (D3). Granted to the parent roles that execute storage
  RPCs — `GRANT jarvis_mod_<slug>_runtime TO jarvis_worker_runtime, jarvis_app_runtime WITH
INHERIT FALSE` — so those parents may `SET LOCAL ROLE` to it (D5) without ever inheriting its
  privileges ambiently (`WITH INHERIT FALSE` is PG16+ syntax; Compose runs `pgvector:pg17`). This
  follows the existing membership precedent
  (`GRANT jarvis_auth_runtime TO jarvis_migration_owner`, 0000_roles.sql).
- `jarvis_mod_<slug>_install` — the **installer role**, the confinement boundary for
  module-authored SQL (D4). `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, privileges limited
  to `USAGE`+`CREATE` on schema `app` and a scoped `GRANT REFERENCES (id) ON app.users` (for the
  mandatory FK). It has **no** DML, DDL, or even SELECT rights on core tables, platform tables, or
  other modules' tables. It is `NOLOGIN` at rest; phase A flips it to `LOGIN` with a random
  ephemeral password for the duration of the run and phase D flips it back.

No role ever receives broad `CREATEROLE`; role provisioning happens only on the superuser
bootstrap connection inside this ops-only entrypoint, and only for the two names above.

**Phases.** The whole operation serializes under the existing `jarv1s:migrations` advisory lock.

- **Phase A — bootstrap (superuser connection, idempotent):** validate the package with the #818
  Slice 1 loader (manifest schema, id prefix, path bounds, package hash); ensure the two roles,
  memberships, and scoped grants exist; enable installer login. Then, as `jarvis_migration_owner`,
  journal an **intent row** in `app.module_installs` (`status = 'installing'`, target package
  hash, the pending file list with checksums, and a **canonical pre-B fingerprint** of the
  module-owned catalog state — tables, columns, constraints, indexes, comments, policies, grants,
  and column-owned sequences under the module's prefix, normalized and hashed; never volatile
  stats or OIDs). The
  fingerprint is what lets a later process classify recovery states without parsing module SQL.
- **Phase B — module SQL (installer connection, ONE transaction):** connect _as_
  `jarvis_mod_<slug>_install` and apply **all** pending migration files — each file is a single
  extended-protocol DDL statement per the D3 wire contract, so module text cannot `COMMIT`,
  `ROLLBACK`, or otherwise end the transaction early — then the platform-generated
  RLS/policies/grants (D3 — the installer role owns the tables it created, so it can issue these
  itself), then the catalog verification (D4). Any failure rolls back the entire transaction —
  zero trace. Because this is a real connection authenticated as the installer role,
  `RESET ROLE` / `SET SESSION AUTHORIZATION` in module SQL cannot escalate: there is nothing to
  reset to.
- **Phase C — record (migration_owner connection, ONE transaction):** write the
  `app.module_schema_migrations` rows and flip `app.module_installs.status` to `'installed'` with
  the applied package hash (so runtime hash-drift auto-disable per #818 and the data plane
  agree).
- **Phase D — finalize (superuser bootstrap connection):** disable installer login
  (`ALTER ROLE` requires role-broker privileges — `jarvis_migration_owner` is `NOCREATEROLE` and
  never alters roles).

**Installer-login crash safety.** A process dying while login is enabled must not leave a usable
credential: the password is random, held only in process memory, never stored anywhere; phase A
grants login with a short `VALID UNTIL` bound so the credential expires on its own; and phase A
of every run begins by sweeping — disabling login on — any `jarvis_mod_*_install` role left
enabled by a dead run.

**Recovery semantics (the B→C gap).** A crash between B's commit and C's commit leaves applied
but unrecorded DDL. On the next run, `status = 'installing'` makes this explicit and the runner
resolves it deterministically from the journaled intent. Determinism holds because of two facts:
phase B is a single transaction, and the D3 wire contract makes module migrations DDL-only — so
the catalog either contains **all** of the journaled changes or **none** of them, and there is no
invisible committed DML to guess about.

Classifying which of those two states the new process sees uses the journaled pre-B fingerprint,
not SQL parsing: recompute the canonical fingerprint of the module-owned catalog state and
compare. **Equal to the journaled pre-B fingerprint** → phase B never committed; re-run phase B
(retry). **Different, and D4 re-verification passes** → the atomic phase-B transaction committed;
complete phase C (roll forward). Any other combination (different but re-verification fails)
aborts loudly for operator attention — it means outside interference, not a crashed install. So
that fingerprint comparison is always decisive, D4 additionally **rejects a pending operation
whose catalog diff is empty**: every accepted install/upgrade must change the fingerprint. For a
fresh install the runner may equivalently drop every object under the module's prefix and start
over — safe, since no user data exists before first install completes. The runner never guesses;
the intent row is the authority.

`app_runtime`, `worker_runtime`, and the module's own worker process can never execute DDL. There
is no install-from-web-UI path; the runtime surfaces install state read-only.

### D3. Owner-only by construction: the platform generates RLS, policies, and grants

External module SQL is deliberately narrow in v1. A module's migrations may only create/alter
tables and indexes in the `app` schema whose names start with the module's **table prefix**
(derived from the module id, e.g. `jarv1s.job-search` → `job_search_`; collisions with existing
tables or other modules' prefixes are rejected at install). Every table MUST have
`owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE`.

**Enforced migration wire contract.** Module migration files are not free-form SQL scripts:

- **Exactly one SQL statement per migration file.** The runner executes each file's content as a
  single extended-query-protocol statement; Postgres itself rejects multi-command strings there
  (`cannot insert multiple commands into a prepared statement`) — this is server-enforced, not a
  platform parser.
- **First-command allowlist, checked before execution:** `CREATE TABLE`, `CREATE [UNIQUE] INDEX`,
  `ALTER TABLE`, `DROP INDEX`, `COMMENT ON`. Everything else is rejected — all transaction
  control (`BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`PREPARE TRANSACTION`), all session control
  (`SET`/`RESET`/`SET SESSION AUTHORIZATION`), all DML, `DO`, `CALL`, `COPY`. Because the wire
  contract makes a second statement impossible, first-command classification cannot be evaded by
  hiding text after a semicolon; a hostile file whose entire content is `COMMIT` fails the
  allowlist, and a file containing `CREATE TABLE …; COMMIT` fails at the protocol level. This is
  what makes the phase-B transaction (D2) genuinely un-endable by module text.
- **Consequence: migrations are catalog-visible DDL only.** Data backfills are not migrations —
  a module performs them from its own runtime code through the D5 RPC (bounded, RLS-scoped,
  per-actor). This is load-bearing for D2 recovery: since module migrations cannot contain DML,
  every phase-B effect is visible in `pg_catalog`, so crash recovery never has to infer whether
  invisible data changes were committed.

The install runner — not the module — then generates for every module-owned table:

- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`;
- per-verb owner-only policies (`owner_user_id = app.current_actor_user_id()`), named
  `<table>_<verb>` per the existing convention;
- grants to the module's dedicated runtime role (D5) only, including `USAGE` on the tables'
  sequences.

These generated statements execute on the installer connection in the same phase-B transaction:
the installer role owns the tables it just created, so it may create their policies and grants
itself, and no other connection needs rights over module objects. Tables stay owned by
`jarvis_mod_<slug>_install` — which is `NOLOGIN` outside install runs — and `FORCE ROW LEVEL
SECURITY` subjects even the owner to the policies.

Module authors cannot write policies, grants, `SECURITY DEFINER` functions, triggers on foreign
tables, or DDL outside their prefix. Owner-only is the only shareability class for external module
tables in v1 — matching the #913 consumer, which declares no sharing. Owner-or-share and
recipient-only classes for external modules are follow-on scope with their own spec.

### D4. Privileges are the boundary; the catalog diff is defense-in-depth

The **primary** confinement of module-authored SQL is the installer connection's privilege set
(D2): the role can create objects in schema `app` and reference `app.users(id)`, and nothing
else. `TRUNCATE`, `DELETE`, `UPDATE`, `SELECT`, or DDL against core tables, platform tables, or
another module's tables fails at the Postgres privilege level regardless of what the SQL says — a
catalog-identical mutation of foreign data is not possible, because the privilege to perform it
was never granted. This is not `SET ROLE` from a privileged session (which module SQL could
`RESET`); it is a separately authenticated connection whose session user _is_ the least-privileged
role.

On top of that, within the same phase-B transaction, the runner snapshots `pg_catalog` state
(tables, policies, grants, functions, triggers) before and after applying the module's SQL and
asserts:

- every created/altered object is a table or index under the module's prefix in `app`
  (`CREATE` on a schema does not constrain names — the diff is what enforces the prefix policy
  and collision rejection), with one subordinate exception: sequences implicitly created by and
  owned by a module-table identity/serial column are permitted, included in the fingerprint, and
  covered by the generated `USAGE` grant (D3); free-standing `CREATE SEQUENCE` remains rejected
  by the D3 allowlist;
- every module table has `rowsecurity` and `relforcerowsecurity` true and carries
  `owner_user_id`;
- no grants exist beyond the generated ones; no functions or triggers were created (v1 scope);
- every table is listed in the manifest's `database.ownedTables` (which becomes **authoritative
  and enforced** for external modules, not declarative);
- the diff is **non-empty**: an operation with pending files that changes no module-owned catalog
  state is rejected, which keeps the D2 recovery fingerprint comparison decisive (pre-B
  fingerprint ≠ post-B fingerprint for every accepted operation).

Any assertion failure aborts the transaction — the database is untouched and the module is not
recorded as installed. The diff catches policy violations (naming, shape, scope creep) and
accidents; it is not what stops hostile DML — the privilege boundary is.

### D5. Per-module runtime role + parent-side scoped, bounded access

Each installed module gets the dedicated `NOLOGIN` Postgres role `jarvis_mod_<slug>_runtime`
(created in D2 phase A, `NOSUPERUSER … NOBYPASSRLS` like all runtime roles) with grants on
exactly its own tables. It is reachable only via `SET ROLE` from the parent roles that hold its
`WITH INHERIT FALSE` membership (`jarvis_worker_runtime` for module worker RPCs,
`jarvis_app_runtime` for synchronous assistant-tool dispatch). Module worker handlers still
receive no DB handle (#818 invariant). They access their tables through a parent-process storage
RPC:

- `ctx.db.query(sql, params)` — parameterized SQL executed by the trusted parent inside
  `withDataContext(accessContext)` with `SET LOCAL ROLE jarvis_mod_<slug>_runtime`. `SET LOCAL`
  reverts at transaction end, and the statement itself runs over the **extended query protocol**
  (parameterized), which Postgres restricts to a single statement — a module cannot smuggle
  `RESET ROLE; <anything>` because a second statement is rejected at the protocol level, and
  `RESET ROLE` alone fails the statement-type allowlist below.
- Enforcement is DB-level, not parser-level: the module role simply has no privileges on any other
  table, and RLS owner policies bind rows to the invocation's `actorUserId`. A malicious or buggy
  query fails on privileges, not on string inspection.
- **Resource bounds** (privileges don't stop `pg_sleep` or `SELECT generate_series(1, 1e9)`):
  every call runs under `SET LOCAL statement_timeout` (platform default, per-module override
  capped by config), a row-count cap and serialized-result byte cap enforced by the parent before
  handing results to the child, and cancellation — when the invoking job or tool call is
  cancelled or times out, the parent cancels the in-flight statement rather than orphaning it.
- **Error redaction:** the child sees only the SQLSTATE, a sanitized primary message, and its own
  statement context. Anything referencing platform internals (connection details, other roles,
  core relation internals from planner/executor frames) is stripped by the parent before the RPC
  error crosses the process boundary.
- The RPC refuses statements outside a read/write allowlist (`SELECT/INSERT/UPDATE/DELETE`) as
  defense-in-depth; the role is the real boundary.

Rejected alternative: a declarative CRUD/record API. It would grow into a second ORM to satisfy
real modules (upserts, dedup queries, aggregate reads — all needed by the first consumer) while
providing no stronger guarantee than the role + RLS boundary already gives.

### D6. Lifecycle derived from structure, no module code

Because every external module table is owner-only with a mandatory `owner_user_id`:

- **Export:** the platform contributes one export section per module listing each owned table's
  rows for the actor. No `collect` function needed — this closes the function-in-JSON-manifest
  gap. Because runtime parents hold only `WITH INHERIT FALSE` membership (no ambient grants on
  module tables), the derived collector cannot read them directly: it runs platform-generated
  per-table `SELECT`s inside the actor's `withDataContext` transaction under
  `SET LOCAL ROLE jarvis_mod_<slug>_runtime` — the same parent-side scoped helper as the D5 RPC.
  Export and its dry-run therefore see exactly what the module itself can see, RLS-scoped to the
  actor; this path is explicitly integration-tested.
- **Account deletion:** every owned table is automatically included with the existing default
  predicate (`owner_user_id = $1::uuid`), feeding the same `MODULE_DELETION_TABLES` path used
  today. The mandatory `ON DELETE CASCADE` FK guarantees purge even independent of grants —
  referential actions fire inside the platform's user-delete path regardless of the caller's
  module-table privileges.
- **Disable:** runtime deactivation only (#818); data is preserved, role grants stay in place but
  nothing executes.
- **Uninstall purge:** a separate explicit ops action (same `module-install.ts` entrypoint) that
  drops the module's tables, ledger rows, both roles (`_install` and `_runtime`, memberships
  revoked first), and #818 status/credential/KV rows. Never implied by disable or by deleting the
  package directory.

## Data model

New platform SQL (core migration, normal global sequence, next free `NNNN`):

- `app.module_schema_migrations` — `module_id text`, `version text`, `name text`,
  `checksum text`, `applied_at timestamptz`, `PRIMARY KEY (module_id, version)`. Owned by
  `jarvis_migration_owner`; no runtime role has any grant (install-path only).
- `app.module_installs` — `module_id text PK`, `status text` (`installing` | `installed` only —
  enable/disable stays solely in #818's `app.external_modules.status`; no second source of
  truth), `package_hash text`, `table_prefix text UNIQUE`, `runtime_role text UNIQUE`,
  `install_journal jsonb` (pending file list + checksums + canonical pre-B catalog fingerprint
  for D2 recovery), `installed_at`, `updated_at`. RLS is explicit: `ENABLE` + `FORCE`, a single SELECT policy `USING (true)`
  `TO jarvis_app_runtime` (instance-level metadata, no user content, read by admin settings), and
  no INSERT/UPDATE/DELETE policies or grants to any runtime role — writes are install-path only.

Both tables are metadata only — no user content, no secrets (the ephemeral installer password is
never stored). The core migration adds its rows to the `foundation.test.ts` full-list assertion,
and full `test:integration` runs (not focused tests).

## Build slices

1. **Ledger + runner:** `app.module_schema_migrations`, parameterized namespaced runner, unit +
   integration coverage for hash-drift, duplicate versions within a module, and cross-module
   independence.
2. **Install entrypoint:** `scripts/module-install.ts` + Compose ops service; #818 loader reuse;
   prefix/collision validation; `app.module_installs` with intent journaling and B→C recovery.
3. **Generated security:** phase-A role broker (two roles, memberships, scoped grants, login
   toggling), installer-connection execution, generated RLS/policies/grants, catalog-diff
   verification, rollback tests (a hostile fixture module must fail closed).
4. **Storage RPC + lifecycle:** `ctx.db.query` through the parent under `SET LOCAL ROLE` +
   `withDataContext` with timeout/row/byte caps, cancellation, and error redaction; derived
   export/deletion registration; uninstall purge; end-to-end fixture module proving cross-module
   and cross-user denial.

Slices 1–3 depend only on #818 Slice 1 (the loader). Slice 4's RPC lands with the #818 Slice 3
worker runtime.

## Non-goals

- No renumbering or ledger migration of applied core/built-in migrations, ever.
- No sharing classes beyond owner-only for external module tables in v1.
- No module-authored policies, functions, triggers, or grants in v1.
- No DML in module migrations, ever in v1 — backfills are module runtime code via the D5 RPC.
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
- **Module isolation:** DB-level — neither of a module's roles has privileges on core or foreign
  module tables; verified by integration tests that attempt the access.
- **No privilege creep in role provisioning:** no role gains `CREATEROLE`; per-module roles are
  created only by the superuser bootstrap connection inside the ops-only install entrypoint, from
  platform-generated DDL over a validated slug. Memberships are `WITH INHERIT FALSE` so parent
  runtime roles gain only the right to `SET ROLE`, never ambient module-table access.

## Verification

- Unit: namespaced version parsing, per-module duplicate detection, prefix derivation and
  collision rejection, checksum drift abort.
- Integration: install a fixture module end-to-end; assert ledger rows, generated policies
  (`rowsecurity`/`relforcerowsecurity`), grants limited to the module role; re-run install is a
  no-op; modified applied file aborts.
- Security: hostile fixture module (table outside prefix, missing `owner_user_id`, extra GRANT,
  `SECURITY DEFINER` function) fails the catalog diff and leaves no trace; a fixture whose SQL
  attempts `TRUNCATE`/`UPDATE`/`SELECT` on a core table, or `RESET ROLE` / `SET SESSION
AUTHORIZATION`, fails on privileges from the installer connection; wire-contract fixtures — a
  migration file that is exactly `COMMIT` (allowlist rejection), a file containing
  `CREATE TABLE …; COMMIT` (protocol-level multi-command rejection), and a DML file
  (`INSERT`/`UPDATE` — allowlist rejection) — all abort with the phase-B transaction intact;
  module runtime role cannot read core tables or another module's tables; RPC under user A
  cannot read user B's rows; RPC rejects multi-statement input, enforces `statement_timeout`
  (e.g. against `pg_sleep`) and row/byte caps, and redacts platform internals from errors.
- Recovery: kill the installer between phase B commit and phase C; the next run classifies via
  the journaled pre-B fingerprint (fingerprint unchanged → retry B; changed + D4 re-verify passes
  → roll forward C) — covered for fresh `CREATE TABLE` installs **and** for upgrades whose only
  changes are `ALTER TABLE` or `COMMENT ON`; an operation with pending files but an empty catalog
  diff is rejected; fingerprint-changed-but-verification-fails aborts loudly. Kill it with
  installer login enabled; the next run's phase-A sweep disables it, and `VALID UNTIL` bounds the
  credential regardless.
- Lifecycle path: derived export collects the actor's module rows via
  `SET LOCAL ROLE jarvis_mod_<slug>_runtime` (and fails closed if the membership grant is
  missing); account deletion cascades module rows.
- Lifecycle: export contains the actor's module rows; account deletion purges them; uninstall
  purge drops tables/role/ledger; disable preserves data.
- Gates: `pnpm verify:foundation` + full `test:integration`; `foundation.test.ts` list updated for
  the two new core migrations only.

## Approval state

Draft. Open questions for Ben: none blocking — D1 (external-only ledger scope) and D3 (owner-only
by construction, platform-generated security) are the two decisions worth a deliberate yes.
