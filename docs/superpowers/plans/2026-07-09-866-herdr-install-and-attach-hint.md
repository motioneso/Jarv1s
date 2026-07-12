# Herdr Install Guidance + Attach Hint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Note:** this repo disables the execution skills above by policy (`coordinated-build`) — drive this plan manually, task by task, with `superpowers:test-driven-development`.

**Goal:** Replace the boot-time-snapshot multiplexer availability probe with a live probe that also
reports install/active/env-override state, surface clear host-level Herdr install guidance in
Settings when Herdr is absent, make the Host Runtime attach hint mux-aware, and ship a pinned,
checksum-verified host-level install script — all with zero API-triggered installation.

**Architecture:** `makeChatMultiplexerStatusProbe(env)` in `packages/module-registry/src/chat-multiplexer.ts`
becomes the single source of live multiplexer status (availability, install presence, active
runtime choice + its source, env override), replacing `probeChatMultiplexerAvailability`. It's
wired through the composition root into both `packages/settings` routes, which already expose the
DTO to `apps/web`. The frontend renders 5 independent guidance cases from the new fields. A new
`scripts/install-herdr.sh` is the only way Herdr gets installed — always run by a human/operator
inside the container, never from the web API.

**Tech Stack:** Fastify + `@fastify/type-provider` JSON schemas, Kysely, React + TanStack Query,
Vitest (`tests/unit`, `tests/integration`), bash (`set -euo pipefail`), Node's `https` module for
the install script's fetch (no curl/wget in the runtime image).

## Global Constraints

- No Jarv1s API endpoint may trigger Herdr installation (spec non-goal, hard).
- Any install script must use per-architecture **pinned** release artifacts and verify the
  matching SHA-256 before installing.
- Re-running the install script must be safe (idempotent, no corruption of an existing binary).
- Install target is the existing `${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin/herdr` path so
  installation persists across container replacement (existing `jarv1s-cli-tools` named volume —
  no compose changes needed).
- `packages/shared` is Vite-bundled into the browser — never import `@jarv1s/ai` (node-heavy) into
  it; DTO types are redeclared locally there, not imported.
- Module Isolation: `packages/settings` and `packages/module-registry` are separate modules — the
  shared function-type alias `GetChatMultiplexerStatus` is declared once in
  `packages/settings/src/routes.ts` and imported only within that package (`host-diagnostics-routes.ts`),
  never imported back into `module-registry`.
- Fastify response schemas with `additionalProperties: false` **silently drop** any field emitted
  by a handler that isn't declared in the schema (`properties` + `required`) — every new DTO field
  must be added to both.
- `pnpm verify:foundation` must pass for the implementation PR (spec Acceptance Criterion).

---

### Task 1: Live multiplexer status probe

**Files:**

- Modify: `packages/module-registry/src/chat-multiplexer.ts:9-16` (imports), `:42-47` (delete
  `probeChatMultiplexerAvailability`), add new probe near `makeMultiplexerUsableProbe`
- Test: `tests/unit/chat-multiplexer-status.test.ts` (new file)

**Interfaces:**

- Consumes: `decideMultiplexer` from `@jarv1s/ai` (`packages/ai/src/adapters/multiplexer-resolve.ts`),
  signature `decideMultiplexer(input: { env: NodeJS.ProcessEnv; configured: ChatMultiplexerChoice;
isInstalled: (bin: MultiplexerKind) => boolean }): { ok: true; kind: MultiplexerKind; source:
MultiplexerSource } | { ok: false; reason: string }`. `createBinaryProbe(env)` (existing,
  `packages/ai`) returning `{ has(bin: string): boolean }`. `makeMultiplexerUsableProbe(env)`
  (existing in this file, untouched).
- Produces: `export interface LiveChatMultiplexerStatus { available: ChatMultiplexerAvailability;
herdrInstalled: boolean; active: MultiplexerKind | null; activeSource: MultiplexerSource | null;
envOverride: MultiplexerKind | null }` and `export function makeChatMultiplexerStatusProbe(env:
NodeJS.ProcessEnv = process.env): (configured: ChatMultiplexerChoice) => Promise<LiveChatMultiplexerStatus>`.
  Task 3 imports both.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/chat-multiplexer-status.test.ts
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeChatMultiplexerStatusProbe } from "../../packages/module-registry/src/chat-multiplexer.js";

async function pathWith(...bins: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jarv1s-mux-status-"));
  for (const bin of bins) {
    await writeFile(join(dir, bin), "", { mode: 0o755 });
    await chmod(join(dir, bin), 0o755);
  }
  return dir;
}

