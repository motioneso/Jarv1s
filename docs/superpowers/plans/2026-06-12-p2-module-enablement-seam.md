# Implementation Plan: Module-enablement seam (docking ports)

**Plan for spec:** `docs/superpowers/specs/2026-06-12-p2-module-enablement-seam-docking-ports.md`
(Phase 2 epic #47 exit criterion #4; implements ADR 0009 §3–§4; supersedes issue #30).

**Grounded on:** local `main` at `a898533`. Highest applied migration prefix (global, across
`infra/postgres/migrations/` + every `packages/*/sql/`) is **`0064`**
(`packages/chat/sql/0064_chat_memory_facts_source_thread_idx.sql`) — so this slice's new
settings migration is **`0065`**. RE-CHECK at build time per the Hard Invariant (other in-flight
slices may land numbers concurrently); if `0065` is taken, use the next free global prefix and
keep the rest of the filename. Run `pnpm audit:preflight` and confirm it exits 0 before starting.

---

## Goal

Make module enablement real and load-bearing without rearchitecting the module model. Deliver the
four ADR 0009 §3 mechanisms: (1) a **deny-list enablement store** (`app.module_enablement`) with a
layered instance-floor + per-user resolver; (2) a **request-time route-enablement guard** keyed off
a boot-time index built from manifest `routes[]`; (3) a **`compatibility.jarv1s` compat gate**
validated against a `CORE_VERSION` constant at registration; and (4) **typed admin + self-service
enablement endpoints**. Day-one behavior change is **zero**: the migration inserts no rows, all 11
built-ins are `required:true` + `defaultEnabled:true` + `compatibility.jarv1s:">=0.0.0"`, so nothing
can be disabled and nothing is incompatible.

## Architecture

- **Storage + resolver + guard, not a contract change.** Manifests are structurally unchanged; we
  make three inert fields (`availability.*`, `compatibility.jarv1s`, `routes[]`) load-bearing and add
  one table.
- **Enablement = two layered deny-lists.** A row means "disabled"; absence means "enabled" (honoring
  `availability.defaultEnabled`, `true` for all 11 today). Instance rows (admin-controlled) are a hard
  floor; per-user rows refine on top. `required:true` modules can never be disabled (triple-guarded:
  resolver, both endpoints). `supportsUserDisable:false` blocks a per-user disable but an instance
  disable still applies (unless required).
- **Resolver becomes async.** `ActiveModulesResolver` flips from sync
  `(actorUserId) => readonly JarvisModuleManifest[]` to async
  `(actorUserId) => Promise<readonly JarvisModuleManifest[]>`, reading the deny-list under
  `withDataContext` so per-user rows are RLS-scoped to the actor. This ripples through the MCP gateway,
  chat token-mint path, AI REST tools surface, module-registry wiring, and `apps/api/src/server.ts`.
- **Routes guarded per-request.** Fastify routes register once at boot, so a single `onRequest` hook
  maps `method + matched-route-pattern` to its owning module via the boot-time `routes[]` index and
  returns **404** (never 403 — do not leak module existence) if that module is not active. A boot-time
  coverage assertion fails startup if any registered route is neither claimed by a manifest `routes[]`
  entry nor on an explicit platform/unguarded allowlist.
- **Compat gated at registration.** `module-sdk` exports `CORE_VERSION` + a hand-rolled
  `satisfiesCoreVersion(range, version?)` (no `semver` dependency — module-sdk depends only on
  `fastify`). `module-registry` refuses any built-in whose range does not admit `CORE_VERSION` before
  wiring its routes/workers/tools.

## Tech Stack

TypeScript (ESM, NodeNext), Fastify 5, Kysely + Postgres 17 (pgvector image), Vitest integration
tests against the `pnpm db:up` Postgres, pnpm workspaces. Branded `DataContextDb` + RLS per-actor
GUC (`app.actor_user_id`). No new runtime dependencies.

---

## File Structure

**New files:**

| Path | Purpose |
| --- | --- |
| `packages/module-sdk/src/core-version.ts` | `CORE_VERSION` const + `satisfiesCoreVersion()` helper |
| `packages/module-sdk/test/core-version.test.ts` | Unit test for `satisfiesCoreVersion` |
| `packages/settings/sql/0065_module_enablement.sql` | Creates `app.module_enablement`, indexes, RLS, grants (re-check prefix at build) |
| `packages/module-registry/src/active-modules-resolver.ts` | `createActiveModulesResolver` factory (async resolver) |
| `packages/module-registry/src/compat-gate.ts` | `assertModulesCompatible()` — compat + `defaultEnabled` validation at registration |
| `packages/module-registry/src/route-guard.ts` | Route→module index, `registerRouteEnablementGuard`, `assertRouteCoverage`, `PLATFORM_UNGUARDED_ROUTES` |
| `tests/integration/module-enablement.test.ts` | Resolver + repository + RLS isolation tests |
| `tests/integration/route-guard.test.ts` | Guard 404/200 + coverage-assertion + endpoint tests |
| `tests/integration/fixtures/optional-module.ts` | Test-only non-required / user-disablable manifest fixture mounting a real route |

**Modified files:**

| Path | Change |
| --- | --- |
| `packages/module-sdk/src/index.ts` | `export * from "./core-version.js";` |
| `packages/ai/src/gateway/types.ts` | `ActiveModulesResolver` → async; update doc comment |
| `packages/ai/src/gateway/gateway.ts` | `executableTools`, `listToolsForActor` async; `callTool` awaits |
| `packages/chat/src/routes.ts` | `mint` callback async; awaits `listToolsForActor` |
| `packages/chat/src/live/runtime.ts` | `mcpTokenLifecycle.mint` type → async |
| `packages/chat/src/live/chat-session-manager.ts` | `mintMcpToken` dep type → async; `launchSession` awaits |
| `packages/ai/src/routes.ts` | Swap `listModuleManifests` → `resolveActiveModules` (async) on the tool surfaces |
| `packages/settings/src/repository.ts` | 4 new deny-list methods on `SettingsRepository` |
| `packages/settings/src/manifest.ts` | Export `settingsModuleSqlMigrationDirectory`; add admin/self route entries |
| `packages/settings/src/routes.ts` | Admin + self enablement endpoints |
| `packages/db/src/types.ts` | `ModuleEnablementTable` + `JarvisDatabase` entry + `ModuleEnablementRow` export |
| `packages/shared/src/platform-api.ts` | New DTOs + route schemas for admin/self module endpoints |
| `packages/module-registry/src/index.ts` | Compat gate call; `resolveActiveModules` in deps + chat wiring; export new modules |
| `packages/tasks/src/manifest.ts` | Add 3 undeclared routes to `routes[]` (preferences GET/PATCH, subtasks GET) |
| `packages/chat/src/manifest.ts` | Add 8 undeclared API routes to `routes[]` |
| `apps/api/src/server.ts` | Construct resolver; pass it in; register guard + coverage assertion after routes |
| `tests/integration/mcp-gateway.test.ts` | Wrap stub resolvers in `async` |
| `tests/integration/chat-mcp-transport.test.ts` | Wrap stub resolver in `async` (if present) |

---

## Conventions for every task

- **TDD order, no exceptions:** write the failing test → run it and SEE it fail → write the minimal
  implementation (COMPLETE code, no placeholders) → run and SEE it pass → commit with an explicit
  `git add <paths>` listing only the files this task touched. NEVER `git add -A` / `git add .`
  (another session may share the tree — Hard Invariant).
- **DB tests need Postgres:** `pnpm db:up` must be running. Migration-touching tasks run
  `pnpm db:migrate` (idempotent) before the integration test.
- **Single-file test runs:** `vitest run <path>` for fast iteration; the final gate task runs the
  whole suite.
- Commit messages use the conventional-commit style and end with the Co-Authored-By trailer the
  repo requires.

---

## Task 1 — `CORE_VERSION` + `satisfiesCoreVersion` in `@jarv1s/module-sdk`

**Files**
- Create: `packages/module-sdk/src/core-version.ts`
- Create: `packages/module-sdk/test/core-version.test.ts`
- Modify: `packages/module-sdk/src/index.ts`

### Step 1.1 — Write the failing test

Create `packages/module-sdk/test/core-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { CORE_VERSION, satisfiesCoreVersion } from "../src/core-version.js";

describe("CORE_VERSION", () => {
  it("is the single source of truth for the module-API version", () => {
    expect(CORE_VERSION).toBe("0.1.0");
  });
});

describe("satisfiesCoreVersion", () => {
  it("admits every range form in use today (defaults to CORE_VERSION)", () => {
    expect(satisfiesCoreVersion(">=0.0.0")).toBe(true);
    expect(satisfiesCoreVersion("0.1.0")).toBe(true);
    expect(satisfiesCoreVersion(">=0.1.0")).toBe(true);
    expect(satisfiesCoreVersion("*")).toBe(true);
  });

  it("supports the comparator forms a near-future module needs", () => {
    expect(satisfiesCoreVersion(">0.0.9", "0.1.0")).toBe(true);
    expect(satisfiesCoreVersion("<0.2.0", "0.1.0")).toBe(true);
    expect(satisfiesCoreVersion("<=0.1.0", "0.1.0")).toBe(true);
    expect(satisfiesCoreVersion("=0.1.0", "0.1.0")).toBe(true);
    expect(satisfiesCoreVersion(">=0.1.0", "0.1.0")).toBe(true);
  });

  it("rejects ranges that exclude the version", () => {
    expect(satisfiesCoreVersion(">=9.0.0", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("<0.1.0", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion(">0.1.0", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("=0.2.0", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("0.2.0", "0.1.0")).toBe(false);
  });

  it("fails closed on unparseable / unsupported ranges", () => {
    expect(satisfiesCoreVersion("", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("garbage", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("^0.1.0", "0.1.0")).toBe(false); // caret unsupported
    expect(satisfiesCoreVersion("~0.1.0", "0.1.0")).toBe(false); // tilde unsupported
    expect(satisfiesCoreVersion(">=0.1", "0.1.0")).toBe(false); // not major.minor.patch
    expect(satisfiesCoreVersion(">=0.1.0 || <0.0.1", "0.1.0")).toBe(false); // OR unsupported
  });
});
```

### Step 1.2 — Run (expected FAIL)

```
pnpm --filter @jarv1s/module-sdk exec vitest run test/core-version.test.ts
```

Expect failure: `Cannot find module '../src/core-version.js'`.

### Step 1.3 — Minimal implementation

Create `packages/module-sdk/src/core-version.ts`:

```ts
/**
 * The platform's module-API version. The single source of truth a module's
 * `compatibility.jarv1s` range is gated against at registration (ADR 0009 §3).
 * Bump this when the module contract changes in a way a module could declare
 * incompatibility with.
 */
export const CORE_VERSION = "0.1.0";

/** A parsed major.minor.patch triple. */
interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(value: string): SemVer | null {
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

/** Returns negative if a<b, 0 if equal, positive if a>b. */
function compare(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Does `range` admit `version` (defaults to CORE_VERSION)? Supports exactly the
 * forms in use plus the small set a near-future module needs: a bare exact version
 * ("0.1.0"), the wildcard "*", and the comparator forms >=, >, <=, <, = against a
 * single major.minor.patch. This is deliberately NOT full node-semver — ADR 0009 §5
 * skips per-module semver ranges. Unparseable or unsupported ranges return false
 * (fail closed).
 */
export function satisfiesCoreVersion(range: string, version: string = CORE_VERSION): boolean {
  const target = parseVersion(version);
  if (!target) return false;

  const trimmed = range.trim();
  if (trimmed === "*") return true;

  const comparatorMatch = /^(>=|<=|>|<|=)\s*(.+)$/.exec(trimmed);
  if (comparatorMatch) {
    const operator = comparatorMatch[1];
    const operand = parseVersion(comparatorMatch[2]!);
    if (!operand) return false;
    const cmp = compare(target, operand);
    switch (operator) {
      case ">=":
        return cmp >= 0;
      case "<=":
        return cmp <= 0;
      case ">":
        return cmp > 0;
      case "<":
        return cmp < 0;
      case "=":
        return cmp === 0;
      default:
        return false;
    }
  }

  // Bare exact version.
  const bare = parseVersion(trimmed);
  if (bare) return compare(target, bare) === 0;

  return false;
}
```

Append to `packages/module-sdk/src/index.ts` (after the existing `sessionRateLimitKey` re-export
near the top):

```ts
export { CORE_VERSION, satisfiesCoreVersion } from "./core-version.js";
```

### Step 1.4 — Run (expected PASS)

```
pnpm --filter @jarv1s/module-sdk exec vitest run test/core-version.test.ts
```

All cases green.

### Step 1.5 — Commit

```
git add packages/module-sdk/src/core-version.ts packages/module-sdk/test/core-version.test.ts packages/module-sdk/src/index.ts
git commit -m "feat(module-sdk): add CORE_VERSION + satisfiesCoreVersion compat helper"
```

---

## Task 2 — `app.module_enablement` migration + db types

**Files**
- Create: `packages/settings/sql/0065_module_enablement.sql`
- Modify: `packages/settings/src/manifest.ts` (export `settingsModuleSqlMigrationDirectory`)
- Modify: `packages/module-registry/src/index.ts` (wire the settings SQL dir)
- Modify: `packages/db/src/types.ts` (`ModuleEnablementTable` + `JarvisDatabase` entry + `ModuleEnablementRow`)
- Create: `tests/integration/module-enablement.test.ts` (migration-applies assertion only in this task)

### Step 2.1 — Write the failing test

Create `tests/integration/module-enablement.test.ts` with the migration-shape assertion (resolver
tests are added in Task 6):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("module-enablement store (app.module_enablement)", () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates the table with the expected columns", async () => {
    const result = await client.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'module_enablement'
        ORDER BY column_name`
    );
    const columns = result.rows.map((r) => r.column_name);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "scope",
        "module_id",
        "user_id",
        "disabled_by_user_id",
        "created_at",
        "updated_at"
      ])
    );
  });

  it("enforces the scope/user_id consistency check", async () => {
    // scope='instance' must have NULL user_id
    await expect(
      client.query(
        `INSERT INTO app.module_enablement (scope, module_id, user_id) VALUES ('instance', 'x', $1)`,
        ["00000000-0000-4000-8000-000000000099"]
      )
    ).rejects.toThrow();
    // scope='user' must have a non-NULL user_id
    await expect(
      client.query(
        `INSERT INTO app.module_enablement (scope, module_id, user_id) VALUES ('user', 'x', NULL)`
      )
    ).rejects.toThrow();
  });

  it("enforces the partial unique indexes", async () => {
    await client.query(
      `INSERT INTO app.module_enablement (scope, module_id) VALUES ('instance', 'dup-instance')`
    );
    await expect(
      client.query(
        `INSERT INTO app.module_enablement (scope, module_id) VALUES ('instance', 'dup-instance')`
      )
    ).rejects.toThrow();
    await client.query(`DELETE FROM app.module_enablement WHERE module_id = 'dup-instance'`);
  });

  it("FORCE ROW LEVEL SECURITY is enabled", async () => {
    const result = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE oid = 'app.module_enablement'::regclass`
    );
    expect(result.rows[0]?.relrowsecurity).toBe(true);
    expect(result.rows[0]?.relforcerowsecurity).toBe(true);
  });
});
```

### Step 2.2 — Run (expected FAIL)

```
pnpm db:up
vitest run tests/integration/module-enablement.test.ts
```

Expect failure: `relation "app.module_enablement" does not exist` (the migration dir is not wired
yet, so `resetEmptyFoundationDatabase` does not create the table).

### Step 2.3 — Minimal implementation

**(a)** Create `packages/settings/sql/0065_module_enablement.sql` (re-check the `0065` prefix is the
next free GLOBAL number at build time; if taken, rename to the next free prefix):

```sql
-- Module-enablement seam (ADR 0009 §3): a deny-list of disabled modules.
-- A row's PRESENCE means "disabled"; absence means "enabled" (honoring the
-- manifest's availability.defaultEnabled, true for all built-ins today). Two scopes:
--   * scope='instance' (user_id NULL): admin-controlled hard floor for all actors.
--   * scope='user' (user_id NOT NULL): owner-scoped per-user refinement.
-- The migration inserts NO rows, so the live surface is byte-for-byte unchanged.
--
-- RLS mirrors instance_settings (0059): instance rows readable by all authed actors
-- so the resolver sees the floor; instance writes admin-only; user rows owner-only.
-- All statements are idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS app.module_enablement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('instance', 'user')),
  module_id text NOT NULL,
  user_id uuid NULL REFERENCES app.users(id) ON DELETE CASCADE,
  disabled_by_user_id uuid NULL REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_enablement_scope_user_ck CHECK (
    (scope = 'instance' AND user_id IS NULL)
    OR (scope = 'user' AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS module_enablement_instance_uq
  ON app.module_enablement (module_id) WHERE scope = 'instance';

CREATE UNIQUE INDEX IF NOT EXISTS module_enablement_user_uq
  ON app.module_enablement (module_id, user_id) WHERE scope = 'user';

ALTER TABLE app.module_enablement ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.module_enablement FORCE ROW LEVEL SECURITY;

-- Instance rows: readable by all authed actors (resolver floor); writes admin-only.
DROP POLICY IF EXISTS module_enablement_instance_select ON app.module_enablement;
CREATE POLICY module_enablement_instance_select ON app.module_enablement
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (scope = 'instance');

DROP POLICY IF EXISTS module_enablement_instance_insert ON app.module_enablement;
CREATE POLICY module_enablement_instance_insert ON app.module_enablement
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (scope = 'instance' AND app.current_actor_is_admin());

DROP POLICY IF EXISTS module_enablement_instance_update ON app.module_enablement;
CREATE POLICY module_enablement_instance_update ON app.module_enablement
  FOR UPDATE TO jarvis_app_runtime
  USING (scope = 'instance' AND app.current_actor_is_admin())
  WITH CHECK (scope = 'instance' AND app.current_actor_is_admin());

DROP POLICY IF EXISTS module_enablement_instance_delete ON app.module_enablement;
CREATE POLICY module_enablement_instance_delete ON app.module_enablement
  FOR DELETE TO jarvis_app_runtime
  USING (scope = 'instance' AND app.current_actor_is_admin());

-- User rows: owner-only (the actor can only see/write their own per-user deny rows).
DROP POLICY IF EXISTS module_enablement_user_select ON app.module_enablement;
CREATE POLICY module_enablement_user_select ON app.module_enablement
  FOR SELECT TO jarvis_app_runtime
  USING (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  );

DROP POLICY IF EXISTS module_enablement_user_insert ON app.module_enablement;
CREATE POLICY module_enablement_user_insert ON app.module_enablement
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  );

DROP POLICY IF EXISTS module_enablement_user_update ON app.module_enablement;
CREATE POLICY module_enablement_user_update ON app.module_enablement
  FOR UPDATE TO jarvis_app_runtime
  USING (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  )
  WITH CHECK (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  );

DROP POLICY IF EXISTS module_enablement_user_delete ON app.module_enablement;
CREATE POLICY module_enablement_user_delete ON app.module_enablement
  FOR DELETE TO jarvis_app_runtime
  USING (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON app.module_enablement TO jarvis_app_runtime;
GRANT SELECT ON app.module_enablement TO jarvis_worker_runtime;
```

**(b)** Modify `packages/settings/src/manifest.ts`. Add the `fileURLToPath` import and the exported
dir constant at the top (mirroring `tasksModuleSqlMigrationDirectory`):

Change the imports block at the top of the file from:

```ts
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
```

to:

```ts
import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

export const settingsModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));
```

**(c)** Modify `packages/module-registry/src/index.ts`. Update the settings import and its
`BUILT_IN_MODULES` entry. Change:

```ts
import { registerSettingsRoutes, settingsModuleManifest } from "@jarv1s/settings";
```

to:

```ts
import {
  registerSettingsRoutes,
  settingsModuleManifest,
  settingsModuleSqlMigrationDirectory
} from "@jarv1s/settings";
```

and change the settings entry from:

```ts
  {
    manifest: settingsModuleManifest,
    sqlMigrationDirectories: [],
    queueDefinitions: [],
    registerRoutes: registerSettingsRoutes
  },
