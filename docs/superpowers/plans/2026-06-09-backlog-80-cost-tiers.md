# Capability Router Cost Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `tier` field (`"reasoning" | "interactive" | "economy"`) to the AI capability router so background jobs can request the cheapest adequate configured model while interactive chat uses the user's full model.

**Architecture:** Tier is stored on `ai_configured_models` as a DB column (default `"interactive"`). `selectModelForCapability` accepts an optional tier parameter and walks an economy→interactive→reasoning→any fallback ladder. The briefings background job calls `selectModelForCapability("summarization", "economy")` and records the selected model in run metadata, proving end-to-end tier routing.

**Tech Stack:** Kysely (DB queries), Postgres (migration), Fastify (REST routes), Vitest (integration tests), TypeScript.

---

## File Map

| File                                     | Change                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai/sql/00NN_ai_model_tier.sql` | **Create** — migration adding `tier` column                                                                                                                 |
| `packages/db/src/types.ts`               | **Modify** — add `AiModelTier`, update `AiConfiguredModelsTable`                                                                                            |
| `packages/shared/src/ai-api.ts`          | **Modify** — add `AiModelTier` type + schema, update DTOs and JSON schemas                                                                                  |
| `packages/ai/src/repository.ts`          | **Modify** — add `tier` to row/input interfaces, implement tier fallback in `selectModelForCapability`, update `safeModelQuery`/`createModel`/`updateModel` |
| `packages/ai/src/routes.ts`              | **Modify** — update `serializeModel`, `parseCreateModelBody`, `parseUpdateModelBody` to handle `tier`                                                       |
| `packages/briefings/src/repository.ts`   | **Modify** — add AI model lookup with economy tier to `generateSummary`                                                                                     |
| `tests/integration/ai.test.ts`           | **Modify** — add tier-aware routing tests                                                                                                                   |
| `tests/integration/briefings.test.ts`    | **Modify** — add economy-tier model lookup assertion                                                                                                        |

---

## Task 1: Migration + DB Types

Add the `tier` column to `ai_configured_models` and update the Kysely table interface.

**Files:**

- Create: `packages/ai/sql/00NN_ai_model_tier.sql`
- Modify: `packages/db/src/types.ts`

- [ ] **Step 1: Write the migration file**

Create `packages/ai/sql/00NN_ai_model_tier.sql`:

```sql
ALTER TABLE app.ai_configured_models
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'interactive'
  CHECK (tier IN ('reasoning', 'interactive', 'economy'));
```

> Note: The coordinator assigns the actual migration number (replacing `00NN`) at merge time. Do NOT rename this file; leave it as `00NN_ai_model_tier.sql`.

- [ ] **Step 2: Add `AiModelTier` type and update `AiConfiguredModelsTable` in `packages/db/src/types.ts`**

Add after line 150 (after `export type AiModelStatus = "active" | "disabled";`):

```typescript
export type AiModelTier = "reasoning" | "interactive" | "economy";
```

Add `tier` field to `AiConfiguredModelsTable` interface (after `status: AiModelStatus;`):

```typescript
export interface AiConfiguredModelsTable {
  id: string;
  provider_config_id: string;
  owner_user_id: string;
  provider_model_id: string;
  display_name: string;
  capabilities: TextArrayColumn;
  status: AiModelStatus;
  tier: AiModelTier;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}
