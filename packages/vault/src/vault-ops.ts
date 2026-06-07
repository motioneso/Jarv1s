import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
