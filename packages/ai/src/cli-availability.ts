import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type ProviderKind = "anthropic" | "openai-compatible" | "google";

export interface WhichDeps {
  which: (binary: string) => Promise<string | null>;
}

const PROVIDER_BINARY: Record<ProviderKind, string> = {
  anthropic: "claude",
  "openai-compatible": "codex",
  google: "agy"
};

async function defaultWhich(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`command -v ${binary}`);
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the CLI binary for the given provider kind is present on PATH.
 * No auth probing is performed — presence only.
 */
export async function cliAvailable(providerKind: ProviderKind, deps?: WhichDeps): Promise<boolean> {
  const binary = PROVIDER_BINARY[providerKind];
  const which = deps?.which ?? defaultWhich;
  const result = await which(binary);
  return result !== null;
}

/**
 * Returns true if the tmux binary is present on PATH.
 * No auth probing is performed — presence only.
 */
export async function tmuxAvailable(deps?: WhichDeps): Promise<boolean> {
  const which = deps?.which ?? defaultWhich;
  const result = await which("tmux");
  return result !== null;
}

/**
 * Returns true if the herdr binary is present on PATH.
 * No auth probing is performed — presence only (same posture as tmuxAvailable/cliAvailable).
 */
export async function herdrAvailable(deps?: WhichDeps): Promise<boolean> {
  const which = deps?.which ?? defaultWhich;
  const result = await which("herdr");
  return result !== null;
}
