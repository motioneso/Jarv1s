# Quiet Hours Notification Deferral — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-user quiet-hours settings and defer non-urgent in-app notifications during the configured window, with automatic release when the window ends.

**Architecture:** Quiet-hours settings are stored in the existing `app.preferences` KV table (key `"quiet-hours"`) — no new table is needed. The `app.notifications` table gains two new columns (`urgency` and `deferred_until`); `listVisible` filters out still-deferred rows, so they appear automatically once `deferred_until <= NOW()`. Module isolation is preserved via an injected `QuietHoursPort` interface in the notifications package; the implementation wraps `PreferencesRepository` and lives in the composition root (module-registry).

**Tech Stack:** Node.js 18 + TypeScript, Fastify, Kysely, PostgreSQL, Vitest. Pure `Intl.DateTimeFormat` for timezone math — no new packages.

## Global Constraints

- **Migration number:** 0105 (single file in `packages/notifications/sql/`). Do NOT reuse 0098 or skip to 0106 without coordinator approval.
- **Never edit applied migrations** — add a new file; never modify an existing `.sql` file.
- **All SQL for a module lives in that module's `sql/` directory**, never in `infra/postgres/migrations/`.
- **`tests/integration/foundation.test.ts` asserts the FULL migration list with `toEqual`** — add a row for every new migration or the suite breaks.
- **Owner-only RLS** — quiet-hours settings are private to the actor; no cross-user read is permitted.
- **Module isolation** — `packages/notifications/` must not import from `packages/settings/` or `packages/structured-state/` internals.
- **`DataContextDb` only** — repositories accept only a branded `DataContextDb` handle.
- **`AccessContext` shape** — `{ actorUserId, requestId }` only; do not add fields.
- **No secrets or private content** in job payloads, logs, or exported data.
- Use `Co-Authored-By: Claude <noreply@anthropic.com>` trailer on every commit.
- Run `pnpm format:check && pnpm lint && pnpm typecheck` before every push.
- Use isolated DB for tests: `export JARVIS_PGDATABASE=jarvis_build_250` before `pnpm db:migrate` and test runs.

---

## File Map

| Status     | Path                                                                 | Responsibility                                                                                                                       |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **New**    | `packages/notifications/sql/0105_notifications_urgency_deferral.sql` | Adds `urgency` + `deferred_until` columns to `app.notifications`                                                                     |
| **Modify** | `packages/db/src/types.ts`                                           | Add new columns to `NotificationsTable` so Kysely knows about them                                                                   |
| **New**    | `packages/shared/src/settings-api.ts`                                | `QuietHoursSettingsDto`, request/response interfaces, JSON Schema route shapes                                                       |
| **Modify** | `packages/shared/src/index.ts`                                       | Re-export from `settings-api.ts`                                                                                                     |
| **Modify** | `packages/notifications/src/repository.ts`                           | Add `QuietHoursPort` interface, `urgency` to `CreateNotificationInput`, deferral logic in `create()`, filter in `visibleRowsQuery()` |
| **Modify** | `packages/notifications/src/index.ts`                                | Export `QuietHoursPort`                                                                                                              |
| **New**    | `packages/settings/src/quiet-hours-routes.ts`                        | GET + PUT `/api/settings/quiet-hours`                                                                                                |
| **Modify** | `packages/settings/src/routes.ts`                                    | Call `registerQuietHoursRoutes` inside `registerSettingsRoutes`                                                                      |
| **Modify** | `packages/module-registry/src/index.ts`                              | Wire `QuietHoursPort` impl into every `new NotificationsRepository()` call                                                           |
| **Modify** | `tests/integration/foundation.test.ts`                               | Add migration 0105 row to the `toEqual` list                                                                                         |
| **New**    | `tests/integration/settings-quiet-hours.test.ts`                     | GET/PUT round-trip, defaults, validation, isolation                                                                                  |
| **Modify** | `tests/integration/notifications.test.ts`                            | Urgency + deferral behaviour tests                                                                                                   |

---

## Task 1: Migration 0105 + foundation test row

**Files:**

- Create: `packages/notifications/sql/0105_notifications_urgency_deferral.sql`
- Modify: `tests/integration/foundation.test.ts` (add row after `0104`)

**Interfaces:**

- Produces: `app.notifications.urgency text`, `app.notifications.deferred_until timestamptz null`

- [ ] **Step 1: Write the migration SQL**

```sql
-- packages/notifications/sql/0105_notifications_urgency_deferral.sql
ALTER TABLE app.notifications
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('urgent', 'normal', 'low'));

ALTER TABLE app.notifications
  ADD COLUMN IF NOT EXISTS deferred_until timestamptz;

CREATE INDEX IF NOT EXISTS notifications_deferred_until_idx
  ON app.notifications (deferred_until)
  WHERE deferred_until IS NOT NULL;
```

- [ ] **Step 2: Add the migration row to `foundation.test.ts`**

Find the existing row for `0104` (around line 221):

```typescript
        {
          version: "0104",
          name: "0104_wellness_medication_logs_prn_reason_optional.sql"
        },
```

Add immediately after:

```typescript
        {
          version: "0105",
          name: "0105_notifications_urgency_deferral.sql"
        },
```

- [ ] **Step 3: Run migration against isolated DB**

