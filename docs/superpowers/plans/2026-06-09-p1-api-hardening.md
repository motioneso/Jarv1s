# P1 API Hardening — Crash Safety + Health + Rate Limiting (Issues #54, #53)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the API process-crash-safe (unhandled errors exit cleanly), split `/health` into honest liveness + readiness endpoints, and add in-memory rate limiting on credential + OAuth paste-back routes.

**Architecture:** Two issues land on one branch (`p1-api-hardening`) in one PR. Build #54 fully (green), then #53 on top. `packages/db/src/database.ts` gets a connection timeout so an unreachable Postgres fails fast. `apps/api/src/server.ts` gains two health routes and a crash handler in the CLI bootstrap block; `apps/worker/src/worker.ts` gains a crash handler alongside its existing signal handlers. Rate limiting is a single `@fastify/rate-limit` plugin registration with `global:false` — only the auth catch-all and the OAuth paste-back route opt in via per-route `config.rateLimit`.

**Tech Stack:** Fastify v5, `@fastify/rate-limit` v9, Kysely `sql` tagged template, `pg-boss` `isInstalled()` probe, Vitest integration tests via `server.inject()`.

---

## File Map

| File | Change |
|------|--------|
| `packages/db/src/database.ts` | Add `connectionTimeoutMillis` to `DatabaseOptions` + pool construction |
| `apps/api/src/server.ts` | Split `/health`, add `/health/ready`, add crash handlers (CLI block only), register rate-limit plugin, apply to auth catch-all |
| `apps/worker/src/worker.ts` | Add crash handlers alongside SIGINT/SIGTERM |
| `packages/connectors/src/routes.ts` | Add `config.rateLimit` to POST `/api/connectors/google/complete` |
| `tests/integration/api-health.test.ts` | NEW — test liveness always 200; readiness 200 healthy, 503 dead-DB |
| `tests/integration/api-rate-limit.test.ts` | NEW — test 429 on auth burst; 429 on oauth burst; no throttle on GET routes |

---

## ── PHASE 1: #54 — Crash Safety + Honest /health ──

---

### Task 1: Add `connectionTimeoutMillis` to `createDatabase`

**Files:**
- Modify: `packages/db/src/database.ts`

- [ ] **Step 1: Read the current file**

```
packages/db/src/database.ts
```

Current content:
```typescript
export interface DatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
}

export function createDatabase(options: DatabaseOptions): Kysely<JarvisDatabase> {
  return new Kysely<JarvisDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: options.connectionString,
        max: options.maxConnections ?? 4
      })
    })
  });
}
```

- [ ] **Step 2: Apply the change**

Replace the entire file with:

```typescript
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { JarvisDatabase } from "./types.js";

const { Pool } = pg;

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMillis?: number;
}

export function createDatabase(options: DatabaseOptions): Kysely<JarvisDatabase> {
  return new Kysely<JarvisDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: options.connectionString,
        max: options.maxConnections ?? 4,
        connectionTimeoutMillis:
          options.connectionTimeoutMillis ??
          Number(process.env.JARVIS_DB_CONNECT_TIMEOUT_MS ?? 5000)
      })
    })
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening && pnpm typecheck 2>&1 | tail -20
```

Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 4: Commit**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
git add packages/db/src/database.ts
git commit -m "$(cat <<'EOF'
feat(db): add connectionTimeoutMillis to createDatabase — fail fast on unreachable Postgres

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Split `/health` into liveness + readiness in `server.ts`

**Files:**
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write a failing integration test FIRST (red)**

Create `tests/integration/api-health.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

describe("Health endpoints", () => {
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    await resetFoundationDatabase();
    server = createApiServer({
      appDb: createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 }),
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
  });

  it("GET /health returns 200 without touching DB (liveness)", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /health/ready returns 200 when DB + pg-boss are reachable", async () => {
    const res = await server.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; db: string; pgboss: string }>();
    expect(body.ok).toBe(true);
    expect(body.db).toBe("ok");
    expect(body.pgboss).toBe("ok");
  });
});

describe("Health readiness — DB down", () => {
  let server: ReturnType<typeof createApiServer>;
  let badDb: Kysely<JarvisDatabase>;

  beforeAll(async () => {
    // Point at an unreachable port — connection will time out immediately
    badDb = createDatabase({
      connectionString: "postgres://jarvis:jarvis@localhost:9999/nonexistent",
      maxConnections: 1,
      connectionTimeoutMillis: 500  // fail fast in tests
    });
    // Stub boss so boss.start() in onReady doesn't blow up
    const stubBoss = {
      start: async () => {},
      stop: async () => {},
      isInstalled: async () => true
    } as unknown as PgBoss;

    server = createApiServer({ appDb: badDb, boss: stubBoss, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), badDb?.destroy()]);
  });

  it("GET /health returns 200 even when DB is down (liveness independent)", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /health/ready returns 503 with db:down when DB is unreachable", async () => {
    const res = await server.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
    const body = res.json<{ ok: boolean; db: string; pgboss: string }>();
    expect(body.ok).toBe(false);
    expect(body.db).toBe("down");
    expect(body.pgboss).toBe("ok");
  });
});
```

