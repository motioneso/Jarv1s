# Wellness AI Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Coordination override:** `coordinated-build` disables execution sub-skills in this repo. Execute inline with TDD after Coordinator approval.

**Goal:** Add one editable Wellness AI-access consent switch and gate both Wellness read tools.

**Architecture:** Store explicit consent in `app.preferences` key `wellness.ai_consent_granted`. If unset, route reads derive from `resolveActiveModules`; tool reads inherit `true` because every production tool execution path already resolved the Wellness manifest from active modules before calling `execute`. This avoids importing `@jarv1s/module-registry` into `@jarv1s/wellness` and avoids loosening `AssistantToolGateway`'s current read-tool service ban.

**Tech Stack:** Fastify routes, `DataContextRunner`, `PreferencesRepository`, module settings connector, React, React Query, `@jarv1s/settings-ui`, Vitest.

---

## Verified Branch State / Drift

- Current branch: `build/wellness-ai-consent` at `7df6522`, base includes `ac56457` module settings connector.
- Connector shape is current and usable: `ModuleSettingsSurfaceManifest` has `entry?: string`; scanner imports `@jarv1s/<pkg>/<entry>`. Add `settings: [{ ..., entry: "./settings" }]` plus package export `./settings`.
- Spec drift: `AssistantToolGateway` forbids `requiresServices` on `risk: "read"` tools and passes `{}` to read tools. Do not use `ToolServices` for Wellness read consent unless Coordinator explicitly wants gateway policy changed.
- Current `wellness.recentCheckIns` gates only explicit truthy pref, so unset denies instead of default-ON. `wellness.medicationAdherence` has no gate.
- No migration needed.

## Files

- Create `packages/wellness/src/ai-consent.ts`: preference key, effective-consent helper, result helper.
- Modify `packages/wellness/src/tools.ts`: call helper from both tools; accept `services` only for future compatibility, production default active.
- Modify `packages/wellness/src/routes.ts`: add GET/PUT `/api/wellness/ai-consent`; dependency gets `resolveActiveModules`.
- Modify `packages/wellness/src/manifest.ts`: add settings surface and route metadata.
- Modify `packages/wellness/src/settings/index.tsx`: contributed settings UI.
- Modify `packages/wellness/package.json`: export `./settings`; add `@jarv1s/settings-ui`, `@tanstack/react-query`, `react` deps if typecheck requires explicit package deps.
- Modify `packages/shared/src/wellness-api.ts`: consent DTOs/schemas.
- Modify `packages/module-registry/src/index.ts`: pass `resolveActiveModules` into Wellness routes.
- Tests: `tests/integration/wellness.test.ts`, `tests/integration/wellness-phase2.test.ts`, `tests/unit/module-settings-scanner.test.ts` if needed.

---

### Task 1: Consent Helper + Tool Gates

**Files:**

- Create: `packages/wellness/src/ai-consent.ts`
- Modify: `packages/wellness/src/tools.ts`
- Test: `tests/integration/wellness.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests near existing Wellness assistant-tool tests:

```ts
it("defaults Wellness AI consent on when pref is unset on active tool path", async () => {
  await dataContext.withDataContext(ctx(userId), async (db) => {
    await new WellnessRepository().createCheckin(db, { feelingCore: "happy", intensity: 4 });
    const result = await wellnessRecentCheckInsExecute(db, {}, toolCtx(userId));
    expect(result.data).toHaveProperty("items");
  });
});

