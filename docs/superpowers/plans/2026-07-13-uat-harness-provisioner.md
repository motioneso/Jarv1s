# UAT Harness Phase 1 — Ephemeral-Instance Provisioner — Implementation Plan

> **For agentic workers:** This plan is executed inline by the build agent itself using
> superpowers:test-driven-development, task by task — `subagent-driven-development` /
> `executing-plans` are disabled in this repo per `coordinated-build`. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Build `tests/uat/provisioner.ts` — the ephemeral prod-shaped Compose instance
provisioner for issue #1024 (Part of epic #1000), proving provision + teardown mechanics at
`bare` level (zero seed data) before any seed script exists.

**Architecture:** A single module exporting pure, unit-testable planning/allocation functions
(run-id/project-name generation, reserved-port probing, env-file assembly, Compose command-list
construction, leak-verification) plus a `main()` CLI entrypoint (mirrors
`scripts/smoke-compose.ts`'s own entrypoint pattern) that actually drives `docker compose`
against `infra/docker-compose.prod.yml` end to end: `config --quiet` → `up postgres --wait` →
`run --rm migrate` (profile `ops`) → **seed hook point** (no-op in Phase 1) → `up jarv1s --wait`
→ port-discover + health-poll `/health/ready` → `down -v` in a `try/finally` (+ `SIGINT`/`SIGTERM`
handlers) so a crashed run never leaks containers/volumes/networks.

**Tech Stack:** tsx (Node ESM script), `node:child_process` spawn (matches `smoke-compose.ts`),
`node:net` for the port bind-probe, `node:crypto` `randomBytes` (matches
`scripts/test-integration.ts`'s entropy-suffix pattern), vitest for unit tests, real `docker
compose` CLI (no docker SDK dependency — matches existing precedent).

## Global Constraints

- **Scope: Phase 1 only.** Do NOT build the seed script, level ladder, or Playwright harness —
  those are #1025/#1026. The seed hook point stays a typed no-op.
- **Base compose file:** `infra/docker-compose.prod.yml` (prod-shaped), never
  `infra/docker-compose.yml` (dev) — per spec §3.1, the dev compose never runs
  `scripts/start-jarv1s.ts`'s migrate→reconcile boot path.
- **Local / coordinator-only.** No CI wiring, no Docker-in-Docker. This runs on the dev box only.
- **Do NOT build the template-DB clone optimization (§4.5).** Provision-per-run first; measure
  and record real wall-clock in the PR body instead.
- **Real github.com/githubusercontent.com egress is allowed** at test time — the provisioner
  must not block or mock outbound network (not directly exercised by Phase 1's `bare` level, but
  don't add anything that would prevent it).
- **No BYPASSRLS on runtime roles, ever.** The privileged-connection seam (Task 3) is scaffolding
  for #1025's migration-owner-class seed connection — it must never touch `app_runtime` /
  worker-role grants. Why-comment citing this invariant at the seam.
- **No new migration. Do not touch `foundation-schema-catalog`** — this harness provisions a real
  DB via Compose; it adds no schema of its own.
- **Comment density:** generous why-comments citing **#1024 / #1000** at every non-obvious guard
  (port/subnet allocation, teardown trap, volume naming, the privileged-connection seam) — this
  repo's CLAUDE.md calls for rich comments in code even though chat/PR prose stays terse.
- **Guardrails:** stage only this task's files (no `git add -A`); never touch
  `docs/coordination/`; never run repo-wide `pnpm format` (format only touched files).
- **Reserved ranges used by this plan** (must not collide with existing precedent):
  `JARVIS_DOCKER_SUBNET` default is `10.251.0.0/24` (dev/prod), smoke uses `10.253.0.0/24`
  (`scripts/smoke-compose.ts:117`) → **UAT reserves `10.254.0.0/24`**. Host port range: prod
  default is `1533` (`JARVIS_WEB_PORT`) → **UAT reserves `20000`–`20099`**, chosen via bind-probe
  (see Task 2 rationale — this deviates from the spec's "preferred" Docker-assigned-port option
  because it needs zero edits to the prod-shaped compose file; flagged to the coordinator in the
  plan-approval message).

---

## File Structure

- **Create `tests/uat/provisioner.ts`** — the whole Phase 1 deliverable: pure helpers + Compose
  plan builder + `main()` runner. Single file (matches `scripts/smoke-compose.ts`'s size/shape;
  splitting further would be premature for ~250 lines of code).
- **Create `tests/unit/uat-provisioner.test.ts`** — unit tests for every pure/testable export
  (no Docker required to run this file; it's part of `pnpm test:unit`, which IS in
  `verify:foundation`).
- **Modify `package.json`** — add one script, `"uat:provision:smoke": "tsx tests/uat/provisioner.ts"`,
  for manual/coordinator-invoked runs (mirrors `smoke:compose:prod`).

## Interfaces (shared across tasks)

```typescript
// tests/uat/provisioner.ts

export interface UatRunId {
  readonly projectName: string; // `uat-${suffix}`
  readonly suffix: string; // `${process.pid}_${randomHex8}`
}
export function generateUatRunId(): UatRunId;

export const UAT_DOCKER_SUBNET = "10.254.0.0/24";
export const UAT_PORT_RANGE_START = 20000;
export const UAT_PORT_RANGE_SIZE = 100;

export function findAvailablePort(
  candidates: readonly number[],
  probe?: (port: number) => Promise<boolean> // injected for tests; defaults to a real net.createServer bind-probe
): Promise<number>;

export interface UatEnvFile {
  readonly path: string;
  readonly cleanup: () => void;
}
export function writeUatEnvFile(input: {
  readonly webPort: number;
  readonly tmpDirPrefix?: string; // test seam, defaults to "jarv1s-uat-"
}): UatEnvFile;

export type UatSeedLevel = "bare"; // Phase 1 supports only "bare"; #1025 adds the ladder
export type SeedHook = (ctx: { readonly projectName: string }) => Promise<void>;
export const bareSeedHook: SeedHook;

export interface UatComposeCommand {
  readonly args: readonly string[];
  readonly command: "docker";
  readonly description: string;
}
export function buildUatComposeArgs(
  projectName: string,
  extra: readonly string[]
): readonly string[];
export function createUatProvisionPlan(input: {
  readonly projectName: string;
  readonly seedHook: SeedHook;
}): readonly UatComposeCommand[];

export function expectedUatVolumeNames(projectName: string): readonly string[];
export function assertNoLeakedResources(projectName: string): Promise<void>; // throws if containers or volumes still exist

// main() — full live lifecycle, real docker compose, invoked directly (tsx entrypoint guard)
```

---

## Task 1: Run-id / project-name generation + reserved subnet/port constants

**Files:**
- Create: `tests/uat/provisioner.ts`
- Test: `tests/unit/uat-provisioner.test.ts`

**Interfaces:**
- Produces: `UatRunId`, `generateUatRunId()`, `UAT_DOCKER_SUBNET`, `UAT_PORT_RANGE_START`,
  `UAT_PORT_RANGE_SIZE` (used by every later task).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/uat-provisioner.test.ts
import { describe, expect, it } from "vitest";
import { generateUatRunId, UAT_DOCKER_SUBNET, UAT_PORT_RANGE_START, UAT_PORT_RANGE_SIZE } from "../uat/provisioner.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/uat-provisioner.test.ts`
Expected: FAIL — `tests/uat/provisioner.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// tests/uat/provisioner.ts
import { randomBytes } from "node:crypto";

export interface UatRunId {
  readonly projectName: string;
  readonly suffix: string;
}

/**
 * #1024/#1000: mirrors scripts/test-integration.ts's `${pid}_${randomHex}` entropy suffix so a
 * local UAT run and a concurrent coordinator UAT run never collide on the same Compose project
 * name (spec §3.2) — Compose project names scope every container/volume/network it creates.
 */
export function generateUatRunId(): UatRunId {
  const suffix = `${process.pid}_${randomBytes(4).toString("hex")}`;
  return { projectName: `uat-${suffix}`, suffix };
}

// #1024/#1000: dev/prod default is 10.251.0.0/24 (infra/docker-compose.prod.yml), smoke reserves
// 10.253.0.0/24 (scripts/smoke-compose.ts:117) — UAT reserves its own /24 so a concurrent
// dev+smoke+UAT run never IP-collides on the Docker bridge (spec §3.4).
export const UAT_DOCKER_SUBNET = "10.254.0.0/24";

// #1024/#1000: prod's fixed host port is 1533 (JARVIS_WEB_PORT default). Rather than editing the
// prod-shaped compose file to support a Docker-assigned ephemeral port (spec §3.4 option 2), Phase
// 1 reserves a narrow high port range and bind-probes it (Task 2) — zero compose-file changes,
// same technique already used for JARVIS_DOCKER_SUBNET.
export const UAT_PORT_RANGE_START = 20000;
export const UAT_PORT_RANGE_SIZE = 100;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/uat-provisioner.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/uat/provisioner.ts tests/unit/uat-provisioner.test.ts
git commit -m "feat(uat): add run-id generation and reserved subnet/port constants (#1024)"
```

---

## Task 2: Reserved-port bind-probe (`findAvailablePort`)

**Files:**
- Modify: `tests/uat/provisioner.ts`
- Test: `tests/unit/uat-provisioner.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `findAvailablePort(candidates, probe?)` — used by Task 3 (env-file writer) and
  `main()` (Task 6) to pick `JARVIS_WEB_PORT`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/unit/uat-provisioner.test.ts
import { createServer } from "node:net";
import { findAvailablePort } from "../uat/provisioner.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/uat-provisioner.test.ts`
Expected: FAIL — `findAvailablePort` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to tests/uat/provisioner.ts
import { createServer } from "node:net";

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolvePromise(true));
    });
  });
}

