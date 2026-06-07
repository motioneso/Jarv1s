import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import pg from "pg";

import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { VaultContextRunner, readVaultFile, vaultFileExists, writeVaultFile } from "@jarv1s/vault";
import {
  CommitmentsRepository,
  EntitiesRepository,
  PreferencesRepository,
  VaultWriteBackService
} from "@jarv1s/structured-state";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const userId = "00000000-0000-4000-8000-000000000021";
const otherUserId = "00000000-0000-4000-8000-000000000022";

function ctx(actorUserId: string): AccessContext {
  return { actorUserId, requestId: "req:structured-state-test" };
}

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  const client = new Client({ connectionString: connectionStrings.bootstrap });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app.users (id, email, is_instance_admin)
       VALUES ($1, 'ss-a@example.test', false),
              ($2, 'ss-b@example.test', false)`,
      [userId, otherUserId]
    );
  } finally {
    await client.end();
  }
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  dataContext = new DataContextRunner(appDb);
});

afterAll(async () => {
  await appDb.destroy();
});

// ── CommitmentsRepository ─────────────────────────────────────────────────────

describe("CommitmentsRepository", () => {
  const repo = new CommitmentsRepository();

  it("owner can create and list their own commitments", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.create(scopedDb, {
        ownerUserId: userId,
        title: "Call Alice back",
        provenance: "volunteered"
      });
      const list = await repo.listVisible(scopedDb);
      expect(list.some((c) => c.title === "Call Alice back")).toBe(true);
    });
  });

  it("other user cannot see owner's commitment (private by default)", async () => {
    let title: string;
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      title = `Private-${randomUUID()}`;
      await repo.create(scopedDb, { ownerUserId: userId, title, provenance: "volunteered" });
    });
    const list = await dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
      repo.listVisible(scopedDb)
    );
    expect(list.every((c) => c.title !== title!)).toBe(true);
  });

  it("app.shares view grant makes commitment visible to grantee", async () => {
    let commitmentId: string;
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const c = await repo.create(scopedDb, {
        ownerUserId: userId,
        title: `Shared-${randomUUID()}`,
        provenance: "volunteered"
      });
      commitmentId = c.id;
      await sql`
        INSERT INTO app.shares (resource_type, resource_id, owner_user_id, grantee_user_id, level)
        VALUES ('commitment', ${commitmentId}::uuid, ${userId}::uuid, ${otherUserId}::uuid, 'view')
      `.execute(scopedDb.db);
    });
    const list = await dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
      repo.listVisible(scopedDb)
    );
    expect(list.some((c) => c.id === commitmentId!)).toBe(true);
  });

  it("revoking a share removes grantee visibility", async () => {
    let commitmentId: string;
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const c = await repo.create(scopedDb, {
        ownerUserId: userId,
        title: `Revoked-${randomUUID()}`,
        provenance: "volunteered"
      });
      commitmentId = c.id;
      await sql`
        INSERT INTO app.shares (resource_type, resource_id, owner_user_id, grantee_user_id, level)
        VALUES ('commitment', ${commitmentId}::uuid, ${userId}::uuid, ${otherUserId}::uuid, 'view')
      `.execute(scopedDb.db);
      await sql`
        DELETE FROM app.shares
        WHERE resource_id = ${commitmentId}::uuid AND grantee_user_id = ${otherUserId}::uuid
      `.execute(scopedDb.db);
    });
    const list = await dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
      repo.listVisible(scopedDb)
    );
    expect(list.every((c) => c.id !== commitmentId!)).toBe(true);
  });

  it("owner can update status of their commitment", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const c = await repo.create(scopedDb, {
        ownerUserId: userId,
        title: "Track status",
        provenance: "volunteered"
      });
      await repo.update(scopedDb, c.id, { status: "done" });
      const updated = await repo.get(scopedDb, c.id);
      expect(updated?.status).toBe("done");
    });
  });
});

// ── EntitiesRepository, PreferencesRepository, VaultWriteBackService describe blocks
// added in Tasks 4–6

// ── EntitiesRepository ────────────────────────────────────────────────────────

describe("EntitiesRepository", () => {
  const repo = new EntitiesRepository();

  it("owner can create and list their own entities", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.create(scopedDb, {
        ownerUserId: userId,
        type: "person",
        name: "Alice Smith",
        provenance: "volunteered"
      });
      const list = await repo.listVisible(scopedDb);
      expect(list.some((e) => e.name === "Alice Smith")).toBe(true);
    });
  });

  it("other user cannot see owner's entity (private by default)", async () => {
    let entityId: string;
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const e = await repo.create(scopedDb, {
        ownerUserId: userId,
        type: "person",
        name: `Private-${randomUUID()}`,
        provenance: "volunteered"
      });
      entityId = e.id;
    });
    const list = await dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
      repo.listVisible(scopedDb)
    );
    expect(list.every((e) => e.id !== entityId!)).toBe(true);
  });

  it("app.shares view grant makes entity visible to grantee", async () => {
    let entityId: string;
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const e = await repo.create(scopedDb, {
        ownerUserId: userId,
        type: "organization",
        name: `Shared-Org-${randomUUID()}`,
        provenance: "volunteered"
      });
      entityId = e.id;
      await sql`
        INSERT INTO app.shares (resource_type, resource_id, owner_user_id, grantee_user_id, level)
        VALUES ('entity', ${entityId}::uuid, ${userId}::uuid, ${otherUserId}::uuid, 'view')
      `.execute(scopedDb.db);
    });
    const list = await dataContext.withDataContext(ctx(otherUserId), (scopedDb) =>
      repo.listVisible(scopedDb)
    );
    expect(list.some((e) => e.id === entityId!)).toBe(true);
  });

  it("attributes are stored as JSONB and returned correctly", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const e = await repo.create(scopedDb, {
        ownerUserId: userId,
        type: "person",
        name: "Bob Jones",
        provenance: "volunteered",
        attributes: { email: "bob@example.test", role: "engineer" }
      });
      const fetched = await repo.get(scopedDb, e.id);
      expect(fetched?.attributes).toMatchObject({ email: "bob@example.test", role: "engineer" });
    });
  });

  it("vault_note_path is stored and returned", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const e = await repo.create(scopedDb, {
        ownerUserId: userId,
        type: "person",
        name: "Carol",
        provenance: "volunteered",
        vaultNotePath: "People/carol.md"
      });
      expect(e.vault_note_path).toBe("People/carol.md");
    });
  });
});
