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
  type DataContextDb,
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

// vault setup for write-back tests (add alongside existing afterAll)
const vaultBase = join(tmpdir(), `jarv1s-ss-vault-${randomUUID()}`);
const vaultRunner = new VaultContextRunner(vaultBase);

afterAll(async () => {
  await rm(vaultBase, { recursive: true, force: true });
});

// ── CommitmentsRepository ─────────────────────────────────────────────────────

describe("CommitmentsRepository", () => {
  const repo = new CommitmentsRepository();

  it("owner can create and list their own commitments", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.create(scopedDb, {
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
      await repo.create(scopedDb, { title, provenance: "volunteered" });
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
        title: "Track status",
        provenance: "volunteered"
      });
      await repo.update(scopedDb, c.id, { status: "done" });
      const updated = await repo.get(scopedDb, c.id);
      expect(updated?.status).toBe("done");
    });
  });
});

// ── EntitiesRepository ────────────────────────────────────────────────────────

describe("EntitiesRepository", () => {
  const repo = new EntitiesRepository();

  it("owner can create and list their own entities", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.create(scopedDb, {
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
        type: "person",
        name: "Carol",
        provenance: "volunteered",
        vaultNotePath: "People/carol.md"
      });
      expect(e.vault_note_path).toBe("People/carol.md");
    });
  });
});

// ── PreferencesRepository ─────────────────────────────────────────────────────

describe("PreferencesRepository", () => {
  const repo = new PreferencesRepository();

  it("upsert sets a preference and get returns it", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.upsert(scopedDb, "persona.name", "Jarvis");
      const value = await repo.get(scopedDb, "persona.name");
      expect(value).toBe("Jarvis");
    });
  });

  it("upsert overwrites an existing preference", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.upsert(scopedDb, "persona.tone", "formal");
      await repo.upsert(scopedDb, "persona.tone", "casual");
      const value = await repo.get(scopedDb, "persona.tone");
      expect(value).toBe("casual");
    });
  });

  it("get returns null for a key that has not been set", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      const value = await repo.get(scopedDb, "non.existent.key");
      expect(value).toBeNull();
    });
  });

  it("preferences are owner-only: other user cannot read them", async () => {
    await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
      await repo.upsert(scopedDb, "persona.directness", "high");
    });
    await dataContext.withDataContext(ctx(otherUserId), async (scopedDb) => {
      const value = await repo.get(scopedDb, "persona.directness");
      expect(value).toBeNull();
    });
  });
});

// ── VaultWriteBackService ─────────────────────────────────────────────────────

describe("VaultWriteBackService", () => {
  const entityRepo = new EntitiesRepository();
  const writeBack = new VaultWriteBackService();

  it("syncEntityToVault creates a vault file with YAML frontmatter for the entity", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
        const entity = await entityRepo.create(scopedDb, {
          type: "person",
          name: "Diana Prince",
          provenance: "volunteered",
          vaultNotePath: "People/diana.md"
        });
        await writeBack.syncEntityToVault(vaultCtx, entity);
        const content = await readVaultFile(vaultCtx, "People/diana.md");
        expect(content).toContain("jarvis_type: person");
        expect(content).toContain("name:");
        expect(content).toContain("Diana Prince");
        expect(content).toContain("provenance: volunteered");
      });
    });
  });

  it("syncEntityToVault preserves existing human-authored prose body", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      // Simulate user writing prose after initial sync
      await writeVaultFile(
        vaultCtx,
        "People/eve.md",
        `---\njarvis_id: old-id\n---\n\n# Eve\n\nEve is a security researcher.\n`
      );

      await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
        const entity = await entityRepo.create(scopedDb, {
          type: "person",
          name: "Eve Adams",
          provenance: "confirmed",
          vaultNotePath: "People/eve.md"
        });
        await writeBack.syncEntityToVault(vaultCtx, entity);
        const content = await readVaultFile(vaultCtx, "People/eve.md");
        // Machine-owned: updated frontmatter reflects new entity
        expect(content).toContain("Eve Adams");
        // Human-owned: user prose is preserved verbatim
        expect(content).toContain("Eve is a security researcher.");
        // Old frontmatter is replaced (not left alongside new)
        expect(content.indexOf("---")).not.toBe(content.lastIndexOf("---") - 3);
      });
    });
  });

  it("syncEntityToVault is a no-op when vault_note_path is null", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
        const entity = await entityRepo.create(scopedDb, {
          type: "person",
          name: "Frank No-Vault",
          provenance: "inferred"
          // no vaultNotePath
        });
        await writeBack.syncEntityToVault(vaultCtx, entity);
        // No file should have been created
        expect(await vaultFileExists(vaultCtx, "People/frank.md")).toBe(false);
      });
    });
  });

  it("updated entity name is reflected in frontmatter after re-sync (body unchanged)", async () => {
    await vaultRunner.withVaultContext(ctx(userId), async (vaultCtx) => {
      await dataContext.withDataContext(ctx(userId), async (scopedDb) => {
        const entity = await entityRepo.create(scopedDb, {
          type: "person",
          name: "Grace Hopper",
          provenance: "volunteered",
          vaultNotePath: "People/grace.md"
        });
        await writeBack.syncEntityToVault(vaultCtx, entity);

        // Simulate user adding prose
        const current = await readVaultFile(vaultCtx, "People/grace.md");
        await writeVaultFile(vaultCtx, "People/grace.md", current + "\n\nGrace invented COBOL.\n");

        // Update entity name
        const updated = await entityRepo.update(scopedDb, entity.id, {
          name: "Grace Murray Hopper"
        });
        await writeBack.syncEntityToVault(vaultCtx, updated!);

        const final = await readVaultFile(vaultCtx, "People/grace.md");
        expect(final).toContain("Grace Murray Hopper");
        expect(final).toContain("Grace invented COBOL.");
      });
    });
  });
});

// ── assertDataContextDb guards ────────────────────────────────────────────────

describe("assertDataContextDb guards — structured-state repos", () => {
  it("CommitmentsRepository.create throws on unbranded handle", async () => {
    const repo = new CommitmentsRepository();
    await expect(
      repo.create(appDb as unknown as DataContextDb, {
        title: "x",
        provenance: "volunteered"
      })
    ).rejects.toThrow("Repository access requires withDataContext");
  });

  it("EntitiesRepository.listVisible throws on unbranded handle", async () => {
    const repo = new EntitiesRepository();
    await expect(repo.listVisible(appDb as unknown as DataContextDb)).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });

  it("PreferencesRepository.upsert throws on unbranded handle", async () => {
    const repo = new PreferencesRepository();
    await expect(repo.upsert(appDb as unknown as DataContextDb, "k", "v")).rejects.toThrow(
      "Repository access requires withDataContext"
    );
  });
});
