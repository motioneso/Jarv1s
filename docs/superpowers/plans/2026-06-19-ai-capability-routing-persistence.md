# AI Capability Routing Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo override:** This coordinated-build handoff disables those execution skills. After Coordinator approval, execute inline with `superpowers:test-driven-development`.

**Goal:** Persist instance-wide AI capability routing overrides and make runtime AI selection honor valid overrides while falling back safely.

**Architecture:** Reuse `app.instance_settings` with one non-secret JSON key, `ai.capability_routes`, shaped as `{ [capability]: modelId | null }`. Add repository helpers that resolve `{ model, reason }`; keep `selectModelForCapability()` as the existing model-only runtime wrapper so chat, briefings, and module-registry callers pick up manual routing without call-site churn.

**Tech Stack:** Fastify, Kysely, `DataContextDb`, React Query, shared TypeScript API schemas, Vitest integration tests.

---

## File Structure

- Modify `packages/ai/src/repository.ts`: add `AI_CAPABILITY_ROUTES_SETTING_KEY`, route-map read/write helpers, manual-first resolver, and make `selectModelForCapability()` delegate to it.
- Modify `packages/ai/src/routes.ts`: add `GET /api/ai/capability-routes`, `PUT /api/ai/capability-routes/:capability`, validation, admin gate for writes, and use resolver for single-route lookup.
- Modify `packages/ai/src/manifest.ts`: declare the two new routes with existing `ai.view`/`ai.manage` permissions.
- Modify `packages/shared/src/ai-api.ts`: add route-map DTO/request/response types, route reasons, JSON schemas, and route schema exports.
- Modify `apps/web/src/api/client.ts`: add `listAiCapabilityRoutes()` and `putAiCapabilityRoute()`.
- Modify `apps/web/src/api/query-keys.ts`: add `queryKeys.ai.capabilityRoutes`.
- Modify `apps/web/src/settings/settings-ai-admin-pane.tsx`: replace placeholder toast with immediate mutation, add Automatic option, disable incompatible models, invalidate route queries.
- Modify `tests/integration/ai.test.ts`: add focused integration coverage for manual route, fallback, clearing, non-admin write rejection, and no credential exposure.
- Modify `tests/e2e/mock-ai-api.ts`: mock new route-map endpoints if existing settings e2e touches AI admin UI.

No migration. `instance_settings` already exists, has admin-gated writes, and is already used by AI admin settings.

---

### Task 1: Backend Resolver + Persistence

**Files:**

- Modify: `packages/ai/src/repository.ts`
- Test: `tests/integration/ai.test.ts`

- [ ] **Step 1: Write failing repository integration tests**

Add tests inside `describe("AI capability tier routing", ...)` after the existing tier tests:

```ts
it("uses a valid manual capability route before automatic tier selection", async () => {
  const autoRes = await server.inject({
    method: "POST",
    url: "/api/ai/models",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: {
      providerConfigId: sharedProviderId,
      providerModelId: "manual-json-auto",
      displayName: "Manual JSON Auto",
      capabilities: ["json"],
      tier: "interactive"
    }
  });
  const manualRes = await server.inject({
    method: "POST",
    url: "/api/ai/models",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: {
      providerConfigId: sharedProviderId,
      providerModelId: "manual-json-selected",
      displayName: "Manual JSON Selected",
      capabilities: ["json"],
      tier: "reasoning"
    }
  });
  const manualId = manualRes.json<{ model: { id: string } }>().model.id;

  await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.setCapabilityRoute(scopedDb, {
      capability: "json",
      modelId: manualId,
      actorUserId: ids.userA
    })
  );

  const resolved = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.resolveModelForCapability(scopedDb, "json", "interactive")
  );
  const selected = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.selectModelForCapability(scopedDb, "json", "interactive")
  );

  expect(autoRes.statusCode).toBe(201);
  expect(manualRes.statusCode).toBe(201);
  expect(resolved.reason).toBe("manual-route");
  expect(resolved.model?.id).toBe(manualId);
  expect(selected?.id).toBe(manualId);
});

it("falls back when a manual capability route becomes incompatible", async () => {
  const compatibleRes = await server.inject({
    method: "POST",
    url: "/api/ai/models",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: {
      providerConfigId: sharedProviderId,
      providerModelId: "manual-vision-compatible",
      displayName: "Manual Vision Compatible",
      capabilities: ["vision"],
      tier: "interactive"
    }
  });
  const staleRes = await server.inject({
    method: "POST",
    url: "/api/ai/models",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: {
      providerConfigId: sharedProviderId,
      providerModelId: "manual-vision-stale",
      displayName: "Manual Vision Stale",
      capabilities: ["vision"],
      tier: "reasoning"
    }
  });
  const compatibleId = compatibleRes.json<{ model: { id: string } }>().model.id;
  const staleId = staleRes.json<{ model: { id: string } }>().model.id;

  await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.setCapabilityRoute(scopedDb, {
      capability: "vision",
      modelId: staleId,
      actorUserId: ids.userA
    })
  );
  await server.inject({
    method: "PATCH",
    url: `/api/ai/models/${staleId}`,
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: { status: "disabled" }
  });

  const resolved = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.resolveModelForCapability(scopedDb, "vision", "interactive")
  );

  expect(compatibleRes.statusCode).toBe(201);
  expect(staleRes.statusCode).toBe(201);
  expect(resolved.reason).toBe("manual-route-unavailable-fallback");
  expect(resolved.model?.id).toBe(compatibleId);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_253 pnpm test:ai -- --runInBand
```

Expected: compile/test failure because `setCapabilityRoute` and `resolveModelForCapability` do not exist.

- [ ] **Step 3: Add minimal repository implementation**

In `packages/ai/src/repository.ts`, update the shared import and add types/constants near `ChatModelOverrideSettings`:

```ts
import type { AiCapabilityRouteReason, AiModelCapability } from "@jarv1s/shared";

export const AI_CAPABILITY_ROUTES_SETTING_KEY = "ai.capability_routes";

export type AiCapabilityRouteMap = Partial<Record<AiModelCapability, string | null>>;

export interface SetAiCapabilityRouteInput {
  readonly capability: AiModelCapability;
  readonly modelId: string | null;
  readonly actorUserId: string;
}

export interface AiCapabilityRouteResolution {
  readonly model: AiConfiguredModelSafeRow | null;
  readonly reason: AiCapabilityRouteReason;
}
```

Change `selectModelForCapability()` to:

```ts
  async selectModelForCapability(
    scopedDb: DataContextDb,
    capability: AiModelCapability,
    tier: AiModelTier = "interactive"
  ): Promise<AiConfiguredModelSafeRow | undefined> {
    const resolved = await this.resolveModelForCapability(scopedDb, capability, tier);
    return resolved.model ?? undefined;
  }
```

Add these methods before `selectChatModelForUser()`:

```ts
  async listCapabilityRoutes(scopedDb: DataContextDb): Promise<AiCapabilityRouteMap> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", AI_CAPABILITY_ROUTES_SETTING_KEY)
      .executeTakeFirst();
    return parseCapabilityRouteMap(row?.value);
  }

  async setCapabilityRoute(
    scopedDb: DataContextDb,
    input: SetAiCapabilityRouteInput
  ): Promise<AiCapabilityRouteMap> {
    assertDataContextDb(scopedDb);
    const current = await this.listCapabilityRoutes(scopedDb);
    const next = { ...current, [input.capability]: input.modelId };
    const now = new Date();

    await scopedDb.db
      .insertInto("app.instance_settings")
      .values({
        key: AI_CAPABILITY_ROUTES_SETTING_KEY,
        value: next,
        updated_by_user_id: input.actorUserId,
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          value: next,
          updated_by_user_id: input.actorUserId,
          updated_at: now
        })
      )
      .execute();

    return next;
  }

  async resolveModelForCapability(
    scopedDb: DataContextDb,
    capability: AiModelCapability,
    tier: AiModelTier = "interactive"
  ): Promise<AiCapabilityRouteResolution> {
    assertDataContextDb(scopedDb);
    const routes = await this.listCapabilityRoutes(scopedDb);
    const manualModelId = routes[capability] ?? null;

    if (manualModelId) {
      const manualModel = await this.safeModelQuery(scopedDb)
        .where("models.id", "=", manualModelId)
        .where("models.status", "=", "active")
        .where("providers.status", "=", "active")
        .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
        .executeTakeFirst();

      if (manualModel) {
        return { model: manualModel, reason: "manual-route" };
      }
    }

    const automatic = await this.selectAutomaticModelForCapability(scopedDb, capability, tier);
    return {
      model: automatic ?? null,
      reason: manualModelId
        ? "manual-route-unavailable-fallback"
        : automatic
          ? "matched-active-model"
          : "no-active-model"
    };
  }
```

