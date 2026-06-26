# Runtime Config Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DB-first/env-fallback runtime config for embedding provider/model, with admin API/UI and no secret leaks.

**Architecture:** `@jarv1s/settings` owns the runtime config registry, resolver, and admin routes. `@jarv1s/memory` keeps provider factory shape stable and accepts a tiny resolver interface, so memory does not import settings. Worker/module consumers resolve embedding config inside actor-scoped `DataContextDb` work, replacing the current process-wide singleton embedding provider.

**Tech Stack:** TypeScript, Fastify, Kysely `DataContextDb`, React Query, `@jarv1s/settings-ui`, Vitest.

---

## Verified Branch State

- `RUNTIME_CONFIG_REGISTRY` and `RuntimeConfigResolver` do not exist yet.
- `packages/memory/src/embedding-provider-config.ts` still reads `JARVIS_EMBED_PROVIDER` / `JARVIS_EMBED_MODEL` directly.
- `getEmbeddingProviderConfig` callers are `apps/worker/src/worker.ts` and `packages/notes/src/tools.ts`; `createEmbeddingProvider` is also injected into chat and briefings workers through `BuiltInWorkerDependencies.embeddingProvider`.
- `@jarv1s/settings-ui` atoms exist: `Group`, `Field`, `Note`, `Badge`, `Select`.
- No DB migration is needed; `app.instance_settings` and `SettingsRepository.upsertInstanceSetting/deleteInstanceSetting` exist.
- Drift from spec: worker startup has no actor `AccessContext`, so DB-first config cannot be read safely at process boot. Runtime embedding provider creation must move into actor-scoped job/tool paths.

## File Structure

- Create `packages/settings/src/runtime-config-keys.ts`: registry, lookup helpers, embedding key constants.
- Create `packages/settings/src/runtime-config-resolver.ts`: typed resolver over `DataContextDb`, `SettingsRepository`, env fallback, validation.
- Create `packages/settings/src/runtime-config-routes.ts`: admin GET/PUT routes.
- Modify `packages/settings/src/instance-settings-keys.ts`: include runtime keys in known instance settings.
- Modify `packages/settings/src/index.ts`: export runtime config APIs.
- Modify `packages/settings/src/manifest.ts`: declare admin runtime-config routes.
- Create `packages/shared/src/runtime-config-api.ts`; modify `packages/shared/src/index.ts`.
- Modify `packages/memory/src/embedding-provider-config.ts`: async resolver-based config read.
- Modify `packages/notes/src/tools.ts` and `packages/notes/src/jobs.ts`: resolve provider per actor-scoped DB use.
- Modify `packages/chat/src/jobs.ts`: resolve embedding provider inside embed-turn job.
- Modify `packages/module-registry/src/index.ts`: remove process-wide worker embedding provider injection; wire resolver factories from settings.
- Modify `apps/worker/src/worker.ts`: stop constructing embedding provider at startup.
- Modify `apps/web/src/api/client.ts`, `apps/web/src/query-keys.ts`, `apps/web/src/settings/settings-ai-admin-pane.tsx`: admin UI.
- Add focused tests under `tests/unit/runtime-config*.test.ts` and update worker/module-registry tests if signatures change.

---

### Task 1: Registry + Shared Contract

**Files:**
- Create: `packages/settings/src/runtime-config-keys.ts`
- Modify: `packages/settings/src/instance-settings-keys.ts`
- Create: `packages/shared/src/runtime-config-api.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `tests/unit/runtime-config-registry.test.ts`

- [ ] **Step 1: Write failing registry/contract test**

```ts
import { describe, expect, it } from "vitest";

import {
  EMBED_MODEL_CONFIG_KEY,
  EMBED_PROVIDER_CONFIG_KEY,
  RUNTIME_CONFIG_REGISTRY,
  getRuntimeConfigEntry
} from "../../packages/settings/src/runtime-config-keys.js";
import {
  KNOWN_INSTANCE_SETTING_KEYS,
  SECRET_INSTANCE_SETTING_KEYS
} from "../../packages/settings/src/instance-settings-keys.js";