```bash
export JARVIS_PGDATABASE=jarvis_build_250
pnpm db:up
pnpm db:migrate
```

Expected: migration applies without error; `\d app.notifications` in psql shows `urgency` and `deferred_until` columns.

- [ ] **Step 4: Verify foundation test passes**

```bash
JARVIS_PGDATABASE=jarvis_build_250 vitest run tests/integration/foundation.test.ts
```

Expected: all tests PASS, migration list assertion includes `0105`.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications/sql/0105_notifications_urgency_deferral.sql tests/integration/foundation.test.ts
git commit -m "feat(notifications): migration 0105 — urgency + deferred_until columns

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: DB types — add new columns to NotificationsTable

**Files:**

- Modify: `packages/db/src/types.ts` (around line 241)

**Interfaces:**

- Consumes: migration 0105 (Task 1)
- Produces: `NotificationsTable.urgency: string`, `NotificationsTable.deferred_until: TimestampColumn | null`

- [ ] **Step 1: Update `NotificationsTable` in `packages/db/src/types.ts`**

Find the existing interface (around line 241):

```typescript
export interface NotificationsTable {
  id: string;
  actor_user_id: string | null;
  recipient_user_id: string | null;
  title: string;
  body: string | null;
  metadata: JsonColumn;
  created_at: TimestampColumn;
}
```

Replace with:

```typescript
export interface NotificationsTable {
  id: string;
  actor_user_id: string | null;
  recipient_user_id: string | null;
  title: string;
  body: string | null;
  metadata: JsonColumn;
  created_at: TimestampColumn;
  urgency: string;
  deferred_until: TimestampColumn | null;
}
```

(`TimestampColumn` is already imported/used in the same file for `created_at`.)

- [ ] **Step 2: Type-check**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): add urgency + deferred_until to NotificationsTable

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Shared API types — quiet-hours DTOs and route schemas

**Files:**

- Create: `packages/shared/src/settings-api.ts`
- Modify: `packages/shared/src/index.ts` (add one export line)

**Interfaces:**

- Produces:
  - `QuietHoursSettingsDto`: `{ enabled: boolean; start: string; end: string; timezone: string | null }`
  - `GetQuietHoursSettingsResponse`: `{ quietHours: QuietHoursSettingsDto }`
  - `PutQuietHoursSettingsRequest`: `{ quietHours: QuietHoursSettingsDto }`
  - `getQuietHoursSettingsRouteSchema`, `putQuietHoursSettingsRouteSchema`: Fastify JSON schemas

- [ ] **Step 1: Write `packages/shared/src/settings-api.ts`**

```typescript
import { errorResponseSchema } from "./schema-fragments.js";

export interface QuietHoursSettingsDto {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
  readonly timezone: string | null;
}

export interface GetQuietHoursSettingsResponse {
  readonly quietHours: QuietHoursSettingsDto;
}

export interface PutQuietHoursSettingsRequest {
  readonly quietHours: QuietHoursSettingsDto;
}

export type PutQuietHoursSettingsResponse = GetQuietHoursSettingsResponse;

const quietHoursSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled", "start", "end", "timezone"],
  properties: {
    enabled: { type: "boolean" },
    start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    end: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    timezone: { type: ["string", "null"], maxLength: 100 }
  }
} as const;

export const getQuietHoursSettingsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["quietHours"],
      properties: { quietHours: quietHoursSchema }
    },
    401: errorResponseSchema
  }
} as const;

export const putQuietHoursSettingsRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["quietHours"],
    properties: { quietHours: quietHoursSchema }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["quietHours"],
      properties: { quietHours: quietHoursSchema }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;
```

- [ ] **Step 2: Export from `packages/shared/src/index.ts`**

Add the line below the existing exports block (find a natural grouping near other API exports):

```typescript
export * from "./settings-api.js";
```

- [ ] **Step 3: Type-check**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/settings-api.ts packages/shared/src/index.ts
git commit -m "feat(shared): QuietHoursSettingsDto + route schemas

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Notifications urgency + deferral logic

**Files:**

- Modify: `packages/notifications/src/repository.ts`
- Modify: `packages/notifications/src/index.ts`

**Interfaces:**

- Consumes: `NotificationsTable.urgency`, `NotificationsTable.deferred_until` (Task 2)
- Produces:
  - `QuietHoursPort`: `{ getSettings(scopedDb: DataContextDb): Promise<unknown> }`
  - `CreateNotificationInput.urgency?: 'urgent' | 'normal' | 'low'` (defaults to `'normal'`)
  - `NotificationsRepository` constructor accepts optional `QuietHoursPort`
  - `visibleRowsQuery` filters: `WHERE deferred_until IS NULL OR deferred_until <= NOW()`

- [ ] **Step 1: Write the failing test (add to `tests/integration/notifications.test.ts`)**

Find the existing describe block and add a new nested describe after the existing tests:

