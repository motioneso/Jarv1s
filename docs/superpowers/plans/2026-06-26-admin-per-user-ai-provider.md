# Admin Per-User AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` under `coordinated-build`; this repo disables `executing-plans` and `subagent-driven-development` for build agents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an instance admin pin one active configured AI model for a target user, with server-side enforcement that overrides instance routes and blocks that user's self-override while pinned.

**Architecture:** Store the pin in the target user's `app.preferences` row under `ai.admin_pinned_model_id`, using a target-user `DataContextDb` only after an admin-scoped guard confirms the caller is an admin and the target user exists. Keep resolver enforcement in `AiRepository.resolveModelForCapability` before instance capability routes, so every AI caller inherits the binding. Add one admin AI route module for GET/PUT, shared schemas/types, and a compact PeoplePane control.

**Tech Stack:** Fastify routes, Kysely/DataContext RLS, existing `AiRepository` safe model projection, shared TypeScript contracts, React Query, Vitest integration tests.

---

## Verified Branch State

- `packages/ai/src/repository.ts:476-551` still contains `listCapabilityRoutes` and `resolveModelForCapability`; resolver currently checks instance route before automatic selection and has no admin pin check.
- `packages/ai/src/routes.ts:322-352` still lets a user PUT `/api/ai/chat-model-override` when global override/model allow it; no admin-pin conflict exists.
- `apps/web/src/settings/settings-admin-panes.tsx:240-381` is the existing admin user-management surface (`PeoplePane`).
- `ai.admin_pinned_model_id` and `/api/admin/users/:userId/ai-pin` do not exist on this branch.
- No migration is needed; nearby AI settings already use `app.preferences`.

## Files

- Modify: `packages/shared/src/ai-types.ts` - add admin pin DTO/request/response types and two route reasons.
- Modify: `packages/shared/src/ai-api.ts` - add JSON schemas and route schemas for admin pin GET/PUT.
- Modify: `packages/ai/src/repository.ts` - add pin preference helpers and resolver precedence.
- Create: `packages/ai/src/admin-ai-pin-routes.ts` - admin guarded GET/PUT routes, target-user RLS scope, audit via settings public port.
- Modify: `packages/ai/src/routes.ts` - register admin pin routes and block self-override while pinned.
- Modify: `packages/ai/src/manifest.ts` - register admin pin routes in module manifest.
- Modify: `packages/ai/package.json` - add `@jarv1s/settings` dependency for the sanctioned audit API.
- Modify: `apps/web/src/api/client.ts` - add admin pin client functions.
- Modify: `apps/web/src/api/query-keys.ts` - add `queryKeys.ai.adminUserPin(userId)`.
- Modify: `apps/web/src/settings/settings-admin-panes.tsx` - add a per-user AI provider selector in `PeoplePane`.
- Test: `tests/integration/ai-admin-pin.test.ts` - route auth, resolver binding, override conflict, clear/unavailable fallback.

### Task 1: Backend Contract And Resolver

**Files:**

- Modify: `packages/shared/src/ai-types.ts`
- Modify: `packages/shared/src/ai-api.ts`
- Modify: `packages/ai/src/repository.ts`
- Test: `tests/integration/ai-admin-pin.test.ts`

- [ ] **Step 1: Write failing resolver test**

Add `tests/integration/ai-admin-pin.test.ts` with setup using `resetFoundationDatabase()`, `createApiServer`, `DataContextRunner`, `AiRepository`, and `ids.sessionAdmin`. First test: user B creates two active chat models, admin pins model 1 by writing the target user's preference through `dataContext.withDataContext({ actorUserId: ids.userB })`, then `repository.resolveModelForCapability(scopedDb, "chat")` returns `{ reason: "admin-pin", model.id: pinnedId }` even if an instance route points to model 2.

Run:

```bash
pnpm vitest run tests/integration/ai-admin-pin.test.ts
```

Expected: fail because `admin-pin` is not a valid reason and resolver ignores `ai.admin_pinned_model_id`.

- [ ] **Step 2: Add shared reason/type surface**

