/**
 * provider-first-run (#342 chat) — seed a provider CLI's FIRST-RUN state in the cli-auth
 * volume so the interactive chat REPL launches ready-to-chat instead of stopping on its
 * onboarding wizard.
 *
 * claude (anthropic): a fresh `~/.claude.json` makes the `claude` TUI run its first-run flow
 * — login-method selection (which blocks even with a valid CLAUDE_CODE_OAUTH_TOKEN), theme,
 * and a per-folder trust dialog — none of which the engine drives, so the chat turn times out.
 * Seeding `hasCompletedOnboarding`/theme (global) + `hasTrustDialogAccepted` (per working dir)
 * mirrors a completed first-run, so the token-authenticated REPL goes straight to the prompt.
 *
 * Per-provider by nature (codex/gemini have their own first-run, handled by their own
 * login/config) — dispatched from {@link ensureProviderLaunchReady}; non-claude providers no-op.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProviderKind } from "@jarv1s/ai";

const CLAUDE_CONFIG = ".claude.json";

type ClaudeConfig = Record<string, unknown> & {
  projects?: Record<string, Record<string, unknown>>;
};

async function readClaudeConfig(homeBase: string): Promise<ClaudeConfig> {
  try {
    return JSON.parse(await readFile(path.join(homeBase, CLAUDE_CONFIG), "utf8")) as ClaudeConfig;
  } catch {
    return {};
  }
}

async function writeClaudeConfig(homeBase: string, cfg: ClaudeConfig): Promise<void> {
  await mkdir(homeBase, { recursive: true });
  await writeFile(path.join(homeBase, CLAUDE_CONFIG), JSON.stringify(cfg, null, 2), {
    mode: 0o600
  });
}

/**
 * Mark claude's global first-run as complete so the REPL skips the login-method + theme prompts.
 * Idempotent; preserves every other key claude maintains. Safe pre-launch (claude is not running
 * for this session yet, and the §4.1.0a gate serializes launches).
 */
export async function ensureClaudeOnboarded(homeBase: string): Promise<void> {
  const cfg = await readClaudeConfig(homeBase);
  let changed = false;
  if (cfg.hasCompletedOnboarding !== true) {
    cfg.hasCompletedOnboarding = true;
    changed = true;
  }
  if (cfg.bypassPermissionsModeAccepted !== true) {
    cfg.bypassPermissionsModeAccepted = true;
    changed = true;
  }
  if (cfg.theme === undefined) {
    cfg.theme = "dark";
    changed = true;
  }
  if (changed) await writeClaudeConfig(homeBase, cfg);
}

/** Pre-trust a session's working dir so claude's REPL skips the per-folder trust dialog. */
export async function trustClaudeProject(homeBase: string, dir: string): Promise<void> {
  const cfg = await readClaudeConfig(homeBase);
  const projects = (cfg.projects ??= {});
  const proj = (projects[dir] ??= {});
  if (proj.hasTrustDialogAccepted !== true) {
    proj.hasTrustDialogAccepted = true;
    await writeClaudeConfig(homeBase, cfg);
  }
}

/**
 * Seed whatever first-run state a provider's CLI needs before the engine launches it in `dir`.
 * Generic entry point called on every launch; per-provider specifics live here (claude only for
 * now — codex/gemini persist their own first-run state at login and no-op).
 */
export async function ensureProviderLaunchReady(
  homeBase: string,
  provider: ProviderKind,
  dir: string
): Promise<void> {
  if (provider === "anthropic") {
    await ensureClaudeOnboarded(homeBase);
    await trustClaudeProject(homeBase, dir);
  }
}
