# Structured-AI Seam (#915 Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provider-agnostic structured AI output for module workers: a service-aware model resolver with an admin `module.*` binding namespace, plus `generateStructured` (schema-validated, repair-looped, abort-aware, typed errors) in `packages/ai`.

**Architecture:** Module structured work always resolves capability `"json"`; new `module.<id>` / `module.worker` binding keys are admin routing knobs stored in the existing `ai.service_bindings` instance-settings blob and read by a new `resolveModelForService` (precedence: admin pin → module-specific binding → generic worker binding → automatic). `generateStructured` orchestrates: resolve → decrypt credential → per-provider structured request (anthropic forced tool call / openai `json_schema` / google `responseSchema`) → ajv validation with a bounded repair loop. Wire schemas move to a new `packages/shared/src/ai-service-binding-api.ts` (ai-api.ts is at 991/1000 lines of the size gate).

**Tech Stack:** TypeScript, Fastify JSON schemas (fast-json-stringify), Kysely/Postgres via `DataContextDb`, ajv ^8, vitest.

**Spec:** `~/Jarv1s/docs/superpowers/specs/2026-07-09-external-worker-capabilities-design.md` (D6 + "Build slices" §3). This plan covers the `packages/ai` seam ONLY. The `ctx.ai` module RPC exposure, per-invocation caps, and the credential composition guard are **blocked on the #818 Slice 3 child runtime (issue #919)** and get a follow-on plan.

## Global Constraints

- **Provider-agnostic AI:** no feature hardcodes a provider or model; the per-provider switch in the adapter is transport, not policy. Module callers NEVER receive a model or provider identity (spec D6).
- **Secrets never escape:** API keys never appear in errors, logs, thrown messages, or results. Adapter failures carry HTTP status only.
- **DataContextDb only:** repositories accept the branded `DataContextDb` handle; every new repository method starts with `assertDataContextDb(scopedDb)`.
- **Usage observability is logger-only:** counts + ids via an injected structured logger; never prompt/output text. Durable quotas are explicitly deferred (spec non-goal).
- **No migrations in this slice.** The spec's single new migration belongs to slice 2.
- **File-size gate:** all source ≤ 1000 lines (`pnpm check:file-size`). `packages/ai/src/repository.ts` is exempt (listed in `scripts/check-file-size.ts`); `packages/shared/src/ai-api.ts` is NOT (991/1000) — Task 2 moves schemas out rather than adding to it.
- **Shared tree discipline:** never `git add -A` / `git add .` — stage the explicit paths listed in each commit step.
- **Comment style:** generous why-comments citing `#915 D6` and the constraint being honored (project norm).
- **Full local gate before finishing:** `pnpm verify:foundation` (includes lint, format:check, check:file-size, check:package-deps, typecheck, unit + integration tests).
- Work on branch `feat/915-slice3-structured-ai` cut from `main` AFTER the #915 spec PR merges.

## File Map

| File                                                         | Role                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `packages/shared/src/ai-types.ts` (modify)                   | `ModuleServiceKey`, `AiServiceKey`, key pattern + guard, `ModuleServiceBindingMap` |
| `packages/shared/src/ai-service-binding-api.ts` (create)     | ALL service-binding wire schemas (moved from ai-api.ts, widened for module keys)   |
| `packages/shared/src/ai-api.ts` (modify)                     | remove moved schemas                                                               |
| `packages/shared/src/index.ts` (modify)                      | barrel export for the new schema file                                              |
| `packages/ai/src/service-binding-map.ts` (modify)            | `parseModuleServiceBindingMap`                                                     |
| `packages/ai/src/repository.ts` (modify, size-exempt)        | module binding CRUD + `resolveModelForService`                                     |
| `packages/ai/src/capability-route-routes.ts` (modify)        | widened PUT/GET, new DELETE, installed-module validation                           |
| `packages/ai/src/routes.ts` (modify)                         | `listInstalledModuleIds` dependency                                                |
| `apps/api/src/server.ts` (modify)                            | wire `listInstalledModuleIds`                                                      |
| `packages/ai/src/structured/schema-bounds.ts` (create)       | resource-bound walker + constants                                                  |
| `packages/ai/src/structured/generate-structured.ts` (create) | orchestrator (resolve → adapter → validate → repair)                               |
| `packages/ai/src/adapters/http-api-structured.ts` (create)   | per-provider request builder / result extractor                                    |
| `packages/ai/src/adapters/http-api.ts` (modify)              | `generateStructured` method with AbortSignal threading                             |
| `packages/ai/src/index.ts` (modify)                          | barrel exports                                                                     |
| `packages/ai/package.json` (modify)                          | add `ajv` dependency                                                               |
| `tests/unit/ai-module-service-bindings.test.ts` (create)     | key guard + parser tests                                                           |
| `tests/unit/ai-structured-schema-bounds.test.ts` (create)    | bounds walker tests                                                                |
| `tests/unit/ai-http-api-structured.test.ts` (create)         | adapter request/extract tests                                                      |
| `tests/unit/ai-generate-structured.test.ts` (create)         | orchestrator tests (fake repo/adapter)                                             |
| `tests/integration/ai-structured.test.ts` (create)           | bindings + resolver + routes + e2e against real DB                                 |
| `package.json` (modify)                                      | append the new file to the `test:ai` script                                        |

---

### Task 1: Module service key types + blob parser

**Files:**

- Modify: `packages/shared/src/ai-types.ts` (append after the `AiServiceBinding` type)
- Modify: `packages/ai/src/service-binding-map.ts` (append)
- Test: `tests/unit/ai-module-service-bindings.test.ts`

**Interfaces:**

- Consumes: `AiServiceBinding`, `AiModelCapability` (existing, `packages/shared/src/ai-types.ts`); `parseServiceBinding` (existing, `packages/ai/src/service-binding-map.ts:19`).
- Produces: `type ModuleServiceKey = \`module.${string}\``; `type AiServiceKey = AiModelCapability | ModuleServiceKey`; `const MODULE_WORKER_SERVICE_KEY = "module.worker"`; `const MODULE_SERVICE_KEY_PATTERN: string`; `function isModuleServiceKey(value: string): value is ModuleServiceKey`; `type ModuleServiceBindingMap = Partial<Record<ModuleServiceKey, AiServiceBinding>>`; `function parseModuleServiceBindingMap(value: unknown): ModuleServiceBindingMap`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai-module-service-bindings.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { MODULE_WORKER_SERVICE_KEY, isModuleServiceKey } from "@jarv1s/shared";
import { parseModuleServiceBindingMap } from "../../packages/ai/src/service-binding-map.js";

describe("isModuleServiceKey", () => {
  it("accepts module.worker and module.<id> keys", () => {
    expect(isModuleServiceKey(MODULE_WORKER_SERVICE_KEY)).toBe(true);
    expect(isModuleServiceKey("module.job-search")).toBe(true);
    expect(isModuleServiceKey("module.notes_2.beta")).toBe(true);
  });

  it("rejects capabilities, malformed ids, and near-misses", () => {
    expect(isModuleServiceKey("chat")).toBe(false);
    expect(isModuleServiceKey("json")).toBe(false);
    expect(isModuleServiceKey("module.")).toBe(false);
    expect(isModuleServiceKey("module.UPPER")).toBe(false);
    expect(isModuleServiceKey("module.-dash-first")).toBe(false);
    expect(isModuleServiceKey(`module.a${"b".repeat(64)}`)).toBe(false); // 65 chars after prefix
    expect(isModuleServiceKey("modules.worker")).toBe(false);
    expect(isModuleServiceKey("MODULE.worker")).toBe(false);
  });
});

