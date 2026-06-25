# Two-container Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the production deploy to the README target shape: one `postgres` container and one `jarv1s` container.

**Architecture:** Keep Postgres separate and keep the cli-runner RPC/process boundary inside the Jarv1s container. The Jarv1s image includes API, worker, cli-runner, migrations, and built web assets; a small Node supervisor prepares volumes, runs migrations, then starts cli-runner, worker, and API. The API serves the Vite web build on the same public origin as `/api`.

**Tech Stack:** Docker Compose, Node 24, Fastify 5, pnpm workspace, esbuild, Vite static assets, existing cli-runner Unix-socket RPC.

---

## Implementation Status

Implemented and pushed to `origin/main` in `d5604c3` (`deploy: collapse production into one jarv1s
container`).

Release-ready evidence from wrap-up:

- `pnpm exec vitest run tests/unit/api-static-web.test.ts tests/unit/start-jarv1s-plan.test.ts tests/unit/prod-compose-plan.test.ts tests/unit/prod-deploy-config.test.ts tests/unit/setup-prod-trusted-origins.test.ts tests/unit/cli-runner-catalog-path.test.ts` passed: 6 files, 34 tests.
- `pnpm test:release-hardening` passed: 1 file, 19 tests.
- `pnpm typecheck` passed.
- `JARVIS_IMAGE_TAG=smoke POSTGRES_PASSWORD=setup JARVIS_CLI_RUNNER_RPC_SECRET=setup JARVIS_DOCKER_SUBNET=10.253.0.0/24 docker compose -p jarv1s-prod-smoke -f infra/docker-compose.prod.yml config --quiet` exited 0.
- `JARVIS_IMAGE_TAG=smoke pnpm smoke:compose:prod` passed at `http://localhost:1533/health/ready`; the `jarv1s-prod-smoke` containers, volumes, and network were removed after the run.

Known wrap-up note: the shared `~/Jarv1s` tree still had unrelated unstaged notes/folder-picker
work from another agent. The deploy commit staged only deploy-owned paths.

Production deployment follow-up: `origin/main` at `d5604c3` was deployed to `~/JarvisProd` with one
`jarv1s` container on public port `1533`. The deploy pane changed only operator-local files under
`~/JarvisProd` and `/tmp/update-jarvis-nginx-1533.sh`. The committed notes overlay/install path
still references split-service-era assumptions and needs a separate cleanup pass; the deploy
directory has a local notes override adjusted for the single-container stack. Tracked in GitHub
issue #471.

---

## Scope Notes

Do **not** replace the DB role URL system with `JARVIS_DB_*` variables in this pass. The README template can be made friendlier later, but the current production security model depends on separate bootstrap, migration, app, auth, and worker role URLs. This plan is container consolidation only.

Do **not** rewrite cli-runner RPC. The point is to remove the external sidecar service while preserving the process/RPC contract.

## File Map

**Create:**

- `apps/api/src/static-web.ts` — small static asset + SPA fallback handler for built Vite files, no new dependency.
- `scripts/start-jarv1s.ts` — single-container supervisor: chown runtime dirs, run migrations, spawn cli-runner/worker/API, forward shutdown.
- `tests/unit/api-static-web.test.ts` — Fastify inject tests for static assets, SPA fallback, API 404 preservation, headers.
- `tests/unit/start-jarv1s-plan.test.ts` — pure unit tests for supervisor process plan and sanitized cli-runner env.

**Modify:**

- `apps/api/src/server.ts` — register static web serving when `JARVIS_WEB_DIST_DIR` or default dist path exists.
- `Dockerfile` — build web assets into the app image; default command becomes the single-container supervisor.
- `infra/docker-compose.prod.yml` — replace `init`, `api`, `worker`, `cli-runner`, and `web` with one `jarv1s` service; keep `postgres`, `setup`, and an ops-profile `migrate` recovery service.
- `infra/env.production.example` — document single public port and in-container process env.
- `scripts/setup-prod.ts` — keep auth base on the in-container API URL and ensure trusted browser origins derive from `JARVIS_WEB_PORT`.
- `scripts/smoke-compose.ts` — prod build is one image, prod up starts `postgres` + `jarv1s`, health URL uses public Jarv1s port.
- `scripts/publish-images.sh` — publish `ghcr.io/motioneso/jarv1s`, not separate api/web images.
- `.github/workflows/ci.yml` — publish one `ghcr.io/motioneso/jarv1s` image instead of split api/web images.
- Delete: `infra/cli-runner-entrypoint.sh` — dead after the supervisor directly spawns `packages/cli-runner/src/main-entry.ts`.
- `packages/cli-runner/src/sanitized-env.ts` — no behavior change required; Task 2 imports `buildSanitizedCliEnv` in tests to prevent supervisor allowlist drift.
- `tests/unit/prod-compose-plan.test.ts` — assert one prod image build and two-service startup.
- `tests/unit/prod-deploy-config.test.ts` — update sidecar assertions to internal process/RPC assertions.
- `tests/unit/cli-runner-catalog-path.test.ts` — remove the assertion that the old shell entrypoint points at a real file.
- `tests/integration/release-hardening.test.ts` — update deploy docs/env/workflow assertions that mention split prod images or public API/web ports.
- `README.md` only if implementation details need to match the final compose/env names.

---

## Task 1: Static Web Serving In API

**Files:**

- Create: `apps/api/src/static-web.ts`
- Modify: `apps/api/src/server.ts`
- Test: `tests/unit/api-static-web.test.ts`

