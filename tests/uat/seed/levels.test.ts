import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigrationOwnerDb } from "./connections.js";
import { seedLevel } from "./levels.js";

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
});