- [ ] **Step 2: Run to confirm it fails (red)**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
JARVIS_PGDATABASE=jarvis_api vitest run tests/integration/api-health.test.ts 2>&1 | tail -30
```

Expected: Tests fail — `/health/ready` route doesn't exist yet (returns 404).

- [ ] **Step 3: Implement the /health split in server.ts**

In `apps/api/src/server.ts`, change the kysely import from type-only to include `sql`:

```typescript
// Change this line:
import type { Kysely } from "kysely";
// To:
import { sql, type Kysely } from "kysely";
```

Replace the existing single `/health` handler:
```typescript
  server.get("/health", async () => ({
    ok: true
  }));
```

With both handlers:
```typescript
  server.get("/health", async () => ({ ok: true }));

  server.get("/health/ready", async (_, reply) => {
    let dbStatus = "ok";
    let pgbossStatus = "ok";

    try {
      await sql`SELECT 1`.execute(appDb);
    } catch {
      dbStatus = "down";
    }

    try {
      const installed = await boss.isInstalled();
      if (!installed) {
        pgbossStatus = "down";
      }
    } catch {
      pgbossStatus = "down";
    }

    const healthy = dbStatus === "ok" && pgbossStatus === "ok";
    return reply.code(healthy ? 200 : 503).send({ ok: healthy, db: dbStatus, pgboss: pgbossStatus });
  });
```

- [ ] **Step 4: Run the tests (green)**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
JARVIS_PGDATABASE=jarvis_api vitest run tests/integration/api-health.test.ts 2>&1 | tail -30
```

Expected: All 4 tests pass (liveness 200, readiness 200, liveness-still-200-when-db-down, readiness 503).

