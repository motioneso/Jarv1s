import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { AccessContext } from "@jarv1s/db";

export const vaultContextBrand: unique symbol = Symbol("VaultContext");

export interface VaultContext {
  readonly [vaultContextBrand]: true;
  readonly actorUserId: string;
  readonly vaultRoot: string;
}

export function assertVaultContext(value: unknown): asserts value is VaultContext {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<VaultContext>)[vaultContextBrand] !== true
  ) {
    throw new Error("Vault file access requires withVaultContext");
  }
}

export class VaultContextRunner {
  constructor(private readonly vaultsBaseDir: string) {}

  async withVaultContext<T>(
    accessContext: AccessContext,
    work: (ctx: VaultContext) => Promise<T>
  ): Promise<T> {
    const vaultRoot = join(this.vaultsBaseDir, accessContext.actorUserId);
    await mkdir(vaultRoot, { recursive: true, mode: 0o700 });

    return work({
      [vaultContextBrand]: true,
      actorUserId: accessContext.actorUserId,
      vaultRoot
    });
  }
}
