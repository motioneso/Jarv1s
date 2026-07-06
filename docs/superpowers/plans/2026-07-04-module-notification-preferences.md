# Module Notification Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Coordinated-build approval gate applies: do not start code until Coordinator approves this plan.

**Goal:** Persist per-user in-app notification toggles by module, require `moduleId` on new notifications, and hide disabled/non-notification-capable modules from the global Notifications settings panel.

**Architecture:** Keep preferences in existing scoped KV `PreferencesPort` using keys `notifications:<moduleId>`; no new preference table. Add a minimal manifest marker, `notifications?: { supported: true }`, and let settings routes list only active modules with that marker. Notifications repository owns enforcement and unread marking through an injected preference port, so modules stay isolated.

**Tech Stack:** TypeScript, Fastify REST, Kysely/DataContextDb, existing module manifests, React Query settings UI.

---

## File Map

- Modify `packages/module-sdk/src/index.ts`: add `ModuleNotificationManifest` and optional `notifications` field.
- Modify module manifests:
  - `packages/briefings/src/manifest.ts`: `notifications: { supported: true }`.
  - `packages/settings/src/manifest.ts`: `notifications: { supported: true }` for upgrade diagnostics notices.
  - `packages/notifications/src/manifest.ts`: add new migration entry.
- Create `packages/notifications/sql/0106_notifications_module_id.sql`: nullable `module_id` column plus comments/index. Nullable avoids unsafe old-row backfill; repository/API reject missing module IDs for all new writes.
- Modify `packages/db/src/types.ts`: add `module_id: string | null` to `NotificationsTable`.
- Modify `packages/shared/src/notifications-api.ts`: add `moduleId` to `NotificationDto` schema.
- Modify `packages/shared/src/settings-api.ts`: add notification preference DTOs/routes.
- Modify `packages/settings/src/notification-preferences-routes.ts`: new generic GET/PUT API backed by `PreferencesPort`.
- Modify `packages/settings/src/routes.ts`: register notification preference routes with injected notification unread port.
- Modify `packages/notifications/src/repository.ts`: require non-empty `moduleId`, skip creation when module preference disabled, insert/select `module_id`, add `markModuleRead`.
- Modify `packages/notifications/src/routes.ts` and `packages/notifications/src/tools.ts`: serialize `moduleId`.
- Modify producers:
  - `packages/briefings/src/jobs.ts`: pass `moduleId: BRIEFINGS_MODULE_ID`.
  - `packages/jobs/src/upgrade-notify.ts`: pass `moduleId: SETTINGS_MODULE_ID`.
- Modify frontend API/cache:
  - `apps/web/src/api/client.ts`: add `getNotificationPreferences` / `putNotificationPreference`.
  - `apps/web/src/api/query-keys.ts`: add `settings.notificationPreferences`.
- Modify settings UI:
  - `apps/web/src/settings/settings-sample-data.ts`: remove hardcoded notification type model; keep sensitivity constants only.
  - `apps/web/src/settings/settings-module-subviews.tsx`: replace local category toggles with persisted module rows; keep local Sensitivity UI as explicitly out of scope.
  - `apps/web/src/settings/settings-personal-data-panes.tsx`: reuse existing module settings navigation helpers for row links.
- Tests:
  - `tests/integration/notifications.test.ts`: moduleId required, disabled module creates no notification, module clear marks unread read.
  - `tests/integration/settings.test.ts` or new `tests/integration/notification-preferences.test.ts`: active notification-capable module list and persisted PUT.

## Decisions

- `upgrade-notify` belongs to `settings`: notification body points to Settings -> Diagnostics and no separate system module exists.
- `module_id` migration is nullable; repository creates fail without `moduleId`, satisfying new-boundary acceptance without inventing backfill semantics for historical rows.
- Push and Email digest render unavailable rows tied to #743/#742. No toggles until delivery exists.
- Sensitivity remains local/unwired in this slice because spec only replaces hardcoded categories and channel availability. It stays visually separate from persisted module preferences.

---

### Task 1: Shared Contracts And Manifest Marker

**Files:**

- Modify `packages/module-sdk/src/index.ts`
- Modify `packages/shared/src/notifications-api.ts`
- Modify `packages/shared/src/settings-api.ts`

- [ ] **Step 1: Write failing contract coverage**

Add assertions to the smallest existing shared/settings contract test if present; if not, rely on `pnpm typecheck` for contract red first. Expected failures after implementation omission:

```bash
pnpm typecheck
```