```

to:

```ts
  {
    manifest: settingsModuleManifest,
    sqlMigrationDirectories: [settingsModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: registerSettingsRoutes
  },
```

**(d)** Modify `packages/db/src/types.ts`. Add the table interface immediately after
`AdminAuditEventsTable` (after line 111):

```ts
export interface ModuleEnablementTable {
  id: ColumnType<string, string | undefined, string>;
  scope: "instance" | "user";
  module_id: string;
  user_id: string | null;
  disabled_by_user_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}
```

Add to the `JarvisDatabase` interface, immediately after the `"app.admin_audit_events"` line:

```ts
  "app.module_enablement": ModuleEnablementTable;
```

Add the `Selectable` export, immediately after `export type AdminAuditEvent = ...`:

```ts
export type ModuleEnablementRow = Selectable<ModuleEnablementTable>;
```

### Step 2.4 — Run (expected PASS)

```
pnpm db:migrate   # applies 0065 idempotently; re-run once more to prove idempotency
pnpm db:migrate
vitest run tests/integration/module-enablement.test.ts
pnpm --filter @jarv1s/db exec tsc --noEmit
```

The migration-shape tests pass; the second `db:migrate` reports the file as already-current (proves
idempotency); db typecheck passes.

### Step 2.5 — Commit

```
git add packages/settings/sql/0065_module_enablement.sql packages/settings/src/manifest.ts packages/module-registry/src/index.ts packages/db/src/types.ts tests/integration/module-enablement.test.ts
git commit -m "feat(settings): add app.module_enablement deny-list table, RLS, and db types"
```

---

## Task 3 — `SettingsRepository` deny-list methods

**Files**
- Modify: `packages/settings/src/repository.ts`
- Modify: `tests/integration/module-enablement.test.ts` (add a repository describe block)

### Step 3.1 — Write the failing test

Append a new `describe` block to `tests/integration/module-enablement.test.ts`. Add these imports
to the top of the file (alongside the existing `pg` import):

```ts
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import { SettingsRepository } from "../../packages/settings/src/repository.js";
import { ids } from "./test-database.js";
```

(Adjust the existing `resetEmptyFoundationDatabase` import line to also import `ids` if cleaner —
`ids` is already exported from `./test-database.js`.) Then append:

```ts
describe("SettingsRepository deny-list methods", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repo: SettingsRepository;

  beforeAll(async () => {
    // resetFoundationDatabase seeds userA, userB, adminUser (see test-database.ts).
    const { resetFoundationDatabase } = await import("./test-database.js");
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runner = new DataContextRunner(appDb);
    repo = new SettingsRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("admin can disable then re-enable a module at instance scope (and audit is written)", async () => {
    await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-admin-1" },
      (db) =>
        repo.setInstanceModuleDisabled(db, {
          moduleId: "weather",
          disabled: true,
          actorUserId: ids.adminUser,
          requestId: "req-admin-1"
        })
    );

    const afterDisable = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-a-1" },
      (db) => repo.listModuleDenyRowsForActor(db)
    );
    expect(afterDisable.some((r) => r.scope === "instance" && r.module_id === "weather")).toBe(true);

    // Idempotent disable (insert-on-conflict-do-nothing) does not throw or duplicate.
    await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-admin-2" },
      (db) =>
        repo.setInstanceModuleDisabled(db, {
          moduleId: "weather",
          disabled: true,
          actorUserId: ids.adminUser,
          requestId: "req-admin-2"
        })
    );

    await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-admin-3" },
      (db) =>
        repo.setInstanceModuleDisabled(db, {
          moduleId: "weather",
          disabled: false,
          actorUserId: ids.adminUser,
          requestId: "req-admin-3"
        })
    );

    const afterEnable = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-a-2" },
      (db) => repo.listModuleDenyRowsForActor(db)
    );
    expect(afterEnable.some((r) => r.scope === "instance" && r.module_id === "weather")).toBe(false);

    const audit = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-admin-4" },
      (db) => repo.listAdminAuditEvents(db)
    );
    const actions = audit.map((e) => e.action);
    expect(actions).toContain("module.instance_disable");
    expect(actions).toContain("module.instance_enable");
  });

  it("user deny rows are owner-scoped (RLS isolates actors)", async () => {
    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-a-3" },
      (db) =>
        repo.setUserModuleDisabled(db, {
          moduleId: "weather",
          disabled: true,
          actorUserId: ids.userA,
          requestId: "req-a-3"
        })
    );

    const aRows = await runner.withDataContext(
      { actorUserId: ids.userA, requestId: "req-a-4" },
      (db) => repo.listModuleDenyRowsForActor(db)
    );
    expect(aRows.some((r) => r.scope === "user" && r.module_id === "weather")).toBe(true);

    const bRows = await runner.withDataContext(
      { actorUserId: ids.userB, requestId: "req-b-1" },
      (db) => repo.listModuleDenyRowsForActor(db)
    );
    expect(bRows.some((r) => r.scope === "user" && r.module_id === "weather")).toBe(false);
  });

  it("listInstanceModuleDenyRows returns instance rows only", async () => {
    await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-admin-5" },
      (db) =>
        repo.setInstanceModuleDisabled(db, {
          moduleId: "wellness",
          disabled: true,
          actorUserId: ids.adminUser,
          requestId: "req-admin-5"
        })
    );
    const rows = await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: "req-admin-6" },
      (db) => repo.listInstanceModuleDenyRows(db)
    );
    expect(rows.every((r) => r.scope === "instance")).toBe(true);
    expect(rows.some((r) => r.module_id === "wellness")).toBe(true);
  });
});
```

### Step 3.2 — Run (expected FAIL)

```
vitest run tests/integration/module-enablement.test.ts
```

Expect failure: `repo.setInstanceModuleDisabled is not a function` (methods not yet defined).

### Step 3.3 — Minimal implementation

In `packages/settings/src/repository.ts`, add the input types (after the existing
`RegistrationSettings` interface, before `HttpRepositoryError`):

```ts
export interface SetModuleDisabledInput {
  readonly moduleId: string;
  readonly disabled: boolean;
  readonly actorUserId: string;
  readonly requestId: string;
}
```

Add the import for `ModuleEnablementRow` to the existing `@jarv1s/db` type import:

Change:

```ts
import type { AdminAuditEvent, InstanceSetting, User } from "@jarv1s/db";
```

to:

```ts
import type { AdminAuditEvent, InstanceSetting, ModuleEnablementRow, User } from "@jarv1s/db";
```

Add the four methods inside the `SettingsRepository` class (e.g. after `listInstanceSettings`):

```ts
  /**
   * All deny rows VISIBLE to the actor under RLS: instance rows (readable by all
   * authed actors — the floor) plus this actor's own user rows (owner-only). Used by
   * the resolver. One SELECT; RLS does the scoping.
   */
  async listModuleDenyRowsForActor(scopedDb: DataContextDb): Promise<ModuleEnablementRow[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.module_enablement")
      .selectAll()
      .orderBy("scope")
      .orderBy("module_id")
      .execute();
  }

  /** Instance rows only (admin GET surface). RLS returns only scope='instance'. */
  async listInstanceModuleDenyRows(scopedDb: DataContextDb): Promise<ModuleEnablementRow[]> {
    assertDataContextDb(scopedDb);
    return scopedDb.db
      .selectFrom("app.module_enablement")
      .selectAll()
      .where("scope", "=", "instance")
      .orderBy("module_id")
      .execute();
  }

  /**
   * Admin: insert (disable) or delete (enable) the instance-scope deny row for a
   * module. Insert is on-conflict-do-nothing (idempotent). Writes an admin audit
   * event recording only the module id + actor + requestId (metadata-only invariant).
   */
  async setInstanceModuleDisabled(
    scopedDb: DataContextDb,
    input: SetModuleDisabledInput
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    if (input.disabled) {
      await scopedDb.db
        .insertInto("app.module_enablement")
        .values({
          scope: "instance",
          module_id: input.moduleId,
          user_id: null,
          disabled_by_user_id: input.actorUserId,
          created_at: new Date(),
          updated_at: new Date()
        })
        .onConflict((oc) => oc.columns(["module_id"]).where("scope", "=", "instance").doNothing())
        .execute();
    } else {
      await scopedDb.db
        .deleteFrom("app.module_enablement")
        .where("scope", "=", "instance")
        .where("module_id", "=", input.moduleId)
        .execute();
    }

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action: input.disabled ? "module.instance_disable" : "module.instance_enable",
      targetType: "module",
      targetId: input.moduleId,
      metadata: { moduleId: input.moduleId },
      requestId: input.requestId
    });
  }

  /**
   * Owner-scoped: insert (disable) or delete (enable) the actor's own user-scope deny
   * row. Self-service is not an admin act — no admin-audit row. RLS WITH CHECK enforces
   * user_id = current actor, so an actor can only ever write their own row.
   */
  async setUserModuleDisabled(
    scopedDb: DataContextDb,
    input: SetModuleDisabledInput
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    if (input.disabled) {
      await scopedDb.db
        .insertInto("app.module_enablement")
        .values({
          scope: "user",
          module_id: input.moduleId,
          user_id: input.actorUserId,
          disabled_by_user_id: input.actorUserId,
          created_at: new Date(),
          updated_at: new Date()
        })
        .onConflict((oc) =>
          oc.columns(["module_id", "user_id"]).where("scope", "=", "user").doNothing()
        )
        .execute();
    } else {
      await scopedDb.db
        .deleteFrom("app.module_enablement")
        .where("scope", "=", "user")
        .where("module_id", "=", input.moduleId)
        .where("user_id", "=", input.actorUserId)
        .execute();
    }
  }
