/**
 * §7.2 sanitized-env allowlist: the CLI-subprocess env contains ONLY the allowlist and
 * NONE of the excluded secrets — crucially NOT the socket path or the RPC secret, and
 * not any app secret / DB URL / role password / vault path.
 */
import { describe, expect, it } from "vitest";

import { buildSanitizedCliEnv } from "../../packages/cli-runner/src/sanitized-env.js";

describe("buildSanitizedCliEnv (§7.2)", () => {
  const source: NodeJS.ProcessEnv = {
    // allowed
    HOME: "/data/cli-auth",
    PATH: "/usr/bin:/data/cli-tools/bin",
    NPM_CONFIG_PREFIX: "/data/cli-tools",
    JARVIS_CLI_TOOLS_PREFIX: "/data/cli-tools",
    JARVIS_CLI_HOME: "/data/cli-auth",
    JARVIS_CLI_HOME_BASE: "/data/cli-auth",
    JARVIS_CLI_NEUTRAL_BASE: "/data/cli-auth/chat",
    JARVIS_HOST_UID: "1000",
    JARVIS_HOST_GID: "1000",
    TERM: "xterm",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    TMPDIR: "/tmp",
    // EXCLUDED — socket + RPC secret + single-user flag (server-only)
    JARVIS_CLI_RUNNER_SOCKET: "/run/jarv1s/cli-runner.sock",
    JARVIS_CLI_RUNNER_RPC_SECRET: "super-secret",
    JARVIS_CLI_RUNNER_SINGLE_USER: "1",
    // EXCLUDED — app secrets
    BETTER_AUTH_SECRET: "x",
    JARVIS_AI_SECRET_KEY: "x",
    JARVIS_CONNECTOR_SECRET_KEY: "x",
    POSTGRES_PASSWORD: "x",
    JARVIS_APP_DATABASE_URL: "postgres://...",
    JARVIS_VAULT_ROOT: "/data/vaults"
  };

  it("keeps the allowlist (incl. LC_* prefix) and drops everything else", () => {
    const env = buildSanitizedCliEnv(source);
    // allowed
    expect(env.HOME).toBe("/data/cli-auth");
    expect(env.PATH).toContain("/data/cli-tools/bin");
    expect(env.JARVIS_CLI_NEUTRAL_BASE).toBe("/data/cli-auth/chat");
    expect(env.LC_ALL).toBe("en_US.UTF-8");
    expect(env.TERM).toBe("xterm");

    // EXCLUDED: socket path + RPC secret + single-user flag
    expect(env.JARVIS_CLI_RUNNER_SOCKET).toBeUndefined();
    expect(env.JARVIS_CLI_RUNNER_RPC_SECRET).toBeUndefined();
    expect(env.JARVIS_CLI_RUNNER_SINGLE_USER).toBeUndefined();

    // EXCLUDED: every app secret / DB URL / role password / vault path
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.JARVIS_AI_SECRET_KEY).toBeUndefined();
    expect(env.JARVIS_CONNECTOR_SECRET_KEY).toBeUndefined();
    expect(env.POSTGRES_PASSWORD).toBeUndefined();
    expect(env.JARVIS_APP_DATABASE_URL).toBeUndefined();
    expect(env.JARVIS_VAULT_ROOT).toBeUndefined();
  });

  it("does not leak unknown vars by default (deny-by-default)", () => {
    const env = buildSanitizedCliEnv({ SOME_RANDOM_VAR: "v", JARVIS_MULTIPLEXER: "tmux" });
    expect(env.SOME_RANDOM_VAR).toBeUndefined();
    // JARVIS_MULTIPLEXER is server spawn config, NOT for the CLI child (§7.2).
    expect(env.JARVIS_MULTIPLEXER).toBeUndefined();
  });
});
