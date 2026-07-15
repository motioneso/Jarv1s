export { VaultPathError, resolveVaultPath } from "./vault-path.js";
export {
  VaultContextError,
  assertVaultContext,
  VaultContextRunner,
  vaultContextBrand
} from "./vault-context.js";
export type { VaultContext } from "./vault-context.js";
export { getVaultBaseDir } from "./vault-config.js";
export {
  deleteUserVaultDir,
  deleteVaultFile,
  listVaultFiles,
  listVaultDirectories,
  listVaultFilesRecursive,
  makeVaultDir,
  readVaultFile,
  vaultFileExists,
  writeVaultFile
} from "./vault-ops.js";
export type { VaultDirectoryEntry } from "./vault-ops.js";
