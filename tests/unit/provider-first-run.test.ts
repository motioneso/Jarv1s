/**
 * provider-first-run (#342 chat): seed claude's first-run state so the engine-launched REPL
 * skips its onboarding wizard (login-method/theme) + per-folder trust dialog. Non-claude no-op.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureClaudeOnboarded,
  ensureProviderLaunchReady,
  trustClaudeProject
} from "../../packages/cli-runner/src/provider-first-run.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "jarv1s-firstrun-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const readCfg = async () =>
  JSON.parse(await readFile(path.join(home, ".claude.json"), "utf8")) as Record<string, unknown>;

describe("provider-first-run (#342 chat)", () => {
  it("seeds the global onboarding flags into a fresh ~/.claude.json", async () => {
    await ensureClaudeOnboarded(home);
    const cfg = await readCfg();
    expect(cfg.hasCompletedOnboarding).toBe(true);
    expect(cfg.bypassPermissionsModeAccepted).toBe(true);
    expect(cfg.theme).toBe("dark");
  });

  it("preserves claude's existing keys (only adds the missing onboarding flags)", async () => {
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({ userID: "abc", theme: "light" }),
      "utf8"
    );
    await ensureClaudeOnboarded(home);
    const cfg = await readCfg();
    expect(cfg.userID).toBe("abc");
    expect(cfg.theme).toBe("light"); // not overwritten when already set
    expect(cfg.hasCompletedOnboarding).toBe(true);
  });

  it("pre-trusts a working dir under projects[dir].hasTrustDialogAccepted", async () => {
    await trustClaudeProject(home, "/data/cli-auth/chat/session-xyz");
    const cfg = await readCfg();
    const projects = cfg.projects as Record<string, Record<string, unknown>>;
    expect(projects["/data/cli-auth/chat/session-xyz"]!.hasTrustDialogAccepted).toBe(true);
  });

  it("ensureProviderLaunchReady seeds onboarding + trust for anthropic", async () => {
    await ensureProviderLaunchReady(home, "anthropic", "/data/cli-auth/chat/s1");
    const cfg = await readCfg();
    expect(cfg.hasCompletedOnboarding).toBe(true);
    const projects = cfg.projects as Record<string, Record<string, unknown>>;
    expect(projects["/data/cli-auth/chat/s1"]!.hasTrustDialogAccepted).toBe(true);
  });

  it("ensureProviderLaunchReady is a NO-OP for non-claude providers (own first-run)", async () => {
    await ensureProviderLaunchReady(home, "openai-compatible", "/data/cli-auth/chat/s2");
    await ensureProviderLaunchReady(home, "google", "/data/cli-auth/chat/s3");
    await expect(readFile(path.join(home, ".claude.json"), "utf8")).rejects.toThrow();
  });
});