In `packages/shared/src/ai-types.ts`, extend `AiCapabilityRouteReason`:

```ts
export type AiCapabilityRouteReason =
  | "admin-pin"
  | "admin-pin-unavailable-fallback"
  | "manual-route"
  | "manual-route-unavailable-fallback"
  | "matched-active-model"
  | "no-active-model";
```

In `packages/shared/src/ai-api.ts`, add both new strings to `aiCapabilityRouteSchema.properties.reason.enum`.

- [ ] **Step 3: Add repository pin helpers and resolver precedence**

In `packages/ai/src/repository.ts`, add:

```ts
export const AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY = "ai.admin_pinned_model_id";
```

Add methods on `AiRepository`:

```ts
async getAdminPinnedModelId(scopedDb: DataContextDb): Promise<string | null> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb.db
    .selectFrom("app.preferences")
    .select("value_json")
    .where("key", "=", AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY)
    .executeTakeFirst();
  return typeof row?.value_json === "string" ? row.value_json : null;
}

async getAdminPinnedModel(scopedDb: DataContextDb): Promise<AiConfiguredModelSafeRow | null> {
  const modelId = await this.getAdminPinnedModelId(scopedDb);
  return modelId ? ((await this.safeModelQuery(scopedDb).where("models.id", "=", modelId).executeTakeFirst()) ?? null) : null;
}

async setAdminPinnedModel(scopedDb: DataContextDb, modelId: string | null): Promise<AiConfiguredModelSafeRow | null> {
  assertDataContextDb(scopedDb);
  if (modelId === null) {
    await scopedDb.db.deleteFrom("app.preferences").where("key", "=", AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY).execute();
    return null;
  }

  const model = await this.safeModelQuery(scopedDb)
    .where("models.id", "=", modelId)
    .where("models.status", "=", "active")
    .where("providers.status", "=", "active")
    .executeTakeFirst();
  if (!model) return null;

  await scopedDb.db
    .insertInto("app.preferences")
    .values({
      owner_user_id: sql<string>`app.current_actor_user_id()`,
      key: AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY,
      value_json: jsonb(modelId),
      updated_at: new Date()
    })
    .onConflict((oc) =>
      oc.columns(["owner_user_id", "key"]).doUpdateSet({
        value_json: jsonb(modelId),
        updated_at: new Date()
      })
    )
    .execute();
  return model;
}
```

At the top of `resolveModelForCapability`, before `listCapabilityRoutes`, read the pin. If a pinned active model supports the requested capability, return `{ model: pinned, reason: "admin-pin" }`. If a pin exists but is inactive, provider-disabled, missing, or not capable, keep resolving through current route/automatic logic and return reason `"admin-pin-unavailable-fallback"` with whatever fallback model was selected.

- [ ] **Step 4: Run focused resolver test**

Run:

```bash
pnpm vitest run tests/integration/ai-admin-pin.test.ts
```

Expected: resolver test passes; route tests not written yet.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ai-types.ts packages/shared/src/ai-api.ts packages/ai/src/repository.ts tests/integration/ai-admin-pin.test.ts
git commit -m "feat(ai): resolve admin pinned user model"
```

### Task 2: Admin Pin Routes And Self-Override Lock

**Files:**

- Create: `packages/ai/src/admin-ai-pin-routes.ts`
- Modify: `packages/ai/package.json`
- Modify: `packages/ai/src/routes.ts`
- Modify: `packages/ai/src/manifest.ts`
- Modify: `packages/shared/src/ai-types.ts`
- Modify: `packages/shared/src/ai-api.ts`
- Test: `tests/integration/ai-admin-pin.test.ts`

- [ ] **Step 1: Write failing route/security tests**

Extend `tests/integration/ai-admin-pin.test.ts`:

- `PUT /api/admin/users/:userId/ai-pin` as `ids.sessionAdmin` stores user B's active model and returns no credential fields.
- Same PUT as `ids.sessionB` returns 403.
- Admin cannot pin user A's model for user B; expect 400.
- While pinned, user B `PUT /api/ai/chat-model-override` returns 409.
- Admin PUT `{ modelId: null }` clears the pin; after clear, user B self-override succeeds when global override is enabled.
- If the pinned model is disabled, `resolveModelForCapability` returns reason `"admin-pin-unavailable-fallback"`.

Run:

```bash
pnpm vitest run tests/integration/ai-admin-pin.test.ts
```

Expected: fail because routes/schemas do not exist and override route does not check pin.

- [ ] **Step 2: Add shared admin pin DTOs and schemas**

In `packages/shared/src/ai-types.ts`, add:

```ts
export interface AiAdminUserPinDto {
  readonly pinnedModelId: string | null;
  readonly pinnedModel: AiConfiguredModelDto | null;
  readonly effectiveChatModel: AiConfiguredModelDto | null;
  readonly effectiveChatReason: AiCapabilityRouteReason;
  readonly availableModels: readonly AiConfiguredModelDto[];
}

