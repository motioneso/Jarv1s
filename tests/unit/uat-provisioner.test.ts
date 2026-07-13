import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import {
  bareSeedHook,
  buildUatComposeArgs,
  createUatProvisionPlan,
  expectedUatVolumeNames,
  findAvailablePort,
  generateUatRunId,
  UAT_DOCKER_SUBNET,
  UAT_PORT_RANGE_START,
  UAT_PORT_RANGE_SIZE,
  uatComposeInterpolationEnv,
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
      // #1024/#1000: NODE_ENV=production means resolveKeyring enforces this (>=32 bytes) since
      // #918 Slice 2 — a real boot crash Task 7's live run caught (JARVIS_MODULE_CREDENTIAL_SECRET_KEY
      // is required in production and any non-development/test NODE_ENV).
      expect(contents).toContain("JARVIS_MODULE_CREDENTIAL_SECRET_KEY=");
    } finally {
      cleanup();
    }
  });
});

describe("uatComposeInterpolationEnv", () => {
  it("exports the same values the env file carries, for compose-file ${...} interpolation", () => {
    // #1024/#1000: env_file: never feeds compose YAML interpolation — only container env. Every
    // key here must match a `${KEY...}` reference in infra/docker-compose.prod.yml or the
    // provisioner would silently fall back to prod's port/subnet defaults, or hard-fail on the
    // two `:?`-required secrets (POSTGRES_PASSWORD, JARVIS_CLI_RUNNER_RPC_SECRET).
    const env = uatComposeInterpolationEnv({ webPort: 20077 });
    expect(env.JARVIS_WEB_PORT).toBe("20077");
    expect(env.JARVIS_DOCKER_SUBNET).toBe(UAT_DOCKER_SUBNET);
    expect(env.POSTGRES_PASSWORD).toBeTruthy();
    expect(env.JARVIS_CLI_RUNNER_RPC_SECRET).toBeTruthy();
  });
});

describe("bareSeedHook", () => {
  it("is a no-op that resolves without touching the database", async () => {
    await expect(
      bareSeedHook({ projectName: "uat-test", level: "bare" })
    ).resolves.toBeUndefined();
  });
});

describe("buildUatComposeArgs", () => {
  it("scopes every invocation to the project name and prod-shaped compose file", () => {
    expect(buildUatComposeArgs("uat-abc", ["up", "-d"])).toEqual([
      "compose",
      "-p",
      "uat-abc",
      "-f",
      "infra/docker-compose.prod.yml",
      "up",
      "-d"
    ]);
  });
});

describe("createUatProvisionPlan", () => {
  it("orders config-validate -> postgres up -> migrate -> jarv1s up, with down -v last", () => {
    const plan = createUatProvisionPlan({ projectName: "uat-abc", seedHook: async () => {} });
    const descriptions = plan.map((c) => c.description);
    expect(descriptions[0]).toMatch(/validate/i);
    expect(descriptions.at(-1)).toMatch(/teardown|down/i);
    const migrateIndex = plan.findIndex((c) => c.args.includes("migrate"));
    const jarv1sUpIndex = plan.findIndex((c) => c.args.includes("up") && c.args.includes("jarv1s"));
    expect(migrateIndex).toBeGreaterThan(-1);
    expect(jarv1sUpIndex).toBeGreaterThan(migrateIndex);
  });

  it("scopes the migrate step to the ops profile (matches docker-compose.prod.yml)", () => {
    const plan = createUatProvisionPlan({ projectName: "uat-abc", seedHook: async () => {} });
    const migrateCommand = plan.find((c) => c.args.includes("migrate"));
    expect(migrateCommand?.args).toEqual(
      expect.arrayContaining(["--profile", "ops", "run", "--rm", "migrate"])
    );
  });
});

describe("expectedUatVolumeNames", () => {
  it("derives the compose-scoped volume names for a project", () => {
    expect(expectedUatVolumeNames("uat-abc")).toEqual([
      "uat-abc_jarv1s-postgres-data",
      "uat-abc_jarv1s-vault-data",
      "uat-abc_jarv1s-model-cache",
      "uat-abc_jarv1s-cli-tools",
      "uat-abc_jarv1s-cli-auth",
      "uat-abc_jarv1s-cli-socket",
      "uat-abc_jarv1s-modules"
    ]);
  });
});