Extract the old tier-ladder body into:

```ts
  private async selectAutomaticModelForCapability(
    scopedDb: DataContextDb,
    capability: AiModelCapability,
    tier: AiModelTier
  ): Promise<AiConfiguredModelSafeRow | undefined> {
    const TIER_LADDER: AiModelTier[] = ["economy", "interactive", "reasoning"];
    const startIndex = TIER_LADDER.indexOf(tier);
    const tiersToTry = TIER_LADDER.slice(startIndex);

    for (const t of tiersToTry) {
      const model = await this.safeModelQuery(scopedDb)
        .where("models.status", "=", "active")
        .where("providers.status", "=", "active")
        .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
        .where("models.tier", "=", t)
        .orderBy("models.created_at", "desc")
        .orderBy("models.id", "desc")
        .executeTakeFirst();

      if (model) return model;
    }

    return this.safeModelQuery(scopedDb)
      .where("models.status", "=", "active")
      .where("providers.status", "=", "active")
      .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
      .orderBy("models.created_at", "desc")
      .orderBy("models.id", "desc")
      .executeTakeFirst();
  }
```

Add parser at bottom:

```ts
const AI_MODEL_CAPABILITIES = new Set<AiModelCapability>([
  "chat",
  "tool-use",
  "json",
  "vision",
  "summarization"
]);

function parseCapabilityRouteMap(value: unknown): AiCapabilityRouteMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const routes: AiCapabilityRouteMap = {};
  for (const [capability, modelId] of Object.entries(value)) {
    if (!AI_MODEL_CAPABILITIES.has(capability as AiModelCapability)) continue;
    if (modelId === null || typeof modelId === "string") {
      routes[capability as AiModelCapability] = modelId;
    }
  }
  return routes;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_253 pnpm test:ai -- --runInBand
```

Expected: new repository tests pass or only route/API tests fail because they are not implemented yet.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/repository.ts tests/integration/ai.test.ts
git commit -m "feat(ai): persist capability route resolver" -m "Co-Authored-By: Codex <codex@openai.com>"
```

---

### Task 2: API Contracts + Routes

**Files:**

- Modify: `packages/shared/src/ai-api.ts`
- Modify: `packages/ai/src/routes.ts`
- Modify: `packages/ai/src/manifest.ts`
- Test: `tests/integration/ai.test.ts`

- [ ] **Step 1: Write failing route tests**

Add tests inside `describe("AI capability tier routing", ...)`:

```ts
it("lets an admin set, read, use, and clear a manual capability route", async () => {
  const modelRes = await server.inject({
    method: "POST",
    url: "/api/ai/models",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: {
      providerConfigId: sharedProviderId,
      providerModelId: "route-api-chat",
      displayName: "Route API Chat",
      capabilities: ["chat"],
      tier: "interactive"
    }
  });
  const modelId = modelRes.json<{ model: { id: string } }>().model.id;

  const putRes = await server.inject({
    method: "PUT",
    url: "/api/ai/capability-routes/chat",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: { modelId }
  });
  const listRes = await server.inject({
    method: "GET",
    url: "/api/ai/capability-routes",
    headers: { authorization: `Bearer ${ids.sessionA}` }
  });
  const lookupRes = await server.inject({
    method: "GET",
    url: "/api/ai/capability-route/chat",
    headers: { authorization: `Bearer ${ids.sessionA}` }
  });
  const clearRes = await server.inject({
    method: "PUT",
    url: "/api/ai/capability-routes/chat",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: { modelId: null }
  });

  expect(modelRes.statusCode).toBe(201);
  expect(putRes.statusCode).toBe(200);
  expect(putRes.json()).toMatchObject({ route: { capability: "chat", modelId } });
  expect(listRes.json()).toMatchObject({ routes: { chat: modelId } });
  expect(lookupRes.json()).toMatchObject({
    route: { capability: "chat", reason: "manual-route", model: { id: modelId } }
  });
  expect(lookupRes.body).not.toContain("encrypted_credential");
  expect(clearRes.json()).toMatchObject({ route: { capability: "chat", modelId: null } });
});

