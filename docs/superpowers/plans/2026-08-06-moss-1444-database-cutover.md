# Moss rename PR4 — database table rename (#1444)

Epic #1440. Spec: `docs/superpowers/specs/2026-08-05-moss-rename-design.md` §4, §5, §7.
Issue: #1444. Model: Opus.

---

## 0. What changed since this plan was approved

This plan originally bundled three things: the `app.jarvis_*` → `app.moss_*` table rename, a rename
of the four Postgres runtime roles, and a new `infra/postgres/baseline/0000_baseline.sql` that
existed only to make the role rename provable on a fresh database. **Two of the three are gone.**

- **The role rename is cut permanently.** The four `jarvis_*` roles stay as they are, tracked
  separately in issue #1461. §6 of the original plan named freezing the roles as _the alternative_
  to the baseline approach — that alternative has been taken.
- **The baseline is dropped.** It was scaffolding for the role rename. With the roles frozen there
  is no fresh-database provisioning problem to solve, and no baseline file was ever committed.
- **What remains is a normal PR**: the table rename, in the owning modules' own `sql/` directories,
  landing in the same commit as the application code that queries those tables.

There is no cutover window, no superuser script, no out-of-band step, and no manual runbook. The
database name `jarv1s` is **not** renamed here either — that was coupled to the role work and is
deferred with it.

Sections below are what survives, re-verified.

---

## 1. Seams check — verified against `origin/main`

### 1.1 Verified correct

| Claim                                                              | Citation                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Applied migrations are sha256-hash-checked over the whole file     | `packages/db/src/migrations/sql-runner.ts:62-63,173`            |
| Version collision aborts before any migration runs                 | `sql-runner.ts:145` `assertUniqueMigrationVersions`             |
| Each migration file is its own transaction                         | `sql-runner.ts:70`, `:124`                                      |
| Gate databases are created fresh on the shared cluster             | `scripts/run-gate.sh:145,172`; `scripts/test-integration.ts:61` |
| Migration versions are unique **globally** across core and modules | `scripts/migrate.ts:34`                                         |

### 1.2 The ordering fact that decides where these files live

`scripts/migrate.ts:36-48` runs the **core** migrations directory to completion first, then loops
over `getBuiltInSqlMigrationDirectories()` and runs each built-in module's directory. All of it is
one process, one deploy step, before any application container starts
(`infra/docker-compose.prod.yml:44-50`).

A rename of a module-owned table placed in `infra/postgres/migrations/` therefore executes **before**
the module migration that creates that table has ever run. On any database built from scratch it
aborts `42P01 relation "app.jarvis_goals" does not exist`. This is not hypothetical — it is how the
first version of this migration failed on fresh CI.

### 1.3 Ownership — all 60 identifiers are module-owned, none are core-owned

Classified by grepping each identifier against `packages/*/sql/`:

| Owner                | Objects                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/goals/sql` | `jarvis_goals*`, `jarvis_goal_evidence*` — created by `0123_long_running_goals.sql`                                     |
| `packages/ai/sql`    | `jarvis_action_audit_log*`, `jarvis_error_log*`, `purge_jarvis_*`, `record_anonymous_error` — created by `0127`, `0145` |

Implicit constraint names (`_pkey`, `_check`, `_fkey`) appear in no SQL file because Postgres
generates them from `CREATE TABLE`; they belong to their table's owner.

Core migrations under `infra/postgres/migrations/` mention `jarvis` **only** as role names
(`jarvis_app_runtime`, `jarvis_migration_owner`, …), which are frozen and out of scope.

**Consequence: there is no core migration in this change at all.** The rename ships as two files,
`packages/goals/sql/0182_moss_rename_goals.sql` and `packages/ai/sql/0183_moss_rename_ai.sql`.

### 1.4 Dependent-object count

The spec estimated "~25 further objects". Enumerated from the live catalogue:

| Object class                             | Actual | Notes                                                                                  |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Tables                                   | **4**  |                                                                                        |
| Standalone indexes                       | **5**  |                                                                                        |
| CHECK constraints                        | **25** |                                                                                        |
| FOREIGN KEY constraints                  | **5**  |                                                                                        |
| PRIMARY KEY constraints                  | **4**  | index-backed, renames with the constraint                                              |
| UNIQUE constraints                       | **1**  | `jarvis_goals_owner_user_id_id_key`                                                    |
| RLS policies                             | **15** |                                                                                        |
| Triggers                                 | **1**  |                                                                                        |
| Function names containing `jarvis`       | **3**  | incl. the trigger function, a distinct `pg_proc` row from the trigger of the same name |
| Function **bodies** referencing `jarvis` | **3**  | see §1.5                                                                               |

**63 named objects**, split 28 (goals) / 35 (ai).

### 1.5 `app.record_anonymous_error` is the sharpest object in the job

It is `SECURITY DEFINER`, owned by `jarvis_migration_owner`, `search_path = app, public`, and its
**body** references `app.jarvis_error_log`. Its own name contains no `jarv`, so every name-based
search misses it.

`prosrc` is stored as text and `ALTER TABLE … RENAME` does **not** rewrite it. After the table rename
the function still resolves a relation that no longer exists, and fails **only at call time** — the
first time an anonymous error is recorded, which is exactly when you are already debugging something
else. Called from `packages/ai/src/repository.ts:2040`.

All three affected functions are `CREATE OR REPLACE`d in the same file as the table rename, with
`SECURITY DEFINER` and `search_path` restated (both are cleared on replace unless respecified).
Owner and `EXECUTE` grants survive because the signature is unchanged.

---

## 2. Design decisions

### 2.1 Split by owning module, not by subject

Each module's rename is numbered after the migration that created its tables, inside that module's
own directory, where ordering is guaranteed. Versions remain globally unique (`migrate.ts:34`).

### 2.2 The rename and its callers land in one commit

`packages/goals/src/repository.ts`, `packages/ai/src/repository.ts` and
`packages/settings/src/data-export-queries.ts` (goals tables read cross-module) all query these
tables. They move in the same commit as the SQL, so no build of the app ever queries a name that
does not exist in the schema that build migrates to.

### 2.3 No `IF EXISTS` guards

A guard would green CI while silently renaming nothing.

### 2.4 Roles are frozen

No role identifier appears in either migration. That is a permanent property of these files, not a
timing accident. Issue #1461 owns the role question.

---

## 3. Atomicity — why splitting the migration is safe here

The objection against splitting was: module SQL applies whenever each module's runner picks it up,
so tables get renamed while shipped app code still queries the old names.

That is true of **external** modules, which use a separate ledger (`app.module_schema_migrations`,
`packages/db/src/migrations/module-sql-runner.ts:172,192`). It is not true of these two. `goals` and
`ai` are **built-in** modules: `getBuiltInSqlMigrationDirectories()`
(`packages/module-registry/src/index.ts:2088`) returns their directories unconditionally, not
filtered by install or enable state, and `scripts/migrate.ts:36-48` runs them in the same process and
the same deploy step as the core migrations, before any container starts.

- **Is there a window where a renamed table is live against old code?** Only the ordinary
  single-deploy restart window, because the migrate service and the app image ship together. That is
  acceptable for a one-user instance.
- **Can a module rename land on a deploy that does not carry the new app code?** No. There is no
  path that runs a built-in module's SQL other than `scripts/migrate.ts`, which is part of the same
  deploy as the image it migrates for.
- **Do modules get installed later?** Not in the SQL sense. A built-in module's SQL runs on every
  migrate regardless of install state, so a later-enabled module has already had both `0123` and
  `0182` applied in order.

---

## 4. Verification — expected exit codes, never piped

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm verify:foundation > /tmp/vf-1444.log 2>&1; echo "EXIT=$?"     # expect EXIT=0
git diff -U0 origin/main...HEAD -- '*.sql'                          # expect: only the two module files
```

Run the gate through the `verify-gate` skill with a fresh gate database. Never unscoped — an
unscoped run hits the live dev database. Never piped — a pipeline returns the filter's exit code, so
red reads as green. A green local gate excludes CI's e2e step and both compose smoke jobs; CI is the
authority.

The SQL diff check is not optional: a repo-wide sweep silently edited four applied migrations on
#1442, comment-only, which would have aborted migrate on every existing install. Note that
`git diff | grep '^[-+][^-+]'` **misses SQL entirely** — SQL comments start with `--`, so a changed
comment renders as `+--` and the pattern excludes it.

`tests/integration/foundation-schema-catalog.test.ts` asserts the full migration catalogue ordered by
version, across core and module directories, and must list both new files.

---

## 5. Rollback

