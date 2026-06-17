# Source-Behavior Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Calendar and Email source behaviors real, persisted per user, registry-driven, and enforced for the live "include in briefings" behavior.

**Architecture:** Add `sourceBehaviors` declarations to module manifests, then centralize policy evaluation in a small `@jarv1s/source-behaviors` package that depends on `@jarv1s/db` + `@jarv1s/module-sdk` but not settings or structured-state. Settings exposes `/api/me/source-behaviors` through a new route file using the already injected `PreferencesRepository` port; briefings consumes the same helper through injected compose deps.

**Tech Stack:** TypeScript, Fastify, Kysely `DataContextDb`, module manifests, React Query, Vitest integration/unit tests.

---

## File Structure

- Restore approved spec: `docs/superpowers/specs/2026-06-15-source-behavior-policy.md`
- Modify manifest contract: `packages/module-sdk/src/index.ts`
- Create policy package: `packages/source-behaviors/package.json`, `packages/source-behaviors/src/index.ts`
- Wire workspace package: `tsconfig.json`, `pnpm-lock.yaml`
- Modify declarations: `packages/calendar/src/manifest.ts`, `packages/email/src/manifest.ts`
- Add shared DTO/schema: `packages/shared/src/platform-api.ts`
- Add settings route split: `packages/settings/src/source-behavior-routes.ts`, `packages/settings/src/routes.ts`, `packages/settings/src/index.ts`, `packages/settings/src/manifest.ts`, `packages/settings/package.json`
- Wire briefings enforcement: `packages/briefings/src/compose.ts`, `packages/briefings/src/jobs.ts`, `packages/briefings/package.json`, `packages/module-registry/src/index.ts`
- Update web API/UI: `apps/web/src/api/client.ts`, `apps/web/src/api/query-keys.ts`, `apps/web/src/settings/settings-data-source-model.ts`, `apps/web/src/settings/settings-personal-data-panes.tsx`
- Tests: `tests/unit/source-behaviors.test.ts`, `tests/unit/route-coverage.test.ts`, `tests/unit/web-settings-data-source-model.test.ts`, `tests/unit/briefings-compose.test.ts`, `tests/integration/source-behaviors.test.ts`, `tests/integration/briefings.test.ts`

## Task 0: Restore Approved Spec Into This Branch

**Files:**

- Create: `docs/superpowers/specs/2026-06-15-source-behavior-policy.md`

- [ ] **Step 1: Restore exact approved spec from local commit**

Run:

```bash
git show 5e4a43b:docs/superpowers/specs/2026-06-15-source-behavior-policy.md > /tmp/source-behavior-policy.spec.md
```

Then add the file with the exact `/tmp/source-behavior-policy.spec.md` content.

- [ ] **Step 2: Verify restored content matches approved commit**

Run:

```bash
diff -u <(git show 5e4a43b:docs/superpowers/specs/2026-06-15-source-behavior-policy.md) docs/superpowers/specs/2026-06-15-source-behavior-policy.md
```

Expected: no output, exit `0`.

- [ ] **Step 3: Commit doc restore**

```bash
git add docs/superpowers/specs/2026-06-15-source-behavior-policy.md
git commit -m "docs(spec): restore source behavior policy spec" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 1: Manifest Contract And Policy Helper

**Files:**

- Modify: `packages/module-sdk/src/index.ts`
- Create: `packages/source-behaviors/package.json`
- Create: `packages/source-behaviors/src/index.ts`
- Modify: `tsconfig.json`
- Modify after install: `pnpm-lock.yaml`
- Test: `tests/unit/source-behaviors.test.ts`

- [ ] **Step 1: Write failing unit tests**

Add tests that import `collectSourceBehaviors`, `isBehaviorEnabled`, and `SOURCE_BEHAVIOR_PREFERENCE_KEY` from `@jarv1s/source-behaviors`.

Cases:

```typescript
it("collects source behaviors from every module manifest in source/name order", () => {
  const behaviors = collectSourceBehaviors([
    manifestWithBehavior("email", "Email", "email.briefings", "include-in-briefings", "default-on"),
    manifestWithBehavior(
      "calendar",
      "Calendar",
      "calendar.briefings",
      "include-in-briefings",
      "default-on"
    )
  ]);

  expect(behaviors.map((b) => b.id)).toEqual(["calendar.briefings", "email.briefings"]);
});