it("rejects non-admin capability route writes", async () => {
  const response = await server.inject({
    method: "PUT",
    url: "/api/ai/capability-routes/chat",
    headers: { authorization: `Bearer ${ids.sessionB}` },
    payload: { modelId: null }
  });

  expect(response.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_253 pnpm test:ai -- --runInBand
```

Expected: route/schema compile or 404 failures.

- [ ] **Step 3: Add shared contract**

In `packages/shared/src/ai-api.ts`, change:

```ts
export type AiCapabilityRouteReason =
  | "manual-route"
  | "manual-route-unavailable-fallback"
  | "matched-active-model"
  | "no-active-model";
```

Add:

```ts
export type AiCapabilityRouteMapDto = Partial<Record<AiModelCapability, string | null>>;

export interface AiCapabilityRouteSettingDto {
  readonly capability: AiModelCapability;
  readonly modelId: string | null;
}

export interface ListAiCapabilityRoutesResponse {
  readonly routes: AiCapabilityRouteMapDto;
}

export interface PutAiCapabilityRouteRequest {
  readonly modelId: string | null;
}

export interface PutAiCapabilityRouteResponse {
  readonly route: AiCapabilityRouteSettingDto;
}
```

Update route schema reason enum:

```ts
reason: {
  type: "string",
  enum: [
    "manual-route",
    "manual-route-unavailable-fallback",
    "matched-active-model",
    "no-active-model"
  ]
}
```

Add schemas:

```ts
const aiCapabilityRouteMapSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    chat: { type: ["string", "null"] },
    "tool-use": { type: ["string", "null"] },
    json: { type: ["string", "null"] },
    vision: { type: ["string", "null"] },
    summarization: { type: ["string", "null"] }
  }
} as const;

const aiCapabilityRouteSettingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["capability", "modelId"],
  properties: {
    capability: aiModelCapabilitySchema,
    modelId: { type: ["string", "null"] }
  }
} as const;

export const putAiCapabilityRouteRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modelId"],
  properties: {
    modelId: { type: ["string", "null"] }
  }
} as const;

export const listAiCapabilityRoutesResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["routes"],
  properties: { routes: aiCapabilityRouteMapSchema }
} as const;

export const putAiCapabilityRouteResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["route"],
  properties: { route: aiCapabilityRouteSettingSchema }
} as const;
```

Add route schemas:

```ts
export const listAiCapabilityRoutesRouteSchema = {
  response: {
    200: listAiCapabilityRoutesResponseSchema,
    401: errorResponseSchema,
    500: errorResponseSchema
  }
} as const;

export const putAiCapabilityRouteRouteSchema = {
  params: aiCapabilityParamsSchema,
  body: putAiCapabilityRouteRequestSchema,
  response: {
    200: putAiCapabilityRouteResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    500: errorResponseSchema
  }
} as const;
```

- [ ] **Step 4: Add Fastify routes**

In `packages/ai/src/routes.ts`, import new schemas/types and add after single-route lookup:

```ts
server.get(
  "/api/ai/capability-routes",
  { schema: listAiCapabilityRoutesRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const routes = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
        repository.listCapabilityRoutes(scopedDb)
      );
      return { routes };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);

