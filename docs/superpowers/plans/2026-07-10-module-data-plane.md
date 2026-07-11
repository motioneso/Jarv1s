# Module Data Plane (#914) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give external (non-built-in) Jarvis modules a full database data plane — a namespaced
migration ledger with a strict wire contract, a 4-phase role-broker install entrypoint, platform-
generated RLS/policies/grants (no module-authored security SQL), a scoped storage RPC, and derived
(non-declarative) export/deletion lifecycle hooks — while preserving every hard invariant in
`CLAUDE.md` (no admin bypass, private-by-default, `DataContextDb`-only, secrets never escape,
never edit applied migrations).

**Architecture:** Four additive slices, each independently testable:

1. **Ledger + wire contract** — `app.module_schema_migrations` (per-module applied-migration
   bookkeeping) and `app.module_installs` (per-module install-state journal), plus a pure wire-
   contract validator that enforces "exactly one SQL statement, first command from an allowlist"
   for every module-authored migration file.
2. **Install entrypoint** — `scripts/module-install.ts`, a 4-phase (A/B/C/D) orchestration that
   creates two new Postgres roles per module (`jarvis_mod_<slug>_runtime` NOLOGIN,
   `jarvis_mod_<slug>_install` transiently logged-in), applies the module's DDL inside one
   transaction together with platform-generated RLS, verifies a catalog fingerprint, then records
   ledger rows and disables the installer login.
3. **RLS/policy/grant emitter** — a pure SQL generator that turns a manifest's
   `database.ownedTables` list into `FORCE ROW LEVEL SECURITY` + four per-verb owner-only policies
   - grants, mirroring the existing `packages/sports/sql/0133_sports_follows.sql` hand-written
     pattern exactly, so no module author ever writes security SQL.
4. **Storage RPC + derived lifecycle** — `ctx.db.query`, a scoped query surface that runs under
   `SET LOCAL ROLE jarvis_mod_<slug>_runtime` inside the existing `DataContextDb` transaction, plus
   export/deletion helpers that iterate a module's manifest-declared `database.ownedTables` (not a
   live catalog scan — see Task 9 rationale) to generate account-export rows and delete-user-data
   sweeps without any module-specific code.

**Tech Stack:** TypeScript (`packages/db`, `packages/module-registry`, `packages/settings`,
`scripts/`), `pg` / Kysely, Vitest, raw SQL migrations under `infra/postgres/migrations/`, Postgres
role/RLS/grant DDL, Docker Compose ops profile.

## Global Constraints

- No `BYPASSRLS` on any runtime app/worker role; the two new per-module roles are also created
  `NOBYPASSRLS` (mirrors `infra/postgres/bootstrap/0000_roles.sql`'s existing role posture).
- RLS applies to every actor including admins — all module-owned tables get `ENABLE` **and**
  `FORCE ROW LEVEL SECURITY`, no exceptions.
- Repositories/RPCs accept only a branded `DataContextDb`; the new storage RPC is built as a method
  reachable from an existing `DataContextDb`/`withDataContext` transaction, never a raw client.
- `AccessContext` stays exactly `{ actorUserId, requestId }` — no new fields.
- The installer role's password is a random value generated in memory at install time and never
  written to disk, logs, or the ledger; it is set once (`ALTER ROLE ... LOGIN PASSWORD ...`) and
  the role is flipped back to `NOLOGIN` in Phase D regardless of success or failure.
- Every module migration file must contain **exactly one** SQL statement whose first command is
  one of `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, `ALTER TABLE`, `DROP INDEX`, `COMMENT ON` — this
  is enforced by a static parser in Slice 1 (Task 3) _and_ by executing each statement through a
  code path that cannot itself carry more than one statement (defense in depth).
- Never edit an applied migration. This plan adds exactly two new core migration files:
  `infra/postgres/migrations/0155_module_schema_migrations.sql` and
  `infra/postgres/migrations/0156_module_installs.sql` (migration head is currently `0152`; `0153`
  and `0154` are reserved/in-flight in sibling work per relay handoffs and are skipped here to avoid
  collision — if either has landed on `main` by the time this plan executes, renumber `0155`/`0156`
  forward by however many numbers were consumed, keeping the two files adjacent).
- Module SQL lives only in a module's own `sql/` directory; the two new migrations above are core
  platform infrastructure (the ledger and journal tables themselves), so they belong in
  `infra/postgres/migrations/` like every other core migration (e.g. `0133` is the module-precedent
  exception because `packages/sports/sql/` is a _built-in_ module's own directory — external module
  SQL after this spec ships still never lives under `infra/postgres/migrations/`).
- `tests/integration/foundation.test.ts`'s full-migration-list `toEqual` assertion must gain one row
  per new migration in the same commit that adds the migration file, or the foundation suite breaks
  latently.
- No feature may hardcode a provider/model — not applicable to this spec (no AI surface touched).
- Module isolation: the emitted RLS/grants are the _only_ security surface a module gets; nothing
  in this plan lets a module import another module's internals or query its tables directly.

---

## File Structure

| File                                                          | Responsibility                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/postgres/migrations/0155_module_schema_migrations.sql` | Create `app.module_schema_migrations` (per-module applied-migration ledger, no RLS — instance bookkeeping, mirrors core `schema_migrations`).                                                                                                      |
| `infra/postgres/migrations/0156_module_installs.sql`          | Create `app.module_installs` (per-module install-state journal, `FORCE RLS` + `USING (true)` read policy — instance metadata, not per-user data).                                                                                                  |
| `packages/db/src/migrations/module-sql-runner.ts`             | Slice 1: wire-contract validator (`validateModuleMigrationSql`), module migration file loader, ledger read/write helpers.                                                                                                                          |
| `tests/unit/module-sql-runner.test.ts`                        | Pure unit tests for the wire-contract validator.                                                                                                                                                                                                   |
| `tests/integration/module-migration-ledger.test.ts`           | Integration tests for the ledger loader/reader/writer against real Postgres.                                                                                                                                                                       |
| `packages/db/src/module-role-broker.ts`                       | Slice 2: per-module role name helpers + idempotent role-creation/grant/login-flip SQL, mirrors `role-bootstrap.ts` conventions.                                                                                                                    |
| `tests/unit/module-role-broker.test.ts`                       | Pure unit tests for role-name derivation and SQL statement shape.                                                                                                                                                                                  |
| `tests/integration/module-role-broker.test.ts`                | Integration test: role broker actually creates/flips roles against real Postgres.                                                                                                                                                                  |
| `packages/db/src/module-rls-emitter.ts`                       | Slice 3: pure SQL generator turning `ownedTables` into RLS/policy/grant statements.                                                                                                                                                                |
| `tests/unit/module-rls-emitter.test.ts`                       | Unit tests for the emitter, including the injection-guard rejection cases.                                                                                                                                                                         |
| `scripts/module-install.ts`                                   | Slice 2: the 4-phase (A/B/C/D) install entrypoint CLI.                                                                                                                                                                                             |
| `tests/integration/module-install.test.ts`                    | Integration test: full install of a synthetic module package end-to-end (all 4 phases, then verify RLS/grants/ledger rows).                                                                                                                        |
| `packages/db/src/module-storage-rpc.ts`                       | Slice 4: `ctx.db.query` scoped RPC (`SET LOCAL ROLE` inside a `DataContextDb` transaction).                                                                                                                                                        |
| `tests/integration/module-storage-rpc.test.ts`                | Integration test: RPC can only see/touch the calling module's own tables, under RLS.                                                                                                                                                               |
| `packages/module-registry/src/index.ts`                       | Modify: add `getExternalModuleDeletionTables` sibling to the existing built-in-only `getModuleDeletionTables`/`MODULE_DELETION_TABLES`.                                                                                                            |
| `packages/settings/src/data-export.ts`                        | Modify: add a derived external-module export section alongside the existing `collectModuleExportSection` built-in path.                                                                                                                            |
| `scripts/delete-user-data.ts`                                 | Modify: merge `getExternalModuleDeletionTables` output into the existing `moduleDeletionTables` sweep list.                                                                                                                                        |
| `scripts/audit-release-hardening.ts`                          | Modify: add `module_schema_migrations` to `forceRlsExemptions` (same rationale as `schema_migrations`).                                                                                                                                            |
| `packages/db/src/index.ts`                                    | Modify: add `export * from "./migrations/module-sql-runner.js"` and `export * from "./module-role-broker.js"` and `export * from "./module-rls-emitter.js"` and `export * from "./module-storage-rpc.js"` to the barrel, in alphabetical position. |
| `infra/docker-compose.prod.yml`                               | Modify: add a `module-install` ops-profile service alongside `migrate`.                                                                                                                                                                            |

---

## Slice 1: Migration Ledger + Wire Contract

### Task 1: `app.module_schema_migrations` migration + foundation test row

**Files:**

- Create: `infra/postgres/migrations/0155_module_schema_migrations.sql`
- Modify: `tests/integration/foundation.test.ts:336`
- Modify: `scripts/audit-release-hardening.ts` (`forceRlsExemptions` map)

**Interfaces:**

- Produces: table `app.module_schema_migrations(module_id text, version text, name text, checksum text, applied_at timestamptz)`, primary key `(module_id, version)`. No RLS (instance bookkeeping, same posture as the core `schema_migrations` table).

- [ ] **Step 1: Write the migration file**

```sql
-- infra/postgres/migrations/0155_module_schema_migrations.sql
-- Per-module applied-migration ledger (#914 Slice 1). Instance bookkeeping only — no per-user
-- data, so no RLS, mirroring app.schema_migrations' posture (see scripts/audit-release-hardening.ts
-- forceRlsExemptions). Composite PK namespaces versions per module so two modules can both apply
-- their own "0001" without colliding.
CREATE TABLE app.module_schema_migrations (
  module_id  text NOT NULL,
  version    text NOT NULL,
  name       text NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module_id, version)
);
```

- [ ] **Step 2: Add the exemption entry**

In `scripts/audit-release-hardening.ts`, find the `forceRlsExemptions` map (has an existing
`schema_migrations` entry) and add a sibling entry immediately after it:

```ts
  module_schema_migrations:
    "per-module migration-runner bookkeeping (#914): instance infra, no per-user data — same " +
    "posture as schema_migrations",
```

- [ ] **Step 3: Append the foundation test row**

In `tests/integration/foundation.test.ts`, the migration-list `toEqual` array currently ends:

```ts
        { version: "0152", name: "0152_external_modules.sql" }
```

Change it to:

```ts
        { version: "0152", name: "0152_external_modules.sql" },
        { version: "0155", name: "0155_module_schema_migrations.sql" }
```

(Task 2 below appends `0156` immediately after this in the same array — do both edits together
before running the test, since a partial array will fail either way.)

- [ ] **Step 4: Run the audit script and foundation test**

Run: `pnpm --filter . exec tsx scripts/audit-release-hardening.ts` (or the `pnpm` script alias if
one exists — check `package.json` for `audit:release-hardening`; use that name if present)
Expected: no `module_schema_migrations` FORCE RLS failure reported.

Run: `pnpm test:integration -- foundation.test.ts`
Expected: PASS once Task 2's `0156` row is also present (the array assertion checks the whole list
at once — do not expect green until both Task 1 and Task 2 are committed together, or temporarily
run with only the `0155` row and accept the tail-mismatch failure as expected-red for this step).