- [ ] **Step 5: Commit**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
git add apps/api/src/server.ts tests/integration/api-health.test.ts
git commit -m "$(cat <<'EOF'
feat(api): split /health (liveness) + /health/ready (readiness) — honest DB + pg-boss probe (P1 #54)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Install crash handlers in `apps/api/src/server.ts` (CLI bootstrap block)

**Files:**
- Modify: `apps/api/src/server.ts`

The crash handlers MUST go inside the `if (import.meta.url === ...)` block only — not in `createApiServer` — so tests don't register process-global handlers.

- [ ] **Step 1: Implement the crash handler block**

Find the CLI bootstrap block:
```typescript
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createApiServer();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  await server.listen({ host, port });
}
```

Replace it with:
```typescript
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createApiServer();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  const handleCrash = (label: string, err: unknown): void => {
    server.log.error({ err, label }, "Process crash — exiting");
    const drain = Promise.race([
      new Promise<void>((resolve) => { server.close(() => resolve()); }),
      new Promise<void>((resolve) => { setTimeout(resolve, 2000); })
    ]);
    void drain.then(() => { process.exit(1); });
  };

  process.on("unhandledRejection", (reason) => { handleCrash("unhandledRejection", reason); });
  process.on("uncaughtException", (err: Error) => { handleCrash("uncaughtException", err); });

  await server.listen({ host, port });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening && pnpm typecheck 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
git add apps/api/src/server.ts
git commit -m "$(cat <<'EOF'
feat(api): install unhandledRejection + uncaughtException crash handlers (P1 #54)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Install crash handlers in `apps/worker/src/worker.ts`

**Files:**
- Modify: `apps/worker/src/worker.ts`

- [ ] **Step 1: Implement crash handlers alongside existing signal handlers**

The existing SIGINT/SIGTERM block:
```typescript
async function shutdown(): Promise<void> {
  await Promise.allSettled([boss.stop({ graceful: false }), workerDb.destroy()]);
}

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
```

Add the crash handlers immediately after the SIGTERM handler:
```typescript
const handleCrash = (label: string, err: unknown): void => {
  console.error(JSON.stringify({ level: "fatal", label, err: String(err), msg: "Process crash — exiting" }));
  const drain = Promise.race([
    shutdown(),
    new Promise<void>((resolve) => { setTimeout(resolve, 2000); })
  ]);
  void drain.then(() => { process.exit(1); });
};

process.on("unhandledRejection", (reason) => { handleCrash("unhandledRejection", reason); });
process.on("uncaughtException", (err: Error) => { handleCrash("uncaughtException", err); });
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening && pnpm typecheck 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
git add apps/worker/src/worker.ts
git commit -m "$(cat <<'EOF'
feat(worker): install unhandledRejection + uncaughtException crash handlers (P1 #54)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Run full gate — #54 complete check

- [ ] **Step 1: Ensure Postgres is up**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening && pnpm db:up 2>&1 | tail -5
```

- [ ] **Step 2: Run integration test suite to confirm health tests pass**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
JARVIS_PGDATABASE=jarvis_api vitest run tests/integration/api-health.test.ts 2>&1 | tail -20
```

Expected: 4 passed.

- [ ] **Step 3: Run lint + typecheck**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
pnpm lint 2>&1 | tail -20 && pnpm typecheck 2>&1 | tail -20
```

Expected: clean.

---

## ── PHASE 2: #53 — Rate Limiting ──

---

### Task 6: Add `@fastify/rate-limit` dependency + register plugin

**Files:**
- Modify: `package.json` (root)
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Add the dependency to root package.json**

In the root `package.json`, add `"@fastify/rate-limit": "^9"` to `dependencies` alongside `"fastify"`. The exact location in the file — find the `"fastify": "^5.6.2"` line and add the new entry nearby in alphabetical order.

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening && grep -n '"fastify"' package.json
```

Then add (keeping alphabetical order with `@fastify/` prefix before `fastify`):
```json
"@fastify/rate-limit": "^9",
```

- [ ] **Step 2: Install**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening && pnpm install 2>&1 | tail -10
```

Expected: lockfile updated, `@fastify/rate-limit` installed.

- [ ] **Step 3: Write the failing rate-limit test (red)**

Create `tests/integration/api-rate-limit.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase } from "@jarv1s/db";
import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

describe("Rate limiting", () => {
  let server: ReturnType<typeof createApiServer>;

  beforeAll(async () => {
    // Use low thresholds so tests don't need 10+ requests
    process.env.JARVIS_RL_AUTH_MAX = "2";
    process.env.JARVIS_RL_OAUTH_MAX = "2";

    await resetFoundationDatabase();
    server = createApiServer({
      appDb: createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 }),
      logger: false
    });
    await server.ready();
  });

  afterAll(async () => {
    await server?.close();
    delete process.env.JARVIS_RL_AUTH_MAX;
    delete process.env.JARVIS_RL_OAUTH_MAX;
  });

  it("bursting POST /api/auth/sign-in/email past threshold returns 429", async () => {
    const payload = JSON.stringify({ email: "test@example.test", password: "wrong" });
    const headers = { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" };

    // First 2 requests should pass through to better-auth (401/422, not 429)
    const res1 = await server.inject({ method: "POST", url: "/api/auth/sign-in/email", headers, payload });
    const res2 = await server.inject({ method: "POST", url: "/api/auth/sign-in/email", headers, payload });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    // 3rd request hits the rate limit
    const res3 = await server.inject({ method: "POST", url: "/api/auth/sign-in/email", headers, payload });
    expect(res3.statusCode).toBe(429);
  });

  it("POST /api/auth/sign-up/email is also throttled", async () => {
    const payload = JSON.stringify({ name: "A", email: "a@example.test", password: "wrong" });
    const headers = { "content-type": "application/json", "x-forwarded-for": "2.3.4.5" };

    const res1 = await server.inject({ method: "POST", url: "/api/auth/sign-up/email", headers, payload });
    const res2 = await server.inject({ method: "POST", url: "/api/auth/sign-up/email", headers, payload });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    const res3 = await server.inject({ method: "POST", url: "/api/auth/sign-up/email", headers, payload });
    expect(res3.statusCode).toBe(429);
  });

  it("GET /api/auth/session is NOT throttled (non-mutating auth request)", async () => {
    const headers = { "x-forwarded-for": "3.4.5.6" };
    // 5 rapid GETs — should all pass through (none 429)
    for (let i = 0; i < 5; i++) {
      const res = await server.inject({ method: "GET", url: "/api/auth/get-session", headers });
      expect(res.statusCode).not.toBe(429);
    }
  });

  it("bursting POST /api/connectors/google/complete past threshold returns 429", async () => {
    const payload = JSON.stringify({ redirectUrl: "https://example.test/cb?code=x" });
    const headers = { "content-type": "application/json", "x-forwarded-for": "4.5.6.7" };

    const res1 = await server.inject({ method: "POST", url: "/api/connectors/google/complete", headers, payload });
    const res2 = await server.inject({ method: "POST", url: "/api/connectors/google/complete", headers, payload });
    expect(res1.statusCode).not.toBe(429);
    expect(res2.statusCode).not.toBe(429);

    const res3 = await server.inject({ method: "POST", url: "/api/connectors/google/complete", headers, payload });
    expect(res3.statusCode).toBe(429);
  });

  it("GET /health is not throttled", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await server.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    }
  });
});
```

- [ ] **Step 4: Run to confirm it fails (red)**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
JARVIS_PGDATABASE=jarvis_api vitest run tests/integration/api-rate-limit.test.ts 2>&1 | tail -30
```