server.put<{ Params: CapabilityParams }>(
  "/api/ai/capability-routes/:capability",
  { schema: putAiCapabilityRouteRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const capability = parseCapability(request.params.capability);
      const body = parsePutCapabilityRouteBody(request.body);
      await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
        await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);
        if (body.modelId !== null) {
          const models = await repository.listModels(scopedDb);
          const valid = models.some(
            (model) =>
              model.id === body.modelId &&
              model.status === "active" &&
              model.provider_status === "active" &&
              model.capabilities.includes(capability)
          );
          if (!valid) {
            throw new HttpError(400, "modelId must reference an active compatible model");
          }
        }
        await repository.setCapabilityRoute(scopedDb, {
          capability,
          modelId: body.modelId,
          actorUserId: accessContext.actorUserId
        });
      });
      return { route: { capability, modelId: body.modelId } };
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

Change existing single-route lookup to use:

```ts
const route = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
  repository.resolveModelForCapability(scopedDb, capability)
);

return {
  route: {
    capability,
    available: Boolean(route.model),
    reason: route.reason,
    model: route.model ? serializeModel(route.model) : null
  }
};
```

Add parser near chat override parser:

```ts
function parsePutCapabilityRouteBody(body: unknown): PutAiCapabilityRouteRequest {
  const value = requireObject(body);
  const modelId = value.modelId;
  if (modelId !== null && typeof modelId !== "string") {
    throw new HttpError(400, "modelId must be a string or null");
  }
  return { modelId };
}
```

- [ ] **Step 5: Add manifest entries**

In `packages/ai/src/manifest.ts`, import new schemas and insert after `/api/ai/capability-route/:capability`:

```ts
    {
      method: "GET",
      path: "/api/ai/capability-routes",
      responseSchema: listAiCapabilityRoutesResponseSchema,
      permissionId: "ai.view"
    },
    {
      method: "PUT",
      path: "/api/ai/capability-routes/:capability",
      requestSchema: putAiCapabilityRouteRequestSchema,
      responseSchema: putAiCapabilityRouteResponseSchema,
      permissionId: "ai.manage"
    },
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_253 pnpm test:ai -- --runInBand
pnpm typecheck
```

Expected: AI tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ai-api.ts packages/ai/src/routes.ts packages/ai/src/manifest.ts tests/integration/ai.test.ts
git commit -m "feat(ai): expose capability route overrides" -m "Co-Authored-By: Codex <codex@openai.com>"
```

---

### Task 3: Admin UI Wiring

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-ai-admin-pane.tsx`
- Modify: `tests/e2e/mock-ai-api.ts`

- [ ] **Step 1: Add web API helpers**

In `apps/web/src/api/client.ts`, import:

```ts
  ListAiCapabilityRoutesResponse,
  PutAiCapabilityRouteRequest,
  PutAiCapabilityRouteResponse,
```

Add after `lookupAiCapabilityRoute()`:

```ts
export async function listAiCapabilityRoutes(): Promise<ListAiCapabilityRoutesResponse> {
  return requestJson<ListAiCapabilityRoutesResponse>("/api/ai/capability-routes");
}

export async function putAiCapabilityRoute(
  capability: AiModelCapability,
  input: PutAiCapabilityRouteRequest
): Promise<PutAiCapabilityRouteResponse> {
  return requestJson<PutAiCapabilityRouteResponse>(
    `/api/ai/capability-routes/${encodeURIComponent(capability)}`,
    { method: "PUT", body: input }
  );
}
```

In `apps/web/src/api/query-keys.ts`, add:

```ts
    capabilityRoutes: ["ai", "capability-routes"] as const,
```

- [ ] **Step 2: Wire RouterRow mutation**

In `apps/web/src/settings/settings-ai-admin-pane.tsx`, import the new helpers:

```ts
  listAiCapabilityRoutes,
  putAiCapabilityRoute,
```

In `AiProvidersPane`, add:

```ts
const routesQuery = useQuery({
  queryKey: queryKeys.ai.capabilityRoutes,
  queryFn: listAiCapabilityRoutes,
  retry: false
});
```

Update `invalidate()` to include:

```ts
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilityRoutes }),
```

Pass routes to rows:

```tsx
<RouterRow
  key={capability.k}
  capability={capability}
  models={models}
  configuredModelId={routesQuery.data?.routes[capability.k] ?? null}
/>
```

Change `RouterRow` props:

```ts
  readonly configuredModelId: string | null;
```