it("uses user override before declared default", async () => {
  const enabled = await isBehaviorEnabled(
    fakeScopedDb,
    {
      manifests: [
        manifestWithBehavior(
          "calendar",
          "Calendar",
          "calendar.briefings",
          "include-in-briefings",
          "default-on"
        )
      ],
      preferencesRepository: prefRepo({
        [SOURCE_BEHAVIOR_PREFERENCE_KEY]: { "calendar.briefings": false }
      })
    },
    "calendar.briefings"
  );

  expect(enabled).toBe(false);
});

it("always returns false for coming-soon behaviors even if stored true", async () => {
  const enabled = await isBehaviorEnabled(
    fakeScopedDb,
    {
      manifests: [
        manifestWithBehavior(
          "calendar",
          "Calendar",
          "calendar.writeback",
          "write-events-back",
          "coming-soon"
        )
      ],
      preferencesRepository: prefRepo({
        [SOURCE_BEHAVIOR_PREFERENCE_KEY]: { "calendar.writeback": true }
      })
    },
    "calendar.writeback"
  );

  expect(enabled).toBe(false);
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run tests/unit/source-behaviors.test.ts
```

Expected: fail because `@jarv1s/source-behaviors` does not exist.

- [ ] **Step 3: Implement minimal contract + helper**

Add to `packages/module-sdk/src/index.ts`:

```typescript
export type SourceBehaviorDefault = "default-on" | "default-off" | "coming-soon";
export type SourceBehaviorKind =
  | "include-in-briefings"
  | "planning"
  | "detect-commitments"
  | "write-events-back"
  | "capture-tasks"
  | "thread-summaries"
  | "send-on-behalf";

export interface SourceBehaviorDecl {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceDescription: string;
  readonly name: string;
  readonly description: string;
  readonly kind: SourceBehaviorKind;
  readonly default: SourceBehaviorDefault;
}
```

Extend `JarvisModuleManifest`:

```typescript
readonly sourceBehaviors?: readonly SourceBehaviorDecl[];
```

Create `packages/source-behaviors/src/index.ts` with:

```typescript
import type { DataContextDb } from "@jarv1s/db";
import type { JarvisModuleManifest, SourceBehaviorDecl } from "@jarv1s/module-sdk";

export const SOURCE_BEHAVIOR_PREFERENCE_KEY = "sourceBehaviors";

export interface SourceBehaviorPreferencesPort {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  upsert(scopedDb: DataContextDb, key: string, value: unknown): Promise<void>;
}

export interface SourceBehaviorPolicyDeps {
  readonly manifests: readonly JarvisModuleManifest[];
  readonly preferencesRepository: SourceBehaviorPreferencesPort;
}

export function collectSourceBehaviors(
  manifests: readonly JarvisModuleManifest[]
): SourceBehaviorDecl[] {
  return manifests
    .flatMap((manifest) => manifest.sourceBehaviors ?? [])
    .slice()
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.name.localeCompare(b.name));
}

export async function isBehaviorEnabled(
  scopedDb: DataContextDb,
  deps: SourceBehaviorPolicyDeps,
  behaviorId: string
): Promise<boolean> {
  const behavior = collectSourceBehaviors(deps.manifests).find((item) => item.id === behaviorId);
  if (!behavior || behavior.default === "coming-soon") return false;
  const stored = await deps.preferencesRepository.get(scopedDb, SOURCE_BEHAVIOR_PREFERENCE_KEY);
  const overrides = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const override = overrides[behaviorId];
  if (typeof override === "boolean") return override;
  return behavior.default === "default-on";
}
```

- [ ] **Step 4: Wire package**

Add `packages/source-behaviors/package.json` with dependencies on `@jarv1s/db` and `@jarv1s/module-sdk`, add `@jarv1s/source-behaviors` to root `tsconfig.json` paths, then run:

```bash
pnpm install
```

- [ ] **Step 5: Run GREEN**

```bash
pnpm exec vitest run tests/unit/source-behaviors.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/module-sdk/src/index.ts packages/source-behaviors/package.json packages/source-behaviors/src/index.ts tests/unit/source-behaviors.test.ts tsconfig.json pnpm-lock.yaml
git commit -m "feat(source-behaviors): add manifest-driven policy helper" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 2: Calendar And Email Declarations

**Files:**

- Modify: `packages/calendar/src/manifest.ts`
- Modify: `packages/email/src/manifest.ts`
- Test: `tests/unit/source-behaviors.test.ts`

- [ ] **Step 1: Add failing manifest aggregation test**

Append a test that imports `calendarModuleManifest` and `emailModuleManifest`, then expects IDs:

```typescript
expect(
  collectSourceBehaviors([calendarModuleManifest, emailModuleManifest]).map((b) => b.id)
).toEqual([
  "calendar.briefings",
  "calendar.planning",
  "calendar.detect-commitments",
  "calendar.writeback",
  "email.briefings",
  "email.capture-tasks",
  "email.thread-summaries",
  "email.send-on-behalf"
]);
```

Expected live defaults:

```typescript
expect(byId("calendar.briefings").default).toBe("default-on");
expect(byId("email.briefings").default).toBe("default-on");
expect(byId("calendar.planning").default).toBe("coming-soon");
expect(byId("email.capture-tasks").default).toBe("coming-soon");
```

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run tests/unit/source-behaviors.test.ts
```

Expected: fail because built-in manifests do not declare behaviors.

- [ ] **Step 3: Declare behaviors in owning manifests**

Calendar declarations:

```typescript
sourceBehaviors: [
  {
    id: "calendar.briefings",
    sourceId: "calendar",
    sourceName: "Calendar",
    sourceDescription:
      "What Jarvis is allowed to do with your calendar — independent of whichever service powers it.",
    name: "Include in briefings",
    description: "Surface today's events in the morning reading.",
    kind: "include-in-briefings",
    default: "default-on"
  },
  {
    id: "calendar.planning",
    sourceId: "calendar",
    sourceName: "Calendar",
    sourceDescription:
      "What Jarvis is allowed to do with your calendar — independent of whichever service powers it.",
    name: "Use for planning",
    description: "Jarvis schedules its own focus blocks around your events.",
    kind: "planning",
    default: "coming-soon"
  },
  {
    id: "calendar.detect-commitments",
    sourceId: "calendar",
    sourceName: "Calendar",
    sourceDescription:
      "What Jarvis is allowed to do with your calendar — independent of whichever service powers it.",
    name: "Detect commitments",
    description: "Turn meeting language into a tracked commitment.",
    kind: "detect-commitments",
    default: "coming-soon"
  },
  {
    id: "calendar.writeback",
    sourceId: "calendar",
    sourceName: "Calendar",
    sourceDescription:
      "What Jarvis is allowed to do with your calendar — independent of whichever service powers it.",
    name: "Write events back",
    description: "Let Jarvis create and move calendar events for you.",
    kind: "write-events-back",
    default: "coming-soon"
  }
];
```

Email declarations:

```typescript
sourceBehaviors: [
  {
    id: "email.briefings",
    sourceId: "email",
    sourceName: "Email",
    sourceDescription:
      "What Jarvis is allowed to do with your email — independent of whichever service powers it.",
    name: "Include in briefings",
    description: "Flag threads that need a reply today.",
    kind: "include-in-briefings",
    default: "default-on"
  },
  {
    id: "email.capture-tasks",
    sourceId: "email",
    sourceName: "Email",
    sourceDescription:
      "What Jarvis is allowed to do with your email — independent of whichever service powers it.",
    name: "Capture tasks",
    description: "Turn emails into tasks when they imply an action.",
    kind: "capture-tasks",
    default: "coming-soon"
  },
  {
    id: "email.thread-summaries",
    sourceId: "email",
    sourceName: "Email",
    sourceDescription:
      "What Jarvis is allowed to do with your email — independent of whichever service powers it.",
    name: "Thread summaries",
    description: "Condense long threads before you open them.",
    kind: "thread-summaries",
    default: "coming-soon"
  },
  {
    id: "email.send-on-behalf",
    sourceId: "email",
    sourceName: "Email",
    sourceDescription:
      "What Jarvis is allowed to do with your email — independent of whichever service powers it.",
    name: "Send on my behalf",
    description: "Draft and send replies, with your approval.",
    kind: "send-on-behalf",
    default: "coming-soon"
  }
];
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm exec vitest run tests/unit/source-behaviors.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/calendar/src/manifest.ts packages/email/src/manifest.ts tests/unit/source-behaviors.test.ts
git commit -m "feat(modules): declare source behaviors in manifests" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 3: Settings API Routes

**Files:**

- Modify: `packages/shared/src/platform-api.ts`
- Create: `packages/settings/src/source-behavior-routes.ts`
- Modify: `packages/settings/src/routes.ts`
- Modify: `packages/settings/src/index.ts`
- Modify: `packages/settings/src/manifest.ts`
- Modify: `packages/settings/package.json`
- Test: `tests/integration/source-behaviors.test.ts`
- Test: `tests/unit/route-coverage.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `tests/integration/source-behaviors.test.ts` using the existing integration test database helpers. Test:

```typescript
it("lists declared source behaviors with current per-user values", async () => {
  const response = await server.inject({
    method: "GET",
    url: "/api/me/source-behaviors",
    headers: userAHeaders()
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().sources.map((s) => s.id)).toContain("calendar");
  expect(findBehavior(response.json(), "calendar.briefings")).toMatchObject({
    enabled: true,
    default: "default-on",
    toggleable: true
  });
  expect(findBehavior(response.json(), "calendar.writeback")).toMatchObject({
    enabled: false,
    default: "coming-soon",
    toggleable: false
  });
});

it("lets a non-admin set only their own live source-behavior toggles", async () => {
  const put = await server.inject({
    method: "PUT",
    url: "/api/me/source-behaviors/calendar.briefings",
    headers: userAHeaders(),
    payload: { enabled: false }
  });
  expect(put.statusCode).toBe(200);
  expect(findBehavior(put.json(), "calendar.briefings").enabled).toBe(false);
  const userB = await server.inject({
    method: "GET",
    url: "/api/me/source-behaviors",
    headers: userBHeaders()
  });
  expect(findBehavior(userB.json(), "calendar.briefings").enabled).toBe(true);
});

it("rejects coming-soon writes", async () => {
  const response = await server.inject({
    method: "PUT",
    url: "/api/me/source-behaviors/email.capture-tasks",
    headers: userAHeaders(),
    payload: { enabled: true }
  });
  expect(response.statusCode).toBe(422);
});

it("includes newly declared test-module behavior in list API", async () => {
  const response = await serverWithExtraManifest.inject({
    method: "GET",
    url: "/api/me/source-behaviors",
    headers: userAHeaders()
  });
  expect(findBehavior(response.json(), "test-source.briefings")).toMatchObject({
    sourceId: "test-source",
    enabled: false
  });
});
```

Also add route coverage expectations for `GET /api/me/source-behaviors` and `PUT /api/me/source-behaviors/:id`.

- [ ] **Step 2: Run RED**

```bash
JARVIS_PGDATABASE=jarvis_build_sourcebhv247 pnpm exec vitest run tests/integration/source-behaviors.test.ts tests/unit/route-coverage.test.ts
```

Expected: route/schema imports missing or `404`.

- [ ] **Step 3: Add shared DTOs and schemas**

In `platform-api.ts`, add `SourceBehaviorDto`, `SourceBehaviorSourceDto`, `ListSourceBehaviorsResponse`, `PutSourceBehaviorRequest`, `PutSourceBehaviorResponse`, `listSourceBehaviorsRouteSchema`, and `putSourceBehaviorRouteSchema`. Response behavior fields: `id`, `sourceId`, `name`, `description`, `kind`, `default`, `enabled`, `toggleable`.

- [ ] **Step 4: Implement new route file**

`registerSourceBehaviorRoutes(server, deps)`:

- `GET /api/me/source-behaviors`: resolve access context, run under `withDataContext`, call `listSourceBehaviorStates(scopedDb, { manifests: deps.listModuleManifests(), preferencesRepository })`, group by source.
- `PUT /api/me/source-behaviors/:id`: reject unknown and `coming-soon` with `HttpError(422, ...)`, read current overrides from `SOURCE_BEHAVIOR_PREFERENCE_KEY`, write merged boolean map with `preferencesRepository.upsert`, return fresh grouped response.

- [ ] **Step 5: Wire settings routes without growing `routes.ts`**

Import and call `registerSourceBehaviorRoutes(server, { ...dependencies, preferencesRepository })` next to locale/persona route registration. Do not add route bodies to `routes.ts` because it is already 998 lines.

- [ ] **Step 6: Run GREEN**

```bash
JARVIS_PGDATABASE=jarvis_build_sourcebhv247 pnpm exec vitest run tests/integration/source-behaviors.test.ts tests/unit/route-coverage.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/platform-api.ts packages/settings/src/source-behavior-routes.ts packages/settings/src/routes.ts packages/settings/src/index.ts packages/settings/src/manifest.ts packages/settings/package.json tests/integration/source-behaviors.test.ts tests/unit/route-coverage.test.ts
git commit -m "feat(settings): expose per-user source behavior policy" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 4: Briefings Enforcement

**Files:**

- Modify: `packages/briefings/src/compose.ts`
- Modify: `packages/briefings/src/jobs.ts`
- Modify: `packages/briefings/package.json`
- Modify: `packages/module-registry/src/index.ts`
- Test: `tests/unit/briefings-compose.test.ts`
- Test: `tests/integration/briefings.test.ts`

- [ ] **Step 1: Write failing unit test**

Add test:

```typescript
it("omits calendar and email sections when include-in-briefings behaviors are disabled", async () => {
  const deps = makeFakeDeps({
    disabledBehaviors: new Set(["calendar.briefings", "email.briefings"])
  });
  const result = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
  expect(result.sourceMetadata.calendarCount).toBe(0);
  expect(result.sourceMetadata.emailCount).toBe(0);
  expect(JSON.stringify(result)).not.toContain("Standup");
  expect(JSON.stringify(result)).not.toContain("budget");
});
```

- [ ] **Step 2: Write failing integration test**

In `tests/integration/briefings.test.ts`, before `repository.generateRun`, use `PreferencesRepository` under user A context to write `{ "calendar.briefings": false, "email.briefings": false }`, then expect run metadata has `calendarCount: 0`, `emailCount: 0`, and serialized run omits user A seeded calendar/email content.

- [ ] **Step 3: Run RED**

```bash
JARVIS_PGDATABASE=jarvis_build_sourcebhv247 pnpm exec vitest run tests/unit/briefings-compose.test.ts tests/integration/briefings.test.ts
```

Expected: tests fail because compose still gathers calendar/email.

- [ ] **Step 4: Inject policy dependency**

Extend `ComposeDeps`:

```typescript
readonly sourceBehaviorPolicy?: SourceBehaviorPolicyDeps;
```

Before gathering `calendar` and `email`, call `isBehaviorEnabled(scopedDb, deps.sourceBehaviorPolicy, "calendar.briefings")` / `"email.briefings"` when policy is present; if disabled, use empty `Section` with count `0` and no tool call.

Update `jobs.ts` default compose deps to use a small always-default policy only if needed, and update `module-registry/src/index.ts` production compose deps to inject:

```typescript
sourceBehaviorPolicy: {
  manifests: getBuiltInModuleManifests(),
  preferencesRepository: new PreferencesRepository()
}
```

- [ ] **Step 5: Run GREEN**

```bash
JARVIS_PGDATABASE=jarvis_build_sourcebhv247 pnpm exec vitest run tests/unit/briefings-compose.test.ts tests/integration/briefings.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/briefings/src/compose.ts packages/briefings/src/jobs.ts packages/briefings/package.json packages/module-registry/src/index.ts tests/unit/briefings-compose.test.ts tests/integration/briefings.test.ts
git commit -m "feat(briefings): honor source behavior policy" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 5: Web API And Settings UI

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-data-source-model.ts`
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
- Test: `tests/unit/web-settings-data-source-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Update `web-settings-data-source-model.test.ts` to cover server DTO mapping:

```typescript
expect(
  sourceBehaviorStatus({
    id: "calendar.briefings",
    name: "Include in briefings",
    description: "...",
    default: "default-on",
    enabled: true,
    toggleable: true
  })
).toEqual({ tone: "pine", label: "On" });
expect(
  sourceBehaviorStatus({
    id: "calendar.briefings",
    name: "Include in briefings",
    description: "...",
    default: "default-on",
    enabled: false,
    toggleable: true
  })
).toEqual({ tone: "neutral", label: "Off" });
expect(
  sourceBehaviorStatus({
    id: "calendar.writeback",
    name: "Write events back",
    description: "...",
    default: "coming-soon",
    enabled: false,
    toggleable: false
  })
).toEqual({ tone: "steel", label: "Coming soon" });
```

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run tests/unit/web-settings-data-source-model.test.ts
```

- [ ] **Step 3: Add client functions**

Add imports and functions:

```typescript
export async function listSourceBehaviors(): Promise<ListSourceBehaviorsResponse> {
  return requestJson<ListSourceBehaviorsResponse>("/api/me/source-behaviors");
}

export async function putSourceBehavior(
  id: string,
  body: PutSourceBehaviorRequest
): Promise<PutSourceBehaviorResponse> {
  return requestJson<PutSourceBehaviorResponse>(
    `/api/me/source-behaviors/${encodeURIComponent(id)}`,
    { method: "PUT", body }
  );
}
```

Add query key `queryKeys.settings.sourceBehaviors`.

- [ ] **Step 4: Render API-driven behaviors**

Remove `DATA_SOURCES`, fetch `listSourceBehaviors` in `SourcesPane`, map sources from API, select icon by `source.id`, show `Switch` for `toggleable` behaviors and disabled `Badge` for coming-soon. Mutation calls `putSourceBehavior(behavior.id, { enabled })`, updates query cache from response, and shows error toast on failure. Keep notes/vault `NotWired`; remove the calendar/email `BACKEND-TODO` text.

- [ ] **Step 5: Run GREEN**

```bash
pnpm exec vitest run tests/unit/web-settings-data-source-model.test.ts
pnpm --filter @jarv1s/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-data-source-model.ts apps/web/src/settings/settings-personal-data-panes.tsx tests/unit/web-settings-data-source-model.test.ts
git commit -m "feat(web): wire source behavior controls to API" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Task 6: Full Verification And PR Closeout

**Files:**

- No planned source edits; only fixes from verification if needed.

- [ ] **Step 1: Run targeted suites**

```bash
JARVIS_PGDATABASE=jarvis_build_sourcebhv247 pnpm exec vitest run tests/unit/source-behaviors.test.ts tests/unit/briefings-compose.test.ts tests/unit/web-settings-data-source-model.test.ts tests/unit/route-coverage.test.ts tests/integration/source-behaviors.test.ts tests/integration/briefings.test.ts
```

- [ ] **Step 2: Run requested pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

- [ ] **Step 3: Run full gate required by handoff**

```bash
JARVIS_PGDATABASE=jarvis_build_sourcebhv247 pnpm verify:foundation
```

- [ ] **Step 4: Use coordinated-wrap-up**

Run `coordinated-wrap-up`: clean tree by explicit paths, run `pnpm audit:release-hardening`, pre-push trio again, `git fetch origin main && git rebase origin/main`, push branch, open PR, report PR + gate evidence to `Coordinator`.

## Self-Review

- Spec coverage: manifest extension, policy helper, settings API, UI replacement, briefings enforcement, per-user isolation, dynamic test-module behavior, and coming-soon false behavior all mapped to tasks.
- Placeholder scan: no `TBD`, no vague "add tests" step; each test step names concrete behavior and commands.
- Type consistency: behavior ids use full stable ids (`calendar.briefings`, `email.briefings`) across manifest, preferences, API, UI, and briefings.
- Guardrails: no migration; route split avoids 998-line `packages/settings/src/routes.ts`; settings uses injected `PreferencesRepository` port; briefings uses helper and registry manifests, not calendar/email internals; no `apps/web/src/onboarding/**`; no `docs/coordination/**`.
