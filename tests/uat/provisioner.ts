import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveTrustedOrigins } from "../../scripts/setup-prod-origins.js";

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
 *
 * #1024 (Coordinator condition 1): this only proves a candidate was free at PROBE time — it
 * cannot close the TOCTOU race against `docker compose up` binding the port moments later in a
 * different process. That race is handled by main() (Task 6): on a real compose bind-conflict
 * exit, main() calls this function again with the remaining untried candidates rather than
 * looping in here. Keep this function a pure single-pass probe; don't add retry logic here.
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

export interface UatEnvFile {
  readonly path: string;
  readonly cleanup: () => void;
}

// #1024/#1000: single source of truth for the two dev-only secrets that BOTH get written into the
// env file (container env, via docker-compose.prod.yml's `env_file:`) AND must be exported as real
// process.env vars for compose-file `${...:?}` interpolation (see uatComposeInterpolationEnv below)
// — `env_file:` alone never feeds interpolation, only container env. Same trap as
// scripts/smoke-compose.ts's ensureProdSmokeEnv.
const UAT_POSTGRES_PASSWORD = "postgres";
const UAT_CLI_RUNNER_RPC_SECRET = "uat-only-not-real";

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
      // #1026: Playwright drives this instance at http://127.0.0.1:<webPort> (see baseURL
      // below), which is a DIFFERENT origin than better-auth's "http://localhost:<port>"
      // default (readTrustedOrigins, packages/auth/src/index.ts) — 127.0.0.1 and localhost
      // are distinct origins for its exact-string check, so login was rejected with
      // "Invalid origin" until this was added. Reuses the same deriveTrustedOrigins helper
      // scripts/setup-prod.ts uses for real deploys (#379) rather than hand-rolling the list.
      `JARVIS_AUTH_TRUSTED_ORIGINS=${deriveTrustedOrigins({ webPort: String(input.webPort), publicOrigin: "127.0.0.1" })}`,
      `JARVIS_DOCKER_SUBNET=${UAT_DOCKER_SUBNET}`,
      `POSTGRES_PASSWORD=${UAT_POSTGRES_PASSWORD}`,
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
      // #1024/#1000: required in any non-development/test NODE_ENV since #918 Slice 2
      // (resolveKeyring enforces >=32 bytes) — matches .github/workflows/ci.yml's convention.
      // Caught live by Task 7 (this plan predates #918 landing on main).
      "JARVIS_MODULE_CREDENTIAL_SECRET_KEY=22222222222222222222222222222222",
      `JARVIS_CLI_RUNNER_RPC_SECRET=${UAT_CLI_RUNNER_RPC_SECRET}`,
      "JARVIS_EMBED_PROVIDER=stub",
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  return { path, cleanup: () => rmSync(dir, { force: true, recursive: true }) };
}

/**
 * #1024/#1000: docker-compose.prod.yml interpolates JARVIS_WEB_PORT/JARVIS_DOCKER_SUBNET (with
 * defaults that are the PROD port 1533 and PROD subnet 10.251.0.0/24 — silently wrong, not an
 * error, if left unset) and POSTGRES_PASSWORD/JARVIS_CLI_RUNNER_RPC_SECRET (`:?`-required, hard
 * error if unset) directly in the compose YAML via `${...}`. `env_file:` (writeUatEnvFile above)
 * only injects vars into the CONTAINER's env, never into compose-file interpolation — so every one
 * of these must ALSO be exported as a real process.env var before any `docker compose` invocation,
 * or `config --quiet` fails hard on the two required ones and would silently collide with a real
 * prod instance on the other two. Caught live by Task 7's first run (#1024) — the exact
 * deploy-compose-env-trap this project has hit before.
 */
export function uatComposeInterpolationEnv(input: {
  readonly webPort: number;
}): Readonly<Record<string, string>> {
  return {
    JARVIS_WEB_PORT: String(input.webPort),
    JARVIS_DOCKER_SUBNET: UAT_DOCKER_SUBNET,
    POSTGRES_PASSWORD: UAT_POSTGRES_PASSWORD,
    JARVIS_CLI_RUNNER_RPC_SECRET: UAT_CLI_RUNNER_RPC_SECRET
  };
}

export type UatSeedLevel = "bare" | "solo-admin" | "admin+data" | "multi-user";

export type SeedHook = (ctx: {
  readonly projectName: string;
  readonly level: UatSeedLevel;
  readonly excludeChunks?: readonly string[];
}) => Promise<void>;

// #1024/#1000: Phase 1 ships zero seed data by design (spec §8.1 acceptance = bare level only).
export const bareSeedHook: SeedHook = async () => {};