Expected: Tests fail — rate limiter not yet registered so bursts return 401/422, not 429.

- [ ] **Step 5: Register the rate-limit plugin in server.ts**

Add the import at the top of `apps/api/src/server.ts`:
```typescript
import rateLimit from "@fastify/rate-limit";
```

In `createApiServer`, immediately after `const server = Fastify({...})` and before the `/health` route, add:

```typescript
  const AUTH_MAX = Number(process.env.JARVIS_RL_AUTH_MAX ?? 10);
  const OAUTH_MAX = Number(process.env.JARVIS_RL_OAUTH_MAX ?? 5);

  server.register(rateLimit, {
    global: false,
    keyGenerator: (request) => {
      const forwarded = request.headers["x-forwarded-for"];
      if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0]?.trim() ?? request.ip;
      }
      return request.ip;
    }
  });
```

Pass `AUTH_MAX` and `OAUTH_MAX` down to `registerBetterAuthRoutes` and store them so `registerConnectorsRoutes` can use them. The cleanest approach: update the function signatures to accept the maxes.

Update `registerBetterAuthRoutes` call and signature:

```typescript
// In createApiServer, update the call:
registerBetterAuthRoutes(server, authRuntime, AUTH_MAX);

// Update the function signature:
function registerBetterAuthRoutes(
  server: FastifyInstance,
  authRuntime: JarvisAuthRuntime,
  authMax: number
): void {
  server.route({
    method: ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"],
    url: "/api/auth/*",
    config: {
      rateLimit: {
        max: authMax,
        timeWindow: "1 minute",
        allowList: (request) => {
          // Only throttle POST sign-in/sign-up — skip all other auth paths
          if (request.method !== "POST") return true;
          return (
            !request.url.includes("/sign-in/email") &&
            !request.url.includes("/sign-up/email")
          );
        }
      }
    },
    handler: (request, reply) => handleBetterAuthRequest(request, reply, authRuntime)
  });
}
```

- [ ] **Step 6: Typecheck**

```bash
cd /home/ben/Jarv1s/.claire/worktrees/p1-api-hardening && pnpm typecheck 2>&1 | tail -30
```

Expected: no new errors. If `allowList` type is not recognized, check that `@fastify/rate-limit` augments Fastify types correctly — importing `rateLimit` at the top of the file should trigger the module augmentation.