```

> Note on the partial-unique `onConflict`: Kysely's `onConflict(...).columns([...]).where(...)`
> targets a partial unique index. If the typecheck or runtime rejects the `.where` arm on
> `onConflict`, fall back to a guard-then-insert inside the same method (SELECT existing → skip
> insert if present) — the method is already inside `withDataContext`'s transaction, so the
> check-then-insert is atomic under the actor's RLS scope. Prefer the `onConflict` form; use the
> fallback only if Kysely's typing blocks it.

### Step 3.4 — Run (expected PASS)

```
vitest run tests/integration/module-enablement.test.ts
pnpm --filter @jarv1s/settings exec tsc --noEmit
```

### Step 3.5 — Commit

```
git add packages/settings/src/repository.ts tests/integration/module-enablement.test.ts
git commit -m "feat(settings): add module-enablement deny-list repository methods"
```

---

## Task 4 — Compat gate in `@jarv1s/module-registry`

**Files**
- Create: `packages/module-registry/src/compat-gate.ts`
- Modify: `packages/module-registry/src/index.ts` (call the gate at module-load time)
- Create: `packages/module-registry/test/compat-gate.test.ts`

### Step 4.1 — Write the failing test

Create `packages/module-registry/test/compat-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { CORE_VERSION } from "@jarv1s/module-sdk";

import { assertModulesCompatible } from "../src/compat-gate.js";
import { getBuiltInModuleManifests } from "../src/index.js";

function manifest(overrides: Partial<JarvisModuleManifest>): JarvisModuleManifest {
  return {
    id: "fixture",
    name: "Fixture",
    version: "0.0.0",
    publisher: "test",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.0.0" },
    availability: { defaultEnabled: true },
    ...overrides
  };
}

describe("assertModulesCompatible", () => {
  it("passes every built-in module (all >=0.0.0 admit CORE_VERSION)", () => {
    expect(() => assertModulesCompatible(getBuiltInModuleManifests())).not.toThrow();
  });

  it("throws naming the module, range, and CORE_VERSION when a range excludes CORE_VERSION", () => {
    expect(() =>
      assertModulesCompatible([manifest({ id: "future", compatibility: { jarv1s: ">=9.0.0" } })])
    ).toThrow(/future/);
    expect(() =>
      assertModulesCompatible([manifest({ id: "future", compatibility: { jarv1s: ">=9.0.0" } })])
    ).toThrow(new RegExp(CORE_VERSION.replace(/\./g, "\\.")));
  });

  it("rejects a built-in that is not defaultEnabled (forward seam is out of scope)", () => {
    expect(() =>
      assertModulesCompatible([manifest({ id: "off", availability: { defaultEnabled: false } })])
    ).toThrow(/defaultEnabled/);
  });
});
```

### Step 4.2 — Run (expected FAIL)

```
pnpm --filter @jarv1s/module-registry exec vitest run test/compat-gate.test.ts
```

Expect failure: `Cannot find module '../src/compat-gate.js'`.

### Step 4.3 — Minimal implementation

Create `packages/module-registry/src/compat-gate.ts`:

```ts
import { CORE_VERSION, satisfiesCoreVersion, type JarvisModuleManifest } from "@jarv1s/module-sdk";

/**
 * Validate-then-enable at the composition root (ADR 0009 §3): refuse to wire any
 * built-in whose compatibility.jarv1s range does not admit CORE_VERSION, BEFORE its
 * routes/workers/tools register (the module's code never executes if it is rejected).
 *
 * Also asserts the deny-only store's precondition: every built-in must be
 * defaultEnabled:true. A defaultEnabled:false module would need an allow-row
 * mechanism the deny-only store does not provide (out of scope — see the spec),
 * so it is rejected here rather than silently mis-resolved.
 */
export function assertModulesCompatible(manifests: readonly JarvisModuleManifest[]): void {
  for (const manifest of manifests) {
    const range = manifest.compatibility.jarv1s;
    if (!satisfiesCoreVersion(range)) {
      throw new Error(
        `Module "${manifest.id}" declares compatibility.jarv1s "${range}", which is not ` +
          `compatible with platform CORE_VERSION ${CORE_VERSION}. Refusing to register it.`
      );
    }
    if (manifest.availability?.defaultEnabled !== true) {
      throw new Error(
        `Module "${manifest.id}" must declare availability.defaultEnabled: true. The module ` +
          `enablement store is deny-only; defaultEnabled:false (allow-list semantics) is out of scope.`
      );
    }
  }
}
```

In `packages/module-registry/src/index.ts`, import the gate and invoke it at module-evaluation time
so an incompatible built-in fails at load (before `getBuiltInModuleManifests`/`registerBuiltInApiRoutes`
can run). Add the import near the other local imports:

```ts
import { assertModulesCompatible } from "./compat-gate.js";
```

and add, immediately AFTER the `BUILT_IN_MODULES` array literal (after the closing `];` near
line 181):

```ts
// Compat gate (ADR 0009 §3): validate every built-in's compatibility.jarv1s against
// CORE_VERSION at load time, before any registration path runs. Throws if a module is
// incompatible or not defaultEnabled, naming the offender.
assertModulesCompatible(BUILT_IN_MODULES.map((module) => module.manifest));
```

### Step 4.4 — Run (expected PASS)

```
pnpm --filter @jarv1s/module-registry exec vitest run test/compat-gate.test.ts
pnpm --filter @jarv1s/module-registry exec tsc --noEmit
```

### Step 4.5 — Commit

```
git add packages/module-registry/src/compat-gate.ts packages/module-registry/src/index.ts packages/module-registry/test/compat-gate.test.ts
git commit -m "feat(module-registry): gate module registration on CORE_VERSION compat"
```

---

## Task 5 — Flip `ActiveModulesResolver` to async (gateway + chat ripple)

This task makes the type change and updates the gateway + chat call sites, keeping the existing
behavior (the resolver stub in tests just returns a Promise). The real DB-backed resolver factory
is Task 6.

**Files**
- Modify: `packages/ai/src/gateway/types.ts`
- Modify: `packages/ai/src/gateway/gateway.ts`
- Modify: `packages/chat/src/routes.ts`
- Modify: `packages/chat/src/live/runtime.ts`
- Modify: `packages/chat/src/live/chat-session-manager.ts`
- Modify: `tests/integration/mcp-gateway.test.ts`
- Modify: `tests/integration/chat-mcp-transport.test.ts` (only if it constructs a resolver — verify)

### Step 5.1 — Write the failing test

Update the existing gateway test to expect async. In `tests/integration/mcp-gateway.test.ts`, change
the two stub resolvers to async and assert `listToolsForActor` returns a Promise:

- Change line 52 from `resolveActiveModules: () => [exampleToolModule],` to
  `resolveActiveModules: async () => [exampleToolModule],`.
- Change line 232 from
  `resolveActiveModules: (actorUserId) => (actorUserId === ids.userA ? [exampleToolModule] : []),`
  to
  `resolveActiveModules: async (actorUserId) => (actorUserId === ids.userA ? [exampleToolModule] : []),`.
- Update the "lists only tools that have an execute handler" test (line ~62) to await:

```ts
  it("lists only tools that have an execute handler", async () => {
    const names = (await gateway.listToolsForActor(ids.userA)).map((tool) => tool.name);
    expect(names).toContain("example.read");
    expect(names).toContain("example.write");
    expect(names).toContain("example.destroy");
    expect(names).not.toContain("example.declaration-only");
  });