- [ ] **Step 1: Write failing static-web tests**

Create `tests/unit/api-static-web.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify from "fastify";
import helmet from "@fastify/helmet";
import { afterEach, describe, expect, it } from "vitest";

import { registerStaticWeb } from "../../apps/api/src/static-web.js";

describe("registerStaticWeb", () => {
  const oldEnv = process.env.JARVIS_WEB_DIST_DIR;

  afterEach(() => {
    if (oldEnv === undefined) {
      delete process.env.JARVIS_WEB_DIST_DIR;
    } else {
      process.env.JARVIS_WEB_DIST_DIR = oldEnv;
    }
  });

  function makeDist(): string {
    const dir = mkdtempSync(join(tmpdir(), "jarv1s-web-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), '<!doctype html><div id="root"></div>');
    writeFileSync(join(dir, "assets", "app.js"), "console.log('jarv1s');");
    return dir;
  }

  it("serves static assets with nosniff and SPA CSP", async () => {
    const app = Fastify({ logger: false });
    registerStaticWeb(app, { distDir: makeDist() });

    const res = await app.inject({ method: "GET", url: "/assets/app.js" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.body).toContain("jarv1s");
  });

  it("overrides the API helmet CSP for SPA HTML", async () => {
    const app = Fastify({ logger: false });
    await app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"]
        }
      }
    });
    registerStaticWeb(app, { distDir: makeDist() });

    const res = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { accept: "text/html" }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).not.toContain("default-src 'none'");
  });

  it("falls back to index.html for browser SPA routes", async () => {
    const app = Fastify({ logger: false });
    registerStaticWeb(app, { distDir: makeDist() });

    const res = await app.inject({
      method: "GET",
      url: "/settings/personal-data",
      headers: { accept: "text/html" }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('<div id="root"></div>');
  });

  it("does not turn missing API routes into the SPA", async () => {
    const app = Fastify({ logger: false });
    registerStaticWeb(app, { distDir: makeDist() });

    const res = await app.inject({
      method: "GET",
      url: "/api/missing",
      headers: { accept: "text/html" }
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<div id="root"></div>');
  });

  it("rejects path traversal", async () => {
    const app = Fastify({ logger: false });
    registerStaticWeb(app, { distDir: makeDist() });

    const res = await app.inject({ method: "GET", url: "/%2e%2e/package.json" });

    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```sh
pnpm test:unit -- tests/unit/api-static-web.test.ts
```

Expected: fail because `apps/api/src/static-web.ts` does not exist.

- [ ] **Step 3: Implement static serving without a new dependency**

Create `apps/api/src/static-web.ts`:

```ts
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface StaticWebOptions {
  readonly distDir?: string;
}

const MIME: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const SPA_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; worker-src 'self'; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'self'";

export function defaultWebDistDir(): string {
  return process.env.JARVIS_WEB_DIST_DIR ?? resolve(process.cwd(), "apps/web/dist");
}

export function registerStaticWeb(app: FastifyInstance, options: StaticWebOptions = {}): boolean {
  const distDir = resolve(options.distDir ?? defaultWebDistDir());
  const indexPath = join(distDir, "index.html");

  if (!existsSync(indexPath)) {
    app.log.info({ distDir }, "web dist not found; static web serving disabled");
    return false;
  }

  app.setNotFoundHandler((request, reply) => {
    void serveStaticOrSpa(request, reply, distDir, indexPath);
  });
  return true;
}

async function serveStaticOrSpa(
  request: FastifyRequest,
  reply: FastifyReply,
  distDir: string,
  indexPath: string
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    await reply.callNotFound();
    return;
  }

  const url = request.url.split("?")[0] ?? "/";
  if (url.startsWith("/api/") || url === "/api" || url.startsWith("/health")) {
    await reply.callNotFound();
    return;
  }

  const assetPath = resolveAssetPath(distDir, url);
  if (assetPath && existsSync(assetPath) && statSync(assetPath).isFile()) {
    sendFile(reply, assetPath);
    return;
  }

  const accept = request.headers.accept ?? "";
  if (url.includes(".") || !accept.includes("text/html")) {
    await reply.callNotFound();
    return;
  }

  sendFile(reply, indexPath);
}

function resolveAssetPath(distDir: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) {
    return undefined;
  }

  const relative = normalize(decoded.replace(/^\/+/, ""));
  const full = resolve(distDir, relative);
  if (full !== distDir && !full.startsWith(`${distDir}${sep}`)) {
    return undefined;
  }
  return full;
}

function sendFile(reply: FastifyReply, filePath: string): void {
  reply.header("Content-Type", MIME[extname(filePath)] ?? "application/octet-stream");
  reply.header("Content-Security-Policy", SPA_CSP);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Frame-Options", "DENY");
  reply.send(createReadStream(filePath));
}
```

Modify `apps/api/src/server.ts`:

```ts
import { registerStaticWeb } from "./static-web.js";
```

Inside `server.after(() => { ... })`, after all API/platform/module route registration and before the function returns:

```ts
registerStaticWeb(server);
```

- [ ] **Step 4: Run the focused test**

Run:

```sh
pnpm test:unit -- tests/unit/api-static-web.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/server.ts apps/api/src/static-web.ts tests/unit/api-static-web.test.ts
git commit -m "feat: serve web assets from api"
```

---

## Task 2: Single-container Supervisor

**Files:**

- Create: `scripts/start-jarv1s.ts`
- Test: `tests/unit/start-jarv1s-plan.test.ts`

- [ ] **Step 1: Write failing supervisor plan tests**

Create `tests/unit/start-jarv1s-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildSanitizedCliEnv } from "../../packages/cli-runner/src/sanitized-env.js";
import {
  buildChildEnv,
  buildStartupPlan,
  runtimeUidGid,
  type ChildRole
} from "../../scripts/start-jarv1s.js";

