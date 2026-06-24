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
 * codex (openai-compatible): on first launch in a working dir codex prompts
 * `Do you trust the contents of this directory?`, which the engine cannot drive and which
 * blocks the chat turn. Pre-trusting the neutral chat dir in `~/.codex/config.toml`
 * (`[projects."<dir>"] trust_level = "trusted"`) skips the prompt. The installer already
 * wrote `check_for_update_on_startup = false` there; the trust writer preserves it.
 *
 * Per-provider by nature — dispatched from {@link ensureProviderLaunchReady}.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProviderKind } from "@jarv1s/ai";

const CLAUDE_CONFIG = ".claude.json";
const CODEX_CONFIG_DIR = ".codex";
const CODEX_CONFIG = path.join(CODEX_CONFIG_DIR, "config.toml");

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
 * Pre-trust a session's working dir so codex's REPL skips its directory-trust prompt. Writes a
 * `[projects."<dir>"]` section with `trust_level = "trusted"` into `~/.codex/config.toml`.
 *
 * Narrow line-based appender (no full TOML parser dep): reads the existing config (the installer
 * wrote `check_for_update_on_startup = false`), appends the project section only when this dir's
 * section is absent, and never duplicates an existing section. Idempotent. Parent dirs are created
 * `0700`; the config is written `0600`.
 */
export async function trustCodexProject(homeBase: string, dir: string): Promise<void> {
  const configPath = path.join(homeBase, CODEX_CONFIG);
  let existing = "";
  try {
    existing = await readFile(configPath, "utf8");
  } catch {
    // missing config — the installer may not have run yet; we still seed trust.
  }

  const sectionHeader = `[projects.${JSON.stringify(dir)}]`;
  // Idempotency: a section for this exact dir already exists → no-op.
  if (existing.includes(sectionHeader)) return;

  const lines = existing.split("\n");
  // Trim a trailing blank line so the appended section is tight.
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();

  const section = `${sectionHeader}\ntrust_level = "trusted"\n`;
  const merged = lines.length > 0 ? `${lines.join("\n")}\n${section}` : section;

  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, merged, { encoding: "utf8", mode: 0o600 });
}

/**
 * Seed whatever first-run state a provider's CLI needs before the engine launches it in `dir`.
 * Generic entry point called on every launch; per-provider specifics live here (claude + codex;
 * gemini persists its own first-run state at login and no-ops).
 */
export async function ensureProviderLaunchReady(
  homeBase: string,
  provider: ProviderKind,
  dir: string
): Promise<void> {
  if (provider === "anthropic") {
    await ensureClaudeOnboarded(homeBase);
    await trustClaudeProject(homeBase, dir);
  } else if (provider === "openai-compatible") {
    await trustCodexProject(homeBase, dir);
  }
}