- [ ] **Step 7: Run tests (partial green — google/complete not yet limited)**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
JARVIS_PGDATABASE=jarvis_api vitest run tests/integration/api-rate-limit.test.ts 2>&1 | tail -30
```

Expected: auth tests pass (rate-limited); google/complete test still fails (not yet limited).

- [ ] **Step 8: Commit auth rate limit (partial)**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
git add apps/api/src/server.ts package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(api): register @fastify/rate-limit + throttle sign-in/sign-up (10/min per IP, env-overridable) (P1 #53)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Apply rate limit to `POST /api/connectors/google/complete`

**Files:**
- Modify: `packages/connectors/src/routes.ts`

- [ ] **Step 1: Locate the google/complete route**

```bash
grep -n "google/complete" /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening/packages/connectors/src/routes.ts
```

The route is `server.post("/api/connectors/google/complete", { schema: googleCompleteRouteSchema }, ...)`.

- [ ] **Step 2: Add the rate-limit config**

Change the route from:
```typescript
  server.post(
    "/api/connectors/google/complete",
    { schema: googleCompleteRouteSchema },
    async (request, reply) => {
```

To:
```typescript
  const OAUTH_MAX = Number(process.env.JARVIS_RL_OAUTH_MAX ?? 5);

  server.post(
    "/api/connectors/google/complete",
    {
      schema: googleCompleteRouteSchema,
      config: { rateLimit: { max: OAUTH_MAX, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
```

Place the `OAUTH_MAX` const just before the route definition (inside `registerConnectorsRoutes`, after the local variables are set up). Keep it scoped to the file.

- [ ] **Step 3: Typecheck**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening && pnpm typecheck 2>&1 | tail -20
```

Expected: no new errors. The `config.rateLimit` type is augmented by `@fastify/rate-limit` when that package's types are in scope (imported in server.ts where the plugin is registered).

- [ ] **Step 4: Run all rate-limit tests (all green)**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
JARVIS_PGDATABASE=jarvis_api vitest run tests/integration/api-rate-limit.test.ts 2>&1 | tail -30
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
git add packages/connectors/src/routes.ts tests/integration/api-rate-limit.test.ts
git commit -m "$(cat <<'EOF'
feat(connectors): rate-limit POST /api/connectors/google/complete (5/min per IP, env-overridable) (P1 #53)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full gate — verify both #54 and #53

- [ ] **Step 1: Ensure Postgres is up**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening && pnpm db:up 2>&1 | tail -5
```

- [ ] **Step 2: Run the full gate (capture output)**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
JARVIS_PGDATABASE=jarvis_api pnpm verify:foundation > /tmp/gate-p1-api-hardening.txt 2>&1
echo "Exit: $?"
```

Read the exit code:
```bash
cat /tmp/gate-p1-api-hardening.txt | tail -40
```

Expected: Exit 0. All checks (lint, format:check, check:file-size, typecheck, db:migrate, test:integration) pass.

- [ ] **Step 3: Fix any issues found**

If lint fails: `pnpm format` to fix formatting, then `pnpm lint --fix` for auto-fixable issues.
If typecheck fails: address each error.
If check:file-size fails: any file over 1000 lines must be decomposed (server.ts is the most likely candidate — check its line count with `wc -l apps/api/src/server.ts`).
If integration tests fail: re-run the specific failing file to isolate.

- [ ] **Step 4: Commit any fixes**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-api-hardening
# Stage only the files you touched in fixes
git add <specific files>
git commit -m "$(cat <<'EOF'
fix(api): gate cleanup — lint/format/type fixes for #54 + #53

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Exit Criteria Checklist

Before calling `coordinated-wrap-up`, verify each item:

**#54:**
- [ ] `GET /health` returns `200 {ok:true}` — no DB touch (test asserts this)
- [ ] `GET /health/ready` returns `200 {ok:true, db:"ok", pgboss:"ok"}` when healthy
- [ ] `GET /health/ready` returns `503 {ok:false, db:"down", pgboss:"ok"}` when DB unreachable
- [ ] `apps/api/src/server.ts` CLI block has `unhandledRejection` + `uncaughtException` handlers
- [ ] `apps/worker/src/worker.ts` has same handlers (verified by inspection + typecheck)
- [ ] `packages/db/src/database.ts` pool has `connectionTimeoutMillis` (default 5000ms, env-overridable)
- [ ] `pnpm verify:foundation` green

**#53:**
- [ ] `@fastify/rate-limit` in root `package.json` and lockfile
- [ ] Burst of `POST /api/auth/sign-in/email` past threshold → 429 (test asserts)
- [ ] Burst of `POST /api/auth/sign-up/email` past threshold → 429 (test asserts)
- [ ] `GET /api/auth/*` requests NOT throttled (test asserts)
- [ ] Burst of `POST /api/connectors/google/complete` past threshold → 429 (test asserts)
- [ ] `GET /health` NOT throttled (test asserts)
- [ ] Thresholds env-overridable via `JARVIS_RL_AUTH_MAX` / `JARVIS_RL_OAUTH_MAX`
- [ ] `pnpm verify:foundation` green

**Process gate:**
- [ ] Invoke `coordinated-wrap-up` to open PR titled `feat(api): crash-safety + health + rate-limiting (P1 #54, #53)` and report to Coordinator.