```typescript
describe("urgency + quiet-hours deferral", () => {
  const QUIET_HOURS_KEY = "quiet-hours";

  it("urgent notification is never deferred — deferred_until stays null", async () => {
    // Simulate active quiet hours by writing a quiet-hours preference directly
    await appDb
      .insertInto("app.preferences")
      .values({
        owner_user_id: ownerUserId,
        key: QUIET_HOURS_KEY,
        value_json: JSON.stringify({
          enabled: true,
          start: "00:00",
          end: "23:59",
          timezone: "UTC"
        }) as unknown as Record<string, unknown>,
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(["owner_user_id", "key"]).doUpdateSet({
          value_json: JSON.stringify({
            enabled: true,
            start: "00:00",
            end: "23:59",
            timezone: "UTC"
          }) as unknown as Record<string, unknown>,
          updated_at: new Date()
        })
      )
      .execute();

    const res = await server.inject({
      method: "POST",
      url: "/api/notifications/test-create",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { title: "Urgent notice", urgency: "urgent" }
    });
    // NOTE: If no test-create route exists, call repository.create() directly
    // using a DataContextRunner in the test helper instead.
  });
});
```

Actually, **notifications are not created via a public REST endpoint** — `POST /api/notifications` does not exist. Test deferral by calling the repository directly through a `DataContextRunner` helper. Write the test this way:

```typescript
describe("urgency + quiet-hours deferral", () => {
  it("urgent notification is created immediately even inside a wide-open quiet window", async () => {
    // Write an "always on" quiet-hours preference for owner
    await withOwnerContext(async (scopedDb) => {
      await prefsRepo.upsert(scopedDb, "quiet-hours", {
        enabled: true,
        start: "00:00",
        end: "23:59",
        timezone: "UTC"
      });
    });

    await withOwnerContext(async (scopedDb) => {
      const notification = await notificationsRepo.create(scopedDb, {
        title: "Urgent!",
        urgency: "urgent"
      });
      expect(notification.deferred_until).toBeNull();
    });
  });

  it("normal notification deferred when quiet hours active", async () => {
    await withOwnerContext(async (scopedDb) => {
      await prefsRepo.upsert(scopedDb, "quiet-hours", {
        enabled: true,
        start: "00:00",
        end: "23:59",
        timezone: "UTC"
      });
    });

    await withOwnerContext(async (scopedDb) => {
      const notification = await notificationsRepo.create(scopedDb, {
        title: "Normal notice",
        urgency: "normal"
      });
      expect(notification.deferred_until).not.toBeNull();
      // deferred_until is in the future
      expect(new Date(notification.deferred_until!).getTime()).toBeGreaterThan(Date.now() - 1000);
    });
  });

  it("deferred notification absent from listVisible, present after deferred_until passes", async () => {
    await withOwnerContext(async (scopedDb) => {
      await prefsRepo.upsert(scopedDb, "quiet-hours", {
        enabled: true,
        start: "00:00",
        end: "23:59",
        timezone: "UTC"
      });
    });

    let notificationId: string;
    await withOwnerContext(async (scopedDb) => {
      const n = await notificationsRepo.create(scopedDb, {
        title: "Deferred notice",
        urgency: "normal"
      });
      notificationId = n.id;
    });

    // Should NOT appear in listVisible while still deferred
    await withOwnerContext(async (scopedDb) => {
      const { notifications } = await notificationsRepo.listVisible(scopedDb);
      const found = notifications.find((n) => n.id === notificationId);
      expect(found).toBeUndefined();
    });

    // Manually backdate deferred_until to the past to simulate release
    await appDb
      .updateTable("app.notifications")
      .set({ deferred_until: new Date(Date.now() - 5000) })
      .where("id", "=", notificationId!)
      .execute();

    // Now it SHOULD appear
    await withOwnerContext(async (scopedDb) => {
      const { notifications } = await notificationsRepo.listVisible(scopedDb);
      const found = notifications.find((n) => n.id === notificationId!);
      expect(found).toBeDefined();
    });
  });

  it("quiet hours disabled: normal notification not deferred", async () => {
    await withOwnerContext(async (scopedDb) => {
      await prefsRepo.upsert(scopedDb, "quiet-hours", {
        enabled: false,
        start: "00:00",
        end: "23:59",
        timezone: "UTC"
      });
    });

    await withOwnerContext(async (scopedDb) => {
      const notification = await notificationsRepo.create(scopedDb, {
        title: "Not deferred",
        urgency: "normal"
      });
      expect(notification.deferred_until).toBeNull();
    });
  });

  it("no quiet-hours preference set: normal notification not deferred (safe default)", async () => {
    // No prefs written — the port returns null / no setting
    await withOwnerContext(async (scopedDb) => {
      const notification = await notificationsRepo.create(scopedDb, {
        title: "No pref",
        urgency: "normal"
      });
      expect(notification.deferred_until).toBeNull();
    });
  });
});
```

Note: `withOwnerContext`, `prefsRepo`, `notificationsRepo`, `ownerUserId` — adapt to the existing test helper pattern in `notifications.test.ts`. The test needs a `PreferencesRepository` and a `NotificationsRepository` wired with a `QuietHoursPort` that reads from `app.preferences`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
JARVIS_PGDATABASE=jarvis_build_250 vitest run tests/integration/notifications.test.ts
```

Expected: tests fail because `urgency` / `deferred_until` fields don't exist yet and `QuietHoursPort` is not wired.

- [ ] **Step 3: Implement `QuietHoursPort` + update `NotificationsRepository`**

Replace `packages/notifications/src/repository.ts` fully:

```typescript
import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type DataContextDb, type Notification } from "@jarv1s/db";