describe("parseModuleServiceBindingMap", () => {
  it("keeps validated module.* keys and drops capabilities, junk keys, and malformed bindings", () => {
    const parsed = parseModuleServiceBindingMap({
      chat: { kind: "mode", tier: "reasoning" },
      "module.worker": { kind: "mode", tier: "economy" },
      "module.job-search": { kind: "model", modelId: "11111111-1111-4111-8111-111111111111" },
      "module.bad-tier": { kind: "mode", tier: "warp" },
      "module.bad-shape": "nope",
      "not-a-key": { kind: "mode", tier: "economy" }
    });

    expect(parsed).toEqual({
      "module.worker": { kind: "mode", tier: "economy" },
      "module.job-search": { kind: "model", modelId: "11111111-1111-4111-8111-111111111111" }
    });
  });

  it("returns {} for non-object blobs", () => {
    expect(parseModuleServiceBindingMap(null)).toEqual({});
    expect(parseModuleServiceBindingMap(undefined)).toEqual({});
    expect(parseModuleServiceBindingMap([{ chat: {} }])).toEqual({});
    expect(parseModuleServiceBindingMap("garbage")).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/ai-module-service-bindings.test.ts`
Expected: FAIL — `@jarv1s/shared` has no export `isModuleServiceKey`.

- [ ] **Step 3: Implement the types and the parser**

Append to `packages/shared/src/ai-types.ts`, directly after the `AiServiceBinding` type definition:

```typescript
// ---------------------------------------------------------------------------
// #915 D6: module AI service keys
// ---------------------------------------------------------------------------

// A module service key is a BINDING key (an admin routing knob), not a capability. Structured
// output for modules always resolves capability "json"; these keys only steer WHICH model serves
// it. "module.worker" is the generic default for every module without a module-specific binding;
// "module.<moduleId>" pins a single module.
export type ModuleServiceKey = `module.${string}`;

// Everything the service-binding routes can address: a user-facing capability or a module key.
export type AiServiceKey = AiModelCapability | ModuleServiceKey;

export const MODULE_WORKER_SERVICE_KEY = "module.worker" as const;

// "module." + id: lowercase alnum start, then alnum/underscore/dot/dash, ≤64 chars after the
// prefix. Kept as a plain string so JSON-schema `pattern` fields can embed it verbatim
// (ai-service-binding-api.ts must stay in sync — see the comment there).
export const MODULE_SERVICE_KEY_PATTERN = "^module\\.[a-z0-9][a-z0-9_.-]{0,63}$";
const moduleServiceKeyRegex = new RegExp(MODULE_SERVICE_KEY_PATTERN);

export function isModuleServiceKey(value: string): value is ModuleServiceKey {
  return moduleServiceKeyRegex.test(value);
}

export type ModuleServiceBindingMap = Partial<Record<ModuleServiceKey, AiServiceBinding>>;
```

Append to `packages/ai/src/service-binding-map.ts` (and extend its `@jarv1s/shared` import with `isModuleServiceKey` and `type ModuleServiceBindingMap`):

```typescript
// #915 D6: module.* keys live in the SAME `ai.service_bindings` blob but parseServiceBindingMap
// above intentionally drops them (its capability filter is load-bearing for the user-facing map).
// This parallel parser keeps exactly the validated `module.*` keys instead — same tolerance rules:
// malformed entries are dropped, never thrown.
export function parseModuleServiceBindingMap(value: unknown): ModuleServiceBindingMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const bindings: ModuleServiceBindingMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isModuleServiceKey(key)) continue;
    const binding = parseServiceBinding(raw);
    if (binding) bindings[key] = binding;
  }
  return bindings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/ai-module-service-bindings.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add packages/shared/src/ai-types.ts packages/ai/src/service-binding-map.ts tests/unit/ai-module-service-bindings.test.ts
git commit -m "feat(ai): module service key types + blob parser (#915 slice 3)

Adds the module.* AI service-binding namespace: admins will be able to route a
module's structured-AI work to a tier or model without modules ever choosing
providers themselves."
```

---

### Task 2: Move service-binding wire schemas to `ai-service-binding-api.ts` (widened for module keys)

`packages/shared/src/ai-api.ts` sits at 991/1000 lines of the size gate and is NOT exempt. Move the service-binding schemas to a new file (same precedent as the ai-voice-api.ts split, noted at `ai-api.ts:552`), widening them for module keys in the process.

**fast-json-stringify TRAP (why the widening is mandatory):** Fastify response schemas with `additionalProperties: false` SILENTLY DROP any emitted field not declared in the schema, and `enum: ["chat"]` params reject module keys with a 400. Without `patternProperties` the GET response would strip every `module.*` binding (this exact bug class shipped twice: #859, #885). Route behavior must be asserted via `server.inject`, never by calling the handler's service directly — Task 5 does this.

**Files:**

- Create: `packages/shared/src/ai-service-binding-api.ts`
- Modify: `packages/shared/src/ai-api.ts` (remove moved exports)
- Modify: `packages/shared/src/index.ts` (add barrel line)

**Interfaces:**

- Consumes: `aiModelTierSchema` (exported at `ai-api.ts:30`), `errorResponseSchema` (`packages/shared/src/schema-fragments.ts`).
- Produces (all re-exported through the `@jarv1s/shared` barrel, so existing importers keep working): `aiServiceBindingSchema`, `aiServiceParamsSchema`, `aiServiceBindingMapSchema`, `listAiServiceBindingsResponseSchema`, `putAiServiceBindingRequestSchema`, `putAiServiceBindingResponseSchema`, `deleteAiServiceBindingResponseSchema`, `listAiServiceBindingsRouteSchema`, `putAiServiceBindingRouteSchema`, `deleteAiServiceBindingRouteSchema`.

- [ ] **Step 1: Cut the existing schemas out of ai-api.ts**

Remove these exports from `packages/shared/src/ai-api.ts` (line anchors as of spec commit `6019f94f` — locate by name if drifted): `aiServiceBindingSchema` (~:166), `aiServiceParamsSchema` (~:194), `aiServiceBindingMapSchema` (~:203), `listAiServiceBindingsResponseSchema` (~:532), `putAiServiceBindingRequestSchema` / `putAiServiceBindingResponseSchema` (~:555–572), `listAiServiceBindingsRouteSchema` (~:813), `putAiServiceBindingRouteSchema` (~:834). Keep everything else (in particular `aiModelTierSchema` and `aiModelCapabilitySchema` — still used by other schemas). After the cut, `pnpm lint` will flag any import in ai-api.ts that became unused — remove those too.

- [ ] **Step 2: Create the new schema file**

Create `packages/shared/src/ai-service-binding-api.ts`. Paste the cut schemas, then apply the widenings marked `#915` below. Final content (structure of the moved blocks is verbatim from ai-api.ts; only the marked fields change):

```typescript
import { aiModelTierSchema } from "./ai-api.js";
import { errorResponseSchema } from "./schema-fragments.js";

// #915 D6: the per-service AI binding wire schemas, split out of ai-api.ts to keep that file
// under the 1000-line source cap (same precedent as ai-voice-api.ts). Widened for module service
// keys: "chat" stays the only user-facing service; "module.worker" / "module.<moduleId>" are
// admin routing knobs for structured module work (always capability "json").

// #870 Slice 1: a binding is a discriminated union — a tier "mode" OR one specific model.
// (Moved unchanged from ai-api.ts.)
export const aiServiceBindingSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "tier"],
      properties: {
        kind: { type: "string", enum: ["mode"] },
        tier: aiModelTierSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "modelId"],
      properties: {
        kind: { type: "string", enum: ["model"] },
        modelId: { type: "string", format: "uuid" }
      }
    }
  ]
} as const;

export const aiServiceParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service"],
  properties: {
    // #915: was `enum: ["chat"]` — widened so module keys reach the handler (which does the real
    // validation). Keep the module part in sync with MODULE_SERVICE_KEY_PATTERN (ai-types.ts).
    service: { type: "string", pattern: "^(chat|module\\.[a-z0-9][a-z0-9_.-]{0,63})$" }
  }
} as const;

export const aiServiceBindingMapSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    chat: aiServiceBindingSchema
  },
  // #915: module keys are dynamic, so they MUST be declared via patternProperties —
  // additionalProperties:false would silently strip them from responses (fjs trap, #859/#885).
  patternProperties: {
    "^module\\.": aiServiceBindingSchema
  }
} as const;

export const listAiServiceBindingsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bindings"],
  properties: {
    bindings: aiServiceBindingMapSchema
  }
} as const;

export const putAiServiceBindingRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["binding"],
  properties: {
    binding: aiServiceBindingSchema
  }
} as const;

export const putAiServiceBindingResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "binding"],
  properties: {
    // #915: was the capability enum — plain string so module.* echoes back instead of vanishing.
    service: { type: "string" },
    binding: aiServiceBindingSchema
  }
} as const;

// #915 D6: unbind response — the service returns to automatic routing.
export const deleteAiServiceBindingResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service"],
  properties: {
    service: { type: "string" }
  }
} as const;

export const listAiServiceBindingsRouteSchema = {
  response: {
    200: listAiServiceBindingsResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const putAiServiceBindingRouteSchema = {
  params: aiServiceParamsSchema,
  body: putAiServiceBindingRequestSchema,
  response: {
    200: putAiServiceBindingResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

// #915 D6: DELETE /api/ai/services/:service/binding — module keys only (chat has no unbind).
export const deleteAiServiceBindingRouteSchema = {
  params: aiServiceParamsSchema,
  response: {
    200: deleteAiServiceBindingResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;
```

IMPORTANT: if the cut blocks from ai-api.ts differ textually from the above (e.g. an extra comment or a `description` field), keep the ORIGINAL text and apply only the `#915`-marked changes: (a) `aiServiceParamsSchema.properties.service` enum → pattern, (b) `patternProperties` added to `aiServiceBindingMapSchema`, (c) `putAiServiceBindingResponseSchema.properties.service` → `{ type: "string" }`, (d) the two new `delete*` schemas.

Add to `packages/shared/src/index.ts`, next to the existing `export * from "./ai-api.js";` line:

```typescript
export * from "./ai-service-binding-api.js";
```

- [ ] **Step 3: Verify nothing broke**

Run: `pnpm typecheck && pnpm check:file-size && pnpm lint`
Expected: all exit 0 (ai-api.ts drops to ~900 lines; every old import site resolves via the barrel).

Run: `pnpm test:ai`
Expected: PASS — the existing chat-binding suite (`tests/integration/ai-capability-routes.test.ts`) still passes: the widened pattern still admits `"chat"`, and chat responses are unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/ai-service-binding-api.ts packages/shared/src/ai-api.ts packages/shared/src/index.ts
git commit -m "refactor(shared): split service-binding schemas out of ai-api.ts, widen for module keys (#915 slice 3)

No user-visible change yet: same chat-binding API, schemas relocated to stay
under the source-size gate and extended so upcoming module bindings aren't
silently stripped from responses."
```

---

### Task 3: Repository module-binding CRUD + integration test harness

**Files:**

- Modify: `packages/ai/src/repository.ts` (widen `setServiceBinding` gate ~:697–706; add three methods after it; extend imports)
- Create: `tests/integration/ai-structured.test.ts`
- Modify: `package.json` (root — `test:ai` script, line ~42)

**Interfaces:**

- Consumes: `parseModuleServiceBindingMap` (Task 1); existing `AI_SERVICE_BINDINGS_SETTING_KEY`, `assertDataContextDb`, `sql` (already imported in repository.ts), `USER_FACING_SERVICES` (repository.ts:261).
- Produces: `setServiceBinding(scopedDb, service: AiServiceKey, binding, actorUserId)` (widened); `listModuleServiceBindings(scopedDb): Promise<ModuleServiceBindingMap>`; `getModuleServiceBinding(scopedDb, service: ModuleServiceKey): Promise<AiServiceBinding | null>`; `deleteModuleServiceBinding(scopedDb, service: ModuleServiceKey, actorUserId: string): Promise<void>`.

- [ ] **Step 1: Create the integration test file with harness + failing CRUD tests**

Append ` tests/integration/ai-structured.test.ts` to the root `package.json` `test:ai` script, so it reads:

```json
"test:ai": "tsx scripts/test-integration.ts tests/integration/ai.test.ts tests/integration/ai-capability-routes.test.ts tests/integration/ai-structured.test.ts"
```

Create `tests/integration/ai-structured.test.ts`. The harness block mirrors `tests/integration/ai-capability-routes.test.ts:1-130` — if any helper detail below has drifted (especially the `JARVIS_AI_SECRET_KEY` value format), copy that file's current text verbatim:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { AiRepository } from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";

import { createApiServer } from "../../apps/api/src/server.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

// #915 slice 3: module service bindings, service-aware resolution, and generateStructured.
// Suites are STATEFUL and order-dependent (shared instance_settings blob + seeded models) —
// every test restores the bindings it writes.

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;
let repository: AiRepository;
let server: Awaited<ReturnType<typeof createApiServer>>;
let previousSecretKey: string | undefined;
let realFetch: typeof globalThis.fetch;

let providerId: string;
let modelEconomyJsonId: string;
let modelReasoningJsonId: string;
let modelChatJsonId: string;

function adminContext(): AccessContext {
  return { actorUserId: ids.adminUser, requestId: "request:ai-structured-test" };
}

async function seedProvider(displayName: string): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/ai/providers",
    headers: { authorization: `Bearer ${ids.sessionAdmin}` },
    payload: {
      providerKind: "anthropic",
      displayName,
      credentialPayload: { apiKey: "structured-test-secret" }
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json().provider.id as string;
}

async function seedModel(
  providerConfigId: string,
  providerModelId: string,
  capabilities: readonly string[],
  tier: string
): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/ai/models",
    headers: { authorization: `Bearer ${ids.sessionAdmin}` },
    payload: { providerConfigId, providerModelId, displayName: providerModelId, capabilities, tier }
  });
  expect(response.statusCode).toBe(201);
  return response.json().model.id as string;
}

beforeAll(async () => {
  // COPY the JARVIS_AI_SECRET_KEY setup value verbatim from ai-capability-routes.test.ts —
  // the cipher requires its exact format.
  previousSecretKey = process.env.JARVIS_AI_SECRET_KEY;
  process.env.JARVIS_AI_SECRET_KEY = "<same value as ai-capability-routes.test.ts>";

  // No test may hit the network: real fetch is replaced with a thrower for the whole file.
  realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network disabled in ai-structured tests");
  }) as typeof globalThis.fetch;

  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  dataContext = new DataContextRunner(appDb);
  repository = new AiRepository();
  server = await createApiServer({ appDb, logger: false });
  await server.ready();

  providerId = await seedProvider("Structured Test Provider");
  const defaultResponse = await server.inject({
    method: "PUT",
    url: `/api/ai/providers/${providerId}/default`,
    headers: { authorization: `Bearer ${ids.sessionAdmin}` }
  });
  expect(defaultResponse.statusCode).toBe(200);

  // Distinct tiers keep automatic selection deterministic across every suite in this file.
  modelEconomyJsonId = await seedModel(providerId, "json-economy", ["json"], "economy");
  modelReasoningJsonId = await seedModel(providerId, "json-reasoning", ["json"], "reasoning");
  modelChatJsonId = await seedModel(providerId, "chat-json", ["chat", "json"], "interactive");
});

afterAll(async () => {
  await Promise.allSettled([server?.close(), appDb?.destroy()]);
  globalThis.fetch = realFetch;
  if (previousSecretKey === undefined) delete process.env.JARVIS_AI_SECRET_KEY;
  else process.env.JARVIS_AI_SECRET_KEY = previousSecretKey;
});

describe("module service binding CRUD (repository)", () => {
  it("stores, lists, gets, and deletes module bindings without touching the chat binding", async () => {
    await dataContext.withDataContext(adminContext(), async (scopedDb) => {
      // chat shares the blob — set it first to prove the two read paths never leak into each other.
      await repository.setServiceBinding(
        scopedDb,
        "chat",
        { kind: "mode", tier: "interactive" },
        ids.adminUser
      );
      await repository.setServiceBinding(
        scopedDb,
        "module.worker",
        { kind: "mode", tier: "economy" },
        ids.adminUser
      );
      await repository.setServiceBinding(
        scopedDb,
        "module.job-search",
        { kind: "model", modelId: modelEconomyJsonId },
        ids.adminUser
      );

      expect(await repository.listModuleServiceBindings(scopedDb)).toEqual({
        "module.worker": { kind: "mode", tier: "economy" },
        "module.job-search": { kind: "model", modelId: modelEconomyJsonId }
      });
      expect(await repository.getModuleServiceBinding(scopedDb, "module.worker")).toEqual({
        kind: "mode",
        tier: "economy"
      });
      // user-facing read path must NOT see module keys...
      expect(await repository.getServiceBinding(scopedDb, "chat")).toEqual({
        kind: "mode",
        tier: "interactive"
      });

      await repository.deleteModuleServiceBinding(scopedDb, "module.job-search", ids.adminUser);
      expect(await repository.getModuleServiceBinding(scopedDb, "module.job-search")).toBeNull();
      // ...and delete must not disturb the chat key in the shared blob.
      expect(await repository.getServiceBinding(scopedDb, "chat")).toEqual({
        kind: "mode",
        tier: "interactive"
      });

      // restore for later suites
      await repository.deleteModuleServiceBinding(scopedDb, "module.worker", ids.adminUser);
    });
  });

  it("still rejects non-bindable worker capabilities", async () => {
    await dataContext.withDataContext(adminContext(), async (scopedDb) => {
      await expect(
        repository.setServiceBinding(
          scopedDb,
          "json" as never,
          { kind: "mode", tier: "economy" },
          ids.adminUser
        )
      ).rejects.toThrow(/not bindable/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:ai`
Expected: FAIL — `setServiceBinding` throws `Service "module.worker" is not bindable (worker capabilities stay automatic).` and `listModuleServiceBindings` is not a function. (`ai.test.ts` / `ai-capability-routes.test.ts` still PASS.)

- [ ] **Step 3: Implement in repository.ts**

Extend the `@jarv1s/shared` import in `packages/ai/src/repository.ts` with `isModuleServiceKey`, `type AiServiceKey`, `type ModuleServiceKey`, `type ModuleServiceBindingMap`; extend the `./service-binding-map.js` import with `parseModuleServiceBindingMap`.

Widen the `setServiceBinding` gate (currently repository.ts:697–706) — change the `service` parameter type and the guard; everything below the guard is unchanged:

```typescript
  async setServiceBinding(
    scopedDb: DataContextDb,
    service: AiServiceKey,
    binding: AiServiceBinding,
    actorUserId: string
  ): Promise<AiServiceBinding> {
    assertDataContextDb(scopedDb);
    // #915 D6: module.* keys are admin routing knobs for module structured work and share this
    // blob; every OTHER worker capability stays automatic-only (the #874 HIGH-2 decision).
    if (!USER_FACING_SERVICES.has(service as AiModelCapability) && !isModuleServiceKey(service)) {
      throw new Error(`Service "${service}" is not bindable (worker capabilities stay automatic).`);
    }
```

Add directly after `setServiceBinding`:

```typescript
  /**
   * #915 D6: module.* bindings live in the SAME ai.service_bindings blob as user-facing services
   * but are read through the module-only parser, so neither map can ever leak the other's keys
   * (parseServiceBindingMap's capability filter is load-bearing for the settings UI).
   */
  async listModuleServiceBindings(scopedDb: DataContextDb): Promise<ModuleServiceBindingMap> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", AI_SERVICE_BINDINGS_SETTING_KEY)
      .executeTakeFirst();
    return parseModuleServiceBindingMap(row?.value);
  }

  async getModuleServiceBinding(
    scopedDb: DataContextDb,
    service: ModuleServiceKey
  ): Promise<AiServiceBinding | null> {
    const bindings = await this.listModuleServiceBindings(scopedDb);
    return bindings[service] ?? null;
  }

  /**
   * #915 D6: unbind a module service (returns to automatic routing). Single-statement JSONB key
   * removal, mirroring the merge-upsert above so a concurrent write to a DIFFERENT service key
   * can't be clobbered (no read-modify-write).
   */
  async deleteModuleServiceBinding(
    scopedDb: DataContextDb,
    service: ModuleServiceKey,
    actorUserId: string
  ): Promise<void> {
    assertDataContextDb(scopedDb);
    await scopedDb.db
      .updateTable("app.instance_settings")
      .set({
        value: sql`instance_settings.value - ${service}`,
        updated_by_user_id: actorUserId,
        updated_at: new Date()
      })
      .where("key", "=", AI_SERVICE_BINDINGS_SETTING_KEY)
      .execute();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:ai`
Expected: PASS (all three files). Then `pnpm typecheck` — exit 0 (callers passing `AiModelCapability` still typecheck against the widened `AiServiceKey`).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/repository.ts tests/integration/ai-structured.test.ts package.json
git commit -m "feat(ai): store/read/delete module.* service bindings (#915 slice 3)

Admins can now persist per-module AI routing choices alongside the existing
chat binding; the two maps are stored together but can never leak into each
other's read paths."
```

---

### Task 4: `resolveModelForService` (precedence: pin → module binding → worker binding → automatic)

**Files:**

- Modify: `packages/ai/src/repository.ts` (add method after `resolveModelForCapability`, ~:1095)
- Test: `tests/integration/ai-structured.test.ts` (append a describe block)

**Interfaces:**

- Consumes: `listModuleServiceBindings` (Task 3); existing private `selectAutomaticModelForCapability(scopedDb, capability, tier)` (repository.ts:1170), `safeModelQuery`, `logNeedsConfig(scopedDb, capability)` (:1150 — takes exactly TWO args), `getAdminPinnedModelId` / `getAdminPinnedProviderId`, `resolveModelForCapability(scopedDb, capability, tier)` (positional tier), `MODULE_WORKER_SERVICE_KEY` (Task 1).
- Produces: `resolveModelForService(scopedDb, service: ModuleServiceKey, options: { capability: AiModelCapability; tierHint?: AiModelTier }): Promise<AiCapabilityRouteResolution>` — Task 8's orchestrator calls this with `capability: "json"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/ai-structured.test.ts`:

```typescript
describe("resolveModelForService precedence", () => {
  const resolve = (service: `module.${string}`) =>
    dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.resolveModelForService(scopedDb, service, { capability: "json" })
    );

  it("unbound service resolves exactly like an automatic worker capability", async () => {
    const route = await resolve("module.job-search");
    expect(route.reason).toBe("matched-active-model");
    expect(route.model?.id).toBe(modelEconomyJsonId);
  });

  it("module.worker mode binding overrides the tier for every module", async () => {
    await dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.setServiceBinding(
        scopedDb,
        "module.worker",
        { kind: "mode", tier: "reasoning" },
        ids.adminUser
      )
    );
    const route = await resolve("module.job-search");
    expect(route.reason).toBe("matched-active-model");
    expect(route.model?.id).toBe(modelReasoningJsonId);
  });

  it("a module-specific model binding beats module.worker; other modules keep riding it", async () => {
    await dataContext.withDataContext(adminContext(), (scopedDb) =>
      repository.setServiceBinding(
        scopedDb,
        "module.job-search",
        { kind: "model", modelId: modelChatJsonId },
        ids.adminUser
      )
    );
    const specific = await resolve("module.job-search");
    expect(specific.reason).toBe("manual-route");
    expect(specific.model?.id).toBe(modelChatJsonId);

    const other = await resolve("module.other");
    expect(other.model?.id).toBe(modelReasoningJsonId);
  });

  it("a stale model binding is needs-config — never a silent fallthrough", async () => {
    const disable = await server.inject({
      method: "PATCH",
      url: `/api/ai/models/${modelChatJsonId}`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { status: "disabled" }
    });
    expect(disable.statusCode).toBe(200);

    const route = await resolve("module.job-search");
    expect(route.model).toBeNull();
    expect(route.reason).toBe("needs-config");

    const enable = await server.inject({
      method: "PATCH",
      url: `/api/ai/models/${modelChatJsonId}`,
      headers: { authorization: `Bearer ${ids.sessionAdmin}` },
      payload: { status: "active" }
    });
    expect(enable.statusCode).toBe(200);
  });

  it("an admin model pin beats every module binding; cleanup restores automatic", async () => {
    await dataContext.withDataContext(adminContext(), async (scopedDb) => {
      // Bind the module to the ECONOMY model so a pin hit is distinguishable from the binding.
      await repository.setServiceBinding(
        scopedDb,
        "module.job-search",
        { kind: "model", modelId: modelEconomyJsonId },
        ids.adminUser
      );
      await repository.setAdminPinnedModel(scopedDb, modelChatJsonId);
    });

    const pinned = await resolve("module.job-search");
    expect(pinned.model?.id).toBe(modelChatJsonId);

    await dataContext.withDataContext(adminContext(), async (scopedDb) => {
      await repository.setAdminPinnedModel(scopedDb, null);
      await repository.deleteModuleServiceBinding(scopedDb, "module.job-search", ids.adminUser);
      await repository.deleteModuleServiceBinding(scopedDb, "module.worker", ids.adminUser);
    });
    const restored = await resolve("module.job-search");
    expect(restored.model?.id).toBe(modelEconomyJsonId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:ai`
Expected: FAIL — `repository.resolveModelForService is not a function`.

- [ ] **Step 3: Implement the resolver**

Add to `packages/ai/src/repository.ts`, directly after `resolveModelForCapability`:

```typescript
  /**
   * #915 D6: service-aware resolution for module structured work. `service` steers WHICH model
   * serves the request; `options.capability` (always "json" for structured output today) is what
   * the model must actually support. Precedence:
   *   (1) admin pin — pins are the loudest admin intent, so they beat module bindings; delegate
   *       wholesale to resolveModelForCapability (which owns pin semantics) ONLY when a pin exists;
   *   (2) module-specific `module.<id>` binding;
   *   (3) generic `module.worker` binding;
   *   (4) unbound → identical to an unbound worker capability (cross-provider automatic).
   * A stale/disabled model binding is needs-config (the admin said THIS model) — never fall
   * through to a different model than the one they chose.
   */
  async resolveModelForService(
    scopedDb: DataContextDb,
    service: ModuleServiceKey,
    options: { capability: AiModelCapability; tierHint?: AiModelTier }
  ): Promise<AiCapabilityRouteResolution> {
    assertDataContextDb(scopedDb);
    const { capability, tierHint = "economy" } = options;

    const [pinnedModelId, pinnedProviderId] = await Promise.all([
      this.getAdminPinnedModelId(scopedDb),
      this.getAdminPinnedProviderId(scopedDb)
    ]);
    if (pinnedModelId !== null || pinnedProviderId !== null) {
      return this.resolveModelForCapability(scopedDb, capability, tierHint);
    }

    const bindings = await this.listModuleServiceBindings(scopedDb);
    const keys: ModuleServiceKey[] =
      service === MODULE_WORKER_SERVICE_KEY ? [service] : [service, MODULE_WORKER_SERVICE_KEY];

    for (const key of keys) {
      const binding = bindings[key];
      if (!binding) continue;

      if (binding.kind === "model") {
        const model = await this.safeModelQuery(scopedDb)
          .where("models.id", "=", binding.modelId)
          .where("models.status", "=", "active")
          .where("providers.status", "=", "active")
          .where("providers.purpose", "=", "assistant")
          .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
          .executeTakeFirst();
        if (model) return { model, reason: "manual-route" };
        await this.logNeedsConfig(scopedDb, capability);
        return { model: null, reason: "needs-config" };
      }

      const model = await this.selectAutomaticModelForCapability(scopedDb, capability, binding.tier);
      if (model) return { model, reason: "matched-active-model" };
      await this.logNeedsConfig(scopedDb, capability);
      return { model: null, reason: "needs-config" };
    }

    return this.resolveModelForCapability(scopedDb, capability, tierHint);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:ai`
Expected: PASS. (If the pin test fails on the reason string, assert only `model?.id` — pin-branch reasons belong to `resolveModelForCapability` and are not this task's contract.)

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/repository.ts tests/integration/ai-structured.test.ts
git commit -m "feat(ai): service-aware model resolution for module AI work (#915 slice 3)

Module AI requests now honor the admin's routing choices in a strict order —
instance pin, per-module binding, generic worker binding, then automatic —
and surface needs-config instead of silently substituting a model."
```

---

### Task 5: Binding routes — module keys, DELETE, installed-module validation

**Files:**

- Modify: `packages/ai/src/capability-route-routes.ts`
- Modify: `packages/ai/src/routes.ts` (`AiRoutesDependencies`, ~:99)
- Modify: `apps/api/src/server.ts` (dependency wiring, ~:354)
- Test: `tests/integration/ai-structured.test.ts` (append a describe block)

**Interfaces:**

- Consumes: Task 2 schemas (`deleteAiServiceBindingRouteSchema` et al.), Task 3 repository methods, `isModuleServiceKey` / `MODULE_WORKER_SERVICE_KEY` / `type AiServiceKey` (Task 1); existing `getBuiltInModuleManifests` (already imported in server.ts:30; returns `readonly JarvisModuleManifest[]`).
- Produces: widened `PUT /api/ai/services/:service/binding`; `GET /api/ai/service-bindings` including module keys; new `DELETE /api/ai/services/:service/binding`; `AiRoutesDependencies.listInstalledModuleIds?: () => readonly string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/ai-structured.test.ts`:

```typescript
describe("module service binding routes", () => {
  const auth = { authorization: `Bearer ${ids.sessionAdmin}` };

  it("PUT + GET round-trip a module.worker binding (fjs must not strip module keys)", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.worker/binding",
      headers: auth,
      payload: { binding: { kind: "mode", tier: "economy" } }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      service: "module.worker",
      binding: { kind: "mode", tier: "economy" }
    });

    // Regression for the fast-json-stringify strip trap (#859/#885): the module key must survive
    // response serialization via patternProperties.
    const list = await server.inject({
      method: "GET",
      url: "/api/ai/service-bindings",
      headers: auth
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().bindings["module.worker"]).toEqual({ kind: "mode", tier: "economy" });
  });

  it("rejects a module-specific binding for a module that is not installed", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.definitely-not-installed/binding",
      headers: auth,
      payload: { binding: { kind: "mode", tier: "economy" } }
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().message ?? put.json().error).toMatch(/installed module/);
  });

  it("rejects a model binding whose model lacks the json capability", async () => {
    const chatOnlyModelId = await seedModel(providerId, "chat-only", ["chat"], "interactive");
    const put = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.worker/binding",
      headers: auth,
      payload: { binding: { kind: "model", modelId: chatOnlyModelId } }
    });
    expect(put.statusCode).toBe(400);

    // ...while the same model IS valid for chat (user-facing services keep their own capability).
    const chatPut = await server.inject({
      method: "PUT",
      url: "/api/ai/services/chat/binding",
      headers: auth,
      payload: { binding: { kind: "model", modelId: chatOnlyModelId } }
    });
    expect(chatPut.statusCode).toBe(200);
  });

  it("DELETE unbinds module keys only", async () => {
    const del = await server.inject({
      method: "DELETE",
      url: "/api/ai/services/module.worker/binding",
      headers: auth
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ service: "module.worker" });

    const list = await server.inject({
      method: "GET",
      url: "/api/ai/service-bindings",
      headers: auth
    });
    expect(list.json().bindings["module.worker"]).toBeUndefined();

    const chatDel = await server.inject({
      method: "DELETE",
      url: "/api/ai/services/chat/binding",
      headers: auth
    });
    expect(chatDel.statusCode).toBe(400);
  });

  it("requires auth and instance-admin", async () => {
    const anon = await server.inject({
      method: "PUT",
      url: "/api/ai/services/module.worker/binding",
      payload: { binding: { kind: "mode", tier: "economy" } }
    });
    expect(anon.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:ai`
Expected: FAIL — PUT `module.worker` returns 400 `service is not bindable` (handler still rejects module keys) and DELETE returns 404 (route absent).

- [ ] **Step 3: Implement route changes**

In `packages/ai/src/capability-route-routes.ts`:

(a) Extend the `@jarv1s/shared` import with `MODULE_WORKER_SERVICE_KEY`, `deleteAiServiceBindingRouteSchema`, `isModuleServiceKey`, `type AiServiceKey`.

(b) Update the stale part of the `BINDABLE_SERVICES` comment (:23–28): worker capabilities stay automatic, but `module.*` binding keys are now admin knobs (#915 D6).

(c) Widen `parseBindableService` (:203):

```typescript
function parseBindableService(value: string): AiServiceKey {
  if (BINDABLE_SERVICES.has(value as AiModelCapability)) {
    return value as AiModelCapability;
  }
  // #915 D6: module.* binding keys are admin-bindable; every other worker capability stays
  // automatic-only.
  if (isModuleServiceKey(value)) {
    return value;
  }
  throw new HttpError(400, "service is not bindable");
}
```

(d) In the GET `/api/ai/service-bindings` handler (:66–89), change the accumulator type and merge module bindings after the existing loop:

```typescript
async (scopedDb) => {
  const result: Record<string, AiServiceBinding> = {};
  for (const service of BINDABLE_SERVICES) {
    const binding = await repository.getServiceBinding(scopedDb, service);
    if (binding) result[service] = binding;
  }
  // #915 D6: module bindings ride the same response map; the schema declares them via
  // patternProperties so fast-json-stringify can't silently strip them (#859/#885).
  Object.assign(result, await repository.listModuleServiceBindings(scopedDb));
  return result;
};
```

(e) In the PUT handler, inside `withDataContext` AFTER `assertInstanceAdmin` (:103) and replacing the model-validation block (:105–118):

```typescript
await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);

// #915 D6: a module-specific key must reference an installed module (module.worker is
// the generic key and always allowed). Install-level, NOT per-user enablement —
// resolveActiveModules is the enablement view. Checked after the admin gate so
// installed module ids aren't probeable by unauthenticated callers.
if (isModuleServiceKey(service) && service !== MODULE_WORKER_SERVICE_KEY) {
  const installedIds = dependencies.listInstalledModuleIds?.() ?? [];
  const moduleId = service.slice("module.".length);
  if (!installedIds.includes(moduleId)) {
    throw new HttpError(400, "service does not reference an installed module");
  }
}

// A "model" binding must reference an active, capability-compatible model. Module
// structured work always runs capability "json" (#915 D6); user-facing services keep
// requiring their own capability.
if (binding.kind === "model") {
  const requiredCapability: AiModelCapability = isModuleServiceKey(service) ? "json" : service;
  const models = await repository.listModels(scopedDb);
  const valid = models.some(
    (model) =>
      model.id === binding.modelId &&
      model.status === "active" &&
      model.provider_status === "active" &&
      model.capabilities.includes(requiredCapability)
  );
  if (!valid) {
    throw new HttpError(400, "modelId must reference an active compatible model");
  }
}
```

(f) Register the DELETE route directly after the PUT route (:134):

```typescript
// #915 D6: unbind a module service — it returns to automatic routing. Chat has no unbind (the
// settings UI always writes a replacement binding), so this is module-keys-only by design.
server.delete<{ Params: ServiceParams }>(
  "/api/ai/services/:service/binding",
  { schema: deleteAiServiceBindingRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const service = parseBindableService(request.params.service);
      if (!isModuleServiceKey(service)) {
        throw new HttpError(400, "only module service bindings can be deleted");
      }

      await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);
        await repository.deleteModuleServiceBinding(scopedDb, service, accessContext.actorUserId);
      });

      return { service };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

In `packages/ai/src/routes.ts`, add to `AiRoutesDependencies` (~:99):

```typescript
  // #915 D6: installed module ids for validating `module.<id>` binding keys. Install-level, NOT
  // per-user enablement. Optional so embedded test servers without a module registry keep working.
  readonly listInstalledModuleIds?: () => readonly string[];
```

In `apps/api/src/server.ts`, next to the existing `listModuleManifests: getBuiltInModuleManifests,` (~:354):

```typescript
      listInstalledModuleIds: () => getBuiltInModuleManifests().map((manifest) => manifest.id),
```

- [ ] **Step 4: Run tests + gates**

Run: `pnpm test:ai`
Expected: PASS (all suites, including the pre-existing chat-binding tests — the widened routes are strictly additive for chat).

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/capability-route-routes.ts packages/ai/src/routes.ts apps/api/src/server.ts tests/integration/ai-structured.test.ts
git commit -m "feat(ai): admin API for module AI bindings (#915 slice 3)

Admins can now bind a module (or all modules) to a model or tier and unbind
it again; bindings for modules that aren't installed are rejected, and module
model bindings must support structured JSON output."
```

---

### Task 6: Structured-schema resource bounds

**Files:**

- Create: `packages/ai/src/structured/schema-bounds.ts`
- Modify: `packages/ai/src/index.ts` (add `export * from "./structured/schema-bounds.js";`)
- Test: `tests/unit/ai-structured-schema-bounds.test.ts`

**Interfaces:**

- Consumes: nothing project-specific (Node `Buffer` only — packages/ai is backend-only, never Vite-bundled).
- Produces: constants `STRUCTURED_PROMPT_MAX_BYTES` (65536), `STRUCTURED_SCHEMA_MAX_BYTES` (16384), `STRUCTURED_SCHEMA_MAX_DEPTH` (8), `STRUCTURED_SCHEMA_MAX_PROPERTIES` (100), `STRUCTURED_SCHEMA_MAX_COMBINATOR_BRANCHES` (16), `STRUCTURED_RESULT_MAX_BYTES` (131072), `STRUCTURED_DEFAULT_MAX_OUTPUT_TOKENS` (4096); `assertBoundedStructuredSchema(schema: unknown): void`; `assertBoundedStructuredPrompt(prompt: string): void`. Both THROW on violation (Task 8 relies on that contract).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai-structured-schema-bounds.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  STRUCTURED_PROMPT_MAX_BYTES,
  STRUCTURED_SCHEMA_MAX_DEPTH,
  assertBoundedStructuredPrompt,
  assertBoundedStructuredSchema
} from "../../packages/ai/src/structured/schema-bounds.js";

const okSchema = {
  type: "object",
  additionalProperties: false,
  properties: { a: { type: "string" } }
};

describe("assertBoundedStructuredSchema", () => {
  it("accepts a small object schema", () => {
    expect(() => assertBoundedStructuredSchema(okSchema)).not.toThrow();
  });

  it("rejects non-object roots", () => {
    expect(() => assertBoundedStructuredSchema({ type: "string" })).toThrow(/root/);
    expect(() => assertBoundedStructuredSchema("x")).toThrow();
    expect(() => assertBoundedStructuredSchema(null)).toThrow();
    expect(() => assertBoundedStructuredSchema([okSchema])).toThrow();
  });

  it("rejects forbidden keywords anywhere in the tree", () => {
    const forbidden = [
      "$ref",
      "$dynamicRef",
      "$defs",
      "definitions",
      "pattern",
      "patternProperties"
    ];
    for (const key of forbidden) {
      expect(() =>
        assertBoundedStructuredSchema({
          type: "object",
          properties: { a: { type: "string", [key]: "x" } }
        })
      ).toThrow(/not allowed/);
    }
  });

  it("rejects schemas over the byte cap", () => {
    const big = {
      type: "object",
      properties: { a: { type: "string", description: "x".repeat(17_000) } }
    };
    expect(() => assertBoundedStructuredSchema(big)).toThrow(/bytes/);
  });

  it("rejects nesting deeper than the cap", () => {
    let leaf: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < STRUCTURED_SCHEMA_MAX_DEPTH + 2; index += 1) {
      leaf = { type: "object", properties: { nested: leaf } };
    }
    expect(() => assertBoundedStructuredSchema(leaf)).toThrow(/depth/);
  });

  it("rejects more than the total property cap", () => {
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < 101; index += 1) properties[`p${index}`] = { type: "string" };
    expect(() => assertBoundedStructuredSchema({ type: "object", properties })).toThrow(
      /properties/
    );
  });

  it("rejects combinators with too many branches", () => {
    const branches = Array.from({ length: 17 }, () => ({ type: "string" }));
    expect(() =>
      assertBoundedStructuredSchema({ type: "object", properties: { a: { oneOf: branches } } })
    ).toThrow(/branches/);
  });
});

describe("assertBoundedStructuredPrompt", () => {
  it("accepts prompts under the cap and rejects over", () => {
    expect(() => assertBoundedStructuredPrompt("hello")).not.toThrow();
    expect(() =>
      assertBoundedStructuredPrompt("x".repeat(STRUCTURED_PROMPT_MAX_BYTES + 1))
    ).toThrow(/bytes/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/ai-structured-schema-bounds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/ai/src/structured/schema-bounds.ts`:

```typescript
// #915 D6: resource bounds for module-supplied structured-output schemas and prompts. These guard
// INPUTS from module code — a violation is a platform-contract bug in the module, so both asserts
// THROW; the typed { ok: false } errors in generate-structured.ts are reserved for RUNTIME
// outcomes (missing config, provider failures, unrepairable output).

export const STRUCTURED_PROMPT_MAX_BYTES = 65_536;
export const STRUCTURED_SCHEMA_MAX_BYTES = 16_384;
// Depth counts every object descent during the walk (≈2 per "properties" level) — a coarse but
// deterministic complexity bound.
export const STRUCTURED_SCHEMA_MAX_DEPTH = 8;
export const STRUCTURED_SCHEMA_MAX_PROPERTIES = 100;
export const STRUCTURED_SCHEMA_MAX_COMBINATOR_BRANCHES = 16;
export const STRUCTURED_RESULT_MAX_BYTES = 131_072;
export const STRUCTURED_DEFAULT_MAX_OUTPUT_TOKENS = 4096;

// Reference indirection and regex evaluation are DoS/complexity vectors, and no provider's
// structured mode supports them consistently — banned outright.
const FORBIDDEN_KEYWORDS = new Set([
  "$ref",
  "$dynamicRef",
  "$defs",
  "definitions",
  "pattern",
  "patternProperties"
]);

const COMBINATOR_KEYWORDS: readonly string[] = ["oneOf", "anyOf", "allOf"];

export function assertBoundedStructuredPrompt(prompt: string): void {
  const bytes = Buffer.byteLength(prompt, "utf8");
  if (bytes > STRUCTURED_PROMPT_MAX_BYTES) {
    throw new Error(
      `structured prompt exceeds ${STRUCTURED_PROMPT_MAX_BYTES} bytes (got ${bytes})`
    );
  }
}

export function assertBoundedStructuredSchema(schema: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(schema) ?? "", "utf8");
  if (bytes > STRUCTURED_SCHEMA_MAX_BYTES) {
    throw new Error(
      `structured schema exceeds ${STRUCTURED_SCHEMA_MAX_BYTES} bytes (got ${bytes})`
    );
  }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("structured schema must be a JSON object");
  }
  if ((schema as Record<string, unknown>).type !== "object") {
    throw new Error('structured schema root must have type: "object"');
  }

  let totalProperties = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > STRUCTURED_SCHEMA_MAX_DEPTH) {
      throw new Error(`structured schema exceeds max depth ${STRUCTURED_SCHEMA_MAX_DEPTH}`);
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth);
      return;
    }
    if (!node || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_KEYWORDS.has(key)) {
        throw new Error(`structured schema keyword "${key}" is not allowed`);
      }
      if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
        totalProperties += Object.keys(value).length;
        if (totalProperties > STRUCTURED_SCHEMA_MAX_PROPERTIES) {
          throw new Error(
            `structured schema exceeds ${STRUCTURED_SCHEMA_MAX_PROPERTIES} total properties`
          );
        }
      }
      if (COMBINATOR_KEYWORDS.includes(key) && Array.isArray(value)) {
        if (value.length > STRUCTURED_SCHEMA_MAX_COMBINATOR_BRANCHES) {
          throw new Error(
            `structured schema combinator exceeds ${STRUCTURED_SCHEMA_MAX_COMBINATOR_BRANCHES} branches`
          );
        }
      }
      walk(value, depth + 1);
    }
  };
  walk(schema, 0);
}
```

Add to `packages/ai/src/index.ts`:

```typescript
export * from "./structured/schema-bounds.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/ai-structured-schema-bounds.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/structured/schema-bounds.ts packages/ai/src/index.ts tests/unit/ai-structured-schema-bounds.test.ts
git commit -m "feat(ai): resource bounds for module structured-output schemas (#915 slice 3)

Caps schema size, depth, property count, and combinator fan-out, and bans
reference/regex keywords, so a module can't stall the platform with a
pathological schema. Not user-visible."
```

---

### Task 7: Per-provider structured request builder + `HttpApiAdapter.generateStructured`

**Files:**

- Create: `packages/ai/src/adapters/http-api-structured.ts`
- Modify: `packages/ai/src/adapters/http-api.ts` (add one method)
- Modify: `packages/ai/src/index.ts` (add `export * from "./adapters/http-api-structured.js";`)
- Test: `tests/unit/ai-http-api-structured.test.ts`

**Interfaces:**

- Consumes: `type ProviderKind` from `./transcript-reader.js` (same import http-api.ts uses); `HttpApiAdapter` constructor `(providerKind, apiKey, opts)` with `opts.fetch` / `opts.baseUrl` (see `buildRequest` at http-api.ts:96).
- Produces: `STRUCTURED_TOOL_NAME`; `type StructuredChatTurn = { role: "user" | "assistant"; content: string }`; `type GenerateStructuredProviderInput`; `type StructuredUsage`; `type StructuredProviderResult`; `class StructuredOutputParseError`; `buildStructuredRequest(providerKind, apiKey, baseUrl, input)`; `extractStructuredResult(providerKind, payload)`; `HttpApiAdapter.generateStructured(input): Promise<StructuredProviderResult>`. Task 8's orchestrator consumes all of these.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai-http-api-structured.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { HttpApiAdapter } from "../../packages/ai/src/adapters/http-api.js";
import {
  STRUCTURED_TOOL_NAME,
  StructuredOutputParseError,
  buildStructuredRequest,
  extractStructuredResult,
  type GenerateStructuredProviderInput
} from "../../packages/ai/src/adapters/http-api-structured.js";

const schema = { type: "object", properties: { a: { type: "string" } } };

function makeInput(
  overrides: Partial<GenerateStructuredProviderInput> = {}
): GenerateStructuredProviderInput {
  return {
    model: { provider_kind: "anthropic", provider_model_id: "claude-x" },
    messages: [{ role: "user", content: "hi" }],
    schema,
    maxOutputTokens: 512,
    ...overrides
  };
}

describe("buildStructuredRequest", () => {
  it("anthropic: forced tool call, x-api-key header, versioned", () => {
    const request = buildStructuredRequest("anthropic", "sk-a", null, makeInput());
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers["x-api-key"]).toBe("sk-a");
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request.body.tool_choice).toEqual({ type: "tool", name: STRUCTURED_TOOL_NAME });
    const tools = request.body.tools as Array<{ name: string; input_schema: unknown }>;
    expect(tools[0].name).toBe(STRUCTURED_TOOL_NAME);
    expect(tools[0].input_schema).toBe(schema);
    expect(request.body.max_tokens).toBe(512);
  });

  it("openai-compatible: strict json_schema response_format, Bearer auth, custom base URL", () => {
    const request = buildStructuredRequest(
      "openai-compatible",
      "sk-o",
      "https://llm.internal",
      makeInput()
    );
    expect(request.url).toBe("https://llm.internal/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer sk-o");
    expect(request.body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "structured_output", strict: true, schema }
    });
  });

  it("google: responseSchema generationConfig, key in HEADER never URL, assistant→model role", () => {
    const request = buildStructuredRequest(
      "google",
      "sk-g",
      null,
      makeInput({
        messages: [
          { role: "assistant", content: "prev" },
          { role: "user", content: "hi" }
        ]
      })
    );
    expect(request.url).not.toContain("sk-g");
    expect(request.headers["x-goog-api-key"]).toBe("sk-g");
    const body = request.body as {
      contents: Array<{ role: string }>;
      generationConfig: Record<string, unknown>;
    };
    expect(body.contents[0].role).toBe("model");
    expect(body.contents[1].role).toBe("user");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toBe(schema);
  });
});

describe("extractStructuredResult", () => {
  it("anthropic: reads the forced tool_use input and usage", () => {
    const result = extractStructuredResult("anthropic", {
      content: [{ type: "tool_use", name: STRUCTURED_TOOL_NAME, input: { a: "b" } }],
      usage: { input_tokens: 3, output_tokens: 2 }
    });
    expect(result).toEqual({ rawObject: { a: "b" }, usage: { inputTokens: 3, outputTokens: 2 } });
  });

  it("anthropic: a chatty non-tool response throws a repairable parse error", () => {
    expect(() =>
      extractStructuredResult("anthropic", {
        content: [{ type: "text", text: "sure! here you go..." }],
        usage: { input_tokens: 1, output_tokens: 1 }
      })
    ).toThrow(StructuredOutputParseError);
  });

  it("openai-compatible: parses JSON content and maps usage", () => {
    const result = extractStructuredResult("openai-compatible", {
      choices: [{ message: { content: '{"a":"b"}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 4 }
    });
    expect(result).toEqual({ rawObject: { a: "b" }, usage: { inputTokens: 5, outputTokens: 4 } });
  });

  it("google: joins text parts and parses", () => {
    const result = extractStructuredResult("google", {
      candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '"b"}' }] } }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 }
    });
    expect(result).toEqual({ rawObject: { a: "b" }, usage: { inputTokens: 2, outputTokens: 1 } });
  });

  it("invalid JSON throws a parse error carrying rawText + usage (for the repair loop)", () => {
    try {
      extractStructuredResult("openai-compatible", {
        choices: [{ message: { content: "not json" } }],
        usage: { prompt_tokens: 9, completion_tokens: 8 }
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredOutputParseError);
      const parseError = error as StructuredOutputParseError;
      expect(parseError.usage).toEqual({ inputTokens: 9, outputTokens: 8 });
      expect(parseError.rawText).toBe("not json");
    }
  });
});

describe("HttpApiAdapter.generateStructured", () => {
  it("POSTs the built request, threads the AbortSignal, and returns the extracted result", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const controller = new AbortController();
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "tool_use", name: STRUCTURED_TOOL_NAME, input: { a: "b" } }],
          usage: { input_tokens: 3, output_tokens: 2 }
        })
      };
    }) as unknown as typeof globalThis.fetch;

    const adapter = new HttpApiAdapter("anthropic", "sk-secret", { fetch: fakeFetch });
    const result = await adapter.generateStructured(makeInput({ signal: controller.signal }));

    expect(result).toEqual({ rawObject: { a: "b" }, usage: { inputTokens: 3, outputTokens: 2 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.signal).toBe(controller.signal);
  });

  it("HTTP errors surface status only — never the API key", async () => {
    const fake500 = (async () => ({
      ok: false,
      status: 500
    })) as unknown as typeof globalThis.fetch;
    const adapter = new HttpApiAdapter("anthropic", "sk-secret", { fetch: fake500 });

    const error = await adapter.generateStructured(makeInput()).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("AI provider request failed: HTTP 500");
    expect((error as Error).message).not.toContain("sk-secret");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/ai-http-api-structured.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder/extractor**

Create `packages/ai/src/adapters/http-api-structured.ts`:

```typescript
import type { ProviderKind } from "./transcript-reader.js";

// #915 D6: per-provider mechanics for structured output. This file is pure request/response
// shaping — no fetch, no secrets storage — so every branch is unit-testable without a network.
// The provider switch lives HERE (transport), never in feature code (provider-agnostic invariant).

export const STRUCTURED_TOOL_NAME = "emit_structured_output";

// Self-contained turn shape (not the chat adapter's ChatTurn): the repair loop appends synthetic
// assistant/user turns and must not depend on chat-transcript semantics.
export type StructuredChatTurn = {
  readonly role: "user" | "assistant";
  readonly content: string;
};

export type StructuredUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type GenerateStructuredProviderInput = {
  readonly model: { readonly provider_kind: ProviderKind; readonly provider_model_id: string };
  readonly messages: readonly StructuredChatTurn[];
  readonly schema: Record<string, unknown>;
  readonly maxOutputTokens: number;
  readonly signal?: AbortSignal;
};

export type StructuredProviderResult = {
  readonly rawObject: unknown;
  readonly usage: StructuredUsage;
};

/** The model produced unparseable output — REPAIRABLE (unlike transport/HTTP failures). */
export class StructuredOutputParseError extends Error {
  readonly rawText: string;
  readonly usage: StructuredUsage;

  constructor(message: string, rawText: string, usage: StructuredUsage) {
    super(message);
    this.name = "StructuredOutputParseError";
    // Capped: rawText may echo prompt content — it feeds the repair loop, never logs.
    this.rawText = rawText.slice(0, 2000);
    this.usage = usage;
  }
}

export type StructuredHttpRequest = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
};

export function buildStructuredRequest(
  providerKind: ProviderKind,
  apiKey: string,
  baseUrl: string | null,
  input: GenerateStructuredProviderInput
): StructuredHttpRequest {
  switch (providerKind) {
    case "anthropic": {
      // Forced tool call is the only reliable structured mode on the Anthropic API: the model
      // MUST call our synthetic tool, whose input schema IS the caller's schema.
      const base = baseUrl ?? "https://api.anthropic.com";
      return {
        url: `${base}/v1/messages`,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: {
          model: input.model.provider_model_id,
          max_tokens: input.maxOutputTokens,
          messages: input.messages.map((turn) => ({ role: turn.role, content: turn.content })),
          tools: [
            {
              name: STRUCTURED_TOOL_NAME,
              description: "Emit the structured output that answers the request.",
              input_schema: input.schema
            }
          ],
          tool_choice: { type: "tool", name: STRUCTURED_TOOL_NAME }
        }
      };
    }
    case "openai-compatible": {
      const base = baseUrl ?? "https://api.openai.com";
      return {
        url: `${base}/v1/chat/completions`,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: {
          model: input.model.provider_model_id,
          max_tokens: input.maxOutputTokens,
          messages: input.messages.map((turn) => ({ role: turn.role, content: turn.content })),
          response_format: {
            type: "json_schema",
            json_schema: { name: "structured_output", strict: true, schema: input.schema }
          }
        }
      };
    }
    case "google": {
      const base = baseUrl ?? "https://generativelanguage.googleapis.com";
      return {
        // Key goes in a HEADER, never the URL query — URLs land in proxy/server logs.
        url: `${base}/v1beta/models/${input.model.provider_model_id}:generateContent`,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: {
          contents: input.messages.map((turn) => ({
            role: turn.role === "assistant" ? "model" : "user",
            parts: [{ text: turn.content }]
          })),
          generationConfig: {
            maxOutputTokens: input.maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: input.schema
          }
        }
      };
    }
    default: {
      const exhaustive: never = providerKind;
      throw new Error(`unsupported provider kind: ${String(exhaustive)}`);
    }
  }
}

type AnthropicPayload = {
  content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};
type OpenAiPayload = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};
type GooglePayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