describe("start-jarv1s startup plan", () => {
  it("runs migrate before resident processes", () => {
    const plan = buildStartupPlan({
      NODE_ENV: "production",
      JARVIS_HOST_UID: "1234",
      JARVIS_HOST_GID: "1235",
      JARVIS_CLI_RUNNER_RPC_SECRET: "rpc-secret"
    } as NodeJS.ProcessEnv);

    expect(plan.oneShot.command).toEqual(["node_modules/.bin/tsx", "scripts/migrate.ts"]);
    expect(plan.oneShot.uid).toBe(1234);
    expect(plan.oneShot.gid).toBe(1235);
    expect(plan.resident.map((p) => p.role)).toEqual(["cli-runner", "worker", "api"]);
  });

  it("spawns resident processes as the configured runtime uid/gid", () => {
    expect(
      runtimeUidGid({ JARVIS_HOST_UID: "501", JARVIS_HOST_GID: "20" } as NodeJS.ProcessEnv)
    ).toEqual({
      uid: 501,
      gid: 20
    });
  });

  it("rejects invalid runtime uid/gid", () => {
    expect(() =>
      runtimeUidGid({ JARVIS_HOST_UID: "abc", JARVIS_HOST_GID: "20" } as NodeJS.ProcessEnv)
    ).toThrow("JARVIS_HOST_UID must be a positive integer");
    expect(() =>
      runtimeUidGid({ JARVIS_HOST_UID: "501", JARVIS_HOST_GID: "0" } as NodeJS.ProcessEnv)
    ).toThrow("JARVIS_HOST_GID must be a positive integer");
  });

  it("does not pass DB or app encryption secrets to cli-runner", () => {
    const env = buildChildEnv("cli-runner", {
      PATH: "/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TMPDIR: "/tmp",
      DISABLE_AUTOUPDATER: "1",
      NODE_ENV: "production",
      SHELL: "/bin/bash",
      JARVIS_APP_DATABASE_URL: "postgres://secret",
      BETTER_AUTH_SECRET: "auth-secret",
      JARVIS_AI_SECRET_KEY: "ai-secret",
      JARVIS_CONNECTOR_SECRET_KEY: "connector-secret",
      JARVIS_CLI_RUNNER_SOCKET: "/run/jarv1s/cli-runner.sock",
      JARVIS_CLI_RUNNER_RPC_SECRET: "rpc-secret"
    } as NodeJS.ProcessEnv);

    expect(env.JARVIS_CLI_RUNNER_RPC_SECRET).toBe("rpc-secret");
    expect(env.LANG).toBe("C.UTF-8");
    expect(env.LC_ALL).toBe("C.UTF-8");
    expect(env.TMPDIR).toBe("/tmp");
    expect(env.DISABLE_AUTOUPDATER).toBe("1");
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.SHELL).toBeUndefined();
    expect(env.JARVIS_APP_DATABASE_URL).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.JARVIS_AI_SECRET_KEY).toBeUndefined();
    expect(env.JARVIS_CONNECTOR_SECRET_KEY).toBeUndefined();
  });

  it("keeps cli-runner server env as a superset of the CLI subprocess allowlist", () => {
    const source = {
      HOME: "/data/cli-auth",
      PATH: "/bin",
      NPM_CONFIG_PREFIX: "/data/cli-tools",
      JARVIS_CLI_TOOLS_PREFIX: "/data/cli-tools",
      JARVIS_CLI_HOME: "/data/cli-auth",
      JARVIS_CLI_HOME_BASE: "/data/cli-auth",
      JARVIS_CLI_NEUTRAL_BASE: "/data/cli-auth/chat",
      JARVIS_HOST_UID: "1000",
      JARVIS_HOST_GID: "1000",
      TERM: "xterm-256color",
      LANG: "C.UTF-8",
      TMPDIR: "/tmp",
      LC_ALL: "C.UTF-8",
      DISABLE_AUTOUPDATER: "1",
      JARVIS_CLI_RUNNER_RPC_SECRET: "rpc-secret"
    } as NodeJS.ProcessEnv;

    const expectedForCli = buildSanitizedCliEnv(source);
    const cliRunnerServerEnv = buildChildEnv("cli-runner", source);

    for (const [key, value] of Object.entries(expectedForCli)) {
      expect(cliRunnerServerEnv[key]).toBe(value);
    }
  });

  it.each<ChildRole>(["api", "worker"])("%s keeps app runtime env", (role) => {
    const env = buildChildEnv(role, {
      PATH: "/bin",
      NODE_ENV: "production",
      JARVIS_APP_DATABASE_URL: "postgres://app",
      BETTER_AUTH_SECRET: "auth-secret"
    } as NodeJS.ProcessEnv);

    expect(env.JARVIS_APP_DATABASE_URL).toBe("postgres://app");
    expect(env.BETTER_AUTH_SECRET).toBe("auth-secret");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```sh
pnpm test:unit -- tests/unit/start-jarv1s-plan.test.ts
```

Expected: fail because `scripts/start-jarv1s.ts` does not exist.

- [ ] **Step 3: Implement the minimal supervisor**

Create `scripts/start-jarv1s.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, chownSync, mkdirSync } from "node:fs";

export type ChildRole = "api" | "worker" | "cli-runner";

export interface ProcessSpec {
  readonly role: ChildRole;
  readonly command: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

export interface StartupPlan {
  readonly oneShot: {
    readonly command: readonly string[];
    readonly env: NodeJS.ProcessEnv;
    readonly uid: number;
    readonly gid: number;
  };
  readonly resident: readonly ProcessSpec[];
  readonly uid: number;
  readonly gid: number;
}

const CLI_ENV_KEYS = new Set([
  "HOME",
  "PATH",
  "NPM_CONFIG_PREFIX",
  "JARVIS_CLI_HOME",
  "JARVIS_CLI_HOME_BASE",
  "JARVIS_CLI_NEUTRAL_BASE",
  "JARVIS_CLI_TOOLS_PREFIX",
  "JARVIS_HOST_UID",
  "JARVIS_HOST_GID",
  "TERM",
  "LANG",
  "TMPDIR",
  "DISABLE_AUTOUPDATER",
  "JARVIS_CLI_PER_USER_UID",
  "JARVIS_CLI_RUNNER_RPC_SECRET",
  "JARVIS_CLI_RUNNER_SINGLE_USER",
  "JARVIS_CLI_RUNNER_SOCKET",
  "JARVIS_MCP_SERVER_URL",
  "JARVIS_MULTIPLEXER"
]);

const CLI_ENV_PREFIXES = ["LC_"];

export function runtimeUidGid(env: NodeJS.ProcessEnv = process.env): { uid: number; gid: number } {
  const uid = Number(env.JARVIS_HOST_UID ?? 1000);
  const gid = Number(env.JARVIS_HOST_GID ?? 1000);
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("JARVIS_HOST_UID must be a positive integer");
  }
  if (!Number.isInteger(gid) || gid <= 0) {
    throw new Error("JARVIS_HOST_GID must be a positive integer");
  }
  return {
    uid,
    gid
  };
}

export function buildChildEnv(
  role: ChildRole,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  if (role !== "cli-runner") {
    return {
      ...env,
      PORT: env.PORT ?? "3000",
      HOST: env.HOST ?? "0.0.0.0",
      HF_HOME: env.HF_HOME ?? "/app/.cache/huggingface",
      JARVIS_CLI_RUNNER_SOCKET: env.JARVIS_CLI_RUNNER_SOCKET ?? "/run/jarv1s/cli-runner.sock",
      JARVIS_MCP_SERVER_URL: env.JARVIS_MCP_SERVER_URL ?? "http://127.0.0.1:3000/api/mcp"
    };
  }

  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (CLI_ENV_KEYS.has(key) || CLI_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      next[key] = value;
    }
  }

  next.PATH = `${env.JARVIS_CLI_TOOLS_PREFIX ?? "/data/cli-tools"}/bin:${env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`;
  next.HOME = env.JARVIS_CLI_HOME ?? "/data/cli-auth";
  next.JARVIS_CLI_HOME = next.HOME;
  next.JARVIS_CLI_HOME_BASE = env.JARVIS_CLI_HOME_BASE ?? next.HOME;
  next.JARVIS_CLI_NEUTRAL_BASE = env.JARVIS_CLI_NEUTRAL_BASE ?? "/data/cli-auth/chat";
  next.JARVIS_CLI_TOOLS_PREFIX = env.JARVIS_CLI_TOOLS_PREFIX ?? "/data/cli-tools";
  next.NPM_CONFIG_PREFIX = env.NPM_CONFIG_PREFIX ?? next.JARVIS_CLI_TOOLS_PREFIX;
  next.JARVIS_CLI_RUNNER_SOCKET = env.JARVIS_CLI_RUNNER_SOCKET ?? "/run/jarv1s/cli-runner.sock";
  next.JARVIS_CLI_RUNNER_RPC_SECRET = env.JARVIS_CLI_RUNNER_RPC_SECRET;
  next.JARVIS_CLI_RUNNER_SINGLE_USER = env.JARVIS_CLI_RUNNER_SINGLE_USER ?? "0";
  next.JARVIS_CLI_PER_USER_UID = env.JARVIS_CLI_PER_USER_UID ?? "0";
  next.JARVIS_MULTIPLEXER = env.JARVIS_MULTIPLEXER ?? "tmux";
  next.JARVIS_MCP_SERVER_URL = env.JARVIS_MCP_SERVER_URL ?? "http://127.0.0.1:3000/api/mcp";
  return next;
}

export function buildStartupPlan(env: NodeJS.ProcessEnv = process.env): StartupPlan {
  const { uid, gid } = runtimeUidGid(env);
  return {
    uid,
    gid,
    oneShot: {
      command: ["node_modules/.bin/tsx", "scripts/migrate.ts"],
      env: { ...env, NODE_ENV: env.NODE_ENV ?? "production" },
      uid,
      gid
    },
    resident: [
      {
        role: "cli-runner",
        command: ["node_modules/.bin/tsx", "packages/cli-runner/src/main-entry.ts"],
        env: buildChildEnv("cli-runner", env)
      },
      { role: "worker", command: ["node", "dist/worker.js"], env: buildChildEnv("worker", env) },
      { role: "api", command: ["node", "dist/server.js"], env: buildChildEnv("api", env) }
    ]
  };
}

export function prepareRuntimeDirs(uid: number, gid: number): void {
  for (const dir of [
    "/data/cli-tools",
    "/data/cli-auth",
    "/data/vaults",
    "/app/.cache/huggingface",
    "/run/jarv1s"
  ]) {
    mkdirSync(dir, { recursive: true });
    chownSync(dir, uid, gid);
  }
  chmodSync("/run/jarv1s", 0o700);
}

async function runOneShot(
  command: readonly string[],
  env: NodeJS.ProcessEnv,
  uid: number,
  gid: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { env, gid, stdio: "inherit", uid });
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command.join(" ")} exited with ${code ?? "unknown"}`));
    });
    child.once("error", reject);
  });
}

