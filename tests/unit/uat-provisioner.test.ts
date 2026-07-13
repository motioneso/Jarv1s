import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import {
  bareSeedHook,
  findAvailablePort,
  generateUatRunId,
  UAT_DOCKER_SUBNET,
  UAT_PORT_RANGE_START,
  UAT_PORT_RANGE_SIZE,
  writeUatEnvFile
} from "../uat/provisioner.js";

describe("generateUatRunId", () => {
  it("produces a docker-safe project name prefixed uat-", () => {
    const { projectName, suffix } = generateUatRunId();
    expect(projectName).toBe(`uat-${suffix}`);
    // Compose project names must be lowercase alphanumeric + separators only.
    expect(projectName).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });

  it("generates distinct ids across calls (no collision on concurrent runs)", () => {
    const a = generateUatRunId();
    const b = generateUatRunId();
    expect(a.projectName).not.toBe(b.projectName);
  });
});

describe("reserved ranges", () => {
  it("uses a UAT subnet distinct from dev/prod (10.251.0.0/24) and smoke (10.253.0.0/24)", () => {
    expect(UAT_DOCKER_SUBNET).toBe("10.254.0.0/24");
  });

  it("reserves a 100-port UAT range starting at 20000, above the prod default (1533)", () => {
    expect(UAT_PORT_RANGE_START).toBe(20000);
    expect(UAT_PORT_RANGE_SIZE).toBe(100);
  });
});

describe("findAvailablePort", () => {
  it("returns the first candidate that is actually free", async () => {
    const port = await findAvailablePort([20000, 20001], async (p) => p === 20001);
    expect(port).toBe(20001);
  });

  it("skips a port that is really bound (EADDRINUSE) and returns the next", async () => {
    const server = createServer();
    await new Promise<void>((resolvePromise) => server.listen(20050, "127.0.0.1", resolvePromise));
    try {
      const port = await findAvailablePort([20050, 20051]);
      expect(port).toBe(20051);
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });

  it("throws when no candidate is free", async () => {
    await expect(findAvailablePort([20060], async () => false)).rejects.toThrow(
      /no available port/i
    );
  });
});

describe("writeUatEnvFile", () => {
  it("writes an env file pinning the chosen port, UAT subnet, and a stub embed provider", () => {
    const { path, cleanup } = writeUatEnvFile({ webPort: 20077 });
    try {
      const contents = readFileSync(path, "utf8");
      expect(contents).toContain("JARVIS_WEB_PORT=20077");
      expect(contents).toContain("JARVIS_DOCKER_SUBNET=10.254.0.0/24");
      // #1024/#1000: bare level has no users/data to embed, so the stub provider avoids an
      // unnecessary model download on every ephemeral run (spec §3.3 model-cache-volume note).
      expect(contents).toContain("JARVIS_EMBED_PROVIDER=stub");
      expect(contents).toContain("JARVIS_MIGRATION_DATABASE_URL=");
    } finally {
      cleanup();
    }
  });
});

describe("bareSeedHook", () => {
  it("is a no-op that resolves without touching the database", async () => {
    await expect(bareSeedHook({ projectName: "uat-test" })).resolves.toBeUndefined();
  });
});