export function extractStructuredResult(
  providerKind: ProviderKind,
  payload: unknown
): StructuredProviderResult {
  switch (providerKind) {
    case "anthropic": {
      const record = (payload ?? {}) as AnthropicPayload;
      const usage: StructuredUsage = {
        inputTokens: numberOrZero(record.usage?.input_tokens),
        outputTokens: numberOrZero(record.usage?.output_tokens)
      };
      const toolUse = record.content?.find(
        (block) => block?.type === "tool_use" && block?.name === STRUCTURED_TOOL_NAME
      );
      if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
        const text = (record.content ?? [])
          .map((block) => (typeof block?.text === "string" ? block.text : ""))
          .join("");
        throw new StructuredOutputParseError(
          "anthropic response has no structured tool call",
          text,
          usage
        );
      }
      return { rawObject: toolUse.input, usage };
    }
    case "openai-compatible": {
      const record = (payload ?? {}) as OpenAiPayload;
      const usage: StructuredUsage = {
        inputTokens: numberOrZero(record.usage?.prompt_tokens),
        outputTokens: numberOrZero(record.usage?.completion_tokens)
      };
      const content = record.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new StructuredOutputParseError(
          "openai-compatible response has no message content",
          "",
          usage
        );
      }
      return { rawObject: parseJsonOrThrow(content, usage), usage };
    }
    case "google": {
      const record = (payload ?? {}) as GooglePayload;
      const usage: StructuredUsage = {
        inputTokens: numberOrZero(record.usageMetadata?.promptTokenCount),
        outputTokens: numberOrZero(record.usageMetadata?.candidatesTokenCount)
      };
      const parts = record.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts)
        ? parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
        : "";
      if (text.length === 0) {
        throw new StructuredOutputParseError("google response has no text parts", "", usage);
      }
      return { rawObject: parseJsonOrThrow(text, usage), usage };
    }
    default: {
      const exhaustive: never = providerKind;
      throw new Error(`unsupported provider kind: ${String(exhaustive)}`);
    }
  }
}

