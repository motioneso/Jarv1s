# Shares Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `app.shares` table and `app.can_access()` SQL function — the per-resource sharing primitive that will replace workspaces — plus its Kysely types and a `SharesRepository`, without changing any existing module.

**Architecture:** A single generic `shares` table (`resource_type, resource_id, owner_user_id, grantee_user_id, level`) with `FORCE ROW LEVEL SECURITY`, a `SECURITY DEFINER` `app.can_access(type, id, level)` helper (mirroring the existing `app.has_resource_grant`) that RLS policies will call in later slices, and a `DataContextDb`-only repository for managing shares. Fully additive: nothing else consumes it yet, so the whole suite stays green.

**Tech Stack:** PostgreSQL (raw versioned SQL migrations), Kysely, TypeScript, Vitest integration tests against a real Postgres started by `pnpm db:up`.

**This is sub-plan 1 of 6 for Slice 1 (workspace→shares full teardown).** It builds the mechanism; later sub-plans convert each module's RLS to use it and finally remove workspaces and `workspace_id` from `AccessContext`.

**Prerequisite:** `pnpm db:up` is running. Run all `vitest`/`pnpm test:*` commands from the repo root.

---

### Task 1: `shares` table + `can_access()` migration

**Files:**

- Create: `tests/integration/shares.test.ts`
- Create: `infra/postgres/migrations/0017_shares.sql`
- Modify: `tests/integration/foundation.test.ts` (migration-list assertion)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/shares.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { connectionStrings, ids, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// Distinct resource ids per assertion group so the UNIQUE(resource_type,
// resource_id, grantee_user_id) constraint never makes tests interfere.
const resourceView = "30000000-0000-4000-8000-000000000001";
const resourceForge = "30000000-0000-4000-8000-000000000005";

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;

function ctx(actorUserId: string): AccessContext {
  return { actorUserId, requestId: "request:shares-test" };
}

async function seedUsers(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `
        INSERT INTO app.users (id, email, is_instance_admin)
        VALUES
          ($1, 'shares-a@example.test', false),
          ($2, 'shares-b@example.test', false),
          ($3, 'shares-admin@example.test', true)
      `,
      [ids.userA, ids.userB, ids.adminUser]
    );
  } finally {
    await client.end();
  }
}

async function canAccessRaw(
  actorUserId: string,
  resourceType: string,
  resourceId: string,
  level: string
): Promise<boolean> {
  return dataContext.withDataContext(ctx(actorUserId), async (scopedDb) => {
    const result = await sql<{ ok: boolean }>`
      select app.can_access(${resourceType}, ${resourceId}::uuid, ${level}) as ok
    `.execute(scopedDb.db);
    return result.rows[0]?.ok ?? false;
  });
}

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  await seedUsers();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  dataContext = new DataContextRunner(appDb);
});

afterAll(async () => {
  await appDb?.destroy();
});