```

- [ ] **Step 3: Run migration to confirm it applies cleanly**

```bash
pnpm db:up && pnpm db:migrate
```

Expected: migration applies without error. Run a second time to confirm idempotence (`IF NOT EXISTS` makes it safe to re-apply).

- [ ] **Step 4: Typecheck to verify the DB types compile**

```bash
pnpm typecheck
```

Expected: 0 errors (or only errors from places that reference `tier` on `AiConfiguredModelSafeRow` which hasn't been updated yet — those are acceptable at this stage).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/sql/00NN_ai_model_tier.sql packages/db/src/types.ts
git commit -m "$(cat <<'EOF'
feat(ai): add tier column to ai_configured_models + DB type

Adds AiModelTier ('reasoning' | 'interactive' | 'economy') to the
Kysely table interface and the SQL migration. Default 'interactive'
preserves backward compat for all existing rows.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Shared Contract Types

Add `AiModelTier` to the shared API contract layer (DTOs, JSON schemas, request/response shapes).

**Files:**

- Modify: `packages/shared/src/ai-api.ts`

- [ ] **Step 1: Add `AiModelTier` type and schema after existing `AiModelStatus` declarations**

In `packages/shared/src/ai-api.ts`, add after `export type AiModelStatus = "active" | "disabled";` (line 4):

```typescript
export type AiModelTier = "reasoning" | "interactive" | "economy";
```

- [ ] **Step 2: Add `tier` to `AiConfiguredModelDto`**

Update `AiConfiguredModelDto` interface (currently ends at `updatedAt`):

```typescript
export interface AiConfiguredModelDto {
  readonly id: string;
  readonly providerConfigId: string;
  readonly providerKind: AiProviderKind;
  readonly providerDisplayName: string;
  readonly providerStatus: AiProviderStatus;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly AiModelCapability[];
  readonly status: AiModelStatus;
  readonly tier: AiModelTier;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

- [ ] **Step 3: Add `tier` to `CreateAiConfiguredModelRequest` and `UpdateAiConfiguredModelRequest`**

```typescript
export interface CreateAiConfiguredModelRequest {
  readonly providerConfigId: string;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
  readonly tier?: AiModelTier;
}

export interface UpdateAiConfiguredModelRequest {
  readonly providerModelId?: string;
  readonly displayName?: string;
  readonly capabilities?: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
  readonly tier?: AiModelTier;
}
```

- [ ] **Step 4: Add `aiModelTierSchema` constant and add it to the `aiConfiguredModelSchema`**

Add `aiModelTierSchema` after `aiModelStatusSchema` (~line 224):

```typescript
export const aiModelTierSchema = {
  type: "string",
  enum: ["reasoning", "interactive", "economy"]
} as const;
```

Update `aiConfiguredModelSchema` to add `tier` as required:

```typescript
const aiConfiguredModelSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "providerConfigId",
    "providerKind",
    "providerDisplayName",
    "providerStatus",
    "providerModelId",
    "displayName",
    "capabilities",
    "status",
    "tier",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    providerConfigId: { type: "string" },
    providerKind: aiProviderKindSchema,
    providerDisplayName: { type: "string" },
    providerStatus: aiProviderStatusSchema,
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: { type: "array", items: aiModelCapabilitySchema },
    status: aiModelStatusSchema,
    tier: aiModelTierSchema,
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;
```

- [ ] **Step 5: Add `tier` to the create and update model request schemas**

Update `createAiConfiguredModelRequestSchema` (add `tier` to properties, keep existing required fields):

```typescript
export const createAiConfiguredModelRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providerConfigId", "providerModelId", "displayName", "capabilities"],
  properties: {
    providerConfigId: { type: "string" },
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: {
      type: "array",
      minItems: 1,
      items: aiModelCapabilitySchema
    },
    status: aiModelStatusSchema,
    tier: aiModelTierSchema
  }
} as const;
```

Update `updateAiConfiguredModelRequestSchema` (add `tier` to properties):

```typescript
export const updateAiConfiguredModelRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    providerModelId: { type: "string" },
    displayName: { type: "string" },
    capabilities: {
      type: "array",
      minItems: 1,
      items: aiModelCapabilitySchema
    },
    status: aiModelStatusSchema,
    tier: aiModelTierSchema
  }
} as const;
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors in the shared package. The ai package may have errors until Task 3 updates the repository.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ai-api.ts
git commit -m "$(cat <<'EOF'
feat(shared): add AiModelTier type and tier field to model DTOs/schemas

Adds tier ('reasoning' | 'interactive' | 'economy') to AiConfiguredModelDto
and create/update request shapes. aiModelTierSchema enables Fastify
schema validation. tier is optional on create/update (defaults to
'interactive' in the repository layer).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: AI Repository Tier Support

Update `AiConfiguredModelSafeRow`, input interfaces, `safeModelQuery`, `createModel`, `updateModel`, and implement the tier fallback ladder in `selectModelForCapability`.

**Files:**

- Modify: `packages/ai/src/repository.ts`

- [ ] **Step 1: Import `AiModelTier` from `@jarv1s/db` and add it to `AiConfiguredModelSafeRow`**

In `packages/ai/src/repository.ts`, update the import from `@jarv1s/db` to include `AiModelTier`:

```typescript
import {
  assertDataContextDb,
  type AiAssistantActionRequest,
  type AiAssistantActionRisk,
  type AiAssistantActionStatus,
  type AiAuthMethod,
  type AiConfiguredModelsTable,
  type AiModelStatus,
  type AiModelTier,
  type AiProviderConfigsTable,
  type AiProviderKind,
  type AiProviderStatus,
  type DataContextDb
} from "@jarv1s/db";
```

Add `tier` to `AiConfiguredModelSafeRow`:

```typescript
export interface AiConfiguredModelSafeRow {
  readonly id: string;
  readonly provider_config_id: string;
  readonly owner_user_id: string;
  readonly provider_kind: AiProviderKind;
  readonly provider_display_name: string;
  readonly provider_status: AiProviderStatus;
  readonly provider_model_id: string;
  readonly display_name: string;
  readonly capabilities: string[];
  readonly status: AiModelStatus;
  readonly tier: AiModelTier;
  readonly created_at: Date;
  readonly updated_at: Date;
}
```

- [ ] **Step 2: Add `tier` to `CreateAiModelInput` and `UpdateAiModelInput`**

```typescript
export interface CreateAiModelInput {
  readonly providerConfigId: string;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
  readonly tier?: AiModelTier;
}

export interface UpdateAiModelInput {
  readonly providerModelId?: string;
  readonly displayName?: string;
  readonly capabilities?: readonly AiModelCapability[];
  readonly status?: AiModelStatus;
  readonly tier?: AiModelTier;
}
```

- [ ] **Step 3: Update `safeModelQuery` to select `tier`**

In the `safeModelQuery` method, add `"models.tier as tier"` to the select list:

```typescript
private safeModelQuery(scopedDb: DataContextDb) {
  return scopedDb.db
    .selectFrom("app.ai_configured_models as models")
    .innerJoin(
      "app.ai_provider_configs as providers",
      "providers.id",
      "models.provider_config_id"
    )
    .select([
      "models.id as id",
      "models.provider_config_id as provider_config_id",
      "models.owner_user_id as owner_user_id",
      "providers.provider_kind as provider_kind",
      "providers.display_name as provider_display_name",
      "providers.status as provider_status",
      "models.provider_model_id as provider_model_id",
      "models.display_name as display_name",
      "models.capabilities as capabilities",
      "models.status as status",
      "models.tier as tier",
      "models.created_at as created_at",
      "models.updated_at as updated_at"
    ])
    .orderBy("models.created_at", "desc")
    .orderBy("models.id");
}
```

- [ ] **Step 4: Update `createModel` to persist `tier`**

In the `createModel` method, add `tier` to the `.values(...)` object (after `status`):

```typescript
await scopedDb.db.insertInto("app.ai_configured_models").values({
  id: randomUUID(),
  provider_config_id: input.providerConfigId,
  owner_user_id: sql<string>`app.current_actor_user_id()`,
  provider_model_id: input.providerModelId,
  display_name: input.displayName,
  capabilities: [...input.capabilities],
  status: input.status ?? "active",
  tier: input.tier ?? "interactive",
  created_at: now,
  updated_at: now
});
```

- [ ] **Step 5: Update `updateModel` to handle `tier`**

In the `updateModel` method, add a `tier` conditional block after the `status` block:

```typescript
if (input.tier !== undefined) {
  updates.tier = input.tier;
}
```

The `updates` object type is `Updateable<AiConfiguredModelsTable>` — Kysely will accept `tier` since we added it to the table interface in Task 1.

- [ ] **Step 6: Implement tier fallback in `selectModelForCapability`**

Replace the existing `selectModelForCapability` method with:

```typescript
async selectModelForCapability(
  scopedDb: DataContextDb,
  capability: AiModelCapability,
  tier: AiModelTier = "interactive"
): Promise<AiConfiguredModelSafeRow | undefined> {
  assertDataContextDb(scopedDb);

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

  // Final fallback: any active model matching the capability (single-model setups)
  return this.safeModelQuery(scopedDb)
    .where("models.status", "=", "active")
    .where("providers.status", "=", "active")
    .where(sql<boolean>`${capability} = any(${sql.ref("models.capabilities")})`)
    .orderBy("models.created_at", "desc")
    .orderBy("models.id", "desc")
    .executeTakeFirst();
}
```

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add packages/ai/src/repository.ts
git commit -m "$(cat <<'EOF'
feat(ai): tier-aware selectModelForCapability with fallback ladder

Adds tier to AiConfiguredModelSafeRow, CreateAiModelInput, UpdateAiModelInput.
selectModelForCapability now accepts optional tier (default 'interactive') and
walks economy→interactive→reasoning→any fallback. Single-model setups
are unaffected — the final any-tier query returns the only model.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: AI Routes Update

Update the route layer to serialize `tier` in model DTOs and pass `tier` from create/update requests through to the repository.

**Files:**

- Modify: `packages/ai/src/routes.ts`

- [ ] **Step 1: Import `AiModelTier` in routes**

In `packages/ai/src/routes.ts`, add `AiModelTier` to the existing import from `@jarv1s/shared`:

Find the import block that includes `AiModelCapability` and `AiModelStatus` and add `AiModelTier`:

```typescript
import type {
  // ... existing imports ...
  AiModelTier
  // ...
} from "@jarv1s/shared";
```

(Check the exact existing import list in routes.ts and add `AiModelTier` to it.)

- [ ] **Step 2: Update `serializeModel` to include `tier`**

In the `serializeModel` function (around line 602), add `tier`:

```typescript
function serializeModel(model: AiConfiguredModelSafeRow): AiConfiguredModelDto {
  return {
    id: model.id,
    providerConfigId: model.provider_config_id,
    providerKind: model.provider_kind,
    providerDisplayName: model.provider_display_name,
    providerStatus: model.provider_status,
    providerModelId: model.provider_model_id,
    displayName: model.display_name,
    capabilities: model.capabilities.map(parseCapability),
    status: model.status,
    tier: model.tier,
    createdAt: serializeDate(model.created_at),
    updatedAt: serializeDate(model.updated_at)
  };
}
```

- [ ] **Step 3: Add `optionalModelTier` helper and update `parseCreateModelBody` / `parseUpdateModelBody`**

Add a tier constant set and helper function (alongside the existing `MODEL_STATUSES` set):

```typescript
const MODEL_TIERS = new Set<AiModelTier>(["reasoning", "interactive", "economy"]);

function optionalModelTier(value: unknown): AiModelTier | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && MODEL_TIERS.has(value as AiModelTier)) {
    return value as AiModelTier;
  }

  throw new HttpError(400, "tier must be reasoning, interactive, or economy");
}
```

Update `parseCreateModelBody` to include tier:

```typescript
function parseCreateModelBody(body: unknown): CreateAiConfiguredModelRequest {
  const value = requireObject(body);

  return {
    providerConfigId: requiredString(value.providerConfigId, "providerConfigId"),
    providerModelId: requiredString(value.providerModelId, "providerModelId"),
    displayName: requiredString(value.displayName, "displayName"),
    capabilities: requiredCapabilities(value.capabilities, "capabilities"),
    status: optionalModelStatus(value.status),
    tier: optionalModelTier(value.tier)
  };
}
```

Update `parseUpdateModelBody` to include tier:

```typescript
function parseUpdateModelBody(body: unknown): UpdateAiConfiguredModelRequest {
  const value = requireObject(body);

  return {
    providerModelId: optionalString(value.providerModelId, "providerModelId"),
    displayName: optionalString(value.displayName, "displayName"),
    capabilities:
      value.capabilities === undefined
        ? undefined
        : requiredCapabilities(value.capabilities, "capabilities"),
    status: optionalModelStatus(value.status),
    tier: optionalModelTier(value.tier)
  };
}
```

- [ ] **Step 4: Pass `tier` through in the create and update route handlers**

In the POST `/api/ai/models` handler (around line 228), add `tier` to the `createModel` call:

```typescript
repository.createModel(scopedDb, {
  providerConfigId: body.providerConfigId,
  providerModelId: body.providerModelId,
  displayName: body.displayName,
  capabilities: body.capabilities,
  status: body.status ?? "active",
  tier: body.tier
});
```

In the PATCH `/api/ai/models/:id` handler (around line 252), add `tier` to the `updateModel` call:

```typescript
repository.updateModel(scopedDb, request.params.id, {
  providerModelId: body.providerModelId,
  displayName: body.displayName,
  capabilities: body.capabilities,
  status: body.status,
  tier: body.tier
});
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/routes.ts
git commit -m "$(cat <<'EOF'
feat(ai): expose tier in model DTOs and accept it on create/update

