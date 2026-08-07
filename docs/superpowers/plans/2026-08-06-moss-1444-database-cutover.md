# Moss rename PR4 — database, roles, images, cutover (#1444)

Epic #1440. Spec: `docs/superpowers/specs/2026-08-05-moss-rename-design.md` §4, §5, §7.
Issue: #1444. Model: Opus. Risk tier: **unrecoverable if wrong**.

Tiers A (#1441) and B (#1442) are merged. Tier C (#1443) is in review. This is the last one, and the
only one that cannot be fixed by a follow-up commit.

---

## 0. Gates

- [x] Approved design spec — `docs/superpowers/specs/2026-08-05-moss-rename-design.md`
- [x] GitHub `task` issue — #1444, `Part of #1440`
- [ ] Migration version allocated immediately before implementation (§3.1 below)
- [ ] Kill gate evaluated after Phase 1 (§6)

---

## 1. Seams check — every assumption cited, verified against `origin/main` @ `b1af91eda`

The spec was written before tier B landed. I re-verified each citation on the current tree. Most
hold. **Four are wrong, and one of the four changes the size of the job.**

### 1.1 Verified correct

| Claim                                                               | Citation                                                                    | Status                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| Applied migrations are sha256-hash-checked over the whole file      | `packages/db/src/migrations/sql-runner.ts:62-63,173`                        | ✅                                        |
| Version collision aborts before any migration runs                  | `sql-runner.ts:145` `assertUniqueMigrationVersions`                         | ✅                                        |
| Each migration file is its own transaction                          | `sql-runner.ts:70`, `:124`                                                  | ✅                                        |
| Migrate opens many sequential connections, most as `urls.migration` | `sql-runner.ts:39`, `:115`; `scripts/migrate.ts:23,36,43,52,53`             | ✅                                        |
| `CREATE SCHEMA … AUTHORIZATION jarvis_migration_owner` is hardcoded | `sql-runner.ts:186`                                                         | ✅ **still present post-tier-B**          |
| Role names come from a hardcoded table, not from the URLs           | `packages/db/src/role-bootstrap.ts` `ROLE_URL_SOURCES`                      | ✅                                        |
| Gate databases are created fresh on the shared cluster              | `scripts/run-gate.sh:145,172`; `scripts/test-integration.ts:61`             | ✅                                        |
| Backup dumps `-Fc --no-owner --no-privileges`                       | `scripts/backup-full.sh:87`                                                 | ✅                                        |
| Next free global migration version is `0182`                        | max version on tree = `0181`, 191 files                                     | ✅                                        |
| Cluster hash method is SCRAM, not MD5                               | live: `password_encryption = scram-sha-256`; all four runtime roles `SCRAM` | ✅ **resolves spec open item #5 for dev** |

### 1.2 Wrong in the spec — corrected here

**(a) The dependent-object count is off by roughly 3×.** The spec estimates "~25 further objects:
~5 indexes, 2 check constraints, ~12 RLS policies and 1 trigger". Enumerated from the live
catalogue:

| Object class                             | Spec estimate     | Actual | Notes                                     |
| ---------------------------------------- | ----------------- | ------ | ----------------------------------------- |
| Tables                                   | 4                 | **4**  | ✅                                        |
| Standalone indexes                       | ~5                | **5**  | ✅                                        |
| CHECK constraints                        | 2                 | **25** | ❌ off by 23                              |
| FOREIGN KEY constraints                  | —                 | **5**  | ❌ not mentioned                          |
| PRIMARY KEY constraints                  | —                 | **4**  | index-backed, renames with the constraint |
| UNIQUE constraints                       | —                 | **1**  | `jarvis_goals_owner_user_id_id_key`       |
| RLS policies                             | ~12               | **15** | ❌ off by 3                               |
| Triggers                                 | 1                 | **1**  | ✅                                        |
| Function names containing `jarvis`       | —                 | **2**  | ❌ not mentioned                          |
| Function **bodies** referencing `jarvis` | flagged as a risk | **3**  | ❌ risk is real, see (b)                  |

**Total named objects to rename: 62.** Not 29. The spec was right that grep would mislead — it
undercounted its own estimate.

**(b) `app.record_anonymous_error` is the sharpest object in the whole job, and nothing named it.**
It is `SECURITY DEFINER`, owned by `jarvis_migration_owner`, `search_path = app, public`, and its
**body** references `app.jarvis_error_log`. Its own name contains no `jarv`, so every name-based
search — including the spec's own `pg_proc` note, which was framed around renamed _functions_ —
misses it.

`prosrc` is stored as text. `ALTER TABLE … RENAME` does **not** rewrite it. After the table rename
the function still resolves `app.jarvis_error_log`, which no longer exists, and fails **only at call
time** — the first time an anonymous error is recorded, which is exactly when you are already
debugging something else. Called from `packages/ai/src/repository.ts:2040`.

All three functions must be `CREATE OR REPLACE`d in the same migration as the table rename.

**(c) The volume freeze list is incomplete.** The spec cites `infra/docker-compose.prod.yml:207-210`
and names three volumes. The file declares **eight**: `jarv1s-postgres-data`, `jarv1s-vault-data`,
`jarv1s-model-cache`, `jarv1s-cli-tools`, `jarv1s-cli-auth`, `jarv1s-cli-socket`, `jarv1s-modules`,
plus the network `jarv1s`. Renaming any of them creates a new empty volume; for `jarv1s-modules` that
silently uninstalls every downloaded module, and for `jarv1s-cli-auth` it drops the CLI sign-in.
**All eight names and the network name are frozen.**

**(d) `scripts/smoke-compose.ts` hardcodes more than the spec's open item #9 suggests.** Not only the
database name at `:133-136` but the compose project `jarv1s-prod-smoke` (`:32`), the image
`ghcr.io/motioneso/jarv1s` (`:40`), the service name `jarv1s` (`:56`), and the temp-dir prefix
(`:121`).

### 1.3 Resolved spec open items

- **#4 — advisory lock strings.** Five distinct keys, six call sites: `jarv1s:migrations`
  (`sql-runner.ts:199,203`), `jarv1s:first-user-bootstrap` (`packages/auth/src/index.ts:484`),
  `jarv1s:last-active-admin` (`packages/settings/src/repository.ts:860` **and**
  `scripts/delete-user-data.ts:168`), `jarv1s:module-reconcile` (`scripts/module-reconcile.ts:122,314`).
  All **frozen**. The `last-active-admin` pair is the one that matters: the app and the script must
  agree on the string or they stop excluding each other, and nothing fails loudly when they don't.
- **#5 — password hash method.** Dev cluster is SCRAM; renames preserve SCRAM hashes. The script
  still re-assigns unconditionally. **Prod cluster not yet confirmed** — see §8.
- **#6 — goals tables referenced outside their module.** Yes: `packages/settings/src/data-export-queries.ts`.
  That file and the rename migration must land in the same commit.
- **#8 — backup archive naming.** `scripts/backup-full.sh` writes `jarv1s-$TIMESTAMP.tar.gz` (`:101`)
  **and prunes by the same prefix** (`:30` `find -name 'jarv1s-*.tar.gz'`, `:44` `${fname#jarv1s-}`
  to parse the timestamp). Renaming the write side alone strands every existing archive from
  retention; renaming the read side alone prunes nothing. Either half-change fails silently and only
  shows up as a full disk weeks later. Rename both, and keep a `jarv1s-*` glob in the prune list so
  pre-cutover archives are still aged out.

### 1.4 Row counts — what is actually at risk

`app.jarvis_error_log` 1738 rows, `app.jarvis_action_audit_log` 96, `app.jarvis_goals` 0,
`app.jarvis_goal_evidence` 0 (dev). The goals pair is empty, so the risk concentrates entirely in the
two log tables and, far more, in the **roles and the database name** — those carry everything.

---

## 2. Design decisions

### 2.1 Seed the baseline ledger from the code path, never from a count

The issue says "the union of all 21 directories" and "20 non-empty module directories". I count 21
directories containing numbered SQL, of which 2 are external modules that use a **separate** ledger
(`app.module_schema_migrations`). So the shared-ledger set is 19 built-in + core = 20.

Rather than commit a number that is already disputed, **the baseline seed derives its file set by
calling the same code `scripts/migrate.ts:30-33` uses** — `getBuiltInSqlMigrationDirectories()` plus
the core directory, through `loadMigrationFiles`. The seed then asserts `ledger row count == file
count` before commit. A future module directory is picked up automatically and a mismatch aborts
rather than silently under-seeding.

### 2.2 The role rename stays out of band

Confirmed by citation, not assumed: one `pnpm db:migrate` opens ~25 sequential connections, 23 as
`urls.migration`. A rename committing on connection 3 orphans the run from connection 4 onward. The
rename ships as a standalone superuser script, run while the app is stopped.

### 2.3 Branch on `pg_roles`, never on `schema_migrations`

The ledger is per-database; roles are cluster-global. Every fresh gate database
(`run-gate.sh:145,172`) has an empty ledger and would read as "not yet renamed". Every
idempotence check in the rename script and the bootstrap file tests `pg_roles`.

### 2.4 Keep `CURRENT_USER` out of the frozen files

`sql-runner.ts:186` hardcodes `AUTHORIZATION jarvis_migration_owner`. Postgres resolves that role at
parse analysis, **before** `IF NOT EXISTS` can short-circuit, so it fails on every run once the role
is renamed. It changes to `CURRENT_USER`. This is TypeScript, not an applied migration — safe to edit.

---

## 3. Phases

Phase 1 ships alone and is evaluated before Phase 2 is scheduled (§6).

### Splitting on mergeability, not on subject

An earlier draft of this plan put every repo change in Phase 1 and called Phase 1 "merges safely".
That was wrong, and it would have taken prod down unattended. Since 2026-08-06 prod follows the
rolling `:edge` tag and auto-deploys on every merge to `main`, so **"merged" and "deployed to prod"
are the same event.** Two things in that draft are not inert:

- `ROLE_URL_SOURCES` naming `moss_*` while the cluster still holds `jarvis_*` — the app cannot
  authenticate at boot. Total outage, on merge, with nobody watching.
- Migration `0182` renaming tables that the shipped app still queries by their old names — migrate
  runs on deploy, so the rename lands and every read against those tables starts failing.

The split is therefore **by what an existing install can survive**, not by subject matter:

|                                                       | Merges to `main` when ready                                       | Lands only in the cutover window |
| ----------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| Baseline `0000_baseline.sql`                          | ✅ applies only to an empty ledger                                |                                  |
| `scripts/rename-roles.ts`                             | ✅ inert until invoked                                            |                                  |
| Allowlist guard + `.github/jarv-allowlist.txt`        | ✅ test-only                                                      |                                  |
| `sql-runner.ts:186` → `CURRENT_USER`                  | ✅ equivalent today — migrate already connects as the owning role |                                  |
| `smoke-compose.ts`, `backup-full.sh` read+write sides | ✅ neither runs on deploy                                         |                                  |
| Migration `0182` + every caller of a renamed table    |                                                                   | ❌ must be one atomic deploy     |
| `ROLE_URL_SOURCES` → `moss_*`                         |                                                                   | ❌ boot-time auth                |
| Env carve-out vars, image names, `/moss` URLs         |                                                                   | ❌ boot-time config              |

Phase 1b is built, reviewed and gate-green on its branch, and **merged as step 9 of the cutover
runbook**, not before. Its PR carries `DO NOT MERGE — lands in the #1444 cutover window` until then.

### Phase 1a — Baseline + scripts + guard. **Merges safely; inert on every existing install.**

**3.1 Allocate the migration version.** Re-derive the max immediately before writing the file.
Currently `0181`; expect `0182`. Use the same number in the baseline ledger seed.

**3.2 `infra/postgres/baseline/0000_baseline.sql`** — `pg_dump --schema-only` of a fully migrated
database already under Moss naming, generated from a box with **no external modules installed**.

Four constraints, each a review-caught defect:

1. **Exclude the `pgboss` schema.** pg-boss decides it is installed from the existence of
   `pgboss.version` but reads its version from that table's **rows**, which `--schema-only` omits. A
   baseline carrying an empty `pgboss.version` makes `migratePgBoss` (`scripts/migrate.ts:52`) skip
   both creation and migration. Dump `app` and the application schemas only.
2. **Seed the ledger in the same transaction as the baseline** (§2.1).
3. **Atomic, under the existing advisory lock.** Assert `ledger == file-set` before commit. Partial
   outcomes are unrecoverable in both directions.
4. **Do not restate pgvector** — `infra/postgres/bootstrap/0001_extensions.sql` creates it unhashed
   before migrations run.

Applied when `app.schema_migrations` is absent or empty; skipped entirely when non-empty.

**3.3 `scripts/rename-roles.ts`** (or `.sh`) — idempotent superuser script, no-op when already
renamed.

```
renameRoles(opts: { connectionString: string; direction: "forward" | "reverse"; dryRun?: boolean }): Promise<{ renamed: string[]; skipped: string[] }>
```

In **one transaction**: four `ALTER ROLE … RENAME TO`, then four password assignments. Renames only
the four runtime roles — the eight `jarvis_mod_*` roles are frozen (§2.3 of the spec) and must be
left alone; assert their count is unchanged before commit. The reverse direction renames **and**
re-assigns passwords together, or a rolled-back cluster has roles that cannot log in.

**3.4 `infra/postgres/migrations/0182_moss_rename.sql`** — per-database objects only. All 62 names
from §1.2(a), enumerated from the live catalogue, plus `CREATE OR REPLACE` for all three functions in
§1.2(b). Lands in the same commit as `packages/settings/src/data-export-queries.ts`.

**3.5 Repo changes** — `ROLE_URL_SOURCES`, `sql-runner.ts:186` → `CURRENT_USER`, the §3.1 compose/shell
env carve-out variables (from #1443's carve-out doc), `scripts/smoke-compose.ts` (all five hardcodes
in §1.2(d)), `scripts/backup-full.sh` both write and prune sides (§1.3 #8), image names, 187 URL
references.

**3.6 The frozen allowlist** — `.github/jarv-allowlist.txt`, one path-or-pattern per line, and a
check script that fails when `git grep -Ii jarv` returns anything outside it. Baseline today: **1847
files, 15297 lines** (docs 1118 files, tests 291, packages 273). Seed the allowlist from the frozen
set in spec §8, then drive the residue down; do not seed it from the current state, or it asserts
nothing.

**3.7 Tests.** Stated as behaviour + why they fail against a broken implementation:

- Baseline applies to an empty ledger and the resulting schema matches a fully migrated database
  object-for-object. _Fails if the dump is stale or a directory was missed._
- Baseline is skipped when the ledger is non-empty. _Fails if an existing install would re-run DDL._
- Ledger seed count equals the file-set count. _Fails if a module directory is unseeded — the defect
  that would replay 19 directories against an existing schema._
- `pgboss` schema is absent from the baseline. _Fails if `migratePgBoss` would skip creation._
- `renameRoles` is a no-op on an already-renamed cluster. _Fails if re-running the runbook breaks it._
- `renameRoles` leaves the eight `jarvis_mod_*` roles untouched. _Fails if the pattern is too greedy —
  which would silently uninstall every external module's grants._
- Reverse rename restores logins. _Fails if passwords are not re-assigned with the rename._
- Every `pg_proc.prosrc` in `app` is free of `jarv` after the migration. _Fails on
  `record_anonymous_error`, the §1.2(b) trap._
- The allowlist check fails on a newly introduced unfrozen occurrence. _Fails if the guard has no teeth._

**3.8 e2e for Phase 1** — provision a **fresh** database from the baseline on a **test cluster with
the roles already renamed**, then run the full gate against it. This is the path the baseline exists
to protect and the one most likely to be skipped.

### Phase 2 — Dev rehearsal

The full runbook (§4) executed against the live dev instance, timed. Produces the actual window
length rather than an estimate. Any step that needs a fix is fixed and Phase 2 is repeated from a
restored snapshot, not patched forward.

### Phase 3 — Production cutover

§4, in the scheduled window.

---

## 4. Cutover runbook — steps 4–8 are superuser psql, not application processes

0. **Take prod off the rolling tag before anything else.** Prod follows `:edge` with Watchtower
   unscoped, so merging Phase 1b to `main` builds an image that Watchtower deploys **on its next
   poll** — mid-cutover, or before it starts. Pin `JARVIS_IMAGE_TAG` to the current known-good
   digest and confirm Watchtower is stopped, _then_ merge Phase 1b and let CI build. Step 9 pulls
   that build explicitly by tag. Restore `:edge` only after step 12 passes.

   Verify the pin took: the running container's image digest must match the pinned one, not
   `:edge`. This is also the rollback anchor — that digest is the image you go back to.

1. Announce the fleet quiet window. Confirm no gate, UAT provision or dev session in flight —
   roles are cluster-global, so this lands on dev, any UAT container and every `jarvis_gate_*`
   database simultaneously.
2. **Confirm the prod cluster's hash method** — `SHOW password_encryption` and `pg_authid.rolpassword`
   for the four roles. Read-only. If MD5, the rename script's unconditional password re-assignment is
   load-bearing rather than insurance.
3. **Stage the new env file and role passwords**, validated, not installed. Never edited mid-window.
4. **Dedicated ownership- and ACL-preserving backup**, restored into a scratch database and verified
   — table and function owners, RLS enabled flags, grants, role memberships. Not merely exit zero.
   The nightly backup does **not** qualify (§5).
5. Stop application containers. Postgres stays up. Confirm zero connections to `jarv1s`.
6. Run `rename-roles` forward. Four renames + four passwords, one transaction.
7. `ALTER DATABASE jarv1s RENAME TO moss` — cannot run from a connection to that database.
8. Install the staged env file: `MOSS_*`, `moss_*` usernames, `/moss` in every URL, new image names,
   the #1443 carve-out variables. Confirm `POSTGRES_DB`, the healthcheck, and any `psql -d` name
   read `moss`.
9. `docker compose pull --policy always`, then migrate — now entirely as `moss_migration_owner`.
   Each migration and grants file is individually transactional (`sql-runner.ts:70,124`), so a failure
   here is resumable after fixing the cause.
10. Start containers. Verify sign-in, chat, one worker job, and one RLS-protected read per renamed
    table.
11. Confirm Watchtower reports the renamed containers as monitored. It watches images **by name**;
    a rename is exactly the change that silently strips a container from its watch list, and it
    updated nothing for months before the 2026-08-05 AppArmor fix.
12. Confirm one installed external module still enables, holds its credentials, and answers a tool
    call — the frozen `jarvis_mod_*` roles and module IDs are what make that pass.

**Deploy note.** Production is on the rolling `:edge` tag with Watchtower unscoped, so every merge to
`main` auto-deploys unattended. Phase 1 is safe under that (inert on an existing install). Phase 3 is
not a merge — it is a manual runbook, and Ben deploys via Portainer, never CLI `docker compose up` on
the prod stack.

---

## 5. Rollback is restore-based

**The nightly backup is not a valid rollback source.** `scripts/backup-full.sh:87` dumps
`-Fc --no-owner --no-privileges`, so restoring as `postgres` re-owns every object — including the
three `SECURITY DEFINER` functions in §1.2(b) — to the restoring superuser and drops all ACLs. That
restore **exits zero while producing a materially different, privilege-escalating database.** Hence
the dedicated step-4 backup, restored `--single-transaction --exit-on-error`.

To roll back: stop containers, restore the step-4 backup into a database named `jarv1s`, run
`rename-roles` reverse (renames **and** passwords together), restore the previous env file and image
tag, start.

Clean only before step 10 completes. After users write, prefer forward fixes.

---

## 6. Kill gate — after Phase 1, before Phase 2 is scheduled

**Owner: Ben.**

The observation that ends the line: **a fresh database provisioned from the baseline on a
role-renamed cluster does not pass the full gate**, or the baseline cannot be generated without
external-module contamination.

If either holds, the baseline approach is wrong and the alternative — freezing the roles under their
current names forever and renaming only the database and tables — must be reconsidered before any
more work lands. That alternative is strictly cheaper and loses only cosmetic consistency in
`psql \du`; it is a real option, not a strawman.

---

## 7. Verification — expected exit codes, never piped

```bash
pnpm verify:foundation > /tmp/vf-1444.log 2>&1; echo "EXIT=$?"     # expect EXIT=0
pnpm test:e2e            > /tmp/e2e-1444.log 2>&1; echo "EXIT=$?"  # expect EXIT=0 (CI-only step)
node scripts/check-jarv-allowlist.ts; echo "EXIT=$?"               # expect EXIT=0
git diff -U0 origin/main...HEAD -- '*.sql'                         # expect: only 0182 + baseline
```

Run the gate through the `verify-gate` skill with a fresh gate database. Never unscoped — an
unscoped run hits the live dev database. Never piped — a pipeline returns the filter's exit code, so
red reads as green. A green local gate excludes CI's e2e step; say which one you verified.

The SQL diff check is not optional: a repo-wide sweep silently edited four applied migrations on
#1442, comment-only, which would have aborted migrate on every existing install. Note that
`git diff | grep '^[-+][^-+]'` **misses SQL entirely** — SQL comments start with `--`, so a changed
comment renders as `+--` and the pattern excludes it.

---

## 8. Open questions — owner named, not absorbed into steps

1. **Prod cluster hash method** — unverified; prod is off-limits from this session. Read-only check
   at runbook step 2. _Owner: whoever runs the cutover._
2. **`jarv1s-prod` compose project name and the systemd units** — frozen here per spec §4.8. Renaming
   them needs stop/disable/install/`daemon-reload`/enable/remove-old plus a checkout-directory
   migration. _Separate follow-up issue. Owner: Ben._
3. **`~/Jarv1s` checkout path** — frozen; embedded in three systemd units as `WorkingDirectory` and in
   every `ExecStart`. _Same follow-up._
4. **Deferred renames**, each needing a dual-read plus a data migration or restage: module IDs,
   `jarvis.module.json`, `compatibility.jarv1s`, `mcp__jarvis__`, `jarvis_mod_*` roles, the five
   advisory-lock strings, `actor_kind='jarvis'`, `jarvis-emotion-v1` (live in
   `app.wellness_checkins.wheel_version` as a column default). _Separate issues under #1440._
5. **Tier C shim removal** — the `JARVIS_*` fallbacks in `packages/db/src/env.ts`. Fold into this PR's
   follow-up rather than waiting an arbitrary release.

---

## 9. Rulings ledger

Facts established here, with evidence, so nobody re-derives them:

| #   | Ruling                                                                                           | Evidence                                                                     |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| R1  | 62 named database objects need renaming, not ~29                                                 | live `pg_indexes`/`pg_constraint`/`pg_policies`/`pg_trigger`/`pg_proc`       |
| R2  | `record_anonymous_error` breaks at call time after the table rename; its name contains no `jarv` | `pg_proc.prosrc`, `packages/ai/src/repository.ts:2040`                       |
| R3  | Eight volumes + one network are frozen, not three                                                | `infra/docker-compose.prod.yml` volumes block                                |
| R4  | Backup prune matches `jarv1s-*` — renaming one side fails silently                               | `scripts/backup-full.sh:30,44,101`                                           |
| R5  | Dev cluster is SCRAM; rename preserves the hashes                                                | `SHOW password_encryption`, `pg_authid`                                      |
| R6  | Goals tables are referenced outside their module                                                 | `packages/settings/src/data-export-queries.ts`                               |
| R7  | `jarv1s:last-active-admin` has two call sites that must agree                                    | `packages/settings/src/repository.ts:860`, `scripts/delete-user-data.ts:168` |
| R8  | Seed the ledger from `getBuiltInSqlMigrationDirectories()`, not a literal count                  | `scripts/migrate.ts:30-33`; the 20-vs-21 dispute is unresolvable by hand     |