Both files are pure `ALTER … RENAME` plus three `CREATE OR REPLACE FUNCTION`. To roll back, ship the
inverse renames as new migrations together with the reverted app code. Never edit an applied
migration — the runner hash-checks the whole file including comments, so even a comment-only edit
breaks every existing install, and CI cannot catch it because gate databases are fresh.

---

## 6. Out of scope — deferred, with owners

1. **The four `jarvis_*` runtime roles** — frozen permanently for this issue. _Issue #1461._
2. **`ALTER DATABASE jarv1s RENAME TO moss`** — was coupled to the role work; deferred with it.
3. **Eight `jarv1s-*` Docker volumes and the `jarv1s` network** (`infra/docker-compose.prod.yml`) —
   frozen. Renaming any of them creates a new empty volume; for `jarv1s-modules` that silently
   uninstalls every downloaded module, and for `jarv1s-cli-auth` it drops the CLI sign-in.
4. **`scripts/smoke-compose.ts`** hardcodes five things: the database name (`:133-136`), the compose
   project `jarv1s-prod-smoke` (`:32`), the image `ghcr.io/motioneso/jarv1s` (`:40`), the service
   name (`:56`), and the temp-dir prefix (`:121`).
5. **`scripts/backup-full.sh`** writes `jarv1s-$TIMESTAMP.tar.gz` (`:101`) **and prunes by the same
   prefix** (`:30`, `:44`). Renaming either half alone fails silently — one strands every existing
   archive from retention, the other prunes nothing. Rename both, and keep a `jarv1s-*` glob in the
   prune list so pre-cutover archives still age out.
6. **`jarv1s-prod` compose project name and the systemd units** — renaming needs
   stop/disable/install/`daemon-reload`/enable/remove-old plus a checkout-directory migration.
   _Owner: Ben._
7. **`~/Jarv1s` checkout path** — embedded in three systemd units as `WorkingDirectory` and in every
   `ExecStart`. _Same follow-up._
8. **Five advisory-lock strings**, six call sites: `jarv1s:migrations` (`sql-runner.ts:199,203`),
   `jarv1s:first-user-bootstrap` (`packages/auth/src/index.ts:484`), `jarv1s:last-active-admin`
   (`packages/settings/src/repository.ts:860` **and** `scripts/delete-user-data.ts:168`),
   `jarv1s:module-reconcile` (`scripts/module-reconcile.ts:122,314`). All frozen. The
   `last-active-admin` pair is the one that matters: the app and the script must agree on the string
   or they stop excluding each other, and nothing fails loudly when they don't.
9. **Other deferred renames**, each needing a dual-read plus a data migration or restage: module IDs,
   `jarvis.module.json`, `compatibility.jarv1s`, `mcp__jarvis__`, `jarvis_mod_*` roles,
   `actor_kind='jarvis'`, `jarvis-emotion-v1` (live in `app.wellness_checkins.wheel_version` as a
   column default). _Separate issues under #1440._
10. **Tier C shim removal** — the `JARVIS_*` fallbacks in `packages/db/src/env.ts`.

---

## 7. Rulings ledger

| #   | Ruling                                                                                           | Evidence                                                               |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| R1  | 63 named database objects need renaming, not ~29                                                 | live `pg_indexes`/`pg_constraint`/`pg_policies`/`pg_trigger`/`pg_proc` |
| R2  | `record_anonymous_error` breaks at call time after the table rename; its name contains no `jarv` | `pg_proc.prosrc`, `packages/ai/src/repository.ts:2040`                 |
| R3  | All 60 renamed identifiers are module-owned; none are core-owned                                 | grep of each against `packages/*/sql/`                                 |
| R4  | Core migrations run to completion before any module directory, so a core rename aborts 42P01     | `scripts/migrate.ts:36-48`                                             |
| R5  | Built-in module SQL is not gated on install state, so there is no deferred-apply window          | `packages/module-registry/src/index.ts:2088`                           |
| R6  | Migration versions are globally unique across core and every module directory                    | `scripts/migrate.ts:34`                                                |
| R7  | Goals tables are referenced outside their module                                                 | `packages/settings/src/data-export-queries.ts`                         |
| R8  | Eight volumes + one network are frozen, not three                                                | `infra/docker-compose.prod.yml` volumes block                          |
| R9  | Backup prune matches `jarv1s-*` — renaming one side fails silently                               | `scripts/backup-full.sh:30,44,101`                                     |