function parseJsonOrThrow(text: string, usage: StructuredUsage): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new StructuredOutputParseError("model output is not valid JSON", text, usage);
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
```

Add the `generateStructured` method to `HttpApiAdapter` in `packages/ai/src/adapters/http-api.ts` (import `buildStructuredRequest`, `extractStructuredResult`, and the two types from `./http-api-structured.js`). (Field names verified against the class: constructor params `providerKind` / `apiKey`, plus `_baseUrl: string | undefined` and `_fetch` — so `this._baseUrl ?? null` is correct as written.)

```typescript
  // #915 D6: structured variant of generate(). Same transport, but: forced schema mechanics per
  // provider, AbortSignal threading, and usage extraction. HTTP failures surface status ONLY —
  // the request carries the API key and must never reach an error message or log.
  async generateStructured(
    input: GenerateStructuredProviderInput
  ): Promise<StructuredProviderResult> {
    const request = buildStructuredRequest(
      this.providerKind,
      this.apiKey,
      this._baseUrl ?? null,
      input
    );
    const response = await this._fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: input.signal
    });
    if (!response.ok) {
      throw new Error(`AI provider request failed: HTTP ${response.status}`);
    }
    return extractStructuredResult(this.providerKind, await response.json());
  }
```

Add to `packages/ai/src/index.ts`:

```typescript
export * from "./adapters/http-api-structured.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/ai-http-api-structured.test.ts tests/unit/ai-http-api.test.ts`
Expected: PASS — including the PRE-EXISTING http-api suite (the new method must not disturb `generate`).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/http-api-structured.ts packages/ai/src/adapters/http-api.ts packages/ai/src/index.ts tests/unit/ai-http-api-structured.test.ts
git commit -m "feat(ai): per-provider structured-output transport (#915 slice 3)