serializeModel now includes tier. parseCreateModelBody and
parseUpdateModelBody parse optional tier from request body.
Route handlers forward tier to the repository layer.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Integration Tests — Tier Routing

Add integration tests covering exact-tier match, fallback, single-model, and DTO shape.

**Files:**

- Modify: `tests/integration/ai.test.ts`

- [ ] **Step 1: Write failing tests for tier routing**

Add a new `describe` block at the end of `tests/integration/ai.test.ts` (before the helper functions).

Each test uses a unique `AiModelCapability` to avoid cross-test contamination — no per-test DB resets needed. `fileParallelism: false` in vitest.config.ts ensures test files run sequentially.

```typescript
describe("AI capability tier routing", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: AiRepository;
  let server: ReturnType<typeof createApiServer>;
  let sharedProviderId: string;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new AiRepository();
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    // One provider shared across all tier tests (userA scope)
    const providerRes = await server.inject({
      method: "POST",
      url: "/api/ai/providers",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        providerKind: "anthropic",
        displayName: "Tier test provider",
        credentialPayload: { apiKey: "tier-test-key" }
      }
    });
    sharedProviderId = providerRes.json<{ provider: { id: string } }>().provider.id;
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  // Uses "json" capability — isolated from other tests by capability name
  it("selects exact-tier match when available", async () => {
    const interactiveRes = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        providerConfigId: sharedProviderId,
        providerModelId: "json-interactive",
        displayName: "JSON Interactive",
        capabilities: ["json"],
        tier: "interactive"
      }
    });
    const economyRes = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        providerConfigId: sharedProviderId,
        providerModelId: "json-economy",
        displayName: "JSON Economy",
        capabilities: ["json"],
        tier: "economy"
      }
    });
    const reasoningRes = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        providerConfigId: sharedProviderId,
        providerModelId: "json-reasoning",
        displayName: "JSON Reasoning",
        capabilities: ["json"],
        tier: "reasoning"
      }
    });

    expect(interactiveRes.statusCode).toBe(201);
    expect(economyRes.statusCode).toBe(201);
    expect(reasoningRes.statusCode).toBe(201);

    // Tier appears in the DTO response
    const economyDto = economyRes.json<{ model: { id: string; tier: string } }>().model;
    expect(economyDto.tier).toBe("economy");

    const economyId = economyDto.id;
    const interactiveId = interactiveRes.json<{ model: { id: string } }>().model.id;

    // Request economy tier → returns the economy model
    const economySelected = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.selectModelForCapability(scopedDb, "json", "economy")
    );
    expect(economySelected?.id).toBe(economyId);

    // Request interactive tier → returns the interactive model
    const interactiveSelected = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.selectModelForCapability(scopedDb, "json", "interactive")
    );
    expect(interactiveSelected?.id).toBe(interactiveId);
  });

  // Uses "vision" capability — only interactive configured, so economy request falls back
  it("falls back up the tier ladder when exact tier is not configured", async () => {
    const interactiveRes = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        providerConfigId: sharedProviderId,
        providerModelId: "vision-interactive",
        displayName: "Vision Interactive",
        capabilities: ["vision"],
        tier: "interactive"
      }
    });
    expect(interactiveRes.statusCode).toBe(201);
    const interactiveId = interactiveRes.json<{ model: { id: string } }>().model.id;

    // Requesting economy tier with no economy vision model → falls back to interactive
    const result = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.selectModelForCapability(scopedDb, "vision", "economy")
    );
    expect(result?.id).toBe(interactiveId);
    expect(result?.tier).toBe("interactive");
  });

  // Uses "summarization" capability — only reasoning configured, so economy request falls through entire ladder
  it("returns the single configured model regardless of tier (single-model setup)", async () => {
    const reasoningRes = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        providerConfigId: sharedProviderId,
        providerModelId: "summ-reasoning",
        displayName: "Summary Reasoning",
        capabilities: ["summarization"],
        tier: "reasoning"
      }
    });
    expect(reasoningRes.statusCode).toBe(201);
    const reasoningId = reasoningRes.json<{ model: { id: string } }>().model.id;

    // Requesting economy → ladder exhausted → any-tier fallback returns the only model
    const result = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.selectModelForCapability(scopedDb, "summarization", "economy")
    );
    expect(result?.id).toBe(reasoningId);
  });

  // Uses "tool-use" capability for create/update; asserts tier in DTO
  it("tier can be set on create and updated via PATCH", async () => {
    const createRes = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        providerConfigId: sharedProviderId,
        providerModelId: "tool-economy",
        displayName: "Tool Economy",
        capabilities: ["tool-use"],
        tier: "economy"
      }
    });
    expect(createRes.statusCode).toBe(201);
    const model = createRes.json<{ model: { id: string; tier: string } }>().model;
    expect(model.tier).toBe("economy");

    const updateRes = await server.inject({
      method: "PATCH",
      url: `/api/ai/models/${model.id}`,
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { tier: "interactive" }
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json<{ model: { tier: string } }>().model.tier).toBe("interactive");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail for the right reasons**

```bash
pnpm db:up && pnpm test:integration -- --reporter=verbose 2>&1 | grep -A3 "tier routing"
```

Expected: tests FAIL because the tier column doesn't exist until the migration runs, OR because `tier` is not yet in the `selectModelForCapability` signature. Confirm the failure mode makes sense.

- [ ] **Step 3: Run the full AI integration test suite to confirm existing tests still pass**

```bash
vitest run tests/integration/ai.test.ts
```

Expected: existing tests PASS; new tier-routing tests PASS (after migration ran in Task 1).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/ai.test.ts
git commit -m "$(cat <<'EOF'
test(ai): integration tests for tier-aware capability routing

Covers: exact-tier match, economy→interactive fallback, single-model
any-tier fallback, tier update via PATCH, tier in model DTO response.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Briefings Economy Tier Call

Add the AI model lookup to the briefings summarization path. The `generateSummary` function calls `selectModelForCapability("summarization", "economy")` and records the selected model in `source_metadata.aiModel`.

**Files:**

- Modify: `packages/briefings/src/repository.ts`

- [ ] **Step 1: Import `AiRepository` from `@jarv1s/ai`**

In `packages/briefings/src/repository.ts`, update the existing import from `@jarv1s/ai`:

```typescript
import { AiRepository, findAssistantToolFromManifests } from "@jarv1s/ai";
```

- [ ] **Step 2: Extend `SummaryResult` to include `aiModel`**

Update the `SummaryResult` interface (lines 49–55):

```typescript
interface SummaryResult {
  readonly status: BriefingRunStatus;
  readonly summaryText: string;
  readonly sourceMetadata: {
    readonly tools: readonly ToolSummary[];
    readonly aiModel: {
      readonly id: string;
      readonly displayName: string;
      readonly tier: string;
    } | null;
  };
}
```

- [ ] **Step 3: Update `blockedSummary` to include `aiModel: null`**

```typescript
function blockedSummary(toolSummaries: readonly ToolSummary[]): SummaryResult {
  return {
    status: "blocked",
    summaryText: "Briefing blocked because selected tools are not all declared read tools.",
    sourceMetadata: {
      tools: toolSummaries,
      aiModel: null
    }
  };
}
```

- [ ] **Step 4: Add the economy-tier AI model lookup to `generateSummary`**

After the `const status = selectRunStatus(toolSummaries);` line and before the `return {}` block, add:

```typescript
const aiRepository = new AiRepository();
const aiModel = await aiRepository.selectModelForCapability(scopedDb, "summarization", "economy");
```

Update the return statement to include `aiModel`:

```typescript
return {
  status,
  summaryText: summaryText || "Briefing did not produce visible source items.",
  sourceMetadata: {
    tools: toolSummaries,
    aiModel: aiModel
      ? { id: aiModel.id, displayName: aiModel.display_name, tier: aiModel.tier }
      : null
  }
};
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/briefings/src/repository.ts
git commit -m "$(cat <<'EOF'
feat(briefings): look up summarization model at economy tier