describe("shares can_access + RLS (raw SQL)", () => {
  it("returns false before any share exists", async () => {
    await expect(canAccessRaw(ids.userB, "demo", resourceView, "view")).resolves.toBe(false);
  });

  it("grants view access to the grantee after the owner shares", async () => {
    await dataContext.withDataContext(ctx(ids.userA), async (scopedDb) => {
      await sql`
        insert into app.shares
          (resource_type, resource_id, owner_user_id, grantee_user_id, level)
        values
          (${"demo"}, ${resourceView}::uuid, ${ids.userA}::uuid, ${ids.userB}::uuid, ${"view"})
      `.execute(scopedDb.db);
    });

    await expect(canAccessRaw(ids.userB, "demo", resourceView, "view")).resolves.toBe(true);
  });

  it("does not satisfy a higher level than was granted", async () => {
    await expect(canAccessRaw(ids.userB, "demo", resourceView, "contribute")).resolves.toBe(false);
  });

  it("does not grant an instance admin access by role alone", async () => {
    await expect(canAccessRaw(ids.adminUser, "demo", resourceView, "view")).resolves.toBe(false);
  });

  it("forbids inserting a share that claims another user as owner", async () => {
    await expect(
      dataContext.withDataContext(ctx(ids.userB), async (scopedDb) => {
        await sql`
          insert into app.shares
            (resource_type, resource_id, owner_user_id, grantee_user_id, level)
          values
            (${"demo"}, ${resourceForge}::uuid, ${ids.userA}::uuid, ${ids.userB}::uuid, ${"view"})
        `.execute(scopedDb.db);
      })
    ).rejects.toThrow(/row-level security/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration -- tests/integration/shares.test.ts`
Expected: FAIL — errors like `relation "app.shares" does not exist` / `function app.can_access(...) does not exist`.

- [ ] **Step 3: Create the migration**

Create `infra/postgres/migrations/0017_shares.sql`:

```sql
CREATE TABLE IF NOT EXISTS app.shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (length(btrim(resource_type)) > 0),
  resource_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  grantee_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('view', 'contribute', 'manage')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shares_no_self_grant CHECK (owner_user_id <> grantee_user_id),
  UNIQUE (resource_type, resource_id, grantee_user_id)
);

CREATE INDEX IF NOT EXISTS shares_grantee_lookup_idx
  ON app.shares (resource_type, resource_id, grantee_user_id, level);

CREATE INDEX IF NOT EXISTS shares_owner_idx
  ON app.shares (owner_user_id);

CREATE OR REPLACE FUNCTION app.share_level_rank(p_level text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'view' THEN 1
    WHEN 'contribute' THEN 2
    WHEN 'manage' THEN 3
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION app.can_access(
  p_resource_type text,
  p_resource_id uuid,
  p_level text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT app.current_actor_user_id() IS NOT NULL
    AND app.share_level_rank(p_level) > 0
    AND EXISTS (
      SELECT 1
      FROM shares s
      WHERE s.resource_type = p_resource_type
        AND s.resource_id = p_resource_id
        AND s.grantee_user_id = app.current_actor_user_id()
        AND app.share_level_rank(s.level) >= app.share_level_rank(p_level)
    );
$$;

REVOKE ALL ON FUNCTION app.share_level_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.can_access(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.share_level_rank(text)
  TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT EXECUTE ON FUNCTION app.can_access(text, uuid, text)
  TO jarvis_app_runtime, jarvis_worker_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.shares TO jarvis_app_runtime;

ALTER TABLE app.shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.shares FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shares_select ON app.shares;
CREATE POLICY shares_select ON app.shares
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR grantee_user_id = app.current_actor_user_id()
  )
);

DROP POLICY IF EXISTS shares_insert ON app.shares;
CREATE POLICY shares_insert ON app.shares
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS shares_update ON app.shares;
CREATE POLICY shares_update ON app.shares
FOR UPDATE
TO jarvis_app_runtime
USING (owner_user_id = app.current_actor_user_id())
WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS shares_delete ON app.shares;
CREATE POLICY shares_delete ON app.shares
FOR DELETE
TO jarvis_app_runtime
USING (owner_user_id = app.current_actor_user_id());
```

Note: `can_access` is `SECURITY DEFINER` and owned by `jarvis_migration_owner`, so it reads `shares` regardless of the caller's table grants — the worker role gets `EXECUTE` on it without any direct `shares` grant, exactly like `app.has_resource_grant`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:integration -- tests/integration/shares.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Update the foundation migration-list assertion**

The new core migration changes the ledger. In `tests/integration/foundation.test.ts`, find the `expect(migrations.rows).toEqual([...])` array (ends with `{ version: "0016", name: "0016_ai_assistant_actions.sql" }`) and add one entry after it:

```typescript
        { version: "0016", name: "0016_ai_assistant_actions.sql" },
        { version: "0017", name: "0017_shares.sql" }
```

(Add a comma after the `0016` line and append the `0017` line, as shown.)

- [ ] **Step 6: Run the affected suites to verify they pass**

Run: `pnpm test:integration -- tests/integration/foundation.test.ts tests/integration/shares.test.ts`
Expected: PASS — foundation migration-list test green with 0017 present, shares tests green.

- [ ] **Step 7: Commit**

```bash
git add infra/postgres/migrations/0017_shares.sql tests/integration/shares.test.ts tests/integration/foundation.test.ts
git commit -m "feat(db): add shares table and can_access() sharing primitive"
```

---

### Task 2: Kysely types for `shares`

**Files:**

- Modify: `packages/db/src/types.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to `tests/integration/shares.test.ts` (after the existing `describe`). It exercises the typed table through Kysely, which only compiles once the types exist:

```typescript
describe("shares typed table", () => {
  const resourceTyped = "30000000-0000-4000-8000-000000000010";

  it("inserts and selects through the typed Kysely table", async () => {
    const inserted = await dataContext.withDataContext(ctx(ids.userA), async (scopedDb) => {
      await scopedDb.db
        .insertInto("app.shares")
        .values({
          resource_type: "demo",
          resource_id: resourceTyped,
          owner_user_id: ids.userA,
          grantee_user_id: ids.userB,
          level: "manage",
          created_at: new Date(),
          updated_at: new Date()
        })
        .execute();

      return scopedDb.db
        .selectFrom("app.shares")
        .selectAll()
        .where("resource_id", "=", resourceTyped)
        .executeTakeFirstOrThrow();
    });

    expect(inserted.level).toBe("manage");
    expect(inserted.owner_user_id).toBe(ids.userA);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm typecheck`
Expected: FAIL — TypeScript errors that `"app.shares"` is not assignable to the known table names (the table is not in `JarvisDatabase`).

- [ ] **Step 3: Add the types**

In `packages/db/src/types.ts`:

3a. Add the level union near the other visibility/status unions (e.g., right after `export type NoteVisibility = ...`):

```typescript
export type ShareLevel = "view" | "contribute" | "manage";
```

3b. Add the table interface (place it near `ResourceGrantsTable`):

```typescript
export interface SharesTable {
  id: string;
  resource_type: string;
  resource_id: string;
  owner_user_id: string;
  grantee_user_id: string;
  level: ShareLevel;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}
```

3c. Register the table in the `JarvisDatabase` interface, after the `"app.resource_grants": ResourceGrantsTable;` line:

```typescript
  "app.resource_grants": ResourceGrantsTable;
  "app.shares": SharesTable;
```

3d. Add the `Selectable` export near `export type ResourceGrant = ...`:

```typescript
export type Share = Selectable<SharesTable>;
```

- [ ] **Step 4: Run typecheck + the test to verify they pass**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test:integration -- tests/integration/shares.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/types.ts tests/integration/shares.test.ts
git commit -m "feat(db): add Kysely types for the shares table"
```

---

### Task 3: `SharesRepository`

**Files:**

- Create: `packages/db/src/sharing/shares-repository.ts`
- Create: `packages/db/src/sharing/index.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `package.json` (add `test:shares` script)
- Modify: `tests/integration/shares.test.ts` (repository tests)

- [ ] **Step 1: Write the failing test**

Add to the top imports of `tests/integration/shares.test.ts`:

```typescript
import { SharesRepository } from "@jarv1s/db";
```

Add this `describe` block at the end of `tests/integration/shares.test.ts`:

```typescript
describe("SharesRepository", () => {
  const repository = new SharesRepository();
  const resourceRepo = "30000000-0000-4000-8000-000000000020";
  const resourceUpgrade = "30000000-0000-4000-8000-000000000021";
  const resourceRevoke = "30000000-0000-4000-8000-000000000022";

  it("grants a share the grantee can then access", async () => {
    await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      repository.grant(scopedDb, {
        resourceType: "demo",
        resourceId: resourceRepo,
        ownerUserId: ids.userA,
        granteeUserId: ids.userB,
        level: "contribute"
      })
    );

    const granteeCanContribute = await dataContext.withDataContext(ctx(ids.userB), (scopedDb) =>
      repository.canAccess(scopedDb, "demo", resourceRepo, "contribute")
    );
    const ownerCanList = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      repository.listForResource(scopedDb, "demo", resourceRepo)
    );

    expect(granteeCanContribute).toBe(true);
    expect(ownerCanList).toHaveLength(1);
    expect(ownerCanList[0]?.grantee_user_id).toBe(ids.userB);
  });

  it("upgrades an existing share on re-grant", async () => {
    await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      repository.grant(scopedDb, {
        resourceType: "demo",
        resourceId: resourceUpgrade,
        ownerUserId: ids.userA,
        granteeUserId: ids.userB,
        level: "view"
      })
    );
    await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      repository.grant(scopedDb, {
        resourceType: "demo",
        resourceId: resourceUpgrade,
        ownerUserId: ids.userA,
        granteeUserId: ids.userB,
        level: "manage"
      })
    );

    const canManage = await dataContext.withDataContext(ctx(ids.userB), (scopedDb) =>
      repository.canAccess(scopedDb, "demo", resourceUpgrade, "manage")
    );
    const shares = await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      repository.listForResource(scopedDb, "demo", resourceUpgrade)
    );

    expect(canManage).toBe(true);
    expect(shares).toHaveLength(1);
  });

  it("revokes access", async () => {
    await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      repository.grant(scopedDb, {
        resourceType: "demo",
        resourceId: resourceRevoke,
        ownerUserId: ids.userA,
        granteeUserId: ids.userB,
        level: "view"
      })
    );
    await dataContext.withDataContext(ctx(ids.userA), (scopedDb) =>
      repository.revoke(scopedDb, {
        resourceType: "demo",
        resourceId: resourceRevoke,
        granteeUserId: ids.userB
      })
    );

    const stillHasAccess = await dataContext.withDataContext(ctx(ids.userB), (scopedDb) =>
      repository.canAccess(scopedDb, "demo", resourceRevoke, "view")
    );

    expect(stillHasAccess).toBe(false);
  });

  it("fails loudly when called without the data-context wrapper", async () => {
    await expect(repository.listForResource({} as never, "demo", resourceRepo)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm typecheck`
Expected: FAIL — `SharesRepository` is not exported from `@jarv1s/db`.

- [ ] **Step 3: Create the repository**

Create `packages/db/src/sharing/shares-repository.ts`:

```typescript
import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import type { DataContextDb } from "../data-context.js";
import { assertDataContextDb } from "../data-context.js";
import type { Share, ShareLevel } from "../types.js";

export interface GrantShareInput {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly ownerUserId: string;
  readonly granteeUserId: string;
  readonly level: ShareLevel;
}

export interface RevokeShareInput {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly granteeUserId: string;
}

export class SharesRepository {
  async grant(scopedDb: DataContextDb, input: GrantShareInput): Promise<Share> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.shares")
      .values({
        id: randomUUID(),
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        owner_user_id: input.ownerUserId,
        grantee_user_id: input.granteeUserId,
        level: input.level,
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.columns(["resource_type", "resource_id", "grantee_user_id"]).doUpdateSet({
          level: input.level,
          updated_at: now
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listForResource(
    scopedDb: DataContextDb,
    resourceType: string,
    resourceId: string
  ): Promise<Share[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.shares")
      .selectAll()
      .where("resource_type", "=", resourceType)
      .where("resource_id", "=", resourceId)
      .orderBy("created_at")
      .execute();
  }

  async revoke(scopedDb: DataContextDb, input: RevokeShareInput): Promise<void> {
    assertDataContextDb(scopedDb);

    await scopedDb.db
      .deleteFrom("app.shares")
      .where("resource_type", "=", input.resourceType)
      .where("resource_id", "=", input.resourceId)
      .where("grantee_user_id", "=", input.granteeUserId)
      .execute();
  }

  async canAccess(
    scopedDb: DataContextDb,
    resourceType: string,
    resourceId: string,
    level: ShareLevel
  ): Promise<boolean> {
    assertDataContextDb(scopedDb);

    const result = await sql<{ ok: boolean }>`
      select app.can_access(${resourceType}, ${resourceId}::uuid, ${level}) as ok
    `.execute(scopedDb.db);

    return result.rows[0]?.ok ?? false;
  }
}
```

- [ ] **Step 4: Create the sharing barrel and export it**

Create `packages/db/src/sharing/index.ts`:

```typescript
export * from "./shares-repository.js";
```

In `packages/db/src/index.ts`, add the export (keep the list alphabetical — after `./migrations/sql-runner.js`):

```typescript
export * from "./migrations/sql-runner.js";
export * from "./sharing/index.js";
```

- [ ] **Step 5: Add the focused test script**

In `package.json`, add a `test:shares` line in `scripts`, next to the other `test:*` entries (e.g., right before `"test:notes"`):

```json
    "test:shares": "vitest run tests/integration/shares.test.ts",
```

- [ ] **Step 6: Run typecheck + tests to verify they pass**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test:shares`
Expected: PASS (10 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/sharing package.json tests/integration/shares.test.ts packages/db/src/index.ts
git commit -m "feat(db): add SharesRepository for managing per-resource shares"
```

---

### Task 4: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full maintainability + integration gate**

Run: `pnpm verify:foundation`
Expected: PASS — lint, format:check, check:file-size, typecheck, db:migrate (reports `0017_shares.sql` applied on a fresh DB, or "already current" on a second run), and all integration tests including the new `shares.test.ts`.

- [ ] **Step 2: If `format:check` fails, fix and re-run**

Run: `pnpm format` then `pnpm verify:foundation`
Expected: PASS.

- [ ] **Step 3: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: formatting for shares foundation"
```

(Skip this commit if Step 1 passed with no changes.)

---

## Self-Review

- **Spec coverage:** Implements the spec's `shares { resource_type, resource_id, owner_user_id, grantee_user_id, level }` table, the `app.can_access(type, id, level)` helper, "private by default; sharing explicit, per-resource, revocable," and `FORCE ROW LEVEL SECURITY`. Does _not_ yet touch `AccessContext`, module RLS, or workspace removal — those are sub-plans 2–6, by design.
- **Placeholder scan:** none — every step has exact code/commands.
- **Type consistency:** `ShareLevel`, `SharesTable`, `Share`, `"app.shares"`, `SharesRepository`, `GrantShareInput`, `RevokeShareInput`, `grant`/`listForResource`/`revoke`/`canAccess` are used identically across tasks. `app.can_access(text, uuid, text)` and `app.share_level_rank(text)` signatures match between the migration and the repository's raw SQL call.
- **Green-throughout check:** Task 1 adds a migration + updates the one test that asserts the migration list. No existing module reads `shares`, so no other suite changes. Additive by construction.