Inside `RouterRow`, add:

```ts
  const queryClient = useQueryClient();
  const routeMutation = useMutation({
    mutationFn: (modelId: string | null) =>
      putAiCapabilityRoute(props.capability.k, { modelId }),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilityRoutes }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capability(props.capability.k) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilities })
      ]);
      toast("Route updated", { icon: <Sparkles size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const effectiveId = routeQuery.data?.route?.model?.id ?? "";
  const selectedId =
    props.configuredModelId && props.models.some((m) => m.id === props.configuredModelId)
      ? props.configuredModelId
      : "automatic";
```

Replace the `<Select>` with:

```tsx
<Select
  value={selectedId}
  aria-label={`Model for ${props.capability.name}`}
  disabled={routeMutation.isPending}
  onChange={(e) => routeMutation.mutate(e.target.value === "automatic" ? null : e.target.value)}
>
  <option value="automatic">
    Automatic{effectiveId ? ` · ${routeQuery.data?.route.model?.providerModelId}` : ""}
  </option>
  {props.models.map((m) => {
    const compatible =
      m.status === "active" &&
      m.providerStatus === "active" &&
      m.capabilities.includes(props.capability.k);
    return (
      <option key={m.id} value={m.id} disabled={!compatible}>
        {m.providerModelId} · {TIERS[m.tier].label}
      </option>
    );
  })}
</Select>
```

Keep the `No added model can do this yet` branch only when `props.models.length === 0`; otherwise Automatic remains available.

Remove the routing `NotWired` block and remove "routing dropdowns" from the `BACKEND-TODO` comment.

- [ ] **Step 3: Update e2e mock only if needed**

If `tests/e2e` hits Settings AI admin, update `tests/e2e/mock-ai-api.ts` with:

```ts
await page.route("**/api/ai/capability-routes", (route) => fulfillJson(route, 200, { routes: {} }));
await page.route(/\/api\/ai\/capability-routes\/[^/]+$/, (route) =>
  fulfillJson(route, 200, { route: { capability: "chat", modelId: null } })
);
```

- [ ] **Step 4: Run web checks**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-ai-admin-pane.tsx tests/e2e/mock-ai-api.ts
git commit -m "feat(web): persist AI capability routing choices" -m "Co-Authored-By: Codex <codex@openai.com>"
```

---

### Task 4: Final Gate + Closeout Prep

**Files:**

- No implementation edits expected.

- [ ] **Step 1: Create isolated DB if absent**

Run:

```bash
docker exec jarv1s-postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'jarv1s_253'" | grep -q 1 || docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE jarv1s_253;"
```

- [ ] **Step 2: Run focused and broad gates**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_253 pnpm test:ai -- --runInBand
pnpm format:check
pnpm lint
pnpm check:file-size
pnpm typecheck
JARVIS_PGDATABASE=jarv1s_253 pnpm verify:foundation
```

If `verify:foundation` fails with `tuple concurrently updated`, retry once with same `JARVIS_PGDATABASE`.

- [ ] **Step 3: Inspect diff for privacy**

Run:

```bash
rg "encrypted_credential|credentialPayload|apiKey|secret" packages/ai/src packages/shared/src apps/web/src/settings tests/integration/ai.test.ts
git diff --stat
git diff --check
```

Expected: no response serialization of secret material; only existing credential input/encryption paths mention secrets.

- [ ] **Step 4: Use coordinated-wrap-up**

Read `/home/ben/Jarv1s/.claude/skills/coordinated-wrap-up/SKILL.md`, follow it exactly, and report PR + evidence to `Coordinator`.

---

## Self-Review

- Spec coverage: manual route storage, read/write API, runtime resolver, dropdown persistence, stale fallback, admin-only writes, provider-agnostic model IDs, and credential privacy are covered.
- Skipped dedicated table/migration: `instance_settings` is already used for AI admin settings and avoids migration-number coordination.
- Runtime callers: unchanged `selectModelForCapability()` call sites in chat, briefings, and module-registry inherit manual routing via repository wrapper.
- Risk: UI manual verification still required after backend/web checks because dropdown persistence is visual workflow.
