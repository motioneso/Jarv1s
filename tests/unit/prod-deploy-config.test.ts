import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Static guards for the production deploy artifacts (branch-review "infra-deploy"
// batch). These are config-only LOW findings — no Docker/systemd runtime is needed
// to prove them; the bug is in the literal text of the committed files, so we assert
// against that text. Resolved relative to this test file so cwd does not matter.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");

const composeProd = read("infra/docker-compose.prod.yml");
const stackService = read("infra/systemd/jarv1s-stack.service");
const envExample = read("infra/env.production.example");

describe("prod deploy config — host CLI bridge removed for in-container CLI chat (#342 / ADR 0010)", () => {
  it("the host tmux-socket + CLI-home bridge mounts/env are fully gone", () => {
    // #342 reverses the host-native CLI topology (ADR 0010): api/worker no longer mount
    // the host tmux socket or the host ~/.claude|.codex|.gemini dirs — a dedicated
    // cli-runner sidecar forks its OWN tmux server in-container and owns all CLI data.
    // The old host-bridge env/mounts must be fully removed (the JARVIS_TMUX_SOCKET_DIR /
    // JARVIS_HOST_UID drift bug that branch-review #3 guarded no longer exists because the
    // var itself is gone). Replaces the obsolete "socket-dir derives from JARVIS_HOST_UID" guard.
    for (const token of [
      "JARVIS_TMUX_SOCKET_DIR",
      "JARVIS_HOST_CLAUDE_DIR",
      "JARVIS_HOST_CODEX_DIR",
      "JARVIS_HOST_GEMINI_DIR"
    ]) {
      expect(composeProd).not.toContain(token);
    }
  });

  it("runs cli-runner through the single jarv1s service while keeping RPC config", () => {
    expect(composeProd).toMatch(/^\s+jarv1s:/m);
    expect(composeProd).not.toMatch(/^\s+api:/m);
    expect(composeProd).not.toMatch(/^\s+worker:/m);
    expect(composeProd).not.toMatch(/^\s+web:/m);
    expect(composeProd).not.toMatch(/^\s+cli-runner:/m);
    expect(composeProd).toContain("JARVIS_CLI_RUNNER_SOCKET");
    expect(composeProd).toContain("JARVIS_CLI_RUNNER_RPC_SECRET");
    expect(composeProd).toContain("jarv1s-cli-auth:/data/cli-auth");
    expect(composeProd).toContain("jarv1s-cli-tools:/data/cli-tools");
  });
});

describe("prod deploy config — seed service drops root before touching the vault (#1217)", () => {
  it("the seed service runs as the runtime uid/gid, not root", () => {
    // #1217: seed has no user: override, so it runs fully as root (no USER directive in
    // the Dockerfile). tests/uat/seed/chunks/notes.ts creates the actor's vault dir via
    // VaultContextRunner while seed is running — root-owned — and start-jarv1s.ts's
    // prepareRuntimeDirs chown only ever reaches the top-level /data/vaults, and only
    // before seed runs, never after. Seed must run as the same uid/gid the jarv1s
    // service already uses so seeded vault content is never root-owned to begin with.
    const seedBlock = composeProd.match(/^ {2}seed:\n([\s\S]*?)(?=^ {2}\S)/m)?.[1];
    expect(seedBlock).toBeDefined();
    expect(seedBlock).toContain('user: "${JARVIS_HOST_UID:-1000}:${JARVIS_HOST_GID:-1000}"');
  });
});

describe("prod deploy config — systemd ExecStart uses docker --env-file (branch-review #2)", () => {
  it("ExecStart/ExecStop pass --env-file to docker instead of systemd EnvironmentFile", () => {
    const envFilePath = "~/Jarv1s/infra/env.production.local";

    const execStart = stackService.split("\n").find((line) => line.startsWith("ExecStart="));
    const execStop = stackService.split("\n").find((line) => line.startsWith("ExecStop="));
    expect(execStart).toBeDefined();
    expect(execStop).toBeDefined();

    // docker reads the env file directly (matches the documented manual deploy and
    // avoids systemd's `$`-mangling of generated secrets).
    expect(execStart).toContain(`--env-file ${envFilePath}`);
    expect(execStop).toContain(`--env-file ${envFilePath}`);

    // The brittle systemd EnvironmentFile= directive (the `$`-mangling source) is gone.
    expect(stackService).not.toMatch(/^EnvironmentFile=/m);
  });
});

describe("prod deploy config — superuser password single-source callout (branch-review #1)", () => {
  it("env example warns that POSTGRES_PASSWORD and the bootstrap URL password must match", () => {
    // The two places that carry the superuser secret must each cross-reference the
    // other so an operator cannot silently rotate one and break migrate auth.
    expect(envExample).toMatch(
      /MUST EQUAL the `postgres:<\.\.\.>` password in JARVIS_BOOTSTRAP_DATABASE_URL/
    );
    expect(envExample).toMatch(/MUST equal POSTGRES_PASSWORD/);
    // The "only on first volume init" semantics must be documented (the rotation trap).
    expect(envExample).toMatch(/first init|FIRST init|first volume init|FIRST volume init/i);
  });
});
