# Relay 3 — 914-module-data-plane (build agent self-handoff)

**Trigger:** context-meter 70% warning, mid-plan-research (no plan doc written yet, no code
written yet). Still pre-plan, but grounding is now 100% complete — this relay carries the exact
file-structure decisions the plan needs so the successor writes the plan directly, no more
research.

## Where to pick up

- **Spec (approved):** `docs/superpowers/specs/2026-07-09-module-data-plane.md` — already read in
  full by relay-1/2/3. **Do not re-read top-to-bottom.**
- **Prior relay docs:** `docs/superpowers/handoffs/2026-07-10-914-module-data-plane-relay.md` and
  `-relay-2.md` — grounding history, all still valid. **Do not re-read either top-to-bottom** —
  this doc supersedes their "still open" sections.
- **Coordination handoff (do not edit):** `docs/coordination/handoffs/handoff-914-build.md`.
- **Branch/worktree:** `build/914-module-data-plane`, this exact worktree/path. Clean except
  `.claude/context-meter.log` (pre-existing, out of scope, ignore).
- **Coordinator:** label `Coordinator`, session id `4d68fcc5-bc2c-44cd-ae0d-a2e305f94069`. Resolve
  the pane fresh via `herdr pane list` before messaging — never trust a cached `…-N`.
- **Skill:** `coordinated-build`, step 1 ("Plan — then escalate for approval"). **Next action:
  write `docs/superpowers/plans/2026-07-10-module-data-plane.md` via `superpowers:writing-plans`
  directly from this doc's file-structure section below — no more research needed — then message
  the coordinator and STOP for approval before any code.**

## RESOLVED: migration numbers

Confirmed this session (re-ran the checks live): global migration head is **0152**
(`0152_external_modules.sql`), `gh pr list --search "918 in:title,body" --state open` → empty,
`git ls-remote --heads origin | grep -i 918` → no real branch match (only false-positive commit-hash
substring hits on unrelated branches). Per `handoff-914-build.md`'s explicit instruction (#918
*provisionally* holds 0153/0154 and is expected to land first even though not yet pushed): **use
0155 and 0156** for this spec's two new core migrations. Confirmed via `herdr pane list` that
#918's pane (`918: open module system slice2 build (relay-1)`) is still `agent_status: working` —
still in-flight, not merged, don't renumber down to 0153.

- `infra/postgres/migrations/0155_module_schema_migrations.sql` → `app.module_schema_migrations`
- `infra/postgres/migrations/0156_module_installs.sql` → `app.module_installs`

Both go in `tests/integration/foundation.test.ts`'s full-list `toEqual` array (last entry
currently `{ version: "0152", name: "0152_external_modules.sql" }` at line 336) — append the two
new rows after it, exact `{ version, name }` shape (see existing entries lines 250-336).

If #918 lands first before this branch merges: rebase `foundation.test.ts` + `packages/db/src/types.ts`
onto its landed state and re-run full `test:integration` (not focused) — this is explicitly the
coordinator's collision note, not something to pre-solve now.

## RESOLVED: file structure for the plan (map Build slices 1-4 to these exact files)