```

- For the scoped-gateway test near line 228 that calls `listToolsForActor`, add `await` to those
  call sites too (search the file for every `.listToolsForActor(` and `await` it; the function is
  now async).

### Step 5.2 — Run (expected FAIL)

```
vitest run tests/integration/mcp-gateway.test.ts
```

Expect failure: `gateway.listToolsForActor(...).map is not a function` (it now returns a Promise) —
OR a type error if run through tsc; the runtime failure confirms the test now demands async.

### Step 5.3 — Minimal implementation

**(a)** `packages/ai/src/gateway/types.ts` — change the type and doc comment:

```ts
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

/**
 * Resolves the modules whose tools are exposed for a user. The enablement SEAM
 * (ADR 0009 §3): the real resolver (createActiveModulesResolver in
 * @jarv1s/module-registry) reads the app.module_enablement deny-list under
 * withDataContext, so a disabled module's tools vanish from the surface with no
 * change to the gateway or any module. Async because it does a DB round-trip.
 */
export type ActiveModulesResolver = (
  actorUserId: string
) => Promise<readonly JarvisModuleManifest[]>;
```

(Leave the rest of the file — `GatewaySessionRecord`, `SessionNotifier`, `GatewayToolResponse` —
unchanged.)

**(b)** `packages/ai/src/gateway/gateway.ts` — make `executableTools`, `listToolsForActor` async and
have `callTool` await:

- `listToolsForActor` (line 46–49):

```ts
  /** Returns only tools executable by this actor (via resolveActiveModules). */
  async listToolsForActor(actorUserId: string): Promise<AiAssistantToolDto[]> {
    return (await this.executableTools(actorUserId)).map((entry) => entry.dto);
  }
```

- `callTool` line 55 — change:

```ts
    const found = this.executableTools(actorUserId).find((entry) => entry.tool.name === toolName);
```

to:

```ts
    const found = (await this.executableTools(actorUserId)).find(
      (entry) => entry.tool.name === toolName
    );
```

- `executableTools` (line 180) — make async and await the resolver:

```ts
  private async executableTools(actorUserId: string): Promise<ExecutableTool[]> {
    const modules: readonly JarvisModuleManifest[] =
      await this.deps.resolveActiveModules(actorUserId);
    const out: ExecutableTool[] = [];
    for (const module of modules) {
      for (const tool of module.assistantTools ?? []) {
        if (typeof tool.execute !== "function") {
          continue;
        }
        out.push({
          tool,
          execute: tool.execute,
          dto: {
            moduleId: module.id,
            moduleName: module.name,
            name: tool.name,
            description: tool.description,
            permissionId: tool.permissionId,
            risk: tool.risk,
            inputSchema: tool.inputSchema ?? null,
            outputSchema: tool.outputSchema ?? null
          }
        });
      }
    }
    return out;
  }
```

**(c)** `packages/chat/src/routes.ts` — make the `mint` callback async and await
`listToolsForActor` (lines 93–104):

```ts
            mint: async (actorUserId: string) => {
              // Capture the actor's current executable tool set as the per-session allowlist.
              // Bare tool names (e.g. "example.read") — same format as tools/list and tools/call params.name.
              // The mcp__jarvis__<name> prefix is a client-side CLI convention that never reaches the server.
              const allowedToolNames = new Set(
                (await gateway!.listToolsForActor(actorUserId)).map((tool) => tool.name)
              );
              return {
                token: tokens!.mint({ actorUserId, chatSessionId: actorUserId, allowedToolNames }),
                mcpServerUrl
              };
            },
```

**(d)** `packages/chat/src/live/runtime.ts` — change the `mcpTokenLifecycle.mint` type (lines 58–66)
to return a Promise:

```ts
  /** Phase 2: MCP token lifecycle hooks — mint on engine launch, revoke on reap. */
  readonly mcpTokenLifecycle?: {
    readonly mint: (
      actorUserId: string,
      chatSessionId: string
    ) => Promise<{ token: string; mcpServerUrl: string }>;
    readonly revoke: (chatSessionId: string) => void;
    /** Refresh a session token's TTL on activity (defaults to no-op if omitted). */
    readonly touch?: (chatSessionId: string) => void;
  };
```

**(e)** `packages/chat/src/live/chat-session-manager.ts` — change the `mintMcpToken` dep type (lines
64–67) to async, and await it in `launchSession` (line 160):

Dep type:

```ts
  readonly mintMcpToken?: (
    actorUserId: string,
    chatSessionId: string
  ) => Promise<{ token: string; mcpServerUrl: string }>;
```

In `launchSession` (line 160), change:

```ts
    const mcpConfig = this.deps.mintMcpToken?.(actorUserId, actorUserId);
```

to:

```ts
    const mcpConfig = await this.deps.mintMcpToken?.(actorUserId, actorUserId);
```

**(f)** `tests/integration/chat-mcp-transport.test.ts` — verify whether it constructs a
`resolveActiveModules` stub or a `mintMcpToken`. If it passes a sync resolver to `registerChatRoutes`
or the gateway, wrap it in `async`. If it only uses the real wiring (no stub resolver), no change is
needed. Make the minimal edit required for it to compile and pass.

### Step 5.4 — Run (expected PASS)

```
vitest run tests/integration/mcp-gateway.test.ts
vitest run tests/integration/chat-mcp-transport.test.ts
pnpm --filter @jarv1s/ai exec tsc --noEmit
pnpm --filter @jarv1s/chat exec tsc --noEmit
```

### Step 5.5 — Commit

```
git add packages/ai/src/gateway/types.ts packages/ai/src/gateway/gateway.ts packages/chat/src/routes.ts packages/chat/src/live/runtime.ts packages/chat/src/live/chat-session-manager.ts tests/integration/mcp-gateway.test.ts tests/integration/chat-mcp-transport.test.ts
git commit -m "refactor(ai,chat): make ActiveModulesResolver async (gateway + token-mint ripple)"
```

---

## Task 6 — The DB-backed async resolver factory

**Files**
- Create: `packages/module-registry/src/active-modules-resolver.ts`
- Modify: `packages/module-registry/src/index.ts` (export it)
- Create: `tests/integration/fixtures/optional-module.ts`
- Modify: `tests/integration/module-enablement.test.ts` (resolver behavior describe block)

### Step 6.1 — Write the failing test

Create `tests/integration/fixtures/optional-module.ts` — a faithful fixture covering required,
instance-disablable-only, and fully-user-disablable cases:

```ts
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

/** A non-required, fully user-disablable optional module (exercises both drop paths). */
export const optionalModule: JarvisModuleManifest = {
  id: "weather",
  name: "Weather",
  version: "0.1.0",
  publisher: "test",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  availability: { defaultEnabled: true, required: false, supportsUserDisable: true },
  routes: [{ method: "GET", path: "/api/weather/today", permissionId: "weather.view" }]
};

/** Optional but NOT user-disablable: a per-user row must be ignored; instance row still applies. */
export const instanceOnlyDisablableModule: JarvisModuleManifest = {
  id: "wellness",
  name: "Wellness",
  version: "0.1.0",
  publisher: "test",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  availability: { defaultEnabled: true, required: false, supportsUserDisable: false },
  routes: [{ method: "GET", path: "/api/wellness/today", permissionId: "wellness.view" }]
};

/** Required: never droppable by anyone, even with a (defensively-inserted) row. */
export const requiredFixtureModule: JarvisModuleManifest = {
  id: "tasks-fixture",
  name: "Tasks Fixture",
  version: "0.1.0",
  publisher: "test",
  lifecycle: "required",
  compatibility: { jarv1s: ">=0.0.0" },
  availability: { defaultEnabled: true, required: true }
};
```

Append a resolver describe block to `tests/integration/module-enablement.test.ts`. Add this import
at the top:

```ts
import { createActiveModulesResolver } from "@jarv1s/module-registry";
import {
  instanceOnlyDisablableModule,
  optionalModule,
  requiredFixtureModule
} from "./fixtures/optional-module.js";
```

Then append:

```ts
describe("createActiveModulesResolver", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repo: SettingsRepository;

  const fixtures = [optionalModule, instanceOnlyDisablableModule, requiredFixtureModule];

  beforeAll(async () => {
    const { resetFoundationDatabase } = await import("./test-database.js");
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runner = new DataContextRunner(appDb);
    repo = new SettingsRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  function resolver() {
    return createActiveModulesResolver({ dataContext: runner, manifests: fixtures });
  }

  it("empty store: all fixture modules are active (zero behavior-change baseline)", async () => {
    const active = await resolver()(ids.userA);
    expect(active.map((m) => m.id).sort()).toEqual(
      ["tasks-fixture", "weather", "wellness"].sort()
    );
  });

  it("instance deny row drops a non-required module for ALL actors", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "r1" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "weather",
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "r1"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).not.toContain("weather");
    expect((await resolver()(ids.userB)).map((m) => m.id)).not.toContain("weather");
    // cleanup
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "r2" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "weather",
        disabled: false,
        actorUserId: ids.adminUser,
        requestId: "r2"
      })
    );
  });

  it("user deny row drops the module only for that actor (RLS)", async () => {
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "r3" }, (db) =>
      repo.setUserModuleDisabled(db, {
        moduleId: "weather",
        disabled: true,
        actorUserId: ids.userA,
        requestId: "r3"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).not.toContain("weather");
    expect((await resolver()(ids.userB)).map((m) => m.id)).toContain("weather");
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "r4" }, (db) =>
      repo.setUserModuleDisabled(db, {
        moduleId: "weather",
        disabled: false,
        actorUserId: ids.userA,
        requestId: "r4"
      })
    );
  });

  it("supportsUserDisable:false ignores a user row but obeys an instance row", async () => {
    // user row against wellness is ignored (per-user disable not supported)
    await runner.withDataContext({ actorUserId: ids.userA, requestId: "r5" }, (db) =>
      repo.setUserModuleDisabled(db, {
        moduleId: "wellness",
        disabled: true,
        actorUserId: ids.userA,
        requestId: "r5"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).toContain("wellness");

    // instance row against wellness still drops it
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "r6" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "wellness",
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "r6"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).not.toContain("wellness");
  });

  it("required modules are never droppable, even with a defensively-inserted instance row", async () => {
    await runner.withDataContext({ actorUserId: ids.adminUser, requestId: "r7" }, (db) =>
      repo.setInstanceModuleDisabled(db, {
        moduleId: "tasks-fixture",
        disabled: true,
        actorUserId: ids.adminUser,
        requestId: "r7"
      })
    );
    expect((await resolver()(ids.userA)).map((m) => m.id)).toContain("tasks-fixture");
  });
});
```

### Step 6.2 — Run (expected FAIL)

```
vitest run tests/integration/module-enablement.test.ts
```

Expect failure: `createActiveModulesResolver is not exported` / module not found.

### Step 6.3 — Minimal implementation

Create `packages/module-registry/src/active-modules-resolver.ts`:

```ts
import type { DataContextRunner } from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { SettingsRepository } from "@jarv1s/settings";

import type { ActiveModulesResolver } from "@jarv1s/ai";

export interface ActiveModulesResolverDeps {
  readonly dataContext: DataContextRunner;
  readonly manifests: readonly JarvisModuleManifest[];
}

/**
 * The real, DB-backed ActiveModulesResolver (ADR 0009 §3). Reads the
 * app.module_enablement deny-list under withDataContext (RLS returns instance rows ∪
 * this actor's own user rows), then filters the registered manifests by the layered
 * rule. The store is deny-only: absence of a row = enabled (honoring defaultEnabled,
 * true for all built-ins). required:true modules are never droppable.
 */
export function createActiveModulesResolver(deps: ActiveModulesResolverDeps): ActiveModulesResolver {
  const repository = new SettingsRepository();

  return async (actorUserId: string): Promise<readonly JarvisModuleManifest[]> => {
    const denyRows = await deps.dataContext.withDataContext(
      { actorUserId },
      (scopedDb) => repository.listModuleDenyRowsForActor(scopedDb)
    );

    const instanceDisabled = new Set(
      denyRows.filter((r) => r.scope === "instance").map((r) => r.module_id)
    );
    const userDisabled = new Set(
      denyRows
        .filter((r) => r.scope === "user" && r.user_id === actorUserId)
        .map((r) => r.module_id)
    );

    return deps.manifests.filter((manifest) => {
      const availability = manifest.availability;
      // required:true → always keep (ignore any row; defense-in-depth).
      if (availability?.required === true) return true;
      // instance disable is a hard floor for everyone.
      if (instanceDisabled.has(manifest.id)) return false;
      // per-user disable only applies when the manifest permits it.
      if (availability?.supportsUserDisable !== false && userDisabled.has(manifest.id)) {
        return false;
      }
      return true;
    });
  };
}
```

In `packages/module-registry/src/index.ts`, export the factory. Add near the other local imports /
exports (e.g. just below the `export type { ChatEngineFactory } ...` line):

```ts
export {
  createActiveModulesResolver,
  type ActiveModulesResolverDeps
} from "./active-modules-resolver.js";
```

> module-registry already depends on `@jarv1s/db`, `@jarv1s/settings`, and `@jarv1s/ai` (verified in
> `packages/module-registry/package.json`), so no new dependency is added.

### Step 6.4 — Run (expected PASS)

```
vitest run tests/integration/module-enablement.test.ts
pnpm --filter @jarv1s/module-registry exec tsc --noEmit
```

### Step 6.5 — Commit

```
git add packages/module-registry/src/active-modules-resolver.ts packages/module-registry/src/index.ts tests/integration/fixtures/optional-module.ts tests/integration/module-enablement.test.ts
git commit -m "feat(module-registry): add DB-backed createActiveModulesResolver factory"
```

---

## Task 7 — Reconcile manifest `routes[]` (tasks + chat) for guard coverage

The coverage assertion (Task 9) requires every registered API route to be either claimed by a
manifest `routes[]` entry or on the platform allowlist. Two modules under-declare. Add the missing
entries FIRST (per spec Risk #1 mitigation: do reconciliation before wiring the guard's 404).

**Files**
- Modify: `packages/tasks/src/manifest.ts`
- Modify: `packages/chat/src/manifest.ts`
- Create: `packages/module-registry/test/route-coverage.test.ts` (a pure unit test of index↔manifest reconciliation, no DB)

### Step 7.1 — Write the failing test

Create `packages/module-registry/test/route-coverage.test.ts`. It asserts that every API route a
module's manifest claims is well-formed, and (as the load-bearing check) that the tasks + chat
manifests now declare the previously-missing routes:

```ts
import { describe, expect, it } from "vitest";

import { getBuiltInModuleManifests } from "../src/index.js";

function manifestPaths(id: string): { method: string; path: string }[] {
  const manifest = getBuiltInModuleManifests().find((m) => m.id === id);
  if (!manifest) throw new Error(`no manifest for ${id}`);
  return (manifest.routes ?? []).map((r) => ({ method: r.method, path: r.path }));
}

describe("manifest routes[] reconciliation", () => {
  it("tasks manifest declares preferences + subtasks routes", () => {
    const paths = manifestPaths("tasks");
    expect(paths).toContainEqual({ method: "GET", path: "/api/tasks/preferences" });
    expect(paths).toContainEqual({ method: "PATCH", path: "/api/tasks/preferences" });
    expect(paths).toContainEqual({ method: "GET", path: "/api/tasks/:id/subtasks" });
  });

  it("chat manifest declares every chat API route the routes module registers", () => {
    const paths = manifestPaths("chat");
    for (const expected of [
      { method: "POST", path: "/api/chat/turn" },
      { method: "GET", path: "/api/chat/stream" },
      { method: "POST", path: "/api/chat/clear" },
      { method: "POST", path: "/api/chat/switch" },
      { method: "GET", path: "/api/chat/threads" },
      { method: "GET", path: "/api/chat/memory/settings" },
      { method: "PATCH", path: "/api/chat/memory/settings" },
      { method: "GET", path: "/api/chat/memory/facts" },
      { method: "DELETE", path: "/api/chat/memory/facts/:id" },
      { method: "PATCH", path: "/api/chat/memory/facts/:id" },
      { method: "POST", path: "/api/chat/action-requests/:id/resolve" },
      { method: "POST", path: "/api/mcp" }
    ]) {
      expect(paths).toContainEqual(expected);
    }
  });

  it("every manifest API route uses Fastify :param syntax (not {param})", () => {
    for (const manifest of getBuiltInModuleManifests()) {
      for (const route of manifest.routes ?? []) {
        expect(route.path).not.toMatch(/\{.*\}/);
      }
    }
  });
});
```

> Before writing the chat entries, VERIFY the actual registered methods/paths at build time by
> reading `packages/chat/src/routes.ts`, `packages/chat/src/live-routes.ts`, and
> `packages/chat/src/mcp-transport.ts` (the `/api/chat/turn|stream|clear|switch` live routes and
> `/api/mcp` transport are registered there). Adjust the method/path pairs above and in Step 7.3 to
> match exactly what is registered. The list above reflects the registered set as of `a898533`
> (`/api/chat/turn`, `/api/chat/stream`, `/api/chat/clear`, `/api/chat/switch`,
> `/api/chat/memory/settings`, `/api/chat/memory/facts`, `/api/chat/memory/facts/:id`,
> `/api/chat/action-requests/:id/resolve`, `/api/mcp`, `/api/chat/threads`). If a live route is
> registered conditionally (the gateway block), it is STILL always registered when the server boots
> with the real wiring, so it must be in the manifest or the allowlist.

### Step 7.2 — Run (expected FAIL)

```
pnpm --filter @jarv1s/module-registry exec vitest run test/route-coverage.test.ts
```

Expect failures on the tasks + chat assertions (those routes are not yet declared).

### Step 7.3 — Minimal implementation

**(a)** `packages/tasks/src/manifest.ts` — add three entries to the `routes:` array (append after the
existing `/api/tasks/overdue` entry, before the closing `]`):

```ts
    {
      method: "GET",
      path: "/api/tasks/preferences",
      permissionId: "tasks.view"
    },
    {
      method: "PATCH",
      path: "/api/tasks/preferences",
      permissionId: "tasks.update"
    },
    {
      method: "GET",
      path: "/api/tasks/:id/subtasks",
      permissionId: "tasks.view"
    }