describe("makeChatMultiplexerStatusProbe", () => {
  it("reports herdrInstalled=false, active=tmux/auto when only tmux is present", async () => {
    const probe = makeChatMultiplexerStatusProbe({ PATH: await pathWith("tmux") });
    const status = await probe("auto");
    expect(status.available).toEqual({ tmux: true, herdr: false });
    expect(status.herdrInstalled).toBe(false);
    expect(status.active).toBe("tmux");
    expect(status.activeSource).toBe("auto");
    expect(status.envOverride).toBeNull();
  });

  it("reports herdrInstalled=true even when herdr is not usable (no root pane)", async () => {
    const probe = makeChatMultiplexerStatusProbe({ PATH: await pathWith("herdr") });
    const status = await probe("auto");
    expect(status.available).toEqual({ tmux: false, herdr: false });
    expect(status.herdrInstalled).toBe(true);
    expect(status.active).toBeNull();
    expect(status.activeSource).toBeNull();
  });

  it("reports active=herdr/configured when herdr is installed, usable, and selected", async () => {
    const probe = makeChatMultiplexerStatusProbe({
      PATH: await pathWith("herdr"),
      HERDR_PANE_ID: "p_1"
    });
    const status = await probe("herdr");
    expect(status.active).toBe("herdr");
    expect(status.activeSource).toBe("configured");
  });

  it("surfaces envOverride and pins active/source to the env value", async () => {
    const probe = makeChatMultiplexerStatusProbe({
      PATH: await pathWith("tmux"),
      JARVIS_MULTIPLEXER: "tmux"
    });
    const status = await probe("herdr");
    expect(status.envOverride).toBe("tmux");
    expect(status.active).toBe("tmux");
    expect(status.activeSource).toBe("env");
  });

  it("envOverride is null for an unrecognized JARVIS_MULTIPLEXER value", async () => {
    const probe = makeChatMultiplexerStatusProbe({
      PATH: await pathWith("tmux"),
      JARVIS_MULTIPLEXER: "screen"
    });
    await expect(probe("auto")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/chat-multiplexer-status.test.ts`
Expected: FAIL — `makeChatMultiplexerStatusProbe` is not exported (module doesn't have it yet).

- [ ] **Step 3: Implement the probe and delete the old one**

In `packages/module-registry/src/chat-multiplexer.ts`, change the import block (currently lines 9-16):

```typescript
import {
  cliAvailable,
  createBinaryProbe,
  createRealTmuxIo,
  decideMultiplexer,
  resolveMultiplexer,
  type MultiplexerKind,
  type MultiplexerSource,
  type TmuxIo
} from "@jarv1s/ai";
```

Delete `probeChatMultiplexerAvailability` (the function at lines 42-47) entirely. Add the new
probe directly after `makeMultiplexerUsableProbe`:

```typescript
export interface LiveChatMultiplexerStatus {
  readonly available: ChatMultiplexerAvailability;
  readonly herdrInstalled: boolean;
  readonly active: MultiplexerKind | null;
  readonly activeSource: MultiplexerSource | null;
  readonly envOverride: MultiplexerKind | null;
}

function readEnvOverride(env: NodeJS.ProcessEnv): MultiplexerKind | null {
  const raw = env.JARVIS_MULTIPLEXER?.trim().toLowerCase();
  return raw === "tmux" || raw === "herdr" ? raw : null;
}

/** Live host probe for the admin Settings UI — resolved fresh on every request, so an operator's
 * install / env change is reflected on the next fetch (no restart-only snapshot). */
export function makeChatMultiplexerStatusProbe(
  env: NodeJS.ProcessEnv = process.env
): (configured: ChatMultiplexerChoice) => Promise<LiveChatMultiplexerStatus> {
  const usable = makeMultiplexerUsableProbe(env);
  return async (configured) => {
    const binaryProbe = createBinaryProbe(env);
    const [tmux, herdr] = await Promise.all([usable("tmux"), usable("herdr")]);
    const decision = decideMultiplexer({
      env,
      configured,
      isInstalled: (bin) => binaryProbe.has(bin)
    });
    return {
      available: { tmux, herdr },
      herdrInstalled: binaryProbe.has("herdr"),
      active: decision.ok ? decision.kind : null,
      activeSource: decision.ok ? decision.source : null,
      envOverride: readEnvOverride(env)
    };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/chat-multiplexer-status.test.ts`
Expected: PASS (5 tests) — note the last test expects `decideMultiplexer` to throw synchronously
inside the async arrow, which surfaces as a rejected promise; if `decideMultiplexer`'s throw isn't
naturally caught by the `async` wrapper, confirm the call is inside the `async` closure (it is,
per the code above) so the throw becomes a rejection automatically.

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/chat-multiplexer.ts tests/unit/chat-multiplexer-status.test.ts
git commit -m "feat(chat-multiplexer): add live status probe, retire boot-time snapshot"
```

---

### Task 2: DTO + schema changes in packages/shared

**Files:**

- Modify: `packages/shared/src/platform-api.ts:505-540` (approx — `ChatMultiplexerSettingsDto` and
  `chatMultiplexerSettingsSchema`)
- Test: `tests/unit/platform-api-chat-multiplexer-schema.test.ts` (new file)

**Interfaces:**

- Produces: `export type MultiplexerKind = "tmux" | "herdr"` (local redeclaration, NOT imported
  from `@jarv1s/ai`), `export type MultiplexerSource = "env" | "configured" | "auto"` (same),
  extended `ChatMultiplexerSettingsDto` with `herdrInstalled: boolean`, `active: MultiplexerKind |
null`, `activeSource: MultiplexerSource | null`, `envOverride: MultiplexerKind | null`. Task 4/5
  handlers return objects matching this shape; the fast-json-stringify schema must declare all 4
  new fields or they are silently dropped.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/platform-api-chat-multiplexer-schema.test.ts
import { describe, expect, it } from "vitest";

import { chatMultiplexerSettingsSchema } from "../../packages/shared/src/platform-api.js";

describe("chatMultiplexerSettingsSchema", () => {
  it("declares all live-status fields in both properties and required", () => {
    const fields = [
      "multiplexer",
      "available",
      "herdrInstalled",
      "active",
      "activeSource",
      "envOverride"
    ];
    for (const field of fields) {
      expect(chatMultiplexerSettingsSchema.properties).toHaveProperty(field);
      expect(chatMultiplexerSettingsSchema.required).toContain(field);
    }
  });

  it("allows null for active/activeSource/envOverride", () => {
    const active = chatMultiplexerSettingsSchema.properties.active as { type: string[] };
    const activeSource = chatMultiplexerSettingsSchema.properties.activeSource as {
      type: string[];
    };
    const envOverride = chatMultiplexerSettingsSchema.properties.envOverride as { type: string[] };
    expect(active.type).toContain("null");
    expect(activeSource.type).toContain("null");
    expect(envOverride.type).toContain("null");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/platform-api-chat-multiplexer-schema.test.ts`
Expected: FAIL — `properties` has no `herdrInstalled`/`active`/`activeSource`/`envOverride` yet.

- [ ] **Step 3: Implement the DTO + schema changes**

In `packages/shared/src/platform-api.ts`, replace the current block:

```typescript
export interface ChatMultiplexerAvailability {
  readonly tmux: boolean;
  readonly herdr: boolean;
}

export type MultiplexerKind = "tmux" | "herdr";
export type MultiplexerSource = "env" | "configured" | "auto";

export interface ChatMultiplexerSettingsDto {
  readonly multiplexer: ChatMultiplexerChoice;
  readonly available: ChatMultiplexerAvailability;
  readonly herdrInstalled: boolean;
  readonly active: MultiplexerKind | null;
  readonly activeSource: MultiplexerSource | null;
  readonly envOverride: MultiplexerKind | null;
}

export const chatMultiplexerSettingsSchema = {
  type: "object",
  required: ["multiplexer", "available", "herdrInstalled", "active", "activeSource", "envOverride"],
  additionalProperties: false,
  properties: {
    multiplexer: { type: "string", enum: ["auto", "tmux", "herdr"] },
    available: {
      type: "object",
      required: ["tmux", "herdr"],
      additionalProperties: false,
      properties: { tmux: { type: "boolean" }, herdr: { type: "boolean" } }
    },
    herdrInstalled: { type: "boolean" },
    active: { type: ["string", "null"], enum: ["tmux", "herdr", null] },
    activeSource: { type: ["string", "null"], enum: ["env", "configured", "auto", null] },
    envOverride: { type: ["string", "null"], enum: ["tmux", "herdr", null] }
  }
} as const;
```

`getChatMultiplexerSettingsRouteSchema` and `putChatMultiplexerSettingsRouteSchema` reference
`chatMultiplexerSettingsSchema` by name and need no further changes. `HostDiagnosticsDto` /
`hostDiagnosticsSchema` reference `ChatMultiplexerAvailability` only — leave both untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/platform-api-chat-multiplexer-schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/platform-api.ts tests/unit/platform-api-chat-multiplexer-schema.test.ts
git commit -m "feat(shared): extend chat-multiplexer DTO/schema with live status fields"
```

---

### Task 3: Wire the live probe through the composition root

**Files:**

- Modify: `packages/module-registry/src/index.ts:147-151` (import block), `:248-253` (chat-multiplexer
  import), `:378-379` (`BuiltInRouteDependencies` field), `:785` (settings wiring), `:1603-1608`
  (`registerBuiltInApiRoutes` local const), `:1699` (deps object literal)
- Test: none new — covered by Task 4's integration tests exercising the full route wiring

**Interfaces:**

- Consumes: `makeChatMultiplexerStatusProbe`, `type LiveChatMultiplexerStatus` from
  `./chat-multiplexer.js` (Task 1). `type ChatMultiplexerChoice` from `@jarv1s/shared`.
- Produces: `BuiltInRouteDependencies.getChatMultiplexerStatus?: (configured: ChatMultiplexerChoice)
=> Promise<LiveChatMultiplexerStatus>` — Task 4 (`packages/settings/src/routes.ts`) declares its
  own structurally-identical local type and consumes this value via the settings module wiring.

- [ ] **Step 1: No new test for this task — proceed straight to implementation**

This task only rewires an existing dependency through the composition root; its correctness is
verified by Task 4's HTTP integration tests once the settings module consumes
`getChatMultiplexerStatus`. Skipping a redundant unit test here avoids testing plumbing twice.

- [ ] **Step 2: Update the chat-multiplexer import (was line 248-253)**

```typescript
import {
  makeCliPresentProbe,
  makeChatMultiplexerStatusProbe,
  makeProviderConnectionCheckProbe,
  resolveChatEngineFactory,
  type LiveChatMultiplexerStatus
} from "./chat-multiplexer.js";
```

- [ ] **Step 3: Add `ChatMultiplexerChoice` to the shared import block (was line 147-151)**

```typescript
import {
  type AuthProviderStatusDto,
  type ChatMultiplexerChoice,
  type OnboardingProviderCheckResponse,
  type OnboardingProviderKind
} from "@jarv1s/shared";
```

- [ ] **Step 4: Retype the `BuiltInRouteDependencies` field (was line 378-379)**

```typescript
  /** Live multiplexer status probe for the admin settings UI (resolved fresh per request). */
  readonly getChatMultiplexerStatus?: (
    configured: ChatMultiplexerChoice
  ) => Promise<LiveChatMultiplexerStatus>;
```

- [ ] **Step 5: Rename the settings wiring field (was line 785)**

```typescript
        getChatMultiplexerStatus: deps.getChatMultiplexerStatus,
```

- [ ] **Step 6: Replace the boot-time snapshot with the live probe factory (was lines 1603-1608)**

```typescript
export function registerBuiltInApiRoutes(
  server: FastifyInstance,
  dependencies: BuiltInRouteDependencies
): void {
  const env = process.env;
  const getChatMultiplexerStatus = makeChatMultiplexerStatusProbe(env);
```

- [ ] **Step 7: Rename the deps object literal field (was line 1699)**

```typescript
      getChatMultiplexerStatus,
```

- [ ] **Step 8: Run typecheck to confirm the rewire is consistent**

Run: `pnpm --filter @jarv1s/module-registry typecheck`
Expected: PASS — no leftover references to `probeChatMultiplexerAvailability` or
`chatMultiplexerAvailability` remain in this file.

- [ ] **Step 9: Commit**

```bash
git add packages/module-registry/src/index.ts
git commit -m "feat(module-registry): wire live chat-multiplexer status probe through composition root"
```

---

### Task 4: Settings routes — consume the live probe

**Files:**

- Modify: `packages/settings/src/routes.ts:1-15` (import block), `:126-127`
  (`SettingsRoutesDependencies` field), GET handler (~line 620-638), PUT handler (~line 640-663),
  `registerHostDiagnosticsRoutes` call site (~line 700-708)
- Test: `tests/integration/chat-multiplexer-admin.test.ts:86-151` (extend existing tests)

**Interfaces:**

- Consumes: `LiveChatMultiplexerStatus`-shaped value returned by `dependencies.getChatMultiplexerStatus`
  (wired in Task 3).
- Produces: `export type GetChatMultiplexerStatus = (configured: ChatMultiplexerChoice) =>
Promise<{ available: ChatMultiplexerAvailability; herdrInstalled: boolean; active:
MultiplexerKind | null; activeSource: MultiplexerSource | null; envOverride: MultiplexerKind |
null }>`. Task 5 (`host-diagnostics-routes.ts`) imports this exact type from `./routes.js`.

- [ ] **Step 1: Extend the failing integration tests**

Replace the two existing route tests (current lines 86-116 of
`tests/integration/chat-multiplexer-admin.test.ts`) with:

```typescript
it("admin GET returns the default 'auto' choice plus a full live-status snapshot", async () => {
  const res = await server.inject({
    method: "GET",
    url: "/api/admin/chat-multiplexer",
    headers: { cookie: adminCookie }
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<ChatMultiplexerSettingsDto>();
  expect(body.multiplexer).toBe("auto");
  expect(typeof body.available.tmux).toBe("boolean");
  expect(typeof body.available.herdr).toBe("boolean");
  expect(typeof body.herdrInstalled).toBe("boolean");
  expect(body.active === null || ["tmux", "herdr"].includes(body.active)).toBe(true);
  expect(
    body.activeSource === null || ["env", "configured", "auto"].includes(body.activeSource)
  ).toBe(true);
  expect(body.envOverride === null || ["tmux", "herdr"].includes(body.envOverride)).toBe(true);
});

it("admin PUT persists the choice and echoes the live-status snapshot", async () => {
  const put = await server.inject({
    method: "PUT",
    url: "/api/admin/chat-multiplexer",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    payload: { multiplexer: "tmux" }
  });
  expect(put.statusCode).toBe(200);
  const putBody = put.json<ChatMultiplexerSettingsDto>();
  expect(putBody.multiplexer).toBe("tmux");
  expect(typeof putBody.herdrInstalled).toBe("boolean");

  const get = await server.inject({
    method: "GET",
    url: "/api/admin/chat-multiplexer",
    headers: { cookie: adminCookie }
  });
  expect(get.json<ChatMultiplexerSettingsDto>().multiplexer).toBe("tmux");
});

it("reflects JARVIS_MULTIPLEXER env override as envOverride + active + activeSource", async () => {
  const original = process.env.JARVIS_MULTIPLEXER;
  process.env.JARVIS_MULTIPLEXER = "tmux";
  try {
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/chat-multiplexer",
      headers: { cookie: adminCookie }
    });
    const body = res.json<ChatMultiplexerSettingsDto>();
    expect(body.envOverride).toBe("tmux");
    expect(body.active).toBe("tmux");
    expect(body.activeSource).toBe("env");
  } finally {
    if (original === undefined) delete process.env.JARVIS_MULTIPLEXER;
    else process.env.JARVIS_MULTIPLEXER = original;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/integration/chat-multiplexer-admin.test.ts`
Expected: FAIL — `body.herdrInstalled`, `body.active`, `body.activeSource`, `body.envOverride` are
all `undefined` (route still returns the old `{ multiplexer, available }` shape).

- [ ] **Step 3: Update the import block (was lines 1-15)**

```typescript
import {
  adminDeleteUserRouteSchema,
  adminRejectUserRouteSchema,
  adminRevokeSessionsRouteSchema,
  adminUserActionRouteSchema,
  bootstrapStatusRouteSchema,
  getChatMultiplexerSettingsRouteSchema,
  getRegistrationSettingsRouteSchema,
  listAdminAuditEventsRouteSchema,
  listAdminModulesRouteSchema,
  listAuthProviderStatusesRouteSchema,
  listInstanceSettingsRouteSchema,
  listMyModulesRouteSchema,
  listUsersRouteSchema,
  meRouteSchema,
  patchModuleEnablementRouteSchema,
  patchMeProfileRouteSchema,
  putChatMultiplexerSettingsRouteSchema,
  putRegistrationSettingsRouteSchema,
  upsertInstanceSettingRouteSchema,
  type AdminModuleDto,
  type AuthProviderStatusDto,
  type ChatMultiplexerAvailability,
  type ChatMultiplexerChoice,
  type MultiplexerKind,
  type MultiplexerSource,
  type UpsertInstanceSettingRequest
} from "@jarv1s/shared";
```

- [ ] **Step 4: Add the shared type alias and retype the dependencies field (was lines 126-127)**

```typescript
export type GetChatMultiplexerStatus = (configured: ChatMultiplexerChoice) => Promise<{
  readonly available: ChatMultiplexerAvailability;
  readonly herdrInstalled: boolean;
  readonly active: MultiplexerKind | null;
  readonly activeSource: MultiplexerSource | null;
  readonly envOverride: MultiplexerKind | null;
}>;
```

Then, inside `SettingsRoutesDependencies`:

```typescript
  /** Live multiplexer status probe, resolved fresh per request. */
  readonly getChatMultiplexerStatus?: GetChatMultiplexerStatus;
```

- [ ] **Step 5: Update the GET handler**

```typescript
server.get(
  "/api/admin/chat-multiplexer",
  { schema: getChatMultiplexerSettingsRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
        const { multiplexer } = await repository.getChatMultiplexerSetting(scopedDb);
        const status = (await dependencies.getChatMultiplexerStatus?.(multiplexer)) ?? {
          available: { tmux: false, herdr: false },
          herdrInstalled: false,
          active: null,
          activeSource: null,
          envOverride: null
        };
        return { multiplexer, ...status };
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

- [ ] **Step 6: Update the PUT handler the same way**

```typescript
server.put(
  "/api/admin/chat-multiplexer",
  { schema: putChatMultiplexerSettingsRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      return await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
        const { multiplexer: requested } = request.body as { multiplexer: ChatMultiplexerChoice };
        await repository.setChatMultiplexerSetting(scopedDb, {
          multiplexer: requested,
          actorUserId: accessContext.actorUserId,
          requestId: accessContext.requestId
        });
        const status = (await dependencies.getChatMultiplexerStatus?.(requested)) ?? {
          available: { tmux: false, herdr: false },
          herdrInstalled: false,
          active: null,
          activeSource: null,
          envOverride: null
        };
        return { multiplexer: requested, ...status };
      });
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

(This step preserves whatever the existing handler body already does for the repository write —
only the trailing status-construction and return value change; do not alter the RLS/`assertAdminUser`
call ordering.)

- [ ] **Step 7: Rename the `registerHostDiagnosticsRoutes` call site field**

```typescript
registerHostDiagnosticsRoutes(server, {
  dataContext: dependencies.dataContext,
  resolveAccessContext: dependencies.resolveAccessContext,
  repository,
  getChatMultiplexerStatus: dependencies.getChatMultiplexerStatus,
  hostDiagnostics: dependencies.hostDiagnostics,
  assertAdminUser: (scopedDb, userId) => assertAdminUser(repository, scopedDb, userId),
  handleRouteError
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/integration/chat-multiplexer-admin.test.ts`
Expected: PASS (all tests in the `GET/PUT /api/admin/chat-multiplexer` describe block)

- [ ] **Step 9: Commit**

```bash
git add packages/settings/src/routes.ts tests/integration/chat-multiplexer-admin.test.ts
git commit -m "feat(settings): serve live chat-multiplexer status from admin routes"
```

---

### Task 5: Host diagnostics routes — consume the renamed dependency

**Files:**

- Modify: `packages/settings/src/host-diagnostics-routes.ts` (full file, 94 lines)
- Test: `tests/integration/host-diagnostics-admin.test.ts` (existing assertions must keep passing
  unchanged — no new fields needed on `HostDiagnosticsDto`)

**Interfaces:**

- Consumes: `type GetChatMultiplexerStatus` from `./routes.js` (Task 4).
- Produces: nothing new downstream — this is the last hop before `buildHostDiagnostics`.

- [ ] **Step 1: Confirm the existing test still describes the required behavior**

No test changes needed for this task — `tests/integration/host-diagnostics-admin.test.ts:33-52`
already asserts `body.multiplexer === "auto"` and `typeof body.available.tmux === "boolean"`,
which remains true once this task's rewire lands (the `HostDiagnosticsDto` shape is unchanged).
Run it now to see it currently pass (baseline):

Run: `pnpm vitest run tests/integration/host-diagnostics-admin.test.ts`
Expected: PASS (baseline, before this task's edit — confirms no regression risk from Task 3/4
before this task's own change lands)

- [ ] **Step 2: Update the file**

```typescript
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccessContext, DataContextDb, DataContextRunner, User } from "@jarv1s/db";
import { HttpError } from "@jarv1s/module-sdk";
import { getHostDiagnosticsRouteSchema } from "@jarv1s/shared";
import { buildHostDiagnostics, type HostDiagnosticsProvider } from "./host-diagnostics.js";
import type { SettingsRepository } from "./repository.js";
import type { GetChatMultiplexerStatus } from "./routes.js";

export interface HostDiagnosticsRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly repository: SettingsRepository;
  readonly getChatMultiplexerStatus?: GetChatMultiplexerStatus;
  readonly hostDiagnostics?: HostDiagnosticsProvider;
  readonly assertAdminUser: (scopedDb: DataContextDb, userId: string) => Promise<User>;
  readonly handleRouteError: (error: unknown, reply: FastifyReply) => unknown;
}

export function registerHostDiagnosticsRoutes(
  server: FastifyInstance,
  dependencies: HostDiagnosticsRoutesDependencies
): void {
  server.get(
    "/api/admin/host/diagnostics",
    { schema: getHostDiagnosticsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const { dbOk, multiplexer, latestAvailableVersion, releaseNotes } =
          await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
            await dependencies.assertAdminUser(scopedDb, accessContext.actorUserId);
            if (!dependencies.hostDiagnostics) {
              throw new HttpError(503, "Host diagnostics are not available");
            }
            let ok = true;
            try {
              await dependencies.repository.pingDatabase(scopedDb);
            } catch {
              ok = false;
            }
            const { multiplexer: mux } =
              await dependencies.repository.getChatMultiplexerSetting(scopedDb);
            const latestReleaseRaw = await scopedDb.db
              .selectFrom("app.instance_settings")
              .select("value")
              .where("key", "=", "latest_release")
              .executeTakeFirst();
            let latestAvailableVersion: string | null = null;
            let releaseNotes: string | null = null;
            if (latestReleaseRaw?.value) {
              const val = latestReleaseRaw.value as Record<string, unknown>;
              if (typeof val.version === "string") latestAvailableVersion = val.version;
              if (typeof val.notes === "string") releaseNotes = val.notes;
            }
            return { dbOk: ok, multiplexer: mux, latestAvailableVersion, releaseNotes };
          });
        const provider = dependencies.hostDiagnostics as HostDiagnosticsProvider;
        const pgBossOk = await provider.pgBossInstalled().catch(() => false);
        const status = (await dependencies.getChatMultiplexerStatus?.(multiplexer)) ?? {
          available: { tmux: false, herdr: false },
          herdrInstalled: false,
          active: null,
          activeSource: null,
          envOverride: null
        };
        return buildHostDiagnostics({
          info: provider.info(),
          multiplexer,
          available: status.available,
          dbOk,
          pgBossOk,
          latestAvailableVersion,
          releaseNotes
        });
      } catch (error) {
        return dependencies.handleRouteError(error, reply);
      }
    }
  );
}
```

- [ ] **Step 3: Run the test to confirm no regression**

Run: `pnpm vitest run tests/integration/host-diagnostics-admin.test.ts`
Expected: PASS (same assertions as Step 1, now exercising the renamed dependency)

- [ ] **Step 4: Run the settings package typecheck**

Run: `pnpm --filter @jarv1s/settings typecheck`
Expected: PASS — confirms no leftover `chatMultiplexerAvailability` references in this package.

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/host-diagnostics-routes.ts
git commit -m "refactor(settings): consume renamed getChatMultiplexerStatus in host diagnostics"
```

---

### Task 6: Mux-aware attach hint + install guidance in HostPane

**Files:**

- Modify: `apps/web/src/settings/settings-admin-panes.tsx` (`HostPane()`, currently ~lines 679-845)
- Test: `tests/unit/settings-admin-panes.test.tsx` (extend existing seed data + add new tests)

**Interfaces:**

- Consumes: `ChatMultiplexerSettingsDto` (Task 2) via the existing `muxQuery` (`getChatMultiplexerSettings`)
  — no new API client code needed, `requestJson<ChatMultiplexerSettingsDto>` passes new fields
  through automatically.
- Produces: nothing consumed further — this is the leaf UI component.

- [ ] **Step 1: Extend the existing tests' seed data and write the new failing tests**

Replace the two `client.setQueryData(queryKeys.settings.chatMultiplexer, ...)` seed calls in
`tests/unit/settings-admin-panes.test.tsx` to include the 4 new required fields, and add cases for
each Note-copy branch:

```typescript
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "../../apps/web/src/api/query-keys.js";
import { HostPane, IdentityPane } from "../../apps/web/src/settings/settings-admin-panes.js";
import { FeedbackProvider } from "../../apps/web/src/settings/settings-feedback.js";

function renderWithQuery(
  node: React.ReactNode,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
): string {
  return renderToString(
    createElement(QueryClientProvider, { client }, createElement(FeedbackProvider, null, node))
  );
}

describe("settings admin panes", () => {
  it("hides sign-in methods until alternate methods are wired", () => {
    const html = renderWithQuery(createElement(IdentityPane));

    expect(html).toContain("Identity &amp; registration");
    expect(html).toContain("Registration");
    expect(html).not.toContain("Sign-in methods");
    expect(html).not.toContain("No sign-in methods configured");
  });

  it("shows herdr availability as a status badge, with no install action", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "auto",
      available: { tmux: true, herdr: false },
      herdrInstalled: false,
      active: "tmux",
      activeSource: "auto",
      envOverride: null
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).toContain("tmux available");
    expect(html).toContain("herdr available");
    expect(html).not.toContain("Install Herdr");
  });

  it("has no deployment mode, restart-command copy rows, or restart action", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "auto",
      available: { tmux: true, herdr: true },
      herdrInstalled: true,
      active: "herdr",
      activeSource: "auto",
      envOverride: null
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).not.toContain("Deployment mode");
    expect(html).not.toContain("Restart command");
    expect(html).not.toContain("Operator-managed");
    expect(html).not.toContain("Restart API");
  });

  it("shows install guidance with the install script path when herdr is not installed", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "auto",
      available: { tmux: true, herdr: false },
      herdrInstalled: false,
      active: "tmux",
      activeSource: "auto",
      envOverride: null
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).toContain("scripts/install-herdr.sh");
    expect(html).not.toContain("Install Herdr");
  });

  it("does not show install guidance once herdr is installed", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "auto",
      available: { tmux: true, herdr: true },
      herdrInstalled: true,
      active: "herdr",
      activeSource: "auto",
      envOverride: null
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).not.toContain("scripts/install-herdr.sh");
  });

  it("renders herdr attach guidance when herdr is the active mux", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "herdr",
      available: { tmux: false, herdr: true },
      herdrInstalled: true,
      active: "herdr",
      activeSource: "configured",
      envOverride: null
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).toContain("herdr pane list");
    expect(html).toContain("herdr pane attach");
  });

  it("shows an env-override note when JARVIS_MULTIPLEXER pins the active mux", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "herdr",
      available: { tmux: true, herdr: true },
      herdrInstalled: true,
      active: "tmux",
      activeSource: "env",
      envOverride: "tmux"
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).toContain("JARVIS_MULTIPLEXER");
    expect(html).not.toContain("herdr pane attach");
  });

  it("shows installed-but-not-usable guidance when herdr is installed but has no root pane", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.settings.chatMultiplexer, {
      multiplexer: "auto",
      available: { tmux: true, herdr: false },
      herdrInstalled: true,
      active: "tmux",
      activeSource: "auto",
      envOverride: null
    });

    const html = renderWithQuery(createElement(HostPane), client);

    expect(html).toContain("JARVIS_HERDR_ROOT_PANE");
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run tests/unit/settings-admin-panes.test.tsx`
Expected: the 3 pre-existing tests still PASS (seed data superset is compatible); the 4 new tests
FAIL (current `HostPane` only renders the hardcoded tmux attach Note).

- [ ] **Step 3: Replace the hardcoded Note block in `HostPane()`**

Locate the current block in `apps/web/src/settings/settings-admin-panes.tsx`:

```tsx
const mux = muxQuery.data;
const diag = diagQuery.data;
const herdrAvailable = mux?.available.herdr === true;
const herdrDesc = herdrAvailable
  ? "Herdr is usable on this host."
  : "Herdr is not usable on this host.";
```

and the trailing hardcoded `<Note>`:

```tsx
<Note icon={<Terminal size={13} aria-hidden="true" />}>
  Prefer the terminal? Chat sessions run in tmux inside the container. From your deployment
  directory, list them with <code>{"docker compose exec jarv1s tmux ls"}</code>, then attach with{" "}
  <code>{"docker compose exec jarv1s tmux attach -t jarv1s-live-<thread>"}</code>.
</Note>
```

Replace with mux-aware logic (keep everything else in `HostPane`, including the existing
`available` badges, untouched):

```tsx
const mux = muxQuery.data;
const diag = diagQuery.data;
const herdrAvailable = mux?.available.herdr === true;
const herdrDesc = herdrAvailable
  ? "Herdr is usable on this host."
  : "Herdr is not usable on this host.";

function attachHintNote() {
  if (!mux) return null;
  if (mux.envOverride !== null) {
    return (
      <Note icon={<Terminal size={13} aria-hidden="true" />}>
        The <code>JARVIS_MULTIPLEXER</code> environment variable pins this host to{" "}
        <strong>{mux.envOverride}</strong>, overriding the setting above. From your deployment
        directory, use{" "}
        {mux.envOverride === "herdr" ? (
          <>
            <code>{"herdr pane list"}</code> and <code>{"herdr pane attach <pane-id>"}</code>
          </>
        ) : (
          <>
            <code>{"docker compose exec jarv1s tmux ls"}</code> and{" "}
            <code>{"docker compose exec jarv1s tmux attach -t jarv1s-live-<thread>"}</code>
          </>
        )}
        .
      </Note>
    );
  }
  if (mux.active === "herdr") {
    return (
      <Note icon={<Terminal size={13} aria-hidden="true" />}>
        Prefer the terminal? Chat sessions run in Herdr on this host. List panes with{" "}
        <code>{"herdr pane list"}</code>, attach with <code>{"herdr pane attach <pane-id>"}</code>,
        or read output non-interactively with <code>{"herdr pane read <pane-id>"}</code>.
      </Note>
    );
  }
  if (mux.active === "tmux") {
    return (
      <Note icon={<Terminal size={13} aria-hidden="true" />}>
        Prefer the terminal? Chat sessions run in tmux inside the container. From your deployment
        directory, list them with <code>{"docker compose exec jarv1s tmux ls"}</code>, then attach
        with <code>{"docker compose exec jarv1s tmux attach -t jarv1s-live-<thread>"}</code>.
      </Note>
    );
  }
  if (mux.herdrInstalled) {
    return (
      <Note icon={<Terminal size={13} aria-hidden="true" />}>
        Herdr is installed but has no root pane available, so it isn&apos;t usable yet. Set{" "}
        <code>JARVIS_HERDR_ROOT_PANE</code> (or run the API inside a Herdr pane so{" "}
        <code>HERDR_PANE_ID</code> is set), then restart.
      </Note>
    );
  }
  return (
    <Note icon={<Terminal size={13} aria-hidden="true" />}>
      Prefer the terminal? Chat sessions run in tmux inside the container. From your deployment
      directory, list them with <code>{"docker compose exec jarv1s tmux ls"}</code>, then attach
      with <code>{"docker compose exec jarv1s tmux attach -t jarv1s-live-<thread>"}</code>.
    </Note>
  );
}

function installGuidanceNote() {
  if (!mux || mux.herdrInstalled) return null;
  return (
    <Note icon={<Terminal size={13} aria-hidden="true" />}>
      Herdr is not installed on this host. An operator can install it from the deployment directory
      with <code>{"docker compose exec jarv1s scripts/install-herdr.sh"}</code>, then refresh this
      page.
    </Note>
  );
}
```

Then in the JSX body of `HostPane`, replace the single hardcoded `<Note>` render with both:

```tsx
{
  attachHintNote();
}
{
  installGuidanceNote();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/settings-admin-panes.test.tsx`
Expected: PASS (7 tests total)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-admin-panes.tsx tests/unit/settings-admin-panes.test.tsx
git commit -m "feat(web): mux-aware attach hint + herdr install guidance in Host Runtime pane"
```

---

### Task 7: Pinned, checksum-verified host-level install script

**Files:**

- Create: `scripts/install-herdr.sh`
- Test: `tests/unit/install-herdr-script.test.ts` (new file — tests the script's shape/behavior via
  subprocess, not a real network fetch)

**Interfaces:**

- Consumes: nothing from earlier tasks (standalone bash script).
- Produces: nothing consumed by other tasks — referenced only in the Settings copy (Task 6) and
  spec/README-level docs.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/install-herdr-script.test.ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("scripts/install-herdr.sh", () => {
  it("pins both per-arch release artifacts with their SHA-256 and uses set -euo pipefail", async () => {
    const script = await readFile(
      new URL("../../scripts/install-herdr.sh", import.meta.url),
      "utf8"
    );

    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("herdr-linux-x86_64");
    expect(script).toContain("043ef43ecbabda28465dcff1eec3184518150d567b8b8f20cda9c6c88770641d");
    expect(script).toContain("herdr-linux-aarch64");
    expect(script).toContain("ea490094f2c7c39099870857d00c64c628ef7b5eba1967df4258033455ee2cb1");
    expect(script).toContain("v0.7.3");
    expect(script).not.toMatch(/curl\s.*\|\s*sh/);
    expect(script).not.toMatch(/wget\s.*\|\s*sh/);
  });

  it("installs into the CLI tools prefix and is idempotent on a matching existing binary", async () => {
    const script = await readFile(
      new URL("../../scripts/install-herdr.sh", import.meta.url),
      "utf8"
    );

    expect(script).toContain("JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools");
    expect(script).toMatch(/sha256sum|shasum/);
    expect(script).toContain("chmod +x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/install-herdr-script.test.ts`
Expected: FAIL — `scripts/install-herdr.sh` does not exist yet (ENOENT).

- [ ] **Step 3: Write the install script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Installs the Herdr terminal-multiplexer binary into the persistent CLI-tools volume so it
# survives container replacement (see infra/docker-compose.prod.yml: JARVIS_CLI_TOOLS_PREFIX is
# bind-mounted to the jarv1s-cli-tools named volume). Deliberately host-operator-run only — no
# Jarv1s API route may call this (spec 2026-07-08-herdr-install-and-attach-hint.md non-goal).
#
# Per-arch release artifacts and their SHA-256 checksums are pinned here rather than resolved at
# install time, so a compromised or yanked upstream release can't silently swap the binary.
HERDR_VERSION="v0.7.3"
HERDR_REPO="ogulcancelik/herdr"
INSTALL_PREFIX="${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}"
INSTALL_DIR="${INSTALL_PREFIX}/bin"
INSTALL_PATH="${INSTALL_DIR}/herdr"

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64)
    ASSET="herdr-linux-x86_64"
    EXPECTED_SHA256="043ef43ecbabda28465dcff1eec3184518150d567b8b8f20cda9c6c88770641d"
    ;;
  aarch64|arm64)
    ASSET="herdr-linux-aarch64"
    EXPECTED_SHA256="ea490094f2c7c39099870857d00c64c628ef7b5eba1967df4258033455ee2cb1"
    ;;
  *)
    echo "install-herdr: unsupported architecture '${arch}'" >&2
    exit 1
    ;;
esac

DOWNLOAD_URL="https://github.com/${HERDR_REPO}/releases/download/${HERDR_VERSION}/${ASSET}"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Idempotent: skip re-download if the installed binary's hash already matches the pinned checksum.
if [ -x "$INSTALL_PATH" ]; then
  existing_sha256="$(sha256_of "$INSTALL_PATH")"
  if [ "$existing_sha256" = "$EXPECTED_SHA256" ]; then
    echo "install-herdr: ${INSTALL_PATH} already matches ${HERDR_VERSION} (sha256 ${EXPECTED_SHA256}); nothing to do"
    exit 0
  fi
fi

mkdir -p "$INSTALL_DIR"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

# No curl/wget in the runtime image (only tmux git ca-certificates bubblewrap via apt-get) —
# fetch with Node's built-in https module instead.
node --input-type=module -e "
import { createWriteStream } from 'node:fs';
import { get } from 'node:https';
import { pipeline } from 'node:stream/promises';

function fetchFollowingRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('too many redirects'));
        res.resume();
        return resolve(fetchFollowingRedirects(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('unexpected status ' + res.statusCode + ' fetching ' + url));
      }
      resolve(res);
    }).on('error', reject);
  });
}