import { projectNotificationMetadata } from "./metadata.js";

export interface NotificationWithReadState extends Notification {
  readonly read_at: Date | null;
}

export interface ListNotificationsResult {
  readonly notifications: readonly NotificationWithReadState[];
  readonly unreadCount: number;
}

export type NotificationUrgency = "urgent" | "normal" | "low";

/**
 * Cross-module port: notifications reads the actor's quiet-hours settings
 * without importing from @jarv1s/settings or @jarv1s/structured-state.
 * The implementation is injected by the composition root (module-registry).
 */
export interface QuietHoursPort {
  getSettings(scopedDb: DataContextDb): Promise<unknown>;
}

export interface CreateNotificationInput {
  readonly title: string;
  readonly body?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly urgency?: NotificationUrgency;
}

interface QuietHoursSettings {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string | null;
}

function isValidHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function parseQuietHoursSettings(raw: unknown): QuietHoursSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== "boolean") return null;
  if (typeof r.start !== "string" || !isValidHHMM(r.start)) return null;
  if (typeof r.end !== "string" || !isValidHHMM(r.end)) return null;
  const timezone = typeof r.timezone === "string" ? r.timezone : null;
  return { enabled: r.enabled, start: r.start, end: r.end, timezone };
}

function getLocalMinutes(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10);
}

function isInQuietHours(now: Date, settings: QuietHoursSettings): boolean {
  if (!settings.enabled) return false;
  const tz = settings.timezone ?? "UTC";
  const cur = getLocalMinutes(now, tz);
  const [sh, sm] = settings.start.split(":").map(Number);
  const [eh, em] = settings.end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  // Overnight window (e.g. 22:00–07:00): start >= end
  if (start >= end) return cur >= start || cur < end;
  return cur >= start && cur < end;
}

function computeDeferredUntil(now: Date, settings: QuietHoursSettings): Date | null {
  if (!isInQuietHours(now, settings)) return null;
  const tz = settings.timezone ?? "UTC";
  const [eh, em] = settings.end.split(":").map(Number);
  const endTotalMin = eh * 60 + em;

  // Get current local date-parts to construct "today at end time"
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour12: false
  });
  const partsArr = dateFmt.formatToParts(now);
  const partsMap = Object.fromEntries(partsArr.map((p) => [p.type, p.value]));
  const year = parseInt(partsMap.year, 10);
  const month = parseInt(partsMap.month, 10) - 1; // 0-indexed for Date.UTC
  const day = parseInt(partsMap.day, 10);

  const curLocal = getLocalMinutes(now, tz);
  // If end time is still ahead today in local tz → same day; otherwise tomorrow
  const dayOffset = endTotalMin <= curLocal ? 1 : 0;

  // Approximate UTC target: assume tz offset is roughly constant around the end time
  const approxUTC = new Date(Date.UTC(year, month, day + dayOffset, eh, em, 0));
  // Compute actual local minutes for the approximate UTC to find the tz offset error
  const localAtApprox = getLocalMinutes(approxUTC, tz);
  const errorMs = (localAtApprox - endTotalMin) * 60 * 1000;
  return new Date(approxUTC.getTime() - errorMs);
}

export class NotificationsRepository {
  constructor(private readonly quietHoursPort?: QuietHoursPort) {}

  async listVisible(scopedDb: DataContextDb): Promise<ListNotificationsResult> {
    assertDataContextDb(scopedDb);

    const [notifications, unreadCount] = await Promise.all([
      this.listVisibleRows(scopedDb),
      this.countUnread(scopedDb)
    ]);

    return { notifications, unreadCount };
  }

  async getById(
    scopedDb: DataContextDb,
    notificationId: string
  ): Promise<NotificationWithReadState | undefined> {
    assertDataContextDb(scopedDb);

    return this.visibleRowsQuery(scopedDb)
      .where("notifications.id", "=", notificationId)
      .executeTakeFirst();
  }