describe("runtime config registry", () => {
  it("registers embedding keys as non-secret instance settings", () => {
    expect(getRuntimeConfigEntry(EMBED_PROVIDER_CONFIG_KEY)).toMatchObject({
      key: "ai.embed_provider",
      type: "enum",
      defaultValue: "local",
      envVar: "JARVIS_EMBED_PROVIDER",
      enumValues: ["local", "stub"],
      moduleOwner: "memory"
    });
    expect(getRuntimeConfigEntry(EMBED_MODEL_CONFIG_KEY)).toMatchObject({
      key: "ai.embed_model",
      type: "string",
      defaultValue: "",
      envVar: "JARVIS_EMBED_MODEL",
      moduleOwner: "memory"
    });
    expect(KNOWN_INSTANCE_SETTING_KEYS.has(EMBED_PROVIDER_CONFIG_KEY)).toBe(true);
    expect(KNOWN_INSTANCE_SETTING_KEYS.has(EMBED_MODEL_CONFIG_KEY)).toBe(true);
    expect(SECRET_INSTANCE_SETTING_KEYS.has(EMBED_PROVIDER_CONFIG_KEY)).toBe(false);
    expect(SECRET_INSTANCE_SETTING_KEYS.has(EMBED_MODEL_CONFIG_KEY)).toBe(false);
    expect(RUNTIME_CONFIG_REGISTRY).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm vitest run tests/unit/runtime-config-registry.test.ts`

Expected: FAIL because `runtime-config-keys.ts` does not exist.

- [ ] **Step 3: Add registry and DTO schemas**

Implement `RuntimeConfigType`, `RuntimeConfigKeyEntry`, `RUNTIME_CONFIG_REGISTRY`, `getRuntimeConfigEntry`, and embedding key constants exactly matching spec. Add `RuntimeConfigSource`, GET/PUT DTOs, and schemas to `packages/shared/src/runtime-config-api.ts`; export from shared index.

- [ ] **Step 4: Wire known instance keys**

Import `RUNTIME_CONFIG_REGISTRY` in `instance-settings-keys.ts` and append its entries to `INSTANCE_SETTINGS_REGISTRY`, preserving the Brave secret guard behavior.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run tests/unit/runtime-config-registry.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/settings/src/runtime-config-keys.ts packages/settings/src/instance-settings-keys.ts packages/shared/src/runtime-config-api.ts packages/shared/src/index.ts tests/unit/runtime-config-registry.test.ts
git commit -m "feat(settings): add runtime config registry"
```

---

### Task 2: Resolver

**Files:**
- Create: `packages/settings/src/runtime-config-resolver.ts`
- Modify: `packages/settings/src/index.ts`
- Test: `tests/unit/runtime-config-resolver.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Tests cover DB value wins over env, env wins over default, enum rejects invalid values, blank string default works for model, int parser rejects invalid values, and secret values are not returned through string/enum methods.

- [ ] **Step 2: Run failing tests**

Run: `pnpm vitest run tests/unit/runtime-config-resolver.test.ts`

Expected: FAIL because resolver does not exist.

- [ ] **Step 3: Implement minimal resolver**

Implement `RuntimeConfigResolver` with constructor:

```ts
constructor(
  private readonly scopedDb: DataContextDb,
  private readonly env: NodeJS.ProcessEnv = process.env
) {}
```

Use `scopedDb.db.selectFrom("app.instance_settings")...where("key","=",key)` for DB reads. Resolve order: instance row wrapper `{ value }`, env var if non-empty, default. Validate by registry type. Keep secret methods presence/value-safe; no logging.

- [ ] **Step 4: Export resolver**

Add exports in `packages/settings/src/index.ts`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run tests/unit/runtime-config-resolver.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/settings/src/runtime-config-resolver.ts packages/settings/src/index.ts tests/unit/runtime-config-resolver.test.ts
git commit -m "feat(settings): resolve runtime config from db"
```

---

### Task 3: Admin Routes

**Files:**
- Create: `packages/settings/src/runtime-config-routes.ts`
- Modify: `packages/settings/src/index.ts`
- Modify: `packages/settings/src/manifest.ts`
- Modify: `packages/module-registry/src/index.ts`
- Test: `tests/unit/runtime-config-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Tests cover admin GET returning `{ value, source }`, PUT validating enum, PUT upserting metadata-only audit action `runtime_config.ai.embed_provider.set`, and secret GET never returning value.

- [ ] **Step 2: Run failing tests**

Run: `pnpm vitest run tests/unit/runtime-config-routes.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement routes**

Add `registerRuntimeConfigRoutes(server, deps)` with:

- `GET /api/admin/runtime-config/:key`
- `PUT /api/admin/runtime-config/:key`

Use `resolveAccessContext`, `dataContext.withDataContext`, `assertAdminUser`, `RuntimeConfigResolver`, `SettingsRepository.upsertInstanceSetting`, and `SettingsRepository.deleteInstanceSetting` for blank value clears. Never include values in audit metadata.

- [ ] **Step 4: Wire routes**

Export route file, register in settings module block in `packages/module-registry/src/index.ts`, and add route entries to `settingsModuleManifest`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run tests/unit/runtime-config-routes.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/settings/src/runtime-config-routes.ts packages/settings/src/index.ts packages/settings/src/manifest.ts packages/module-registry/src/index.ts tests/unit/runtime-config-routes.test.ts
git commit -m "feat(settings): add runtime config admin routes"
```

---

### Task 4: Embedding Config Consumers

**Files:**
- Modify: `packages/memory/src/embedding-provider-config.ts`
- Modify: `packages/notes/src/tools.ts`
- Modify: `packages/notes/src/jobs.ts`
- Modify: `packages/chat/src/jobs.ts`
- Modify: `packages/module-registry/src/index.ts`
- Modify: `apps/worker/src/worker.ts`
- Test: `tests/unit/runtime-config-embedding.test.ts`

- [ ] **Step 1: Write failing embedding tests**

Tests cover `getEmbeddingProviderConfig(resolver)` returns `{ kind }` / `{ kind, modelId }`, rejects invalid provider via resolver validation, notes job creates provider after actor-scoped DB exists, and worker no longer constructs provider at startup.

- [ ] **Step 2: Run failing tests**

Run: `pnpm vitest run tests/unit/runtime-config-embedding.test.ts tests/unit/worker-schedule-mode.test.ts`

Expected: FAIL because current config is sync/env-only and worker creates a singleton provider.

- [ ] **Step 3: Update memory config reader**

Make `getEmbeddingProviderConfig` async and accept a structural resolver:

```ts
export interface EmbeddingRuntimeConfigResolver {
  resolveEnum(key: "ai.embed_provider"): Promise<EmbeddingProviderKind>;
  resolveString(key: "ai.embed_model"): Promise<string>;
}
```

Return provider config from resolver. Keep `createEmbeddingProvider` sync.

- [ ] **Step 4: Update notes tools/jobs**

In `packages/notes/src/tools.ts`, make retriever resolution async and cache by resolved config key, using `new RuntimeConfigResolver(scopedDb)` inside `notesSearchExecute`.

In `packages/notes/src/jobs.ts`, replace injected `EmbeddingProvider` with a resolver/provider factory inside the existing actor-scoped `withDataContext` paths.

- [ ] **Step 5: Update chat/briefings worker injection**

Replace `BuiltInWorkerDependencies.embeddingProvider` with a small async embedding provider resolver/factory usable inside job `DataContextDb`. Build `MemoryRetriever` per actor-scoped config where needed; keep caching only by config key if needed.

- [ ] **Step 6: Update worker composition**

Remove `createEmbeddingProvider(getEmbeddingProviderConfig())` from `apps/worker/src/worker.ts`. Let module registry workers resolve config under RLS.

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest run tests/unit/runtime-config-embedding.test.ts tests/unit/worker-schedule-mode.test.ts`

Expected: PASS.

Commit:

```bash
git add packages/memory/src/embedding-provider-config.ts packages/notes/src/tools.ts packages/notes/src/jobs.ts packages/chat/src/jobs.ts packages/module-registry/src/index.ts apps/worker/src/worker.ts tests/unit/runtime-config-embedding.test.ts
git commit -m "feat(memory): resolve embedding config at runtime"
```

---

### Task 5: Web Admin UI

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/query-keys.ts`
- Modify: `apps/web/src/settings/settings-ai-admin-pane.tsx`
- Test: `tests/unit/runtime-config-web-client.test.ts`

- [ ] **Step 1: Write failing web client tests**

Test that client functions call `/api/admin/runtime-config/:key`, query keys include runtime config keys, and payloads use `{ value }`.

- [ ] **Step 2: Run failing tests**

Run: `pnpm vitest run tests/unit/runtime-config-web-client.test.ts`

Expected: FAIL because client functions/query keys do not exist.

- [ ] **Step 3: Add client/query functions**

Add `getRuntimeConfig(key)` and `putRuntimeConfig(key, { value })`; add `queryKeys.ai.runtimeConfig(key)`.

- [ ] **Step 4: Add `EmbeddingConfigGroup`**

In `settings-ai-admin-pane.tsx`, render a `Group` with:

- provider `Select` for `local` / `stub`
- model text input
- source `Badge` for Instance / Env / Default
- save buttons for each key
- note text explaining env fallback without exposing secrets

Use existing `Group`, `Field`, `Note`, `Badge`, `Select`, `useFeedback`, and React Query patterns from `WebSearchKeyGroup`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run tests/unit/runtime-config-web-client.test.ts`

Expected: PASS.

Commit:

```bash
git add apps/web/src/api/client.ts apps/web/src/query-keys.ts apps/web/src/settings/settings-ai-admin-pane.tsx tests/unit/runtime-config-web-client.test.ts
git commit -m "feat(web): add embedding runtime config controls"
```

---

### Task 6: Final Verification

**Files:**
- All touched files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run tests/unit/runtime-config-registry.test.ts tests/unit/runtime-config-resolver.test.ts tests/unit/runtime-config-routes.test.ts tests/unit/runtime-config-embedding.test.ts tests/unit/runtime-config-web-client.test.ts tests/unit/worker-schedule-mode.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run required gate subset**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run relevant integration smoke if route tests are insufficient**

Run: `pnpm test:memory`

Expected: PASS or documented existing environment blocker.

---

## Spec Coverage Check

- Registry: Task 1.
- DB-first/env-fallback resolver: Task 2.
- Admin GET/PUT routes and metadata-only audit: Task 3.
- Embedding provider/model migration: Task 4.
- Admin UI using settings-ui atoms: Task 5.
- No migration, no env var removal: preserved.
- Secret handling: Task 2/3 guard secret values, even though embedding keys are non-secret.
- Env-var audit: verified via `rg`; only embedding keys migrate in this plan, follow-ups remain out of scope.