Anthropic, OpenAI-compatible, and Google models can all be asked for
schema-shaped JSON through one internal adapter call; requests are
cancellable and API keys can never leak into error messages."
```

---

### Task 8: `generateStructured` orchestrator (resolve → decrypt → call → validate → repair)

**Files:**

- Create: `packages/ai/src/structured/generate-structured.ts`
- Modify: `packages/ai/package.json` (add `"ajv": "^8.17.1"` to `dependencies`, then `pnpm install` — the `check:package-deps` gate requires the declaration; ajv is currently only a transitive dep via fastify)
- Modify: `packages/ai/src/index.ts` (add `export * from "./structured/generate-structured.js";`)
- Test: `tests/unit/ai-generate-structured.test.ts`

**Interfaces:**

- Consumes: `resolveModelForService` (Task 4), `selectProviderWithCredential` (existing repository method), `parseAiApiKeyCredential` (existing — grep packages/ai for it; `packages/chat/src/jobs.ts:199-230` is the caller pattern to mirror, including where the provider row's base URL comes from), `AiSecretCipher.decryptJson`, `HttpApiAdapter` + Task 7 types, Task 6 bounds.
- Produces: `STRUCTURED_MAX_REPAIR_RETRIES = 2`; `type StructuredProviderAdapter`; `type GenerateStructuredDeps`; `type GenerateStructuredInput`; `type GenerateStructuredResult`; `generateStructured(scopedDb, input, deps): Promise<GenerateStructuredResult>`. This is THE seam the future `ctx.ai` RPC (blocked on #818/#919) will call.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ai-generate-structured.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

import type { DataContextDb } from "@jarv1s/db";

import { StructuredOutputParseError } from "../../packages/ai/src/adapters/http-api-structured.js";
import {
  STRUCTURED_MAX_REPAIR_RETRIES,
  generateStructured,
  type GenerateStructuredDeps
} from "../../packages/ai/src/structured/generate-structured.js";

// The orchestrator itself never touches the db — only the (faked) repository does — so a bare
// object stands in for the branded handle.
const scopedDb = {} as DataContextDb;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["a"],
  properties: { a: { type: "string" } }
};

const model = {
  id: "model-1",
  provider_config_id: "provider-1",
  provider_kind: "anthropic",
  provider_model_id: "claude-x"
} as never;

type DepsOverrides = {
  repository?: Partial<GenerateStructuredDeps["repository"]>;
  cipher?: GenerateStructuredDeps["cipher"];
  logger?: GenerateStructuredDeps["logger"];
  createAdapter?: GenerateStructuredDeps["createAdapter"];
};

function makeDeps(overrides: DepsOverrides = {}): GenerateStructuredDeps {
  return {
    repository: {
      resolveModelForService: vi.fn(async () => ({
        model,
        reason: "matched-active-model" as const
      })),
      selectProviderWithCredential: vi.fn(
        async () => ({ id: "provider-1", base_url: null, encrypted_credential: {} }) as never
      ),
      ...overrides.repository
    } as GenerateStructuredDeps["repository"],
    cipher: overrides.cipher ?? { decryptJson: vi.fn(() => ({ apiKey: "sk-test" })) },
    logger: overrides.logger,
    createAdapter: overrides.createAdapter
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return { service: "module.job-search" as const, schema, prompt: "extract", ...overrides };
}

describe("generateStructured", () => {
  it("happy path: returns the validated object and accumulated usage", async () => {
    const adapter = {
      generateStructured: vi.fn(async () => ({
        rawObject: { a: "b" },
        usage: { inputTokens: 10, outputTokens: 5 }
      }))
    };
    const info = vi.fn();
    const deps = makeDeps({ createAdapter: () => adapter, logger: { info, warn: vi.fn() } });

    const result = await generateStructured(scopedDb, makeInput(), deps);

    expect(result).toEqual({
      ok: true,
      object: { a: "b" },
      usage: { inputTokens: 10, outputTokens: 5 }
    });
    expect(adapter.generateStructured).toHaveBeenCalledTimes(1);
    // usage line: counts + ids only — NEVER content
    expect(info).toHaveBeenCalledWith(
      {
        service: "module.job-search",
        modelId: "model-1",
        inputTokens: 10,
        outputTokens: 5,
        attempts: 1
      },
      "ai.structured usage"
    );
  });

  it("repairs a parse error: appends the raw text + a repair turn, then succeeds", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(
        new StructuredOutputParseError("bad", "not json", { inputTokens: 4, outputTokens: 3 })
      )
      .mockResolvedValueOnce({ rawObject: { a: "b" }, usage: { inputTokens: 6, outputTokens: 2 } });
    const deps = makeDeps({ createAdapter: () => ({ generateStructured: generate }) });

    const result = await generateStructured(scopedDb, makeInput(), deps);

    expect(result).toEqual({
      ok: true,
      object: { a: "b" },
      usage: { inputTokens: 10, outputTokens: 5 }
    });
    expect(generate).toHaveBeenCalledTimes(2);
    const secondCallMessages = generate.mock.calls[1][0].messages;
    expect(secondCallMessages).toHaveLength(3);
    expect(secondCallMessages[1]).toEqual({ role: "assistant", content: "not json" });
    expect(secondCallMessages[2].role).toBe("user");
  });

  it("returns validation_failed after 1 + STRUCTURED_MAX_REPAIR_RETRIES schema-invalid attempts", async () => {
    const generate = vi.fn(async () => ({
      rawObject: { a: 123 }, // wrong type — never validates
      usage: { inputTokens: 1, outputTokens: 1 }
    }));
    const deps = makeDeps({ createAdapter: () => ({ generateStructured: generate }) });

    const result = await generateStructured(scopedDb, makeInput(), deps);

    expect(result).toEqual({ ok: false, error: "validation_failed" });
    expect(generate).toHaveBeenCalledTimes(1 + STRUCTURED_MAX_REPAIR_RETRIES);
  });

  it("needs_config on: no model, no provider credential, or unparsable credential", async () => {
    const noModel = makeDeps({
      repository: {
        resolveModelForService: vi.fn(async () => ({
          model: null,
          reason: "needs-config" as const
        }))
      }
    });
    expect(await generateStructured(scopedDb, makeInput(), noModel)).toEqual({
      ok: false,
      error: "needs_config"
    });

    const noProvider = makeDeps({
      repository: { selectProviderWithCredential: vi.fn(async () => null) }
    });
    expect(await generateStructured(scopedDb, makeInput(), noProvider)).toEqual({
      ok: false,
      error: "needs_config"
    });

    const badCredential = makeDeps({ cipher: { decryptJson: vi.fn(() => ({})) } });
    expect(await generateStructured(scopedDb, makeInput(), badCredential)).toEqual({
      ok: false,
      error: "needs_config"
    });
  });

  it("aborted: pre-aborted signal never calls the adapter; AbortError maps to aborted", async () => {
    const adapter = { generateStructured: vi.fn() };
    const pre = new AbortController();
    pre.abort();
    const deps = makeDeps({ createAdapter: () => adapter });

    expect(await generateStructured(scopedDb, makeInput({ signal: pre.signal }), deps)).toEqual({
      ok: false,
      error: "aborted"
    });
    expect(adapter.generateStructured).not.toHaveBeenCalled();

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const throwing = makeDeps({
      createAdapter: () => ({ generateStructured: vi.fn().mockRejectedValue(abortError) })
    });
    expect(await generateStructured(scopedDb, makeInput(), throwing)).toEqual({
      ok: false,
      error: "aborted"
    });
  });

  it("provider_error on non-repairable adapter failure (logged message only)", async () => {
    const warn = vi.fn();
    const deps = makeDeps({
      createAdapter: () => ({
        generateStructured: vi
          .fn()
          .mockRejectedValue(new Error("AI provider request failed: HTTP 500"))
      }),
      logger: { info: vi.fn(), warn }
    });

    expect(await generateStructured(scopedDb, makeInput(), deps)).toEqual({
      ok: false,
      error: "provider_error"
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("an oversize result fails fast as validation_failed (no repair round-trips)", async () => {
    const generate = vi.fn(async () => ({
      rawObject: { a: "x".repeat(140_000) },
      usage: { inputTokens: 1, outputTokens: 1 }
    }));
    const deps = makeDeps({ createAdapter: () => ({ generateStructured: generate }) });

    expect(await generateStructured(scopedDb, makeInput(), deps)).toEqual({
      ok: false,
      error: "validation_failed"
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("input-bound violations THROW (module contract bug, not a runtime outcome)", async () => {
    const deps = makeDeps();
    await expect(
      generateStructured(
        scopedDb,
        makeInput({ schema: { type: "object", properties: { a: { $ref: "#/x" } } } }),
        deps
      )
    ).rejects.toThrow(/not allowed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/ai-generate-structured.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Add `"ajv": "^8.17.1"` to `packages/ai/package.json` dependencies and run `pnpm install`.

Create `packages/ai/src/structured/generate-structured.ts`. (Two import notes: (1) if `import Ajv from "ajv"` trips NodeNext interop, use the same import style any existing ajv-using file in the repo uses, or `import { Ajv } from "ajv"`; (2) `parseAiApiKeyCredential` lives at `packages/ai/src/credentials.ts:5` — the import below is correct; `packages/chat/src/jobs.ts:199-230` shows the canonical resolve→decrypt→parse→adapter sequence including where the provider row's base URL comes from — mirror that if anything looks off.)

```typescript
import Ajv, { type ErrorObject } from "ajv";
import type { FastifyBaseLogger } from "fastify";