export interface GetAiAdminUserPinResponse {
  readonly pin: AiAdminUserPinDto;
}

export interface PutAiAdminUserPinRequest {
  readonly modelId: string | null;
}
```

In `packages/shared/src/ai-api.ts`, add request/response schemas and route schemas:

```ts
export const putAiAdminUserPinRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modelId"],
  properties: { modelId: { type: ["string", "null"] } }
} as const;
```

Use a response object `{ pin: { pinnedModelId, pinnedModel, effectiveChatModel, effectiveChatReason, availableModels } }`, all using existing `aiConfiguredModelSchema`.

- [ ] **Step 3: Create route module**

Create `packages/ai/src/admin-ai-pin-routes.ts`. Route flow:

```ts
const accessContext = await dependencies.resolveAccessContext(request);
const targetUserId = request.params.userId;

await dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
  await assertInstanceAdmin(repository, scopedDb, accessContext.actorUserId);
  const target = await repository.getUserById(scopedDb, targetUserId);
  if (!target) throw new HttpError(404, "User not found");
});

const pin = await dependencies.dataContext.withDataContext(
  { actorUserId: targetUserId, requestId: accessContext.requestId },
  (targetDb) => readOrWritePinForTarget(targetDb)
);
```

For PUT with non-null `modelId`, `repository.setAdminPinnedModel(targetDb, modelId)` returns `null` when the model is not active and owned by the target; translate that to `HttpError(400, "modelId must reference an active model owned by the target user")`.

After successful PUT, record audit through the settings-owned public port:

```ts
await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
  recordAuditEvent(scopedDb, {
    actorUserId: accessContext.actorUserId,
    action: body.modelId === null ? "ai.admin_pin.clear" : "ai.admin_pin.set",
    targetType: "user",
    targetId: targetUserId,
    metadata: body.modelId === null ? {} : { modelId: body.modelId },
    requestId: accessContext.requestId ?? ""
  })
);
```

- [ ] **Step 4: Add package dependency for public audit port**

In `packages/ai/package.json`, add:

```json
"@jarv1s/settings": "workspace:*"
```

Import `recordAuditEvent` from `@jarv1s/settings` in `packages/ai/src/admin-ai-pin-routes.ts`. Do not import `SettingsRepository` and do not write `app.admin_audit_events` directly; `recordAuditEvent` is the sanctioned cross-module audit API documented in `packages/settings/src/repository.ts`.

- [ ] **Step 5: Register routes and manifest**

In `packages/ai/src/routes.ts`, import/register `registerAiAdminPinRoutes(server, dependencies, repository)` after chat override routes or before assistant routes.

In `packages/ai/src/manifest.ts`, import the new schemas and add:

```ts
{
  method: "GET",
  path: "/api/admin/users/:userId/ai-pin",
  responseSchema: getAiAdminUserPinResponseSchema,
  permissionId: "ai.manage"
},
{
  method: "PUT",
  path: "/api/admin/users/:userId/ai-pin",
  requestSchema: putAiAdminUserPinRequestSchema,
  responseSchema: getAiAdminUserPinResponseSchema,
  permissionId: "ai.manage"
}
```

- [ ] **Step 6: Block user self-override while pinned**

In `packages/ai/src/routes.ts` `PUT /api/ai/chat-model-override`, before validating `body.modelId`, call `repository.getAdminPinnedModelId(scopedDb)`. If present, throw:

```ts
throw new HttpError(409, "An admin has pinned your AI provider; contact them to change it");
```

- [ ] **Step 7: Run route/security tests**

Run:

```bash
pnpm vitest run tests/integration/ai-admin-pin.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add packages/ai/package.json packages/ai/src/admin-ai-pin-routes.ts packages/ai/src/routes.ts packages/ai/src/manifest.ts packages/shared/src/ai-types.ts packages/shared/src/ai-api.ts tests/integration/ai-admin-pin.test.ts
git commit -m "feat(ai): add admin user model pin routes"
```

### Task 3: Admin PeoplePane Control

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-admin-panes.tsx`