Expected: TypeScript complains when later route/UI code references missing notification preference DTOs or manifest field.

- [ ] **Step 2: Add manifest marker**

```ts
export interface ModuleNotificationManifest {
  readonly supported: true;
}

export interface JarvisModuleManifest {
  // existing fields...
  readonly notifications?: ModuleNotificationManifest;
}
```

- [ ] **Step 3: Add notification DTO field**

```ts
export interface NotificationDto {
  readonly id: string;
  readonly moduleId: string | null;
  readonly actorUserId: string | null;
  readonly recipientUserId: string | null;
  readonly title: string;
  readonly body: string | null;
  readonly metadata: NotificationMetadata;
  readonly readAt: string | null;
  readonly createdAt: string | null;
}
```

Add `"moduleId"` to `notificationDtoSchema.required` and `moduleId: nullableStringSchema` to properties.

- [ ] **Step 4: Add settings preference API DTOs**

```ts
export interface NotificationPreferenceDto {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly enabled: boolean;
}

export interface ListNotificationPreferencesResponse {
  readonly preferences: readonly NotificationPreferenceDto[];
}

export interface PutNotificationPreferenceRequest {
  readonly enabled: boolean;
  readonly clearUnread?: boolean;
}

export interface PutNotificationPreferenceResponse {
  readonly preference: NotificationPreferenceDto;
  readonly unreadCount: number | null;
}
```

Route schemas:

```ts
export const listNotificationPreferencesRouteSchema = {
  response: { 200: listNotificationPreferencesResponseSchema }
} as const;
export const putNotificationPreferenceRouteSchema = {
  params: { type: "object", required: ["moduleId"], properties: { moduleId: { type: "string" } } },
  body: putNotificationPreferenceRequestSchema,
  response: { 200: putNotificationPreferenceResponseSchema }
} as const;
```

- [ ] **Step 5: Verify**

```bash
pnpm typecheck
```

Expected: may still fail only on implementation references not yet added.

---

### Task 2: Database Column And Serialization

**Files:**

- Create `packages/notifications/sql/0106_notifications_module_id.sql`
- Modify `packages/notifications/src/manifest.ts`
- Modify `packages/db/src/types.ts`
- Modify `packages/notifications/src/routes.ts`
- Modify `packages/notifications/src/tools.ts`

- [ ] **Step 1: Add migration**

```sql
ALTER TABLE app.notifications
  ADD COLUMN module_id text;

COMMENT ON COLUMN app.notifications.module_id IS
  'Owning Jarv1s module id for notification preference gating. Nullable only for historical rows; new repository writes require it.';

CREATE INDEX notifications_recipient_module_unread_idx
  ON app.notifications (recipient_user_id, module_id, created_at DESC)
  WHERE module_id IS NOT NULL;
```

Add `"sql/0106_notifications_module_id.sql"` to `notificationsModuleManifest.database.migrations`.

- [ ] **Step 2: Update DB type and serializers**

```ts
export interface NotificationsTable {
  id: string;
  module_id: string | null;
  actor_user_id: string | null;
  recipient_user_id: string | null;
  title: string;
  body: string | null;
  metadata: JsonColumn;
  created_at: TimestampColumn;
  urgency: ColumnType<string, string | undefined, string>;
  deferred_until: NullableTimestampColumn;
}
```

```ts
export function serializeNotification(notification: NotificationWithReadState): NotificationDto {
  return {
    id: notification.id,
    moduleId: notification.module_id,
    actorUserId: notification.actor_user_id,
    recipientUserId: notification.recipient_user_id,
    title: notification.title,
    body: notification.body,
    metadata: projectNotificationMetadata(notification.metadata),
    readAt: toIsoString(notification.read_at),
    createdAt: toIsoString(notification.created_at)
  };
}
```

Update notification SELECTs in repository/tools to include `notifications.module_id as module_id`.

- [ ] **Step 3: Verify**

```bash
pnpm db:migrate
pnpm typecheck
```

Expected: migration applies; remaining type errors point to repository create input not yet updated.

---

### Task 3: Repository Enforcement

**Files:**

- Modify `packages/notifications/src/repository.ts`
- Modify `tests/integration/notifications.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests:

```ts
it("rejects create without moduleId", async () => {
  await expect(repository.create(scopedDb, { title: "Missing module" })).rejects.toThrow(
    "moduleId is required"
  );
});