import type { DataContextDb } from "@jarv1s/db";
import type { AiModelTier, ModuleServiceKey } from "@jarv1s/shared";

import { HttpApiAdapter } from "../adapters/http-api.js";
import {
  StructuredOutputParseError,
  type GenerateStructuredProviderInput,
  type StructuredChatTurn,
  type StructuredProviderResult,
  type StructuredUsage
} from "../adapters/http-api-structured.js";
import type { ProviderKind } from "../adapters/transcript-reader.js";
import type { AiSecretCipher } from "../crypto.js";
import { parseAiApiKeyCredential } from "../credentials.js";
import type { AiRepository } from "../repository.js";
import {
  STRUCTURED_DEFAULT_MAX_OUTPUT_TOKENS,
  STRUCTURED_RESULT_MAX_BYTES,
  assertBoundedStructuredPrompt,
  assertBoundedStructuredSchema
} from "./schema-bounds.js";

// #915 D6: the platform seam for module structured AI. Modules NEVER learn which model or
// provider served them (result carries object + usage counts only); admin routing happens in
// resolveModelForService; secrets stay inside this function's scope.

export const STRUCTURED_MAX_REPAIR_RETRIES = 2;

export type StructuredProviderAdapter = {
  generateStructured(input: GenerateStructuredProviderInput): Promise<StructuredProviderResult>;
};