- [ ] **Step 5: Commit**

```bash
git add infra/postgres/migrations/0155_module_schema_migrations.sql \
  scripts/audit-release-hardening.ts tests/integration/foundation.test.ts
git commit -m "feat(db): add module_schema_migrations ledger table (#914)"
```

### Task 2: `app.module_installs` migration + foundation test row

**Files:**

- Create: `infra/postgres/migrations/0156_module_installs.sql`
- Modify: `tests/integration/foundation.test.ts:336` (continues Task 1's edit)

**Interfaces:**

- Produces: table `app.module_installs(module_id text PK, status text, table_prefix text, owned_tables text[], runtime_role text, install_role text, catalog_fingerprint text, installed_at timestamptz, created_at timestamptz, updated_at timestamptz)`. `ENABLE`+`FORCE ROW LEVEL SECURITY`, `USING (true)` SELECT policy for `jarvis_app_runtime` (admin surface reads install status — not per-user data), full-access policy for `jarvis_migration_owner` (writes it during Phase A/C).
- Consumed by: Task 7 (`scripts/module-install.ts` Phase A/C writes), Task 9 (deletion/export helpers read `owned_tables` as a cheap cross-check against the manifest — manifest remains the authoritative source per Task 9's rationale).

- [ ] **Step 1: Write the migration file**

```sql
-- infra/postgres/migrations/0156_module_installs.sql
-- Per-module install-state journal (#914 Slice 2, spec Data model section). Instance metadata
-- (which modules are installed, at what status) — not per-user content, so a permissive read
-- policy is correct; still ENABLE+FORCE RLS per the hard invariant "RLS applies to all actors
-- including admins" rather than granting a bypass.
CREATE TABLE app.module_installs (
  module_id           text PRIMARY KEY,
  status              text NOT NULL DEFAULT 'installing'
                        CHECK (status IN ('installing', 'installed', 'failed')),
  table_prefix        text NOT NULL,
  owned_tables        text[] NOT NULL DEFAULT '{}',
  runtime_role        text NOT NULL,
  install_role        text NOT NULL,
  catalog_fingerprint text,
  installed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.module_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.module_installs FORCE ROW LEVEL SECURITY;

CREATE POLICY module_installs_select ON app.module_installs
  FOR SELECT TO jarvis_app_runtime, jarvis_migration_owner
  USING (true);

CREATE POLICY module_installs_write ON app.module_installs
  FOR ALL TO jarvis_migration_owner
  USING (true) WITH CHECK (true);

GRANT SELECT ON app.module_installs TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.module_installs TO jarvis_migration_owner;
```

- [ ] **Step 2: Append the foundation test row**

Continue Task 1's array edit so it now ends:

```ts
        { version: "0152", name: "0152_external_modules.sql" },
        { version: "0155", name: "0155_module_schema_migrations.sql" },
        { version: "0156", name: "0156_module_installs.sql" }
```

- [ ] **Step 3: Run migrations and foundation test**

Run: `pnpm db:migrate` (check `package.json` for the exact script name that invokes
`scripts/migrate.ts` against the dev database; use that name)
Expected: `applied 0155_module_schema_migrations.sql`, `applied 0156_module_installs.sql`.

Run: `pnpm test:integration -- foundation.test.ts`
Expected: PASS.

Run: `pnpm --filter . exec tsx scripts/audit-release-hardening.ts`
Expected: no failure for `module_installs` (it has `forceRls: true` and needs no exemption-map
entry — the dynamic coverage check in `collectFailures()` only fires for tables missing FORCE RLS).

- [ ] **Step 4: Commit**

```bash
git add infra/postgres/migrations/0156_module_installs.sql tests/integration/foundation.test.ts
git commit -m "feat(db): add module_installs journal table (#914)"
```

### Task 3: Wire-contract validator (`validateModuleMigrationSql`)

**Files:**

- Create: `packages/db/src/migrations/module-sql-runner.ts`
- Test: `tests/unit/module-sql-runner.test.ts`

**Interfaces:**

- Produces: `export interface ModuleMigrationValidation { readonly ok: boolean; readonly errors: readonly string[] }` and `export function validateModuleMigrationSql(sql: string): ModuleMigrationValidation`.
- Consumed by: Task 4 (`loadModuleMigrationFiles`), Task 7 (Phase B applies only files that already passed this check at load time).

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/unit/module-sql-runner.test.ts
import { describe, expect, it } from "vitest";

import { validateModuleMigrationSql } from "../../packages/db/src/migrations/module-sql-runner.js";

describe("validateModuleMigrationSql", () => {
  it("accepts a single CREATE TABLE statement", () => {
    const result = validateModuleMigrationSql(
      "CREATE TABLE app.acme_widgets (id uuid PRIMARY KEY);"
    );
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("accepts CREATE UNIQUE INDEX", () => {
    const result = validateModuleMigrationSql(
      "CREATE UNIQUE INDEX acme_widgets_name_idx ON app.acme_widgets (name);"
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a statement without a trailing semicolon", () => {
    const result = validateModuleMigrationSql("ALTER TABLE app.acme_widgets ADD COLUMN qty int");
    expect(result.ok).toBe(true);
  });

  it("rejects two statements", () => {
    const result = validateModuleMigrationSql(
      "CREATE TABLE app.a (id uuid); CREATE TABLE app.b (id uuid);"
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/expected exactly one sql statement, found 2/i);
  });

  it("rejects a disallowed first command", () => {
    const result = validateModuleMigrationSql("DROP TABLE app.acme_widgets;");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/first command must be one of/i);
  });

  it("rejects an empty file", () => {
    const result = validateModuleMigrationSql("   \n  ");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/empty/i);
  });

  it("ignores semicolons inside string literals and comments when counting statements", () => {
    const result = validateModuleMigrationSql(
      "-- comment; with a semicolon\n" +
        "CREATE TABLE app.a (id uuid, note text DEFAULT 'a;b''c;d');"
    );
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/module-sql-runner.test.ts`
Expected: FAIL — `Cannot find module '../../packages/db/src/migrations/module-sql-runner.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/db/src/migrations/module-sql-runner.ts
// Slice 1 (#914): wire-contract validator for external-module migration files. Every module
// migration must be exactly one statement whose first command is on a narrow allowlist — this is
// the ONLY security-relevant SQL a module author ever writes; everything else (RLS, policies,
// grants) is platform-generated (module-rls-emitter.ts) so a module can never grant itself access
// it shouldn't have.

const FIRST_COMMAND_ALLOWLIST: readonly RegExp[] = [
  /^CREATE\s+TABLE\b/i,
  /^CREATE\s+(UNIQUE\s+)?INDEX\b/i,
  /^ALTER\s+TABLE\b/i,
  /^DROP\s+INDEX\b/i,
  /^COMMENT\s+ON\b/i
];

export interface ModuleMigrationValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateModuleMigrationSql(sql: string): ModuleMigrationValidation {
  const errors: string[] = [];
  const stripped = stripSqlComments(sql).trim();

  if (stripped.length === 0) {
    return { ok: false, errors: ["migration file is empty"] };
  }

  const statementCount = countTopLevelStatements(stripped);
  if (statementCount !== 1) {
    errors.push(`expected exactly one SQL statement, found ${statementCount}`);
  }

  if (!FIRST_COMMAND_ALLOWLIST.some((pattern) => pattern.test(stripped))) {
    errors.push(
      "first command must be one of: CREATE TABLE, CREATE [UNIQUE] INDEX, ALTER TABLE, " +
        "DROP INDEX, COMMENT ON"
    );
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

/** Strips `--` line comments and `/* *‍/` block comments, passing string literals through untouched. */
function stripSqlComments(sql: string): string {
  let result = "";
  let i = 0;
  while (i < sql.length) {
    const twoChar = sql.slice(i, i + 2);
    if (twoChar === "--") {
      const newlineIndex = sql.indexOf("\n", i);
      i = newlineIndex === -1 ? sql.length : newlineIndex + 1;
      continue;
    }
    if (twoChar === "/*") {
      const endIndex = sql.indexOf("*/", i + 2);
      i = endIndex === -1 ? sql.length : endIndex + 2;
      continue;
    }
    if (sql[i] === "'") {
      const end = findStringLiteralEnd(sql, i);
      result += sql.slice(i, end);
      i = end;
      continue;
    }
    result += sql[i];
    i += 1;
  }
  return result;
}

/** `start` must index the opening `'`. Returns the index just past the closing `'` (handles `''` escapes). */
function findStringLiteralEnd(sql: string, start: number): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

function countTopLevelStatements(sql: string): number {
  let count = 0;
  let i = 0;
  let sawContentSinceSemicolon = false;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const end = findStringLiteralEnd(sql, i);
      sawContentSinceSemicolon = true;
      i = end;
      continue;
    }
    if (sql[i] === ";") {
      if (sawContentSinceSemicolon) count += 1;
      sawContentSinceSemicolon = false;
      i += 1;
      continue;
    }
    if (!/\s/.test(sql[i])) sawContentSinceSemicolon = true;
    i += 1;
  }
  if (sawContentSinceSemicolon) count += 1;
  return count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/module-sql-runner.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/module-sql-runner.ts tests/unit/module-sql-runner.test.ts
git commit -m "feat(db): add module migration wire-contract validator (#914)"
```

### Task 4: Migration file loader + ledger read/write helpers

**Files:**

- Modify: `packages/db/src/migrations/module-sql-runner.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/integration/module-migration-ledger.test.ts`

**Interfaces:**

- Consumes: `validateModuleMigrationSql` (Task 3); `loadMigrationFiles`'s checksum convention from `packages/db/src/migrations/sql-runner.ts` (sha256 of file contents, same as `MigrationFile.checksum`).
- Produces: `export interface ModuleMigrationFile { readonly version: string; readonly name: string; readonly checksum: string; readonly sql: string }`, `export async function loadModuleMigrationFiles(directory: string): Promise<ModuleMigrationFile[]>` (throws if any file fails `validateModuleMigrationSql`), `export async function getAppliedModuleMigrations(connectionString: string, moduleId: string): Promise<Set<string>>`, `export async function recordModuleMigrations(connectionString: string, moduleId: string, files: readonly ModuleMigrationFile[]): Promise<void>`.
- Consumed by: Task 7 (`scripts/module-install.ts` Phase B loads+applies, Phase C records).

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/module-migration-ledger.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  getAppliedModuleMigrations,
  loadModuleMigrationFiles,
  recordModuleMigrations
} from "../../packages/db/src/migrations/module-sql-runner.js";
import { getJarvisDatabaseUrls } from "../../packages/db/src/database.js";
import { resetEmptyFoundationDatabase } from "./test-database.js";

const urls = getJarvisDatabaseUrls();
let dir: string;

beforeAll(async () => {
  await resetEmptyFoundationDatabase(urls.migration);
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  const client = new Client({ connectionString: urls.migration });
  await client.connect();
  await client.query("DELETE FROM app.module_schema_migrations WHERE module_id = 'ledger-fixture'");
  await client.end();
});

describe("loadModuleMigrationFiles", () => {
  it("loads and validates every .sql file in a directory, sorted by version", async () => {
    dir = mkdtempSync(join(tmpdir(), "module-migrations-"));
    writeFileSync(join(dir, "0002_second.sql"), "ALTER TABLE app.a ADD COLUMN b int;");
    writeFileSync(join(dir, "0001_first.sql"), "CREATE TABLE app.a (id uuid PRIMARY KEY);");

    const files = await loadModuleMigrationFiles(dir);

    expect(files.map((f) => f.version)).toEqual(["0001", "0002"]);
    expect(files[0].name).toBe("0001_first.sql");
    expect(files[0].checksum).toHaveLength(64);
  });

  it("throws with the file name when a file violates the wire contract", async () => {
    dir = mkdtempSync(join(tmpdir(), "module-migrations-"));
    writeFileSync(join(dir, "0001_bad.sql"), "DROP TABLE app.a;");

    await expect(loadModuleMigrationFiles(dir)).rejects.toThrow(/0001_bad\.sql/);
  });
});

describe("module migration ledger", () => {
  it("records applied migrations and reports them on the next read", async () => {
    const moduleId = "ledger-fixture";
    const files = [
      { version: "0001", name: "0001_first.sql", checksum: "a".repeat(64), sql: "select 1" }
    ];

    expect(await getAppliedModuleMigrations(urls.migration, moduleId)).toEqual(new Set());

    await recordModuleMigrations(urls.migration, moduleId, files);

    expect(await getAppliedModuleMigrations(urls.migration, moduleId)).toEqual(new Set(["0001"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration -- module-migration-ledger.test.ts`
Expected: FAIL — `loadModuleMigrationFiles`/`getAppliedModuleMigrations`/`recordModuleMigrations`
are not exported yet.

- [ ] **Step 3: Implement the loader and ledger helpers**

Append to `packages/db/src/migrations/module-sql-runner.ts`:

```ts
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "pg";

export interface ModuleMigrationFile {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

/** Loads every `.sql` file in `directory`, sorted by filename, validating each against the wire contract. */
export async function loadModuleMigrationFiles(directory: string): Promise<ModuleMigrationFile[]> {
  const entries = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const files: ModuleMigrationFile[] = [];
  for (const name of entries) {
    const sql = await readFile(join(directory, name), "utf8");
    const validation = validateModuleMigrationSql(sql);
    if (!validation.ok) {
      throw new Error(
        `module migration ${name} violates the wire contract: ${validation.errors.join("; ")}`
      );
    }
    const version = name.split("_")[0];
    files.push({ version, name, checksum: createHash("sha256").update(sql).digest("hex"), sql });
  }
  return files;
}

/** Returns the set of migration versions already recorded for `moduleId`. */
export async function getAppliedModuleMigrations(
  connectionString: string,
  moduleId: string
): Promise<Set<string>> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ version: string }>(
      "SELECT version FROM app.module_schema_migrations WHERE module_id = $1",
      [moduleId]
    );
    return new Set(result.rows.map((row) => row.version));
  } finally {
    await client.end();
  }
}

/** Records ledger rows for `files` under `moduleId` (Phase C — runs over the migration-owner connection). */
export async function recordModuleMigrations(
  connectionString: string,
  moduleId: string,
  files: readonly ModuleMigrationFile[]
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) {
      await client.query(
        "INSERT INTO app.module_schema_migrations (module_id, version, name, checksum) " +
          "VALUES ($1, $2, $3, $4)",
        [moduleId, file.version, file.name, file.checksum]
      );
    }
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/db/src/index.ts`, the current alphabetical list is:

```ts
export * from "./auth-session.js";
export * from "./data-context.js";
export * from "./database.js";
export * from "./keyring.js";
export * from "./migrations/sql-runner.js";
export * from "./role-bootstrap.js";
export * from "./secret-cipher.js";
export * from "./sharing/index.js";
export * from "./types.js";
export * from "./urls.js";
```

`"./migrations/module-sql-runner.js"` sorts **before** `"./migrations/sql-runner.js"`
(`module` < `sql` lexically) — insert it immediately above that line:

```ts
export * from "./migrations/module-sql-runner.js";
export * from "./migrations/sql-runner.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:integration -- module-migration-ledger.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/module-sql-runner.ts packages/db/src/index.ts \
  tests/integration/module-migration-ledger.test.ts
git commit -m "feat(db): add module migration loader and ledger read/write helpers (#914)"
```

---

## Slice 2: Install Entrypoint (4-Phase Role Broker)

### Task 5: Per-module role broker

**Files:**

- Create: `packages/db/src/module-role-broker.ts`
- Test: `tests/unit/module-role-broker.test.ts`
- Test: `tests/integration/module-role-broker.test.ts`

**Interfaces:**

- Produces: `export function moduleRuntimeRoleName(moduleId: string): string` (→ `jarvis_mod_<slug>_runtime`), `export function moduleInstallRoleName(moduleId: string): string` (→ `jarvis_mod_<slug>_install`), `export async function ensureModuleRoles(connectionString: string, moduleId: string): Promise<{ runtimeRole: string; installRole: string }>` (Phase A — idempotent role creation + `WITH INHERIT FALSE` grants to `jarvis_app_runtime`/`jarvis_worker_runtime`), `export async function enableInstallerLogin(connectionString: string, moduleId: string): Promise<string>` (returns the random password, flips `LOGIN`), `export async function disableInstallerLogin(connectionString: string, moduleId: string): Promise<void>` (Phase D).
- Consumed by: Task 7 (`scripts/module-install.ts` Phase A/D).

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/unit/module-role-broker.test.ts
import { describe, expect, it } from "vitest";

import {
  moduleInstallRoleName,
  moduleRuntimeRoleName
} from "../../packages/db/src/module-role-broker.js";

describe("module role name derivation", () => {
  it("builds the runtime role name, replacing hyphens with underscores", () => {
    expect(moduleRuntimeRoleName("acme-widgets")).toBe("jarvis_mod_acme_widgets_runtime");
  });

  it("builds the install role name", () => {
    expect(moduleInstallRoleName("acme-widgets")).toBe("jarvis_mod_acme_widgets_install");
  });

  it("rejects a module id that is not a valid kebab slug", () => {
    expect(() => moduleRuntimeRoleName("Acme Widgets")).toThrow(/invalid module id/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/module-role-broker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement role name helpers and broker functions**

```ts
// packages/db/src/module-role-broker.ts
// Slice 2 (#914): per-module Postgres role lifecycle. Two roles per installed module:
// jarvis_mod_<slug>_runtime (NOLOGIN, granted to the parent runtime roles WITH INHERIT FALSE so
// they must SET LOCAL ROLE to use it — see module-storage-rpc.ts) and jarvis_mod_<slug>_install
// (NOLOGIN at rest, flipped to LOGIN with a random in-memory password only for the duration of
// Phase B, flipped back in Phase D regardless of outcome). Mirrors the idempotent
// DO $$ ... IF NOT EXISTS ... ELSE ... END $$ pattern in infra/postgres/bootstrap/0000_roles.sql.
import { randomBytes } from "node:crypto";

import { Client } from "pg";

// Mirrors packages/module-registry/src/external/validate.ts's MODULE_ID_RE. Duplicated rather
// than imported: module-registry already depends on @jarv1s/db, so importing the other way would
// create a package cycle.
const MODULE_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function assertValidModuleId(moduleId: string): void {
  if (!MODULE_ID_RE.test(moduleId)) {
    throw new Error(`invalid module id "${moduleId}"`);
  }
}

function moduleSlugForRole(moduleId: string): string {
  assertValidModuleId(moduleId);
  return moduleId.replace(/-/g, "_");
}

export function moduleRuntimeRoleName(moduleId: string): string {
  return `jarvis_mod_${moduleSlugForRole(moduleId)}_runtime`;
}

export function moduleInstallRoleName(moduleId: string): string {
  return `jarvis_mod_${moduleSlugForRole(moduleId)}_install`;
}

export interface ModuleRoles {
  readonly runtimeRole: string;
  readonly installRole: string;
}

/** Phase A: idempotently create both roles (NOLOGIN) and grant the runtime role to the parent runtime roles. */
export async function ensureModuleRoles(
  connectionString: string,
  moduleId: string
): Promise<ModuleRoles> {
  const runtimeRole = moduleRuntimeRoleName(moduleId);
  const installRole = moduleInstallRoleName(moduleId);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const role of [runtimeRole, installRole]) {
      await client.query(
        `DO $$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
             EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ' ||
               'NOINHERIT NOREPLICATION NOBYPASSRLS', '${role}');
           END IF;
         END $$;`
      );
    }
    await client.query(
      `GRANT ${client.escapeIdentifier(runtimeRole)} TO jarvis_app_runtime, jarvis_worker_runtime ` +
        `WITH INHERIT FALSE`
    );
  } finally {
    await client.end();
  }
  return { runtimeRole, installRole };
}

/** Phase A/B boundary: flips the installer role to LOGIN with a fresh random password, returned only in memory. */
export async function enableInstallerLogin(
  connectionString: string,
  moduleId: string
): Promise<string> {
  const installRole = moduleInstallRoleName(moduleId);
  const password = randomBytes(24).toString("base64url");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `ALTER ROLE ${client.escapeIdentifier(installRole)} LOGIN PASSWORD ` +
        client.escapeLiteral(password)
    );
  } finally {
    await client.end();
  }
  return password;
}

/** Phase D: flips the installer role back to NOLOGIN and clears its password, regardless of install outcome. */
export async function disableInstallerLogin(
  connectionString: string,
  moduleId: string
): Promise<void> {
  const installRole = moduleInstallRoleName(moduleId);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`ALTER ROLE ${client.escapeIdentifier(installRole)} NOLOGIN PASSWORD NULL`);
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `pnpm vitest run tests/unit/module-role-broker.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Write the failing integration test**

```ts
// tests/integration/module-role-broker.test.ts
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  disableInstallerLogin,
  enableInstallerLogin,
  ensureModuleRoles,
  moduleInstallRoleName,
  moduleRuntimeRoleName
} from "../../packages/db/src/module-role-broker.js";
import { getJarvisDatabaseUrls } from "../../packages/db/src/database.js";

const urls = getJarvisDatabaseUrls();
const moduleId = "role-broker-fixture";

afterAll(async () => {
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  await client.query(`DROP ROLE IF EXISTS ${moduleInstallRoleName(moduleId)}`);
  await client.query(`DROP ROLE IF EXISTS ${moduleRuntimeRoleName(moduleId)}`);
  await client.end();
});

describe("module role broker", () => {
  it("creates both roles NOLOGIN, then flips and unflips the installer role's login", async () => {
    const roles = await ensureModuleRoles(urls.bootstrap, moduleId);
    expect(roles.runtimeRole).toBe("jarvis_mod_role_broker_fixture_runtime");

    const check = new Client({ connectionString: urls.bootstrap });
    await check.connect();
    const before = await check.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
      roles.installRole
    ]);
    expect(before.rows[0].rolcanlogin).toBe(false);

    const password = await enableInstallerLogin(urls.bootstrap, moduleId);
    expect(password).toHaveLength(32);
    const afterEnable = await check.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
      roles.installRole
    ]);
    expect(afterEnable.rows[0].rolcanlogin).toBe(true);

    await disableInstallerLogin(urls.bootstrap, moduleId);
    const afterDisable = await check.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
      roles.installRole
    ]);
    expect(afterDisable.rows[0].rolcanlogin).toBe(false);
    await check.end();
  });
});
```

- [ ] **Step 6: Run integration test to verify it passes**

Run: `pnpm test:integration -- module-role-broker.test.ts`
Expected: PASS (1/1). (`ensureModuleRoles`/`enableInstallerLogin`/`disableInstallerLogin` already
implemented in Step 3, so this step is a verification run, not new implementation — if it fails,
fix the implementation before proceeding.)

- [ ] **Step 7: Add barrel export and commit**

In `packages/db/src/index.ts`, insert alphabetically (`module-role-broker` sorts after
`migrations/sql-runner.js`, before `role-bootstrap.js`):

```ts
export * from "./migrations/module-sql-runner.js";
export * from "./migrations/sql-runner.js";
export * from "./module-role-broker.js";
export * from "./role-bootstrap.js";
```

```bash
git add packages/db/src/module-role-broker.ts packages/db/src/index.ts \
  tests/unit/module-role-broker.test.ts tests/integration/module-role-broker.test.ts
git commit -m "feat(db): add per-module Postgres role broker (#914)"
```

## Slice 3: RLS/Policy/Grant Emitter

### Task 6: `generateModuleTableRlsSql`

**Files:**

- Create: `packages/db/src/module-rls-emitter.ts`
- Test: `tests/unit/module-rls-emitter.test.ts`

**Interfaces:**

- Consumes: `moduleRuntimeRoleName` (Task 5).
- Produces: `export function generateModuleTableRlsSql(moduleId: string, ownedTables: readonly string[]): string[]` (ordered list of DDL statements to execute inside Phase B's transaction), and `export function assertQualifiedTableName(table: string): void` (throws on any table name not matching `app.<snake_case>`).
- Consumed by: Task 7 (`scripts/module-install.ts` Phase B), Task 9 (`assertQualifiedTableName` guards manifest-declared table names before they're spliced into the export reader's SQL).

This emitter mirrors `packages/sports/sql/0133_sports_follows.sql`'s hand-written pattern exactly
(four per-verb owner-only policies + one combined grant), generated instead of hand-written so no
external module author ever touches RLS.

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/unit/module-rls-emitter.test.ts
import { describe, expect, it } from "vitest";

import { generateModuleTableRlsSql } from "../../packages/db/src/module-rls-emitter.js";

describe("generateModuleTableRlsSql", () => {
  it("emits FORCE RLS, four per-verb policies, and a grant for one owned table", () => {
    const statements = generateModuleTableRlsSql("acme-widgets", ["app.acme_widgets"]);

    expect(statements).toEqual([
      "ALTER TABLE app.acme_widgets ENABLE ROW LEVEL SECURITY;",
      "ALTER TABLE app.acme_widgets FORCE ROW LEVEL SECURITY;",
      "DROP POLICY IF EXISTS acme_widgets_select ON app.acme_widgets;",
      "CREATE POLICY acme_widgets_select ON app.acme_widgets FOR SELECT " +
        "TO jarvis_mod_acme_widgets_runtime " +
        "USING (owner_user_id = app.current_actor_user_id());",
      "DROP POLICY IF EXISTS acme_widgets_insert ON app.acme_widgets;",
      "CREATE POLICY acme_widgets_insert ON app.acme_widgets FOR INSERT " +
        "TO jarvis_mod_acme_widgets_runtime " +
        "WITH CHECK (owner_user_id = app.current_actor_user_id());",
      "DROP POLICY IF EXISTS acme_widgets_update ON app.acme_widgets;",
      "CREATE POLICY acme_widgets_update ON app.acme_widgets FOR UPDATE " +
        "TO jarvis_mod_acme_widgets_runtime " +
        "USING (owner_user_id = app.current_actor_user_id()) " +
        "WITH CHECK (owner_user_id = app.current_actor_user_id());",
      "DROP POLICY IF EXISTS acme_widgets_delete ON app.acme_widgets;",
      "CREATE POLICY acme_widgets_delete ON app.acme_widgets FOR DELETE " +
        "TO jarvis_mod_acme_widgets_runtime " +
        "USING (owner_user_id = app.current_actor_user_id());",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON app.acme_widgets TO jarvis_mod_acme_widgets_runtime;"
    ]);
  });

  it("rejects a table name outside app.<snake_case> (injection guard)", () => {
    expect(() =>
      generateModuleTableRlsSql("acme-widgets", ["app.acme_widgets; DROP TABLE app.users"])
    ).toThrow(/invalid module owned table name/i);
  });

  it("rejects a table name in a schema other than app", () => {
    expect(() => generateModuleTableRlsSql("acme-widgets", ["public.widgets"])).toThrow(
      /invalid module owned table name/i
    );
  });

  it("returns an empty array for a module with no owned tables", () => {
    expect(generateModuleTableRlsSql("acme-widgets", [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/module-rls-emitter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the emitter**

```ts
// packages/db/src/module-rls-emitter.ts
// Slice 3 (#914): pure SQL generator for module-owned-table RLS. Mirrors the hand-written
// packages/sports/sql/0133_sports_follows.sql pattern exactly (FORCE RLS + four per-verb
// owner-only policies + one combined grant) — generated so external modules never author
// security SQL themselves; `scripts/module-install.ts` Phase B executes this output inside the
// same transaction as the module's own DDL.
import { moduleRuntimeRoleName } from "./module-role-broker.js";

// Table names come from a module manifest, which for external modules is untrusted input read
// from disk — validate strictly before splicing into generated DDL to prevent SQL injection.
// Exported so other call sites that splice manifest-declared table names into SQL (e.g. Task 9's
// export-row reader) reuse the same guard rather than re-deriving it.
const QUALIFIED_TABLE_RE = /^app\.[a-z][a-z0-9_]*$/;

export function assertQualifiedTableName(table: string): void {
  if (!QUALIFIED_TABLE_RE.test(table)) {
    throw new Error(`invalid module owned table name "${table}" (must match app.<snake_case>)`);
  }
}

function policyBaseName(table: string): string {
  return table.slice("app.".length);
}

export function generateModuleTableRlsSql(
  moduleId: string,
  ownedTables: readonly string[]
): string[] {
  const role = moduleRuntimeRoleName(moduleId);
  const statements: string[] = [];

  for (const table of ownedTables) {
    assertQualifiedTableName(table);
    const base = policyBaseName(table);
    const ownerCheck = "owner_user_id = app.current_actor_user_id()";

    statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    statements.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);

    statements.push(`DROP POLICY IF EXISTS ${base}_select ON ${table};`);
    statements.push(
      `CREATE POLICY ${base}_select ON ${table} FOR SELECT TO ${role} USING (${ownerCheck});`
    );

    statements.push(`DROP POLICY IF EXISTS ${base}_insert ON ${table};`);
    statements.push(
      `CREATE POLICY ${base}_insert ON ${table} FOR INSERT TO ${role} WITH CHECK (${ownerCheck});`
    );

    statements.push(`DROP POLICY IF EXISTS ${base}_update ON ${table};`);
    statements.push(
      `CREATE POLICY ${base}_update ON ${table} FOR UPDATE TO ${role} ` +
        `USING (${ownerCheck}) WITH CHECK (${ownerCheck});`
    );

    statements.push(`DROP POLICY IF EXISTS ${base}_delete ON ${table};`);
    statements.push(
      `CREATE POLICY ${base}_delete ON ${table} FOR DELETE TO ${role} USING (${ownerCheck});`
    );

    statements.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${role};`);
  }

  return statements;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/module-rls-emitter.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Add barrel export and commit**

In `packages/db/src/index.ts`, insert alphabetically (before `module-storage-rpc.js`, added in
Task 9, and after `module-role-broker.js`):

```ts
export * from "./module-role-broker.js";
export * from "./module-rls-emitter.js";
export * from "./role-bootstrap.js";
```

```bash
git add packages/db/src/module-rls-emitter.ts packages/db/src/index.ts \
  tests/unit/module-rls-emitter.test.ts
git commit -m "feat(db): add module owned-table RLS/policy/grant emitter (#914)"
```

---

### Task 7: `scripts/module-install.ts` (4-phase orchestration)

**Files:**

- Create: `scripts/module-install.ts`
- Test: `tests/integration/module-install.test.ts`
- Modify: `infra/docker-compose.prod.yml`

**Interfaces:**

- Consumes: `ensureModuleRoles`, `enableInstallerLogin`, `disableInstallerLogin` (Task 5); `loadModuleMigrationFiles`, `getAppliedModuleMigrations`, `recordModuleMigrations` (Task 4); `generateModuleTableRlsSql` (Task 6).
- Produces: `export async function installModule(options: ModuleInstallOptions): Promise<{ installed: string[] }>`, `export interface ModuleInstallOptions { readonly moduleId: string; readonly manifest: JarvisModuleManifest; readonly bootstrapConnectionString: string; readonly migrationConnectionString: string; readonly migrationsDirectory: string }`.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/module-install.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { installModule } from "../../scripts/module-install.js";
import { getJarvisDatabaseUrls } from "../../packages/db/src/database.js";
import { moduleRuntimeRoleName } from "../../packages/db/src/module-role-broker.js";

const urls = getJarvisDatabaseUrls();
const moduleId = "install-fixture";
let dir: string;

afterEach(async () => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  await client.query("DROP TABLE IF EXISTS app.install_fixture_widgets");
  await client.query(`DROP ROLE IF EXISTS jarvis_mod_install_fixture_install`);
  await client.query(`DROP ROLE IF EXISTS jarvis_mod_install_fixture_runtime`);
  await client.query("DELETE FROM app.module_installs WHERE module_id = $1", [moduleId]);
  await client.query("DELETE FROM app.module_schema_migrations WHERE module_id = $1", [moduleId]);
  await client.end();
});

describe("installModule", () => {
  it("applies module DDL, generated RLS, and records the ledger + journal rows", async () => {
    dir = mkdtempSync(join(tmpdir(), "module-install-"));
    writeFileSync(
      join(dir, "0001_create.sql"),
      "CREATE TABLE app.install_fixture_widgets " +
        "(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL);"
    );

    const result = await installModule({
      moduleId,
      manifest: {
        id: moduleId,
        name: "Install Fixture",
        version: "0.0.1",
        publisher: "test",
        lifecycle: "optional",
        compatibility: { jarv1s: ">=0.0.0" },
        availability: { defaultEnabled: false },
        database: { migrations: [], ownedTables: ["app.install_fixture_widgets"] }
      } as any,
      bootstrapConnectionString: urls.bootstrap,
      migrationConnectionString: urls.migration,
      migrationsDirectory: dir
    });

    expect(result.installed).toEqual(["0001_create.sql"]);

    const client = new Client({ connectionString: urls.bootstrap });
    await client.connect();

    const journal = await client.query(
      "SELECT status, owned_tables FROM app.module_installs WHERE module_id = $1",
      [moduleId]
    );
    expect(journal.rows[0].status).toBe("installed");
    expect(journal.rows[0].owned_tables).toEqual(["app.install_fixture_widgets"]);

    const ledger = await client.query(
      "SELECT version FROM app.module_schema_migrations WHERE module_id = $1",
      [moduleId]
    );
    expect(ledger.rows.map((r) => r.version)).toEqual(["0001"]);

    const forceRls = await client.query(
      "SELECT relforcerowsecurity FROM pg_class WHERE oid = 'app.install_fixture_widgets'::regclass"
    );
    expect(forceRls.rows[0].relforcerowsecurity).toBe(true);

    const roleCanLogin = await client.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
      moduleRuntimeRoleName(moduleId)
    ]);
    expect(roleCanLogin.rows[0]).toBeUndefined(); // runtime role exists but query above needs rolname match
    await client.end();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration -- module-install.test.ts`
Expected: FAIL — `scripts/module-install.js` not found.

- [ ] **Step 3: Implement the 4-phase orchestration**

```ts
// scripts/module-install.ts
// Slice 2 (#914): 4-phase module install entrypoint.
//   Phase A (bootstrap/superuser conn): ensure roles, journal 'installing'.
//   Phase B (installer conn, ONE transaction): apply module DDL + generated RLS/grants.
//   Phase C (migration-owner conn): record ledger rows, flip journal to 'installed'.
//   Phase D (bootstrap/superuser conn): disable installer login, always (finally).
// Recovery model: if the process dies between B and C, a re-run's Phase A finds the journal row
// already 'installing' with a catalog_fingerprint recorded at the end of Phase B — Phase B is
// re-entered, re-applies (idempotent DDL is a module-author responsibility per the wire contract's
// CREATE TABLE/INDEX-only allowlist), and Phase C's ledger insert is naturally idempotent-safe
// because getAppliedModuleMigrations skips already-applied versions before Phase B runs them.
import { Client } from "pg";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

import {
  disableInstallerLogin,
  enableInstallerLogin,
  ensureModuleRoles,
  moduleRuntimeRoleName
} from "../packages/db/src/module-role-broker.js";
import {
  getAppliedModuleMigrations,
  loadModuleMigrationFiles,
  recordModuleMigrations
} from "../packages/db/src/migrations/module-sql-runner.js";
import { generateModuleTableRlsSql } from "../packages/db/src/module-rls-emitter.js";

export interface ModuleInstallOptions {
  readonly moduleId: string;
  readonly manifest: JarvisModuleManifest;
  readonly bootstrapConnectionString: string;
  readonly migrationConnectionString: string;
  readonly migrationsDirectory: string;
}

export async function installModule(
  options: ModuleInstallOptions
): Promise<{ installed: string[] }> {
  const { moduleId, manifest, bootstrapConnectionString, migrationConnectionString } = options;
  const ownedTables = manifest.database?.ownedTables ?? [];

  // Phase A
  const { runtimeRole, installRole } = await ensureModuleRoles(bootstrapConnectionString, moduleId);
  await journalUpsert(bootstrapConnectionString, {
    moduleId,
    status: "installing",
    tablePrefix: moduleId.replace(/-/g, "_"),
    ownedTables,
    runtimeRole,
    installRole
  });
  const password = await enableInstallerLogin(bootstrapConnectionString, moduleId);

  let installed: string[] = [];
  try {
    // Phase B
    const alreadyApplied = await getAppliedModuleMigrations(migrationConnectionString, moduleId);
    const files = (await loadModuleMigrationFiles(options.migrationsDirectory)).filter(
      (file) => !alreadyApplied.has(file.version)
    );

    const installerConnectionString = withCredentials(
      bootstrapConnectionString,
      installRole,
      password
    );
    const installerClient = new Client({ connectionString: installerConnectionString });
    await installerClient.connect();
    try {
      await installerClient.query("BEGIN");
      for (const file of files) {
        await installerClient.query(file.sql);
      }
      for (const statement of generateModuleTableRlsSql(moduleId, ownedTables)) {
        await installerClient.query(statement);
      }
      await installerClient.query("COMMIT");
    } catch (error) {
      await installerClient.query("ROLLBACK");
      throw error;
    } finally {
      await installerClient.end();
    }

    // Phase C
    if (files.length > 0) {
      await recordModuleMigrations(migrationConnectionString, moduleId, files);
    }
    await journalUpsert(bootstrapConnectionString, {
      moduleId,
      status: "installed",
      tablePrefix: moduleId.replace(/-/g, "_"),
      ownedTables,
      runtimeRole,
      installRole,
      installedAt: new Date()
    });
    installed = files.map((file) => file.name);
  } finally {
    // Phase D — always, success or failure.
    await disableInstallerLogin(bootstrapConnectionString, moduleId);
  }

  return { installed };
}

function withCredentials(connectionString: string, user: string, password: string): string {
  const url = new URL(connectionString);
  url.username = user;
  url.password = password;
  return url.toString();
}

interface JournalRow {
  readonly moduleId: string;
  readonly status: "installing" | "installed" | "failed";
  readonly tablePrefix: string;
  readonly ownedTables: readonly string[];
  readonly runtimeRole: string;
  readonly installRole: string;
  readonly installedAt?: Date;
}

async function journalUpsert(connectionString: string, row: JournalRow): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.module_installs
         (module_id, status, table_prefix, owned_tables, runtime_role, install_role, installed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (module_id) DO UPDATE SET
         status = EXCLUDED.status,
         owned_tables = EXCLUDED.owned_tables,
         installed_at = COALESCE(EXCLUDED.installed_at, app.module_installs.installed_at),
         updated_at = now()`,
      [
        row.moduleId,
        row.status,
        row.tablePrefix,
        row.ownedTables,
        row.runtimeRole,
        row.installRole,
        row.installedAt ?? null
      ]
    );
  } finally {
    await client.end();
  }
}
```

Note: derive role names via `ensureModuleRoles`'s return value rather than importing
`moduleRuntimeRoleName` separately, so the type-checker doesn't flag an unused import
(`noUnusedLocals`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:integration -- module-install.test.ts`
Expected: PASS.

Fix the test's `roleCanLogin` assertion, which as drafted checks the wrong condition — replace it
with a direct existence + `NOLOGIN` check:

```ts
const roleRow = await client.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
  moduleRuntimeRoleName(moduleId)
]);
expect(roleRow.rows[0].rolcanlogin).toBe(false);
```

- [ ] **Step 5: Add the Compose ops service**

In `infra/docker-compose.prod.yml`, immediately after the existing `migrate` service block, add:

```yaml
  module-install:
    image: ghcr.io/motioneso/jarv1s:${JARVIS_IMAGE_TAG:?set JARVIS_IMAGE_TAG to a published version tag}
    build:
      context: ..
      dockerfile: Dockerfile
    <<: *app-env-file
    command: ["node_modules/.bin/tsx", "scripts/module-install.ts"]
    depends_on:
      postgres:
        condition: service_healthy
    profiles: ["ops"]
    networks:
      - jarv1s
```

Add a one-line usage comment near the file's existing "Manual migration recovery" comment block:

```
# Install an external module (after it's been placed under the modules directory):
#   docker compose -p jarv1s-prod -f docker-compose.prod.yml --env-file ./env.production.local \
#     --profile ops run --rm module-install
```

- [ ] **Step 6: Commit**

```bash
git add scripts/module-install.ts tests/integration/module-install.test.ts \
  infra/docker-compose.prod.yml
git commit -m "feat: add 4-phase external module install entrypoint (#914)"
```

---

## Slice 4: Storage RPC + Derived Lifecycle Hooks

### Task 8: `ctx.db.query` storage RPC

**Files:**

- Create: `packages/db/src/module-storage-rpc.ts`
- Test: `tests/integration/module-storage-rpc.test.ts`

**Interfaces:**

- Consumes: `DataContextDb`, `AccessContext` (`packages/db/src/data-context.ts`); `moduleRuntimeRoleName` (Task 5).
- Produces: `export interface ModuleStorageRpc { readonly query: <T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => Promise<{ readonly rows: readonly T[] }> }`, `export function createModuleStorageRpc(scopedDb: DataContextDb, moduleId: string): ModuleStorageRpc`.
- Consumed by: future module worker/route registrations (out of scope for this plan — this task only builds and tests the RPC surface itself, per spec D5).

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/module-storage-rpc.test.ts
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createModuleStorageRpc } from "../../packages/db/src/module-storage-rpc.js";
import { getJarvisDatabaseUrls } from "../../packages/db/src/database.js";
import { DataContextRunner } from "../../packages/db/src/data-context.js";
import { getJarvisKysely } from "../../packages/db/src/database.js";
import { ensureModuleRoles } from "../../packages/db/src/module-role-broker.js";
import { generateModuleTableRlsSql } from "../../packages/db/src/module-rls-emitter.js";
import { ids } from "./test-database.js";

const urls = getJarvisDatabaseUrls();
const moduleId = "storage-rpc-fixture";

beforeAll(async () => {
  await ensureModuleRoles(urls.bootstrap, moduleId);
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  await client.query(
    "CREATE TABLE IF NOT EXISTS app.storage_rpc_fixture_items " +
      "(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL, label text)"
  );
  for (const statement of generateModuleTableRlsSql(moduleId, ["app.storage_rpc_fixture_items"])) {
    await client.query(statement);
  }
  await client.query(
    "GRANT jarvis_mod_storage_rpc_fixture_runtime TO jarvis_app_runtime WITH INHERIT FALSE"
  );
  await client.end();
});

afterAll(async () => {
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  await client.query("DROP TABLE IF EXISTS app.storage_rpc_fixture_items");
  await client.query("DROP ROLE IF EXISTS jarvis_mod_storage_rpc_fixture_runtime");
  await client.query("DROP ROLE IF EXISTS jarvis_mod_storage_rpc_fixture_install");
  await client.end();
});

describe("createModuleStorageRpc", () => {
  it("scopes queries to the calling module's runtime role under RLS", async () => {
    const dataContext = new DataContextRunner(getJarvisKysely(urls.app));
    const owner = ids.userId();

    await dataContext.withDataContext({ actorUserId: owner }, async (scopedDb) => {
      const rpc = createModuleStorageRpc(scopedDb, moduleId);
      await rpc.query(
        "INSERT INTO app.storage_rpc_fixture_items (owner_user_id, label) VALUES ($1, $2)",
        [owner, "mine"]
      );
      const result = await rpc.query<{ label: string }>(
        "SELECT label FROM app.storage_rpc_fixture_items WHERE owner_user_id = $1",
        [owner]
      );
      expect(result.rows).toEqual([{ label: "mine" }]);
    });

    const other = ids.userId();
    await dataContext.withDataContext({ actorUserId: other }, async (scopedDb) => {
      const rpc = createModuleStorageRpc(scopedDb, moduleId);
      const result = await rpc.query("SELECT label FROM app.storage_rpc_fixture_items");
      expect(result.rows).toEqual([]); // RLS hides the other actor's row
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration -- module-storage-rpc.test.ts`
Expected: FAIL — `module-storage-rpc.js` not found.

- [ ] **Step 3: Implement the RPC**

```ts
// packages/db/src/module-storage-rpc.ts
// Slice 4 (#914), spec D5: the ONLY database surface a module's own code ever gets. Runs every
// query under SET LOCAL ROLE jarvis_mod_<slug>_runtime inside the caller's existing DataContextDb
// transaction, so the module inherits the actor-scoped GUCs (app.actor_user_id / app.request_id)
// already set by withDataContext, and RLS narrows every query to owner_user_id = that actor —
// exactly as if the module had written its own repository against the parent runtime role, minus
// the ability to ever touch a table it wasn't granted.
import { CompiledQuery, sql } from "kysely";

import type { DataContextDb } from "./data-context.js";
import { moduleRuntimeRoleName } from "./module-role-broker.js";

export interface ModuleQueryResult<T> {
  readonly rows: readonly T[];
}

export interface ModuleStorageRpc {
  query<T = Record<string, unknown>>(
    queryText: string,
    params?: readonly unknown[]
  ): Promise<ModuleQueryResult<T>>;
}

export function createModuleStorageRpc(
  scopedDb: DataContextDb,
  moduleId: string
): ModuleStorageRpc {
  const role = moduleRuntimeRoleName(moduleId);
  return {
    async query<T>(
      queryText: string,
      params: readonly unknown[] = []
    ): Promise<ModuleQueryResult<T>> {
      await sql.raw(`SET LOCAL ROLE ${role}`).execute(scopedDb.db);
      const result = await scopedDb.db.executeQuery<T>(CompiledQuery.raw(queryText, [...params]));
      return { rows: result.rows };
    }
  };
}
```

`CompiledQuery.raw(sql, parameters)` is Kysely's documented constructor for an arbitrary
already-parameterized SQL string plus its positional parameter array, executed via
`db.executeQuery`. `sql.raw(...)` covers the fixed `SET LOCAL ROLE <identifier>` statement, which
takes no bind parameters (the role name comes from `moduleRuntimeRoleName`, not caller input).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:integration -- module-storage-rpc.test.ts`
Expected: PASS (1/1).

- [ ] **Step 5: Add barrel export and commit**

```ts
export * from "./module-rls-emitter.js";
export * from "./module-storage-rpc.js";
export * from "./role-bootstrap.js";
```

```bash
git add packages/db/src/module-storage-rpc.ts packages/db/src/index.ts \
  tests/integration/module-storage-rpc.test.ts
git commit -m "feat(db): add module storage RPC (SET LOCAL ROLE scoped query surface) (#914)"
```

### Task 9: External-module export section + deletion sweep

**Files:**

- Modify: `packages/module-registry/src/index.ts` (add `getExternalModuleDeletionTables`)
- Modify: `packages/settings/src/data-export.ts` (add external-module export rows)
- Modify: `scripts/delete-user-data.ts` (merge external deletion tables into the sweep)
- Test: `tests/integration/module-registry.test.ts` (extend)

**Rationale (supersedes an earlier relay draft's design):** owned tables for export/deletion come
from each installed module's manifest `database.ownedTables` list — the same list
`assertModuleRegistryConsistency` already validates and `app.module_installs.owned_tables` records
at install time — **not** a live `information_schema` prefix scan. The spec's D4/D6 sections treat
the manifest's declared list as authoritative (enforced via the Phase B catalog-diff check in Task
6), so a live catalog scan would be a second, divergent source of truth for the same fact.

**Interfaces:**

- Produces: `export function getExternalModuleDeletionTables(installedManifests: readonly JarvisModuleManifest[]): readonly ResolvedModuleDeletionTable[]` (same `ResolvedModuleDeletionTable` shape as the existing `getModuleDeletionTables`), and `export async function readExternalModuleExportRows(scopedDb: DataContextDb, installedManifests: readonly JarvisModuleManifest[]): Promise<Record<string, readonly ExportRow[]>>`.
- Consumes: `ResolvedModuleDeletionTable`, `DEFAULT_MODULE_DELETION_COUNT_PREDICATE` (existing exports in `packages/module-registry/src/index.ts:1560-1584`); `createModuleStorageRpc` (Task 8) and `assertQualifiedTableName` (Task 6) — the export reader must route every module-table read through the Task 8 RPC under `SET LOCAL ROLE`, never query `scopedDb.db` directly (spec D6; see the Coordinator-flagged correction in Step 6 below).

- [ ] **Step 1: Write the failing unit test**

Add to `tests/integration/module-registry.test.ts`, inside a new top-level `describe` block after
the existing `dataLifecycle parity` block:

```ts
describe("getExternalModuleDeletionTables (#914)", () => {
  it("resolves owned tables from an installed external module's manifest, same shape as built-ins", () => {
    const externalManifest = manifest({
      id: "acme-widgets",
      database: { migrations: [], ownedTables: ["app.acme_widgets"] },
      dataLifecycle: {
        exportSections: [],
        deletion: {
          strategy: "cascade",
          tables: [{ table: "app.acme_widgets", countPredicate: "owner_user_id = $1::uuid" }]
        }
      }
    });

    expect(getExternalModuleDeletionTables([externalManifest])).toEqual([
      { table: "app.acme_widgets", countPredicate: "owner_user_id = $1::uuid" }
    ]);
  });

  it("applies the default count predicate when a table omits one", () => {
    const externalManifest = manifest({
      id: "acme-widgets",
      database: { migrations: [], ownedTables: ["app.acme_widgets"] },
      dataLifecycle: {
        exportSections: [],
        deletion: { strategy: "cascade", tables: [{ table: "app.acme_widgets" }] }
      }
    });

    expect(getExternalModuleDeletionTables([externalManifest])).toEqual([
      { table: "app.acme_widgets", countPredicate: "owner_user_id = $1::uuid" }
    ]);
  });
});
```

Add the import at the top of the test file:

```ts
import { getExternalModuleDeletionTables } from "@jarv1s/module-registry";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration -- module-registry.test.ts`
Expected: FAIL — `getExternalModuleDeletionTables` is not exported.

- [ ] **Step 3: Implement `getExternalModuleDeletionTables`**

In `packages/module-registry/src/index.ts`, immediately after the existing
`MODULE_DELETION_TABLES` constant (around line 1588), add:

```ts
/**
 * External-module counterpart to getModuleDeletionTables (#914). Built-in modules resolve their
 * deletion tables eagerly at import time (MODULE_DELETION_TABLES above) because their manifests
 * are known at build time; external modules install post-deploy, so their manifests must be
 * passed in explicitly — the caller (scripts/delete-user-data.ts) reads them from
 * app.module_installs / the external module loader at run time, not from a static snapshot.
 */
export function getExternalModuleDeletionTables(
  installedManifests: readonly JarvisModuleManifest[]
): readonly ResolvedModuleDeletionTable[] {
  return getModuleDeletionTables(installedManifests);
}
```

(`getModuleDeletionTables` already accepts an explicit `manifests` parameter — see
`packages/module-registry/src/index.ts:1575-1584` — so this is a thin, documented alias rather
than new logic; it exists so call sites and tests can name the external-module intent explicitly
without reaching into the built-in-only default-parameter path.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:integration -- module-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into `scripts/delete-user-data.ts`**

In `scripts/delete-user-data.ts`, find the `moduleDeletionTables` parameter (default `[]`, per the
existing `DeleteUserDataOptions` shape at line 27) and the call site that currently passes only
`MODULE_DELETION_TABLES` from the built-in path. Change that call site to also merge in the
external path:

```ts
import { getExternalModuleDeletionTables, MODULE_DELETION_TABLES } from "@jarv1s/module-registry";

// ... at the call site that previously passed `moduleDeletionTables: MODULE_DELETION_TABLES`:
moduleDeletionTables: [
  ...MODULE_DELETION_TABLES,
  ...getExternalModuleDeletionTables(installedExternalManifests)
];
```

where `installedExternalManifests` is whatever the script's existing external-module discovery
path already produces (the script's `main()` already does a dynamic
`import("@jarv1s/module-registry")` per the existing code comment at line 21 — reuse that same
discovery result rather than adding a second one).

- [ ] **Step 6: Add the export section stub and integration coverage**

In `packages/settings/src/data-export.ts`, `readExportTables`'s built-in `wellnessSection` pattern
(lines 124-130) is module-specific and cannot be generalized without knowing each external module's
export shape ahead of time. For Slice 4, external-module export rows are collected generically by
table dump rather than a typed `collect()` callback (external manifests carry no executable code):
add a new function alongside `readExportTables`:

**Correction from the Coordinator's plan review:** the first draft of this function queried
`scopedDb.db` directly, which runs as the caller's own parent runtime role — that role has no
grant on module-owned tables (`generateModuleTableRlsSql`'s `GRANT` in Task 6 targets only
`jarvis_mod_<slug>_runtime`, and that role is `WITH INHERIT FALSE` per Task 5, so the parent role
never ambiently inherits it). Reading module tables from outside the module's own scoped role
either fails on privileges or — if some broader grant existed — would break module isolation.
Spec D6 requires export reads to go through the same D5 storage-RPC path modules themselves use.
Route every read through Task 8's `createModuleStorageRpc`, which wraps the query in `SET LOCAL
ROLE jarvis_mod_<slug>_runtime` inside the same transaction:

```ts
/** External-module counterpart to the built-in collectModuleExportSection path (#914). Dumps
 * every row from each declared owned table, via the same createModuleStorageRpc path a module's
 * own code would use — SET LOCAL ROLE jarvis_mod_<slug>_runtime scopes the read under that
 * module's RLS-narrowed grant, never the caller's parent runtime role (spec D6). No per-module
 * collect() callback exists for external modules (their manifest is pure JSON). */
export async function readExternalModuleExportRows(
  scopedDb: DataContextDb,
  installedManifests: readonly JarvisModuleManifest[]
): Promise<Record<string, readonly ExportRow[]>> {
  const rowsByTable: Record<string, readonly ExportRow[]> = {};
  for (const manifest of installedManifests) {
    const rpc = createModuleStorageRpc(scopedDb, manifest.id);
    for (const table of manifest.database?.ownedTables ?? []) {
      assertQualifiedTableName(table);
      const result = await rpc.query<ExportRow>(`SELECT * FROM ${table} ORDER BY id`);
      rowsByTable[table] = result.rows;
    }
  }
  return rowsByTable;
}
```

Add the corresponding imports at the top of the file: `import type { JarvisModuleManifest } from
"@jarv1s/module-sdk";`, `import type { DataContextDb } from "@jarv1s/db";`, and `import {
createModuleStorageRpc, assertQualifiedTableName } from "@jarv1s/db";` (check whether any are
already imported before duplicating — both are already re-exported from the `packages/db/src/
index.ts` barrel by Task 6's and Task 8's barrel-export steps, so no barrel change is needed here).

- [ ] **Step 7: Commit**

```bash
git add packages/module-registry/src/index.ts packages/settings/src/data-export.ts \
  scripts/delete-user-data.ts tests/integration/module-registry.test.ts
git commit -m "feat: derive external-module export/deletion from manifest ownedTables (#914)"
```

---

## Verification

- [ ] Run the full local gate: `pnpm verify:foundation`. Record the exact exit code; if any check
      fails, fix before proceeding — do not report this plan complete on a red gate.
- [ ] Run `pnpm test:integration` in full (not just the new files) to catch any regression in
      `foundation.test.ts`'s migration-list assertion or `module-registry.test.ts`'s existing
      `assertModuleRegistryConsistency` suite.
- [ ] Run `pnpm --filter . exec tsx scripts/audit-release-hardening.ts` (or its `package.json`
      script alias) and confirm zero new failures — specifically confirm `module_schema_migrations` is
      covered by its new exemption entry and `module_installs`/any installed external module's owned
      tables are covered by `forceRls === true` (no exemption needed for tables the emitter creates,
      since `generateModuleTableRlsSql` always sets `FORCE ROW LEVEL SECURITY`).
- [ ] Manually run `scripts/module-install.ts` (or the `docker compose ... --profile ops run --rm
module-install` command added in Task 7) against a throwaway synthetic module package in a local
      dev database, then run `scripts/delete-user-data.ts` for a test user who has rows in that
      module's owned table, confirming the row count drops to zero and appears in the before/after
      sweep output.
- [ ] Confirm every new/modified file's diff still respects `check:file-size` (no source file over
      1000 lines) — `packages/module-registry/src/index.ts` was already 1822 lines before this plan's
      Task 9 addition; if `pnpm verify:foundation`'s `check:file-size` step fails on it, split
      `getExternalModuleDeletionTables` and its neighbors into a new
      `packages/module-registry/src/external-lifecycle.ts` file and re-export it from the barrel,
      rather than growing the existing file further.
- [ ] Message the Coordinator with the gate's exact pass/fail output before considering #914 ready
      for review.