Verified via direct reads this session: `packages/db/src/migrations/sql-runner.ts` (216 lines,
exports `runSqlMigrations`, `runSqlFiles`, `loadMigrationFiles`, `assertUniqueMigrationVersions`,
uses `hashtext('jarv1s:migrations')` advisory lock, `qualifiedIdentifier`/`quoteIdentifier` SQL
identifier guards); `packages/db/src/index.ts` barrel (`export * from "./migrations/sql-runner.js"`
etc. — 10 re-exports, alphabetical); `packages/db/src/role-bootstrap.ts` (`buildRolePasswordPlan`,
`RUNTIME_ROLE_PASSWORD_DEFAULTS` — the fail-closed-in-prod pattern to mirror for the new installer
role's ephemeral password, though installer password is random/in-memory only, never from a URL);
`infra/postgres/bootstrap/0000_roles.sql` (existing 4-role idempotent `DO $$ ... CREATE ROLE ... ALTER
ROLE ... NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS` pattern — the two
new per-module roles in spec D2 phase A must follow this exact idempotent-DO-block shape, but they
are created by `scripts/module-install.ts` at install time, NOT added to `0000_roles.sql` itself,
since they're per-module and dynamic); `packages/db/src/data-context.ts` (76 lines,
`AccessContext{actorUserId, requestId?}`, `DataContextRunner.withDataContext` opens
`rootDb.transaction().execute()`, sets `app.actor_user_id`/`app.request_id` via `set_config`, the
exact transaction the D5 RPC's `SET LOCAL ROLE jarvis_mod_<slug>_runtime` must run inside);
`packages/module-registry/src/external/validate.ts` (130 lines, `FORBIDDEN_FIELDS` array includes
`"database"` and `"dataLifecycle"` with comment "before the slices that safely host those land" —
confirms extending this validator for `database` is this spec's job, by design, not drift);
`packages/module-registry/src/external/types.ts` (50 lines, `ExternalModuleDiscovery{id, dir,
manifest, manifestHash, packageHash}` — Slice 2's install entrypoint reuses this via the #818
Slice-1 loader, no new discovery mechanism); `packages/sports/sql/0133_sports_follows.sql` (exact
owner-only RLS pattern: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, four
`<table>_<verb>` policies `TO jarvis_app_runtime` guarded by
`owner_user_id = app.current_actor_user_id()`, explicit `GRANT` — Slice 3's generated-RLS code must
produce this shape programmatically per module table, substituting `jarvis_mod_<slug>_runtime` for
`jarvis_app_runtime`); `scripts/migrate.ts` (66 lines — bootstrap→role-passwords→core+built-in
migrations→pg-boss→grants sequence, the precedent for `scripts/module-install.ts`'s phase
structure, though module-install is a *separate* ops entrypoint, not an addition to migrate.ts);
`packages/module-registry/src/index.ts` line 446-448 (`BuiltInModuleRegistration.sqlMigrationDirectories`)
and line 1647-1648 (`getBuiltInSqlMigrationDirectories` flatMaps it) — confirms built-ins stay on
this mechanism unchanged, external modules get an entirely separate ledger/runner, never merged
into this list.

**Test-location conventions confirmed** (important — do not invent a colocated `__tests__` dir,
this repo does not use that pattern except one exception):
- Pure/unit tests: root `tests/unit/*.test.ts` (flat, not colocated with source). Closest existing
  precedent to copy the style from: `tests/unit/external-hash.test.ts` (61 lines — `mkdtempSync`
  fixture dir pattern, `describe`/`it` per exported pure function, hash stability + change-detection
  assertions). New unit test file: `tests/unit/module-sql-runner.test.ts`.
- Integration tests: root `tests/integration/*.test.ts`, using
  `tests/integration/test-database.ts` helpers (`connectionStrings`, `ids`,
  `resetFoundationDatabase()`/`resetEmptyFoundationDatabase()` — the latter calls
  `runSqlFiles(bootstrap, infra/postgres/bootstrap)` → `runSqlMigrations(migration, infra/postgres/migrations)`
  → per-built-in `runSqlMigrations` loop → `migratePgBoss` → `runSqlFiles(migration, infra/postgres/grants)`;
  **new module-install integration tests will need their own reset helper** analogous to this, OR
  extend it — decide in the plan). Closest existing precedent:
  `tests/integration/module-registry.test.ts` (#818 external-module discovery/reconcile
  integration coverage — read this file before finalizing Slice 2/3 test tasks, **not yet read this
  session**, budget for it as the plan's first research step if anything is ambiguous).
- `packages/db/src` has **no** colocated test files at all today (confirmed via `find`) — every DB
  test lives under root `tests/`.

**Proposed new source files for the plan** (names are proposals, not yet created — the plan can
adjust, but this shape matches every convention found above):
- `infra/postgres/migrations/0155_module_schema_migrations.sql`,
  `infra/postgres/migrations/0156_module_installs.sql` — Slice 1, core global-sequence migrations
  (per spec's Data model section: exact column lists there, copy verbatim into the plan).
- `packages/db/src/migrations/module-sql-runner.ts` — Slice 1: namespaced ledger runner
  (`app.module_schema_migrations`, PK `(module_id, version)` not bare `version`) + the D3 wire-contract
  static validator (first-command allowlist: `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, `ALTER TABLE`,
  `DROP INDEX`, `COMMENT ON`; reject everything else) modeled directly on `sql-runner.ts`'s
  `readMigrationFiles`/`assertUniqueMigrationVersions`/`qualifiedIdentifier` shape, but scoped to a
  single module directory + module id. Export from `packages/db/src/index.ts` barrel
  (`export * from "./migrations/module-sql-runner.js"`, alphabetically after `./migrations/sql-runner.js`).
- `tests/unit/module-sql-runner.test.ts` — Slice 1 unit coverage: wire-contract first-command
  classification (accept/reject table), duplicate-version-within-module detection, version parsing.
- New integration test (name TBD in plan, e.g. `tests/integration/module-migration-ledger.test.ts`)
  — Slice 1: hash-drift abort, cross-module independence (two modules can each own version `0001`
  without PK collision since PK is `(module_id, version)`).
- `scripts/module-install.ts` — Slice 2: the 4-phase (A bootstrap / B module SQL / C record / D
  finalize) ops entrypoint per spec D2, modeled on `scripts/migrate.ts`'s connection/sequencing
  style but with 3 distinct connections (superuser bootstrap, installer role, migration_owner) and
  the intent-journal recovery logic (D2's B→C gap handling, fingerprint comparison).
- Compose ops-profile service for `module-install` alongside `migrate` in
  `infra/docker-compose.prod.yml` (read the existing `migrate` service block, ~lines 40-75, before
  writing this task — confirmed present but not yet re-read this session).
- Slice 3: platform-generated RLS/policy/grant emitter (likely a function in
  `module-sql-runner.ts` or a sibling file — decide in plan) producing exactly the
  `0133_sports_follows.sql` shape per module table; catalog-diff verifier (D4) querying
  `pg_catalog`/`information_schema` before/after phase B in the same transaction.
- Slice 4: storage RPC (`ctx.db.query`) — likely lives in `packages/db/src/data-context.ts` sibling
  or a new `packages/db/src/module-storage-rpc.ts`, running `SET LOCAL ROLE jarvis_mod_<slug>_runtime`
  inside `withDataContext`'s transaction; derived export section generator extending
  `packages/settings/src/data-export.ts`'s `collectModuleExportSection()`; deletion registration
  extending `packages/module-registry/src/index.ts`'s `MODULE_DELETION_TABLES`/
  `getModuleDeletionTables()` (defined ~line 1559-1588, confirmed by relay-1); uninstall purge as a
  new `scripts/module-install.ts` subcommand/flag.

## Still open / not yet done

- **No plan document exists yet.** This relay did NOT get to invoke `superpowers:writing-plans`'s
  actual Write call — all research is done, only the writing itself remains. Next concrete step:
  write `docs/superpowers/plans/2026-07-10-module-data-plane.md` using this doc's file-structure
  section directly, structured as the spec's 4 build slices, bite-sized TDD tasks (per-step: write
  failing test → run → minimal impl → run → commit), exact files, migration numbers 0155/0156
  already resolved above, validator-extension decision (extend `FORBIDDEN_FIELDS`/`validate.ts` to
  allow `database` at install-time only, gated by a schemaVersion bump or a distinct install-time
  validation path — see relay-1 doc's full writeup, not repeated here) folded into Slice 1 or 2.
- **Not yet read this session** (budget for these only if the plan-writing step needs the detail,
  per relay-1's original note they were "likely not required"): full
  `packages/module-registry/src/index.ts` past line 1229; `tests/integration/module-registry.test.ts`;
  `infra/docker-compose.prod.yml`'s `migrate` service block; `packages/module-sdk/src/index.ts`
  around `JsonJarvisModuleManifest`/`schemaVersion` doc comments (line ~541-547 confirmed
  `schemaVersion: 1` is a literal-1 field, not yet read the surrounding versioning-seam doc comment
  relay-1 flagged as worth confirming before deciding the validator-extension mechanism).
- **CLAUDE.md required recalls:** treat as satisfied per relay-2's note (MEMORY.md index entries
  Migration Invariants / AccessContext State / RLS Shareability Map cover the required recalls;
  prior `memory_smart_search` attempts returned empty — don't loop on that again).
- **No coordinator message sent about the plan yet** (only relay notices sent so far, across 3
  relays now). After the plan is written: verify exactly one `Coordinator`-labeled pane via
  `herdr pane list`, message it (terse) with the plan path, then **STOP and wait for approval**
  before any TDD work.

## Do not re-do

- Don't re-read spec/relay-1/relay-2/handoff docs top-to-bottom again — this doc's "RESOLVED"
  sections are the current source of truth for migration numbers and file structure.
- Don't re-litigate the validate.ts finding — resolved, extend it, not a conflict.
- Don't re-run `pnpm install`.
- Don't re-verify migration numbers/#918 status again — confirmed live this session (see above);
  only re-check if the plan-writing session itself later approaches the coordinator-approval gate
  and meaningful wall-clock time has passed (use judgment, not a blanket re-check).
- Don't re-send a relay notice to the coordinator until this relay's spawn is confirmed driving.
