import { resolve, sep } from "node:path";

export class VaultPathError extends Error {
  constructor(relativePath: string) {
    super(`Vault path blocked (traversal or empty): ${JSON.stringify(relativePath)}`);
    this.name = "VaultPathError";
  }
}

export function resolveVaultPath(vaultRoot: string, relativePath: string): string {
  if (!relativePath) {
    throw new VaultPathError(relativePath);
  }

  const normalized = resolve(vaultRoot, relativePath);
  const normalizedRoot = resolve(vaultRoot);

  if (normalized !== normalizedRoot && !normalized.startsWith(normalizedRoot + sep)) {
    throw new VaultPathError(relativePath);
  }

  return normalized;
}