generateSummary now calls selectModelForCapability('summarization', 'economy')
and records the selected model in source_metadata.aiModel. This proves
end-to-end tier routing for background jobs and prepares the path for
future AI-enhanced briefing summaries.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Briefings Integration Test — Economy Tier

Verify that a briefing run records the economy-tier AI model in `source_metadata.aiModel` when one is configured.

**Files:**

- Modify: `tests/integration/briefings.test.ts`

- [ ] **Step 1: Write failing test**

Add a new test to the briefings `describe` block after the existing tests. You'll need to import `AiRepository` and `createAiSecretCipher` from `@jarv1s/ai`. Add these to the existing import:

```typescript
import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
```

Add the test:

```typescript
it("records economy-tier AI model in source_metadata when configured", async () => {
  // Set up an economy-tier summarization model for userA
  const aiRepository = new AiRepository();
  const providerRow = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    aiRepository.createProvider(scopedDb, {
      providerKind: "anthropic",
      displayName: "Economy summarizer",
      encryptedCredential: createAiSecretCipher().encryptJson({ apiKey: "briefing-econ-key" })
    })
  );
  const modelRow = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    aiRepository.createModel(scopedDb, {
      providerConfigId: providerRow.id,
      providerModelId: "econ-summarizer",
      displayName: "Economy Summarizer",
      capabilities: ["summarization"],
      tier: "economy"
    })
  );

  const definition = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.createDefinition(scopedDb, {
      title: "Economy tier briefing",
      selectedToolNames: ["tasks.list"]
    })
  );

  const run = await dataContext.withDataContext(userAContext(), (scopedDb) =>
    repository.generateRun(scopedDb, definition.id, {
      moduleManifests: getBuiltInModuleManifests(),
      runKind: "manual"
    })
  );

  expect(run?.status).toBe("succeeded");
  const meta = run?.source_metadata as { aiModel: { id: string; tier: string } | null };
  expect(meta.aiModel).not.toBeNull();
  expect(meta.aiModel?.id).toBe(modelRow.id);
  expect(meta.aiModel?.tier).toBe("economy");
});
```

