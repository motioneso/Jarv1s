# OTNR Module Registry MCP URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move chat MCP URL resolution out of `@jarv1s/module-registry` and into the API composition/config seam.

**Architecture:** `BuiltInRouteDependencies` receives a resolved `mcpServerUrl`, and the chat module wiring forwards that value without reading `process.env`. `apps/api/src/server.ts` owns API host/port config and derives the loopback MCP URL from the same resolved port used by `listen()`.

**Tech Stack:** TypeScript, Vitest, Fastify route wiring, pnpm workspace scripts.

---

## File Structure

- Create: `tests/unit/module-registry-mcp-url.test.ts` — focused regression test that mocks `@jarv1s/chat`, invokes the chat registration entry, and asserts the injected URL wins over `process.env.PORT`.
- Modify: `packages/module-registry/src/index.ts` — add `mcpServerUrl` to `BuiltInRouteDependencies`; pass `deps.mcpServerUrl` into `registerChatRoutes`.
- Modify: `apps/api/src/server.ts` — add typed `ApiServerConfig` / `resolveApiServerConfig`, pass `mcpServerUrl` to `registerBuiltInApiRoutes`, and reuse the config for `listen()`.

## Task 1: Failing Registry Seam Test

**Files:**

- Create: `tests/unit/module-registry-mcp-url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const registerChatRoutes = vi.fn();

vi.mock("@jarv1s/chat", () => ({
  CHAT_QUEUE_DEFINITIONS: [],
  CliChatUnavailableError: class CliChatUnavailableError extends Error {},
  chatModuleManifest: {
    id: "chat",
    name: "Chat",
    version: "0.0.0",
    publisher: "test",
    lifecycle: "required",
    compatibility: { jarv1s: ">=0.0.0" },
    availability: { defaultEnabled: true }
  },
  chatModuleSqlMigrationDirectory: "mock-chat-sql",
  registerChatJobWorkers: vi.fn(),
  registerChatRoutes
}));

describe("module-registry chat MCP URL wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    registerChatRoutes.mockClear();
  });

  it("passes the composition-root MCP server URL instead of reading PORT", async () => {
    vi.stubEnv("PORT", "9999");
    const { getBuiltInModuleRegistrations } = await import("@jarv1s/module-registry");
    const chatRegistration = getBuiltInModuleRegistrations().find(
      (registration) => registration.manifest.id === "chat"
    );

    chatRegistration?.registerRoutes?.({} as never, {
      boss: {} as never,
      dataContext: {} as never,
      focusSignals: undefined,
      listConfiguredAuthProviders: () => [],
      listModuleManifests: () => [],
      mcpServerUrl: "http://configured.example.test/api/mcp",
      resolveAccessContext: async () => ({ actorUserId: "user-1", requestId: "req-1" }),
      resolveActiveModules: async () => [],
      rootDb: {} as never
    });

    expect(registerChatRoutes).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        mcpServerUrl: "http://configured.example.test/api/mcp"
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/module-registry-mcp-url.test.ts`

Expected: TypeScript/Vitest failure because `mcpServerUrl` is not part of `BuiltInRouteDependencies` yet, or assertion failure showing `http://127.0.0.1:9999/api/mcp`.

- [ ] **Step 3: Commit not yet**

Do not commit red tests alone unless blocked.

## Task 2: Minimal Registry/API Config Implementation

**Files:**

- Modify: `packages/module-registry/src/index.ts`
- Modify: `apps/api/src/server.ts`
- Test: `tests/unit/module-registry-mcp-url.test.ts`

- [ ] **Step 1: Add registry dependency field and use it**

In `packages/module-registry/src/index.ts`, add this field near `chatEngineFactory`:

```ts
  /** Resolved MCP endpoint advertised to CLI chat engines. Owned by API composition config. */
  readonly mcpServerUrl: string;
```

Then change the chat registration dependency:

```ts
        mcpServerUrl: deps.mcpServerUrl,
```

- [ ] **Step 2: Add API server config seam**

In `apps/api/src/server.ts`, add these exports near `CreateApiServerOptions`:

```ts
export interface ApiServerConfig {
  readonly host: string;
  readonly port: number;
  readonly mcpServerUrl: string;
}

export function resolveApiServerConfig(env: NodeJS.ProcessEnv = process.env): ApiServerConfig {
  const port = Number(env.PORT ?? 3000);
  const host = env.HOST ?? "0.0.0.0";
  return {
    host,
    port,
    mcpServerUrl: `http://127.0.0.1:${port}/api/mcp`
  };
}
```

Extend `CreateApiServerOptions`:

```ts
  readonly apiServerConfig?: ApiServerConfig;
```

Inside `createApiServer`, before constructing Fastify:

```ts
const apiServerConfig = options.apiServerConfig ?? resolveApiServerConfig();
```

Pass the resolved URL into `registerBuiltInApiRoutes`:

```ts
      mcpServerUrl: apiServerConfig.mcpServerUrl,
```

Update the entrypoint:

```ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const apiServerConfig = resolveApiServerConfig();
  const server = createApiServer({ apiServerConfig });
  const port = apiServerConfig.port;
  const host = apiServerConfig.host;
```

- [ ] **Step 3: Run focused test to verify green**

Run: `pnpm vitest run tests/unit/module-registry-mcp-url.test.ts`

Expected: PASS.

- [ ] **Step 4: Run package/server typechecks**

Run: `pnpm --filter @jarv1s/module-registry typecheck && pnpm --filter @jarv1s/api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/module-registry-mcp-url.test.ts packages/module-registry/src/index.ts apps/api/src/server.ts
git commit -m "fix: inject module registry MCP URL config" -m "Co-Authored-By: Claude Sonnet 4.6"
```

## Task 3: Pre-Push Verification And PR

**Files:**

- Verify only; no expected code edits unless checks fail.

- [ ] **Step 1: Run fast pre-push trio**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`

Expected: PASS.

- [ ] **Step 2: Rebase on PR target**

Run: `git fetch origin overnight-batch-2026-06-16 && git rebase origin/overnight-batch-2026-06-16`

Expected: branch rebases cleanly.

- [ ] **Step 3: Run focused regression again**

Run: `pnpm vitest run tests/unit/module-registry-mcp-url.test.ts`

Expected: PASS.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin otnr-modreg-296
gh pr create --base overnight-batch-2026-06-16 --head otnr-modreg-296 --title "[OTNR-P28] Inject module registry MCP URL config" --body "Fixes #296"
```

Expected: PR opens against `overnight-batch-2026-06-16`.

## Self-Review

- Spec coverage: covers issue #296 and OTNR P28 finding by removing direct `process.env.PORT` use from `packages/module-registry/src/index.ts` and injecting `mcpServerUrl` from API config.
- Out of scope respected: no onboarding, docs/coordination, broad registry API reshaping, migrations, or web onboarding edits.
- Type consistency: `ApiServerConfig.mcpServerUrl` flows into `BuiltInRouteDependencies.mcpServerUrl`, then into `registerChatRoutes`.
- Placeholder scan: no TBD/TODO/fill-later steps.
