import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  VaultContextError,
  VaultContextRunner,
  VaultPathError,
  deleteVaultFile,
  listVaultDirectories,
  listVaultFiles,
  makeVaultDir,
  readVaultFile,
  readVaultFileBytes,
  resolveVaultPath,
  vaultFileExists,
  writeVaultFile,
  writeVaultFileBytes
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
      expect(() => resolveVaultPath(ctx.vaultRoot, `../${userB}/secret.md`)).toThrow(
        VaultPathError
      );
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
  it("lists only owner-relative immediate directories and rejects traversal", async () => {
    await opsRunner.withVaultContext({ actorUserId: randomUUID() }, async (ctx) => {
      await makeVaultDir(ctx, "People/Family");
      await makeVaultDir(ctx, "Archive");
      await writeVaultFile(ctx, "not-a-directory.md", "file");
      await expect(listVaultDirectories(ctx)).resolves.toEqual([
        { name: "Archive", path: "Archive" },
        { name: "People", path: "People" }
      ]);
      await expect(listVaultDirectories(ctx, "People")).resolves.toEqual([
        { name: "Family", path: "People/Family" }
      ]);
      await expect(listVaultDirectories(ctx, "People/../Archive")).rejects.toThrow(VaultPathError);
      await expect(listVaultDirectories(ctx, ctx.vaultRoot)).rejects.toThrow(VaultPathError);
    });
  });

  it("writeVaultFile + readVaultFile round-trips content", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "notes/hello.md", "# Hello");
      const content = await readVaultFile(ctx, "notes/hello.md");
      expect(content).toBe("# Hello");
    });
  });

  // #1133 — chat attachments store raw bytes (images/PDFs) in the vault; the byte variants
  // must preserve non-UTF8 content exactly and keep the same 0600/traversal discipline.
  it("writeVaultFileBytes + readVaultFileBytes round-trips binary bytes (mode 0600)", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      // 0x89 0x50... = PNG magic; 0xFF/0xFE are invalid UTF-8 lead bytes — a utf8
      // string roundtrip would corrupt them, which is exactly what this guards against.
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]);
      await writeVaultFileBytes(ctx, "attachments/blob-test/blob", bytes);
      const readBack = await readVaultFileBytes(ctx, "attachments/blob-test/blob");
      expect(Buffer.compare(readBack, bytes)).toBe(0);
      const s = await stat(join(ctx.vaultRoot, "attachments/blob-test/blob"));
      expect(s.mode & 0o777).toBe(0o600);
    });
  });

  it("writeVaultFileBytes throws VaultPathError on traversal", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await expect(
        writeVaultFileBytes(ctx, "../outside/evil.bin", Buffer.from([1]))
      ).rejects.toThrow(VaultPathError);
      await expect(readVaultFileBytes(ctx, "../outside/evil.bin")).rejects.toThrow(VaultPathError);
    });
  });

  it("vaultFileExists returns false before write, true after", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      expect(await vaultFileExists(ctx, "notes/new.md")).toBe(false);
      await writeVaultFile(ctx, "notes/new.md", "content");
      expect(await vaultFileExists(ctx, "notes/new.md")).toBe(true);
    });
  });

  it("vaultFileExists returns false when a parent segment is a file", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "not-a-dir.md", "plain file");
      expect(await vaultFileExists(ctx, "not-a-dir.md/child.md")).toBe(false);
    });
  });

  it("vaultFileExists rethrows unexpected stat errors", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await writeVaultFile(ctx, "locked/secret.md", "secret");
      const lockedDir = join(ctx.vaultRoot, "locked");
      await chmod(lockedDir, 0o000);
      try {
        await expect(vaultFileExists(ctx, "locked/secret.md")).rejects.toMatchObject({
          code: "EACCES"
        });
      } finally {
        await chmod(lockedDir, 0o700);
      }
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
      await expect(writeVaultFile(ctx, "../outside/evil.md", "evil")).rejects.toThrow(
        VaultPathError
      );
    });
  });

  it("vaultFileExists throws VaultPathError on traversal (does not silently return false)", async () => {
    await opsRunner.withVaultContext({ actorUserId: opsUserId }, async (ctx) => {
      await expect(vaultFileExists(ctx, "../outside/secret.md")).rejects.toThrow(VaultPathError);
    });
  });
});

// ── VaultContextRunner actorUserId validation (#129) ─────────────────────────

const validationBase = join(tmpdir(), `jarv1s-vault-validation-${randomUUID()}`);

afterAll(async () => {
  await rm(validationBase, { recursive: true, force: true });
});

describe("VaultContextRunner actorUserId validation (#129)", () => {
  it("throws VaultContextError on empty actorUserId", async () => {
    const runner = new VaultContextRunner(validationBase);
    await expect(runner.withVaultContext({ actorUserId: "" }, async () => {})).rejects.toThrow(
      VaultContextError
    );
  });

  it("throws VaultContextError on whitespace-only actorUserId", async () => {
    const runner = new VaultContextRunner(validationBase);
    await expect(runner.withVaultContext({ actorUserId: "   " }, async () => {})).rejects.toThrow(
      VaultContextError
    );
  });

  it("accepts a valid actorUserId and returns the work result", async () => {
    const runner = new VaultContextRunner(validationBase);
    const result = await runner.withVaultContext(
      { actorUserId: "00000000-0000-4000-8000-000000000001" },
      async (ctx) => ctx.actorUserId
    );
    expect(result).toBe("00000000-0000-4000-8000-000000000001");
  });
});

// ── Symlink escape containment (#130) ────────────────────────────────────────

const symlinkBase = join(tmpdir(), `jarv1s-vault-symlink-${randomUUID()}`);

afterAll(async () => {
  await rm(symlinkBase, { recursive: true, force: true });
});

describe("symlink escape containment (#130)", () => {
  it("readVaultFile throws VaultPathError when path resolves through symlink to outside file", async () => {
    const outsideFile = join(symlinkBase, "outside.txt");
    await mkdir(symlinkBase, { recursive: true });
    await writeFile(outsideFile, "secret");
    const runner = new VaultContextRunner(join(symlinkBase, "vaults"));
    await runner.withVaultContext({ actorUserId: "user-a" }, async (ctx) => {
      const linkPath = join(ctx.vaultRoot, "escape-link");
      await symlink(outsideFile, linkPath);
      await expect(readVaultFile(ctx, "escape-link")).rejects.toThrow(VaultPathError);
    });
  });

  it("writeVaultFile throws VaultPathError when parent dir is a symlink to outside dir", async () => {
    const outsideDir = join(symlinkBase, "outside-dir");
    await mkdir(outsideDir, { recursive: true });
    const runner = new VaultContextRunner(join(symlinkBase, "vaults"));
    await runner.withVaultContext({ actorUserId: "user-b" }, async (ctx) => {
      const linkPath = join(ctx.vaultRoot, "escape-dir");
      await symlink(outsideDir, linkPath);
      await expect(writeVaultFile(ctx, "escape-dir/evil.txt", "pwned")).rejects.toThrow(
        VaultPathError
      );
    });
  });
});
