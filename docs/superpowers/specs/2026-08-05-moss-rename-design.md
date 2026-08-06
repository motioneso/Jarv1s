# Product rename: Jarvis / Jarv1s → Moss

**Status:** Design — approved for planning
**Date:** 2026-08-05
**Revision:** v3 — two adversarial review passes applied; tier D redesigned (§4.3, §4.4), frozen
identifier set expanded (§2.3), rollback rewritten (§7.2)
**Grounded on:** `main` at `cf162dada`
**Epic:** #1440 — tasks #1441 (PR1), #1442 (PR2), #1443 (PR3), #1444 (PR4)

## Decision

The product is renamed from Jarvis / Jarv1s to **Moss**, across user-visible copy, code
identifiers, environment variables, database identifiers, and external publishing identity. Dated
historical documents keep their original wording.

The rename is delivered as four sequenced PRs. Three carry no infrastructure risk. The fourth
renames live database objects and requires a maintenance window.

A recurring theme runs through this document, and both review passes turned on it: **an identifier
that is persisted in the database, embedded in an external artifact, or installed on the host is not
a string this rename may sweep.** §2.3 enumerates that frozen set. Treat any addition to it as a
finding, not a detail.

## Scope at a glance

Measured on `cf162dada`: 22,597 case-insensitive `jarv` occurrences across 2,225 tracked files.

| Tier | What                                                                   | Volume                        | Lands in |
| ---- | ---------------------------------------------------------------------- | ----------------------------- | -------- |
| A    | User-visible strings                                                   | 15 files under `apps/web`     | PR1      |
| B    | Code identifiers; `@jarv1s/*` → `@moss/*`                              | 6,035 scope refs, 38 packages | PR2      |
| C    | 197 distinct `JARVIS_*` environment variables                          | repo-wide + prod host file    | PR3      |
| D    | 4 cluster roles, database `jarv1s`, 4 `app.jarvis_*` tables + ~25 deps | 18 frozen migrations          | PR4      |
| E    | GitHub repo, three ghcr images                                         | 187 + 77 refs                 | PR4      |
| F    | Living documentation only                                              | see §6                        | PR1      |

Root package `jarv1s` → `moss`; version bumps `0.1.16` → **0.2.0**.

## 1. The naming model

Two distinct names exist, and a find-and-replace would wrongly fuse them.

**Product name — the literal `Moss`.** The application itself. Page title
(`apps/web/index.html:9`), `Loading Moss` (`apps/web/src/app.tsx:428`), the auth-screen eyebrow
(`apps/web/src/auth/auth-screen.tsx:46`), README, repository, images, documentation.

**Assistant name — a user setting.** `persona.assistantName`, configurable in Settings → AI
persona, **defaulting to `Moss`**. Every surface addressing the assistant reads it at runtime:
`Message {name}…`, `{name} is holding this`, `Chat with {name}`.

Consequently every occurrence is **classified, never swept**. A string naming the application
becomes the literal; a string naming the assistant becomes a read of the setting.

### 1.1 The seam already exists and is barely adopted

`apps/web/src/api/use-assistant-name.ts` already resolves the configured name, falling back to
`"Jarvis"`. Its own comment records that it was built in anticipation of this rename. The
server-side default is `packages/shared/src/persona-api.ts:43,47`.

**Exactly one file consumes the hook** — `today/evening-mode.tsx:14,211`. Meanwhile **15 files
under `apps/web/src` hardcode a `"Jarvis` literal, 25 occurrences in total**, among them
`chat/assistant-surface/surface.tsx`, `chat/chat-drawer.tsx`, `calendar/calendar-page.tsx` and
`calendar/calendar-peek.tsx`.

PR1 changes the two default literals to `Moss` **and** converts every hardcoded assistant-name
site to consume the hook. Without the second half, a user who sets a custom name still sees
`Jarvis` across chat and calendar. Each of the 25 occurrences is classified individually: some are
the product name and become the `Moss` literal.

