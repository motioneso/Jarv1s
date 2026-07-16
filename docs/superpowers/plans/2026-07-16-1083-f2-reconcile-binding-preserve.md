# #1083 F2 Reconcile Binding Preserve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `coordinated-build` to implement this plan task-by-task. The repo disables the generic plan-execution skills during coordinated builds.

**Goal:** Preserve concrete CLI model row IDs across unchanged reconnect reconciliation and route genuinely dangling service bindings through the instance-default provider.

**Architecture:** Keep the existing shared discovery path and insert-only natural-key upsert. Narrow the pre-upsert delete to models absent from the discovered natural-key set, then use the repository's existing default-provider and provider-scoped selection helpers when a bound row cannot resolve.

**Tech Stack:** TypeScript, Kysely/PostgreSQL, Vitest integration tests

---

### Task 1: Prove reconnect preservation and changed-set fallback

**Files:**

- Modify: `tests/integration/ai-auto-register.test.ts`
- Modify: `tests/integration/ai-structured.test.ts`

- [ ] **Step 1: Write the failing reconnect test**

Add a `#1083 F2` integration test to `ai-auto-register.test.ts` which:

```ts
await service.ensureDefaultChatModel(db, "anthropic");
const boundBefore = (await repository.listModels(db)).find(
  (model) => model.provider_model_id === "claude-haiku-4-5-20251001"
)!;
await repository.setServiceBinding(
  db,
  "module.news",
  { kind: "model", modelId: boundBefore.id },
  ids.userA
);
await service.ensureDefaultChatModel(db, "anthropic");

const boundAfter = (await repository.listModels(db)).find(
  (model) => model.provider_model_id === boundBefore.provider_model_id
);
const route = await repository.resolveModelForService(db, "module.news", {
  capability: "json"
});
expect(boundAfter?.id).toBe(boundBefore.id);
expect(await repository.getModuleServiceBinding(db, "module.news")).toEqual({
  kind: "model",
  modelId: boundBefore.id
});
expect(route).toMatchObject({ reason: "manual-route", model: { id: boundBefore.id } });
```

The test comment must explain the exact bind → token expiry → re-login → reconcile failure from #1083 F2 and why row identity, not only model names/counts, is asserted.

- [ ] **Step 2: Write the failing changed-set test**

In the same suite, simulate a curated discovery result which removes the bound concrete model. Create a second, newer capable provider so cross-provider automatic routing cannot accidentally satisfy the assertion. Reconcile through `discoverAndPersistModels`, then assert the removed binding routes inside the existing instance-default CLI provider:

```ts
const changedDiscovery = new ModelDiscoveryService();
changedDiscovery.discoverModels = async () => ({
  models: CLI_STATIC_MODELS.anthropic!.filter(
    (model) => model.providerModelId !== bound.provider_model_id
  ),
  fromCache: false,
  fromFallback: true,
  cacheExpiresAt: null
});

await discoverAndPersistModels(scopedDb, providerInput, {
  repository,
  modelDiscovery: changedDiscovery
});
const route = await repository.resolveModelForService(scopedDb, "module.news", {
  capability: "json"
});
expect(route.reason).toBe("matched-active-model");
expect(route.model?.provider_config_id).toBe(defaultCliProvider.id);
```

Add a `#1083 F2` why-comment stating that a legitimate catalog removal may dangle the stored UUID, so fallback must remain provider-default and must not jump to the newer secondary provider.

- [ ] **Step 3: Update the existing unresolved-binding expectation**

Change the `ai-structured.test.ts` case which disables a bound model from expecting hard `needs-config` to expecting the default provider's economy JSON model:

```ts
expect(route.reason).toBe("matched-active-model");
expect(route.model?.id).toBe(modelEconomyJsonId);
```

- [ ] **Step 4: Run the two integration files and verify RED**

Run:

```bash
JARVIS_PGDATABASE=jarv1s_c2_1083 pnpm exec tsx scripts/test-integration.ts \
  tests/integration/ai-auto-register.test.ts tests/integration/ai-structured.test.ts
```

Expected: FAIL because unchanged reconcile replaces the bound UUID and unresolved bindings return `needs-config`.

### Task 2: Reconcile by natural key and fall through to provider default

**Files:**

- Modify: `packages/ai/src/discover-and-persist-models.ts`
- Modify: `packages/ai/src/repository.ts`
- Modify: `packages/ai/src/auto-register.ts`
- Test: `tests/integration/ai-auto-register.test.ts`
- Test: `tests/integration/ai-structured.test.ts`

- [ ] **Step 1: Preserve discovered natural keys during deletion**

Extend the existing repository delete method with an optional preserve list so its direct admin-only test keeps the old no-argument behavior:

```ts
async deleteModelsForProviderExceptSentinel(
  scopedDb: DataContextDb,
  providerConfigId: string,
  providerModelIdsToPreserve: readonly string[] = []
): Promise<void> {
  assertDataContextDb(scopedDb);
  let query = scopedDb.db
    .deleteFrom("app.ai_configured_models")
    .where("provider_config_id", "=", providerConfigId)
    .where("provider_model_id", "!=", "default");
  if (providerModelIdsToPreserve.length > 0) {
    query = query.where("provider_model_id", "not in", [...providerModelIdsToPreserve]);
  }
  await query.execute();
}
```

Replace the obsolete hard-replace comment with a `#1083 F2` explanation: unchanged `(provider_config_id, provider_model_id)` rows retain UUIDs and custom state; only absent concrete rows are removed. No migration is needed because the existing unique constraint already provides the natural key.

- [ ] **Step 2: Pass discovered IDs into the diff**

In `discoverAndPersistModels`, map the discovered models once, pass their `providerModelId` values into deletion, then upsert the same mapped array:

```ts
const models = discovered.models.map((model) => ({ ...model, status: "active" as const }));
if (replaceCliModels) {
  await deps.repository.deleteModelsForProviderExceptSentinel(
    scopedDb,
    input.providerId,
    models.map((model) => model.providerModelId)
  );
}
if (!replaceCliModels && discovered.fromFallback) return;
await deps.repository.upsertDiscoveredModels(scopedDb, input.providerId, models);
```

Update the discovery and login-ready comments in `discover-and-persist-models.ts` and `auto-register.ts` to say diff/reconcile rather than hard replace.

- [ ] **Step 3: Route unresolved model bindings through the instance default**

Replace only the hard `needs-config` branch in `resolveModelForService`:

```ts
if (model) return { model, reason: "manual-route" };

// #1083 F2: service bindings store row UUIDs without an FK. A legitimate catalog removal can
// leave one dangling, so degrade inside the configured default provider instead of breaking work.
const defaultProviderId = await this.resolveDefaultProviderId(scopedDb);
if (defaultProviderId) {
  const fallback = await this.selectModelInProviderForCapability(
    scopedDb,
    defaultProviderId,
    capability,
    tierHint
  );
  if (fallback) return { model: fallback, reason: "matched-active-model" };
}
await this.logNeedsConfig(scopedDb, capability);
return { model: null, reason: "needs-config" };
```

Do not change `generate-structured.ts`: it already consumes a non-null resolved route without knowing whether it came from a manual binding or provider-default fallback.

- [ ] **Step 4: Run the focused integration files and verify GREEN**

Run the same two-file integration command from Task 1.

Expected: both files PASS; unchanged IDs survive, removed model falls back within the instance-default provider, and stale/disabled binding no longer returns hard `needs-config` when a default exists.

- [ ] **Step 5: Run formatting, typecheck, and focused integration once more**

```bash
pnpm prettier --write packages/ai/src/discover-and-persist-models.ts \
  packages/ai/src/repository.ts packages/ai/src/auto-register.ts \
  tests/integration/ai-auto-register.test.ts tests/integration/ai-structured.test.ts \
  docs/superpowers/plans/2026-07-16-1083-f2-reconcile-binding-preserve.md
pnpm typecheck
JARVIS_PGDATABASE=jarv1s_c2_1083 pnpm exec tsx scripts/test-integration.ts \
  tests/integration/ai-auto-register.test.ts tests/integration/ai-structured.test.ts
```

Expected: all commands exit 0.

### Task 3: Full gate and coordinated handoff

**Files:**

- Verify all explicit modified paths above.

- [ ] **Step 1: Run the required full gate with the isolated database**

```bash
export JARVIS_PGDATABASE=jarv1s_c2_1083
pnpm verify:foundation > /tmp/vf-c2-1083.log 2>&1; echo "VF_EXIT=$?"
```

Expected: `VF_EXIT=0`. Read the log summary directly; never pipe the gate.

- [ ] **Step 2: Run release-hardening audit and pre-push trio**

```bash
pnpm audit:release-hardening > /tmp/cb-audit-c2-1083.log 2>&1; echo "AUDIT_EXIT=$?"
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: `AUDIT_EXIT=0` and all fast checks exit 0.

- [ ] **Step 3: Rebase, commit explicit paths, push, and open the PR**

Fetch/rebase `origin/main`, stage only the approved spec/plan paths the Coordinator confirms plus the five implementation/test paths, commit with Codex attribution and a user-facing summary, push `fix/1083-f2-reconcile-binding`, and open a PR against `main` referencing #1083 F2. The PR body must state root cause, `VF_EXIT`, exit criterion, and that natural-key + FK restructuring remains deferred under #869/#860. Do not merge or deploy.

---

Self-review: covers both approved integration cases, unchanged login-ready flow, residual dangle fallback, no migration, full gate, explicit staging, PR evidence, and deferred re-architecture. No placeholder work remains.