it("skips creating notifications when module preference is disabled", async () => {
  const repository = new NotificationsRepository(undefined, {
    isModuleEnabled: async () => false
  });
  const result = await repository.create(scopedDb, { moduleId: "briefings", title: "Ready" });
  expect(result).toBeNull();
});
```

Adjust exact test harness names to the existing notifications integration setup.

- [ ] **Step 2: Run failing test**

```bash
pnpm test:notifications
```

Expected: FAIL until repository signature/behavior changes.

- [ ] **Step 3: Implement minimal repository changes**

```ts
export interface CreateNotificationInput {
  readonly moduleId: string;
  readonly title: string;
  readonly body?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly urgency?: "urgent" | "normal" | "low";
}

export interface NotificationPreferencePort {
  isModuleEnabled(scopedDb: DataContextDb, moduleId: string): Promise<boolean>;
}

export class NotificationsRepository {
  constructor(
    private readonly quietHoursPort?: QuietHoursPort,
    private readonly notificationPreferencePort?: NotificationPreferencePort
  ) {}

  async create(
    scopedDb: DataContextDb,
    input: CreateNotificationInput
  ): Promise<NotificationWithReadState | null> {
    assertDataContextDb(scopedDb);
    if (!input.moduleId.trim()) throw new Error("moduleId is required");
    if (
      this.notificationPreferencePort &&
      !(await this.notificationPreferencePort.isModuleEnabled(scopedDb, input.moduleId))
    ) {
      return null;
    }
    // insert module_id: input.moduleId
  }
}
```

Add:

```ts
async markModuleRead(scopedDb: DataContextDb, moduleId: string): Promise<number> {
  assertDataContextDb(scopedDb);
  // same insert/upsert shape as markAllRead, with WHERE notifications.module_id = moduleId.
  return this.countUnread(scopedDb);
}
```

- [ ] **Step 4: Verify**

```bash
pnpm test:notifications
pnpm typecheck
```

Expected: notifications tests pass; producer call sites fail until Task 5.

---

### Task 4: Settings Preference API

**Files:**

- Create `packages/settings/src/notification-preferences-routes.ts`
- Modify `packages/settings/src/routes.ts`
- Modify `tests/integration/notification-preferences.test.ts` or `tests/integration/settings.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover:

```ts
it("lists only active notification-capable modules", async () => {
  const res = await app.inject({ method: "GET", url: "/api/me/notification-preferences", headers });
  expect(res.statusCode).toBe(200);
  expect(res.json().preferences).toEqual(
    expect.arrayContaining([{ moduleId: "briefings", moduleName: "Briefings", enabled: true }])
  );
});

it("persists module notification disable and can clear unread for that module", async () => {
  const res = await app.inject({
    method: "PUT",
    url: "/api/me/notification-preferences/briefings",
    headers,
    payload: { enabled: false, clearUnread: true }
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().preference.enabled).toBe(false);
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm test:integration -- tests/integration/notification-preferences.test.ts
```

Expected: route 404 or missing schema.

- [ ] **Step 3: Implement route**

Use existing `/api/me/modules` active calculation:

```ts
const KEY = (moduleId: string) => `notifications:${moduleId}`;
const DEFAULT_ENABLED = true;

function normalizePreference(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_ENABLED;
  return typeof (value as { enabled?: unknown }).enabled === "boolean"
    ? (value as { enabled: boolean }).enabled
    : DEFAULT_ENABLED;
}
```

`GET /api/me/notification-preferences`:

- Load deny rows.
- Filter manifests to active and `manifest.notifications?.supported === true`.
- Read `PreferencesPort.get(scopedDb, KEY(manifest.id))`.
- Return `{ moduleId, moduleName: manifest.name, enabled }`.

`PUT /api/me/notification-preferences/:moduleId`:

- 404 unknown module.
- 422 when module lacks notification support or is inactive for current user.
- Upsert `{ enabled }`.
- If `enabled === false && clearUnread === true`, call injected `notificationPort.markModuleRead(scopedDb, moduleId)` and return resulting unread count; otherwise `unreadCount: null`.

- [ ] **Step 4: Verify**

```bash
pnpm test:integration -- tests/integration/notification-preferences.test.ts
pnpm typecheck
```

Expected: route tests pass.

---

### Task 5: Manifest Opt-In And Producers

**Files:**

- Modify `packages/briefings/src/manifest.ts`
- Modify `packages/settings/src/manifest.ts`
- Modify `packages/briefings/src/jobs.ts`
- Modify `packages/jobs/src/upgrade-notify.ts`
- Modify producer tests if existing integration coverage fails.

- [ ] **Step 1: Add manifest opt-ins**

```ts
notifications: { supported: true },
```