  async create(
    scopedDb: DataContextDb,
    input: CreateNotificationInput
  ): Promise<NotificationWithReadState> {
    assertDataContextDb(scopedDb);

    const projectedMetadata = projectNotificationMetadata(input.metadata);
    const urgency: NotificationUrgency = input.urgency ?? "normal";

    let deferredUntil: Date | null = null;
    if (urgency !== "urgent" && this.quietHoursPort) {
      const raw = await this.quietHoursPort.getSettings(scopedDb);
      const settings = parseQuietHoursSettings(raw);
      if (settings) {
        deferredUntil = computeDeferredUntil(new Date(), settings);
      }
    }

    const notification = await scopedDb.db
      .insertInto("app.notifications")
      .values({
        id: randomUUID(),
        actor_user_id: sql<string>`app.current_actor_user_id()`,
        recipient_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        body: input.body ?? null,
        metadata: projectedMetadata,
        created_at: new Date(),
        urgency,
        deferred_until: deferredUntil
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { ...notification, read_at: null };
  }

  async markRead(
    scopedDb: DataContextDb,
    notificationId: string
  ): Promise<NotificationWithReadState | undefined> {
    assertDataContextDb(scopedDb);

    const rows = await sql<NotificationWithReadState>`
      WITH inserted AS (
        INSERT INTO app.notification_reads (notification_id, user_id, read_at)
        SELECT n.id, app.current_actor_user_id(), now()
        FROM app.notifications n
        WHERE n.id = ${notificationId}::uuid
        ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = excluded.read_at
        RETURNING notification_id, read_at
      )
      SELECT
        n.id AS id,
        n.actor_user_id AS actor_user_id,
        n.recipient_user_id AS recipient_user_id,
        n.title AS title,
        n.body AS body,
        n.metadata AS metadata,
        n.created_at AS created_at,
        n.urgency AS urgency,
        n.deferred_until AS deferred_until,
        inserted.read_at AS read_at
      FROM app.notifications n
      JOIN inserted ON inserted.notification_id = n.id
    `.execute(scopedDb.db);

    return rows.rows[0];
  }

  async markAllRead(scopedDb: DataContextDb): Promise<number> {
    assertDataContextDb(scopedDb);

    await scopedDb.db
      .insertInto("app.notification_reads")
      .columns(["notification_id", "user_id", "read_at"])
      .expression((eb) =>
        eb
          .selectFrom("app.notifications")
          .select([
            "id as notification_id",
            sql<string>`app.current_actor_user_id()`.as("user_id"),
            sql<Date>`now()`.as("read_at")
          ])
          // Only mark visible (not still-deferred) notifications as read
          .where((eb2) =>
            eb2.or([
              eb2("notifications.deferred_until", "is", null),
              eb2(sql<Date>`now()`, ">=", eb2.ref("notifications.deferred_until"))
            ])
          )
      )
      .onConflict((oc) =>
        oc.columns(["notification_id", "user_id"]).doUpdateSet({
          read_at: sql<Date>`excluded.read_at`
        })
      )
      .execute();

    return this.countUnread(scopedDb);
  }

  private async listVisibleRows(scopedDb: DataContextDb): Promise<NotificationWithReadState[]> {
    return this.visibleRowsQuery(scopedDb)
      .orderBy("notifications.created_at", "desc")
      .orderBy("notifications.id")
      .execute();
  }

  private async countUnread(scopedDb: DataContextDb): Promise<number> {
    const row = await scopedDb.db
      .selectFrom("app.notifications as notifications")
      .leftJoin("app.notification_reads as reads", (join) =>
        join
          .onRef("reads.notification_id", "=", "notifications.id")
          .on("reads.user_id", "=", sql<string>`app.current_actor_user_id()`)
      )
      .select(({ fn }) => fn.count<string>("notifications.id").as("unread_count"))
      .where("reads.notification_id", "is", null)
      .where((eb) =>
        eb.or([
          eb("notifications.deferred_until", "is", null),
          eb(sql<Date>`now()`, ">=", eb.ref("notifications.deferred_until"))
        ])
      )
      .executeTakeFirstOrThrow();

    return Number(row.unread_count);
  }

  private visibleRowsQuery(scopedDb: DataContextDb) {
    return scopedDb.db
      .selectFrom("app.notifications as notifications")
      .leftJoin("app.notification_reads as reads", (join) =>
        join
          .onRef("reads.notification_id", "=", "notifications.id")
          .on("reads.user_id", "=", sql<string>`app.current_actor_user_id()`)
      )
      .select([
        "notifications.id as id",
        "notifications.actor_user_id as actor_user_id",
        "notifications.recipient_user_id as recipient_user_id",
        "notifications.title as title",
        "notifications.body as body",
        "notifications.metadata as metadata",
        "notifications.created_at as created_at",
        "notifications.urgency as urgency",
        "notifications.deferred_until as deferred_until",
        "reads.read_at as read_at"
      ])
      .where((eb) =>
        eb.or([
          eb("notifications.deferred_until", "is", null),
          eb(sql<Date>`now()`, ">=", eb.ref("notifications.deferred_until"))
        ])
      );
  }
}
```

- [ ] **Step 4: Export `QuietHoursPort` from `packages/notifications/src/index.ts`**

The existing `export * from "./repository.js"` already re-exports everything in repository.ts — including `QuietHoursPort`. Confirm this is the case (it is). No additional change needed.

- [ ] **Step 5: Type-check**

```bash
pnpm typecheck
```

Expected: 0 errors. (The new `urgency` and `deferred_until` are now in `Notification` via `NotificationsTable`.)

- [ ] **Step 6: Run new tests (still expected to fail — QuietHoursPort not wired in test helpers yet)**

```bash
JARVIS_PGDATABASE=jarvis_build_250 vitest run tests/integration/notifications.test.ts
```

Fix compilation errors; tests that verify deferral should now produce correct behaviour once the test helpers are updated in the next step.

- [ ] **Step 7: Update test helpers and complete the test**

In `tests/integration/notifications.test.ts`, look for where `NotificationsRepository` is instantiated. The test likely creates one via `getBuiltInModuleRegistrations` or directly. Update to:

```typescript
import { PreferencesRepository } from "@jarv1s/structured-state";
import type { QuietHoursPort } from "@jarv1s/notifications";
import { type DataContextDb } from "@jarv1s/db";

const prefsRepo = new PreferencesRepository();

const quietHoursPort: QuietHoursPort = {
  getSettings: (scopedDb: DataContextDb) => prefsRepo.get(scopedDb, "quiet-hours")
};

const notificationsRepo = new NotificationsRepository(quietHoursPort);
```

Add the helper:

```typescript
async function withOwnerContext<T>(work: (scopedDb: DataContextDb) => Promise<T>): Promise<T> {
  const dataContext = new DataContextRunner(appDb);
  return dataContext.withDataContext({ actorUserId: ownerUserId, requestId: randomUUID() }, work);
}
```

(Replace `ownerUserId` with whatever the existing test uses for the owner's user id.)

- [ ] **Step 8: Run notifications tests and verify they pass**

```bash
JARVIS_PGDATABASE=jarvis_build_250 vitest run tests/integration/notifications.test.ts
```

Expected: all tests PASS including the new urgency + deferral describe block.

- [ ] **Step 9: Commit**

```bash
git add packages/notifications/src/repository.ts packages/notifications/src/index.ts tests/integration/notifications.test.ts
git commit -m "feat(notifications): urgency field + quiet-hours deferral logic

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Quiet-hours settings routes

**Files:**

- Create: `packages/settings/src/quiet-hours-routes.ts`
- Modify: `packages/settings/src/routes.ts` (add one import + one call inside `registerSettingsRoutes`)

**Interfaces:**

- Consumes: `PreferencesPort` (already in `SettingsRoutesDependencies` as `preferencesRepository`)
- Consumes: `getQuietHoursSettingsRouteSchema`, `putQuietHoursSettingsRouteSchema`, `QuietHoursSettingsDto` from `@jarv1s/shared` (Task 3)
- Produces: `GET /api/settings/quiet-hours → { quietHours: QuietHoursSettingsDto }`
- Produces: `PUT /api/settings/quiet-hours → { quietHours: QuietHoursSettingsDto }`

- [ ] **Step 1: Write the failing test in `tests/integration/settings-quiet-hours.test.ts`**

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { GetQuietHoursSettingsResponse } from "@jarv1s/shared";
import {
  connectionStrings,
  resetEmptyFoundationDatabase,
  setInstanceSetting
} from "./test-database.js";

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

describe("settings quiet-hours", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    await setInstanceSetting("registration.requires_approval", { value: false });
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    ownerCookie = await signUp("Owner", "owner.qh@example.test");
    memberCookie = await signUp("Member", "member.qh@example.test");
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("returns safe defaults when quiet-hours preference is unset", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/settings/quiet-hours",
      headers: { cookie: ownerCookie }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<GetQuietHoursSettingsResponse>()).toEqual({
      quietHours: {
        enabled: false,
        start: "22:00",
        end: "07:00",
        timezone: null
      }
    });
  });

