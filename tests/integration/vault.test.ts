import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  VaultContextRunner,
  VaultPathError,
  deleteVaultFile,
  listVaultFiles,
  makeVaultDir,
  readVaultFile,
  resolveVaultPath,
  vaultFileExists,
  writeVaultFile,
} from "@jarv1s/vault";

// ── resolveVaultPath ──────────────────────────────────────────────────────────

const pathRoot = join(tmpdir(), "jarv1s-test-vault-path");

describe("resolveVaultPath", () => {
  it("resolves a simple relative path", () => {
    const result = resolveVaultPath(pathRoot, "notes/daily.md");
    expect(result).toBe(join(pathRoot, "notes/daily.md"));
  });

  it("resolves vault root itself (e.g. for directory listing)", () => {
    const result = resolveVaultPath(pathRoot, ".");
    expect(result).toBe(pathRoot);
  });

  it("blocks parent directory traversal", () => {
    expect(() => resolveVaultPath(pathRoot, "../other-user/secret.md")).toThrow(VaultPathError);
  });

  it("blocks absolute paths outside root", () => {
    expect(() => resolveVaultPath(pathRoot, "/etc/passwd")).toThrow(VaultPathError);
  });

  it("blocks path that normalises outside the root", () => {
    expect(() => resolveVaultPath(pathRoot, "notes/../../outside")).toThrow(VaultPathError);
  });

  it("blocks empty path", () => {
    expect(() => resolveVaultPath(pathRoot, "")).toThrow(VaultPathError);
  });
});

// ── VaultContextRunner ────────────────────────────────────────────────────────

const ctxBase = join(tmpdir(), `jarv1s-vault-ctx-${randomUUID()}`);

afterAll(async () => {
  await rm(ctxBase, { recursive: true, force: true });
});

describe("VaultContextRunner", () => {
  const runner = new VaultContextRunner(ctxBase);

  it("creates per-user vault root on first withVaultContext (mode 0700)", async () => {
    const userId = randomUUID();
    await runner.withVaultContext({ actorUserId: userId }, async (ctx) => {
      const { statSync } = await import("node:fs");
      const s = statSync(ctx.vaultRoot);
      expect(s.isDirectory()).toBe(true);
      expect(s.mode & 0o777).toBe(0o700);
    });
  });

  it("mints VaultContext with correct actorUserId and vaultRoot", async () => {
    const userId = randomUUID();
    await runner.withVaultContext({ actorUserId: userId }, async (ctx) => {
      expect(ctx.actorUserId).toBe(userId);
      expect(ctx.vaultRoot).toBe(join(ctxBase, userId));
    });
  });

  it("user A context cannot reach user B vault via path traversal", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await runner.withVaultContext({ actorUserId: userA }, async (ctx) => {
      expect(() => resolveVaultPath(ctx.vaultRoot, `../${userB}/secret.md`)).toThrow(VaultPathError);
    });
  });

  it("admin context is scoped to admin's own vault root (no cross-user bypass)", async () => {
    const adminId = randomUUID();
    const otherUserId = randomUUID();
    await runner.withVaultContext({ actorUserId: adminId }, async (ctx) => {
      expect(() => resolveVaultPath(ctx.vaultRoot, `../${otherUserId}/private.md`)).toThrow(
        VaultPathError
      );
    });
  });
});

// ── vault file operations ─────────────────────────────────────────────────────

const opsBase = join(tmpdir(), `jarv1s-vault-ops-${randomUUID()}`);
const opsRunner = new VaultContextRunner(opsBase);
const opsUserId = randomUUID();

afterAll(async () => {
  await rm(opsBase, { recursive: true, force: true });
});

describe("vault file operations", () => {
  it("writeVaultFile + readVaultFile round-trips content", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "notes/hello.md", "# Hello");
      const content = await readVaultFile(ctx, "notes/hello.md");
      expect(content).toBe("# Hello");
    });
  });

  it("vaultFileExists returns false before write, true after", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      expect(await vaultFileExists(ctx, "notes/new.md")).toBe(false);
      await writeVaultFile(ctx, "notes/new.md", "content");
      expect(await vaultFileExists(ctx, "notes/new.md")).toBe(true);
    });
  });

  it("deleteVaultFile removes the file", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "notes/todelete.md", "bye");
      await deleteVaultFile(ctx, "notes/todelete.md");
      expect(await vaultFileExists(ctx, "notes/todelete.md")).toBe(false);
    });
  });

  it("listVaultFiles returns filenames of direct children in a directory", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "people/alice.md", "person A");
      await writeVaultFile(ctx, "people/bob.md", "person B");
      const files = await listVaultFiles(ctx, "people");
      expect(files.sort()).toEqual(["alice.md", "bob.md"].sort());
    });
  });

  it("makeVaultDir creates a subdirectory with mode 0700", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await makeVaultDir(ctx, "archive/2025");
      const { statSync } = await import("node:fs");
      const s = statSync(join(ctx.vaultRoot, "archive/2025"));
      expect(s.isDirectory()).toBe(true);
      expect(s.mode & 0o777).toBe(0o700);
    });
  });

  it("writeVaultFile creates intermediate directories automatically", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "deep/nested/path/file.md", "nested");
      const content = await readVaultFile(ctx, "deep/nested/path/file.md");
      expect(content).toBe("nested");
    });
  });

  it("readVaultFile throws VaultPathError on traversal", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await expect(readVaultFile(ctx, "../outside/secret.md")).rejects.toThrow(VaultPathError);
    });
  });

  it("writeVaultFile throws VaultPathError on traversal", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await expect(writeVaultFile(ctx, "../outside/evil.md", "evil")).rejects.toThrow(VaultPathError);
    });
  });

  it("vaultFileExists throws VaultPathError on traversal (does not silently return false)", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await expect(vaultFileExists(ctx, "../outside/secret.md")).rejects.toThrow(VaultPathError);
    });
  });
});
