import { resolveMossEnv } from "@moss/db";

const DEFAULT_VAULT_BASE_DIR = "/data/vaults";

export function getVaultBaseDir(): string {
  return resolveMossEnv(process.env, "JARVIS_VAULT_ROOT") ?? DEFAULT_VAULT_BASE_DIR;
}
