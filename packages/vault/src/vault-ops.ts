import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { VaultContext } from "./vault-context.js";
import { resolveVaultPath } from "./vault-path.js";

export async function readVaultFile(ctx: VaultContext, relativePath: string): Promise<string> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  return readFile(fullPath, "utf8");
}

export async function writeVaultFile(
  ctx: VaultContext,
  relativePath: string,
  content: string
): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await mkdir(dirname(fullPath), { recursive: true, mode: 0o700 });
  await writeFile(fullPath, content, "utf8");
}

export async function listVaultFiles(ctx: VaultContext, relativeDir: string): Promise<string[]> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  const entries = await readdir(fullPath, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

export async function deleteVaultFile(ctx: VaultContext, relativePath: string): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  await rm(fullPath);
}

export async function vaultFileExists(ctx: VaultContext, relativePath: string): Promise<boolean> {
  // resolveVaultPath is called outside the try block so VaultPathError propagates
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
  try {
    await stat(fullPath);
    return true;
  } catch {
    return false;
  }
}

export async function makeVaultDir(ctx: VaultContext, relativeDir: string): Promise<void> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  await mkdir(fullPath, { recursive: true, mode: 0o700 });
}

async function collectFilesRecursive(dir: string, vaultRoot: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectFilesRecursive(entryPath, vaultRoot)));
    } else if (entry.isFile()) {
      result.push(relative(vaultRoot, entryPath));
    }
  }
  return result;
}

export async function listVaultFilesRecursive(
  ctx: VaultContext,
  relativeDir: string = "."
): Promise<string[]> {
  const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
  return collectFilesRecursive(fullPath, ctx.vaultRoot);
}

/**
 * Operator-level helper: removes the entire vault directory for a given userId.
 *
 * This is intentionally NOT scoped to a VaultContext (which belongs to a live
 * user session) — it is called during account deletion after the DB transaction
 * has committed. It is idempotent: no error is thrown if the directory does not
 * exist. The resolved path is checked to be strictly inside `vaultsBaseDir`
 * before deletion to prevent path traversal.
 *
 * Ordering rationale: call AFTER the DB commit. If the DB delete fails the
 * vault is untouched; if the vault rm fails the DB rows are already gone (the
 * user is effectively deleted) and the orphan can be retried or cleaned up
 * manually without risk of data inconsistency.
 */
export async function deleteUserVaultDir(vaultsBaseDir: string, userId: string): Promise<void> {
  const normalizedBase = resolve(vaultsBaseDir);
  const userVaultDir = resolve(join(vaultsBaseDir, userId));

  // Safety check: the resolved path must be strictly inside the base dir.
  // This mirrors the containment logic in resolveVaultPath.
  if (userVaultDir === normalizedBase || !userVaultDir.startsWith(normalizedBase + sep)) {
    throw new Error(
      `deleteUserVaultDir: resolved path ${JSON.stringify(userVaultDir)} is not inside vault base ${JSON.stringify(normalizedBase)}`
    );
  }

  await rm(userVaultDir, { recursive: true, force: true });
}