```

**(b)** `packages/chat/src/manifest.ts` — replace the single-entry `routes` array with the full set.
Change:

```ts
  routes: [
    {
      method: "GET",
      path: "/api/chat/threads",
      responseSchema: listChatThreadsResponseSchema,
      permissionId: "chat.view"
    }
  ]
```

to (verify each method/path against the registered routes at build time):

```ts
  routes: [
    {
      method: "GET",
      path: "/api/chat/threads",
      responseSchema: listChatThreadsResponseSchema,
      permissionId: "chat.view"
    },
    { method: "POST", path: "/api/chat/turn", permissionId: "chat.message" },
    { method: "GET", path: "/api/chat/stream", permissionId: "chat.view" },
    { method: "POST", path: "/api/chat/clear", permissionId: "chat.message" },
    { method: "POST", path: "/api/chat/switch", permissionId: "chat.message" },
    { method: "GET", path: "/api/chat/memory/settings", permissionId: "chat.view" },
    { method: "PATCH", path: "/api/chat/memory/settings", permissionId: "chat.message" },
    { method: "GET", path: "/api/chat/memory/facts", permissionId: "chat.view" },
    { method: "DELETE", path: "/api/chat/memory/facts/:id", permissionId: "chat.message" },
    { method: "PATCH", path: "/api/chat/memory/facts/:id", permissionId: "chat.message" },
    {
      method: "POST",
      path: "/api/chat/action-requests/:id/resolve",
      permissionId: "chat.message"
    },
    { method: "POST", path: "/api/mcp", permissionId: "chat.message" }
  ]
```

### Step 7.4 — Run (expected PASS)

```
pnpm --filter @jarv1s/module-registry exec vitest run test/route-coverage.test.ts
pnpm --filter @jarv1s/tasks exec tsc --noEmit
pnpm --filter @jarv1s/chat exec tsc --noEmit
```

### Step 7.5 — Commit

```
git add packages/tasks/src/manifest.ts packages/chat/src/manifest.ts packages/module-registry/test/route-coverage.test.ts
git commit -m "feat(tasks,chat): declare all registered API routes in manifest routes[]"
```

---

## Task 8 — Shared DTOs + route schemas for the enablement endpoints

**Files**
- Modify: `packages/shared/src/platform-api.ts`
- Create: `packages/shared/test/platform-api.module-enablement.test.ts`

### Step 8.1 — Write the failing test

Create `packages/shared/test/platform-api.module-enablement.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  adminModuleParamsSchema,
  listAdminModulesRouteSchema,
  listMyModulesRouteSchema,
  patchModuleEnablementRouteSchema
} from "../src/platform-api.js";

describe("module-enablement route schemas", () => {
  it("admin list response requires a modules array", () => {
    expect(listAdminModulesRouteSchema.response[200].required).toContain("modules");
  });

  it("self list response requires a modules array", () => {
    expect(listMyModulesRouteSchema.response[200].required).toContain("modules");
  });

  it("patch body requires a boolean disabled flag", () => {
    expect(patchModuleEnablementRouteSchema.body.required).toContain("disabled");
    expect(patchModuleEnablementRouteSchema.body.properties.disabled.type).toBe("boolean");
  });

  it("patch declares 404/409/422 error responses", () => {
    expect(patchModuleEnablementRouteSchema.response).toHaveProperty("404");
    expect(patchModuleEnablementRouteSchema.response).toHaveProperty("409");
    expect(patchModuleEnablementRouteSchema.response).toHaveProperty("422");
  });

  it("module id param schema requires id", () => {
    expect(adminModuleParamsSchema.required).toContain("id");
  });
});
```

### Step 8.2 — Run (expected FAIL)

```
pnpm --filter @jarv1s/shared exec vitest run test/platform-api.module-enablement.test.ts
```

Expect failure: exports not found.

### Step 8.3 — Minimal implementation

Append to `packages/shared/src/platform-api.ts` (after the existing `listModulesRouteSchema` and the
admin-user schemas; before the file end):

```ts
// ── Module enablement (admin + self-service) ────────────────────────────────

export interface AdminModuleDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly lifecycle: "required" | "optional" | "user-toggleable" | "workspace-toggleable";
  readonly required: boolean;
  readonly supportsUserDisable: boolean;
  readonly instanceDisabled: boolean;
}

export interface MyModuleDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly lifecycle: "required" | "optional" | "user-toggleable" | "workspace-toggleable";
  readonly required: boolean;
  readonly supportsUserDisable: boolean;
  readonly instanceDisabled: boolean;
  readonly userDisabled: boolean;
  readonly active: boolean;
}

export interface ListAdminModulesResponse {
  readonly modules: readonly AdminModuleDto[];
}

export interface ListMyModulesResponse {
  readonly modules: readonly MyModuleDto[];
}

export interface PatchModuleEnablementRequest {
  readonly disabled: boolean;
}

const lifecycleEnum = {
  type: "string",
  enum: ["required", "optional", "user-toggleable", "workspace-toggleable"]
} as const;

const adminModuleSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "version",
    "lifecycle",
    "required",
    "supportsUserDisable",
    "instanceDisabled"
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    lifecycle: lifecycleEnum,
    required: { type: "boolean" },
    supportsUserDisable: { type: "boolean" },
    instanceDisabled: { type: "boolean" }
  }
} as const;

const myModuleSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "version",
    "lifecycle",
    "required",
    "supportsUserDisable",
    "instanceDisabled",
    "userDisabled",
    "active"
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    lifecycle: lifecycleEnum,
    required: { type: "boolean" },
    supportsUserDisable: { type: "boolean" },
    instanceDisabled: { type: "boolean" },
    userDisabled: { type: "boolean" },
    active: { type: "boolean" }
  }
} as const;

export const adminModuleParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string" } }
} as const;

export const listAdminModulesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["modules"],
      properties: { modules: { type: "array", items: adminModuleSchema } }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const listMyModulesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["modules"],
      properties: { modules: { type: "array", items: myModuleSchema } }
    },
    401: errorResponseSchema
  }
} as const;

export const patchModuleEnablementRouteSchema = {
  params: adminModuleParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["disabled"],
    properties: { disabled: { type: "boolean" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["module"],
      properties: { module: { ...myModuleSchema } }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema
  }
} as const;
```

> The admin PATCH and self PATCH share `patchModuleEnablementRouteSchema` (same body + params +
> error codes). The 200 `module` shape uses `myModuleSchema` for both (the admin response includes
> the full computed shape too — `userDisabled`/`active` for the admin's own actor are harmless and
> keep one schema). If the admin route should return only `AdminModuleDto`, the route handler in
> Task 10 returns the `MyModuleDto`-shaped object built from the admin's own resolution — acceptable
> and avoids a second schema.

### Step 8.4 — Run (expected PASS)

```
pnpm --filter @jarv1s/shared exec vitest run test/platform-api.module-enablement.test.ts
pnpm --filter @jarv1s/shared exec tsc --noEmit
```

### Step 8.5 — Commit

```
git add packages/shared/src/platform-api.ts packages/shared/test/platform-api.module-enablement.test.ts
git commit -m "feat(shared): add module-enablement admin + self DTOs and route schemas"
```

---

## Task 9 — Route-enablement guard + boot-time coverage assertion

**Files**
- Create: `packages/module-registry/src/route-guard.ts`
- Modify: `packages/module-registry/src/index.ts` (export the guard + allowlist + assertion)
- Create: `packages/module-registry/test/route-guard-index.test.ts` (pure index/allowlist unit test)

This task builds the pure machinery (route→module index, allowlist, coverage assertion, guard
factory). Wiring it into `server.ts` and the live HTTP 404 behavior is Task 11.

### Step 9.1 — Write the failing test

Create `packages/module-registry/test/route-guard-index.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

import {
  PLATFORM_UNGUARDED_ROUTES,
  assertRouteCoverage,
  buildRouteModuleIndex,
  lookupModuleForRoute
} from "../src/route-guard.js";

const manifests: JarvisModuleManifest[] = [
  {
    id: "weather",
    name: "Weather",
    version: "0.1.0",
    publisher: "test",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.0.0" },
    availability: { defaultEnabled: true, required: false, supportsUserDisable: true },
    routes: [
      { method: "GET", path: "/api/weather/today", permissionId: "weather.view" },
      { method: "GET", path: "/api/weather/:id", permissionId: "weather.view" }
    ]
  }
];

describe("route→module index", () => {
  it("maps method + matched-route-pattern to the owning module", () => {
    const index = buildRouteModuleIndex(manifests);
    expect(lookupModuleForRoute(index, "GET", "/api/weather/today")).toBe("weather");
    expect(lookupModuleForRoute(index, "GET", "/api/weather/:id")).toBe("weather");
    expect(lookupModuleForRoute(index, "POST", "/api/weather/today")).toBeUndefined();
    expect(lookupModuleForRoute(index, "GET", "/api/unknown")).toBeUndefined();
  });

  it("includes the platform health + auth + modules + me + admin/me-modules entries", () => {
    expect(PLATFORM_UNGUARDED_ROUTES.has("GET /health")).toBe(true);
    expect(PLATFORM_UNGUARDED_ROUTES.has("GET /api/modules")).toBe(true);
    expect(PLATFORM_UNGUARDED_ROUTES.has("GET /api/me")).toBe(true);
  });
});

describe("assertRouteCoverage", () => {
  const registered = [
    { method: "GET", url: "/api/weather/today" },
    { method: "GET", url: "/api/weather/:id" },
    { method: "GET", url: "/health" }
  ];
  const platform = new Set(["GET /health"]);

  it("passes when every registered route is indexed or allowlisted", () => {
    expect(() =>
      assertRouteCoverage({ registered, manifests, platformAllowlist: platform })
    ).not.toThrow();
  });

  it("throws naming an unindexed, non-allowlisted registered route", () => {
    expect(() =>
      assertRouteCoverage({
        registered: [...registered, { method: "POST", url: "/api/orphan" }],
        manifests,
        platformAllowlist: platform
      })
    ).toThrow(/orphan/);
  });

  it("throws when a manifest declares a route that is not registered (drift)", () => {
    const drifted: JarvisModuleManifest[] = [
      {
        ...manifests[0]!,
        routes: [
          ...(manifests[0]!.routes ?? []),
          { method: "GET", path: "/api/weather/ghost", permissionId: "weather.view" }
        ]
      }
    ];
    expect(() =>
      assertRouteCoverage({ registered, manifests: drifted, platformAllowlist: platform })
    ).toThrow(/ghost/);
  });
});
```

### Step 9.2 — Run (expected FAIL)

```
pnpm --filter @jarv1s/module-registry exec vitest run test/route-guard-index.test.ts
```

Expect failure: `Cannot find module '../src/route-guard.js'`.

### Step 9.3 — Minimal implementation

Create `packages/module-registry/src/route-guard.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessContext } from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

import type { ActiveModulesResolver } from "@jarv1s/ai";

/** A method+pattern key. Method is upper-cased; pattern is Fastify's matched-route url. */
export type RouteKey = string;

export function routeKey(method: string, pattern: string): RouteKey {
  return `${method.toUpperCase()} ${pattern}`;
}

/**
 * Platform/unguarded routes (ADR 0009 §4): the guard skips these. Settings owns
 * /api/me, /api/bootstrap/status, and /api/admin/*, so a prefix heuristic is unsafe —
 * the allowlist is explicit. Includes the new admin + self enablement endpoints (a
 * user must always be able to re-enable a module they disabled).
 */