/**
 * #1024/#1000: probes UAT_PORT_RANGE candidates in order and returns the first free one. A
 * `probe` override is accepted purely so unit tests can force a deterministic outcome without
 * relying on real OS port state; production callers omit it and get the real bind-probe.
 */
export async function findAvailablePort(
  candidates: readonly number[],
  probe: (port: number) => Promise<boolean> = isPortFree
): Promise<number> {
  for (const candidate of candidates) {
    if (await probe(candidate)) {
      return candidate;
    }
  }
  throw new Error(`no available port found among candidates: ${candidates.join(", ")}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/uat-provisioner.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/uat/provisioner.ts tests/unit/uat-provisioner.test.ts
git commit -m "feat(uat): add reserved-port bind-probe (#1024)"
```

---

## Task 3: Env-file writer + privileged-connection seam (no-op seed hook)

**Files:**
- Modify: `tests/uat/provisioner.ts`
- Test: `tests/unit/uat-provisioner.test.ts`

**Interfaces:**
- Consumes: `UAT_DOCKER_SUBNET` (Task 1).
- Produces: `writeUatEnvFile(input)`, `UatEnvFile`, `SeedHook`, `bareSeedHook`, `UatSeedLevel`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/unit/uat-provisioner.test.ts
import { readFileSync } from "node:fs";
import { bareSeedHook, writeUatEnvFile } from "../uat/provisioner.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/uat-provisioner.test.ts`
Expected: FAIL — `writeUatEnvFile`/`bareSeedHook` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to tests/uat/provisioner.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface UatEnvFile {
  readonly path: string;
  readonly cleanup: () => void;
}

/**
 * #1024/#1000: same shape as scripts/smoke-compose.ts's ensureProdSmokeEnv (throwaway
 * env.production.local + dev-only secrets), but scoped to the UAT subnet/port and pinned to the
 * `stub` embed provider for the `bare` level (no users → nothing to embed → no reason to pull the
 * real embedding model into a per-run, per-project model-cache volume; spec §3.3).
 */
export function writeUatEnvFile(input: { readonly webPort: number }): UatEnvFile {
  const dir = mkdtempSync(join(tmpdir(), "jarv1s-uat-"));
  const path = join(dir, "env.production.local");
  writeFileSync(
    path,
    [
      "NODE_ENV=production",
      `JARVIS_WEB_PORT=${input.webPort}`,
      `JARVIS_DOCKER_SUBNET=${UAT_DOCKER_SUBNET}`,
      "POSTGRES_PASSWORD=postgres",
      "JARVIS_BOOTSTRAP_DATABASE_URL=postgres://postgres:postgres@postgres:5432/jarv1s",
      // #1024/#1000: jarvis_migration_owner is NOSUPERUSER/NOBYPASSRLS but schema-owner + a
      // member of jarvis_auth_runtime (infra/postgres/bootstrap/0000_roles.sql) — this is the
      // seam #1025's seed script plugs a privileged connection into. NEVER grant BYPASSRLS to
      // jarvis_app_runtime / jarvis_worker_runtime — that would violate the project's hard "no
      // BYPASSRLS on runtime roles" invariant.
      "JARVIS_MIGRATION_DATABASE_URL=postgres://jarvis_migration_owner:uat-migration-pw@postgres:5432/jarv1s",
      "JARVIS_APP_DATABASE_URL=postgres://jarvis_app_runtime:uat-app-pw@postgres:5432/jarv1s",
      "JARVIS_AUTH_DATABASE_URL=postgres://jarvis_auth_runtime:uat-auth-pw@postgres:5432/jarv1s",
      "JARVIS_WORKER_DATABASE_URL=postgres://jarvis_worker_runtime:uat-worker-pw@postgres:5432/jarv1s",
      "BETTER_AUTH_SECRET=uat-only-not-a-real-secret-00000000000",
      "JARVIS_CONNECTOR_SECRET_KEY=00000000000000000000000000000000",
      "JARVIS_AI_SECRET_KEY=11111111111111111111111111111111",
      "JARVIS_CLI_RUNNER_RPC_SECRET=uat-only-not-real",
      "JARVIS_EMBED_PROVIDER=stub",
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  return { path, cleanup: () => rmSync(dir, { force: true, recursive: true }) };
}

export type UatSeedLevel = "bare";

export type SeedHook = (ctx: { readonly projectName: string }) => Promise<void>;

// #1024/#1000: Phase 1 ships zero seed data by design (spec §8.1 acceptance = bare level only).
// #1025 replaces this with a real seed script that opens its own privileged
// JARVIS_MIGRATION_DATABASE_URL connection (see the seam above) — this hook point exists so that
// swap is additive, not a rewrite of the provision/teardown lifecycle.
export const bareSeedHook: SeedHook = async () => {};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/uat-provisioner.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/uat/provisioner.ts tests/unit/uat-provisioner.test.ts
git commit -m "feat(uat): add env-file writer and privileged-connection seam (#1024)"
```

---

## Task 4: Compose plan builder + volume-name/leak verification

**Files:**
- Modify: `tests/uat/provisioner.ts`
- Test: `tests/unit/uat-provisioner.test.ts`

**Interfaces:**
- Consumes: `SeedHook` (Task 3).
- Produces: `buildUatComposeArgs`, `createUatProvisionPlan`, `expectedUatVolumeNames`,
  `assertNoLeakedResources` (used by `main()` in Task 6).

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/unit/uat-provisioner.test.ts
import {
  buildUatComposeArgs,
  createUatProvisionPlan,
  expectedUatVolumeNames
} from "../uat/provisioner.js";

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
    const jarv1sUpIndex = plan.findIndex(
      (c) => c.args.includes("up") && c.args.includes("jarv1s")
    );
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/uat-provisioner.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to tests/uat/provisioner.ts
export interface UatComposeCommand {
  readonly args: readonly string[];
  readonly command: "docker";
  readonly description: string;
}

const UAT_COMPOSE_FILE = "infra/docker-compose.prod.yml";

// #1024/#1000: every docker invocation MUST go through this so project-name scoping (and
// therefore volume/network isolation, spec §3.3) can never be forgotten at a call site.
export function buildUatComposeArgs(
  projectName: string,
  extra: readonly string[]
): readonly string[] {
  return ["compose", "-p", projectName, "-f", UAT_COMPOSE_FILE, ...extra];
}

/**
 * #1024/#1000: spec §3.2's exact invocation shape — config validate, postgres up, migrate (ops
 * profile), seed hook, jarv1s up, teardown. `down -v` is always last so a caller that iterates
 * this array and stops early on failure still knows what MUST run in its `finally` (Task 6 does
 * exactly that rather than iterating this array to completion on error).
 */
export function createUatProvisionPlan(input: {
  readonly projectName: string;
  readonly seedHook: SeedHook;
}): readonly UatComposeCommand[] {
  const { projectName } = input;
  return [
    {
      command: "docker",
      args: buildUatComposeArgs(projectName, ["config", "--quiet"]),
      description: "Validate Docker Compose configuration"
    },
    {
      command: "docker",
      args: buildUatComposeArgs(projectName, ["up", "-d", "postgres", "--wait"]),
      description: "Start Postgres and wait for readiness"
    },
    {
      command: "docker",
      args: buildUatComposeArgs(projectName, ["--profile", "ops", "run", "--rm", "migrate"]),
      description: "Run database migrations"
    },
    {
      command: "docker",
      args: buildUatComposeArgs(projectName, ["up", "-d", "jarv1s", "--wait"]),
      description: "Start Jarv1s and wait for readiness"
    },
    {
      command: "docker",
      args: buildUatComposeArgs(projectName, ["down", "-v"]),
      description: "Tear down the UAT stack and its volumes"
    }
  ];
}

// #1024/#1000: Compose auto-scopes named volumes as `<project>_<volume>` — this list exists so
// assertNoLeakedResources can positively confirm `down -v` actually removed every one of them,
// not just that the command exited 0 (spec §3.3's "clean by construction" claim, verified).
export function expectedUatVolumeNames(projectName: string): readonly string[] {
  return [
    "jarv1s-postgres-data",
    "jarv1s-vault-data",
    "jarv1s-model-cache",
    "jarv1s-cli-tools",
    "jarv1s-cli-auth",
    "jarv1s-cli-socket",
    "jarv1s-modules"
  ].map((volume) => `${projectName}_${volume}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/uat-provisioner.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/uat/provisioner.ts tests/unit/uat-provisioner.test.ts
git commit -m "feat(uat): add compose plan builder and volume-name derivation (#1024)"
```

---

## Task 5: `assertNoLeakedResources` (live Docker check, not unit-tested against a real daemon)

**Files:**
- Modify: `tests/uat/provisioner.ts`

**Interfaces:**
- Consumes: `expectedUatVolumeNames` (Task 4).
- Produces: `assertNoLeakedResources(projectName)` — called by `main()` after teardown (Task 6).
  Not unit-tested (it shells out to the real `docker` CLI); Task 7's live smoke run is its test.

- [ ] **Step 1: Write the implementation directly** (no unit test — this function's only
  meaningful behavior is talking to the real Docker daemon; Task 7 exercises it live)

```typescript
// append to tests/uat/provisioner.ts
import { spawn } from "node:child_process";

function runCapture(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with status ${code ?? "unknown"}`));
    });
  });
}

/**
 * #1024/#1000: positive proof that `down -v` actually left nothing behind — the Phase 1
 * acceptance criterion is "tears down clean (no leftover containers/volumes/networks)", not just
 * "the down command exited 0". Throws with the leaked names so a failed run is loud, not a silent
 * resource leak discovered later by `docker system df` creeping up.
 */
export async function assertNoLeakedResources(projectName: string): Promise<void> {
  const [containers, volumes] = await Promise.all([
    runCapture("docker", ["ps", "-a", "--filter", `name=${projectName}`, "--format", "{{.Names}}"]),
    runCapture("docker", ["volume", "ls", "--filter", `name=${projectName}`, "--format", "{{.Name}}"])
  ]);
  const leakedContainers = containers.split("\n").filter(Boolean);
  const leakedVolumes = volumes.split("\n").filter(Boolean);
  if (leakedContainers.length > 0 || leakedVolumes.length > 0) {
    throw new Error(
      `UAT teardown leaked resources for ${projectName}: containers=${JSON.stringify(
        leakedContainers
      )} volumes=${JSON.stringify(leakedVolumes)}`
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `tests/uat/provisioner.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/uat/provisioner.ts
git commit -m "feat(uat): add post-teardown leak verification (#1024)"
```

---

## Task 6: `main()` live runner — health poll, signal-safe teardown, wall-clock logging

**Files:**
- Modify: `tests/uat/provisioner.ts`
- Modify: `package.json` (add `uat:provision:smoke` script)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: a runnable CLI (`tsx tests/uat/provisioner.ts`) — no new exports later tasks depend
  on (this is the leaf).

- [ ] **Step 1: Write the implementation directly** (this is an integration entrypoint, not a
  unit-testable pure function — Task 7 is its real test, run live against Docker)

```typescript
// append to tests/uat/provisioner.ts
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

function runCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with status ${code ?? "unknown"}`));
    });
  });
}

async function waitForReady(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = (await response.json()) as { readonly ok?: unknown; readonly db?: unknown; readonly pgboss?: unknown };
        // #1024/#1000: same readiness contract as scripts/smoke-compose.ts's waitForHealth
        // (#171) — /health/ready, not /health, and assert db+pgboss individually so a payload
        // change can't silently let a DB-down bare instance read as "reachable".
        if (body.ok === true && body.db === "ok" && body.pgboss === "ok") {
          return;
        }
        lastError = new Error(`readiness not satisfied: ${JSON.stringify({ db: body.db, pgboss: body.pgboss })}`);
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError ?? "health check failed")}`);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const { projectName } = generateUatRunId();
  const webPort = await findAvailablePort(
    Array.from({ length: UAT_PORT_RANGE_SIZE }, (_, i) => UAT_PORT_RANGE_START + i)
  );
  const envFile = writeUatEnvFile({ webPort });
  process.env.JARVIS_ENV_FILE = envFile.path;
  process.env.JARVIS_IMAGE_TAG ??= "uat-smoke";

  // #1024/#1000: teardown MUST run even if provisioning throws partway through (crashed migrate,
  // failed health poll, etc.) — this is the "trap/finally" the spec's §3.5 calls for, translated
  // to Node's try/finally plus SIGINT/SIGTERM handlers so an operator Ctrl-C doesn't skip it.
  const teardown = () =>
    runCommand("docker", buildUatComposeArgs(projectName, ["down", "-v"])).catch((error) => {
      console.error(`teardown failed for ${projectName}:`, error);
    });
  const onSignal = () => {
    void teardown().finally(() => process.exit(1));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    console.log(`[uat] provisioning ${projectName} on port ${webPort}`);
    if (process.env.JARVIS_UAT_BUILD !== "0") {
      await runCommand("docker", [
        "build",
        "-t",
        `ghcr.io/motioneso/jarv1s:${process.env.JARVIS_IMAGE_TAG}`,
        "-f",
        "Dockerfile",
        "."
      ]);
    }
    const plan = createUatProvisionPlan({ projectName, seedHook: bareSeedHook });
    for (const step of plan.slice(0, -1)) {
      // #1024/#1000: the plan's LAST entry is always `down -v` (Task 4) — deliberately excluded
      // from this loop and run once, from `finally`, below. Running it here too would double-run
      // teardown on the success path.
      console.log(`[uat] ${step.description}`);
      await runCommand(step.command, step.args);
    }
    await bareSeedHook({ projectName }); // #1024/#1000: no-op in Phase 1; seam for #1025.
    const readyUrl = `http://127.0.0.1:${webPort}/health/ready`;
    await waitForReady(readyUrl);
    console.log(`[uat] reachable at ${readyUrl} after ${Date.now() - startedAt}ms`);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await teardown();
    await assertNoLeakedResources(projectName);
    envFile.cleanup();
    console.log(`[uat] provision+teardown wall-clock: ${Date.now() - startedAt}ms`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
```

- [ ] **Step 2: Add the package.json script**

Modify `package.json`, in the `scripts` block near `smoke:compose:prod`:

```json
    "smoke:compose:prod": "tsx scripts/smoke-compose.ts --compose-file infra/docker-compose.prod.yml --build",
    "uat:provision:smoke": "tsx tests/uat/provisioner.ts",
```

- [ ] **Step 3: Typecheck + lint the new file**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors (fix any `@typescript-eslint/no-explicit-any` / unused-var hits before moving on).

- [ ] **Step 4: Commit**

```bash
git add tests/uat/provisioner.ts package.json
git commit -m "feat(uat): add live provisioner runner with signal-safe teardown (#1024)"
```

---

## Task 7: Live verification run — measure real wall-clock, confirm zero leaks

**Files:** none (verification only; produces evidence for the PR body).

- [ ] **Step 1: Run the real provisioner end to end**

```bash
JARVIS_UAT_BUILD=1 pnpm uat:provision:smoke
```

Expected: log lines through every plan step, `[uat] reachable at http://127.0.0.1:<port>/health/ready after <N>ms`, then `[uat] provision+teardown wall-clock: <M>ms`, process exits 0.

- [ ] **Step 2: Confirm zero leaked containers/volumes independently**

```bash
docker ps -a --filter "name=uat-" --format '{{.Names}}'
docker volume ls --filter "name=uat-" --format '{{.Name}}'
docker network ls --filter "name=uat-" --format '{{.Name}}'
```

Expected: all three commands print nothing (empty output) — if `main()`'s own
`assertNoLeakedResources` call already passed this is confirmatory, not new information, but it's
cheap and it's the actual acceptance criterion from the handoff, so run it explicitly.

- [ ] **Step 3: Re-run once more with `JARVIS_UAT_BUILD=0`** (image already built/tagged from
  Step 1) to get a provision-only wall-clock number that excludes image-build time — this is the
  number worth recording for the "measure real wall-clock" locked decision, since the build step
  will be cached/skipped in most real invocations once an image tag exists.

```bash
JARVIS_UAT_BUILD=0 JARVIS_IMAGE_TAG=uat-smoke pnpm uat:provision:smoke
```

Record both numbers (with-build and without-build) — this is the evidence for the PR body's
"measured real wall-clock" requirement from the locked decisions.

- [ ] **Step 4: No commit** (this task produces evidence, not code changes) — copy the two
  wall-clock numbers into your PR body draft now, before you forget them.

---

## Task 8: Full gate + PR

**Files:** none new — this is the existing `coordinated-wrap-up` flow.

- [ ] **Step 1: Pre-push trio + rebase**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

- [ ] **Step 2: Full gate**

```bash
pnpm verify:foundation
```

Record the exit code. If it's non-zero, fix and re-run — do not proceed to PR on red.

- [ ] **Step 3: Invoke `coordinated-wrap-up`** per the handoff: PR title referencing #1024, body
  `Part of #1000` + `Closes #1024`, base `main`, "What's new" note: *"Internal: adds the ephemeral-
  instance provisioner that future end-to-end UAT tests run against."* Include the two wall-clock
  numbers from Task 7 and the gate exit codes. Report the PR number to the `Coordinator` pane.
  **Do not merge** — tier is `sensitive`.

---

## Self-Review Notes

- **Spec coverage:** §3.1 (prod-shaped base) → Task 4; §3.2 (exact invocation shape) → Task 4;
  §3.3 (volume isolation + model-cache-volume decision) → Task 4 (`expectedUatVolumeNames`) +
  Task 3 (stub-provider decision documented inline); §3.4 (port + subnet allocation) → Tasks 1–2;
  §3.5 (teardown trap) → Task 6; §4.1 (privileged-connection seam, not built but seamed) → Task 3;
  handoff's "bare-level provision+teardown is the acceptance" → Task 7. Nothing in §8.1 is left
  uncovered; §4.2–§4.5, §5, §6, §7 are explicitly out of scope for this phase (#1025/#1026).
- **Placeholder scan:** no TBD/TODO markers; every code step is complete, runnable code.
- **Type consistency:** `SeedHook`, `UatComposeCommand`, `UatEnvFile`, `UatRunId` are defined once
  (Tasks 1/3/4) and reused verbatim by name in every later task — checked against each task's
  Interfaces block above.