### 1.2 A latent bug this fixes

`packages/chat/src/live/runtime.ts:59-63` defines `DEFAULT_JARVIS_PERSONA` with **four** hardcoded
references, and the rename's own classification rule applies inside them:

- line 60, `"You are Jarvis, {{userName}}'s personal assistant."` — **assistant identity**; removed,
  because the name must come from the setting;
- lines 62–63, `"Treat Jarvis app structure…"` and `"Before answering about the Jarvis app…"` —
  **product name**; these become the `Moss` literal and stay.

Independently, `packages/shared/src/persona-api.ts:67` builds a persona block reading
`Your name is ${assistantName}.` Line 518 of `runtime.ts` concatenates both into one prompt.

A user who sets the assistant name to `Alfred` therefore sends the model two contradictory identity
instructions in the same context. PR1 makes the default persona name-neutral, deriving the name
solely from the configured setting, and renames the constant to `DEFAULT_MOSS_PERSONA`.

**Acceptance:** a test asserts the composed system prompt contains the configured name exactly
once and contains no hardcoded assistant name, while still naming the `Moss` product.

## 2. Tier B — code identifiers

Mechanical and fully compiler-verified: `@jarv1s/*` → `@moss/*` across 38 private workspace
packages, plus `JarvisDatabase`, `JarvisError`, `JarvisModuleManifest`, `JsonJarvisModuleManifest`,
`JarvisActionPermissionTier`, `JarvisAuthRuntime`, `createJarvisAuthRuntime`,
`getJarvisDatabaseUrls`, `bootstrapFirstJarvisUser`, `isJarvisBlock` and similar.

All 38 packages are `private: true` and nothing publishes to npm, so the scope rename requires no
registration and has no external consumer. External module packages carry **zero** `@jarv1s/*`
dependencies — verified — so no installed module breaks on the scope rename.

### 2.1 Literals deferred to PR4

Any identifier naming a **live database object** must not move ahead of the database:

| Site                                               | What                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/db/src/role-bootstrap.ts:28-31`          | the four role-name literals in `ROLE_URL_SOURCES`                 |
| `packages/db/src/migrations/sql-runner.ts:186`     | `CREATE SCHEMA … AUTHORIZATION jarvis_migration_owner`            |
| `packages/db/src/urls.ts:30-39`                    | dev-default URLs embedding all four usernames + `/jarv1s`         |
| `packages/db/src/module-role-broker.ts:75`         | `GRANT … TO jarvis_app_runtime, jarvis_worker_runtime`            |
| `packages/db/src/types.ts:1119-1120`               | Kysely keys `app.jarvis_action_audit_log`, `app.jarvis_error_log` |
| `infra/postgres/grants/0001-0003_pgboss_*.sql`     | role grants, re-executed unhashed on every migrate                |
| `infra/postgres/bootstrap/0000_roles.sql`          | role creation — see §4.3                                          |
| `scripts/setup-prod.ts:86-89`                      | role names                                                        |
| `scripts/smoke-compose.ts:134-137`                 | role names and database `jarv1s`                                  |
| `scripts/audit-release-hardening.ts:13-16,295-386` | `has_table_privilege('jarvis_app_runtime', …)`                    |

`sql-runner.ts:186` is the sharpest of these. Postgres resolves the `AUTHORIZATION` role during
parse analysis, **before** `IF NOT EXISTS` can short-circuit, so once the role is renamed this line
fails on every single migrate run. PR4 replaces the hardcoded name with `CURRENT_USER`: the
connection's own identity is by definition the migration owner, which is correct under either
naming and removes the literal permanently.

### 2.2 Also in PR2

`virtual:jarvis-module-web` (`apps/web/src/app.tsx:56`), the `jarvis-module-css-` style-element
prefix (line 397), and the `jarvis.cal.*` localStorage keys (`calendar-page.tsx:35-41`).

**localStorage keys carry a migration cost.** Renaming `jarvis.cal.view` to `moss.cal.view` silently
discards each existing user's saved calendar view, cursor and work-week preference. PR2 reads the
old key when the new one is absent, writes the new key, and deletes the old.

### 2.3 Frozen identifiers — persisted, external, or installed

None of these is cosmetic. Each is matched by state this rename does not control, so **all of them
stay unchanged**, and the plan must not treat any as in scope. Renaming them is separate, later work
requiring a dual-read plus a data migration or a restage.

**Persisted in the database:**

- Built-in module IDs `jarvis.goals` (`packages/goals/src/manifest.ts:11`) and `jarvis.commitments`
  (`packages/commitments/src/manifest.ts:11`). These key durable rows in `app.module_enablement`,
  `app.module_credentials` and `app.module_kv`
  (`packages/settings/sql/0065`, `0153`, `0154`). Renaming them orphans every user's enablement,
  credentials, KV state and notification bindings.
- `wheel_version` default `'jarvis-emotion-v1'`
  (`packages/wellness/sql/0088_wellness_emotion_taxonomy.sql:21`) — a stored taxonomy-version token
  already written into user rows.
- `actor_kind` value `'jarvis'`, pinned by a `CHECK` constraint
  (`packages/tasks/sql/0039_tasks_foundation.sql:176`). Changing it needs a constraint change plus a
  data migration, which §4.1 does not carry.
- `jarvis_mod_`, the module queue-name prefix, persisted in pg-boss. Renaming it orphans queued jobs.

**External artifact contract:**

- The manifest filename `jarvis.module.json` (`packages/module-registry/src/node.ts:80`) and the
  compatibility key `compatibility.jarv1s` (`packages/module-sdk/src/index.ts:363`,
  `packages/module-registry/src/external/validate.ts`). Every published external module ships these;
  renaming either invalidates all of them at once.

**Wire format the model and the permission hook match on:**

- `mcp__jarvis__`, the MCP tool-name prefix, live in `packages/ai/src/gateway/gateway.ts`,
  `packages/chat/src/live/claude-permission-hook.ts`, `claude-print-chat-engine.ts`,
  `cli-launch-commands.ts`, `packages/chat/src/routes.ts`, `scripts/smoke-chat.mjs` and three unit
  tests. Installed module manifests already carry tool names built from it; renaming without
  restaging every module silently denies tool calls.

**Cross-version coordination:**

- Every advisory-lock string, including `'jarv1s:migrations'`
  (`packages/db/src/migrations/sql-runner.ts:199,203`) and `'jarv1s:module-reconcile'`
  (`scripts/module-reconcile.ts:122`). Renaming one lets an old and a new binary both believe they
  hold it during a mixed-version window. The plan enumerates the full set — including
  `pg_advisory_xact_lock` call sites, which a grep for `advisory_lock` misses — and freezes all of
  them until no pre-rename image can run.

**Infrastructure identity** — docker volume names and the compose project name; see §5.

## 3. Tier C — environment variables

197 distinct `JARVIS_*` names become `MOSS_*`, behind a **dual-read shim**: read `MOSS_X`, fall
back to `JARVIS_X`, and emit a one-time deprecation warning naming the variable when the fallback
is used.

The shim is load-bearing, not a nicety. Production reads `infra/env.production.local`
(`infra/docker-compose.prod.yml:23,88`) — untracked, `.gitignore:17`, resident on the production
host and absent from the image. A Moss image demanding `MOSS_APP_DATABASE_URL` against an unchanged
host file would boot with no database URL and die; and once that file were hand-edited, rolling back
to the previous image would fail in the same way. With the shim, PR3 ships and production continues
to boot untouched.

### 3.1 The shim does not cover every reader

The shim lives in TypeScript. Two classes of reader never load it:

- **Compose interpolation.** `infra/docker-compose.prod.yml` expands `${JARVIS_IMAGE_TAG:?…}`,
  `${JARVIS_ENV_FILE:-…}` and `${JARVIS_HOST_UID:-1000}` on the host before any process starts, and
  `:?` hard-fails the command. These names must change in the compose file and the host env file
  **together, in the same step**, or not at all.
- **Shell scripts.** Seven scripts read `JARVIS_*` directly from the environment.

PR3 therefore carries an explicit carve-out list: variables consumed only by TypeScript get the
shim; variables consumed by compose or shell are renamed atomically with the host file during the
PR4 cutover, and the plan names each one. Treating all 197 uniformly is the failure mode.

The TypeScript fallback is removed one release after the host file is updated.

## 4. Tier D — database rename

### 4.1 Objects

Four cluster roles: `jarvis_migration_owner`, `jarvis_app_runtime`, `jarvis_worker_runtime`,
`jarvis_auth_runtime`.

Database `jarv1s` → `moss`.

Four tables: `app.jarvis_action_audit_log`, `app.jarvis_error_log`, `app.jarvis_goals`,
`app.jarvis_goal_evidence`.

**Renaming a table renames none of its dependent objects.** Postgres leaves indexes, constraints,
policies and triggers under their original names, so the rename migration must name each explicitly
— approximately 25 further objects: ~5 indexes, 2 check constraints, ~12 RLS policies and 1 trigger.

The implementation plan must enumerate these **from the live catalogue** — `pg_indexes`,
`pg_policies`, `pg_constraint`, `pg_trigger` — rather than from grep, since grep sees only what the
repository declares.

It must additionally scan **`pg_proc.prosrc`** for `jarvis` and `jarv1s`. Eighteen applied migration
files define `SECURITY DEFINER` and plpgsql functions; a function body referencing a renamed table
or role by literal name, or building dynamic SQL from one, is invisible to every catalogue view
above and breaks only at call time.

Nothing in §2.3 is renamed here.

### 4.2 Why a new migration and not an edit

Editing an applied migration is a hard invariant (CLAUDE.md), enforced by the runner: each file's
sha256 is stored in `schema_migrations` and compared on every run
(`packages/db/src/migrations/sql-runner.ts:52-79,173,192`). An edit breaks every existing install.

**140 `jarvis_` references across 18 applied migration files are therefore frozen forever.** They
grant privileges and define policies against the roles _by name_. This is why the roles must be
**renamed in place** — `ALTER ROLE … RENAME` preserves the role OID, so every grant and policy those
frozen files created continues to resolve. Dropping and recreating would silently void all 140.

**The rename migration takes the next free global version, which is at least `0182`.** Versions are
globally unique across all migration directories and `assertUniqueMigrationVersions`
(`sql-runner.ts:145`) aborts the run before any migration executes if two collide. `0177` is already
taken by `packages/ai/sql/0177_audit_outcome_widen.sql` and the tree currently reaches `0181`. The
plan allocates the number immediately before implementation and uses the same value in the baseline
ledger seed.

### 4.3 The fresh-database problem, and the baseline that resolves it

The ledger is per-database; roles are cluster-global. `scripts/run-gate.sh:172` creates each gate
database with `psql -U postgres -c "CREATE DATABASE $gatedb"` **on the shared cluster**, and
`scripts/test-integration.ts:61` does the same. Every such database starts with an empty ledger.

Any "has this been renamed?" check keyed on the ledger is therefore wrong-scoped: each fresh gate
database would read as un-renamed, resurrect empty `jarvis_*` roles cluster-wide, and leave grants
pointing at them while the application connects as `moss_*` — permission denied on everything, from
the next gate run onward. Bootstrap must branch on **cluster state** (`pg_roles` contains
`moss_migration_owner`), never on `schema_migrations`.

That alone is not enough: on a renamed cluster a fresh database still replays 0001–0181, which
`GRANT … TO jarvis_app_runtime` against roles that no longer exist, and recreating them collides
with the renamed roles already holding those OIDs.

**Resolution — a schema baseline.** PR4 adds `infra/postgres/baseline/0000_baseline.sql`, a
`pg_dump --schema-only` of a fully migrated database with every identifier already under Moss
naming. When `app.schema_migrations` is absent or empty, the runner applies the baseline and seeds
the ledger; when it is non-empty, the baseline is skipped entirely and normal migration proceeds.

Four constraints make this correct, and each was a defect in an earlier draft:

1. **Exclude the `pgboss` schema from the dump.** pg-boss decides it is installed merely because
   `pgboss.version` exists, and reads its installed version from that table's _rows_ — which
   `--schema-only` does not carry. A baseline containing an empty `pgboss.version` makes
   `migratePgBoss` (`scripts/migrate.ts:52`) skip both creation and migration, leaving pg-boss
   tables with no version handshake and no queue rows. Dump `app` and the application schemas only,
   and let `migratePgBoss` install pg-boss normally.
2. **Seed the ledger with the union of every migration directory, in one transaction with the
   baseline.** All directories share `app.schema_migrations` (`sql-runner.ts:37-38`, and
   `scripts/migrate.ts` passes no override), and there are **21 of them**: the core directory plus
   **20 non-empty module directories** from `getBuiltInSqlMigrationDirectories`. `scripts/migrate.ts:30-33`
   already computes exactly this union as `allMigrationFiles`. Seeding only the core directory makes
   all 20 module directories replay their SQL against a schema that already has their objects.
   Checksums come from `loadMigrationFiles`, which hashes the exact file bytes, so the hash guard
   stays consistent.
3. **Baseline plus seed is atomic, under the existing advisory lock.** A partial outcome is
   unrecoverable in both directions: baseline-without-seed makes a retry re-apply non-idempotent
   dump DDL, and partial-seed makes a retry skip the baseline and replay unseeded migrations against
   objects that already exist. One transaction, rolled back entirely on any error, with a
   ledger-equals-file-set assertion before commit.
4. **Generate the baseline from a database with no external modules installed.** Installed modules
   keep their own ledger, `app.module_schema_migrations`, keyed by `module_id`
   (`packages/db/src/migrations/module-sql-runner.ts:172,192`), and are unaffected by this change —
   but a dump taken from a box with finance or job-search installed would bake one install's modules
   into every fresh database.

Extensions are unaffected: `infra/postgres/bootstrap/0001_extensions.sql` creates pgvector unhashed
before migrations run, so the baseline must not restate it. Sequence _definitions_ are carried by
`--schema-only` while their values are not, which is correct — a fresh database wants fresh
sequences.

This permanently severs fresh installs from the frozen `jarvis_*` migrations and drops fresh-database
provisioning from 181 files to one. It is the single largest piece of work in PR4 and the plan must
scope it as such.

Bootstrap (`infra/postgres/bootstrap/0000_roles.sql`) is **not** hash-guarded — the runner
re-executes every bootstrap and grants file on every call (`sql-runner.ts:102-106`). Under the
baseline design it manages `moss_*` roles unconditionally and never resurrects the old ones.

### 4.4 The role rename is out-of-band, not a migration

**A role rename cannot live inside a migration.** One `pnpm db:migrate` opens roughly **25
sequential connections**: bootstrap and `applyRolePasswords` as superuser, then the core migration
directory, then **20 module migration directories**, then pg-boss, then grants — **23 of them as
`urls.migration`**, each a fresh `new Client(...)` opened and closed in turn
(`sql-runner.ts:39,45,94` and `:115,120,137`).

A migration that renames `jarvis_migration_owner` commits inside connection 3. Connection 4 then
authenticates as a role that no longer exists, and the run dies with 20 module directories, pg-boss
and grants unapplied — half-migrated, mid-rename. No re-ordering of `applyRolePasswords` repairs a
credential that changed _between_ two connections of the same run.

The role rename is therefore a **superuser step executed out-of-band**, while the application is
stopped and no migrate run is in flight. It ships as a dedicated, idempotent script — a no-op when
the roles are already renamed — and it performs, **in one transaction**, all four
`ALTER ROLE … RENAME TO` followed by all four password assignments (§4.5). Splitting the rename from
the password reset across two runbook steps is a defect: it leaves MD5-backed roles unable to
authenticate for the length of a manual edit.

The rename migration that remains touches **only per-database objects**: the four tables and their
~25 dependents. Those are safe inside one connection and one transaction.

### 4.5 Role passwords

`ALTER ROLE … RENAME TO` clears MD5 password hashes, which are salted with the role name;
SCRAM-SHA-256 hashes survive. The cluster's hash method must not be assumed, so the rename script
re-assigns all four passwords unconditionally in the same transaction.

The passwords are **staged and validated before downtime begins**, not read from a file edited
mid-window. Note that `buildRolePasswordPlan` takes only `URL.password` from each connection URL
(`packages/db/src/role-bootstrap.ts:50-55`); the role _names_ come from the hardcoded
`ROLE_URL_SOURCES` table at `:24-31`, which PR4 updates as part of §2.1. An earlier draft claimed the
plan derives role names from the URLs — it does not.

The reverse script used for rollback must likewise rename and re-assign passwords together, or a
rolled-back cluster is left with MD5 roles that cannot log in.

### 4.6 Database rename

`ALTER DATABASE jarv1s RENAME TO moss` cannot execute from a connection to that database and
requires no other connections to it. It is a runbook step, not a migration, executed as superuser
alongside §4.4.

### 4.7 Cluster-global blast radius

Postgres roles are cluster-global. The rename lands simultaneously on the development instance, any
running UAT container, and every agent gate database on the box. PR4 requires a **fleet quiet
window**, not merely a production maintenance window: no gate run, UAT provision or dev session may
be in flight.

### 4.8 Installed host identity

Renaming files in the repository does not touch what is installed on the host.
`infra/systemd/jarv1s-stack.service`, `jarv1s-backup.service` and `jarv1s-backup.timer` are already
copied into `/etc/systemd/system` with enabled symlinks, and they embed `~/Jarv1s` as
`WorkingDirectory` and in every `ExecStart` path.

**Unit names and the `~/Jarv1s` checkout path stay frozen.** Renaming the templates without a
matching host procedure either breaks the units or leaves both an old and a new backup timer
enabled, silently double-running backups. Renaming them properly requires stop, disable, install,
`daemon-reload`, enable, remove-old, plus a checkout-directory migration — separate work, out of
scope here, and called out in §10.

## 5. Tier E — external identity

- Repository `motioneso/Jarv1s` → `motioneso/Moss`. GitHub serves a permanent redirect, so existing
  clones and links keep working; local remotes are updated regardless. 187 in-repo URL references
  are rewritten.
- Images `ghcr.io/motioneso/jarv1s{,-api,-web}` → `…/moss{,-api,-web}`, published fresh at 0.2.0.
  Production compose and Watchtower configuration move to the new names in the same cutover. Old
  tags remain pullable for rollback.

**Docker volume names stay frozen.** `infra/docker-compose.prod.yml:207-210` declares
`jarv1s-postgres-data`, `jarv1s-vault-data` and `jarv1s-model-cache`. Renaming a volume in compose
does not move it — `docker compose up` creates a new, empty one, and the database and vault would
appear wiped. These names, and the `jarv1s-prod` compose project name, are internal and remain
unchanged.

**Watchtower must be re-verified after the image rename.** It updated nothing for months until the
2026-08-05 AppArmor fix, and it watches images by name; a rename is exactly the change that can
silently strip a container from its watch list. Confirm post-cutover that Watchtower reports the
renamed containers as monitored.

## 6. Tier F — documentation

**Rewritten** — documents describing the system as it now is: `README`, `CLAUDE.md`,
`docs/DEVELOPMENT_STANDARDS.md`, `docs/brand/*`, deployment and operations runbooks, `.github`
templates and workflow files.

**Left verbatim** — dated records of past decisions: `docs/superpowers/plans` (264 files),
`docs/superpowers/specs` (214), `docs/coordination` (115), `docs/audits` (56), `docs/releases`.
A dated note at the head of `docs/superpowers/` records the rename, its date, and that earlier
documents use the former name throughout.

This specification is itself the exception: written under the old name's repository, it is the
record of the change and keeps both names deliberately.

## 7. Delivery

Four PRs. Land the two open PRs — #1437, #1379 — before PR2, whose diff would otherwise conflict
with both.

Each PR must be committed through the `shared-checkout` skill: this working tree is shared with
other agent sessions, and no tree-wide `git add` is safe here.

**PR1 (#1441) — display and documentation.** Assistant-name threading (§1.1), the persona fix
(§1.2), product-name literals, living docs, root package name and version. No infrastructure risk.

**PR2 (#1442) — code identifiers.** `@jarv1s/*` → `@moss/*` and symbol renames, excluding
everything in §2.1 and §2.3. Largest diff; entirely compiler-checked.

**PR3 (#1443) — environment variables.** `MOSS_*` with the dual-read shim, minus the compose and
shell carve-out of §3.1. Ships without touching production.

**PR4 (#1444) — database, images, repository.** The schema baseline (§4.3), the out-of-band
role-rename script (§4.4), the rename migration at the next free version (§4.2), the deferred
literals from §2.1, the §3.1 carve-out variables, image and repository rename, and the cutover
runbook. Merged inside the quiet window.

### 7.1 Cutover order for PR4

Steps 3–8 are executed by an operator at a superuser psql session on the production host, not by any
application process.

1. Announce the fleet quiet window; confirm no gate, UAT or dev session is in flight.
2. **Stage the new env file and the new role passwords before downtime begins**, validated but not
   yet installed. Nothing in the window should require hand-editing a file under time pressure.
3. Take a dedicated cutover backup **preserving ownership and ACLs** (§7.2), and verify it restores
   into a scratch database — checking representative table and function owners, RLS, grants and role
   memberships, not merely that restore exits zero.
4. Stop application containers, leaving Postgres running. Confirm zero remaining connections to
   `jarv1s`.
5. Run the rename script: four `ALTER ROLE … RENAME TO` plus four password assignments, one
   transaction (§4.4).
6. `ALTER DATABASE jarv1s RENAME TO moss`.
7. Install the staged env file: `MOSS_*` names, `moss_*` usernames, `/moss` database in every
   connection URL, new image names, and the §3.1 compose variables. Confirm the Postgres service's
   own `POSTGRES_DB`, healthcheck and any `psql -d` references name `moss`.
8. `docker compose pull --policy always`, then run migrations — now entirely as
   `moss_migration_owner`. Individual migration and grants files are each transactional
   (`sql-runner.ts:70,120`), so a failure here is resumable by re-running once the cause is fixed.
9. Start containers; verify sign-in, chat, and one worker job end to end.
10. Confirm Watchtower monitors the renamed containers.

### 7.2 Rollback

**Rollback is restore-based, not a reverse migration.** A reverse-rename migration cannot be relied
on: it would run through the same 23 `urls.migration` connections it is trying to repair, and a
failure at step 8 can leave the ledger, the roles and the objects in three different states.

**The routine nightly backup is not a valid rollback source.** `scripts/backup-full.sh:87` dumps with
`-Fc --no-owner --no-privileges`, so a restore performed as `postgres` re-owns every object —
including `SECURITY DEFINER` functions — to the restoring superuser and drops all ACLs. That restore
can exit zero while producing a database that is materially different and privilege-escalating. This
is why step 3 takes its own backup with ownership and ACLs preserved, restored with
`--single-transaction --exit-on-error`.

To roll back: stop containers, restore the step-3 backup into a database named `jarv1s`, run the
rename script in reverse — renaming the roles **and re-assigning their passwords together** (§4.5) —
restore the previous env file and image tag, and start.

Rollback is clean only before step 9 completes. After users have written to the renamed database,
prefer forward fixes; a restore then costs whatever was written since step 3.

## 8. Verification

Every PR passes `pnpm verify:foundation` through the `verify-gate` skill — never unscoped, since an
unscoped run targets the live development database, and never piped, since a piped run reads red as
green. A green local gate excludes CI's e2e step.

PR1 and PR4 additionally require live-path proof recorded on the PR, per
`docs/DEVELOPMENT_STANDARDS.md` → Live-Path Gate:

- **PR1** — on a live dev instance, set a custom assistant name in Settings and confirm it renders
  in chat, the chat drawer, calendar copy and briefings; confirm the product name reads `Moss`
  independently of it.
- **PR4** — full stop → rename → migrate → start on a live dev instance before production,
  including one worker job and one RLS-protected read per renamed table. Separately, prove a
  **fresh** database provisions from the baseline on the renamed cluster: run the gate end to end
  after cutover, since that is the path §4.3 exists to protect and the one most likely to be missed.
  Also confirm one installed external module still enables, holds its credentials, and answers a
  tool call — the §2.3 frozen set is what makes that pass.

**Completion check.** `git grep -Ii jarv` returns only the frozen set:

- dated documents under `plans/`, `specs/`, `coordination/`, `audits/`, `releases/`;
- the pre-rename migration files carrying frozen role references;
- everything enumerated in §2.3 — module IDs, `jarvis.module.json`, `compatibility.jarv1s`,
  `mcp__jarvis__`, `jarvis_mod_`, `jarvis-emotion-v1`, `actor_kind='jarvis'`, advisory-lock strings;
- the systemd unit names and `~/Jarv1s` paths (§4.8);
- the docker volume names and `jarv1s-prod` compose project name (§5);
- the `JARVIS_*` fallbacks in the environment shim, until removed a release later;
- this specification.

Any other hit is a defect. The check belongs in the plan as an explicit step, not as a closing
impression. Because the frozen set is large, the plan should express it as a committed allowlist
file that the check greps against, so a new unfrozen occurrence fails loudly.

## 9. Execution cost

Roughly 2,200 files. PR2 and PR3 are bulk-mechanical, verified by the compiler and the gate, and
suit a cheaper model — Sonnet 5 given the classification rules and the §2.3 frozen list explicitly.

PR1 and PR4 need Opus. PR1 requires per-string product-versus-assistant judgement, which is
precisely the distinction a mechanical pass destroys. PR4 is unrecoverable if wrong, and the
baseline in §4.3 is design work, not transcription.

## 10. Open items for the implementation plan

1. Create the `task` issue; no build starts without one.
2. Allocate the rename migration's version immediately before implementation — the next free global
   number, at least `0182` (§4.2).
3. Enumerate the ~25 dependent database objects from the live catalogue, plus the `pg_proc.prosrc`
   scan (§4.1).
4. Enumerate every advisory-lock string, including `pg_advisory_xact_lock` call sites (§2.3).
5. Determine the production cluster's password hash method, confirming §4.5 rather than assuming it.
6. Confirm whether `app.jarvis_goals` and `app.jarvis_goal_evidence` are referenced by literal name
   outside their owning module's SQL; neither appears in `packages/db/src/types.ts`.
7. Produce the §3.1 carve-out list: which of the 197 variables are read by compose or shell rather
   than TypeScript.
8. Decide the backup archive naming convention, which currently embeds `jarv1s`, and whether restore
   tooling matches on it.
9. Confirm no UAT or smoke tooling hardcodes database `jarv1s` beyond
   `scripts/smoke-compose.ts:134-137`.
10. Schedule the deferred renames as separate follow-up work, each needing a dual-read plus a data
    migration or restage: module IDs, the module manifest filename and compatibility key,
    `mcp__jarvis__`, `jarvis_mod_`, the advisory-lock strings, and the systemd/checkout-path
    migration (§2.3, §4.8).
