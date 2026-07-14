import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TasksRepository } from "@jarv1s/tasks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UAT_ADMIN_EMAIL, UAT_SECOND_OWNER_EMAIL } from "./admin.js";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "./connections.js";
import { seedLevel } from "./levels.js";
import { UAT_SEED_BASE_TIMESTAMP } from "./timestamps.js";

// #1025: seedLevel("admin+data") composes the notes chunk, which writes real
// files through VaultContext — same JARVIS_VAULT_ROOT override as
// chunks/notes.test.ts, needed here because the real default (/data/vaults)
// doesn't exist on this dev host outside Docker.
let prevVaultRoot: string | undefined;

beforeAll(async () => {
  prevVaultRoot = process.env["JARVIS_VAULT_ROOT"];
  process.env["JARVIS_VAULT_ROOT"] = await mkdtemp(join(tmpdir(), "uat-seed-levels-"));
});

afterAll(() => {
  if (prevVaultRoot === undefined) delete process.env["JARVIS_VAULT_ROOT"];
  else process.env["JARVIS_VAULT_ROOT"] = prevVaultRoot;
});

describe("seedLevel", () => {
  it("bare seeds nothing beyond the migrated schema", async () => {
    await seedLevel({ level: "bare" });
    // no users/data — nothing further to assert beyond "did not throw"
  });

  it("admin+data excludes named chunks", async () => {
    await seedLevel({ level: "admin+data", excludeChunks: ["job-search"] });
    const db = createMigrationOwnerDb();
    try {
      const admin = await db
        .selectFrom("app.users")
        .selectAll()
        .where("email", "=", "uat-admin@jarv1s.local")
        .executeTakeFirstOrThrow();
      expect(admin.is_instance_admin).toBe(true);
    } finally {
      await db.destroy();
    }
  });

  it("seeds idempotent private data plus one explicit cross-user share", async () => {
    await seedLevel({ level: "multi-user", excludeChunks: ["job-search"] });
    await seedLevel({ level: "multi-user", excludeChunks: ["job-search"] });

    const migrationDb = createMigrationOwnerDb();
    let users: Array<{ id: string; email: string }>;
    try {
      users = await migrationDb
        .selectFrom("app.users")
        .select(["id", "email"])
        .where("email", "in", [UAT_ADMIN_EMAIL, UAT_SECOND_OWNER_EMAIL])
        .execute();
    } finally {
      await migrationDb.destroy();
    }
    expect(users).toHaveLength(2);

    const admin = users.find((user) => user.email === UAT_ADMIN_EMAIL)!;
    const owner2 = users.find((user) => user.email === UAT_SECOND_OWNER_EMAIL)!;
    const tasks = new TasksRepository();
    const runner = createAppRuntimeRunner();
    try {
      const { shared: adminShared, privateTask: adminPrivate } = await runner.withDataContext(
        { actorUserId: admin.id },
        async (scopedDb) => {
          const owned = await scopedDb.db
            .selectFrom("app.tasks")
            .selectAll()
            .where("owner_user_id", "=", admin.id)
            .where("source", "=", "uat-seed")
            .execute();
          expect(owned).toHaveLength(12);
          return {
            shared: owned.find((task) => task.external_key === "Draft Q1 planning doc")!,
            privateTask: owned.find((task) => task.external_key === "Review PR backlog")!
          };
        }
      );
      const owner2Private = await runner.withDataContext(
        { actorUserId: owner2.id },
        async (scopedDb) => {
          const owned = await scopedDb.db
            .selectFrom("app.tasks")
            .selectAll()
            .where("owner_user_id", "=", owner2.id)
            .where("source", "=", "uat-seed")
            .execute();
          expect(owned).toHaveLength(12);
          return owned.find((task) => task.external_key === "Review PR backlog")!;
        }
      );

      await runner.withDataContext({ actorUserId: admin.id }, async (scopedDb) => {
        await expect(tasks.getById(scopedDb, owner2Private.id)).resolves.toBeUndefined();
        const shares = await scopedDb.db
          .selectFrom("app.shares")
          .selectAll()
          .where("resource_type", "=", "task")
          .where("resource_id", "=", adminShared.id)
          .execute();
        expect(shares).toHaveLength(1);
        expect(shares[0]).toMatchObject({
          owner_user_id: admin.id,
          grantee_user_id: owner2.id,
          level: "view",
          created_at: UAT_SEED_BASE_TIMESTAMP,
          updated_at: UAT_SEED_BASE_TIMESTAMP
        });
      });
      await runner.withDataContext({ actorUserId: owner2.id }, async (scopedDb) => {
        await expect(tasks.getById(scopedDb, adminPrivate.id)).resolves.toBeUndefined();
        await expect(tasks.getById(scopedDb, adminShared.id)).resolves.toMatchObject({
          id: adminShared.id
        });
      });
    } finally {
      await runner.destroy();
    }
  });
});
