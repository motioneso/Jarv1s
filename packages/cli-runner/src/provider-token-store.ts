/**
 * provider-token-store (#363) — persists a provider's captured login token (claude's
 * `setup-token` output) 0600 in the cli-auth volume, and resolves it as that provider's
 * credential ENV for the §4.8 auth probe + the chat launch.
 *
 * CLAUDE-SCOPED (spec 2026-06-20): only `anthropic` uses this — codex/gemini persist their
 * own on-disk credentials at login. The token is a long-lived (~1yr) first-party credential:
 * NEVER log it, never surface it over RPC; it lives ONLY in the cli-auth volume (which the
 * api/worker/web do not mount), and is injected into claude invocations ONLY — never the
 * §7.2 global env passthrough (which would leak it into every codex/gemini CLI child).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RpcProviderKind } from "@jarv1s/chat/live";

const TOKEN_DIR = ".jarvis/cli-tokens";

/** The env var each provider's CLI reads its token from. Absent ⇒ provider is not token-based. */
const TOKEN_ENV_VAR: Partial<Record<RpcProviderKind, string>> = {
  anthropic: "CLAUDE_CODE_OAUTH_TOKEN"
};

/** True iff the provider authenticates via a captured env-var token (claude-scoped). */
export function isTokenProvider(provider: RpcProviderKind): boolean {
  return TOKEN_ENV_VAR[provider] !== undefined;
}

/** The 0600 token file path for a provider (under the cli-auth HOME base). */
export function providerTokenPath(homeBase: string, provider: RpcProviderKind): string {
  return path.join(homeBase, TOKEN_DIR, provider);
}

/** Persist a captured provider token 0600 (parent dir 0700), written atomically (temp + rename). */
export async function persistProviderToken(
  homeBase: string,
  provider: RpcProviderKind,
  token: string
): Promise<void> {
  const file = providerTokenPath(homeBase, provider);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, token, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

/** Read a persisted provider token, or undefined if none/empty/unreadable. */
export async function readProviderToken(
  homeBase: string,
  provider: RpcProviderKind
): Promise<string | undefined> {
  try {
    const raw = await readFile(providerTokenPath(homeBase, provider), "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The provider's CREDENTIAL ENV for claude-scoped injection (the §4.8 probe's `auth status`
 * run + the chat launch). Returns {} unless the provider is token-based AND a token is
 * persisted. This value is layered per-call over the sanitized env — NEVER the global
 * allowlist (§7.2).
 */
export async function readProviderCredentialEnv(
  homeBase: string,
  provider: RpcProviderKind
): Promise<NodeJS.ProcessEnv> {
  const key = TOKEN_ENV_VAR[provider];
  if (!key) return {};
  const token = await readProviderToken(homeBase, provider);
  return token ? { [key]: token } : {};
}