Add to Briefings and Settings manifests only.

- [ ] **Step 2: Add module IDs to create calls**

Briefings:

```ts
import { BRIEFINGS_MODULE_ID } from "./manifest.js";

await options.notificationsRepository.create(scopedDb, {
  moduleId: BRIEFINGS_MODULE_ID,
  title: "...",
  urgency: "normal",
  metadata: { definitionId: outcome.run.definition_id, briefingRunId: outcome.run.id }
});
```

Upgrade:

```ts
import { SETTINGS_MODULE_ID } from "@jarv1s/settings";

await repository.create(scopedDb, {
  moduleId: SETTINGS_MODULE_ID,
  title: `Jarvis ${job.data.version} is available`,
  body: "A newer version of Jarvis is available. View the release notes and upgrade from Settings -> Diagnostics.",
  urgency: "normal",
  metadata: { kind: "upgrade_available", version: job.data.version }
});
```

- [ ] **Step 3: Verify**

```bash
pnpm test:briefings
pnpm test:notifications
pnpm typecheck
```

Expected: producers compile and existing notification tests pass.

---

### Task 6: Frontend API And Notifications Panel

**Files:**

- Modify `apps/web/src/api/client.ts`
- Modify `apps/web/src/api/query-keys.ts`
- Modify `apps/web/src/settings/settings-sample-data.ts`
- Modify `apps/web/src/settings/settings-module-subviews.tsx`
- Modify `apps/web/src/settings/settings-personal-data-panes.tsx`

- [ ] **Step 1: Add client helpers**

```ts
export async function getNotificationPreferences(): Promise<ListNotificationPreferencesResponse> {
  return requestJson<ListNotificationPreferencesResponse>("/api/me/notification-preferences");
}

export async function putNotificationPreference(
  moduleId: string,
  body: PutNotificationPreferenceRequest
): Promise<PutNotificationPreferenceResponse> {
  return requestJson<PutNotificationPreferenceResponse>(
    `/api/me/notification-preferences/${encodeURIComponent(moduleId)}`,
    { method: "PUT", body }
  );
}
```

Query key:

```ts
notificationPreferences: ["settings", "notification-preferences"] as const,
```

- [ ] **Step 2: Replace hardcoded categories**

Remove `NotificationType` and `types` from `DEFAULT_NOTIFICATIONS`. Keep:

```ts
export interface NotificationsSettings {
  readonly sensitivity: NotificationSensitivity;
}
```

In `NotificationSettings`:

- Drop `<NotWired>`.
- Query `getNotificationPreferences`.
- Render Channels with In-app enabled/on and Push/Email digest as unavailable rows, not switches.
- Render `preferences.map(...)` as module rows with `Switch`.
- On switch off, use `window.confirm("Mark existing unread notifications from this module as read?")` for the V1 prompt. Pass `{ enabled: false, clearUnread }`.
- On switch on, pass `{ enabled: true }`.
- Use existing module-settings navigation helpers from `settings-personal-data-panes.tsx` for Configure/Open link where available.

- [ ] **Step 3: Verify UI compile**

```bash
pnpm --filter @jarv1s/web typecheck
pnpm --filter @jarv1s/web lint
```

Expected: web checks pass.

---

### Task 7: Final Slice Verification

**Files:** all touched files above.

- [ ] **Step 1: Run focused checks**

```bash
pnpm test:notifications
pnpm test:briefings
pnpm test:integration -- tests/integration/notification-preferences.test.ts
pnpm --filter @jarv1s/web typecheck
```

Expected: all pass.

- [ ] **Step 2: Run required broader checks before wrap-up**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:notifications
pnpm db:migrate
```

Expected: all pass. If Docker DB is unavailable, report exact failing command and do not claim migration verified.

- [ ] **Step 3: Commit in small slices**

Use explicit paths only, never `git add -A`:

```bash
git add packages/module-sdk/src/index.ts packages/shared/src/notifications-api.ts packages/shared/src/settings-api.ts
git commit -m "feat: add notification preference contracts"
```

Repeat per task with only files from that task.

---

## Self-Review

- Spec coverage: module-based persisted preferences, manifest opt-in, active-module filtering, moduleId requirement, producer module IDs, creation gating, clear unread prompt, Push/Email unavailable rows.
- Skipped: bespoke preference table and DB `NOT NULL` on `module_id`; add only if historical rows get a backfill policy.
- Risk: integration test file naming may fold into existing settings/notifications tests depending on current harness; keep one focused runnable test file either way.