export const PLATFORM_UNGUARDED_ROUTES: ReadonlySet<RouteKey> = new Set<RouteKey>([
  // health probes
  routeKey("GET", "/health"),
  routeKey("GET", "/health/ready"),
  // platform module listing
  routeKey("GET", "/api/modules"),
  // settings: pre-auth bootstrap + own profile
  routeKey("GET", "/api/bootstrap/status"),
  routeKey("GET", "/api/me"),
  // settings admin surface (gated by assertAdminUser, not by module enablement)
  routeKey("GET", "/api/admin/auth/providers"),
  routeKey("GET", "/api/admin/users"),
  routeKey("POST", "/api/admin/users/:id/approve"),
  routeKey("POST", "/api/admin/users/:id/reject"),
  routeKey("DELETE", "/api/admin/users/:id"),
  routeKey("POST", "/api/admin/users/:id/reactivate"),
  routeKey("POST", "/api/admin/users/:id/deactivate"),
  routeKey("POST", "/api/admin/users/:id/revoke-sessions"),
  routeKey("POST", "/api/admin/users/:id/promote"),
  routeKey("POST", "/api/admin/users/:id/demote"),
  routeKey("GET", "/api/admin/settings"),
  routeKey("PATCH", "/api/admin/settings/:key"),
  routeKey("GET", "/api/admin/registration"),
  routeKey("PUT", "/api/admin/registration"),
  routeKey("GET", "/api/admin/audit-events"),
  routeKey("GET", "/api/admin/connectors/accounts"),
  // new enablement endpoints (admin + self)
  routeKey("GET", "/api/admin/modules"),
  routeKey("PATCH", "/api/admin/modules/:id"),
  routeKey("GET", "/api/me/modules"),
  routeKey("PATCH", "/api/me/modules/:id")
]);

export type RouteModuleIndex = ReadonlyMap<RouteKey, string>;

/** Build a method+pattern → moduleId index from every manifest's routes[]. */
export function buildRouteModuleIndex(
  manifests: readonly JarvisModuleManifest[]
): RouteModuleIndex {
  const index = new Map<RouteKey, string>();
  for (const manifest of manifests) {
    for (const route of manifest.routes ?? []) {
      index.set(routeKey(route.method, route.path), manifest.id);
    }
  }
  return index;
}

export function lookupModuleForRoute(
  index: RouteModuleIndex,
  method: string,
  pattern: string
): string | undefined {
  return index.get(routeKey(method, pattern));
}

export interface RegisteredRoute {
  readonly method: string;
  readonly url: string;
}

export interface RouteCoverageInput {
  readonly registered: readonly RegisteredRoute[];
  readonly manifests: readonly JarvisModuleManifest[];
  readonly platformAllowlist: ReadonlySet<RouteKey>;
}

/**
 * Boot-time coverage assertion (ADR 0009 §4). Throws if any registered route is
 * neither claimed by a manifest routes[] entry nor on the platform allowlist, OR if a
 * manifest declares a route that is not registered (drift). This makes "routes[] is
 * load-bearing" verifiable rather than aspirational. The guard would have a blind spot
 * for any uncovered route, so the process must not start.
 */
export function assertRouteCoverage(input: RouteCoverageInput): void {
  const index = buildRouteModuleIndex(input.manifests);
  const registeredKeys = new Set(input.registered.map((r) => routeKey(r.method, r.url)));

  const uncovered: string[] = [];
  for (const key of registeredKeys) {
    if (input.platformAllowlist.has(key)) continue;
    if (index.has(key)) continue;
    uncovered.push(key);
  }

  const drifted: string[] = [];
  for (const key of index.keys()) {
    if (!registeredKeys.has(key)) drifted.push(key);
  }

  if (uncovered.length > 0 || drifted.length > 0) {
    const parts: string[] = [];
    if (uncovered.length > 0) {
      parts.push(
        `registered routes not claimed by any manifest routes[] or the platform allowlist: ` +
          uncovered.sort().join(", ")
      );
    }
    if (drifted.length > 0) {
      parts.push(
        `manifest routes[] entries with no registered route (drift): ` + drifted.sort().join(", ")
      );
    }
    throw new Error(`Route-coverage assertion failed — ${parts.join("; ")}`);
  }
}

export interface RouteGuardDeps {
  readonly manifests: readonly JarvisModuleManifest[];
  readonly resolveActiveModules: ActiveModulesResolver;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly platformAllowlist?: ReadonlySet<RouteKey>;
}

/**
 * Register a single onRequest hook that 404s a request whose matched route belongs to
 * a module not active for the actor. onRequest runs after routing, so
 * request.routeOptions.url is the matched pattern (e.g. /api/tasks/:id). 404 (never
 * 403) — do not leak that the module exists but is disabled. Platform/unguarded routes
 * pass through with no actor resolution. A resolver failure FAILS CLOSED (the thrown
 * error becomes a 500 via Fastify's error path — the request never passes through).
 */
export function registerRouteEnablementGuard(server: FastifyInstance, deps: RouteGuardDeps): void {
  const index = buildRouteModuleIndex(deps.manifests);
  const allowlist = deps.platformAllowlist ?? PLATFORM_UNGUARDED_ROUTES;

  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const pattern = request.routeOptions?.url;
    // No matched route (404 from the router itself) — let Fastify's 404 handler run.
    if (!pattern) return;

    const key = routeKey(request.method, pattern);
    if (allowlist.has(key)) return;

    const moduleId = index.get(key);
    // Unindexed + not allowlisted: the boot assertion should have prevented deploy.
    // Fail closed defensively at request time.
    if (!moduleId) {
      return reply.code(404).send({ error: "Not found" });
    }

    let actorUserId: string;
    try {
      const access = await deps.resolveAccessContext(request);
      actorUserId = access.actorUserId;
    } catch {
      // Not authenticated — let the route's own handler return its normal 401.
      return;
    }

    const active = await deps.resolveActiveModules(actorUserId);
    if (!active.some((m) => m.id === moduleId)) {
      return reply.code(404).send({ error: "Not found" });
    }
  });
}
```

In `packages/module-registry/src/index.ts`, export the guard machinery (next to the resolver export
from Task 6):

```ts
export {
  PLATFORM_UNGUARDED_ROUTES,
  assertRouteCoverage,
  buildRouteModuleIndex,
  lookupModuleForRoute,
  registerRouteEnablementGuard,
  routeKey,
  type RegisteredRoute,
  type RouteGuardDeps,
  type RouteKey,
  type RouteModuleIndex
} from "./route-guard.js";
```

### Step 9.4 — Run (expected PASS)

```
pnpm --filter @jarv1s/module-registry exec vitest run test/route-guard-index.test.ts
pnpm --filter @jarv1s/module-registry exec tsc --noEmit
```

### Step 9.5 — Commit

```
git add packages/module-registry/src/route-guard.ts packages/module-registry/src/index.ts packages/module-registry/test/route-guard-index.test.ts
git commit -m "feat(module-registry): route→module index, enablement guard, coverage assertion"
```

---

## Task 10 — Admin + self enablement endpoints in `@jarv1s/settings`

**Files**
- Modify: `packages/settings/src/routes.ts` (add the endpoints + a manifest dependency)
- Modify: `packages/module-registry/src/index.ts` (thread `listModuleManifests` into settings deps so the endpoints can enumerate modules)
- Modify: `packages/settings/src/manifest.ts` (add the 4 new route entries to `routes[]`)
- Modify: `tests/integration/route-guard.test.ts` (created here; admin + self endpoint tests)

> The settings routes need the registered manifest list to enumerate modules and to read each
> module's `required` / `supportsUserDisable`. Add `listModuleManifests` to
> `SettingsRoutesDependencies` (it is already on `BuiltInRouteDependencies`).

### Step 10.1 — Write the failing test

Create `tests/integration/route-guard.test.ts`. This task uses only the admin + self endpoint
sections; the guard-404 sections are filled in Task 11 (the file is created now, guard tests added
later). Build a real server via `createApiServer` and a bootstrapped admin (mirror
`auth-settings.test.ts`). Helper `signInAsOwner` returns the owner cookie (owner is auto-admin as
the bootstrap user).

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, resetEmptyFoundationDatabase, setInstanceSetting } from "./test-database.js";

function cookieHeader(headers: Record<string, unknown>): string {
  const raw = headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

describe("module enablement endpoints", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    await setInstanceSetting("registration.requires_approval", { value: false });
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner@example.test",
        password: "correct horse battery staple"
      }
    });
    ownerCookie = cookieHeader(signUp.headers as Record<string, unknown>);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("GET /api/admin/modules lists every built-in with required + instanceDisabled flags", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/modules",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ modules: { id: string; required: boolean; instanceDisabled: boolean }[] }>();
    const tasks = body.modules.find((m) => m.id === "tasks");
    expect(tasks?.required).toBe(true);
    expect(tasks?.instanceDisabled).toBe(false);
    expect(body.modules.length).toBeGreaterThanOrEqual(11);
  });

  it("admin disabling a required module is rejected with 409", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/api/admin/modules/tasks",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { disabled: true }
    });
    expect(res.statusCode).toBe(409);
  });

  it("admin disabling an unknown module is 404", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/api/admin/modules/does-not-exist",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { disabled: true }
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/me/modules returns active flags for the caller", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/me/modules",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ modules: { id: string; active: boolean }[] }>();
    expect(body.modules.every((m) => m.active)).toBe(true);
  });

  it("self disabling a required module is 409", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: "/api/me/modules/tasks",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { disabled: true }
    });
    expect(res.statusCode).toBe(409);
  });

  it("a non-admin actor cannot reach the admin endpoint", async () => {
    // Register a second, non-admin user (requires_approval is off so they are active).
    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name: "Member", email: "member@example.test", password: "correct horse battery staple x" }
    });
    const memberCookie = cookieHeader(signUp.headers as Record<string, unknown>);
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/modules",
      headers: { cookie: memberCookie }
    });
    expect(res.statusCode).toBe(403);
  });
});
```

### Step 10.2 — Run (expected FAIL)

```
pnpm db:migrate
vitest run tests/integration/route-guard.test.ts
```

Expect failure: `/api/admin/modules` → 404 (route not registered yet).

### Step 10.3 — Minimal implementation

**(a)** `packages/settings/src/routes.ts`. Add the manifest dependency and the four endpoints.

Add `listModuleManifests` to `SettingsRoutesDependencies`:

```ts
  readonly listModuleManifests?: () => readonly import("@jarv1s/module-sdk").JarvisModuleManifest[];
```

> Import `JarvisModuleManifest` properly at the top instead of inline if preferred:
> add `import type { JarvisModuleManifest } from "@jarv1s/module-sdk";` to the existing module-sdk
> import line area, and type the dep as
> `readonly listModuleManifests?: () => readonly JarvisModuleManifest[];`.

Add the new shared imports to the existing `@jarv1s/shared` import block:

```ts
  adminModuleParamsSchema,
  listAdminModulesRouteSchema,
  listMyModulesRouteSchema,
  patchModuleEnablementRouteSchema,
  type AdminModuleDto,
  type MyModuleDto,
```

Inside `registerSettingsRoutes`, after the existing audit-events route registration (before the
closing `}` of the function), add:

```ts
  function requireManifests(): readonly JarvisModuleManifest[] {
    return dependencies.listModuleManifests?.() ?? [];
  }

  function findManifest(id: string): JarvisModuleManifest | undefined {
    return requireManifests().find((m) => m.id === id);
  }

  function isRequired(m: JarvisModuleManifest): boolean {
    return m.availability?.required === true;
  }

  function supportsUserDisable(m: JarvisModuleManifest): boolean {
    return m.availability?.supportsUserDisable !== false;
  }

  server.get("/api/admin/modules", { schema: listAdminModulesRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const instanceRows = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
          return repository.listInstanceModuleDenyRows(scopedDb);
        }
      );
      const instanceDisabled = new Set(instanceRows.map((r) => r.module_id));
      const modules: AdminModuleDto[] = requireManifests().map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        lifecycle: m.lifecycle,
        required: isRequired(m),
        supportsUserDisable: supportsUserDisable(m),
        instanceDisabled: instanceDisabled.has(m.id)
      }));
      return { modules };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.patch<{ Params: { id: string } }>(
    "/api/admin/modules/:id",
    { schema: patchModuleEnablementRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const disabled = parseDisabledBody(request.body);
        const manifest = findManifest(request.params.id);
        if (!manifest) throw new HttpError(404, "Module not found");
        if (disabled && isRequired(manifest)) {
          throw new HttpError(409, "Required modules cannot be disabled");
        }
        const dto = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            await repository.setInstanceModuleDisabled(scopedDb, {
              moduleId: manifest.id,
              disabled,
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
            return computeMyModuleDto(repository, scopedDb, manifest, accessContext.actorUserId);
          }
        );
        return { module: dto };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get("/api/me/modules", { schema: listMyModulesRouteSchema }, async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const modules = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          const rows = await repository.listModuleDenyRowsForActor(scopedDb);
          const instanceDisabled = new Set(
            rows.filter((r) => r.scope === "instance").map((r) => r.module_id)
          );
          const userDisabled = new Set(
            rows
              .filter((r) => r.scope === "user" && r.user_id === accessContext.actorUserId)
              .map((r) => r.module_id)
          );
          return requireManifests().map((m) =>
            toMyModuleDto(m, instanceDisabled.has(m.id), userDisabled.has(m.id))
          );
        }
      );
      return { modules };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.patch<{ Params: { id: string } }>(
    "/api/me/modules/:id",
    { schema: patchModuleEnablementRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const disabled = parseDisabledBody(request.body);
        const manifest = findManifest(request.params.id);
        if (!manifest) throw new HttpError(404, "Module not found");
        if (disabled && isRequired(manifest)) {
          throw new HttpError(409, "Required modules cannot be disabled");
        }
        if (disabled && !supportsUserDisable(manifest)) {
          throw new HttpError(422, "This module cannot be disabled per-user");
        }
        const dto = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await repository.setUserModuleDisabled(scopedDb, {
              moduleId: manifest.id,
              disabled,
              actorUserId: accessContext.actorUserId,
              requestId: requireRequestId(accessContext)
            });
            return computeMyModuleDto(repository, scopedDb, manifest, accessContext.actorUserId);
          }
        );
        return { module: dto };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
```

Add these module-level helpers near the other top-level helpers at the bottom of the file (outside
`registerSettingsRoutes`):