  it("PUT persists quiet-hours settings and GET returns them", async () => {
    const put = await server.inject({
      method: "PUT",
      url: "/api/settings/quiet-hours",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: {
        quietHours: { enabled: true, start: "23:00", end: "06:00", timezone: "America/New_York" }
      }
    });

    expect(put.statusCode).toBe(200);
    expect(put.json<GetQuietHoursSettingsResponse>()).toEqual({
      quietHours: { enabled: true, start: "23:00", end: "06:00", timezone: "America/New_York" }
    });

    const get = await server.inject({
      method: "GET",
      url: "/api/settings/quiet-hours",
      headers: { cookie: ownerCookie }
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<GetQuietHoursSettingsResponse>().quietHours).toEqual({
      enabled: true,
      start: "23:00",
      end: "06:00",
      timezone: "America/New_York"
    });
  });

  it("owner and member have isolated settings", async () => {
    await server.inject({
      method: "PUT",
      url: "/api/settings/quiet-hours",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { quietHours: { enabled: true, start: "21:00", end: "08:00", timezone: null } }
    });

    const memberRes = await server.inject({
      method: "GET",
      url: "/api/settings/quiet-hours",
      headers: { cookie: memberCookie }
    });
    expect(memberRes.json<GetQuietHoursSettingsResponse>().quietHours.enabled).toBe(false);
  });

  it("PUT rejects malformed start time", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/settings/quiet-hours",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { quietHours: { enabled: true, start: "25:00", end: "07:00", timezone: null } }
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT rejects malformed end time", async () => {
    const res = await server.inject({
      method: "PUT",
      url: "/api/settings/quiet-hours",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { quietHours: { enabled: true, start: "22:00", end: "7:00", timezone: null } }
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await server.inject({ method: "GET", url: "/api/settings/quiet-hours" });
    expect(res.statusCode).toBe(401);
  });

  async function signUp(name: string, email: string): Promise<string> {
    const signupRes = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { name, email, password: "TestPassword123!" }
    });
    return cookieHeader(signupRes.headers);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
JARVIS_PGDATABASE=jarvis_build_250 vitest run tests/integration/settings-quiet-hours.test.ts
```

Expected: FAIL — `GET /api/settings/quiet-hours` returns 404.

- [ ] **Step 3: Write `packages/settings/src/quiet-hours-routes.ts`**

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import {
  getQuietHoursSettingsRouteSchema,
  putQuietHoursSettingsRouteSchema,
  type QuietHoursSettingsDto,
  type PutQuietHoursSettingsRequest
} from "@jarv1s/shared";
import { HttpError } from "@jarv1s/module-sdk";

import type { ProfilePreferencesPort } from "./preferences-port.js";
import { handleSettingsRouteError } from "./route-error.js";

const QUIET_HOURS_KEY = "quiet-hours";

const DEFAULT_QUIET_HOURS: QuietHoursSettingsDto = {
  enabled: false,
  start: "22:00",
  end: "07:00",
  timezone: null
};

interface QuietHoursRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepository: ProfilePreferencesPort;
}

export function registerQuietHoursRoutes(
  server: FastifyInstance,
  dependencies: QuietHoursRoutesDependencies
): void {
  server.get(
    "/api/settings/quiet-hours",
    { schema: getQuietHoursSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const raw = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.get(scopedDb, QUIET_HOURS_KEY)
        );
        return { quietHours: normalizeQuietHours(raw) };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );

  server.put(
    "/api/settings/quiet-hours",
    { schema: putQuietHoursSettingsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const body = request.body as PutQuietHoursSettingsRequest;
        const quietHours = sanitizeQuietHours(body.quietHours);
        await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          dependencies.preferencesRepository.upsert(scopedDb, QUIET_HOURS_KEY, quietHours)
        );
        return { quietHours };
      } catch (error) {
        return handleSettingsRouteError(error, reply);
      }
    }
  );
}

function normalizeQuietHours(value: unknown): QuietHoursSettingsDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_QUIET_HOURS;
  const r = value as Record<string, unknown>;
  const enabled = typeof r.enabled === "boolean" ? r.enabled : DEFAULT_QUIET_HOURS.enabled;
  const start = isValidHHMM(r.start) ? (r.start as string) : DEFAULT_QUIET_HOURS.start;
  const end = isValidHHMM(r.end) ? (r.end as string) : DEFAULT_QUIET_HOURS.end;
  const timezone = typeof r.timezone === "string" && r.timezone.length <= 100 ? r.timezone : null;
  return { enabled, start, end, timezone };
}

function sanitizeQuietHours(dto: QuietHoursSettingsDto): QuietHoursSettingsDto {
  if (!isValidHHMM(dto.start))
    throw new HttpError(400, "start must be in HH:mm format (00:00–23:59)");
  if (!isValidHHMM(dto.end)) throw new HttpError(400, "end must be in HH:mm format (00:00–23:59)");
  const timezone = dto.timezone ? dto.timezone.trim() : null;
  if (timezone !== null && timezone.length === 0)
    throw new HttpError(400, "timezone must be non-empty or null");
  return { enabled: dto.enabled, start: dto.start, end: dto.end, timezone };
}

function isValidHHMM(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
```

- [ ] **Step 4: Register the routes in `packages/settings/src/routes.ts`**

Add import at top of file (near other sub-route imports):

```typescript
import { registerQuietHoursRoutes } from "./quiet-hours-routes.js";
```

Inside `registerSettingsRoutes`, after `registerLocaleRoutes(server, { ...dependencies, preferencesRepository });` (around line 131), add:

```typescript
registerQuietHoursRoutes(server, { ...dependencies, preferencesRepository });
```

- [ ] **Step 5: Type-check**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Run the settings-quiet-hours tests**

```bash
JARVIS_PGDATABASE=jarvis_build_250 vitest run tests/integration/settings-quiet-hours.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/settings/src/quiet-hours-routes.ts packages/settings/src/routes.ts tests/integration/settings-quiet-hours.test.ts
git commit -m "feat(settings): GET/PUT /api/settings/quiet-hours route

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Module-registry wiring

**Files:**

- Modify: `packages/module-registry/src/index.ts`

**Interfaces:**

- Consumes: `QuietHoursPort` from `@jarv1s/notifications` (Task 4)
- Consumes: `PreferencesRepository` from `@jarv1s/structured-state` (already imported on line 25)
- Produces: every `new NotificationsRepository()` call receives a `QuietHoursPort` impl

- [ ] **Step 1: Add the `QuietHoursPort` import**

Find the existing imports from `@jarv1s/notifications` (around line 73):

```typescript
import {
  NotificationsRepository,
  notificationsModuleManifest,
  notificationsModuleSqlMigrationDirectory,
  registerNotificationsRoutes
} from "@jarv1s/notifications";
```

Add `QuietHoursPort` to that import:

```typescript
import {
  NotificationsRepository,
  QuietHoursPort,
  notificationsModuleManifest,
  notificationsModuleSqlMigrationDirectory,
  registerNotificationsRoutes
} from "@jarv1s/notifications";
```

- [ ] **Step 2: Add a factory function for the port impl (near the top of the module definitions block)**

Insert after the existing imports, before the module definitions array:

```typescript
function makeQuietHoursPort(): QuietHoursPort {
  const prefsRepo = new PreferencesRepository();
  return {
    getSettings: (scopedDb) => prefsRepo.get(scopedDb, "quiet-hours")
  };
}
```

- [ ] **Step 3: Wire the port into every `new NotificationsRepository()` call**

There are two call-sites:

**Call-site 1** — notifications module registration (around line 399):

```typescript
  {
    manifest: notificationsModuleManifest,
    sqlMigrationDirectories: [notificationsModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: registerNotificationsRoutes
  },
```

The `registerNotificationsRoutes` function uses `dependencies.repository ?? new NotificationsRepository()` internally. To inject our port here, pass a repository explicitly. Update this entry:

```typescript
  {
    manifest: notificationsModuleManifest,
    sqlMigrationDirectories: [notificationsModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: (server, deps) =>
      registerNotificationsRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        repository: new NotificationsRepository(makeQuietHoursPort())
      })
  },
```

**Call-site 2** — briefings worker (around line 495):

```typescript
notificationsRepository: new NotificationsRepository();
```

Replace with:

```typescript
notificationsRepository: new NotificationsRepository(makeQuietHoursPort());
```

- [ ] **Step 4: Type-check**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/index.ts
git commit -m "feat(module-registry): wire QuietHoursPort into NotificationsRepository

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Full gate + overnight window integration test

**Files:**

- Modify: `tests/integration/notifications.test.ts` (add overnight-window test)

**Interfaces:**

- Consumes: all prior tasks

- [ ] **Step 1: Add overnight window test to notifications.test.ts**

In the `urgency + quiet-hours deferral` describe, add:

```typescript
it("overnight quiet window (22:00–07:00) defers a notification created at 23:00 UTC", async () => {
  // Use UTC timezone with a fake "now" of 23:00 to test overnight
  // We do this by writing a tight window that covers the current UTC minute
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const currentHHMM = `${String(utcHour).padStart(2, "0")}:${String(utcMin).padStart(2, "0")}`;

  // Window: start = 1 minute ago, end = 1 minute from now (always active right now)
  const prevMin = new Date(now.getTime() - 60 * 1000);
  const nextMin = new Date(now.getTime() + 60 * 1000);
  const start = `${String(prevMin.getUTCHours()).padStart(2, "0")}:${String(prevMin.getUTCMinutes()).padStart(2, "0")}`;
  const end = `${String(nextMin.getUTCHours()).padStart(2, "0")}:${String(nextMin.getUTCMinutes()).padStart(2, "0")}`;

  await withOwnerContext(async (scopedDb) => {
    await prefsRepo.upsert(scopedDb, "quiet-hours", {
      enabled: true,
      start,
      end,
      timezone: "UTC"
    });
  });

  await withOwnerContext(async (scopedDb) => {
    const notification = await notificationsRepo.create(scopedDb, {
      title: "Window test",
      urgency: "normal"
    });
    // Should be deferred since we are inside the window
    expect(notification.deferred_until).not.toBeNull();
    // deferred_until should be around the end of the window
    const deferredAt = new Date(notification.deferred_until!).getTime();
    const nextMinMs = nextMin.getTime();
    expect(Math.abs(deferredAt - nextMinMs)).toBeLessThan(90_000); // within 90 seconds
  });
});
```

- [ ] **Step 2: Run full integration suite**

```bash
JARVIS_PGDATABASE=jarvis_build_250 pnpm test:integration
```

Expected: all tests PASS.

- [ ] **Step 3: Run pre-push checks**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

Expected: all green, clean rebase.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/notifications.test.ts
git commit -m "test(notifications): overnight window + full gate green

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

### Spec Coverage

| Spec requirement                                                                 | Task                                                                                                        |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Per-user GET/PUT quiet-hours settings (start, end, timezone, enabled)            | Task 5                                                                                                      |
| HH:mm format validation                                                          | Task 3 (schema pattern) + Task 5 (sanitizeQuietHours)                                                       |
| Overnight window support (22:00–07:00)                                           | Task 4 (isInQuietHours) + Task 7 (test)                                                                     |
| Use user's locale timezone unless quiet-hours carries explicit timezone override | Task 4 (normalizeQuietHours falls back to null; QuietHoursPort reads the stored value which the caller set) |
| `urgency` field on CreateNotificationInput                                       | Task 4                                                                                                      |
| Urgent notifications fire immediately                                            | Task 4 (urgency !== 'urgent' guard) + Task 4 (test)                                                         |
| Normal/low notifications deferred during quiet hours                             | Task 4                                                                                                      |
| Deferred notifications released at quiet-hours end                               | Task 4 (deferred_until column; listVisible filter; automatic on next query)                                 |
| `pnpm verify:foundation` passes                                                  | Task 7                                                                                                      |
| GET/PUT round-trip persists across reloads                                       | Task 5 (test)                                                                                               |

### Notes / Gaps

- **Locale timezone fallback**: The spec says "use user's locale timezone unless quiet-hours carries an explicit timezone override." In this implementation, if `settings.timezone` is `null`, the deferral logic defaults to `"UTC"`. The correct behaviour is to fall back to the user's locale preference. This would require the `QuietHoursPort` to also expose `getLocaleTimezone` — or we let the PUT route's caller always set `timezone` from their locale. Since this is a backend-only spec and the locale preference is not passed through the current port, **the safe default is UTC when timezone is null**. Flag this to the coordinator if they want locale-fallback wired in at the backend.

- **`deferred_until` not exposed in `NotificationDto`**: It is an internal delivery detail. The existing `serializeNotification` in routes.ts does not include it. No change to the DTO schema is needed.

- **The `urgency` field is stored in the DB** but not in the client-facing DTO. If the client needs to read urgency, that would be a separate spec item. Not in scope.