export type GenerateStructuredDeps = {
  readonly repository: Pick<
    AiRepository,
    "resolveModelForService" | "selectProviderWithCredential"
  >;
  readonly cipher: Pick<AiSecretCipher, "decryptJson">;
  /** Usage/observability sink — counts and ids ONLY, never prompt or output content. */
  readonly logger?: Pick<FastifyBaseLogger, "info" | "warn">;
  /** Test seam. Default builds a real HttpApiAdapter. */
  readonly createAdapter?: (
    kind: ProviderKind,
    apiKey: string,
    baseUrl: string | null
  ) => StructuredProviderAdapter;
};

export type GenerateStructuredInput = {
  readonly service: ModuleServiceKey;
  readonly schema: Record<string, unknown>;
  readonly prompt: string;
  readonly tierHint?: AiModelTier;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
};

export type GenerateStructuredResult =
  | { readonly ok: true; readonly object: unknown; readonly usage: StructuredUsage }
  | {
      readonly ok: false;
      readonly error: "needs_config" | "validation_failed" | "provider_error" | "aborted";
    };

export async function generateStructured(
  scopedDb: DataContextDb,
  input: GenerateStructuredInput,
  deps: GenerateStructuredDeps
): Promise<GenerateStructuredResult> {
  // Input-bound violations THROW: they are module-side contract bugs, not runtime outcomes.
  assertBoundedStructuredSchema(input.schema);
  assertBoundedStructuredPrompt(input.prompt);

  const route = await deps.repository.resolveModelForService(scopedDb, input.service, {
    capability: "json",
    tierHint: input.tierHint
  });
  if (!route.model) return { ok: false, error: "needs_config" };
  const model = route.model;

  const provider = await deps.repository.selectProviderWithCredential(
    scopedDb,
    model.provider_config_id
  );
  if (!provider) return { ok: false, error: "needs_config" };

  const credential = parseAiApiKeyCredential(
    deps.cipher.decryptJson(provider.encrypted_credential)
  );
  if (!credential) return { ok: false, error: "needs_config" };

  const createAdapter =
    deps.createAdapter ??
    ((kind: ProviderKind, apiKey: string, baseUrl: string | null) =>
      new HttpApiAdapter(kind, apiKey, baseUrl ? { baseUrl } : {}));
  const adapter = createAdapter(model.provider_kind, credential.apiKey, provider.base_url ?? null);

  // Per-call ajv: schemas are module-supplied and unbounded in variety — no cross-call cache to
  // poison or grow. strict:false tolerates harmless vendor keywords; formats stay unvalidated.
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const validate = ajv.compile(input.schema);

  const maxOutputTokens = input.maxOutputTokens ?? STRUCTURED_DEFAULT_MAX_OUTPUT_TOKENS;
  const messages: StructuredChatTurn[] = [{ role: "user", content: input.prompt }];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 0; attempt <= STRUCTURED_MAX_REPAIR_RETRIES; attempt += 1) {
    if (input.signal?.aborted) return { ok: false, error: "aborted" };

    let result: StructuredProviderResult;
    try {
      result = await adapter.generateStructured({
        model: { provider_kind: model.provider_kind, provider_model_id: model.provider_model_id },
        messages,
        schema: input.schema,
        maxOutputTokens,
        signal: input.signal
      });
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        return { ok: false, error: "aborted" };
      }
      if (error instanceof StructuredOutputParseError) {
        // Repairable: feed the raw text back and ask again.
        usage.inputTokens += error.usage.inputTokens;
        usage.outputTokens += error.usage.outputTokens;
        messages.push({ role: "assistant", content: error.rawText });
        messages.push({
          role: "user",
          content:
            "That output was not valid JSON for the required schema. Respond again with ONLY a JSON object matching the schema."
        });
        continue;
      }
      // Message only — adapter errors carry HTTP status, never credentials or content.
      deps.logger?.warn(
        { service: input.service, message: error instanceof Error ? error.message : String(error) },
        "ai.structured provider error"
      );
      return { ok: false, error: "provider_error" };
    }

    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;

    const serialized = JSON.stringify(result.rawObject) ?? "";
    if (Buffer.byteLength(serialized, "utf8") > STRUCTURED_RESULT_MAX_BYTES) {
      // Oversize: a repair round-trip would just re-send the megabytes — fail fast.
      break;
    }

    if (validate(result.rawObject)) {
      deps.logger?.info(
        {
          service: input.service,
          modelId: model.id,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          attempts: attempt + 1
        },
        "ai.structured usage"
      );
      return { ok: true, object: result.rawObject, usage };
    }

    messages.push({ role: "assistant", content: serialized.slice(0, 4000) });
    messages.push({ role: "user", content: formatValidationErrors(validate.errors ?? []) });
  }

  return { ok: false, error: "validation_failed" };
}

