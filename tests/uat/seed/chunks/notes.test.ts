import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VaultContextRunner, getVaultBaseDir, listVaultFilesRecursive } from "@jarv1s/vault";
import { createAppRuntimeRunner, createMigrationOwnerDb } from "../connections.js";
import { seedSoloAdmin } from "../admin.js";
import { seedNotesChunk } from "./notes.js";

let prevVaultRoot: string | undefined;

beforeAll(async () => {
  prevVaultRoot = process.env["JARVIS_VAULT_ROOT"];
  process.env["JARVIS_VAULT_ROOT"] = await mkdtemp(join(tmpdir(), "uat-seed-notes-"));
});

afterAll(() => {
  if (prevVaultRoot === undefined) delete process.env["JARVIS_VAULT_ROOT"];
  else process.env["JARVIS_VAULT_ROOT"] = prevVaultRoot;
});

describe("seedNotesChunk", () => {
  it("writes real markdown files through VaultContext", async () => {
    const migrationDb = createMigrationOwnerDb();
    const { userId } = await seedSoloAdmin(migrationDb);
    await migrationDb.destroy();

    const runner = createAppRuntimeRunner();
    await seedNotesChunk(runner, userId);

    const vaultRunner = new VaultContextRunner(getVaultBaseDir());
    await vaultRunner.withVaultContext({ actorUserId: userId }, async (vaultCtx) => {
      const files = await listVaultFilesRecursive(vaultCtx);
      const mdFiles = files.filter((f) => f.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThanOrEqual(3);
    });
  });
});