- [ ] **Step 1: Add client functions and query key**

In `apps/web/src/api/client.ts`, import the new shared types and add:

```ts
export async function getAdminUserAiPin(userId: string): Promise<GetAiAdminUserPinResponse> {
  return requestJson<GetAiAdminUserPinResponse>(
    `/api/admin/users/${encodeURIComponent(userId)}/ai-pin`
  );
}

export async function putAdminUserAiPin(
  userId: string,
  input: PutAiAdminUserPinRequest
): Promise<GetAiAdminUserPinResponse> {
  return requestJson<GetAiAdminUserPinResponse>(
    `/api/admin/users/${encodeURIComponent(userId)}/ai-pin`,
    {
      method: "PUT",
      body: input
    }
  );
}
```

In `apps/web/src/api/query-keys.ts`, add:

```ts
adminUserAiPin: (userId: string) => ["ai", "admin", "users", userId, "pin"] as const,
```

- [ ] **Step 2: Add a compact AI pin row component**

In `apps/web/src/settings/settings-admin-panes.tsx`, add an `AiPinRow` component below `PersonRow`. It uses `useQuery({ queryKey: queryKeys.ai.adminUserAiPin(user.id), queryFn: () => getAdminUserAiPin(user.id), enabled: open })` and a `<select>` with:

```tsx
<option value="">Clear pin</option>;
{
  pin.availableModels.map((model) => (
    <option key={model.id} value={model.id}>
      {model.displayName}
    </option>
  ));
}
```

Mutation calls `putAdminUserAiPin(user.id, { modelId: value || null })`, invalidates that user's pin query, and shows the existing toast.

- [ ] **Step 3: Add toggle/open state to each person**

Extend `PersonRow` with an "AI provider" menu item using `ServerCog` and local `showAi` state. Render `AiPinRow` under the row when open. Keep disabled copy short when `availableModels.length === 0`: "No active models configured by this user."

- [ ] **Step 4: Typecheck frontend**

Run:

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-admin-panes.tsx
git commit -m "feat(web): expose admin AI provider pins"
```

### Task 4: Final Verification

**Files:**

- No new implementation files unless previous tasks expose a compile issue.

- [ ] **Step 1: Run focused tests**

```bash
pnpm vitest run tests/integration/ai-admin-pin.test.ts tests/integration/ai-chat-model-override.test.ts tests/integration/ai-capability-routes.test.ts
```

Expected: pass.

- [ ] **Step 2: Run required trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 3: Commit any verification fixes**

If formatting/type fixes were needed:

```bash
git add <exact changed files>
git commit -m "fix(ai): tighten admin pin verification"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: resolver pin precedence, target-user ownership, self-override 409, clear/unavailable fallback, no secrets, audit metadata, no migration, no `AccessContext` shape change, and admin UI are covered.
- Simplifications: one pin covers all capabilities; UI lives in existing PeoplePane; route GET returns available models/effective chat state to avoid extra admin endpoints.
- Risk resolved before approval: use existing `recordAuditEvent` public settings export; no direct AI writes to `app.admin_audit_events`.
