# Instance Settings Cleanup — Typed Registry & PATCH Fail-Close

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fail-close the generic `PATCH /api/admin/settings/:key` endpoint against unknown keys and filter `GET /api/admin/settings` to registered, non-secret keys only.

**Architecture:** A new `instance-settings-keys.ts` module defines the authoritative key registry (const array + Set for O(1) lookup). The route layer imports from it — the guard in the PATCH handler returns 400 before reaching the repository; the GET handler filters the raw repository result before serializing. The repository itself stays general-purpose (no change).

**Tech Stack:** TypeScript, Fastify (v5), Kysely, Vitest (integration tests against real Postgres via `pnpm db:up`).

## Global Constraints

- `pnpm check:file-size` enforces a **1000-line cap** on all source files. `packages/settings/src/routes.ts` is currently **953 lines** — stay under 1000 after edits.
- **Never edit applied migrations.** This feature is code-only; no migration needed.
- **`assertAdminUser` must remain** on both the PATCH and GET handlers — do not remove or reorder it.
- **No secret enumeration in PATCH error bodies** — the 400 response must not reveal which keys are valid.
- Repository methods stay general-purpose; key filtering belongs in the route layer.
- Stage only this task's files when committing. Never `git add -A`.
- Co-Authored-By trailer on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`

---

## File Map

| File                                              | Action     | Purpose                                                                                 |
| ------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `packages/settings/src/instance-settings-keys.ts` | **Create** | Key registry — authoritative list of known `app.instance_settings` keys                 |
| `packages/settings/src/routes.ts`                 | **Modify** | Import registry; add PATCH guard; filter GET response                                   |
| `tests/integration/auth-settings.test.ts`         | **Modify** | Fix the `provider-policy` test (unknown key → use a real key); add unknown-key 400 test |

---

## Task 1: Key registry module

**Files:**

- Create: `packages/settings/src/instance-settings-keys.ts`

**Interfaces:**

- Produces:
  - `InstanceSettingKeyEntry` — `{ key: string; secret?: boolean }`
  - `INSTANCE_SETTINGS_REGISTRY` — `readonly InstanceSettingKeyEntry[]` (5 entries)
  - `KNOWN_INSTANCE_SETTING_KEYS` — `ReadonlySet<string>` (Set of all key strings, for O(1) lookup)

- [ ] **Step 1: Create the registry file**

```typescript
// packages/settings/src/instance-settings-keys.ts

export interface InstanceSettingKeyEntry {
  readonly key: string;
  readonly secret?: boolean;
}

export const INSTANCE_SETTINGS_REGISTRY: readonly InstanceSettingKeyEntry[] = [
  { key: "registration.enabled" },
  { key: "registration.requires_approval" },
  { key: "chat.multiplexer" },
  { key: "onboarding.state" },
  { key: "ai.chat_model_override.enabled" }
] as const;

export const KNOWN_INSTANCE_SETTING_KEYS: ReadonlySet<string> = new Set(
  INSTANCE_SETTINGS_REGISTRY.map((e) => e.key)
);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/settings/src/instance-settings-keys.ts
git commit -m "feat(settings): add INSTANCE_SETTINGS_REGISTRY key list

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: PATCH fail-close + GET filter

**Files:**

- Modify: `packages/settings/src/routes.ts`

**Interfaces:**

- Consumes:
  - `INSTANCE_SETTINGS_REGISTRY` from `./instance-settings-keys.js`
  - `KNOWN_INSTANCE_SETTING_KEYS` from `./instance-settings-keys.js`

> **Line-count check first:** Run `wc -l packages/settings/src/routes.ts`. It must be ≤ 953 before you start. The changes add ~6 lines total → expect ≤ 959 after.

- [ ] **Step 1: Write the failing integration tests**

In `tests/integration/auth-settings.test.ts`, find the test at line ~342 called `"lets admins patch instance settings"`. It currently PATCHes key `"provider-policy"` and expects 200. This is the open surface we're closing.

Replace that test and add an unknown-key rejection test after it:

```typescript
// Replace the existing "lets admins patch instance settings" test:
it("lets admins patch instance settings (known key)", async () => {
  const settingResponse = await server.inject({
    method: "PATCH",
    url: "/api/admin/settings/registration.enabled",
    headers: {
      cookie: ownerCookie
    },
    payload: {
      value: true
    }
  });

  expect(settingResponse.statusCode).toBe(200);
  expect(settingResponse.json()).toMatchObject({
    setting: {
      key: "registration.enabled",
      value: true,
      updatedByUserId: ownerUserId
    }
  });
});

// Add immediately after:
it("rejects PATCH for unknown settings key with 400", async () => {
  const response = await server.inject({
    method: "PATCH",
    url: "/api/admin/settings/provider-policy",
    headers: {
      cookie: ownerCookie
    },
    payload: {
      value: { maxDataClass: "private" }
    }
  });

  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run the tests — confirm both fail for the right reason**

```bash
pnpm test:integration 2>&1 | grep -A5 "lets admins patch\|rejects PATCH"
```

Expected: "lets admins patch instance settings (known key)" fails (200 vs 400 or similar), "rejects PATCH for unknown settings key" fails (200 vs 400).

- [ ] **Step 3: Add import in routes.ts**

At the end of the local-package import block in `packages/settings/src/routes.ts` (around line 68, after the `registerSourceBehaviorRoutes` import), add:

```typescript
import {
  INSTANCE_SETTINGS_REGISTRY,
  KNOWN_INSTANCE_SETTING_KEYS
} from "./instance-settings-keys.js";
```

- [ ] **Step 4: Add PATCH guard in routes.ts**

Find the PATCH handler (around line 274). After `const body = parseInstanceSettingBody(request.body);`, add the guard:

The handler currently looks like:

```typescript
server.patch<{ Params: SettingParams }>(
  "/api/admin/settings/:key",
  { schema: upsertInstanceSettingRouteSchema },
  async (request, reply) => {
    try {
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = parseInstanceSettingBody(request.body);
      const setting = await dependencies.dataContext.withDataContext(
```

Change it to:

```typescript
server.patch<{ Params: SettingParams }>(
  "/api/admin/settings/:key",
  { schema: upsertInstanceSettingRouteSchema },
  async (request, reply) => {
    try {
      if (!KNOWN_INSTANCE_SETTING_KEYS.has(request.params.key)) {
        return reply.status(400).send({ error: "Unknown settings key" });
      }
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = parseInstanceSettingBody(request.body);
      const setting = await dependencies.dataContext.withDataContext(
```

Note: The guard fires before `resolveAccessContext` — this is intentional. Unknown-key rejection is a format check, not an auth check. `assertAdminUser` inside the `withDataContext` closure is unchanged and still guards the actual write.

- [ ] **Step 5: Add GET filter in routes.ts**

Find the GET handler (around line 253). It currently returns:

```typescript
return { settings: settings.map(serializeInstanceSetting) };
```

Change it to filter by registry (known + non-secret only):

```typescript
const registeredKeys = new Set(
  INSTANCE_SETTINGS_REGISTRY.filter((e) => !e.secret).map((e) => e.key)
);
return {
  settings: settings.filter((s) => registeredKeys.has(s.key)).map(serializeInstanceSetting)
};
```

- [ ] **Step 6: Verify line count stays under 1000**

```bash
wc -l packages/settings/src/routes.ts
```

Expected: ≤ 999.

- [ ] **Step 7: Run the failing tests — confirm both now pass**

```bash
pnpm test:integration 2>&1 | grep -A5 "lets admins patch\|rejects PATCH"
```

Expected: both tests PASS.

- [ ] **Step 8: Run the full integration suite to catch regressions**

```bash
pnpm db:up
pnpm test:integration
```

Expected: all tests pass. Pay attention to:

- `"records audit events for bootstrap and settings actions"` — still expects `"instance_setting.upsert"` in the audit log (the updated PATCH test with `registration.enabled` still triggers this)
- `chat-multiplexer-admin` tests
- `release-hardening` tests

- [ ] **Step 9: Run pre-push checks**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all green. If `format:check` fails, run `pnpm format` then re-check.

- [ ] **Step 10: Commit**

```bash
git add packages/settings/src/routes.ts tests/integration/auth-settings.test.ts
git commit -m "feat(settings): fail-close PATCH on unknown keys; filter GET by registry

- PATCH /api/admin/settings/:key → 400 for any key not in INSTANCE_SETTINGS_REGISTRY
- GET /api/admin/settings filters to registered, non-secret keys only
- assertAdminUser unchanged on both handlers
- Updates auth-settings integration test: replaces open-surface provider-policy test
  with known-key test; adds explicit 400 test for unknown keys

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

### Spec coverage

| Spec requirement                                 | Task covering it                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Typed key registry with all 5 known keys         | Task 1                                                           |
| `PATCH` fail-close — unknown key → 400           | Task 2, Step 4                                                   |
| `GET` returns only registered, non-secret values | Task 2, Step 5                                                   |
| `secret` flag on registry type for future use    | Task 1 (`secret?: boolean` on `InstanceSettingKeyEntry`)         |
| `assertAdminUser` preserved                      | Steps 4–5 (explicitly noted in comments)                         |
| `pnpm verify:foundation` passes                  | Step 8–9                                                         |
| No migration                                     | ✓ no migration in any task                                       |
| Settings write audit still value-free            | ✓ no change to `upsertInstanceSetting` or audit row construction |

### Security check

- PATCH guard error body is `{ error: "Unknown settings key" }` — does not reveal which keys ARE valid ✓
- Guard fires before `resolveAccessContext` — this leaks timing info to an unauthenticated caller (they can distinguish unknown-key vs valid-key before auth). Given admin-gating makes this moot for external callers (unauthenticated requests never reach Fastify route handlers without a valid session cookie), acceptable. If you prefer defense in depth, move the guard to after `assertAdminUser` inside the `withDataContext` closure — both are correct per the spec.
- `GET` filter excludes any `secret: true` keys (future-proof) ✓

### Placeholder scan

No TBD/TODO/placeholder items found. All code blocks are complete.

### Type consistency

- `InstanceSettingKeyEntry.key` (string) matches `KNOWN_INSTANCE_SETTING_KEYS.has(request.params.key)` (string) ✓
- `INSTANCE_SETTINGS_REGISTRY.filter(...).map(e => e.key)` produces `string[]` → `Set<string>` ✓
- `s.key` in GET filter is `string` (from `InstanceSetting.key`) ✓