- [ ] **Step 2: Run the briefings test to verify it fails (before the economy call is wired)**

If you haven't committed Task 6 yet, this should fail. If Task 6 is committed, it should PASS. In either case, confirm the test is found and reports a clear result.

```bash
vitest run tests/integration/briefings.test.ts
```

Expected: PASS (if Task 6 is done) or FAIL with a clear assertion error (if not).

- [ ] **Step 3: Run the full briefings integration suite**

```bash
vitest run tests/integration/briefings.test.ts
```

Expected: ALL tests pass, including the new economy-tier test and all existing tests.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/briefings.test.ts
git commit -m "$(cat <<'EOF'
test(briefings): assert economy-tier model lookup in generateRun

Verifies that generateRun records the selected economy-tier summarization
model in source_metadata.aiModel, confirming end-to-end tier routing for
the briefings background job.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full Gate + Pre-Push Checks

Run the full verification gate and the pre-push trio before opening the PR.

**Files:** none (verification only)

- [ ] **Step 1: Run the pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all green. If `format:check` fails, run `pnpm format` and commit the diff:

```bash
pnpm format
git add -p  # stage only changed files from format run
git commit -m "style: format (prettier drift)"
```

- [ ] **Step 2: Rebase onto origin/main**

```bash
git fetch origin main && git rebase origin/main
```

Expected: clean rebase. If there are conflicts, resolve them — do not force-push without resolving.

- [ ] **Step 3: Run the full foundation gate**

```bash
pnpm verify:foundation
```

Expected: lint ✓, format:check ✓, check:file-size ✓, typecheck ✓, db:migrate ✓, test:integration ✓.

- [ ] **Step 4: Run the AI and briefings test suites explicitly**

```bash
vitest run tests/integration/ai.test.ts && vitest run tests/integration/briefings.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Escalate to coordinator**

Message the Coordinator pane via `herdr-pane-message`: gate is green, ready for wrap-up and PR.
Then invoke the `coordinated-wrap-up` skill.

---

## Exit Criteria Checklist (from spec)

- [ ] `pnpm verify:foundation` green
- [ ] `ai_configured_models.tier` column present; migration idempotent
- [ ] `selectModelForCapability` accepts optional tier (default `"interactive"`); falls back gracefully up the tier ladder
- [ ] Briefings summarization job passes `tier: "economy"` (verified via `source_metadata.aiModel`)
- [ ] Integration tests cover tier-match, fallback, and single-model paths
- [ ] Model DTOs include `tier`; create/update endpoints accept it