function formatValidationErrors(errors: readonly ErrorObject[]): string {
  const lines = errors
    .slice(0, 5)
    .map((error) => `${error.instancePath || "/"}: ${error.message ?? "invalid"}`);
  return `The JSON did not match the required schema:\n${lines.join("\n")}\nRespond again with ONLY a corrected JSON object matching the schema.`.slice(
    0,
    1000
  );
}
```

Add to `packages/ai/src/index.ts`:

```typescript
export * from "./structured/generate-structured.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/ai-generate-structured.test.ts`
Expected: PASS (all 8 tests). Then `pnpm typecheck && pnpm lint` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/structured/generate-structured.ts packages/ai/src/index.ts packages/ai/package.json pnpm-lock.yaml tests/unit/ai-generate-structured.test.ts
git commit -m "feat(ai): generateStructured — schema-validated module AI output (#915 slice 3)

Modules can now ask the platform for JSON that provably matches a schema:
output is validated, invalid output gets bounded repair retries, requests are
cancellable, and failures come back as typed reasons instead of exceptions.
Which model answers stays an admin decision — modules never see it."
```

---

### Task 9: End-to-end integration + full gate

**Files:**

- Test: `tests/integration/ai-structured.test.ts` (append the final describe block)

**Interfaces:**

- Consumes: everything — real `AiRepository`, real cipher via `createAiSecretCipher(process.env)` (exported from `packages/ai/src/crypto.ts:16`), the Task 8 orchestrator with an injected fake adapter (the file-level fetch thrower guarantees nothing real is called).

- [ ] **Step 1: Write the e2e test**

Append to `tests/integration/ai-structured.test.ts` (extend the `@jarv1s/ai` import with `createAiSecretCipher`, `generateStructured`, and `type GenerateStructuredProviderInput`):

```typescript
describe("generateStructured end-to-end", () => {
  it("resolves the service, decrypts the real credential, calls the adapter, validates", async () => {
    const captured: { apiKey?: string; input?: GenerateStructuredProviderInput } = {};
    const fakeAdapter = {
      generateStructured: async (input: GenerateStructuredProviderInput) => {
        captured.input = input;
        return {
          rawObject: { title: "Staff Engineer" },
          usage: { inputTokens: 11, outputTokens: 7 }
        };
      }
    };

    const result = await dataContext.withDataContext(adminContext(), (scopedDb) =>
      generateStructured(
        scopedDb,
        {
          service: "module.job-search",
          prompt: "Extract the job title.",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title"],
            properties: { title: { type: "string" } }
          }
        },
        {
          repository,
          cipher: createAiSecretCipher(process.env),
          createAdapter: (kind, apiKey) => {
            captured.apiKey = apiKey;
            expect(kind).toBe("anthropic");
            return fakeAdapter;
          }
        }
      )
    );

    expect(result).toEqual({
      ok: true,
      object: { title: "Staff Engineer" },
      usage: { inputTokens: 11, outputTokens: 7 }
    });
    // the real AES-256-GCM cipher round-tripped the credential seeded in beforeAll
    expect(captured.apiKey).toBe("structured-test-secret");
    // unbound service → automatic economy json model (Task 4 cleanup restored automatic routing)
    expect(captured.input?.model.provider_model_id).toBe("json-economy");
    expect(captured.input?.messages).toEqual([{ role: "user", content: "Extract the job title." }]);
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `pnpm test:ai`
Expected: PASS — all suites in all three files.

- [ ] **Step 3: Full local gate**

Run: `pnpm verify:foundation`
Expected: exit 0. Record the exact command + exit code in the PR if CI is unavailable.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/ai-structured.test.ts
git commit -m "test(ai): end-to-end structured-output coverage (#915 slice 3)

Proves the whole path — admin routing, encrypted credential handling, and
schema validation — against a real database. No user-visible change."
```

---

## Out of Scope (follow-on plan, blocked on issue #919 / epic #818)

Explicitly NOT in this plan — do not build any of it speculatively:

- The `ctx.ai.generateStructured` RPC surface inside the module child runtime.
- Per-invocation in-memory caps and the credential composition guard at the RPC boundary.
- Any admin UI for module bindings (API-only in this slice).
- Durable AI usage quotas (deferred by Ben in the #915 spec review).

The seam contract the follow-on will consume: `generateStructured(scopedDb, { service, schema, prompt, tierHint?, maxOutputTokens?, signal? }, deps)` → `{ ok: true, object, usage } | { ok: false, error }` — model/provider identity never crosses to module callers.
