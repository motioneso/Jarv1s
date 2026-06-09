# Jarv1s Chat Phase 2 — MCP Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the transport-independent core of the Jarv1s MCP gateway — the module→tool contract, the dispatcher, per-session identity, the hardcoded policy, and the server-side blocking confirmation bridge — all exercised by integration tests with no live CLI.

**Architecture:** A generic in-process `AssistantToolGateway` (in `packages/ai`) lists module-owned tools (declaration + `execute` handler co-located on the manifest), validates input, applies a hardcoded risk policy, and — for `write`/`destructive` — creates a pending `ai_assistant_action_requests` row, notifies the session via an injected `SessionNotifier`, and **blocks** on an in-memory promise until a separate `resolveActionRequest` call settles it. Identity comes only from a server-minted per-session token. A test-only fixture module proves the whole contract.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest integration tests against Postgres (`pnpm db:up`), Kysely + `DataContextRunner`/`withDataContext` for RLS, `node:crypto` `randomUUID`.

**Out of scope (follow-on plan, after spike #32):** MCP transport binding (HTTP-direct vs stdio-shim), CLI launch wiring + per-CLI native-tool allowlist lockdown, the real chat `SessionNotifier` implementation + drawer Approve/Deny card, and connecting any real module. This plan ends at a gateway fully tested through the fixture.

---

## File Structure

| File                                                         | Responsibility                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `packages/module-sdk/src/index.ts` (modify)                  | Add `ToolInput`/`ToolContext`/`ToolResult`; extend `ModuleAssistantToolManifest` with optional `execute`/`summarize`. |
| `packages/ai/src/gateway/policy.ts` (create)                 | `resolvePolicy(risk)` → `"run"                                                                                        | "confirm"`. Hardcoded; destructive always confirm. |
| `packages/ai/src/gateway/session-tokens.ts` (create)         | In-memory per-session token registry: mint/verify/revoke.                                                             |
| `packages/ai/src/gateway/confirmation-registry.ts` (create)  | In-memory promise registry keyed by action-request id: await/resolve with timeout.                                    |
| `packages/ai/src/gateway/input-validation.ts` (create)       | Minimal dependency-free `validateToolInput(schema, input)`.                                                           |
| `packages/ai/src/gateway/types.ts` (create)                  | `SessionNotifier`, `ActiveModulesResolver`, `GatewayToolResponse`, gateway record types.                              |
| `packages/ai/src/gateway/gateway.ts` (create)                | `AssistantToolGateway`: `listTools`, `callTool`, `resolveActionRequest`.                                              |
| `packages/ai/src/index.ts` (modify)                          | Export the gateway + gateway types.                                                                                   |
| `tests/integration/fixtures/example-tool-module.ts` (create) | Fixture module manifest with `example.read`/`example.write`/`example.destroy` handlers.                               |
| `tests/integration/mcp-gateway.test.ts` (create)             | Integration tests for the gateway through the fixture.                                                                |
| `tests/unit/mcp-gateway-units.test.ts` (create)              | Unit tests for policy, tokens, confirmation registry, validation.                                                     |

Reuse (do not rebuild): `AiRepository.createPendingAssistantAction` / `resolveAssistantAction` / `listAssistantActions`, `summarizeAssistantToolInput` (both in `packages/ai`), `DataContextRunner`/`withDataContext`/`AccessContext` (`@jarv1s/db`), `listAssistantToolsFromManifests` (`packages/ai/src/assistant-tools.ts`), and the integration harness `tests/integration/test-database.js` (`connectionStrings`, `ids`, `resetFoundationDatabase`).

---

## Task 1: Tool contract types + extend the manifest

**Files:**

- Modify: `packages/module-sdk/src/index.ts`
- Test: `tests/unit/mcp-gateway-units.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mcp-gateway-units.test.ts
import { describe, expect, it } from "vitest";
import type { ModuleAssistantToolManifest, ToolContext, ToolResult } from "@jarv1s/module-sdk";

describe("module-sdk tool contract", () => {
  it("lets a module declare a tool with an execute handler", async () => {
    const ctx: ToolContext = { actorUserId: "u1", requestId: "r1", chatSessionId: "s1" };
    const tool: ModuleAssistantToolManifest = {
      name: "example.read",
      description: "Echo back a value.",
      permissionId: "example.view",
      risk: "read",
      inputSchema: { type: "object", properties: { value: { type: "string" } } },
      execute: async (_scopedDb, input): Promise<ToolResult> => ({ data: { echo: input.value } })
    };

    const result = await tool.execute!({} as never, { value: "hi" }, ctx);
    expect(result.data).toEqual({ echo: "hi" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "execute handler"`
Expected: FAIL — `ToolContext`/`ToolResult` not exported; `execute` not on `ModuleAssistantToolManifest`.

- [ ] **Step 3: Add the types to module-sdk**

In `packages/module-sdk/src/index.ts`, add near `ModuleAssistantToolManifest`:

```ts
export type ToolInput = Record<string, unknown>;

export interface ToolContext {
  readonly actorUserId: string;
  readonly requestId: string;
  readonly chatSessionId: string;
}

export interface ToolResult {
  readonly data: Record<string, unknown>;
}

// Execution handler; `scopedDb` is a DataContextDb supplied by the gateway under
// withDataContext. Typed as `unknown` here to avoid a module-sdk -> db dependency;
// the gateway passes a real DataContextDb and the module narrows it via its own repo.
export type ToolExecute = (
  scopedDb: unknown,
  input: ToolInput,
  ctx: ToolContext
) => Promise<ToolResult>;

export type ToolSummarize = (input: ToolInput, ctx: ToolContext) => string;
```

Then extend the manifest interface — add the two optional members:

```ts
export interface ModuleAssistantToolManifest {
  readonly name: string;
  readonly description: string;
  readonly permissionId: string;
  readonly risk: ModuleAssistantToolRisk;
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly featureFlagId?: string;
  readonly execute?: ToolExecute;
  readonly summarize?: ToolSummarize;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "execute handler"`
Expected: PASS

- [ ] **Step 5: Verify the DTO serializer is unaffected**

Run: `pnpm vitest run tests/integration/ai-tools.test.ts` (requires `pnpm db:up`)
Expected: PASS — `listAssistantToolsFromManifests` maps fields explicitly, so the new function members never reach DTOs.

- [ ] **Step 6: Commit**

```bash
git add packages/module-sdk/src/index.ts tests/unit/mcp-gateway-units.test.ts
git commit -m "feat(module-sdk): add assistant-tool execution contract (execute/summarize + Tool* types)"
```

---

## Task 2: Hardcoded policy

**Files:**

- Create: `packages/ai/src/gateway/policy.ts`
- Test: `tests/unit/mcp-gateway-units.test.ts`

- [ ] **Step 1: Write the failing test** (append to the unit test file)

```ts
import { resolvePolicy } from "@jarv1s/ai";

describe("gateway policy", () => {
  it("runs reads, confirms writes, always confirms destructive", () => {
    expect(resolvePolicy("read")).toBe("run");
    expect(resolvePolicy("write")).toBe("confirm");
    expect(resolvePolicy("destructive")).toBe("confirm");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "gateway policy"`
Expected: FAIL — `resolvePolicy` not exported.

- [ ] **Step 3: Implement**

```ts
// packages/ai/src/gateway/policy.ts
import type { ModuleAssistantToolRisk } from "@jarv1s/module-sdk";

export type PolicyDecision = "run" | "confirm";

/**
 * Phase 2 policy is hardcoded: reads run, writes confirm, destructive ALWAYS
 * confirms (the un-skippable floor). Configurable per-user policy is the future
 * Module Connector epic (#30) — the destructive floor survives even then.
 */
export function resolvePolicy(risk: ModuleAssistantToolRisk): PolicyDecision {
  return risk === "read" ? "run" : "confirm";
}
```

Export from `packages/ai/src/index.ts`:

```ts
export { resolvePolicy, type PolicyDecision } from "./gateway/policy.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "gateway policy"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/policy.ts packages/ai/src/index.ts tests/unit/mcp-gateway-units.test.ts
git commit -m "feat(ai): hardcoded gateway policy (read=run, write/destructive=confirm)"
```

---

## Task 3: Per-session token registry

**Files:**

- Create: `packages/ai/src/gateway/session-tokens.ts`
- Test: `tests/unit/mcp-gateway-units.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { SessionTokenRegistry, InvalidSessionTokenError } from "@jarv1s/ai";

describe("session token registry", () => {
  it("mints a token that resolves to its identity, and fails after revoke", () => {
    const registry = new SessionTokenRegistry();
    const token = registry.mint({ actorUserId: "u1", chatSessionId: "s1" });

    expect(registry.verify(token)).toEqual({ actorUserId: "u1", chatSessionId: "s1" });

    registry.revoke(token);
    expect(() => registry.verify(token)).toThrow(InvalidSessionTokenError);
    expect(() => registry.verify("never-minted")).toThrow(InvalidSessionTokenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "session token"`
Expected: FAIL — `SessionTokenRegistry` not exported.

- [ ] **Step 3: Implement**

```ts
// packages/ai/src/gateway/session-tokens.ts
import { randomUUID } from "node:crypto";

export interface SessionIdentity {
  readonly actorUserId: string;
  readonly chatSessionId: string;
}

export class InvalidSessionTokenError extends Error {
  constructor() {
    super("Invalid or revoked session token");
    this.name = "InvalidSessionTokenError";
  }
}

/**
 * In-memory registry of per-session tokens. Identity NEVER comes from the agent's
 * input — only from a token the API minted at engine launch and revokes at reap.
 */
export class SessionTokenRegistry {
  private readonly tokens = new Map<string, SessionIdentity>();

  mint(identity: SessionIdentity): string {
    const token = `jst_${randomUUID()}`;
    this.tokens.set(token, identity);
    return token;
  }

  verify(token: string): SessionIdentity {
    const identity = this.tokens.get(token);
    if (!identity) {
      throw new InvalidSessionTokenError();
    }
    return identity;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }
}
```

Export from `packages/ai/src/index.ts`:

```ts
export {
  SessionTokenRegistry,
  InvalidSessionTokenError,
  type SessionIdentity
} from "./gateway/session-tokens.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "session token"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/session-tokens.ts packages/ai/src/index.ts tests/unit/mcp-gateway-units.test.ts
git commit -m "feat(ai): per-session token registry for gateway identity"
```

---

## Task 4: Confirmation registry (in-memory promise + timeout)

**Files:**

- Create: `packages/ai/src/gateway/confirmation-registry.ts`
- Test: `tests/unit/mcp-gateway-units.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { ConfirmationRegistry } from "@jarv1s/ai";

describe("confirmation registry", () => {
  it("settles an awaited id with the resolved status", async () => {
    const registry = new ConfirmationRegistry();
    const pending = registry.awaitResolution("a1", 1000);
    registry.resolve("a1", "confirmed");
    await expect(pending).resolves.toBe("confirmed");
  });

  it("returns 'timeout' when not resolved in time", async () => {
    const registry = new ConfirmationRegistry();
    await expect(registry.awaitResolution("a2", 10)).resolves.toBe("timeout");
  });

  it("ignores resolve for an unknown id", () => {
    const registry = new ConfirmationRegistry();
    expect(() => registry.resolve("nope", "confirmed")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "confirmation registry"`
Expected: FAIL — `ConfirmationRegistry` not exported.

- [ ] **Step 3: Implement**

```ts
// packages/ai/src/gateway/confirmation-registry.ts
export type ResolutionStatus = "confirmed" | "rejected" | "cancelled";
export type AwaitOutcome = ResolutionStatus | "timeout";

interface Waiter {
  readonly settle: (outcome: AwaitOutcome) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Bridges the synchronous blocked tool call to the asynchronous human Approve/Deny.
 * In-memory only: a server restart mid-wait orphans the call (accepted cost).
 */
export class ConfirmationRegistry {
  private readonly waiters = new Map<string, Waiter>();

  awaitResolution(actionRequestId: string, timeoutMs: number): Promise<AwaitOutcome> {
    return new Promise<AwaitOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(actionRequestId);
        resolve("timeout");
      }, timeoutMs);

      this.waiters.set(actionRequestId, {
        settle: (outcome) => {
          clearTimeout(timer);
          this.waiters.delete(actionRequestId);
          resolve(outcome);
        },
        timer
      });
    });
  }

  resolve(actionRequestId: string, status: ResolutionStatus): void {
    this.waiters.get(actionRequestId)?.settle(status);
  }
}
```

Export from `packages/ai/src/index.ts`:

```ts
export {
  ConfirmationRegistry,
  type ResolutionStatus,
  type AwaitOutcome
} from "./gateway/confirmation-registry.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "confirmation registry"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/confirmation-registry.ts packages/ai/src/index.ts tests/unit/mcp-gateway-units.test.ts
git commit -m "feat(ai): confirmation registry bridging blocked tool call to human approval"
```

---

## Task 5: Minimal input validation

**Files:**

- Create: `packages/ai/src/gateway/input-validation.ts`
- Test: `tests/unit/mcp-gateway-units.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { validateToolInput, ToolInputValidationError } from "@jarv1s/ai";

describe("tool input validation", () => {
  const schema = {
    type: "object",
    required: ["taskId"],
    properties: { taskId: { type: "string" }, count: { type: "number" } }
  };

  it("accepts valid input", () => {
    expect(validateToolInput(schema, { taskId: "t1", count: 2 })).toEqual({
      taskId: "t1",
      count: 2
    });
  });

  it("rejects a missing required key", () => {
    expect(() => validateToolInput(schema, { count: 2 })).toThrow(ToolInputValidationError);
  });

  it("rejects a wrong declared type", () => {
    expect(() => validateToolInput(schema, { taskId: 5 })).toThrow(ToolInputValidationError);
  });

  it("accepts anything when no schema is declared", () => {
    expect(validateToolInput(undefined, { whatever: true })).toEqual({ whatever: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "tool input validation"`
Expected: FAIL — `validateToolInput` not exported.

- [ ] **Step 3: Implement**

```ts
// packages/ai/src/gateway/input-validation.ts
import type { JsonSchema, ToolInput } from "@jarv1s/module-sdk";

export class ToolInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputValidationError";
  }
}

const JSON_TYPE_OF: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number",
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v)
};

/**
 * Deliberately minimal, dependency-free structural validation (required keys +
 * declared scalar/object/array types). Sufficient for Phase 2 + the fixture; a
 * full JSON-schema validator can replace this when real modules need it.
 */
export function validateToolInput(schema: JsonSchema | undefined, input: unknown): ToolInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolInputValidationError("Tool input must be an object");
  }
  const value = input as ToolInput;
  if (!schema) {
    return value;
  }

  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (!(key in value)) {
      throw new ToolInputValidationError(`Missing required field: ${key}`);
    }
  }

  const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
  for (const [key, declared] of Object.entries(properties)) {
    if (!(key in value) || declared.type === undefined) {
      continue;
    }
    const check = JSON_TYPE_OF[declared.type];
    if (check && !check(value[key])) {
      throw new ToolInputValidationError(`Field ${key} must be a ${declared.type}`);
    }
  }

  return value;
}
```

Export from `packages/ai/src/index.ts`:

```ts
export { validateToolInput, ToolInputValidationError } from "./gateway/input-validation.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts -t "tool input validation"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/input-validation.ts packages/ai/src/index.ts tests/unit/mcp-gateway-units.test.ts
git commit -m "feat(ai): minimal dependency-free tool input validation"
```

---

## Task 6: Gateway types + the fixture module

**Files:**

- Create: `packages/ai/src/gateway/types.ts`
- Create: `tests/integration/fixtures/example-tool-module.ts`
- Test: (covered by Task 7+)

- [ ] **Step 1: Create gateway types**

```ts
// packages/ai/src/gateway/types.ts
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

/** Resolves the modules whose tools are exposed for a user. The enablement SEAM:
 *  Phase 2 returns the compiled-in set; future per-user enablement (#30) plugs in here. */
export type ActiveModulesResolver = (actorUserId: string) => readonly JarvisModuleManifest[];

/** A record the gateway pushes into a chat session's live stream (out-of-band from
 *  the tmux transcript). The real implementation wires to chat-session-manager later. */
export type GatewaySessionRecord =
  | {
      readonly kind: "action_request";
      readonly actionRequestId: string;
      readonly toolName: string;
      readonly summary: string;
    }
  | {
      readonly kind: "action_result";
      readonly actionRequestId: string;
      readonly toolName: string;
      readonly outcome: "executed" | "denied" | "error";
    };

export interface SessionNotifier {
  emit(chatSessionId: string, record: GatewaySessionRecord): void;
}

export type GatewayToolResponse =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly denied: true; readonly reason: string }
  | { readonly ok: false; readonly error: string };
```

Export from `packages/ai/src/index.ts`:

```ts
export type {
  ActiveModulesResolver,
  SessionNotifier,
  GatewaySessionRecord,
  GatewayToolResponse
} from "./gateway/types.js";
```

- [ ] **Step 2: Create the fixture module**

```ts
// tests/integration/fixtures/example-tool-module.ts
import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { JarvisModuleManifest, ToolInput, ToolContext, ToolResult } from "@jarv1s/module-sdk";

/** Records every execute call so tests can assert a handler did/did not run. */
export const exampleToolCalls: { name: string; input: ToolInput; actorUserId: string }[] = [];

async function record(
  name: string,
  scopedDb: DataContextDb,
  input: ToolInput,
  ctx: ToolContext
): Promise<ToolResult> {
  assertDataContextDb(scopedDb); // proves the gateway scoped us under withDataContext
  exampleToolCalls.push({ name, input, actorUserId: ctx.actorUserId });
  return { data: { ok: true, name, echo: input.value ?? null, actor: ctx.actorUserId } };
}

export const exampleToolModule: JarvisModuleManifest = {
  id: "example",
  name: "Example",
  version: "0.0.0",
  publisher: "test",
  lifecycle: "optional",
  compatibility: { jarv1s: "*" },
  assistantTools: [
    {
      name: "example.read",
      description: "Read fixture.",
      permissionId: "example.view",
      risk: "read",
      inputSchema: { type: "object", properties: { value: { type: "string" } } },
      execute: (db, input, ctx) => record("example.read", db as DataContextDb, input, ctx)
    },
    {
      name: "example.write",
      description: "Write fixture.",
      permissionId: "example.update",
      risk: "write",
      inputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "string" } }
      },
      execute: (db, input, ctx) => record("example.write", db as DataContextDb, input, ctx),
      summarize: (input) => `Write the value "${String(input.value)}"`
    },
    {
      name: "example.destroy",
      description: "Destroy fixture.",
      permissionId: "example.delete",
      risk: "destructive",
      inputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "string" } }
      },
      execute: (db, input, ctx) => record("example.destroy", db as DataContextDb, input, ctx)
    },
    {
      name: "example.boom",
      description: "Always throws (error-path fixture).",
      permissionId: "example.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        throw new Error("SECRET internal detail postgres://user:pw@host/db");
      }
    },
    {
      name: "example.declaration-only",
      description: "Declared without a handler (legacy-style).",
      permissionId: "example.view",
      risk: "read"
    }
  ]
};
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (no test asserts behavior yet; Task 7 exercises it).

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/gateway/types.ts packages/ai/src/index.ts tests/integration/fixtures/example-tool-module.ts
git commit -m "feat(ai): gateway types + test fixture tool module"
```

---

## Task 7: Gateway `listTools` + read path

**Files:**

- Create: `packages/ai/src/gateway/gateway.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/mcp-gateway.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import {
  AiRepository,
  AssistantToolGateway,
  SessionTokenRegistry,
  ConfirmationRegistry,
  type GatewaySessionRecord
} from "@jarv1s/ai";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import { exampleToolModule, exampleToolCalls } from "./fixtures/example-tool-module.js";

describe("AssistantToolGateway", () => {
  let appDb: Kysely<JarvisDatabase>;
  let runner: DataContextRunner;
  let repository: AiRepository;
  let tokens: SessionTokenRegistry;
  let confirmations: ConfirmationRegistry;
  let emitted: { chatSessionId: string; record: GatewaySessionRecord }[];
  let gateway: AssistantToolGateway;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase(connectionStrings.appRuntime);
    runner = new DataContextRunner(appDb);
    repository = new AiRepository();
  });

  beforeEach(() => {
    exampleToolCalls.length = 0;
    emitted = [];
    tokens = new SessionTokenRegistry();
    confirmations = new ConfirmationRegistry();
    gateway = new AssistantToolGateway({
      resolveActiveModules: () => [exampleToolModule],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 1000
    });
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("lists only tools that have an execute handler", () => {
    const names = gateway.listTools().map((t) => t.name);
    expect(names).toContain("example.read");
    expect(names).toContain("example.write");
    expect(names).not.toContain("example.declaration-only");
  });

  it("runs a read tool immediately under the caller's RLS scope", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
    const res = await gateway.callTool(token, "example.read", { value: "hi" });

    expect(res).toEqual({
      ok: true,
      data: { ok: true, name: "example.read", echo: "hi", actor: ids.userA }
    });
    expect(exampleToolCalls).toHaveLength(1);
    expect(emitted).toHaveLength(0); // reads never produce a card
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm db:up && pnpm vitest run tests/integration/mcp-gateway.test.ts`
Expected: FAIL — `AssistantToolGateway` not exported.

- [ ] **Step 3: Implement the gateway (read path + listTools; write path added in Task 8)**

```ts
// packages/ai/src/gateway/gateway.ts
import { randomUUID } from "node:crypto";
import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import type {
  JarvisModuleManifest,
  ModuleAssistantToolManifest,
  ToolContext
} from "@jarv1s/module-sdk";
import type { AiAssistantToolDto } from "@jarv1s/shared";
import { AiRepository } from "../repository.js";
import { summarizeAssistantToolInput } from "../assistant-tools.js";
import { resolvePolicy } from "./policy.js";
import { validateToolInput } from "./input-validation.js";
import { SessionTokenRegistry } from "./session-tokens.js";
import { ConfirmationRegistry } from "./confirmation-registry.js";
import type { ActiveModulesResolver, GatewayToolResponse, SessionNotifier } from "./types.js";

export interface AssistantToolGatewayDependencies {
  readonly resolveActiveModules: ActiveModulesResolver;
  readonly repository: AiRepository;
  readonly runner: DataContextRunner;
  readonly tokens: SessionTokenRegistry;
  readonly confirmations: ConfirmationRegistry;
  readonly notifier: SessionNotifier;
  readonly confirmTimeoutMs: number;
}

export class AssistantToolGateway {
  constructor(private readonly deps: AssistantToolGatewayDependencies) {}

  /** Only tools with an execute handler are exposed — declaration-only tools are invisible. */
  listTools(): AiAssistantToolDto[] {
    return this.executableTools(this.allActorIdsUnused()).map((entry) => entry.dto);
  }

  async callTool(token: string, toolName: string, rawInput: unknown): Promise<GatewayToolResponse> {
    const { actorUserId, chatSessionId } = this.deps.tokens.verify(token);
    const requestId = `mcp_${randomUUID()}`;
    const ctx: ToolContext = { actorUserId, requestId, chatSessionId };

    const found = this.executableTools(actorUserId).find((e) => e.tool.name === toolName);
    if (!found) {
      return { ok: false, error: `Tool not available: ${toolName}` };
    }
    const { tool, dto } = found;

    let input;
    try {
      input = validateToolInput(tool.inputSchema, rawInput);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Invalid input" };
    }

    if (resolvePolicy(tool.risk) === "run") {
      return this.runHandler(tool, dto, input, ctx);
    }
    // write/destructive path is implemented in Task 8.
    return { ok: false, error: "confirmation path not yet implemented" };
  }

  protected async runHandler(
    tool: ModuleAssistantToolManifest,
    dto: AiAssistantToolDto,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<GatewayToolResponse> {
    const access: AccessContext = { actorUserId: ctx.actorUserId, requestId: ctx.requestId };
    try {
      const result = await this.deps.runner.withDataContext(access, (scopedDb: DataContextDb) =>
        tool.execute!(scopedDb, input, ctx)
      );
      return { ok: true, data: result.data };
    } catch {
      // never leak internals/secrets from a handler throw
      return { ok: false, error: `Tool ${dto.name} failed` };
    }
  }

  protected executableTools(
    _actorUserId: string
  ): { tool: ModuleAssistantToolManifest; dto: AiAssistantToolDto }[] {
    const modules: readonly JarvisModuleManifest[] = this.deps.resolveActiveModules(_actorUserId);
    const out: { tool: ModuleAssistantToolManifest; dto: AiAssistantToolDto }[] = [];
    for (const module of modules) {
      for (const tool of module.assistantTools ?? []) {
        if (typeof tool.execute !== "function") {
          continue;
        }
        out.push({
          tool,
          dto: {
            moduleId: module.id,
            moduleName: module.name,
            name: tool.name,
            description: tool.description,
            permissionId: tool.permissionId,
            risk: tool.risk,
            inputSchema: tool.inputSchema ?? null,
            outputSchema: tool.outputSchema ?? null
          }
        });
      }
    }
    return out;
  }

  // listTools has no actor; pass a sentinel — resolver ignores it in Phase 2.
  private allActorIdsUnused(): string {
    return "";
  }

  protected summaryFor(
    tool: ModuleAssistantToolManifest,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): string {
    if (typeof tool.summarize === "function") {
      return tool.summarize(input, ctx);
    }
    const generic = summarizeAssistantToolInput(input);
    return `${tool.name} (${generic.inputKeyCount ?? 0} field(s))`;
  }
}
```

Export from `packages/ai/src/index.ts`:

```ts
export { AssistantToolGateway, type AssistantToolGatewayDependencies } from "./gateway/gateway.js";
```

> Note: confirm `summarizeAssistantToolInput` returns an object with `inputKeyCount`; if its shape differs, adapt `summaryFor`. Verify with: `grep -n "summarizeAssistantToolInput" packages/ai/src/assistant-tools.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/mcp-gateway.test.ts -t "lists only tools"`
Run: `pnpm vitest run tests/integration/mcp-gateway.test.ts -t "runs a read tool"`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/gateway.ts packages/ai/src/index.ts tests/integration/mcp-gateway.test.ts
git commit -m "feat(ai): AssistantToolGateway listTools + read execution path"
```

---

## Task 8: Write path — block, then approve and execute

**Files:**

- Modify: `packages/ai/src/gateway/gateway.ts`
- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the describe)

```ts
it("blocks a write until approved, emits a card, then executes", async () => {
  const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
  const call = gateway.callTool(token, "example.write", { value: "hello" });

  // give the gateway a tick to persist + emit + start awaiting
  await new Promise((r) => setTimeout(r, 50));
  expect(emitted).toHaveLength(1);
  const card = emitted[0].record;
  expect(card.kind).toBe("action_request");
  if (card.kind !== "action_request") throw new Error("unreachable");
  expect(card.toolName).toBe("example.write");
  expect(card.summary).toBe('Write the value "hello"'); // module summarize() used
  expect(exampleToolCalls).toHaveLength(0); // not executed yet

  await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");
  const res = await call;

  expect(res).toEqual({
    ok: true,
    data: { ok: true, name: "example.write", echo: "hello", actor: ids.userA }
  });
  expect(exampleToolCalls).toHaveLength(1);
  expect(emitted.map((e) => e.record.kind)).toEqual(["action_request", "action_result"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/mcp-gateway.test.ts -t "blocks a write until approved"`
Expected: FAIL — write path returns "confirmation path not yet implemented".

- [ ] **Step 3: Implement the confirmation path**

In `gateway.ts`, replace the `// write/destructive path` return with a call to `confirmAndRun`, and add the methods:

```ts
return this.confirmAndRun(tool, dto, input, ctx);
```

```ts
  protected async confirmAndRun(
    tool: ModuleAssistantToolManifest,
    dto: AiAssistantToolDto,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<GatewayToolResponse> {
    const access: AccessContext = { actorUserId: ctx.actorUserId, requestId: ctx.requestId };

    const action = await this.deps.runner.withDataContext(access, (scopedDb: DataContextDb) =>
      this.deps.repository.createPendingAssistantAction(scopedDb, {
        toolModuleId: dto.moduleId,
        toolModuleName: dto.moduleName,
        toolName: dto.name,
        permissionId: dto.permissionId,
        risk: tool.risk as "write" | "destructive",
        inputSummary: summarizeAssistantToolInput(input),
        requestId: ctx.requestId
      })
    );

    this.deps.notifier.emit(ctx.chatSessionId, {
      kind: "action_request",
      actionRequestId: action.id,
      toolName: dto.name,
      summary: this.summaryFor(tool, input, ctx)
    });

    const outcome = await this.deps.confirmations.awaitResolution(action.id, this.deps.confirmTimeoutMs);

    if (outcome !== "confirmed") {
      const reason = outcome === "timeout" ? "Timed out awaiting confirmation — still pending in your drawer." : "Denied by user.";
      this.deps.notifier.emit(ctx.chatSessionId, { kind: "action_result", actionRequestId: action.id, toolName: dto.name, outcome: "denied" });
      return { ok: false, denied: true, reason };
    }

    const result = await this.runHandler(tool, dto, input, ctx);
    this.deps.notifier.emit(ctx.chatSessionId, {
      kind: "action_result",
      actionRequestId: action.id,
      toolName: dto.name,
      outcome: result.ok ? "executed" : "error"
    });
    return result;
  }

  /** Called by the Approve/Deny endpoint (and tests). Persists the resolution and unblocks the call. */
  async resolveActionRequest(
    actorUserId: string,
    actionRequestId: string,
    status: "confirmed" | "rejected" | "cancelled"
  ): Promise<void> {
    const access: AccessContext = { actorUserId, requestId: `mcp_${randomUUID()}` };
    await this.deps.runner.withDataContext(access, (scopedDb: DataContextDb) =>
      this.deps.repository.resolveAssistantAction(scopedDb, actionRequestId, { status })
    );
    this.deps.confirmations.resolve(actionRequestId, status);
  }
```

> Note: confirm `resolveAssistantAction`'s signature — the earlier grep shows `resolveAssistantAction(scopedDb, input)`; if the id is part of `ResolveAiAssistantActionInput` rather than a positional arg, pass `{ id: actionRequestId, status }` instead. Verify with: `sed -n '348,369p' packages/ai/src/repository.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/mcp-gateway.test.ts -t "blocks a write until approved"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/gateway.ts tests/integration/mcp-gateway.test.ts
git commit -m "feat(ai): gateway write path — block, card, approve, execute"
```

---

## Task 9: Deny path — handler never runs

**Files:**

- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
it("returns a denied result without calling the handler", async () => {
  const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
  const call = gateway.callTool(token, "example.write", { value: "nope" });

  await new Promise((r) => setTimeout(r, 50));
  const card = emitted[0].record;
  if (card.kind !== "action_request") throw new Error("unreachable");

  await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "rejected");
  const res = await call;

  expect(res).toEqual({ ok: false, denied: true, reason: "Denied by user." });
  expect(exampleToolCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it passes** (logic already implemented in Task 8)

Run: `pnpm vitest run tests/integration/mcp-gateway.test.ts -t "returns a denied result"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mcp-gateway.test.ts
git commit -m "test(ai): gateway deny path leaves handler uncalled"
```

---

## Task 10: Destructive always confirms

**Files:**

- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
it("blocks destructive tools the same as writes (no run-immediately path)", async () => {
  const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
  const call = gateway.callTool(token, "example.destroy", { value: "x" });

  await new Promise((r) => setTimeout(r, 50));
  expect(emitted[0].record.kind).toBe("action_request");
  expect(exampleToolCalls).toHaveLength(0);

  const card = emitted[0].record;
  if (card.kind !== "action_request") throw new Error("unreachable");
  await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");
  await call;
  expect(exampleToolCalls.map((c) => c.name)).toEqual(["example.destroy"]);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/mcp-gateway.test.ts -t "blocks destructive tools"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mcp-gateway.test.ts
git commit -m "test(ai): destructive tools always require confirmation"
```

---

## Task 11: Error safety — no secret leakage

**Files:**

- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
it("returns a safe error and never leaks internal details", async () => {
  const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: "s1" });
  const res = await gateway.callTool(token, "example.boom", {});

  expect(res).toEqual({ ok: false, error: "Tool example.boom failed" });
  expect(JSON.stringify(res)).not.toContain("SECRET");
  expect(JSON.stringify(res)).not.toContain("postgres://");
});
```

- [ ] **Step 2: Run test to verify it passes** (logic from Task 7 `runHandler` catch)

Run: `pnpm vitest run tests/integration/mcp-gateway.test.ts -t "safe error"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mcp-gateway.test.ts
git commit -m "test(ai): gateway returns safe errors, no secret leakage"
```

---

## Task 12: Identity is token-only (RLS isolation)

**Files:**

- Test: `tests/integration/mcp-gateway.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
it("acts only as the token's user; input cannot override identity", async () => {
  const token = tokens.mint({ actorUserId: ids.userB, chatSessionId: "s2" });
  // even if the agent tries to smuggle an actorUserId in input, it is ignored
  const res = await gateway.callTool(token, "example.read", { value: "v", actorUserId: ids.userA });

  expect(res.ok).toBe(true);
  expect(exampleToolCalls[0].actorUserId).toBe(ids.userB);
});

it("rejects an unknown/revoked token", async () => {
  await expect(gateway.callTool("jst_bogus", "example.read", {})).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it passes** (logic from Task 7)

Run: `pnpm vitest run tests/integration/mcp-gateway.test.ts -t "acts only as the token"`
Run: `pnpm vitest run tests/integration/mcp-gateway.test.ts -t "rejects an unknown"`
Expected: PASS both.

> If "rejects an unknown token" should be a structured error rather than a throw, wrap `tokens.verify` in `callTool` and return `{ ok: false, error: "..." }`; update the test accordingly. Default: throw (an invalid token is a system/wiring fault, not an agent-recoverable result).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mcp-gateway.test.ts
git commit -m "test(ai): gateway identity is token-only, RLS-isolated"
```

---

## Task 13: Full gate + module-registry seam wiring

**Files:**

- Modify: `packages/ai/src/index.ts` (ensure all exports present)
- Test: full suite

- [ ] **Step 1: Provide the production active-modules resolver default**

In `packages/ai/src/gateway/types.ts` document that production wires `resolveActiveModules` to `() => getBuiltInModuleManifests()` from `@jarv1s/module-registry` (the enablement seam). No code change in `packages/ai` (avoids an ai→module-registry dependency); the wiring happens where the gateway is constructed (the transport plan). Add this as a comment on `ActiveModulesResolver`.

- [ ] **Step 2: Run the full unit + gateway suites**

Run: `pnpm vitest run tests/unit/mcp-gateway-units.test.ts tests/integration/mcp-gateway.test.ts`
Expected: PASS all.

- [ ] **Step 3: Run the foundation gate**

Run: `pnpm lint && pnpm format:check && pnpm typecheck`
Expected: PASS. (Run `pnpm format` first if format:check flags the new files.)

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/gateway/types.ts packages/ai/src/index.ts
git commit -m "docs(ai): document active-modules resolver as the enablement seam"
```

---

## Self-Review

**Spec coverage:**

- §4.2 identity / per-session token → Tasks 3, 12 ✓
- §4.3 module→tool contract (`execute`/`summarize`, thin handler) → Tasks 1, 6, 7, 8 ✓
- §4.4 enablement seam (`ActiveModulesResolver`) → Tasks 6, 13 ✓
- §5 hardcoded policy + destructive floor → Tasks 2, 10 ✓
- §6 blocking confirm bridge (action row, card via notifier, in-memory promise, `executed`/result record, full input in memory) → Tasks 4, 8, 9 ✓
- §6 timeout → "still pending" → Task 4 (unit) + Task 8 (wired) ✓
- §7 security: gateway-only execution, safe errors/no secret leak → Tasks 11, 12 ✓; _native-tool allowlist lockdown is spike-gated → follow-on plan (documented in header)._
- §8 fixture module + conformance → Task 6 + all integration tests ✓
- _Not covered here by design (follow-on plan): transport binding, CLI launch wiring, real `SessionNotifier`, drawer Approve/Deny UI, real-module connection._ Header states this.

**Placeholder scan:** every code step has complete code; two `> Note:` callouts ask the engineer to confirm a real signature (`summarizeAssistantToolInput`, `resolveAssistantAction`) and adapt — these are real verification steps, not placeholders.

**Type consistency:** `ToolContext` `{actorUserId, requestId, chatSessionId}`, `ToolResult {data}`, `GatewayToolResponse` union, `resolvePolicy → "run"|"confirm"`, `ConfirmationRegistry.awaitResolution/resolve`, `SessionTokenRegistry.mint/verify/revoke`, and `AssistantToolGateway.listTools/callTool/resolveActionRequest` are used identically across tasks.

**Known integration points to verify during execution (flagged inline):** `summarizeAssistantToolInput` return shape; `AiRepository.resolveAssistantAction` argument shape (positional id vs id-in-input). Both have a `> Note:` with the exact grep/sed to confirm.
