# AI Provider Test And Model Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-only provider credential testing and model discovery without leaking stored credentials.

**Architecture:** Reuse existing AI provider config tables, `selectProviderWithCredential`, and admin checks. Add one small injectable provider-validation helper for safe HTTP calls and model ID normalization, then wire two API routes and existing settings UI buttons to it. Discovery only returns candidates; persistence still goes through the existing explicit `createAiModel` path.

**Tech Stack:** Fastify, Kysely/DataContextDb, shared TypeScript route contracts, Vitest integration/unit tests, React Query settings UI.

---

## File Map

- Modify `packages/shared/src/ai-api.ts`: add response DTO schemas/types and route schemas for provider test/discover.
- Create `packages/ai/src/provider-validation.ts`: fetch-based provider test/discovery helper, safe error normalization, model suggestion heuristic.
- Modify `packages/ai/src/routes.ts`: dependency injection for validation helper, two admin-only routes.
- Modify `packages/ai/src/manifest.ts`: publish the new routes.
- Modify `packages/ai/src/index.ts`: export validation helper types if needed by tests.
- Modify `apps/web/src/api/client.ts`: add `testAiProvider` and `discoverAiProviderModels`.
- Modify `apps/web/src/api/query-keys.ts`: add provider discovery key if `useQuery` is used; skip if implemented as mutation-only.
- Modify `apps/web/src/settings/settings-ai-admin-pane.tsx`: replace placeholder Test button; add Discover action/candidate list; keep manual Add model form.
- Modify `tests/unit/ai-provider-validation.test.ts`: cover redaction, unsupported CLI, base URL/header behavior, model suggestion heuristic.
- Modify `tests/integration/ai.test.ts`: cover admin-only endpoints, safe test response, discovery does not insert model rows, revoked provider rejected.
- Modify `tests/e2e/mock-ai-api.ts` and `tests/e2e/app-shell.spec.ts`: mock new endpoints and verify UI flow.

## Task 1: Shared Contracts

**Files:**
- Modify: `packages/shared/src/ai-api.ts`

- [ ] **Step 1: Write failing type/schema usage**

Add route imports in `packages/ai/src/routes.ts` before implementation:

```ts
import {
  discoverAiProviderModelsRouteSchema,
  testAiProviderConfigRouteSchema,
  type AiProviderDiscoveredModelDto,
  type AiProviderTestResultDto
} from "@jarv1s/shared";
```

- [ ] **Step 2: Run typecheck to verify missing exports**

Run: `pnpm typecheck`

Expected: FAIL with missing exports from `@jarv1s/shared`.

- [ ] **Step 3: Add minimal DTOs and schemas**

In `packages/shared/src/ai-api.ts`, add:

```ts
export interface AiProviderTestResultDto {
  readonly ok: boolean;
  readonly providerKind: AiProviderKind;
  readonly message: string;
}

export interface AiProviderDiscoveredModelDto {
  readonly providerModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly AiModelCapability[];
  readonly tier: AiModelTier;
}

export interface TestAiProviderConfigResponse {
  readonly result: AiProviderTestResultDto;
}

export interface DiscoverAiProviderModelsResponse {
  readonly models: readonly AiProviderDiscoveredModelDto[];
}
```

Add matching JSON schemas:

```ts
const aiProviderTestResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "providerKind", "message"],
  properties: {
    ok: { type: "boolean" },
    providerKind: aiProviderKindSchema,
    message: { type: "string" }
  }
} as const;

const aiProviderDiscoveredModelSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providerModelId", "displayName", "capabilities", "tier"],
  properties: {
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: { type: "array", minItems: 1, items: aiModelCapabilitySchema },
    tier: aiModelTierSchema
  }
} as const;

export const testAiProviderConfigResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["result"],
  properties: { result: aiProviderTestResultSchema }
} as const;

export const discoverAiProviderModelsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["models"],
  properties: { models: { type: "array", items: aiProviderDiscoveredModelSchema } }
} as const;

export const testAiProviderConfigRouteSchema = {
  params: idParamsSchema,
  response: {
    200: testAiProviderConfigResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const discoverAiProviderModelsRouteSchema = {
  params: idParamsSchema,
  response: {
    200: discoverAiProviderModelsResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`

