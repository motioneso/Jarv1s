/**
 * provider-token-store (#363): round-trip, 0600/0700 modes, atomic overwrite, claude-scoped
 * credential env (anthropic only).
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isTokenProvider,
  persistProviderToken,
  providerTokenPath,
  readProviderCredentialEnv,
  readProviderToken
} from "../../packages/cli-runner/src/provider-token-store.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "jarv1s-token-store-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("provider-token-store (#363)", () => {
  it("round-trips a token and returns undefined when absent", async () => {
    expect(await readProviderToken(home, "anthropic")).toBeUndefined();
    await persistProviderToken(home, "anthropic", "sk-ant-oat-abc123");
    expect(await readProviderToken(home, "anthropic")).toBe("sk-ant-oat-abc123");
  });

  it("writes the token 0600 and the dir 0700", async () => {
    await persistProviderToken(home, "anthropic", "sk-ant-oat-xyz");
    const file = providerTokenPath(home, "anthropic");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await stat(path.dirname(file)).then((s) => s.mode & 0o777)).toBe(0o700);
  });

  it("overwrites atomically (a re-login replaces the token, no .tmp left behind)", async () => {
    await persistProviderToken(home, "anthropic", "first");
    await persistProviderToken(home, "anthropic", "second");
    expect(await readProviderToken(home, "anthropic")).toBe("second");
    await expect(stat(`${providerTokenPath(home, "anthropic")}.tmp`)).rejects.toThrow();
  });

  it("trims trailing whitespace and treats an empty file as absent", async () => {
    await persistProviderToken(home, "anthropic", "  sk-ant-oat-trim \n");
    expect(await readProviderToken(home, "anthropic")).toBe("sk-ant-oat-trim");
    await persistProviderToken(home, "anthropic", "   \n");
    expect(await readProviderToken(home, "anthropic")).toBeUndefined();
  });

  it("credential env is CLAUDE_CODE_OAUTH_TOKEN for anthropic only, and {} without a token", async () => {
    expect(await readProviderCredentialEnv(home, "anthropic")).toEqual({});
    await persistProviderToken(home, "anthropic", "sk-ant-oat-env");
    expect(await readProviderCredentialEnv(home, "anthropic")).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-env"
    });
    // Non-token providers never resolve a credential env (codex/gemini persist own creds).
    expect(isTokenProvider("anthropic")).toBe(true);
    expect(isTokenProvider("openai-compatible")).toBe(false);
    expect(isTokenProvider("google")).toBe(false);
    expect(await readProviderCredentialEnv(home, "openai-compatible")).toEqual({});
  });
});
