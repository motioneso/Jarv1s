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
const resourceLevel = "30000000-0000-4000-8000-000000000002";
const resourceAdmin = "30000000-0000-4000-8000-000000000003";
const resourceForge = "30000000-0000-4000-8000-000000000005";

async function seedShare(resourceId: string, level = "view"): Promise<void> {
  await dataContext.withDataContext(ctx(ids.userA), async (scopedDb) => {
    await sql`
      insert into app.shares
        (resource_type, resource_id, owner_user_id, grantee_user_id, level)
      values
        (${"demo"}, ${resourceId}::uuid, ${ids.userA}::uuid, ${ids.userB}::uuid, ${level})
    `.execute(scopedDb.db);
  });
}

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
    await seedShare(resourceLevel, "view");

    await expect(canAccessRaw(ids.userB, "demo", resourceLevel, "contribute")).resolves.toBe(
      false
    );
  });

  it("does not grant an instance admin access by role alone", async () => {
    await seedShare(resourceAdmin, "view");

    await expect(canAccessRaw(ids.adminUser, "demo", resourceAdmin, "view")).resolves.toBe(false);
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

describe("shares typed table", () => {
  const resourceTyped = "30000000-0000-4000-8000-000000000010";
  const typedShareId = "31000000-0000-4000-8000-000000000001";

  it("inserts and selects through the typed Kysely table", async () => {
    const inserted = await dataContext.withDataContext(ctx(ids.userA), async (scopedDb) => {
      await scopedDb.db
        .insertInto("app.shares")
        .values({
          id: typedShareId,
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