function spawnResident(spec: ProcessSpec, uid: number, gid: number): ChildProcess {
  const [cmd, ...args] = spec.command;
  return spawn(cmd!, args, {
    env: spec.env,
    gid,
    stdio: "inherit",
    uid
  });
}

async function main(): Promise<void> {
  const plan = buildStartupPlan();
  prepareRuntimeDirs(plan.uid, plan.gid);
  await runOneShot(plan.oneShot.command, plan.oneShot.env, plan.oneShot.uid, plan.oneShot.gid);

  const children: { spec: ProcessSpec; child: ChildProcess }[] = [];
  let shuttingDown = false;

  const waitForChildren = async (): Promise<void> => {
    await Promise.race([
      Promise.allSettled(children.map(({ child }) => once(child, "exit"))),
      new Promise<void>((resolve) => setTimeout(resolve, 10_000))
    ]);
  };

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    shuttingDown = true;
    for (const { child } of children) child.kill(signal);
    await waitForChildren();
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM").then(() => process.exit(0)));
  process.once("SIGINT", () => void shutdown("SIGINT").then(() => process.exit(0)));

  for (const spec of plan.resident) {
    const child = spawnResident(spec, plan.uid, plan.gid);
    children.push({ spec, child });
    child.once("exit", (code, signal) => {
      if (shuttingDown) return;
      console.error(`[jarv1s] ${spec.role} exited`, { code, signal });
      void shutdown("SIGTERM").then(() => process.exit(code ?? 1));
    });
  }
}