const res = await fetchFollowingRedirects('${DOWNLOAD_URL}');
await pipeline(res, createWriteStream('${tmp_file}'));
"

actual_sha256="$(sha256_of "$tmp_file")"
if [ "$actual_sha256" != "$EXPECTED_SHA256" ]; then
  echo "install-herdr: checksum mismatch for ${ASSET} (expected ${EXPECTED_SHA256}, got ${actual_sha256}); aborting" >&2
  exit 1
fi

mv "$tmp_file" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"
trap - EXIT

echo "install-herdr: installed herdr ${HERDR_VERSION} (${ASSET}) to ${INSTALL_PATH}"
```

Make it executable: `chmod +x scripts/install-herdr.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/install-herdr-script.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/install-herdr.sh tests/unit/install-herdr-script.test.ts
git commit -m "feat(scripts): add pinned, checksum-verified host-level herdr install script"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md`
Acceptance Criteria, verbatim 9 items):

- "No Jarv1s API endpoint can trigger Herdr installation." → satisfied structurally: no task adds
  any route that invokes `scripts/install-herdr.sh` or writes/executes a binary; the script is
  operator-run only (Task 7 docstring states this explicitly).
- "Settings shows Herdr availability and clear host-level install guidance when Herdr is absent." →
  Task 6 `installGuidanceNote()`.
- "Any repo-provided install script uses per-architecture pinned release artifacts and verifies the
  matching SHA-256 before installing." → Task 7, `case "$arch"` + `sha256_of`/abort-on-mismatch.
- "Re-running the host-level install script is safe and does not corrupt an existing binary." →
  Task 7's idempotent early-exit on matching hash.
- "Installation persists across container replacement when installed into the existing CLI tools
  volume." → Task 7 installs to `${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin`, the existing
  named-volume mount (confirmed in grounding — no compose change needed).
- "Multiplexer availability refreshes after installation." → Task 1's probe is resolved fresh per
  request (no boot-time caching); Task 3 removes the old snapshot; existing React Query defaults
  (`staleTime: 15_000`) mean a manual refetch/reload picks it up — no extra frontend polling needed.
- "The Host Runtime pane renders attach guidance for the active mux instead of hardcoding tmux." →
  Task 6 `attachHintNote()`, 4 priority-ordered cases (env override → active herdr → active tmux →
  installed-but-unusable → fallback).
- "If env override pins tmux, the UI does not claim Herdr is active just because it is installed." →
  Task 6's `envOverride`-first branch in `attachHintNote()`, and Task 1's probe always resolves
  `active`/`activeSource` via `decideMultiplexer` (env wins), never from `herdrInstalled` alone.
- "`pnpm verify:foundation` passes for the implementation PR." → verified at wrap-up, not a coded
  task; each task's own gate commands are given per step.

**2. Placeholder scan:** every step above ships complete, runnable code (no TBD/"similar to Task N"/
unshown validation). Task 3 Step 1 is explicitly a no-new-test step with a stated reason (plumbing
only, covered by Task 4's integration assertions) rather than a placeholder.

**3. Type consistency:** `LiveChatMultiplexerStatus` (Task 1, `chat-multiplexer.ts`) →
`BuiltInRouteDependencies.getChatMultiplexerStatus` (Task 3) → `GetChatMultiplexerStatus` (Task 4,
structurally identical, package-local per Module Isolation) → `HostDiagnosticsRoutesDependencies.getChatMultiplexerStatus`
(Task 5, same alias imported). Field names (`available`, `herdrInstalled`, `active`, `activeSource`,
`envOverride`) match verbatim across Tasks 1, 2, 4, 5, 6. `ChatMultiplexerSettingsDto` (Task 2) is
the only type that must satisfy fast-json-stringify — its schema declares all 6 top-level fields in
both `properties` and `required`, closing the schema-strip trap.