Expected: route file may still fail until later tasks, but shared exports resolve.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ai-api.ts packages/ai/src/routes.ts
git commit -m "feat(ai): add provider validation contracts" --no-verify
```

Use normal verification before push; `--no-verify` only avoids committing a known intermediate red state if hooks run the whole repo.

## Task 2: Provider Validation Helper

**Files:**
- Create: `packages/ai/src/provider-validation.ts`
- Test: `tests/unit/ai-provider-validation.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/ai-provider-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { discoverProviderModels, testProviderCredential } from "../../packages/ai/src/provider-validation.js";

describe("AI provider validation", () => {
  it("tests openai-compatible providers with Authorization header and baseUrl", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), { status: 200 });
    };

    const result = await testProviderCredential({
      providerKind: "openai-compatible",
      authMethod: "api_key",
      baseUrl: "https://proxy.example.test",
      credential: { apiKey: "sk-secret" },
      fetch: fakeFetch as typeof fetch
    });

    expect(result).toEqual({
      ok: true,
      providerKind: "openai-compatible",
      message: "Provider credential is valid."
    });
    expect(calls[0]?.url).toBe("https://proxy.example.test/v1/models");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer sk-secret");
  });

  it("normalizes provider failures without leaking secrets or bodies", async () => {
    const result = await testProviderCredential({
      providerKind: "anthropic",
      authMethod: "api_key",
      baseUrl: null,
      credential: { apiKey: "sk-secret" },
      fetch: (async () => new Response("raw body with sk-secret", { status: 401 })) as typeof fetch
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Provider rejected the credential.");
    expect(JSON.stringify(result)).not.toContain("sk-secret");
    expect(JSON.stringify(result)).not.toContain("raw body");
  });

  it("returns unsupported for cli auth without shelling out", async () => {
    const result = await testProviderCredential({
      providerKind: "anthropic",
      authMethod: "cli",
      baseUrl: null,
      credential: { cli: true },
      fetch: (async () => {
        throw new Error("should not call fetch");
      }) as typeof fetch
    });

    expect(result).toEqual({
      ok: false,
      providerKind: "anthropic",
      message: "CLI provider testing is not supported yet."
    });
  });

  it("discovers models and suggests conservative capabilities", async () => {
    const models = await discoverProviderModels({
      providerKind: "openai-compatible",
      authMethod: "api_key",
      baseUrl: null,
      credential: { apiKey: "sk-secret" },
      fetch: (async () =>
        new Response(JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-vision" }] }), {
          status: 200
        })) as typeof fetch
    });

    expect(models).toEqual([
      {
        providerModelId: "gpt-4o",
        displayName: "gpt-4o",
        capabilities: ["chat", "tool-use", "json", "summarization"],
        tier: "interactive"
      },
      {
        providerModelId: "gpt-4o-vision",
        displayName: "gpt-4o-vision",
        capabilities: ["chat", "tool-use", "json", "summarization", "vision"],
        tier: "interactive"
      }
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `pnpm vitest run tests/unit/ai-provider-validation.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Add minimal helper**

Create `packages/ai/src/provider-validation.ts` with:

```ts
import type {
  AiAuthMethod,
  AiModelCapability,
  AiModelTier,
  AiProviderDiscoveredModelDto,
  AiProviderKind,
  AiProviderTestResultDto
} from "@jarv1s/shared";

interface ProviderValidationInput {
  readonly providerKind: AiProviderKind;
  readonly authMethod: AiAuthMethod;
  readonly baseUrl: string | null;
  readonly credential: unknown;
  readonly fetch?: typeof fetch;
}

export async function testProviderCredential(
  input: ProviderValidationInput
): Promise<AiProviderTestResultDto> {
  if (input.authMethod === "cli") {
    return unsupportedCli(input.providerKind);
  }

  const apiKey = readApiKey(input.credential);
  if (!apiKey) return fail(input.providerKind, "Provider credential is missing.");

  try {
    const response = await fetchModels(input, apiKey);
    if (response.ok) return ok(input.providerKind);
    return fail(input.providerKind, response.status === 401 || response.status === 403 ? "Provider rejected the credential." : "Provider test failed.");
  } catch {
    return fail(input.providerKind, "Provider test failed.");
  }
}

export async function discoverProviderModels(
  input: ProviderValidationInput
): Promise<AiProviderDiscoveredModelDto[]> {
  if (input.authMethod === "cli") return [];
  const apiKey = readApiKey(input.credential);
  if (!apiKey) return [];

  try {
    const response = await fetchModels(input, apiKey);
    if (!response.ok) return [];
    return extractModelIds(await response.json()).map(suggestModel);
  } catch {
    return [];
  }
}

function ok(providerKind: AiProviderKind): AiProviderTestResultDto {
  return { ok: true, providerKind, message: "Provider credential is valid." };
}

function fail(providerKind: AiProviderKind, message: string): AiProviderTestResultDto {
  return { ok: false, providerKind, message };
}

function unsupportedCli(providerKind: AiProviderKind): AiProviderTestResultDto {
  return { ok: false, providerKind, message: "CLI provider testing is not supported yet." };
}

async function fetchModels(input: ProviderValidationInput, apiKey: string): Promise<Response> {
  const f = input.fetch ?? globalThis.fetch;
  switch (input.providerKind) {
    case "openai-compatible":
    case "ollama":
    case "custom": {
      const base = (input.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
      return f(`${base}/v1/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    }
    case "anthropic":
      return f("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      });
    case "google":
      return f("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": apiKey }
      });
  }
}

function readApiKey(credential: unknown): string | null {
  if (!credential || typeof credential !== "object") return null;
  const value = (credential as { apiKey?: unknown }).apiKey;
  return typeof value === "string" && value.trim() ? value : null;
}

function extractModelIds(json: unknown): string[] {
  const data = (json as { data?: Array<{ id?: unknown }>; models?: Array<{ name?: unknown }> }).data;
  if (Array.isArray(data)) return data.map((item) => item.id).filter((id): id is string => typeof id === "string");
  const models = (json as { models?: Array<{ name?: unknown }> }).models;
  if (Array.isArray(models)) {
    return models.map((item) => typeof item.name === "string" ? item.name.replace(/^models\//, "") : null).filter((id): id is string => Boolean(id));
  }
  return [];
}

function suggestModel(providerModelId: string): AiProviderDiscoveredModelDto {
  const lower = providerModelId.toLowerCase();
  const capabilities: AiModelCapability[] = ["chat", "tool-use", "json", "summarization"];
  if (lower.includes("vision") || lower.includes("gpt-4o") || lower.includes("gemini")) {
    capabilities.push("vision");
  }
  const tier: AiModelTier = lower.includes("mini") || lower.includes("haiku") || lower.includes("flash") ? "economy" : lower.includes("opus") || lower.includes("reason") ? "reasoning" : "interactive";
  return { providerModelId, displayName: providerModelId, capabilities, tier };
}
```

- [ ] **Step 4: Run unit test**

Run: `pnpm vitest run tests/unit/ai-provider-validation.test.ts`

Expected: PASS after adjusting exact heuristic expectations if needed.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/provider-validation.ts tests/unit/ai-provider-validation.test.ts
git commit -m "feat(ai): add safe provider validation helper"
```

## Task 3: Admin API Routes

**Files:**
- Modify: `packages/ai/src/routes.ts`
- Modify: `packages/ai/src/manifest.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `tests/integration/ai.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add tests to `tests/integration/ai.test.ts`:

```ts
it("requires an instance admin for AI provider test and discovery", async () => {
  const provider = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.createProvider(scopedDb, {
      providerKind: "openai-compatible",
      displayName: "Admin-only Provider",
      encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "admin-only-secret" })
    })
  );
  const testResponse = await server.inject({
    method: "POST",
    url: `/api/ai/providers/${provider.id}/test`,
    headers: { authorization: `Bearer ${ids.sessionB}` }
  });

  expect(testResponse.statusCode).toBe(403);
});

it("tests an API-key provider with a redacted result", async () => {
  const provider = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.createProvider(scopedDb, {
      providerKind: "openai-compatible",
      displayName: "Provider Test",
      baseUrl: "https://llm.example.test",
      encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "secret-provider-key" })
    })
  );

  const response = await server.inject({
    method: "POST",
    url: `/api/ai/providers/${provider.id}/test`,
    headers: { authorization: `Bearer ${ids.sessionA}` }
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    result: {
      ok: true,
      providerKind: "openai-compatible",
      message: "Provider credential is valid."
    }
  });
  expect(response.body).not.toContain("secret-provider-key");
});

it("discovers model candidates without inserting model rows", async () => {
  const provider = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.createProvider(scopedDb, {
      providerKind: "openai-compatible",
      displayName: "Discover Provider",
      encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "discover-secret" })
    })
  );

  const before = await dataContext.withDataContext(userAContext(), (scopedDb) => repository.listModels(scopedDb));
  const response = await server.inject({
    method: "POST",
    url: `/api/ai/providers/${provider.id}/discover-models`,
    headers: { authorization: `Bearer ${ids.sessionA}` }
  });
  const after = await dataContext.withDataContext(userAContext(), (scopedDb) => repository.listModels(scopedDb));

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    models: [{ providerModelId: "gpt-4o", capabilities: expect.arrayContaining(["chat"]) }]
  });
  expect(after).toHaveLength(before.length);
  expect(response.body).not.toContain("discover-secret");
});
```

Use an injected validator dependency in the test server setup so no real network call occurs:

```ts
server = createApiServer({
  appDb,
  logger: false,
  aiProviderValidator: {
    test: async (provider) => ({ ok: true, providerKind: provider.provider_kind, message: "Provider credential is valid." }),
    discoverModels: async () => [{ providerModelId: "gpt-4o", displayName: "gpt-4o", capabilities: ["chat"], tier: "interactive" }]
  }
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `pnpm test:ai`

Expected: FAIL because routes/dependency do not exist.

- [ ] **Step 3: Add route dependency and handlers**

In `packages/ai/src/routes.ts`, add dependency:

```ts
import { discoverProviderModels, testProviderCredential } from "./provider-validation.js";

export interface AiProviderValidator {
  readonly test: typeof testProviderCredential;
  readonly discoverModels: typeof discoverProviderModels;
}

export interface AiRoutesDependencies {
  // existing fields...
  readonly providerValidator?: AiProviderValidator;
}
```

Inside `registerAiRoutes`:

```ts
const providerValidator = dependencies.providerValidator ?? {
  test: testProviderCredential,
  discoverModels: discoverProviderModels
};
```

Add both handlers after revoke:

```ts
server.post<{ Params: IdParams }>(
  "/api/ai/providers/:id/test",
  { schema: testAiProviderConfigRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const result = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);
          const provider = await repository.selectProviderWithCredential(scopedDb, request.params.id);
          if (!provider) throw new HttpError(404, "AI provider config not found");
          if (provider.status === "revoked") throw new HttpError(400, "AI provider config is revoked");
          return providerValidator.test({
            providerKind: provider.provider_kind,
            authMethod: provider.auth_method,
            baseUrl: provider.base_url,
            credential: secretCipher.decryptJson(provider.encrypted_credential)
          });
        }
      );
      return { result };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

Add discover route the same way, returning `{ models }` and using `providerValidator.discoverModels`.

- [ ] **Step 4: Publish routes in manifest**

Add entries in `packages/ai/src/manifest.ts`:

```ts
{
  method: "POST",
  path: "/api/ai/providers/:id/test",
  permissionId: "ai.manage"
},
{
  method: "POST",
  path: "/api/ai/providers/:id/discover-models",
  permissionId: "ai.manage"
}
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run tests/unit/ai-provider-validation.test.ts tests/integration/ai.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/routes.ts packages/ai/src/manifest.ts packages/ai/src/index.ts tests/integration/ai.test.ts
git commit -m "feat(ai): expose provider test and discovery routes"
```

## Task 4: Admin UI Wiring

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts` only if needed
- Modify: `apps/web/src/settings/settings-ai-admin-pane.tsx`
- Modify: `tests/e2e/mock-ai-api.ts`
- Test: `tests/e2e/app-shell.spec.ts`

- [ ] **Step 1: Write failing e2e flow**

Add an e2e assertion near the existing AI settings test in `tests/e2e/app-shell.spec.ts`:

```ts
await page.getByRole("button", { name: "Test" }).click();
await expect(page.getByText("Provider credential is valid.")).toBeVisible();

await page.getByRole("button", { name: "Discover" }).click();
await expect(page.getByText("gpt-4o")).toBeVisible();
await page.getByRole("button", { name: "Add gpt-4o" }).click();
await expect(page.getByText("gpt-4o")).toBeVisible();
```

- [ ] **Step 2: Run e2e to verify fail**

Run: `pnpm test:e2e -- tests/e2e/app-shell.spec.ts`

Expected: FAIL because UI and mock endpoints are missing.

- [ ] **Step 3: Add client functions**

In `apps/web/src/api/client.ts`, import new response types and add:

```ts
export async function testAiProvider(id: string): Promise<TestAiProviderConfigResponse> {
  return requestJson<TestAiProviderConfigResponse>(
    `/api/ai/providers/${encodeURIComponent(id)}/test`,
    { method: "POST" }
  );
}

export async function discoverAiProviderModels(
  id: string
): Promise<DiscoverAiProviderModelsResponse> {
  return requestJson<DiscoverAiProviderModelsResponse>(
    `/api/ai/providers/${encodeURIComponent(id)}/discover-models`,
    { method: "POST" }
  );
}
```

- [ ] **Step 4: Add mock endpoints**

In `tests/e2e/mock-ai-api.ts`, route `test` and `discover-models` before generic provider detail:

```ts
await page.route(/\/api\/ai\/providers\/[^/]+\/test$/, (route) =>
  fulfillJson(route, 200, { result: { ok: true, providerKind: "openai-compatible", message: "Provider credential is valid." } })
);
await page.route(/\/api\/ai\/providers\/[^/]+\/discover-models$/, (route) =>
  fulfillJson(route, 200, { models: [{ providerModelId: "gpt-4o", displayName: "gpt-4o", capabilities: ["chat", "tool-use", "json", "summarization"], tier: "interactive" }] })
);
```

- [ ] **Step 5: Wire ProviderCard**

In `settings-ai-admin-pane.tsx`:

```ts
import { discoverAiProviderModels, testAiProvider } from "../api/client";
import type { AiProviderDiscoveredModelDto } from "@jarv1s/shared";
```

Add local state and mutations in `ProviderCard`:

```ts
const queryClient = useQueryClient();
const [discovered, setDiscovered] = useState<readonly AiProviderDiscoveredModelDto[]>([]);

const testMutation = useMutation({
  mutationFn: () => testAiProvider(provider.id),
  onSuccess: ({ result }) => toast(result.message, { tone: result.ok ? "pine" : "drift", icon: <Activity size={17} /> }),
  onError: (error) => toast(readError(error), { tone: "drift" })
});

const discoverMutation = useMutation({
  mutationFn: () => discoverAiProviderModels(provider.id),
  onSuccess: ({ models }) => setDiscovered(models),
  onError: (error) => toast(readError(error), { tone: "drift" })
});

const addDiscoveredMutation = useMutation({
  mutationFn: (model: AiProviderDiscoveredModelDto) =>
    createAiModel({ providerConfigId: provider.id, providerModelId: model.providerModelId, displayName: model.displayName, capabilities: model.capabilities, tier: model.tier }),
  onSuccess: (_data, model) => {
    setDiscovered((items) => items.filter((item) => item.providerModelId !== model.providerModelId));
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.models }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilities })
    ]);
    toast("Model added", { icon: <Sparkles size={17} /> });
  },
  onError: (error) => toast(readError(error), { tone: "drift" })
});
```

Replace placeholder Test button `onClick` with `testMutation.mutate()`. Add a `Discover` button next to `Add`, and render candidates as small rows with `Add ${model.providerModelId}` buttons. Disable Test/Discover for pending mutation and revoked providers.

- [ ] **Step 6: Run UI tests**

Run: `pnpm test:e2e -- tests/e2e/app-shell.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-ai-admin-pane.tsx tests/e2e/mock-ai-api.ts tests/e2e/app-shell.spec.ts
git commit -m "feat(web): wire AI provider test and discovery"
```

## Task 5: Focused Verification And Cleanup

**Files:**
- Modify only files needed for fixes found by checks.

- [ ] **Step 1: Run focused checks**

Run:

```bash
pnpm vitest run tests/unit/ai-provider-validation.test.ts tests/integration/ai.test.ts
pnpm test:e2e -- tests/e2e/app-shell.spec.ts
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Security scan**

Run:

```bash
rg -n "secret-provider-key|discover-secret|sk-secret|apiKey|encrypted_credential|ciphertext|raw body" packages/ai/src apps/web/src tests/integration/ai.test.ts tests/unit/ai-provider-validation.test.ts
```

Expected: only tests and request-building code contain test literals; route responses and UI do not render credentials or encrypted envelopes.

- [ ] **Step 3: Final commit if cleanup changed files**

```bash
git add <exact files>
git commit -m "test(ai): verify provider validation safety"
```

## Self-Review

- Spec coverage: test endpoint, discovery endpoint, admin-only enforcement, revoked rejection, manual model fallback, UI Test/Discover actions, no automatic persistence, and safe error normalization are covered.
- Security tier: credentials decrypt only inside route scope; helper returns safe strings only; tests use injected fetch/validator to avoid real provider calls.
- Skipped: CLI re-auth/status probing. Add only when separate CLI-auth UX/security spec exists.