if (process.argv[1]?.endsWith("start-jarv1s.ts")) {
  await main();
}
```

- [ ] **Step 4: Run the focused test**

Run:

```sh
pnpm test:unit -- tests/unit/start-jarv1s-plan.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add scripts/start-jarv1s.ts tests/unit/start-jarv1s-plan.test.ts
git commit -m "feat: add single-container supervisor"
```

---

## Task 3: Build One Jarv1s Image

**Files:**

- Modify: `Dockerfile`
- Modify: `scripts/publish-images.sh`
- Test: `tests/unit/prod-compose-plan.test.ts`

- [ ] **Step 1: Update the prod compose plan test expectation first**

In `tests/unit/prod-compose-plan.test.ts`, replace the second test with:

```ts
it("targets the prod compose file and prepends one jarv1s image build when build is set", () => {
  const plan = createComposeSmokePlan({
    composeFile: "infra/docker-compose.prod.yml",
    build: true
  });

  const composeCmds = plan.commands.filter((c) => c.args[0] === "compose");
  expect(composeCmds.length).toBeGreaterThan(0);
  expect(composeCmds.every((c) => c.args.includes("infra/docker-compose.prod.yml"))).toBe(true);

  const first = plan.commands[0];
  if (!first) throw new Error("expected a build command when build is set");
  expect(first.args[0]).toBe("build");
  expect(first.args).toContain("Dockerfile");
  expect(first.args.some((a) => a.startsWith("ghcr.io/motioneso/jarv1s:"))).toBe(true);
  expect(plan.commands.filter((c) => c.args[0] === "build")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```sh
pnpm test:unit -- tests/unit/prod-compose-plan.test.ts
```

Expected: fail because `scripts/smoke-compose.ts` still builds api + web images.

- [ ] **Step 3: Update `Dockerfile`**

Change the build stage:

```dockerfile
RUN pnpm build:api && pnpm build:worker && pnpm build:web
```

Change the runtime setup:

```dockerfile
ENV HF_HOME=/app/.cache/huggingface
ENV JARVIS_WEB_DIST_DIR=/app/apps/web/dist
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux git ca-certificates bubblewrap \
  && rm -rf /var/lib/apt/lists/*
RUN printf '%s\n' 'export PATH="${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin:$PATH"' \
  > /etc/profile.d/jarvis-cli-path.sh \
  && chmod 0644 /etc/profile.d/jarvis-cli-path.sh
RUN mkdir -p "$HF_HOME" /data/vaults /data/cli-tools /data/cli-auth /run/jarv1s \
  && chown -R node:node /app /data /run/jarv1s \
  && chmod -R 0777 "$HF_HOME" /data/vaults /data/cli-tools /data/cli-auth \
  && chmod 0700 /run/jarv1s
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "scripts/start-jarv1s.ts"]
```

Remove the final `USER node`; the supervisor starts as root only long enough to chown runtime volumes and then spawns resident processes as `JARVIS_HOST_UID:JARVIS_HOST_GID`.

- [ ] **Step 4: Update `scripts/publish-images.sh`**

Use one image:

```sh
IMAGE="ghcr.io/${OWNER}/jarv1s"
```

Build only `Dockerfile`:

```sh
log "Build + push ${IMAGE}:${TAG} (and :latest)"
docker buildx build \
  --platform "${PLATFORMS}" \
  --tag "${IMAGE}:${TAG}" \
  --tag "${IMAGE}:latest" \
  --push \
  -f ./Dockerfile . \
  || die "jarv1s image build/push failed."
```

Remove all `WEB_IMAGE` handling and the `apps/web/Dockerfile` prerequisite.

- [ ] **Step 5: Delete the old cli-runner shell entrypoint**

The supervisor now directly spawns `packages/cli-runner/src/main-entry.ts`; no production or dev service should call `infra/cli-runner-entrypoint.sh`.

```sh
git rm infra/cli-runner-entrypoint.sh
```

Update `tests/unit/cli-runner-catalog-path.test.ts` by deleting the test that reads `infra/cli-runner-entrypoint.sh`. The catalog path tests for provider recipes stay.

- [ ] **Step 6: Update `.github/workflows/ci.yml` publish job**

Collapse the two publish tags into one output:

```sh
if [[ "${GITHUB_REF}" == refs/tags/v* ]]; then
  VERSION="${GITHUB_REF#refs/tags/}"
  echo "image_tags=ghcr.io/motioneso/jarv1s:${VERSION}" >> "$GITHUB_OUTPUT"
  echo "push=true" >> "$GITHUB_OUTPUT"
elif [[ "${GITHUB_REF}" == refs/heads/main ]]; then
  echo "image_tags=ghcr.io/motioneso/jarv1s:edge" >> "$GITHUB_OUTPUT"
  echo "push=true" >> "$GITHUB_OUTPUT"
else
  echo "image_tags=ghcr.io/motioneso/jarv1s:pr-${{ github.run_id }}" >> "$GITHUB_OUTPUT"
  echo "push=false" >> "$GITHUB_OUTPUT"
fi
```

Replace the two `docker/build-push-action` steps with one:

```yaml
- name: Build (and push on tag/main) Jarv1s image
  uses: docker/build-push-action@v6
  with:
    context: .
    file: ./Dockerfile
    platforms: linux/amd64,linux/arm64
    push: ${{ steps.tags.outputs.push == 'true' }}
    tags: ${{ steps.tags.outputs.image_tags }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

- [ ] **Step 7: Commit**

```sh
git add Dockerfile scripts/publish-images.sh .github/workflows/ci.yml tests/unit/prod-compose-plan.test.ts tests/unit/cli-runner-catalog-path.test.ts
git add -u infra/cli-runner-entrypoint.sh
git commit -m "build: publish one jarv1s image"
```

---

## Task 4: Collapse Production Compose

**Files:**

- Modify: `infra/docker-compose.prod.yml`
- Modify: `infra/env.production.example`
- Modify: `tests/unit/prod-deploy-config.test.ts`
- Modify: `tests/unit/cli-runner-catalog-path.test.ts`

- [ ] **Step 1: Update deploy config tests first**

In `tests/unit/prod-deploy-config.test.ts`, replace the `cli-runner sidecar` test with:

```ts
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
```

Delete the old `cli-runner entrypoint's default JARVIS_CLI_RUNNER_ENTRY resolves to a file that EXISTS` test from `tests/unit/prod-deploy-config.test.ts`; that file is removed in Task 3.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```sh
pnpm test:unit -- tests/unit/prod-deploy-config.test.ts
```

Expected: fail because split services still exist.

- [ ] **Step 3: Replace app services in `infra/docker-compose.prod.yml`**

Keep `x-app-env-file`, `postgres`, and `setup`. Delete `init`, `api`, `worker`, `cli-runner`, and `web`. Replace the old always-run `migrate` service with a profile-gated manual recovery service, then add `jarv1s`.

Manual migrate recovery service:

```yaml
  migrate:
    image: ghcr.io/motioneso/jarv1s:${JARVIS_IMAGE_TAG:?set JARVIS_IMAGE_TAG to a published version tag}
    build:
      context: ..
      dockerfile: Dockerfile
    <<: *app-env-file
    command: ["node_modules/.bin/tsx", "scripts/migrate.ts"]
    depends_on:
      postgres:
        condition: service_healthy
    profiles: ["ops"]
    networks:
      - jarv1s
```

Operator recovery command if the supervisor exits during migration:

```sh
docker compose -p jarv1s-prod -f docker-compose.prod.yml --env-file ./env.production.local \
  --profile ops run --rm migrate
```

Default Jarv1s service:

```yaml
  jarv1s:
    image: ghcr.io/motioneso/jarv1s:${JARVIS_IMAGE_TAG:?set JARVIS_IMAGE_TAG to a published version tag}
    build:
      context: ..
      dockerfile: Dockerfile
    <<: *app-env-file
    command: ["node_modules/.bin/tsx", "scripts/start-jarv1s.ts"]
    environment:
      PORT: "3000"
      HOST: 0.0.0.0
      HF_HOME: /app/.cache/huggingface
      JARVIS_WEB_DIST_DIR: /app/apps/web/dist
      JARVIS_CLI_RUNNER_SOCKET: ${JARVIS_CLI_RUNNER_SOCKET:-/run/jarv1s/cli-runner.sock}
      JARVIS_CLI_RUNNER_RPC_SECRET: ${JARVIS_CLI_RUNNER_RPC_SECRET:?set JARVIS_CLI_RUNNER_RPC_SECRET (generated by setup; shell env or --env-file)}
      JARVIS_CLI_RUNNER_SINGLE_USER: "${JARVIS_CLI_RUNNER_SINGLE_USER:-0}"
      JARVIS_CLI_PER_USER_UID: "${JARVIS_CLI_PER_USER_UID:-0}"
      JARVIS_CLI_HOME: /data/cli-auth
      JARVIS_CLI_HOME_BASE: /data/cli-auth
      JARVIS_CLI_NEUTRAL_BASE: /data/cli-auth/chat
      JARVIS_CLI_TOOLS_PREFIX: /data/cli-tools
      NPM_CONFIG_PREFIX: /data/cli-tools
      JARVIS_HOST_UID: "${JARVIS_HOST_UID:-1000}"
      JARVIS_HOST_GID: "${JARVIS_HOST_GID:-1000}"
      JARVIS_MULTIPLEXER: tmux
      JARVIS_MCP_SERVER_URL: ${JARVIS_MCP_SERVER_URL:-http://127.0.0.1:3000/api/mcp}
    restart: unless-stopped
    healthcheck:
      test: ["CMD","node","-e","fetch('http://localhost:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 240s
    ports:
      - "${JARVIS_WEB_PORT:-5173}:3000"
    volumes:
      - jarv1s-vault-data:/data/vaults
      - jarv1s-model-cache:/app/.cache/huggingface
      - jarv1s-cli-tools:/data/cli-tools
      - jarv1s-cli-auth:/data/cli-auth
      - jarv1s-cli-socket:/run/jarv1s
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - jarv1s
```

Keep volumes:

```yaml
volumes:
  jarv1s-postgres-data:
  jarv1s-vault-data:
  jarv1s-model-cache:
  jarv1s-cli-tools:
  jarv1s-cli-auth:
  jarv1s-cli-socket:
```

Update comments at top of the file so they describe the single service and do not claim a separate sidecar container.

- [ ] **Step 4: Update `infra/env.production.example` wording**

Keep the role URLs and secrets. Change public URL guidance:

```env
JARVIS_API_PORT=3000
JARVIS_WEB_PORT=5173
JARVIS_AUTH_BASE_URL=https://jarv1s.example.com
JARVIS_AUTH_TRUSTED_ORIGINS=https://jarv1s.example.com
```

Remove language that says the API and web are separate public origins. Keep `JARVIS_API_PORT=3000`, but document it as the internal app/API port used by dev and CI tooling; production public browser traffic uses `JARVIS_WEB_PORT`.

- [ ] **Step 5: Commit**

```sh
git add infra/docker-compose.prod.yml infra/env.production.example tests/unit/prod-deploy-config.test.ts
git commit -m "deploy: collapse prod app services"
```

---

## Task 5: Setup And Smoke Scripts

**Files:**

- Modify: `scripts/setup-prod.ts`
- Modify: `scripts/smoke-compose.ts`
- Modify: `tests/unit/prod-compose-plan.test.ts`
- Modify: `tests/integration/release-hardening.test.ts`

- [ ] **Step 1: Update smoke expectations first**

In `tests/unit/prod-compose-plan.test.ts`, add assertions to the prod test:

```ts
expect(plan.healthUrl).toBe("http://localhost:5173/health/ready");
expect(plan.commands.some((c) => c.args.includes("api"))).toBe(false);
expect(plan.commands.some((c) => c.args.includes("web"))).toBe(false);
expect(plan.commands.some((c) => c.args.includes("worker"))).toBe(false);
expect(plan.commands.some((c) => c.args.includes("migrate"))).toBe(false);
expect(plan.commands.some((c) => c.args.includes("jarv1s"))).toBe(true);
```

- [ ] **Step 2: Run focused test and confirm it fails**

Run:

```sh
pnpm test:unit -- tests/unit/prod-compose-plan.test.ts
```

Expected: fail because smoke still targets split services and API port.

- [ ] **Step 3: Update `scripts/smoke-compose.ts`**

Change image build command to one image:

```ts
const imageTag = process.env.JARVIS_IMAGE_TAG ?? "smoke";
const isProd = input.composeFile === "infra/docker-compose.prod.yml";
const publicPort = isProd
  ? (process.env.JARVIS_WEB_PORT ?? "5173")
  : (input.apiPort ?? process.env.JARVIS_API_PORT ?? "3000");
const buildCommands: ComposeSmokeCommand[] = input.build
  ? [
      {
        command: "docker",
        args: ["build", "-t", `ghcr.io/motioneso/jarv1s:${imageTag}`, "-f", "Dockerfile", "."],
        description: "Build the Jarv1s image locally and tag it to the prod GHCR ref"
      }
    ]
  : [];
```

Return prod commands:

```ts
const migrateCommand: ComposeSmokeCommand | undefined = isProd
  ? undefined
  : {
      command: "docker",
      args: [...composeArgs, "run", "--rm", "migrate"],
      description: "Run database migrations"
    };

const upCommand: ComposeSmokeCommand = isProd
  ? {
      command: "docker",
      args: [...composeArgs, "up", "-d", "postgres", "jarv1s", "--wait"],
      description: "Start Postgres and Jarv1s services"
    }
  : {
      command: "docker",
      args: [...composeArgs, "up", "-d", "api", "web", "worker", "--wait"],
      description: "Start API, web, and worker services"
    };
```

For prod, omit the separate `run --rm migrate` command because the supervisor runs migrations before resident processes. For dev, keep the existing `migrateCommand`; dev compose is out of scope and still has split `api`, `web`, `worker`, and `migrate` services.

Set:

```ts
healthUrl: `http://localhost:${publicPort}/health/ready`;
```

- [ ] **Step 4: Keep `scripts/setup-prod.ts` auth base internal and trusted origins public**

Do **not** change `authBaseUrl` to `webPort`. Keep the API's own in-container base URL:

```ts
const authBaseUrl = process.env.JARVIS_AUTH_BASE_URL ?? "http://localhost:3000";
```

Update the nearby comment: `JARVIS_AUTH_BASE_URL` is the API process's self URL inside the container, while `JARVIS_AUTH_TRUSTED_ORIGINS` carries browser origins derived from `JARVIS_WEB_PORT` and `JARVIS_PUBLIC_ORIGIN`.

Add or update a unit test in `tests/unit/setup-prod-trusted-origins.test.ts` proving that setting `JARVIS_WEB_PORT=5179` changes trusted origins but does **not** change the default `JARVIS_AUTH_BASE_URL` from `http://localhost:3000`.

- [ ] **Step 5: Update release-hardening tests**

In `tests/integration/release-hardening.test.ts`, replace assertions that require separate API and web production origins/images with assertions that:

```ts
expect(envExample).toContain("JARVIS_WEB_PORT=");
expect(envExample).toContain("JARVIS_AUTH_BASE_URL=");
expect(envExample).toContain("JARVIS_AUTH_TRUSTED_ORIGINS=");
expect(workflow).toContain("pnpm build:web");
expect(workflow).toContain("pnpm smoke:compose -- --api-port 3099");
```

If the workflow has a prod smoke path, assert it uses `JARVIS_WEB_PORT` for prod health instead of `JARVIS_API_PORT`.

Also assert CI publishes the new single image:

```ts
expect(workflow).toContain("ghcr.io/motioneso/jarv1s:");
expect(workflow).not.toContain("jarv1s-api:");
expect(workflow).not.toContain("jarv1s-web:");
```

- [ ] **Step 6: Commit**

```sh
git add scripts/setup-prod.ts scripts/smoke-compose.ts tests/unit/prod-compose-plan.test.ts tests/integration/release-hardening.test.ts
git commit -m "test: smoke two-container production deploy"
```

---

## Task 6: Documentation Cleanup

**Files:**

- Modify: `README.md`
- Modify: `docs/operations/release-hardening.md`
- Modify: `infra/docker-compose.prod.yml`

- [ ] **Step 1: Make docs match the actual contract**

Update references to:

- `ghcr.io/motioneso/jarv1s-api` → `ghcr.io/motioneso/jarv1s`
- `ghcr.io/motioneso/jarv1s-web` → remove
- public API/web split → same-origin Jarv1s on `JARVIS_WEB_PORT`
- cli-runner sidecar container → internal cli-runner process over RPC

Do not document local absolute paths other than `~/Jarv1s`.

Add a release-hardening assertion or small unit assertion that docs no longer carry stale image names:

```ts
for (const rel of [
  "README.md",
  "docs/operations/release-hardening.md",
  "infra/docker-compose.prod.yml"
]) {
  const text = await readFile(rel, "utf8");
  expect(text).not.toContain("ghcr.io/motioneso/jarv1s-api");
  expect(text).not.toContain("ghcr.io/motioneso/jarv1s-web");
}
```

- [ ] **Step 2: Run doc-sensitive tests**

Run:

```sh
pnpm test:unit -- tests/unit/prod-deploy-config.test.ts tests/unit/prod-compose-plan.test.ts
pnpm test:release-hardening
```

Expected: pass.

- [ ] **Step 3: Commit**

```sh
git add README.md docs/operations/release-hardening.md infra/docker-compose.prod.yml
git commit -m "docs: describe two-container deploy"
```

---

## Task 7: Full Verification

**Files:** no planned source edits.

- [ ] **Step 1: Run fast local checks**

```sh
pnpm test:unit -- tests/unit/api-static-web.test.ts tests/unit/start-jarv1s-plan.test.ts tests/unit/prod-compose-plan.test.ts tests/unit/prod-deploy-config.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 2: Validate production compose config**

Run with throwaway interpolation secrets:

```sh
JARVIS_IMAGE_TAG=smoke \
POSTGRES_PASSWORD=setup \
JARVIS_CLI_RUNNER_RPC_SECRET=setup \
docker compose -f infra/docker-compose.prod.yml config --quiet
```

Expected: exit 0.

- [ ] **Step 3: Build the Jarv1s image**

```sh
docker build -t ghcr.io/motioneso/jarv1s:smoke -f Dockerfile .
```

Expected: exit 0.

- [ ] **Step 4: Run prod compose smoke**

```sh
JARVIS_IMAGE_TAG=smoke pnpm smoke:compose:prod
```

Expected: exits 0 and reports readiness at `http://localhost:5173/health/ready`.

- [ ] **Step 5: Run the standard gate if time allows**

```sh
pnpm verify:foundation
```

Expected: pass. If Docker image build or full foundation gate is too slow for the current run, record the exact command and failure/timeout.

---

## Review Gates Before Build

Before implementing Task 1, send this plan to both GLM and AGY for adversarial review. Ask each reviewer to look specifically for:

- places where the single container accidentally weakens cli-runner env isolation more than the spec allows;
- broken assumptions around `/api` vs SPA fallback routing and CSP;
- Compose startup ordering or healthcheck mistakes;
- role URL / migration sequencing regressions;
- image publishing and smoke-test mismatches.

Revise this plan after review before writing code.