/**
 * #1025: runs tests/uat/seed/cli.ts as a one-shot `seed` ops-profile compose
 * service (same network-reachability reason `migrate` runs as a compose
 * service, not a host script — postgres publishes no host port).
 *
 * JARVIS_UAT_SEED_CONFIRM=1 is the entrypoint-side half of the Coordinator's
 * binding prod-guard: composeSeedHook is the ONLY caller that sets it, so
 * cli.ts (Task 6) refuses to run for anything else that might invoke the
 * `seed` service against a non-ephemeral stack.
 */
export const composeSeedHook: SeedHook = async ({ projectName, level, excludeChunks }) => {
  await runCommand(
    "docker",
    buildUatComposeArgs(projectName, [
      "--profile",
      "ops",
      "run",
      "--rm",
      "-e",
      `JARVIS_UAT_SEED_LEVEL=${level}`,
      "-e",
      `JARVIS_UAT_SEED_EXCLUDE_CHUNKS=${(excludeChunks ?? []).join(",")}`,
      "-e",
      "JARVIS_UAT_SEED_CONFIRM=1",
      "seed"
    ])
  );
};

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
    runCapture("docker", [
      "volume",
      "ls",
      "--filter",
      `name=${projectName}`,
      "--format",
      "{{.Name}}"
    ])
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

// #1024/#1000: thrown only when a command's failure looks like a lost port-bind race (see
// runCommand below) so main()'s retry loop can distinguish "retry with next port" from every
// other failure mode, which should abort the run instead of masking a real error.
class PortBindConflictError extends Error {}

const PORT_BIND_CONFLICT_PATTERN = /port is already allocated|address already in use|bind.*failed/i;

function runCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let stderr = "";
    // #1024/#1000: stdout stays "inherit" for live operator visibility; stderr is piped so we can
    // inspect it for the port-bind-conflict signature, but every chunk is still forwarded to the
    // real stderr as it arrives so nothing is lost from the operator's view.
    const child = spawn(command, args, { stdio: ["inherit", "inherit", "pipe"] });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      if (PORT_BIND_CONFLICT_PATTERN.test(stderr)) {
        reject(
          new PortBindConflictError(`${command} ${args.join(" ")} exited ${code ?? "unknown"}`)
        );
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
        const body = (await response.json()) as {
          readonly ok?: unknown;
          readonly db?: unknown;
          readonly pgboss?: unknown;
        };
        // #1024/#1000: same readiness contract as scripts/smoke-compose.ts's waitForHealth
        // (#171) — /health/ready, not /health, and assert db+pgboss individually so a payload
        // change can't silently let a DB-down bare instance read as "reachable".
        if (body.ok === true && body.db === "ok" && body.pgboss === "ok") {
          return;
        }
        lastError = new Error(
          `readiness not satisfied: ${JSON.stringify({ db: body.db, pgboss: body.pgboss })}`
        );
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError ?? "health check failed")}`);
}

export function buildSeedHookInput(
  projectName: string,
  level: UatSeedLevel,
  opts?: { excludeChunks?: readonly string[] }
): { projectName: string; level: UatSeedLevel; excludeChunks?: readonly string[] } {
  return { projectName, level, excludeChunks: opts?.excludeChunks };
}

export async function restartUatStack(projectName: string, baseURL: string): Promise<void> {
  // #1026/#999: found live — `docker compose up -d jarv1s` is a documented Compose no-op when the
  // service's computed config (image digest/env/volumes) is unchanged, which it always is here: a
  // module "Download" only writes into the jarv1s-modules volume + a DB row
  // (packages/module-registry/src/distribution/pipeline.ts's downloadAndStageModule), never the
  // image or compose config `up -d` diffs against. scripts/module-reconcile.ts only runs as a
  // boot-time one-shot (scripts/start-jarv1s.ts), so a no-op `up -d` means it never reruns and the
  // module never leaves "Downloaded — restart to apply". `docker compose restart` kills+restarts
  // the SAME container (unlike `up -d`, it is not gated on a config diff), which reruns
  // start-jarv1s.ts's CMD from scratch — including migrate + module-reconcile — every time. This is
  // a harness fix only: settings-module-registry-section.tsx's operator-facing copy still tells
  // real operators to run `docker compose pull && docker compose up -d`, which hits this exact
  // no-op when no new image tag was pulled — that product-level UX gap is out of scope for #1026
  // and must be flagged as its own issue, not silently routed around here.
  await runCommand("docker", buildUatComposeArgs(projectName, ["restart", "jarv1s"]));
  await waitForReady(`${baseURL}/health/ready`);
}

export async function provisionForUat(
  level: UatSeedLevel,
  opts?: { excludeChunks?: readonly string[] }
): Promise<{ baseURL: string; projectName: string; teardown: () => Promise<void> }> {
  const overallStart = Date.now();
  // #1024/#1000: bounded by the reserved range itself (100 candidates) — never an unbounded
  // retry. Each failed-on-bind attempt removes its port from the pool; exhausting the pool means
  // the whole reserved range is hostile, which should fail loudly, not spin forever.
  let remainingCandidates = Array.from(
    { length: UAT_PORT_RANGE_SIZE },
    (_, i) => UAT_PORT_RANGE_START + i
  );
  let imageBuilt = false; // build once; a port-bind retry shouldn't rebuild the image

  while (remainingCandidates.length > 0) {
    const { projectName } = generateUatRunId();
    const webPort = await findAvailablePort(remainingCandidates);
    const envFile = writeUatEnvFile({ webPort });
    process.env.JARVIS_ENV_FILE = envFile.path;
    process.env.JARVIS_IMAGE_TAG ??= "uat-smoke";
    // #1024/#1000: must be exported for every retry iteration, not just the first — a TOCTOU
    // port-bind retry picks a new webPort, and JARVIS_WEB_PORT must track it or compose would
    // interpolate the stale (or default/prod) port. See uatComposeInterpolationEnv's doc comment.
    Object.assign(process.env, uatComposeInterpolationEnv({ webPort }));

    const teardownCompose = () =>
      runCommand("docker", buildUatComposeArgs(projectName, ["down", "-v"])).catch((error) => {
        console.error(`teardown failed for ${projectName}:`, error);
      });

    try {
      console.log(`[uat] provisioning ${projectName} on port ${webPort}`);
      if (process.env.JARVIS_UAT_BUILD !== "0" && !imageBuilt) {
        await runCommand("docker", [
          "build",
          "-t",
          `ghcr.io/motioneso/jarv1s:${process.env.JARVIS_IMAGE_TAG}`,
          "-f",
          "Dockerfile",
          "."
        ]);
        imageBuilt = true;
      }
      const plan = createUatProvisionPlan({ projectName, seedHook: bareSeedHook });
      for (const step of plan.slice(0, -1)) {
        // #1024/#1000: the plan's LAST entry is always `down -v` (Task 4) — deliberately excluded
        // from this loop and run once, in the catch/return paths below. Running it here too would
        // double-run teardown on the success path.
        console.log(`[uat] ${step.description}`);
        await runCommand(step.command, step.args);
      }
      await composeSeedHook(buildSeedHookInput(projectName, level, opts));
      const baseURL = `http://127.0.0.1:${webPort}`;
      await waitForReady(`${baseURL}/health/ready`);
      console.log(`[uat] reachable at ${baseURL} after ${Date.now() - overallStart}ms`);
      return {
        baseURL,
        projectName,
        // #1026: deferred, not auto-run — a caller running Playwright against this stack needs it
        // alive between provision and its own explicit teardown() call, so this can no longer live
        // in a `finally` here. SIGINT/SIGTERM handling moves to the caller (tests/uat/run-uat.ts),
        // which is the one that knows when a long-running Playwright child should be interrupted.
        teardown: async () => {
          await teardownCompose();
          await assertNoLeakedResources(projectName);
          envFile.cleanup();
        }
      };
    } catch (error) {
      await teardownCompose();
      await assertNoLeakedResources(projectName);
      envFile.cleanup();
      if (error instanceof PortBindConflictError) {
        // #1024/#1000: Coordinator condition 1 — findAvailablePort (Task 2) only proved this port
        // free at probe time; docker just told us another process won the bind race. Retry with
        // the next untried candidate instead of flaking the whole gate.
        console.warn(
          `[uat] port ${webPort} lost the bind race after probing free; retrying with next candidate (#1024)`
        );
        remainingCandidates = remainingCandidates.filter((port) => port !== webPort);
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `exhausted all ${UAT_PORT_RANGE_SIZE} reserved UAT ports (${UAT_PORT_RANGE_START}-${
      UAT_PORT_RANGE_START + UAT_PORT_RANGE_SIZE - 1
    }) without a successful bind`
  );
}

async function main(): Promise<void> {
  const overallStart = Date.now();
  const level = (process.env.JARVIS_UAT_SEED_LEVEL ?? "bare") as UatSeedLevel;
  const { teardown } = await provisionForUat(level);
  await teardown();
  console.log(`[uat] provision+teardown wall-clock: ${Date.now() - overallStart}ms`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