it("denies both Wellness read tools when AI consent is explicitly false", async () => {
  const prefs = new PreferencesRepository();
  await dataContext.withDataContext(ctx(userId), async (db) => {
    await prefs.upsert(db, "wellness.ai_consent_granted", false);
    await expect(wellnessRecentCheckInsExecute(db, {}, toolCtx(userId))).resolves.toMatchObject({
      data: { code: "WELLNESS_CONSENT_REQUIRED" }
    });
    await expect(
      wellnessMedicationAdherenceExecute(db, {}, toolCtx(userId))
    ).resolves.toMatchObject({
      data: { code: "WELLNESS_CONSENT_REQUIRED" }
    });
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm vitest run tests/integration/wellness.test.ts --runInBand`

Expected now: default-on test fails for check-ins; meds-deny test fails for meds tool.

- [ ] **Step 3: Implement minimal helper and gate**

`packages/wellness/src/ai-consent.ts`:

```ts
import type { DataContextDb } from "@jarv1s/db";
import type { ToolResult, ToolServices } from "@jarv1s/module-sdk";
import type { PreferencesRepository } from "@jarv1s/structured-state";

export const WELLNESS_AI_CONSENT_PREFERENCE_KEY = "wellness.ai_consent_granted";

export interface WellnessActiveService {
  readonly wellnessActive?: boolean;
}

export async function resolveEffectiveWellnessConsent(
  scopedDb: DataContextDb,
  preferences: PreferencesRepository,
  services: ToolServices | undefined,
  fallbackWellnessActive: boolean
): Promise<boolean> {
  const explicit = await preferences.get(scopedDb, WELLNESS_AI_CONSENT_PREFERENCE_KEY);
  if (explicit === true || explicit === false) return explicit;
  const injected = (services as WellnessActiveService | undefined)?.wellnessActive;
  return injected ?? fallbackWellnessActive;
}

export function wellnessConsentRequiredResult(): ToolResult {
  return { data: { error: "Consent not granted", code: "WELLNESS_CONSENT_REQUIRED" } };
}
```

In `tools.ts`, pass `services` as 4th arg and call helper with `fallbackWellnessActive: true` before reading check-ins/logs.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/integration/wellness.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/wellness/src/ai-consent.ts packages/wellness/src/tools.ts tests/integration/wellness.test.ts
git commit -m "feat(wellness): gate AI read tools by consent"
```

### Task 2: Consent REST Contract + Routes

**Files:**

- Modify: `packages/shared/src/wellness-api.ts`
- Modify: `packages/wellness/src/routes.ts`
- Modify: `packages/wellness/src/manifest.ts`
- Modify: `packages/module-registry/src/index.ts`
- Test: `tests/integration/wellness-phase2.test.ts`

- [ ] **Step 1: Write failing route tests**

Add route tests for:

- GET with no pref and resolver returning Wellness active -> `{ effective: true, explicit: null }`
- PUT false persists and GET returns `{ effective: false, explicit: false }`
- GET with no pref and resolver returning no Wellness -> `{ effective: false, explicit: null }`

- [ ] **Step 2: Run failing tests**

Run: `pnpm vitest run tests/integration/wellness-phase2.test.ts --runInBand`

Expected: 404 or missing route.

- [ ] **Step 3: Add shared DTOs/schemas**

Add:

```ts
export interface WellnessAiConsentResponse {
  readonly effective: boolean;
  readonly explicit: boolean | null;
}
export interface PutWellnessAiConsentRequest {
  readonly granted: boolean;
}
```

Add schemas with `additionalProperties: false`.

- [ ] **Step 4: Add route dependency + handlers**

Extend `WellnessRoutesDependencies` with:

```ts
readonly resolveActiveModules?: (actorUserId: string) => Promise<readonly { id: string }[]>;
```

GET reads explicit pref, resolves active modules, returns effective.

PUT validates `granted` boolean, upserts pref, returns explicit/effective.

- [ ] **Step 5: Wire registry + manifest**

In wellness manifest, add two route entries for `/api/wellness/ai-consent` with `wellness.view` and schemas.

In module registry Wellness registration, pass `resolveActiveModules: deps.resolveActiveModules`.

- [ ] **Step 6: Run tests + commit**

Run: `pnpm vitest run tests/integration/wellness-phase2.test.ts --runInBand`

Commit:

```bash
git add packages/shared/src/wellness-api.ts packages/wellness/src/routes.ts packages/wellness/src/manifest.ts packages/module-registry/src/index.ts tests/integration/wellness-phase2.test.ts
git commit -m "feat(wellness): add AI consent API"
```

### Task 3: Contributed Settings Surface

**Files:**

- Create: `packages/wellness/src/settings/index.tsx`
- Modify: `packages/wellness/src/manifest.ts`
- Modify: `packages/wellness/package.json`
- Test: `tests/unit/module-settings-scanner.test.ts` if scanner needs coverage beyond existing entry tests.

- [ ] **Step 1: Add manifest surface**

Add:

```ts
settings: [
  {
    id: "wellness.ai-consent",
    label: "Wellness",
    path: "/settings/modules/wellness",
    scope: "user",
    order: 40,
    permissionId: "wellness.view",
    entry: "./settings"
  }
],
```

Add package export:

```json
"./settings": "./src/settings/index.tsx"
```

- [ ] **Step 2: Create settings component**

Use `PaneHead`, `Group`, `Row`, `Switch`, `Badge`, `Note` from `@jarv1s/settings-ui`. Use React Query to GET/PUT `/api/wellness/ai-consent` with `fetch(..., { credentials: "include" })`. Show `Inherited` badge when `explicit === null`; disable switch during load/save.

- [ ] **Step 3: Run scanner/typecheck**

Run:

```bash
pnpm vitest run tests/unit/module-settings-scanner.test.ts tests/unit/module-settings-router.test.tsx
pnpm --filter @jarv1s/wellness typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/wellness/src/settings/index.tsx packages/wellness/src/manifest.ts packages/wellness/package.json tests/unit/module-settings-scanner.test.ts
git commit -m "feat(wellness): add AI consent settings surface"
```

### Task 4: Final Verification

**Files:** no code unless fixes needed.

- [ ] **Run focused checks**

```bash
pnpm vitest run tests/integration/wellness.test.ts tests/integration/wellness-phase2.test.ts tests/unit/module-settings-scanner.test.ts tests/unit/module-settings-router.test.tsx
pnpm --filter @jarv1s/wellness typecheck
```

- [ ] **Run required local gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

- [ ] **Before push**

```bash
git fetch origin main
git rebase origin/main
pnpm format:check && pnpm lint && pnpm typecheck
```

- [ ] **Wrap-up**

Use `coordinated-wrap-up`; do not merge, move board, or close issue.

## Spec Coverage Check

- User-visible settings control: Task 3.
- Contributed surface in `packages/wellness/src/settings/`: Task 3.
- Preference write: Task 2 + Task 3.
- Both tools gated: Task 1.
- Default ON/OFF derivation: Task 1 tool path + Task 2 route path.
- Inherited badge: Task 3.
- Immediate revocation: Task 1 per-call read; no cache.
- Jarvis explanation: existing `WELLNESS_CONSENT_REQUIRED` code retained.
- No migration / no context shape changes / no registry import into Wellness: all tasks.
