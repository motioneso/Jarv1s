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

describe("prod deploy config — tmux socket-dir derives from JARVIS_HOST_UID (branch-review #3)", () => {
  it("compose socket-dir defaults are derived from JARVIS_HOST_UID, never a bare /tmp/tmux-1000", () => {
    // Every JARVIS_TMUX_SOCKET_DIR default in the prod compose must derive the uid
    // suffix from JARVIS_HOST_UID so the two cannot drift. A hardcoded /tmp/tmux-1000
    // default (the old form) is the divergence bug we are guarding against.
    const socketDefaults = composeProd
      .split("\n")
      .filter((line) => line.includes("JARVIS_TMUX_SOCKET_DIR:-"));
    expect(socketDefaults.length).toBeGreaterThanOrEqual(2); // api + worker

    for (const line of socketDefaults) {
      expect(line).toContain("/tmp/tmux-${JARVIS_HOST_UID:-1000}");
    }
    // No service may keep the old bare-literal default.
    expect(composeProd).not.toContain("JARVIS_TMUX_SOCKET_DIR:-/tmp/tmux-1000}");
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
