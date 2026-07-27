# Settings self-operation commands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. NOTE: this repo has execution-automation skills disabled — drive tasks manually per `coordinated-build`.

**Goal:** Let the Jarvis assistant write six user-preference settings (theme mode, locale region/date-format, locale timezone, quiet hours, weather location, notification-preference enable/disable) and one chat setting (response style) without a confirmation card, by declaring them as `granted_at_install` assistant tools with CAS-protected writes, an undo safety net, and audit logging.

**Architecture:** Each tool wraps an extracted application function that does read-current → validate → CAS-upsert → audit-write, reusing the existing Fastify route's preference key/shape so REST and assistant paths stay in sync. `app.preferences` gets a `revision` integer column for optimistic concurrency; a parallel `app.instance_settings` revision column lands as forward infra (no consumer in this PR). The `chat.setResponseStyle` tool lives on `packages/chat`'s own manifest per module isolation — settings never writes chat's data.

**Tech Stack:** Fastify, Kysely, `@jarv1s/module-sdk` `ModuleAssistantToolManifest`, Vitest.

## Global Constraints

- No admin private-data bypass; RLS applies to all actors (CLAUDE.md Hard Invariants).
- Every tool declares `selfOperationGrant: "granted_at_install"` and an `actionFamilyId` whose family's `allowedTiers` includes `trusted_auto`; `risk: "write"`, `executionPolicy: "auto"` (per `packages/ai/src/gateway/policy.ts` `resolvePolicy`, already grounded).
- Never edit an applied migration; never edit `packages/ai/sql/0127_jarvis_action_audit_log.sql` — widen its `outcome` CHECK via a NEW file.
- Migration numbers are global/landing-order — do not hardcode a number in any task; only state "next migration after `<highest known file>`" and let the actual filename be chosen at write time.
- Three migrations required, three different directories: `packages/structured-state/sql/` (preferences revision), `infra/postgres/migrations/` (instance_settings revision — core-owned), `packages/ai/sql/` (audit outcome CHECK widening).
- `chat.setResponseStyle`'s input is the closed three-value enum ONLY — no free-text/passthrough field, server-validated against the closed set, reject anything unrecognized (Coordinator Ruling 2). If this ever needs a free-text field, STOP and escalate — it would become assistant-brain self-modification and must not be `granted_at_install`.
- Digest notification settings are OUT OF SCOPE (Coordinator ruling — do not rename/narrow the exclusion prefix to route around it).
- Settings tools write audit rows only through the existing audit port (module isolation) — never construct/insert `app.jarvis_action_audit_log` rows from route/application code directly if a port function already exists; Task 1 confirms the exact call site.
- `tests/unit/self-operation-manifests.test.ts` exact-count assertions must be updated to add ONLY this PR's tools' contribution (settings: +6 tools; chat: +1 tool, on chat's own manifest/inventory) — do not touch counts belonging to sibling #1265.

---

## Assumptions flagged for coordinator review (not independently re-verified this pass — directive was plan-to-disk first)

1. **Audit port call site.** Assumed the tool-dispatch layer in `packages/ai/src/gateway/gateway.ts` already writes an audit row for every tool invocation (success/failure) using `actionFamilyId`/`toolName`, and that application functions only need to return a typed outcome (or throw a typed error) for the dispatcher to record — NOT call an audit-insert function themselves. Task 1's first step is to confirm this by reading the dispatcher; if wrong, the plan's later tasks swap "return outcome, let dispatcher record" for an explicit audit-port call, without changing tool shapes.
2. **CAS conflict outcome.** Assumed the audit outcome CHECK widening (`invalid`, `conflict`) maps 1:1 to: `invalid` = input failed validation (e.g., bad IANA zone), `conflict` = CAS revision mismatch. Task 0c pins the exact TS union location by reading it first.
3. **Undo stack ownership.** Assumed the undo stack is a small settings-module-local, in-memory, per-chat structure (not shared cross-module infra) since round-one only requires undo for settings' own six tools; `chat.setResponseStyle`'s own undo (if needed) is chat module's responsibility and is OUT of this plan — flag to coordinator in the PR body rather than build shared infra now.
4. **`app.instance_settings` revision column.** No round-one tool in this plan writes to `app.instance_settings` (all six settings tools use `app.preferences` via `PreferencesRepository`). Task 0b adds the column as forward infra per the locked 3-migration ruling but wires no repository consumer — flag this explicitly in the PR body so it isn't mistaken for dead code.
5. **`AiRepository.insertActionPolicyIfAbsent` / grant wiring.** Not re-read this pass. Assumed unchanged from prior grounding: install-time `trusted_auto` grant for `settings` is already generic (`resolveGrantSelfOperationForModule` only special-cases `tasks`) — no new wiring task for settings. `chat` module install-grant wiring is NOT confirmed generic — Task 7's first step confirms this for chat specifically before assuming it "just works."

---

## Task 0a: `app.preferences` CAS revision column + repository support

**Files:**
- Create: `packages/structured-state/sql/<next>_preferences_revision.sql` (next migration number after the highest existing file in this directory — confirm at write time, do not hardcode; grounded highest so far: `0167_worker_entities_grant.sql`)
- Modify: `packages/structured-state/src/preferences-repository.ts`
- Test: `packages/structured-state/src/preferences-repository.test.ts` (create if absent)

**Interfaces:**
- Produces: `PreferencesRepository.upsertWithRevision(scopedDb: DataContextDb, key: string, value: unknown, expectedRevision: number | null): Promise<{ revision: number }>` — throws `PreferenceRevisionConflictError` (new exported class, `packages/structured-state/src/preferences-repository.ts`) when `expectedRevision !== null` and the stored row's revision doesn't match (or the row is absent while `expectedRevision !== null`).
- Produces: `PreferencesRepository.getWithRevision(scopedDb: DataContextDb, key: string): Promise<{ value: unknown; revision: number } | null>`.

- [ ] **Step 1: Write the migration**

```sql
-- packages/structured-state/sql/<next>_preferences_revision.sql
ALTER TABLE app.preferences
  ADD COLUMN revision integer NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Write failing repository tests**

```ts
// packages/structured-state/src/preferences-repository.test.ts
import { describe, it, expect } from "vitest";
import { PreferencesRepository, PreferenceRevisionConflictError } from "./preferences-repository.js";
// (use this repo's existing integration-test DataContextDb harness pattern — see any
//  sibling *.test.ts in packages/structured-state/src/ for the withDataContext test setup)

describe("PreferencesRepository CAS", () => {
  it("creates a row at revision 1 when expectedRevision is null", async () => {
    // upsertWithRevision(db, "test-key", { a: 1 }, null) -> { revision: 1 }
  });

  it("increments revision on a matching CAS write", async () => {
    // seed revision 1, upsertWithRevision(db, key, value, 1) -> { revision: 2 }
  });

  it("throws PreferenceRevisionConflictError on mismatched revision", async () => {
    // seed revision 2, upsertWithRevision(db, key, value, 1) rejects with PreferenceRevisionConflictError
  });

  it("throws PreferenceRevisionConflictError when expectedRevision set but no row exists", async () => {
    // upsertWithRevision(db, "missing-key", value, 1) rejects
  });

  it("getWithRevision returns null for an absent key", async () => {
    // getWithRevision(db, "missing-key") -> null
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @jarv1s/structured-state test -- preferences-repository`
Expected: FAIL — `upsertWithRevision`/`getWithRevision`/`PreferenceRevisionConflictError` not defined.

- [ ] **Step 4: Implement CAS methods**

```ts
// packages/structured-state/src/preferences-repository.ts (add to existing class, keep upsert/get/list/delete as-is)
export class PreferenceRevisionConflictError extends Error {
  constructor(public readonly key: string) {
    super(`Preference "${key}" was modified concurrently`);
    this.name = "PreferenceRevisionConflictError";
  }
}

// inside PreferencesRepository:
async upsertWithRevision(
  scopedDb: DataContextDb,
  key: string,
  value: unknown,
  expectedRevision: number | null
): Promise<{ revision: number }> {
  assertDataContextDb(scopedDb);
  if (expectedRevision === null) {
    const row = await scopedDb.db
      .insertInto("app.preferences")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        key,
        value_json: jsonb(value),
        revision: 1,
        updated_at: new Date()
      })
      .onConflict((oc) => oc.columns(["owner_user_id", "key"]).doNothing())
      .returning("revision")
      .executeTakeFirst();
    if (!row) throw new PreferenceRevisionConflictError(key);
    return { revision: row.revision };
  }
  const row = await scopedDb.db
    .updateTable("app.preferences")
    .set({ value_json: jsonb(value), revision: expectedRevision + 1, updated_at: new Date() })
    .where("key", "=", key)
    .where("revision", "=", expectedRevision)
    .returning("revision")
    .executeTakeFirst();
  if (!row) throw new PreferenceRevisionConflictError(key);
  return { revision: row.revision };
}

async getWithRevision(
  scopedDb: DataContextDb,
  key: string
): Promise<{ value: unknown; revision: number } | null> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb.db
    .selectFrom("app.preferences")
    .select(["value_json", "revision"])
    .where("key", "=", key)
    .executeTakeFirst();
  return row ? { value: row.value_json, revision: row.revision } : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @jarv1s/structured-state test -- preferences-repository`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/structured-state/sql/ packages/structured-state/src/preferences-repository.ts packages/structured-state/src/preferences-repository.test.ts
git commit -m "feat(structured-state): add CAS revision column to app.preferences"
```

## Task 0b: `app.instance_settings` CAS revision column (forward infra, no consumer this PR)

**Files:**
- Create: `infra/postgres/migrations/<next>_instance_settings_revision.sql` (next after highest existing — grounded highest so far: `0156_module_installs.sql`; confirm at write time)

- [ ] **Step 1: Write the migration**

```sql
-- infra/postgres/migrations/<next>_instance_settings_revision.sql
ALTER TABLE app.instance_settings
  ADD COLUMN revision integer NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Confirm the migration applies cleanly**

Run: `pnpm migrate` (or this repo's equivalent migration-runner script per `package.json`)
Expected: migration applies with no error; `foundation.test.ts`'s full-migration-list assertion (per CLAUDE.md Test Traps memory) will need this filename added — do that in Task 0's final verification pass, not here (avoid a half-green intermediate commit).

- [ ] **Step 3: Commit**

```bash
git add infra/postgres/migrations/
git commit -m "feat(db): add revision column to app.instance_settings (forward infra, no consumer yet)"
```

## Task 0c: Widen audit outcome CHECK constraint + TS type

**Files:**
- Create: `packages/ai/sql/<next>_audit_outcome_widen.sql` (next after highest existing — grounded highest so far: `0173_...`; confirm exact filename at write time)
- Modify: the TS file that declares the audit outcome union type (locate by `grep -rn "'success'.*'failed'.*'denied'.*'cancelled'" packages/ai/src` — not yet re-confirmed this pass, per Assumption 2 above)
- Test: whichever `*.test.ts` currently exercises the audit port/repository (locate alongside the type)

**Interfaces:**
- Produces: TS outcome type widened from `"success" | "failed" | "denied" | "cancelled"` to `"success" | "failed" | "denied" | "cancelled" | "invalid" | "conflict"`.

- [ ] **Step 1: Read `packages/ai/sql/0127_jarvis_action_audit_log.sql` and the TS outcome type to confirm exact current text**

Run: `grep -rn "success.*failed.*denied.*cancelled\|outcome" packages/ai/src --include=*.ts -l`

- [ ] **Step 2: Write the migration**

```sql
-- packages/ai/sql/<next>_audit_outcome_widen.sql
ALTER TABLE app.jarvis_action_audit_log
  DROP CONSTRAINT jarvis_action_audit_log_outcome_check;
ALTER TABLE app.jarvis_action_audit_log
  ADD CONSTRAINT jarvis_action_audit_log_outcome_check
  CHECK (outcome IN ('success', 'failed', 'denied', 'cancelled', 'invalid', 'conflict'));
```

(Confirm the exact constraint name via `\d app.jarvis_action_audit_log` or reading `0127_jarvis_action_audit_log.sql` in full before writing — the name above is inferred from Postgres's default `<table>_<column>_check` convention, verify it matches.)

- [ ] **Step 3: Update the TS outcome union type** at the location found in Step 1, adding `"invalid" | "conflict"`.

- [ ] **Step 4: Run the affected test file(s) to confirm green**

Run: `pnpm --filter @jarv1s/ai test -- <the test file found in step 1>`
Expected: PASS (widening a union/CHECK is additive — no existing test should break; if one does, it's asserting the exact literal union and needs its expected array updated).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/sql/ packages/ai/src/
git commit -m "feat(ai): widen action-audit outcome CHECK with invalid/conflict"
```

## Task 1: Confirm audit-dispatch call site, then extract notification-preference toggle to an application function

**Files:**
- Read first (grounding step, not a file change): `packages/ai/src/gateway/gateway.ts` around the tool-dispatch/execute path — confirm Assumption 1 above (does the dispatcher auto-record an audit row per tool call, or must application code call an audit port explicitly?). Adjust every later task's "audit" step accordingly — if explicit, each application function below additionally calls the confirmed audit-port function with `{ actorUserId, actionFamilyId, toolName, outcome }` after its CAS write/validation.
- Create: `packages/settings/src/notification-preference-application.ts`
- Modify: `packages/settings/src/notification-preferences-routes.ts` (replace inline logic at lines 66-107 with a call to the new function)
- Test: `packages/settings/src/notification-preference-application.test.ts`

**Interfaces:**
- Produces: `setNotificationPreferenceEnabled(scopedDb: DataContextDb, deps: { listModuleManifests: () => readonly JarvisModuleManifest[]; preferencesRepository: ProfilePreferencesPort; repository: SettingsRepository; notificationUnreadPort?: NotificationUnreadPort }, actorUserId: string, moduleId: string, enabled: boolean, clearUnread: boolean): Promise<{ preference: NotificationPreferenceDto; unreadCount: number | null }>` — throws `HttpError(404, "Module not found")` / `HttpError(422, ...)` on the same conditions the route currently checks (module missing, module doesn't support notifications, module not active for user).

- [ ] **Step 1: Write the failing test**

```ts
// packages/settings/src/notification-preference-application.test.ts
import { describe, it, expect } from "vitest";
import { setNotificationPreferenceEnabled } from "./notification-preference-application.js";
// use this package's existing route-test DataContextDb/manifest fixtures (see
// notification-preferences-routes.test.ts if present, or the test harness used by
// themes-routes.test.ts / quiet-hours-routes.test.ts for the withDataContext pattern)

describe("setNotificationPreferenceEnabled", () => {
  it("sets enabled=false and returns the updated preference", async () => {
    // seed an active, notification-supporting module manifest + active module row
    // await setNotificationPreferenceEnabled(db, deps, actorUserId, moduleId, false, false)
    // expect result.preference.enabled === false
  });

  it("throws HttpError(404) when the module does not exist", async () => {
    // expect(...).rejects.toThrow with status 404
  });

  it("throws HttpError(422) when the module does not support notifications", async () => {});

  it("throws HttpError(422) when the module is not active for this user", async () => {});

  it("clears unread count only when enabled=false and clearUnread=true and the port is present", async () => {});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarv1s/settings test -- notification-preference-application`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement, extracting the exact logic currently inline in `notification-preferences-routes.ts:76-99`**

```ts
// packages/settings/src/notification-preference-application.ts
import type { DataContextDb } from "@jarv1s/db";
import { HttpError, type JarvisModuleManifest } from "@jarv1s/module-sdk";
import type { NotificationPreferenceDto } from "@jarv1s/shared";
import type { ProfilePreferencesPort } from "./preferences-port.js";
import type { SettingsRepository } from "./repository.js";
import type { NotificationUnreadPort } from "./notification-preferences-routes.js";

const KEY = (moduleId: string) => `notifications:${moduleId}`;

export interface NotificationPreferenceApplicationDeps {
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  readonly preferencesRepository: ProfilePreferencesPort;
  readonly repository: SettingsRepository;
  readonly notificationUnreadPort?: NotificationUnreadPort;
}

export async function setNotificationPreferenceEnabled(
  scopedDb: DataContextDb,
  deps: NotificationPreferenceApplicationDeps,
  actorUserId: string,
  moduleId: string,
  enabled: boolean,
  clearUnread: boolean
): Promise<{ preference: NotificationPreferenceDto; unreadCount: number | null }> {
  const manifest = deps.listModuleManifests().find((m) => m.id === moduleId);
  if (!manifest) throw new HttpError(404, "Module not found");
  if (manifest.notifications?.supported !== true) {
    throw new HttpError(422, "Module does not support notifications");
  }
  const rows = await deps.repository.listModuleDenyRowsForActor(scopedDb);
  const isActive = !(
    rows.some((r) => r.scope === "instance" && r.module_id === manifest.id) ||
    rows.some((r) => r.scope === "user" && r.module_id === manifest.id && r.user_id === actorUserId)
  );
  if (!isActive) throw new HttpError(422, "Module is not active for this user");

  const preference: NotificationPreferenceDto = { moduleId: manifest.id, moduleName: manifest.name, enabled };
  await deps.preferencesRepository.upsert(scopedDb, KEY(manifest.id), { enabled });
  const unreadCount =
    !enabled && clearUnread && deps.notificationUnreadPort
      ? await deps.notificationUnreadPort.markModuleRead(scopedDb, manifest.id)
      : null;
  return { preference, unreadCount };
}
```

Then replace `notification-preferences-routes.ts`'s PUT handler body (lines 76-99) with a call to `setNotificationPreferenceEnabled(scopedDb, dependencies, accessContext.actorUserId, request.params.moduleId, body.enabled, body.clearUnread === true)`, catching `HttpError` the same way the route already does via `handleSettingsRouteError`.

- [ ] **Step 4: Run tests, plus the existing route test suite, to confirm nothing regressed**

Run: `pnpm --filter @jarv1s/settings test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/notification-preference-application.ts packages/settings/src/notification-preference-application.test.ts packages/settings/src/notification-preferences-routes.ts
git commit -m "refactor(settings): extract notification-preference toggle to an application function"
```

## Task 2: `settings.themeMode.set` assistant tool

**Files:**
- Modify: `packages/settings/src/manifest.ts` (add to `assistantTools` array, after the existing `app.getMapSlice` entry)
- Create: `packages/settings/src/assistant-tools/theme-mode-tool.ts`
- Test: `packages/settings/src/assistant-tools/theme-mode-tool.test.ts`

**Interfaces:**
- Consumes: `PreferencesRepository.getWithRevision`/`upsertWithRevision` from Task 0a; `COLOR_MODE_KEY = "themes.color-mode"` (matches `themes-routes.ts:26` exactly — do not diverge).
- Produces: `themeModeSetInputSchema`, `themeModeSetOutputSchema`, `themeModeSetExecute` exports consumed by `manifest.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/settings/src/assistant-tools/theme-mode-tool.test.ts
import { describe, it, expect } from "vitest";
import { themeModeSetExecute } from "./theme-mode-tool.js";

describe("settings.themeMode.set", () => {
  it("sets color mode to dark and returns the new value", async () => {
    // execute({ mode: "dark" }, toolContext) -> { mode: "dark" }
    // then getWithRevision(db, "themes.color-mode") reflects "dark"
  });
  it("rejects a mode outside light|dark", async () => {
    // execute({ mode: "purple" }, toolContext) rejects — inputSchema enum validation
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarv1s/settings test -- theme-mode-tool`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement**

```ts
// packages/settings/src/assistant-tools/theme-mode-tool.ts
import type { ModuleAssistantToolContext } from "@jarv1s/module-sdk";

const COLOR_MODE_KEY = "themes.color-mode";

export const themeModeSetInputSchema = {
  type: "object",
  properties: { mode: { type: "string", enum: ["light", "dark"] } },
  required: ["mode"],
  additionalProperties: false
} as const;

export const themeModeSetOutputSchema = {
  type: "object",
  properties: { mode: { type: "string", enum: ["light", "dark"] } },
  required: ["mode"],
  additionalProperties: false
} as const;

export async function themeModeSetExecute(
  input: { mode: "light" | "dark" },
  ctx: ModuleAssistantToolContext
): Promise<{ mode: "light" | "dark" }> {
  const current = await ctx.preferencesRepository.getWithRevision(ctx.scopedDb, COLOR_MODE_KEY);
  await ctx.preferencesRepository.upsertWithRevision(
    ctx.scopedDb,
    COLOR_MODE_KEY,
    input.mode,
    current?.revision ?? null
  );
  return { mode: input.mode };
}
```

(`ModuleAssistantToolContext`'s exact shape — whether it carries `scopedDb`/`preferencesRepository` directly or these must be closed over via a factory function taking `dependencies` — is not yet re-confirmed this pass. Read `packages/module-sdk/src/index.ts` `ModuleAssistantToolManifest.execute` signature and one other module's existing tool, e.g. `app-map-tool.ts` in this same package, as Step 3's first sub-step; adjust the signature above to match the real pattern before writing the implementation.)

- [ ] **Step 4: Wire into `manifest.ts`**

```ts
// packages/settings/src/manifest.ts — add import and array entry
import { themeModeSetExecute, themeModeSetInputSchema, themeModeSetOutputSchema } from "./assistant-tools/theme-mode-tool.js";

// inside assistantTools: [...]
{
  name: "settings.themeMode.set",
  description: "Set the app's color mode (light or dark) for this user.",
  permissionId: "settings.write",
  risk: "write",
  selfOperationGrant: "granted_at_install",
  actionFamilyId: "settings.preference-write",
  executionPolicy: "auto",
  inputSchema: themeModeSetInputSchema,
  outputSchema: themeModeSetOutputSchema,
  execute: themeModeSetExecute
}
```

Also add an `assistantActionFamilies` entry for `settings.preference-write` on the manifest if one doesn't already exist (read an existing module's `assistantActionFamilies` declaration, e.g. `tasks`'s manifest, as a pattern reference — not yet re-confirmed this pass): `{ id: "settings.preference-write", label: "Update personal settings", allowedTiers: ["trusted_auto", "confirm_once"], defaultTier: "confirm_once" }` (never `"trusted_auto"` as `defaultTier` — install-time grant sets the stored tier to `trusted_auto` separately).

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @jarv1s/settings test -- theme-mode-tool`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/settings/src/assistant-tools/theme-mode-tool.ts packages/settings/src/assistant-tools/theme-mode-tool.test.ts packages/settings/src/manifest.ts
git commit -m "feat(settings): add settings.themeMode.set self-operation tool"
```

## Task 3: `settings.locale.setRegionAndDateFormat` + `settings.locale.setTimezone` tools (with IANA validation)

**Files:**
- Create: `packages/settings/src/assistant-tools/locale-tools.ts`
- Test: `packages/settings/src/assistant-tools/locale-tools.test.ts`
- Modify: `packages/settings/src/manifest.ts`

**Interfaces:**
- Consumes: `LOCALE_PREFERENCE_KEY = "locale"` (matches `locale-routes.ts:16`); `DEFAULT_LOCALE_SETTINGS` shape `{ timezone, region, dateFormat }`.
- Produces: `isValidIanaTimeZone(value: string): boolean`, `localeSetTimezoneExecute`, `localeSetRegionAndDateFormatExecute` and their schemas.
- Both tools read-modify-write the SAME `"locale"` preference key (it is one combined object in storage) — each tool only overwrites its own fields, preserving the others from the current value (falling back to `DEFAULT_LOCALE_SETTINGS` fields when absent), and CAS-protects against the two tools (or a tool + the REST route) racing each other.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/settings/src/assistant-tools/locale-tools.test.ts
import { describe, it, expect } from "vitest";
import { isValidIanaTimeZone, localeSetTimezoneExecute, localeSetRegionAndDateFormatExecute } from "./locale-tools.js";

describe("isValidIanaTimeZone", () => {
  it("accepts a real IANA zone", () => expect(isValidIanaTimeZone("America/Chicago")).toBe(true));
  it("rejects a bogus string", () => expect(isValidIanaTimeZone("Not/AZone")).toBe(false));
  it("rejects an offset-style string", () => expect(isValidIanaTimeZone("GMT+5")).toBe(false));
});

describe("settings.locale.setTimezone", () => {
  it("updates only the timezone field, preserving region/dateFormat", async () => {
    // seed locale = { timezone: "UTC", region: "en-GB", dateFormat: "12" }
    // execute({ timezone: "America/Denver" }) -> { timezone: "America/Denver", region: "en-GB", dateFormat: "12" }
  });
  it("rejects an invalid IANA zone", async () => {
    // execute({ timezone: "Fake/Zone" }) rejects
  });
});

describe("settings.locale.setRegionAndDateFormat", () => {
  it("updates region and dateFormat, preserving timezone", async () => {});
  it("rejects an empty region", async () => {});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jarv1s/settings test -- locale-tools`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement**

```ts
// packages/settings/src/assistant-tools/locale-tools.ts
import { HttpError } from "@jarv1s/module-sdk";
import type { LocaleDateFormat, LocaleSettingsDto } from "@jarv1s/shared";

const LOCALE_PREFERENCE_KEY = "locale";
const DEFAULT_LOCALE_SETTINGS: LocaleSettingsDto = {
  timezone: "America/Los_Angeles",
  region: "en-US",
  dateFormat: "24"
};

export function isValidIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function readCurrentLocale(raw: unknown): LocaleSettingsDto {
  if (!raw || typeof raw !== "object") return DEFAULT_LOCALE_SETTINGS;
  const r = raw as Record<string, unknown>;
  return {
    timezone: typeof r.timezone === "string" ? r.timezone : DEFAULT_LOCALE_SETTINGS.timezone,
    region: typeof r.region === "string" ? r.region : DEFAULT_LOCALE_SETTINGS.region,
    dateFormat: r.dateFormat === "12" || r.dateFormat === "24" ? (r.dateFormat as LocaleDateFormat) : DEFAULT_LOCALE_SETTINGS.dateFormat
  };
}

export const localeSetTimezoneInputSchema = {
  type: "object",
  properties: { timezone: { type: "string", minLength: 1, maxLength: 100 } },
  required: ["timezone"],
  additionalProperties: false
} as const;

export async function localeSetTimezoneExecute(
  input: { timezone: string },
  ctx: /* ModuleAssistantToolContext — confirm shape per Task 2 Step 3 note */ any
): Promise<LocaleSettingsDto> {
  if (!isValidIanaTimeZone(input.timezone)) throw new HttpError(400, "Not a recognized time zone");
  const current = await ctx.preferencesRepository.getWithRevision(ctx.scopedDb, LOCALE_PREFERENCE_KEY);
  const next: LocaleSettingsDto = { ...readCurrentLocale(current?.value), timezone: input.timezone };
  await ctx.preferencesRepository.upsertWithRevision(ctx.scopedDb, LOCALE_PREFERENCE_KEY, next, current?.revision ?? null);
  return next;
}

export const localeSetRegionAndDateFormatInputSchema = {
  type: "object",
  properties: {
    region: { type: "string", minLength: 1, maxLength: 35 },
    dateFormat: { type: "string", enum: ["12", "24"] }
  },
  required: ["region", "dateFormat"],
  additionalProperties: false
} as const;

export async function localeSetRegionAndDateFormatExecute(
  input: { region: string; dateFormat: LocaleDateFormat },
  ctx: any
): Promise<LocaleSettingsDto> {
  const region = input.region.trim();
  if (region.length === 0) throw new HttpError(400, "Language and region is required");
  const current = await ctx.preferencesRepository.getWithRevision(ctx.scopedDb, LOCALE_PREFERENCE_KEY);
  const next: LocaleSettingsDto = { ...readCurrentLocale(current?.value), region, dateFormat: input.dateFormat };
  await ctx.preferencesRepository.upsertWithRevision(ctx.scopedDb, LOCALE_PREFERENCE_KEY, next, current?.revision ?? null);
  return next;
}

export const localeOutputSchema = {
  type: "object",
  properties: {
    timezone: { type: "string" },
    region: { type: "string" },
    dateFormat: { type: "string", enum: ["12", "24"] }
  },
  required: ["timezone", "region", "dateFormat"],
  additionalProperties: false
} as const;
```

- [ ] **Step 4: Wire both tools into `manifest.ts`** following the exact pattern from Task 2 Step 4, tool names `settings.locale.setTimezone` and `settings.locale.setRegionAndDateFormat`, both on the `settings.preference-write` action family.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @jarv1s/settings test -- locale-tools`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/settings/src/assistant-tools/locale-tools.ts packages/settings/src/assistant-tools/locale-tools.test.ts packages/settings/src/manifest.ts
git commit -m "feat(settings): add locale self-operation tools with IANA timezone validation"
```

## Task 4: `settings.quietHours.set` assistant tool

**Files:**
- Create: `packages/settings/src/assistant-tools/quiet-hours-tool.ts`
- Test: `packages/settings/src/assistant-tools/quiet-hours-tool.test.ts`
- Modify: `packages/settings/src/manifest.ts`

**Interfaces:**
- Consumes: `QUIET_HOURS_PREFERENCE_KEY = "quiet-hours"` (matches `quiet-hours-routes.ts:15`); HH:MM validation regex `/^([01]\d|2[0-3]):[0-5]\d$/` (matches `quiet-hours-routes.ts:96`, reused verbatim — do not redefine differently).

- [ ] **Step 1: Write the failing test**

```ts
// packages/settings/src/assistant-tools/quiet-hours-tool.test.ts
import { describe, it, expect } from "vitest";
import { quietHoursSetExecute } from "./quiet-hours-tool.js";

describe("settings.quietHours.set", () => {
  it("sets enabled/start/end/timezone and returns the stored value", async () => {});
  it("rejects a malformed start time", async () => {
    // execute({ enabled: true, start: "25:00", end: "07:00", timezone: null }) rejects HttpError 400
  });
  it("rejects a malformed end time", async () => {});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jarv1s/settings test -- quiet-hours-tool`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// packages/settings/src/assistant-tools/quiet-hours-tool.ts
import { HttpError } from "@jarv1s/module-sdk";
import type { QuietHoursSettingsDto } from "@jarv1s/shared";

const QUIET_HOURS_PREFERENCE_KEY = "quiet-hours";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const quietHoursSetInputSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    start: { type: "string" },
    end: { type: "string" },
    timezone: { type: ["string", "null"] }
  },
  required: ["enabled", "start", "end"],
  additionalProperties: false
} as const;

export const quietHoursOutputSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    start: { type: "string" },
    end: { type: "string" },
    timezone: { type: ["string", "null"] }
  },
  required: ["enabled", "start", "end", "timezone"],
  additionalProperties: false
} as const;

export async function quietHoursSetExecute(
  input: { enabled: boolean; start: string; end: string; timezone?: string | null },
  ctx: any
): Promise<QuietHoursSettingsDto> {
  if (!HHMM.test(input.start)) throw new HttpError(400, "start must be HH:MM (00:00–23:59)");
  if (!HHMM.test(input.end)) throw new HttpError(400, "end must be HH:MM (00:00–23:59)");
  const timezone = input.timezone && input.timezone.trim().length > 0 ? input.timezone.trim() : null;
  const next: QuietHoursSettingsDto = { enabled: input.enabled, start: input.start, end: input.end, timezone };
  const current = await ctx.preferencesRepository.getWithRevision(ctx.scopedDb, QUIET_HOURS_PREFERENCE_KEY);
  await ctx.preferencesRepository.upsertWithRevision(ctx.scopedDb, QUIET_HOURS_PREFERENCE_KEY, next, current?.revision ?? null);
  return next;
}
```

- [ ] **Step 4: Wire into `manifest.ts`** as `settings.quietHours.set`, same action family.

- [ ] **Step 5: Run tests** — Run: `pnpm --filter @jarv1s/settings test -- quiet-hours-tool` — Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/settings/src/assistant-tools/quiet-hours-tool.ts packages/settings/src/assistant-tools/quiet-hours-tool.test.ts packages/settings/src/manifest.ts
git commit -m "feat(settings): add settings.quietHours.set self-operation tool"
```

## Task 5: `settings.weatherLocation.set` assistant tool

**Files:**
- Create: `packages/settings/src/assistant-tools/weather-location-tool.ts`
- Test: `packages/settings/src/assistant-tools/weather-location-tool.test.ts`
- Modify: `packages/settings/src/manifest.ts`

**Interfaces:**
- Consumes: `WEATHER_LOCATION_PREFERENCE_KEY = "weather-location"` (matches `weather-location-routes.ts:14`); lat/lon range validation `-90..90` / `-180..180` (matches `weather-location-routes.ts:72`); label trim+200-char cap (matches line 80).

- [ ] **Step 1: Write the failing test**

```ts
// packages/settings/src/assistant-tools/weather-location-tool.test.ts
import { describe, it, expect } from "vitest";
import { weatherLocationSetExecute } from "./weather-location-tool.js";

describe("settings.weatherLocation.set", () => {
  it("sets lat/lon/label and returns the stored value", async () => {});
  it("rejects lat out of range", async () => {
    // execute({ lat: 200, lon: 0, label: "x" }) rejects HttpError 400
  });
  it("rejects lon out of range", async () => {});
  it("trims and caps label at 200 chars", async () => {});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jarv1s/settings test -- weather-location-tool`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// packages/settings/src/assistant-tools/weather-location-tool.ts
import { HttpError } from "@jarv1s/module-sdk";
import type { WeatherLocationDto } from "@jarv1s/shared";

const WEATHER_LOCATION_PREFERENCE_KEY = "weather-location";

export const weatherLocationSetInputSchema = {
  type: "object",
  properties: {
    lat: { type: "number" },
    lon: { type: "number" },
    label: { type: "string", minLength: 1 }
  },
  required: ["lat", "lon", "label"],
  additionalProperties: false
} as const;

export const weatherLocationOutputSchema = {
  type: "object",
  properties: { lat: { type: "number" }, lon: { type: "number" }, label: { type: "string" } },
  required: ["lat", "lon", "label"],
  additionalProperties: false
} as const;

export async function weatherLocationSetExecute(
  input: WeatherLocationDto,
  ctx: any
): Promise<WeatherLocationDto> {
  if (input.lat < -90 || input.lat > 90) throw new HttpError(400, "Latitude out of range");
  if (input.lon < -180 || input.lon > 180) throw new HttpError(400, "Longitude out of range");
  const next: WeatherLocationDto = { lat: input.lat, lon: input.lon, label: input.label.trim().slice(0, 200) };
  const current = await ctx.preferencesRepository.getWithRevision(ctx.scopedDb, WEATHER_LOCATION_PREFERENCE_KEY);
  await ctx.preferencesRepository.upsertWithRevision(ctx.scopedDb, WEATHER_LOCATION_PREFERENCE_KEY, next, current?.revision ?? null);
  return next;
}
```

- [ ] **Step 4: Wire into `manifest.ts`** as `settings.weatherLocation.set`, same action family.

- [ ] **Step 5: Run tests** — Run: `pnpm --filter @jarv1s/settings test -- weather-location-tool` — Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/settings/src/assistant-tools/weather-location-tool.ts packages/settings/src/assistant-tools/weather-location-tool.test.ts packages/settings/src/manifest.ts
git commit -m "feat(settings): add settings.weatherLocation.set self-operation tool"
```

## Task 6: `settings.notificationPreference.setEnabled` assistant tool

**Files:**
- Create: `packages/settings/src/assistant-tools/notification-preference-tool.ts`
- Test: `packages/settings/src/assistant-tools/notification-preference-tool.test.ts`
- Modify: `packages/settings/src/manifest.ts`

**Interfaces:**
- Consumes: `setNotificationPreferenceEnabled` from Task 1.
- Response text must name the concrete consequence (per handoff's "consequence-naming response text" requirement): e.g. "Turned off notifications for {moduleName}." not a generic "Done."

- [ ] **Step 1: Write the failing test**

```ts
// packages/settings/src/assistant-tools/notification-preference-tool.test.ts
import { describe, it, expect } from "vitest";
import { notificationPreferenceSetEnabledExecute } from "./notification-preference-tool.js";

describe("settings.notificationPreference.setEnabled", () => {
  it("disables notifications for a module and returns a consequence-naming message", async () => {
    // execute({ moduleId: "tasks", enabled: false, clearUnread: false }, ctx)
    // -> { preference: { moduleId: "tasks", moduleName: "Tasks", enabled: false }, message: "Turned off notifications for Tasks." }
  });
  it("rejects an unknown moduleId", async () => {});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jarv1s/settings test -- notification-preference-tool`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// packages/settings/src/assistant-tools/notification-preference-tool.ts
import { setNotificationPreferenceEnabled } from "../notification-preference-application.js";

export const notificationPreferenceSetEnabledInputSchema = {
  type: "object",
  properties: {
    moduleId: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    clearUnread: { type: "boolean" }
  },
  required: ["moduleId", "enabled"],
  additionalProperties: false
} as const;

export const notificationPreferenceSetEnabledOutputSchema = {
  type: "object",
  properties: {
    moduleId: { type: "string" },
    moduleName: { type: "string" },
    enabled: { type: "boolean" },
    message: { type: "string" }
  },
  required: ["moduleId", "moduleName", "enabled", "message"],
  additionalProperties: false
} as const;

export async function notificationPreferenceSetEnabledExecute(
  input: { moduleId: string; enabled: boolean; clearUnread?: boolean },
  ctx: any
): Promise<{ moduleId: string; moduleName: string; enabled: boolean; message: string }> {
  const { preference } = await setNotificationPreferenceEnabled(
    ctx.scopedDb,
    ctx.dependencies, // the same { listModuleManifests, preferencesRepository, repository, notificationUnreadPort } shape Task 1 defined
    ctx.actorUserId,
    input.moduleId,
    input.enabled,
    input.clearUnread === true
  );
  const message = `${preference.enabled ? "Turned on" : "Turned off"} notifications for ${preference.moduleName}.`;
  return { moduleId: preference.moduleId, moduleName: preference.moduleName, enabled: preference.enabled, message };
}
```

(`ctx.dependencies`/`ctx.actorUserId` shape depends on the real `ModuleAssistantToolContext` confirmed in Task 2 — adjust the destructuring to match.)

- [ ] **Step 4: Wire into `manifest.ts`** as `settings.notificationPreference.setEnabled`, same action family.

- [ ] **Step 5: Run tests** — Run: `pnpm --filter @jarv1s/settings test -- notification-preference-tool` — Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/settings/src/assistant-tools/notification-preference-tool.ts packages/settings/src/assistant-tools/notification-preference-tool.test.ts packages/settings/src/manifest.ts
git commit -m "feat(settings): add settings.notificationPreference.setEnabled self-operation tool"
```

## Task 7: `chat.setResponseStyle` assistant tool (on chat's own manifest)

**Files:**
- Read first: `packages/chat/src/manifest.ts` around line 171 (existing `assistantTools` array) and `packages/shared/src/chat-settings-api.ts:3` (the `ChatResponseStyle` closed-enum type) and `packages/chat/src/live/runtime.ts:529` (the consumer) — confirm exact enum values and the chat module's own preference-write path (chat may or may not use `PreferencesRepository`/`app.preferences` — confirm before assuming Task 0a's CAS methods apply here).
- Create: `packages/chat/src/assistant-tools/response-style-tool.ts`
- Test: `packages/chat/src/assistant-tools/response-style-tool.test.ts`
- Modify: `packages/chat/src/manifest.ts`

**Interfaces:**
- Produces: `chatSetResponseStyleExecute`, input schema with a closed `enum` of exactly the `ChatResponseStyle` values found in Step 1 — no additional properties, no free-text field. This is the load-bearing constraint from Coordinator Ruling 2; if the real `ChatResponseStyle` type includes anything other than a closed string enum (e.g., an object with a free-text field), STOP this task and escalate to the coordinator instead of building it.

- [ ] **Step 1: Read the three cited files and confirm the enum values + write path**

Run: `grep -n "ChatResponseStyle" packages/shared/src/chat-settings-api.ts packages/chat/src/routes.ts packages/chat/src/live/runtime.ts`

- [ ] **Step 2: Write the failing test** (exact assertions depend on Step 1's confirmed enum values and write-path function name — draft against real names, not placeholders, once confirmed)

```ts
// packages/chat/src/assistant-tools/response-style-tool.test.ts
import { describe, it, expect } from "vitest";
import { chatSetResponseStyleExecute } from "./response-style-tool.js";

describe("chat.setResponseStyle", () => {
  it("sets a valid response style and returns it", async () => {
    // execute({ style: <first confirmed enum value> }, ctx) -> { style: <that value> }
  });
  it("rejects a value outside the closed enum", async () => {
    // execute({ style: "not-a-real-style" }, ctx) rejects — schema enum validation, not app logic
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @jarv1s/chat test -- response-style-tool`
Expected: FAIL

- [ ] **Step 4: Implement**, using chat's own existing write path found in Step 1 (do not import or write to `app.preferences` from this file if chat has its own settings store — module isolation cuts both ways; settings must not read/write chat internals, but this file lives IN chat so it may use chat's real internals directly).

```ts
// packages/chat/src/assistant-tools/response-style-tool.ts
// Fill in the real ChatResponseStyle enum values and chat's real write-path call
// once confirmed in Step 1. Shape:
export const chatSetResponseStyleInputSchema = {
  type: "object",
  properties: { style: { type: "string", enum: [/* exact confirmed values, e.g. "concise" | "balanced" | "detailed" */] } },
  required: ["style"],
  additionalProperties: false
} as const;

export const chatSetResponseStyleOutputSchema = {
  type: "object",
  properties: { style: { type: "string", enum: [/* same values */] } },
  required: ["style"],
  additionalProperties: false
} as const;

export async function chatSetResponseStyleExecute(
  input: { style: string },
  ctx: any
): Promise<{ style: string }> {
  // call chat's confirmed write path here, e.g. ctx.chatSettingsRepository.setResponseStyle(...)
  return { style: input.style };
}
```

- [ ] **Step 5: Wire into `packages/chat/src/manifest.ts`'s existing `assistantTools` array** as `chat.setResponseStyle`, `selfOperationGrant: "granted_at_install"`, `risk: "write"`, `executionPolicy: "auto"`, an `actionFamilyId` on chat's own manifest (create `chat.preference-write` or reuse an existing chat action family if one already covers settings-like writes — confirm during Step 1's read, don't assume).

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @jarv1s/chat test -- response-style-tool`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/chat/src/assistant-tools/response-style-tool.ts packages/chat/src/assistant-tools/response-style-tool.test.ts packages/chat/src/manifest.ts
git commit -m "feat(chat): add chat.setResponseStyle self-operation tool (closed enum, server-validated)"
```

## Task 8: Undo stack for settings self-operation writes

**Files:**
- Create: `packages/settings/src/undo-stack.ts`
- Test: `packages/settings/src/undo-stack.test.ts`
- Modify: each of the five settings tool `execute` functions from Tasks 2–6 to push an undo entry after a successful write (see Step 3).

**Interfaces:**
- Produces: `SettingsUndoStack` — bounded in-memory, keyed by `${actorUserId}:${chatId}`, each entry `{ mutationId: string, key: string, previousValue: unknown, previousRevision: number | null, appliedAt: number }`; `push(actorUserId, chatId, entry)` caps the per-chat stack at a fixed bound (use 20 — no requirement in the spec section read so far specifies an exact bound; flag this as a default worth confirming with the coordinator, not a re-derived number); `pop(actorUserId, chatId): entry | undefined`; `clear(actorUserId, chatId): void`. No persistence — a plain in-memory `Map`, cleared on process restart by design (matches the "restart clears it" ruling already locked).

- [ ] **Step 1: Write the failing test**

```ts
// packages/settings/src/undo-stack.test.ts
import { describe, it, expect } from "vitest";
import { SettingsUndoStack } from "./undo-stack.js";

describe("SettingsUndoStack", () => {
  it("pushes and pops in LIFO order per actor+chat", () => {
    const stack = new SettingsUndoStack();
    stack.push("user1", "chat1", { mutationId: "m1", key: "k", previousValue: 1, previousRevision: 1, appliedAt: 0 });
    stack.push("user1", "chat1", { mutationId: "m2", key: "k", previousValue: 2, previousRevision: 2, appliedAt: 1 });
    expect(stack.pop("user1", "chat1")?.mutationId).toBe("m2");
    expect(stack.pop("user1", "chat1")?.mutationId).toBe("m1");
    expect(stack.pop("user1", "chat1")).toBeUndefined();
  });
  it("isolates stacks per actor+chat pair", () => {
    const stack = new SettingsUndoStack();
    stack.push("user1", "chatA", { mutationId: "a", key: "k", previousValue: 1, previousRevision: 1, appliedAt: 0 });
    expect(stack.pop("user1", "chatB")).toBeUndefined();
    expect(stack.pop("user1", "chatA")?.mutationId).toBe("a");
  });
  it("caps the stack at 20 entries, dropping the oldest", () => {
    const stack = new SettingsUndoStack();
    for (let i = 0; i < 25; i++) {
      stack.push("user1", "chat1", { mutationId: `m${i}`, key: "k", previousValue: i, previousRevision: i, appliedAt: i });
    }
    let count = 0;
    while (stack.pop("user1", "chat1")) count++;
    expect(count).toBe(20);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jarv1s/settings test -- undo-stack`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// packages/settings/src/undo-stack.ts
export interface SettingsUndoEntry {
  readonly mutationId: string;
  readonly key: string;
  readonly previousValue: unknown;
  readonly previousRevision: number | null;
  readonly appliedAt: number;
}

const MAX_ENTRIES_PER_CHAT = 20;

export class SettingsUndoStack {
  private readonly stacks = new Map<string, SettingsUndoEntry[]>();

  private stackKey(actorUserId: string, chatId: string): string {
    return `${actorUserId}:${chatId}`;
  }

  push(actorUserId: string, chatId: string, entry: SettingsUndoEntry): void {
    const key = this.stackKey(actorUserId, chatId);
    const stack = this.stacks.get(key) ?? [];
    stack.push(entry);
    if (stack.length > MAX_ENTRIES_PER_CHAT) stack.shift();
    this.stacks.set(key, stack);
  }

  pop(actorUserId: string, chatId: string): SettingsUndoEntry | undefined {
    const key = this.stackKey(actorUserId, chatId);
    const stack = this.stacks.get(key);
    return stack?.pop();
  }

  clear(actorUserId: string, chatId: string): void {
    this.stacks.delete(this.stackKey(actorUserId, chatId));
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @jarv1s/settings test -- undo-stack`
Expected: PASS

- [ ] **Step 5: Wire `push` into each of the five settings tools from Tasks 2–6** — after each successful `upsertWithRevision` call, call `ctx.settingsUndoStack.push(ctx.actorUserId, ctx.chatId, { mutationId: crypto.randomUUID(), key: <the preference key>, previousValue: current?.value ?? null, previousRevision: current?.revision ?? null, appliedAt: Date.now() })`. (Exact `ctx` field names for `chatId` and a shared `SettingsUndoStack` instance depend on `ModuleAssistantToolContext`'s real shape, confirmed in Task 2 Step 3 — this step is mechanical once that's known; apply the same pattern to all five tools.)

- [ ] **Step 6: Commit**

```bash
git add packages/settings/src/undo-stack.ts packages/settings/src/undo-stack.test.ts packages/settings/src/assistant-tools/
git commit -m "feat(settings): add bounded per-chat undo stack for self-operation writes"
```

## Task 9: No-op suppression for CAS writes

**Files:**
- Modify: each of the five settings tools (Tasks 2–6) — before calling `upsertWithRevision`, compare the computed `next` value against the current value; if deep-equal, skip the write (and the undo push) and return the current value with a message noting no change was needed.

**Interfaces:**
- Reuses each tool's own `next`/`current` locals already in scope — no new shared file needed; this is a per-tool guard, not new infrastructure.

- [ ] **Step 1: Write a failing test per tool** (extend each Task 2–6 test file) asserting: calling the tool with the currently-stored value does not increment `revision` (verify via `getWithRevision` before/after) and does not push an undo entry.

```ts
// example addition to packages/settings/src/assistant-tools/theme-mode-tool.test.ts
it("is a no-op when the mode already matches", async () => {
  // seed COLOR_MODE_KEY = "dark" at revision 1
  // execute({ mode: "dark" }, ctx)
  // getWithRevision(db, COLOR_MODE_KEY) still shows revision 1
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jarv1s/settings test`
Expected: the new no-op assertions FAIL (revision increments even on an identical write) while everything else stays PASS.

- [ ] **Step 3: Add the guard to each tool** — e.g. in `theme-mode-tool.ts`:

```ts
export async function themeModeSetExecute(input: { mode: "light" | "dark" }, ctx: any): Promise<{ mode: "light" | "dark" }> {
  const current = await ctx.preferencesRepository.getWithRevision(ctx.scopedDb, COLOR_MODE_KEY);
  if (current?.value === input.mode) return { mode: input.mode };
  await ctx.preferencesRepository.upsertWithRevision(ctx.scopedDb, COLOR_MODE_KEY, input.mode, current?.revision ?? null);
  return { mode: input.mode };
}
```

Apply the equivalent (deep-equal check on the relevant subset of fields, e.g. only `timezone` for `localeSetTimezoneExecute`) to all five tools.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @jarv1s/settings test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/assistant-tools/
git commit -m "feat(settings): suppress no-op writes and undo entries in self-operation tools"
```

## Task 10: Update self-operation manifest inventory test counts

**Files:**
- Modify: `tests/unit/self-operation-manifests.test.ts` (the "Complete built-in self-operation inventory (#1263)" test — exact-count assertions currently `grantedAtInstall.length===29`, `confirmAlways.length===5`, `userPromotable.length===4`, sum`===38`)

- [ ] **Step 1: Run the test first to see the current baseline (post Tasks 2–7, pre this task)**

Run: `pnpm test -- self-operation-manifests`
Expected: FAIL — actual `grantedAtInstall.length` is now 35 (29 + 5 settings tools + 1 chat tool), not 29.

- [ ] **Step 2: Update the count assertions and any sorted-name-array equality checks** to add exactly this PR's six tool names (`settings.themeMode.set`, `settings.locale.setTimezone`, `settings.locale.setRegionAndDateFormat`, `settings.quietHours.set`, `settings.weatherLocation.set`, `settings.notificationPreference.setEnabled`, `chat.setResponseStyle`) to the `grantedAtInstall` name list, and bump `grantedAtInstall.length` and the sum accordingly. Do not touch `confirmAlways`/`userPromotable` counts — this PR adds none.

- [ ] **Step 3: Run tests**

Run: `pnpm test -- self-operation-manifests`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/self-operation-manifests.test.ts
git commit -m "test: update self-operation manifest inventory counts for settings + chat tools"
```

Note in the PR body per the handoff's flagged merge-conflict risk: this test file's counts will also move under sibling #1265 (news/sports) — the coordinator reconciles final numbers at merge time; do not resolve that conflict unilaterally if it appears during rebase.

## Task 13: Per-actor, per-tool rate limiting (gateway-level)

**Coordinator ruling (verbatim, do not re-litigate):** spec quote — "Rate limiting: per-actor and
per-tool limits, no-op suppression ... Bounded blast radius is not bounded frequency — an injected
loop can otherwise oscillate a setting indefinitely." Task 9 (no-op suppression) is the OTHER half
of that bullet only — `light→dark→light→dark` is never a no-op, so suppression never fires and an
injected loop oscillates freely without this task. Gateway-level, not settings-local, because a
settings-local limiter can't bound `chat.setResponseStyle` (different module). Rate-limited calls
report audit outcome `denied` — do NOT add a new outcome value (Task 0c's CHECK widening only
covers `invalid`/`conflict`). Last task before the final gate; if it stalls, escalate and state the
gap plainly in the PR body — never silently omit on a security-tier PR.

**Grounding (confirmed this pass):** `packages/ai/src/gateway/gateway.ts`, method `callTool`
(~line 128). The auto-run path for `granted_at_install` write tools is the `resolvePolicy(...) ===
"run"` branch at line 178: `runHandler` executes immediately (no confirmation card), then for
`found.tool.risk !== "read"` the code emits an `action_result` notification and calls
`this.recordAudit(access, found, { approvalMode: "auto", outcome: result.ok ? "success" :
"failed", errorClass: ..., chatSessionId })` (lines 179-194). This is the insertion point: check
the rate limit BEFORE calling `runHandler`, and if exceeded, skip execution entirely, emit
`action_result` with `outcome: "error"` (the notifier's existing non-executed shape — see line 185
for the `result.ok ? "executed" : "error"` pattern used elsewhere), and call `recordAudit` with
`{ approvalMode: "auto", outcome: "denied", errorClass: "rate_limited", chatSessionId }` — reusing
existing closed enum values on both `approval_mode` and `outcome` (confirmed both are DB CHECK
constraints in `packages/ai/sql/0127_jarvis_action_audit_log.sql` lines 8-10; `error_class` is
CHECK'd only on length ≤ 64, not a closed set, so `"rate_limited"` is free to use there, matching
the existing `"handler_error"` convention). Only gate the `resolvePolicy === "run"` branch (line
178) and the yolo-mode auto-run branch (line 161) — both are unconfirmed auto-executions; the
`confirmAndRun` path (human clicks confirm) is explicitly out of scope, a human approving each call
is its own throttle.

**Coordinator groundwork (verbatim ruling, do not re-litigate):** swept `origin/main` — no
rate-limiting machinery exists anywhere to reuse (the only `rateLimit`/`throttle` hits are inbound
429-classification strings in `packages/connectors` and `packages/news`, not limiters). Task 13 is
genuinely net-new. Two rulings:
1. **Keying is per-actor, per-tool, nested — never a concatenated string.** A chat-id-scoped key is
   trivially bypassed (new chat resets it); a process-global key leaks one actor's activity into
   another's limit. Use the same nested-map shape `undo-stack.ts` already landed
   (`actorUserId -> toolName -> ...`) — it dodges the delimiter-collision trap for the same reason
   it did there.
2. **This is a runaway-loop guard, not a security boundary.** In-memory, restart-clearing state is
   accepted ONLY under that framing. State this plainly in a code comment on the limiter and in the
   PR body — never imply it is a hard safety control, since "restart to clear it" would then read
   as a bypass. No tool-facing description promises more than "protects against a runaway loop
   within the process lifetime."
Standing bans that bear on this task: no tool may take a rate-limit ceiling/window as a parameter
(that is self-promotion to tunable-YOLO); this task must never be used to justify widening any
family's `defaultTier` ("it's capped now, so it can auto-run" is always wrong).

**Files:**
- Modify: `packages/ai/src/gateway/gateway.ts` — add a small generic in-memory limiter as a private
  field/method on `AssistantToolGateway` (or a small standalone class in the same file), backed by a
  nested `Map<actorUserId, Map<toolName, { count, windowStart }>>` — mirrors `undo-stack.ts`'s
  `actors: Map<string, Map<string, ChatUndoStack>>` shape, never a `` `${actorUserId}:${toolName}` ``
  concatenated key. Module-agnostic: no settings- or chat-specific knowledge, applies to any tool
  with `risk !== "read"` hitting the auto-run branches. Bound the outer map's size the same way
  `undo-stack.ts` does (LRU eviction) so an unbounded number of distinct actors can't grow it
  forever.
- Test: extend `tests/integration/mcp-gateway-self-operation.test.ts` if it already exercises the
  `resolvePolicy === "run"` auto-execute path for a `granted_at_install` tool (check first); else
  extend `tests/integration/mcp-gateway.test.ts`. Do not create a new top-level test file — this is
  gateway dispatch behavior, same surface those files already cover.

**Interfaces:**
- Internal only (no new exported type needed unless the limiter class is reused elsewhere — keep
  it private to `gateway.ts` unless a second caller emerges). Default window/ceiling are an
  implementation judgment call (spec gives no number) — pick something generous enough not to
  false-positive on normal multi-tool-call turns (e.g. N calls per `(actorUserId, toolName)` per a
  short rolling window measured in seconds), document the choice AND the runaway-loop-guard-not-a-
  security-boundary framing in a one-line comment, and make the ceiling/window overridable via an
  env var following this repo's `JARVIS_RL_*` naming convention (see
  `tests/integration/route-local-rate-limit.test.ts` for the pattern of reading the knob at
  module-import time so tests can set low ceilings before importing) — never a tool-callable
  parameter.

- [ ] **Step 1: Write the failing test** — drive the same `granted_at_install` write tool through
  `callTool` (or the route/MCP surface that reaches it) N+1 times in quick succession with a fixed
  `actorUserId`/`toolName`; assert the (N+1)th call returns `{ ok: false, ... }` (or the route's
  equivalent non-success response) without mutating the underlying preference, and that a
  differing `actorUserId` or `toolName` in the same window is unaffected (per-actor AND per-tool,
  not global).

Run the new/extended test file's runner command (confirm exact command from the file's existing
`describe` block or root `package.json` scripts — likely `tsx scripts/test-integration.ts
tests/integration/<file>.test.ts`).
Expected: FAIL (no limiter yet).

- [ ] **Step 2: Implement the limiter** in `gateway.ts`, gating both auto-run branches (lines 161
  and 178) before `runHandler` is invoked. On limit hit: skip `runHandler`, emit the existing
  non-executed `action_result` shape, call `recordAudit` with `{ approvalMode: "auto", outcome:
  "denied", errorClass: "rate_limited", chatSessionId }`, and return a `{ ok: false, error: ... }`
  response (message must not leak other actors' call counts or timing internals).

- [ ] **Step 3: Run the test**

Expected: PASS.

- [ ] **Step 4 (optional, do only if cheap — coordinator will NOT hold the PR for this):** plain
  counters for hard-exclusion hits and repeated CAS failures, per the same spec bullet. Skip if it
  would require new infra beyond a counter.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/gateway/gateway.ts tests/integration/<extended-file>.test.ts
git commit -m "feat(ai): add per-actor, per-tool rate limiting to gateway auto-run dispatch"
```

## Task 11: Full local gate + UAT golden-path verification

**Files:** none (verification-only task).

- [ ] **Step 1: Run the full local gate**

Run: `pnpm verify:foundation`
Expected: exit 0. If CI is unavailable/this differs, record the exact local commands and exit codes used, per CLAUDE.md.

- [ ] **Step 2: Manual/UAT golden-path check per the spec's Exit Criterion** — drive the assistant through each of the seven new tools on a running dev instance (`pnpm dev`, bind `--host`, per the Dev Environment memory) and confirm NO confirmation card appears for any of them, and that each produces the expected preference change (verify via the corresponding GET route or the settings UI) and a consequence-naming assistant response.

- [ ] **Step 3: Confirm `assertBuiltInSelfOperationManifests` passes at boot**

Run: start the API (`pnpm --filter @jarv1s/api dev` or this repo's equivalent) and confirm no startup assertion failure — the seven new tools' `selfOperationGrant`/`actionFamilyId`/family `allowedTiers` combination must satisfy the boot-time validator at `apps/api/src/server.ts:626`.

- [ ] **Step 4: Commit any fixups found during verification**, each as its own small commit with a clear message, then proceed to `coordinated-wrap-up` (open PR, report to coordinator — do not merge, move the board, or close the issue).