```ts
function parseDisabledBody(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Expected JSON object body");
  }
  const disabled = (body as Record<string, unknown>).disabled;
  if (typeof disabled !== "boolean") {
    throw new HttpError(400, "disabled must be a boolean");
  }
  return disabled;
}

function toMyModuleDto(
  manifest: JarvisModuleManifest,
  instanceDisabled: boolean,
  userDisabled: boolean
): MyModuleDto {
  const required = manifest.availability?.required === true;
  const userDisableSupported = manifest.availability?.supportsUserDisable !== false;
  // Mirror the resolver's rule exactly so the UI and gateway never disagree.
  const active = required
    ? true
    : instanceDisabled
      ? false
      : userDisableSupported && userDisabled
        ? false
        : true;
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    lifecycle: manifest.lifecycle,
    required,
    supportsUserDisable: userDisableSupported,
    instanceDisabled,
    userDisabled,
    active
  };
}

async function computeMyModuleDto(
  repository: SettingsRepository,
  scopedDb: DataContextDb,
  manifest: JarvisModuleManifest,
  actorUserId: string
): Promise<MyModuleDto> {
  const rows = await repository.listModuleDenyRowsForActor(scopedDb);
  const instanceDisabled = rows.some(
    (r) => r.scope === "instance" && r.module_id === manifest.id
  );
  const userDisabled = rows.some(
    (r) => r.scope === "user" && r.module_id === manifest.id && r.user_id === actorUserId
  );
  return toMyModuleDto(manifest, instanceDisabled, userDisabled);
}
```

> `JarvisModuleManifest`, `MyModuleDto`, `AdminModuleDto`, and `DataContextDb` must be imported at
> the top of the file. `DataContextDb` is already imported. Add `JarvisModuleManifest` to the
> module-sdk import; `AdminModuleDto` / `MyModuleDto` to the shared import.

**(b)** `packages/module-registry/src/index.ts` — thread `listModuleManifests` into the settings
route registration. The settings entry currently uses `registerRoutes: registerSettingsRoutes`
(which receives the full `BuiltInRouteDependencies`, already including `listModuleManifests`). Change
it to an explicit wiring so settings gets the manifest list:

```ts
  {
    manifest: settingsModuleManifest,
    sqlMigrationDirectories: [settingsModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: (server, deps) =>
      registerSettingsRoutes(server, {
        rootDb: deps.rootDb,
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        listConfiguredAuthProviders: deps.listConfiguredAuthProviders,
        listModuleManifests: deps.listModuleManifests,
        revokeUserSessions: deps.revokeUserSessions,
        bootstrapConnectionString: deps.bootstrapConnectionString
      })
  },
```

**(c)** `packages/settings/src/manifest.ts` — add the four route entries to `routes:` (after the
audit-events entry, before the closing `]`):

```ts
    {
      method: "GET",
      path: "/api/admin/modules",
      permissionId: "settings.manage"
    },
    {
      method: "PATCH",
      path: "/api/admin/modules/:id",
      permissionId: "settings.manage"
    },
    {
      method: "GET",
      path: "/api/me/modules",
      permissionId: "settings.view"
    },
    {
      method: "PATCH",
      path: "/api/me/modules/:id",
      permissionId: "settings.view"
    }
```

> These are also on the guard's `PLATFORM_UNGUARDED_ROUTES` (Task 9). Declaring them in the manifest
> too is harmless — the allowlist takes precedence in the guard hook, and the coverage assertion
> treats an allowlisted route as covered.

### Step 10.4 — Run (expected PASS)

```
vitest run tests/integration/route-guard.test.ts
pnpm --filter @jarv1s/settings exec tsc --noEmit
pnpm --filter @jarv1s/module-registry exec tsc --noEmit
```

### Step 10.5 — Commit

```
git add packages/settings/src/routes.ts packages/settings/src/manifest.ts packages/module-registry/src/index.ts tests/integration/route-guard.test.ts
git commit -m "feat(settings): admin + self-service module-enablement endpoints"
```

---

## Task 11 — Wire the resolver + guard + coverage assertion into `server.ts`

**Files**
- Modify: `packages/module-registry/src/index.ts` (add `resolveActiveModules` to `BuiltInRouteDependencies`; use it in chat wiring)
- Modify: `apps/api/src/server.ts` (construct resolver; pass it; register guard + coverage assertion)
- Modify: `tests/integration/route-guard.test.ts` (add the guard-404 sections using the fixture module)

### Step 11.1 — Write the failing test

Append guard-behavior tests to `tests/integration/route-guard.test.ts`. These prove (a) platform
routes are never 404'd by the guard, and (b) the real server boots clean (coverage assertion
passes). Because all 11 built-ins are required (never droppable), the live-404 path is proven with a
self-disable of a NON-required fixture is not mountable into the real server; instead, assert the
guard does not 404 platform/active routes and that a disabled module's tool surface vanishes via the
resolver (covered in Task 6). Add:

```ts
describe("route guard wiring (real server)", () => {
  it("the real server boots clean (coverage assertion passes)", async () => {
    // server.ready() in beforeAll already ran the boot assertion; reaching here proves it.
    expect(server).toBeDefined();
  });

  it("platform routes are never 404'd by the guard", async () => {
    for (const url of ["/api/me", "/api/modules", "/api/me/modules", "/health"]) {
      const res = await server.inject({ method: "GET", url, headers: { cookie: ownerCookie } });
      expect(res.statusCode).not.toBe(404);
    }
  });

  it("an active module's route is reachable (not guard-404'd)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
  });
});
```

> The required-only built-in set means a live guard-404 cannot be triggered against a real module
> without making one non-required (out of scope). The 404 behavior of the guard hook itself is fully
> covered by the unit test in Task 9 (`registerRouteEnablementGuard` against a fixture index) — add
> a focused unit test there if not already present. To prove the END-TO-END 404 with a real Fastify
> instance, add the following unit-ish integration test using a bare Fastify server + the guard +
> a stub resolver, in `tests/integration/route-guard.test.ts`:

```ts
import Fastify from "fastify";
import { registerRouteEnablementGuard } from "@jarv1s/module-registry";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

describe("registerRouteEnablementGuard end-to-end (bare Fastify)", () => {
  const weather: JarvisModuleManifest = {
    id: "weather",
    name: "Weather",
    version: "0.1.0",
    publisher: "test",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.0.0" },
    availability: { defaultEnabled: true, required: false, supportsUserDisable: true },
    routes: [{ method: "GET", path: "/api/weather/today", permissionId: "weather.view" }]
  };

  async function buildServer(active: boolean) {
    const app = Fastify({ logger: false });
    app.after(() => {
      app.get("/api/weather/today", async () => ({ ok: true }));
      registerRouteEnablementGuard(app, {
        manifests: [weather],
        resolveActiveModules: async () => (active ? [weather] : []),
        resolveAccessContext: async () => ({ actorUserId: "00000000-0000-4000-8000-000000000001" }),
        platformAllowlist: new Set<string>()
      });
    });
    await app.ready();
    return app;
  }

  it("returns 200 when the module is active", async () => {
    const app = await buildServer(true);
    const res = await app.inject({ method: "GET", url: "/api/weather/today" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("returns 404 (NOT 403) when the module is not active", async () => {
    const app = await buildServer(false);
    const res = await app.inject({ method: "GET", url: "/api/weather/today" });
    expect(res.statusCode).toBe(404);
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });
});
```

### Step 11.2 — Run (expected FAIL)

```
vitest run tests/integration/route-guard.test.ts
```

Expect failure: the bare-Fastify end-to-end test fails because the guard is fine, but the "real
server boots clean" test fails if the server does not yet register the guard/coverage assertion — OR
the coverage assertion throws at `server.ready()` because the guard is wired before the
manifest/allowlist reconciliation is complete. The failing signal here is the real-server
`beforeAll` throwing during `server.ready()` once the assertion is added but before reconciliation —
which Task 7 + Task 10 already handled, so the expected failure is specifically that the guard is not
yet wired (real-server tests still pass, but the e2e guard test may pass too). If everything passes
without the wiring, force the failing state by adding the wiring test first: assert
`server.inject` on a guarded path goes through the guard — but since we cannot disable a real module,
rely on the bare-Fastify e2e test as the failing driver: it imports `registerRouteEnablementGuard`,
which already exists (Task 9), so it passes. THEREFORE the true failing driver for this task is the
**coverage assertion at boot**: temporarily nothing fails. To get a real RED, first add the wiring
that calls `assertRouteCoverage` at boot and run the FULL existing suite — if reconciliation is
incomplete, `auth-settings.test.ts` (which boots `createApiServer`) will throw at `server.ready()`.
Run:

```
vitest run tests/integration/auth-settings.test.ts
```

If it throws a coverage-assertion error naming an unreconciled route, that is the RED to fix in Step
11.3 by adding the route to a manifest or the allowlist. If it passes, reconciliation from Tasks 7/10
is already complete and you proceed to wire-and-verify.

### Step 11.3 — Minimal implementation

**(a)** `packages/module-registry/src/index.ts` — add `resolveActiveModules` to
`BuiltInRouteDependencies` and use it in the chat wiring. Add the import for the type:

```ts
import type { ActiveModulesResolver } from "@jarv1s/ai";
```

Add to `BuiltInRouteDependencies` (after `listModuleManifests`):

```ts
  /**
   * Async, actor-filtered resolver (the enablement SEAM). Used by the tool surfaces
   * (MCP gateway + AI REST tools) and the route guard. Distinct from
   * listModuleManifests (the full registered set used by briefings + /api/modules).
   */
  readonly resolveActiveModules: ActiveModulesResolver;
```

Change the chat entry's `resolveActiveModules` from `deps.listModuleManifests` to
`deps.resolveActiveModules` (line 154):

```ts
        resolveActiveModules: deps.resolveActiveModules,
```

Change the AI module entry to pass `resolveActiveModules` (the AI routes switch to the actor-filtered
resolver in Step 11.3(c)). The AI entry currently is `registerRoutes: registerAiRoutes`. Change it
to explicit wiring:

```ts
  {
    manifest: aiModuleManifest,
    sqlMigrationDirectories: [aiModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: (server, deps) =>
      registerAiRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        resolveActiveModules: deps.resolveActiveModules
      })
  },
```

**(b)** `packages/ai/src/routes.ts` — switch the tool surfaces from `listModuleManifests` to the
async `resolveActiveModules`. Change `AiRoutesDependencies`:

```ts
export interface AiRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly resolveActiveModules: import("@jarv1s/ai").ActiveModulesResolver;
  readonly repository?: AiRepository;
  readonly secretCipher?: AiSecretCipher;
}
```

> Importing the type from `@jarv1s/ai` inside its own package is circular; instead import it from the
> gateway types directly: add `import type { ActiveModulesResolver } from "./gateway/types.js";` at
> the top and type the dep as `readonly resolveActiveModules: ActiveModulesResolver;`.

Update the three usages:

- `GET /api/ai/assistant-tools` (line ~362) — resolve modules for the actor inside the existing
  `withDataContext` and pass them to `listAssistantToolsFromManifests`:

```ts
        const tools = await dependencies.dataContext.withDataContext(accessContext, async () =>
          listAssistantToolsFromManifests(
            await dependencies.resolveActiveModules(accessContext.actorUserId)
          )
        );
```

- `POST /api/ai/assistant-tools/:name/invoke` — the two `dependencies.listModuleManifests()` calls
  (lines ~390 and ~429) become `await dependencies.resolveActiveModules(accessContext.actorUserId)`.
  `accessContext` is already in scope in that handler. Change:

```ts
        tool = findAssistantToolFromManifests(
          dependencies.listModuleManifests(),
          request.params.name
        );
```

to:

```ts
        const activeModules = await dependencies.resolveActiveModules(accessContext.actorUserId);
        tool = findAssistantToolFromManifests(activeModules, request.params.name);
```

and change:

```ts
        const manifestTool = dependencies
          .listModuleManifests()
          .flatMap((m) => m.assistantTools ?? [])
          .find((t) => t.name === selectedTool.name);
```

to:

```ts
        const manifestTool = activeModules
          .flatMap((m) => m.assistantTools ?? [])
          .find((t) => t.name === selectedTool.name);
```

> Remove the now-unused `listModuleManifests` field and the `JarvisModuleManifest` import if it is no
> longer referenced (typecheck will flag it). Keep `findAssistantToolFromManifests` /
> `listAssistantToolsFromManifests` — they accept a manifest array regardless of source.

**(c)** `apps/api/src/server.ts` — construct the resolver, pass it into
`registerBuiltInApiRoutes`, and after route registration register the guard + run the coverage
assertion.

Update the import from `@jarv1s/module-registry`:

```ts
import {
  createActiveModulesResolver,
  getBuiltInModuleManifests,
  registerBuiltInApiRoutes,
  registerRouteEnablementGuard,
  assertRouteCoverage,
  PLATFORM_UNGUARDED_ROUTES,
  type ChatEngineFactory
} from "@jarv1s/module-registry";
```

In `server.after()`, after `registerBuiltInApiRoutes(...)`, construct the resolver before the call
and add the guard + assertion. Replace the `registerBuiltInApiRoutes(server, {...})` block with:

```ts
    const resolveActiveModules = createActiveModulesResolver({
      dataContext,
      manifests: getBuiltInModuleManifests()
    });

    registerBuiltInApiRoutes(server, {
      rootDb: appDb,
      resolveAccessContext: authRuntime.resolveAccessContext,
      listConfiguredAuthProviders: authRuntime.listConfiguredProviders,
      listModuleManifests: getBuiltInModuleManifests,
      resolveActiveModules,
      dataContext,
      boss,
      chatEngineFactory: options.chatEngineFactory,
      revokeUserSessions: authRuntime.revokeUserSessions,
      bootstrapConnectionString: ownsAppDb ? getJarvisDatabaseUrls().bootstrap : undefined
    });

    // Register the route-enablement guard AFTER all routes exist so the onRequest hook
    // can read request.routeOptions.url (the matched pattern). The guard 404s a request
    // whose owning module is not active for the actor (never 403 — no existence leak).
    registerRouteEnablementGuard(server, {
      manifests: getBuiltInModuleManifests(),
      resolveActiveModules,
      resolveAccessContext: authRuntime.resolveAccessContext
    });
```

After `server.after()` registers everything, add an `onReady` hook that runs the coverage assertion
once the route tree is final. Add (next to the existing `onReady` boss-start hook):

```ts
  server.addHook("onReady", async () => {
    const registered = collectRegisteredRoutes(server);
    assertRouteCoverage({
      registered,
      manifests: getBuiltInModuleManifests(),
      platformAllowlist: PLATFORM_UNGUARDED_ROUTES
    });
  });
```

Add the route-collection helper at module scope (near the other top-level helpers). Use an
`onRoute` accumulator captured during `after()`, because `printRoutes` parsing is brittle. Replace
the approach: declare a `const registeredRoutes: { method: string; url: string }[] = [];` in
`createApiServer` BEFORE `server.after()`, add `server.addHook("onRoute", (route) => { ... })` to
accumulate, and have the `onReady` assertion read it. Concretely, inside `createApiServer` before
`server.after(...)`:

```ts
  const registeredRoutes: { method: string; url: string }[] = [];
  server.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    for (const method of methods) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      registeredRoutes.push({ method, url: routeOptions.url });
    }
  });
```

and the `onReady` assertion uses `registeredRoutes`:

```ts
  server.addHook("onReady", async () => {
    assertRouteCoverage({
      registered: registeredRoutes,
      manifests: getBuiltInModuleManifests(),
      platformAllowlist: PLATFORM_UNGUARDED_ROUTES
    });
  });
```

> Remove the separate `collectRegisteredRoutes` helper mentioned above — the `onRoute` accumulator
> replaces it. The `/api/auth/*` wildcard route registers with `url: "/api/auth/*"`. Add
> `routeKey("DELETE"|"GET"|"OPTIONS"|"PATCH"|"POST"|"PUT", "/api/auth/*")` for the auth methods to
> `PLATFORM_UNGUARDED_ROUTES` in Task 9 if the assertion flags `/api/auth/*`. VERIFY at build:
> run `auth-settings.test.ts` and read the assertion error; add each flagged route to the allowlist
> (platform) or the owning manifest. This is the in-scope reconciliation — budget for iterating here.

> **Auth wildcard note:** `/api/auth/*` is registered as one route with all HTTP methods. Add these
> to `PLATFORM_UNGUARDED_ROUTES`:
> ```ts
> routeKey("GET", "/api/auth/*"),
> routeKey("POST", "/api/auth/*"),
> routeKey("PATCH", "/api/auth/*"),
> routeKey("PUT", "/api/auth/*"),
> routeKey("DELETE", "/api/auth/*"),
> routeKey("OPTIONS", "/api/auth/*")
> ```
> (OPTIONS is filtered out of the accumulator, so it is harmless to include or omit.) Also add the
> connectors OAuth routes if any are not in the connectors manifest; the assertion will name them.

### Step 11.4 — Run (expected PASS)

```
pnpm db:migrate
vitest run tests/integration/route-guard.test.ts
vitest run tests/integration/auth-settings.test.ts
vitest run tests/integration/mcp-gateway.test.ts
vitest run tests/integration/chat-mcp-transport.test.ts
pnpm --filter @jarv1s/ai exec tsc --noEmit
pnpm --filter @jarv1s/module-registry exec tsc --noEmit
```

> If `auth-settings.test.ts` throws a coverage-assertion error, read the named routes and add each to
> `PLATFORM_UNGUARDED_ROUTES` (platform) or the owning module's manifest `routes[]`, then re-run.
> Iterate until clean. This is the expected reconciliation work (spec Risk #1).

### Step 11.5 — Commit

```
git add packages/module-registry/src/index.ts packages/ai/src/routes.ts apps/api/src/server.ts tests/integration/route-guard.test.ts
git commit -m "feat(api): wire async resolver + route-enablement guard + boot coverage assertion"
```

---

## Task 12 — Fix any remaining ripple call sites + run the per-package typechecks

Some call sites pass `AiRoutesDependencies` or `BuiltInRouteDependencies` outside the composition
root (e.g. AI integration tests construct `registerAiRoutes` directly). Update them to the new shape.

**Files**
- Modify: `tests/integration/ai-tools.test.ts` (and `ai.test.ts` if it constructs `registerAiRoutes`)
- Modify: any other test passing `listModuleManifests` to `registerAiRoutes`

### Step 12.1 — Write/adjust the failing test

Run the AI suites to discover which construct `registerAiRoutes` with the old `listModuleManifests`:

```
vitest run tests/integration/ai-tools.test.ts tests/integration/ai.test.ts
```

Each failure naming `listModuleManifests` / `resolveActiveModules` is the RED. For each such call
site, change `listModuleManifests: () => [...]` to
`resolveActiveModules: async () => [...]` (wrap the same manifest array in `async`).

### Step 12.2 — Run (expected FAIL)

```
vitest run tests/integration/ai-tools.test.ts tests/integration/ai.test.ts
```

Failures present (type/shape mismatch on the deps).

### Step 12.3 — Minimal implementation

In each affected test, replace the dependency. Example transformation (apply to every occurrence):

```ts
// before
registerAiRoutes(server, {
  resolveAccessContext,
  dataContext,
  listModuleManifests: () => [exampleToolModule]
});

// after
registerAiRoutes(server, {
  resolveAccessContext,
  dataContext,
  resolveActiveModules: async () => [exampleToolModule]
});
```

If a test relied on the REST tool surface always showing all modules regardless of actor, that
behavior is now actor-scoped — but with an empty deny store the active set equals the full set, so
the assertions hold unchanged.

### Step 12.4 — Run (expected PASS)

```
vitest run tests/integration/ai-tools.test.ts tests/integration/ai.test.ts
pnpm --filter @jarv1s/ai exec tsc --noEmit
```

### Step 12.5 — Commit

```
git add tests/integration/ai-tools.test.ts tests/integration/ai.test.ts
git commit -m "test(ai): update REST tool-surface stubs to async resolveActiveModules"
```

---

## Task 13 — Self-Review

Do not skip. Read the spec section-by-section against the diff (`git diff main...HEAD --stat` then
inspect each file). Confirm each acceptance criterion:

**Spec §-by-§ coverage**

- **Component 1 (CORE_VERSION + satisfiesCoreVersion):** Task 1. `CORE_VERSION="0.1.0"`,
  comparator + bare + `*` forms, fail-closed on garbage/`^`/`~`/`||`. ✔ AC #1.
- **Component 2 (store + repo methods):** Tasks 2, 3. Table schema (scope/module_id/user_id/
  disabled_by_user_id/timestamps), CHECK, partial unique indexes; four repo methods, each
  `assertDataContextDb` first line; admin methods write `admin_audit_events`
  (`module.instance_disable`/`module.instance_enable`), self method does not. ✔ AC #2 partial,
  #10.
- **Component 3 (migration + grants):** Task 2. `packages/settings/sql/0065_module_enablement.sql`
  (re-check prefix), `settingsModuleSqlMigrationDirectory` exported + wired; in-migration grants;
  idempotent. NOT in `infra/postgres/migrations/`. ✔ AC #3.
- **Component 4 (async resolver factory):** Task 6. `createActiveModulesResolver`, the four-rule
  filter, `withDataContext({actorUserId})`. ✔ AC #4, #6.
- **Component 5 (sync→async ripple):** Tasks 5, 11, 12. types.ts, gateway.ts, chat routes/runtime/
  manager, ai/routes.ts, module-registry wiring, server.ts, tests. ✔ AC #4.
- **Component 6 (keep both names):** Tasks 6, 11. `listModuleManifests` retained for briefings +
  `/api/modules`; `resolveActiveModules` for tool surfaces + guard. ✔
- **Component 7 (route guard):** Tasks 9, 11. onRequest hook, matched-pattern key, 404-not-403,
  allowlist pass-through, fail-closed on resolver throw. ✔ AC #7.
- **Component 8 (coverage assertion):** Tasks 7, 9, 11. `assertRouteCoverage` both directions;
  reconciliation of tasks + chat manifests + allowlist; runs at `onReady`. ✔ AC #8.
- **Component 9 (admin endpoints):** Task 10. `GET/PATCH /api/admin/modules[/:id]`, `assertAdminUser`,
  audited, reject required (409), unknown (404). ✔ AC #9.
- **Component 10 (self endpoints):** Task 10. `GET/PATCH /api/me/modules[/:id]`, owner-scoped, reject
  required (409) + `!supportsUserDisable` (422), unknown (404), `active` mirrors resolver. ✔ AC #9.
- **Zero behavior change (AC #5):** migration inserts no rows; empty store → full set; existing
  suites pass unchanged (Task 11 + final gate). Resolver baseline test (Task 6). ✔
- **Security & invariants:** DataContextDb-only (every new method asserts it); AccessContext shape
  unchanged (`{ actorUserId }`); RLS gates instance writes on `current_actor_is_admin()`, user rows
  owner-only; no `BYPASSRLS`; metadata-only audit; module isolation (store lives in settings, only
  settings queries `app.module_enablement`; module-registry is composition root); new migration in
  the owning module's `sql/` dir; required-floor triple-guarded. ✔

**Placeholder scan:** grep the diff for `TODO`, `FIXME`, `similar to above`, `...` (ellipsis in
code), `placeholder`. There must be none in shipped source. Run:

```
git diff main...HEAD -- 'packages/**' 'apps/**' | grep -nE "TODO|FIXME|placeholder|similar to above" || echo "clean"
```

**Type consistency:** `ActiveModulesResolver` is async everywhere; `ModuleEnablementRow` matches the
table; DTOs match schemas (`MyModuleDto`/`AdminModuleDto` ↔ `myModuleSchema`/`adminModuleSchema`);
`SetModuleDisabledInput` used consistently. Run all per-package typechecks:

```
pnpm typecheck
```

If anything fails, fix it in a follow-up commit on this branch:

```
git add <fixed paths>
git commit -m "fix(p2-enablement): self-review corrections"
```

---

## Task 14 — Final gate: `pnpm verify:foundation` + release hardening

**Files:** none (verification only).

### Step 14.1 — Run the full gate

```
pnpm db:up
pnpm verify:foundation
```

This runs lint (`eslint . --max-warnings=0`), `format:check`, `check:file-size` (no source file
>1000 lines), `typecheck`, `db:migrate` (idempotent), and `test:integration`. All must be green.

If `format:check` fails, run `pnpm format` and commit the formatting:

```
git add -p   # stage only the files this branch already touched
git commit -m "style(p2-enablement): prettier formatting"
```

> Never `git add -A`. Stage only files this branch authored. If a `check:file-size` failure appears
> (e.g. `packages/settings/src/routes.ts` approaching 1000 lines after the endpoints), decompose:
> extract the module-enablement endpoints into `packages/settings/src/module-enablement-routes.ts`
> exporting `registerModuleEnablementRoutes(server, deps)` and call it from `registerSettingsRoutes`.
> Re-run the gate after decomposition. (Settings routes.ts is ~542 lines + ~140 new = ~680, so it
> should stay under the limit, but verify with `pnpm check:file-size`.)

### Step 14.2 — Run release hardening

```
pnpm audit:release-hardening
```

Must be green. ✔ AC #11.

### Step 14.3 — Final verification statement

Confirm with real exit codes (never `| tail` that hides a non-zero exit). Capture the final lines of
both commands and confirm they report success. The branch is complete only when both
`pnpm verify:foundation` and `pnpm audit:release-hardening` exit 0.

### Step 14.4 — Commit (only if Step 14.1 produced formatting/decomposition changes)

If no changes were needed in Step 14, there is nothing to commit here — the branch is ready for PR.

---

## Acceptance criteria → task map (final check)

| AC | Tasks |
| --- | --- |
| 1 — CORE_VERSION + satisfiesCoreVersion | 1 |
| 2 — compat gate refuses incompatible built-in before wiring | 4 |
| 3 — settings-owned migration, RLS, grants, dir wired, idempotent | 2 |
| 4 — ActiveModulesResolver async at every call site | 5, 6, 11, 12 |
| 5 — zero behavior change with empty store | 2, 6, 11, 14 |
| 6 — layered required/instance/user rule | 6 |
| 7 — onRequest guard, 404-not-403, allowlist | 9, 11 |
| 8 — boot coverage assertion both directions; real server boots clean | 7, 9, 11 |
| 9 — admin + self endpoints, typed, reject required/!userDisable, audit | 8, 10 |
| 10 — db types: ModuleEnablementTable + Selectable; DataContextDb-only repo | 2, 3 |
| 11 — verify:foundation + release-hardening green; no file >1000 lines | 13, 14 |

## Out of scope (do not build)

`defaultEnabled:false` allow-list semantics; workspace-scoped disable; web admin/settings UI;
per-tool enablement; out-of-process/remote MCP; full node-semver ranges; making any current module
`required:false`. (Spec "Out of scope / deferred".)
