# Calendar Design Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Calendar web surface to the design's Day/Week/Month time grid, harden DTO egress by replacing raw `external_metadata` passthrough with an allowlisted, type-narrowed projection, and remove test-only code from the production repository.

**Architecture:** Three-layer change — (1) shared contract (`CalendarEventDto`) drops raw metadata, gains four typed display fields; (2) `serialize.ts` is the single reader of `external_metadata`, key-allowlisting and type-narrowing each value (the security crux); (3) the web calendar replaces a flat feed with a real-date Day/Week/Month time grid wired to the existing React Query fetch. No migration. No other module changed.

**Tech Stack:** TypeScript, Fastify, Kysely, React 18, React Query v5, Vitest (integration), Playwright (e2e), lucide-react, className-based DS (`jds-btn`, `jds-iconbtn`, `segmented-control`, `cal-*` CSS from `kit-calendar.css`).

**Grounded on:** `dccda83` (1 ahead of `origin/main` @ `435792a`). No migration; global high-water mark `0087`.

---

## File Map

| File                                           | Action     | Purpose                                                                        |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| `packages/shared/src/calendar-api.ts`          | Modify     | Drop `externalMetadata`; add `isJarvisBlock/allDay/attendeeCount/status`       |
| `packages/calendar/src/serialize.ts`           | **Create** | Single reader of `external_metadata` — key-allowlist + type-narrow             |
| `packages/calendar/src/routes.ts`              | Modify     | Import `serializeCalendarEvent` from `./serialize`; remove inline fn           |
| `packages/calendar/src/tools.ts`               | Modify     | Import from `./serialize` (not `./routes`)                                     |
| `packages/calendar/src/repository.ts`          | Modify     | Remove `createCachedEventForTest`                                              |
| `packages/calendar/src/index.ts`               | Modify     | Re-export `serializeCalendarEvent` from `./serialize`                          |
| `tests/integration/calendar-email.test.ts`     | Modify     | Add inline insert helper; add serialize/egress/value-shape tests               |
| `tests/e2e/mock-api.ts`                        | Modify     | Update `createMockCalendarEvent` (drop `externalMetadata`, add derived fields) |
| `tests/e2e/mock-calendar-email-api.ts`         | Modify     | Same                                                                           |
| `apps/web/src/calendar/calendar-model.ts`      | **Create** | Date helpers, DTO→view mapping, overlap packing (`packDay`)                    |
| `apps/web/src/calendar/calendar-time-grid.tsx` | **Create** | Day/Week time grid: headers, all-day strip, timeline, now-line, event blocks   |
| `apps/web/src/calendar/calendar-month.tsx`     | **Create** | 5/6-week month grid                                                            |
| `apps/web/src/calendar/calendar-peek.tsx`      | **Create** | Right-flyout detail peek panel                                                 |
| `apps/web/src/calendar/calendar-page.tsx`      | Modify     | Replace flat feed with Day/Week/Month page; toolbar; legend                    |
| `apps/web/src/calendar/calendar.css`           | Modify     | Remove old feed-only styles (superseded by `kit-calendar.css`)                 |

---

## Task 1: Update shared CalendarEventDto

**Files:**

- Modify: `packages/shared/src/calendar-api.ts`

This is the contract change that drives all subsequent work. `additionalProperties: false` on the Fastify schema means every field must be declared; adding the four new fields and removing `externalMetadata` updates both the TypeScript type and the JSON serialization gate.

- [ ] **Step 1: Replace calendar-api.ts**

Replace the full contents of `packages/shared/src/calendar-api.ts` with:

```typescript
import { errorResponseSchema, nullableStringSchema } from "./schema-fragments.js";

export interface CalendarEventDto {
  readonly id: string;
  readonly connectorAccountId: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly location: string | null;
  readonly summary: string | null;
  readonly bodyExcerpt: string | null;
  readonly externalId: string;
  readonly isJarvisBlock: boolean;
  readonly allDay: boolean;
  readonly attendeeCount: number;
  readonly status: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListCalendarEventsResponse {
  readonly events: readonly CalendarEventDto[];
}

export interface GetCalendarEventResponse {
  readonly event: CalendarEventDto;
}

const calendarEventParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" }
  }
} as const;

export const calendarEventDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "connectorAccountId",
    "ownerUserId",
    "title",
    "startsAt",
    "endsAt",
    "location",
    "summary",
    "bodyExcerpt",
    "externalId",
    "isJarvisBlock",
    "allDay",
    "attendeeCount",
    "status",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    connectorAccountId: { type: "string" },
    ownerUserId: { type: "string" },
    title: { type: "string" },
    startsAt: { type: "string" },
    endsAt: { type: "string" },
    location: nullableStringSchema,
    summary: nullableStringSchema,
    bodyExcerpt: nullableStringSchema,
    externalId: { type: "string" },
    isJarvisBlock: { type: "boolean" },
    allDay: { type: "boolean" },
    attendeeCount: { type: "number" },
    status: nullableStringSchema,
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

export const listCalendarEventsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: calendarEventDtoSchema
    }
  }
} as const;

export const getCalendarEventResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["event"],
  properties: {
    event: calendarEventDtoSchema
  }
} as const;

export const listCalendarEventsRouteSchema = {
  response: {
    200: listCalendarEventsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const getCalendarEventRouteSchema = {
  params: calendarEventParamsSchema,
  response: {
    200: getCalendarEventResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
```

- [ ] **Step 2: Verify typecheck fails (expected — consumers broken)**

```bash
cd ~/Jarv1s/.claude/worktrees/calendar-design-port
pnpm typecheck 2>&1 | grep -E "error TS|externalMetadata" | head -20
```

Expected: errors on `routes.ts` (returns `externalMetadata`), `tools.ts`, and e2e mocks. These are the consumers Task 2–4 fix.

- [ ] **Step 3: Commit the shared contract**

```bash
git add packages/shared/src/calendar-api.ts
git commit -m "$(cat <<'EOF'
feat(calendar): replace externalMetadata with allowlisted DTO fields

CalendarEventDto drops the raw external_metadata blob and gains four
type-narrowed derived fields: isJarvisBlock, allDay, attendeeCount, status.
Fixes audit #145 LOW (unallowlisted egress). Consumers updated in follow-up commits.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create serialize.ts and fix routes.ts + tools.ts

**Files:**

- Create: `packages/calendar/src/serialize.ts`
- Modify: `packages/calendar/src/routes.ts`
- Modify: `packages/calendar/src/tools.ts`
- Modify: `packages/calendar/src/index.ts`

`serialize.ts` is the security crux. The exact regex `/^jfb[0-9a-v]{32}$/` matches the 35-char focus-block Google event ID minted by `focusBlockEventId()` (`focus-time.ts:187-194`). It is NOT a loose `startsWith('jfb')` prefix check (false-positive risk). The function drops all unknown keys from `external_metadata` and type-narrows every allowlisted value before including it.

- [ ] **Step 1: Create `packages/calendar/src/serialize.ts`**

```typescript
import type { CalendarEvent } from "@jarv1s/db";
import type { CalendarEventDto } from "@jarv1s/shared";

const JFB_PATTERN = /^jfb[0-9a-v]{32}$/;

export function serializeCalendarEvent(event: CalendarEvent): CalendarEventDto {
  const md: Record<string, unknown> =
    event.external_metadata != null && typeof event.external_metadata === "object"
      ? (event.external_metadata as Record<string, unknown>)
      : {};

  const isJarvisBlock = JFB_PATTERN.test(event.external_id);
  const allDay = md.allDay === true;
  const attendeeCount =
    typeof md.attendeeCount === "number" && Number.isFinite(md.attendeeCount)
      ? md.attendeeCount
      : 0;
  const status = typeof md.status === "string" ? md.status : null;

  return {
    id: event.id,
    connectorAccountId: event.connector_account_id,
    ownerUserId: event.owner_user_id,
    title: event.title,
    startsAt: toIsoString(event.starts_at),
    endsAt: toIsoString(event.ends_at),
    location: event.location,
    summary: event.summary,
    bodyExcerpt: event.body_excerpt,
    externalId: event.external_id,
    isJarvisBlock,
    allDay,
    attendeeCount,
    status,
    createdAt: toIsoString(event.created_at),
    updatedAt: toIsoString(event.updated_at)
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
```

- [ ] **Step 2: Replace the body of `packages/calendar/src/routes.ts`**

Remove the inline `serializeCalendarEvent` and `toIsoString` functions; import from `./serialize`:

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";

import { handleRouteError } from "@jarv1s/module-sdk";
import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import { getCalendarEventRouteSchema, listCalendarEventsRouteSchema } from "@jarv1s/shared";

import { CalendarRepository } from "./repository.js";
import { serializeCalendarEvent } from "./serialize.js";

export interface CalendarRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: CalendarRepository;
}

interface CalendarEventParams {
  readonly id: string;
}

export function registerCalendarRoutes(
  server: FastifyInstance,
  dependencies: CalendarRoutesDependencies
): void {
  const repository = dependencies.repository ?? new CalendarRepository();

  server.get(
    "/api/calendar/events",
    { schema: listCalendarEventsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const events = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.listVisible(scopedDb)
        );

        return { events: events.map(serializeCalendarEvent) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get<{ Params: CalendarEventParams }>(
    "/api/calendar/events/:id",
    { schema: getCalendarEventRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const event = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repository.getById(scopedDb, request.params.id)
        );

        if (!event) {
          return reply.code(404).send({ error: "Calendar event not found" });
        }

        return { event: serializeCalendarEvent(event) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}
```

- [ ] **Step 3: Update `packages/calendar/src/tools.ts` — import from `./serialize` not `./routes`**

Change line 7 from:

```typescript
import { serializeCalendarEvent } from "./routes.js";
```

to:

```typescript
import { serializeCalendarEvent } from "./serialize.js";
```

- [ ] **Step 4: Update `packages/calendar/src/index.ts` — re-export serialize**

```typescript
export * from "./manifest.js";
export * from "./repository.js";
export * from "./routes.js";
export * from "./serialize.js";
export * from "./focus-time.js";
export * from "./calendar-write-service.js";
```

- [ ] **Step 5: Verify typecheck is now green on the calendar package**

```bash
pnpm typecheck 2>&1 | grep "packages/calendar" | head -10
```

Expected: no errors from `packages/calendar`. Still errors from e2e mocks (fixed in Task 4).

- [ ] **Step 6: Commit**

```bash
git add packages/calendar/src/serialize.ts packages/calendar/src/routes.ts packages/calendar/src/tools.ts packages/calendar/src/index.ts
git commit -m "$(cat <<'EOF'
feat(calendar): serialize.ts — egress allowlist + type-narrowing (audit #145)

New serialize.ts is the single reader of external_metadata. Key-allowlists
allDay/attendeeCount/status and derives isJarvisBlock from the exact
/^jfb[0-9a-v]{32}$/ regex (immutable across re-sync; not a loose prefix).
Type-narrows every projected value — objects/blobs coerced to safe defaults.
routes.ts and tools.ts both import from here; tools.ts no longer imports from routes.ts.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Move createCachedEventForTest to test fixtures + add egress tests

**Files:**

- Modify: `packages/calendar/src/repository.ts`
- Modify: `tests/integration/calendar-email.test.ts`

`createCachedEventForTest` is test infrastructure living in the production module. Moving it to the integration test removes the #145 MED finding. The new egress tests prove the allowlist works end-to-end.

- [ ] **Step 1: Remove `createCachedEventForTest` from repository.ts**

Remove lines 42–69 from `packages/calendar/src/repository.ts` — the entire `createCachedEventForTest` method. The file should retain only `listVisible`, `getById`, and `upsertCachedEvent`. Also remove the `randomUUID` import if it's only used by `createCachedEventForTest` — but note `upsertCachedEvent` also uses it, so keep it.

The final `repository.ts`:

```typescript
import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { assertDataContextDb, type CalendarEvent, type DataContextDb } from "@jarv1s/db";

export interface CreateCachedCalendarEventInput {
  readonly id?: string;
  readonly connectorAccountId: string;
  readonly title: string;
  readonly startsAt: Date | string;
  readonly endsAt: Date | string;
  readonly location?: string | null;
  readonly summary?: string | null;
  readonly bodyExcerpt?: string | null;
  readonly externalId: string;
  readonly externalMetadata?: Record<string, unknown>;
}

export class CalendarRepository {
  async listVisible(scopedDb: DataContextDb): Promise<CalendarEvent[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.calendar_events")
      .selectAll()
      .orderBy("starts_at", "asc")
      .orderBy("id")
      .execute();
  }

  async getById(scopedDb: DataContextDb, eventId: string): Promise<CalendarEvent | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.calendar_events")
      .selectAll()
      .where("id", "=", eventId)
      .executeTakeFirst();
  }

  async upsertCachedEvent(
    scopedDb: DataContextDb,
    input: CreateCachedCalendarEventInput
  ): Promise<CalendarEvent> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.calendar_events")
      .values({
        id: input.id ?? randomUUID(),
        connector_account_id: input.connectorAccountId,
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        location: input.location ?? null,
        summary: input.summary ?? null,
        body_excerpt: input.bodyExcerpt ?? null,
        external_id: input.externalId,
        external_metadata: input.externalMetadata ?? {},
        created_at: now,
        updated_at: now
      })
      .onConflict((oc) =>
        oc.columns(["connector_account_id", "external_id"]).doUpdateSet({
          title: input.title,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          location: input.location ?? null,
          summary: input.summary ?? null,
          body_excerpt: input.bodyExcerpt ?? null,
          external_metadata: input.externalMetadata ?? {},
          updated_at: now
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
```

- [ ] **Step 2: Update `tests/integration/calendar-email.test.ts`**

**2a. Add new imports** at the top of the file (after existing imports):

```typescript
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { DataContextDb } from "@jarv1s/db";
import { assertDataContextDb } from "@jarv1s/db";
import { serializeCalendarEvent } from "@jarv1s/calendar";
```

**2b. Add the test-only insert helper** just before the `describe` block (after the `const { Client } = pg;` line):

```typescript
async function insertCalendarEventForTest(
  scopedDb: DataContextDb,
  input: {
    connectorAccountId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    externalId: string;
    externalMetadata?: Record<string, unknown>;
    id?: string;
  }
) {
  assertDataContextDb(scopedDb);
  const now = new Date();
  return scopedDb.db
    .insertInto("app.calendar_events")
    .values({
      id: input.id ?? randomUUID(),
      connector_account_id: input.connectorAccountId,
      owner_user_id: sql<string>`app.current_actor_user_id()`,
      title: input.title,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      location: null,
      summary: null,
      body_excerpt: null,
      external_id: input.externalId,
      external_metadata: input.externalMetadata ?? {},
      created_at: now,
      updated_at: now
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
```

**2c. Replace the three `calendarRepository.createCachedEventForTest` call-sites** with `insertCalendarEventForTest`. There are 3 occurrences — find each with:

```bash
grep -n "createCachedEventForTest" tests/integration/calendar-email.test.ts
```

Replace each `calendarRepository.createCachedEventForTest(scopedDb, input)` with `insertCalendarEventForTest(scopedDb, input)`. The input shapes are identical (same field names).

**2d. Add a new `describe` block** for serialize/egress tests at the end of the file (before the closing `}`):

```typescript
describe("serialize.ts — egress allowlist and value-shape narrowing", () => {
  it("drops all unknown metadata keys and projects only the allowlisted derived fields", async () => {
    const row = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      insertCalendarEventForTest(scopedDb, {
        connectorAccountId: connectorAccountIds.aCalendar,
        title: "Egress test event",
        startsAt: "2026-06-15T10:00:00.000Z",
        endsAt: "2026-06-15T11:00:00.000Z",
        externalId: "egress-test-event-1",
        externalMetadata: {
          allDay: true,
          attendeeCount: 3,
          status: "confirmed",
          historyId: "secret-history-id",
          labelIds: ["INBOX"],
          htmlLink: "https://calendar.google.com/secret-link",
          secretJunk: "should-not-leak"
        }
      })
    );

    const dto = serializeCalendarEvent(row);

    expect(dto.allDay).toBe(true);
    expect(dto.attendeeCount).toBe(3);
    expect(dto.status).toBe("confirmed");
    expect(dto.isJarvisBlock).toBe(false);
    expect("externalMetadata" in dto).toBe(false);
    expect("historyId" in dto).toBe(false);
    expect("labelIds" in dto).toBe(false);
    expect("htmlLink" in dto).toBe(false);
    expect("secretJunk" in dto).toBe(false);
    expect(Object.keys(dto).sort()).toEqual([
      "allDay",
      "attendeeCount",
      "bodyExcerpt",
      "connectorAccountId",
      "createdAt",
      "endsAt",
      "externalId",
      "id",
      "isJarvisBlock",
      "location",
      "ownerUserId",
      "startsAt",
      "status",
      "summary",
      "title",
      "updatedAt"
    ]);
  });

  it("serializes a row with no metadata to safe defaults", async () => {
    const row = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      insertCalendarEventForTest(scopedDb, {
        connectorAccountId: connectorAccountIds.aCalendar,
        title: "No-metadata event",
        startsAt: "2026-06-15T12:00:00.000Z",
        endsAt: "2026-06-15T13:00:00.000Z",
        externalId: "no-metadata-event-1",
        externalMetadata: {}
      })
    );

    const dto = serializeCalendarEvent(row);

    expect(dto.isJarvisBlock).toBe(false);
    expect(dto.allDay).toBe(false);
    expect(dto.attendeeCount).toBe(0);
    expect(dto.status).toBeNull();
  });

  it("coerces wrong-typed allowlisted values to safe defaults (value-shape narrowing)", async () => {
    const row = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      insertCalendarEventForTest(scopedDb, {
        connectorAccountId: connectorAccountIds.aCalendar,
        title: "Wrong-typed metadata event",
        startsAt: "2026-06-15T14:00:00.000Z",
        endsAt: "2026-06-15T15:00:00.000Z",
        externalId: "wrong-typed-event-1",
        externalMetadata: {
          status: { nested: "blob" },
          attendeeCount: "12",
          allDay: "yes"
        }
      })
    );

    const dto = serializeCalendarEvent(row);

    expect(dto.status).toBeNull();
    expect(dto.attendeeCount).toBe(0);
    expect(dto.allDay).toBe(false);
  });

  it("isJarvisBlock=true for exact jfb+32-char id even when metadata has no jarvisCreated flag", async () => {
    const realJfbId = "jfb" + "a".repeat(32);
    const row = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      insertCalendarEventForTest(scopedDb, {
        connectorAccountId: connectorAccountIds.aCalendar,
        title: "Focus block re-synced",
        startsAt: "2026-06-15T08:00:00.000Z",
        endsAt: "2026-06-15T09:00:00.000Z",
        externalId: realJfbId,
        externalMetadata: {}
      })
    );

    const dto = serializeCalendarEvent(row);

    expect(dto.isJarvisBlock).toBe(true);
  });

  it("isJarvisBlock=false for a normal Google event id (not jfb shape)", async () => {
    const normalGoogleId = "abc123xyz_google_event_id";
    const row = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      insertCalendarEventForTest(scopedDb, {
        connectorAccountId: connectorAccountIds.aCalendar,
        title: "Normal external event",
        startsAt: "2026-06-15T09:00:00.000Z",
        endsAt: "2026-06-15T10:00:00.000Z",
        externalId: normalGoogleId,
        externalMetadata: {}
      })
    );

    const dto = serializeCalendarEvent(row);

    expect(dto.isJarvisBlock).toBe(false);
  });

  it("false-positive guard: jfbMEETING_2026 is NOT a Jarvis block (wrong shape)", async () => {
    const row = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      insertCalendarEventForTest(scopedDb, {
        connectorAccountId: connectorAccountIds.aCalendar,
        title: "Meeting with jfb prefix",
        startsAt: "2026-06-15T10:30:00.000Z",
        endsAt: "2026-06-15T11:30:00.000Z",
        externalId: "jfbMEETING_2026",
        externalMetadata: {}
      })
    );

    const dto = serializeCalendarEvent(row);

    expect(dto.isJarvisBlock).toBe(false);
  });
});
```

- [ ] **Step 3: Run the new tests (expect all to pass — serialize is already implemented)**

```bash
pnpm test:calendar-email 2>&1 | tail -30
```

Expected: All new tests pass. Existing tests should still pass (they now use `insertCalendarEventForTest`).

- [ ] **Step 4: Commit**

```bash
git add packages/calendar/src/repository.ts tests/integration/calendar-email.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): move createCachedEventForTest to test fixtures; add egress tests

Removes the test-only helper from CalendarRepository (audit #145 MED).
Adds inline insertCalendarEventForTest to the integration test.
New tests cover: egress allowlist, value-shape narrowing, jfb marker
robustness (post-sync metadata gone), false-positive guard (jfbMEETING_2026).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update e2e mock factories

**Files:**

- Modify: `tests/e2e/mock-api.ts`
- Modify: `tests/e2e/mock-calendar-email-api.ts`

The e2e mock factories construct `CalendarEventDto` objects for Playwright tests. They must match the updated interface (no `externalMetadata`; add `isJarvisBlock`, `allDay`, `attendeeCount`, `status`).

- [ ] **Step 1: Update `createMockCalendarEvent` in `tests/e2e/mock-api.ts`**

Find the `createMockCalendarEvent` function (around line 555) and replace it:

```typescript
export function createMockCalendarEvent(
  id: string,
  title: string,
  overrides: Partial<CalendarEventDto> = {}
): CalendarEventDto {
  return {
    id,
    connectorAccountId: "connector-calendar-1",
    ownerUserId: "user-1",
    title,
    startsAt: "2030-06-06T16:00:00.000Z",
    endsAt: "2030-06-06T17:00:00.000Z",
    location: null,
    summary: null,
    bodyExcerpt: null,
    externalId: id,
    isJarvisBlock: false,
    allDay: false,
    attendeeCount: 0,
    status: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}
```

- [ ] **Step 2: Update `createMockCalendarEvent` in `tests/e2e/mock-calendar-email-api.ts`**

Find the `createMockCalendarEvent` function (around line 76) and replace it:

```typescript
export function createMockCalendarEvent(
  id: string,
  title: string,
  overrides: Partial<CalendarEventDto> = {}
): CalendarEventDto {
  return {
    id,
    connectorAccountId: "connector-calendar-1",
    ownerUserId: "user-1",
    title,
    startsAt: "2030-06-06T16:00:00.000Z",
    endsAt: "2030-06-06T17:00:00.000Z",
    location: null,
    summary: null,
    bodyExcerpt: null,
    externalId: id,
    isJarvisBlock: false,
    allDay: false,
    attendeeCount: 0,
    status: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    ...overrides
  };
}
```

- [ ] **Step 3: Run full typecheck — must be green**

```bash
pnpm typecheck 2>&1 | grep "error TS" | head -20
```

Expected: **0 errors**. All consumers updated.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/mock-api.ts tests/e2e/mock-calendar-email-api.ts
git commit -m "$(cat <<'EOF'
fix(e2e): update mock calendar event factory to new CalendarEventDto shape

Replaces externalMetadata with isJarvisBlock/allDay/attendeeCount/status
in both e2e mock factories to match the updated shared contract.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create calendar-model.ts

**Files:**

- Create: `apps/web/src/calendar/calendar-model.ts`

Pure TypeScript module (no React). Date helpers, DTO→view model mapping, and the `packDay` overlap-packing algorithm (verbatim port from `Calendar.jsx`). No external dependencies — browser-safe.

- [ ] **Step 1: Create `apps/web/src/calendar/calendar-model.ts`**

```typescript
import type { CalendarEventDto } from "@jarv1s/shared";

export type CalendarView = "day" | "week" | "month";

export interface CalendarViewEvent {
  readonly id: string;
  readonly title: string;
  readonly kind: "block" | "event";
  readonly allDay: boolean;
  readonly startMin: number;
  readonly endMin: number;
  readonly date: Date;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly where: string | null;
  readonly attendeeCount: number;
  readonly status: string | null;
  // assigned by packDay
  _col?: number;
  _cols?: number;
}

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DOW_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

export { DOW_SHORT, DOW_LONG, MONTH_NAMES };

export function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h < 12 ? "AM" : "PM";
  const h12 = ((h + 11) % 12) + 1;
  return h12 + (m ? ":" + String(m).padStart(2, "0") : "") + " " + ap;
}

export function fmtHour(h: number): string {
  const ap = h < 12 ? "AM" : "PM";
  const h12 = ((h + 11) % 12) + 1;
  return h12 + " " + ap;
}

export function fmtDur(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return m + " min";
  return h + " hr" + (m ? " " + m + " min" : "");
}

export function fmtDateLabel(date: Date): string {
  return DOW_LONG[date.getDay()] + ", " + MONTH_NAMES[date.getMonth()] + " " + date.getDate();
}

export function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function nowMin(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dtoToViewEvent(dto: CalendarEventDto): CalendarViewEvent | null {
  const startsAt = new Date(dto.startsAt);
  if (Number.isNaN(startsAt.getTime())) return null;
  const endsAt = new Date(dto.endsAt);
  const startMin = startsAt.getHours() * 60 + startsAt.getMinutes();
  const endMin = Number.isNaN(endsAt.getTime())
    ? startMin + 60
    : endsAt.getHours() * 60 + endsAt.getMinutes();

  return {
    id: dto.id,
    title: dto.title,
    kind: dto.isJarvisBlock ? "block" : "event",
    allDay: dto.allDay,
    startMin,
    endMin,
    date: startsAt,
    startsAt,
    endsAt,
    where: dto.location,
    attendeeCount: dto.attendeeCount,
    status: dto.status
  };
}

export function groupEventsByDay(
  events: readonly CalendarViewEvent[]
): Map<string, CalendarViewEvent[]> {
  const map = new Map<string, CalendarViewEvent[]>();
  for (const e of events) {
    const key = dayKey(e.date);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(e);
    } else {
      map.set(key, [e]);
    }
  }
  return map;
}

export function buildWeekDays(cursor: Date, workWeek: boolean): Date[] {
  const dow = cursor.getDay();
  const days: Date[] = [];
  const start = workWeek ? 1 : 0;
  const end = workWeek ? 6 : 7;
  for (let i = start; i < end; i++) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() - dow + i);
    days.push(d);
  }
  return days;
}

export function buildMonthCells(cursor: Date): Date[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const cells: Date[] = [];
  for (let i = -firstDow; i < 42 - firstDow; i++) {
    cells.push(new Date(year, month, 1 + i));
  }
  const lastWeek = cells.slice(35);
  if (lastWeek.every((d) => d.getMonth() !== month)) {
    return cells.slice(0, 35);
  }
  return cells;
}

export function navigateCursor(cursor: Date, view: CalendarView, dir: -1 | 1): Date {
  const d = new Date(cursor);
  if (view === "day") {
    d.setDate(d.getDate() + dir);
  } else if (view === "week") {
    d.setDate(d.getDate() + dir * 7);
  } else {
    d.setMonth(d.getMonth() + dir);
  }
  return d;
}

export function rangeLabel(cursor: Date, view: CalendarView, days: Date[]): string {
  if (view === "day") {
    return (
      DOW_LONG[cursor.getDay()] + ", " + MONTH_NAMES[cursor.getMonth()] + " " + cursor.getDate()
    );
  }
  if (view === "week" && days.length >= 2) {
    const a = days[0]!;
    const b = days[days.length - 1]!;
    if (a.getMonth() === b.getMonth()) {
      return MONTH_NAMES[a.getMonth()] + " " + a.getDate() + " – " + b.getDate();
    }
    return (
      MONTH_NAMES[a.getMonth()].slice(0, 3) +
      " " +
      a.getDate() +
      " – " +
      MONTH_NAMES[b.getMonth()].slice(0, 3) +
      " " +
      b.getDate()
    );
  }
  return MONTH_NAMES[cursor.getMonth()] + " " + cursor.getFullYear();
}

export function packDay(evs: CalendarViewEvent[]): CalendarViewEvent[] {
  const items = evs
    .filter((e) => !e.allDay)
    .slice()
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let cluster: CalendarViewEvent[] = [];
  let clusterEnd = -1;

  function flush() {
    if (!cluster.length) return;
    const colsEnd: number[] = [];
    for (const e of cluster) {
      let placed = false;
      for (let i = 0; i < colsEnd.length; i++) {
        if (e.startMin >= colsEnd[i]!) {
          e._col = i;
          colsEnd[i] = e.endMin;
          placed = true;
          break;
        }
      }
      if (!placed) {
        e._col = colsEnd.length;
        colsEnd.push(e.endMin);
      }
    }
    for (const e of cluster) {
      e._cols = colsEnd.length;
    }
    cluster = [];
    clusterEnd = -1;
  }

  for (const e of items) {
    if (cluster.length && e.startMin >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  flush();
  return items;
}

export function loadPersistedView(): CalendarView {
  const v = localStorage.getItem("jarvis.cal.view");
  return v === "week" || v === "month" ? v : "day";
}

export function loadPersistedCursor(): Date {
  const s = localStorage.getItem("jarvis.cal.cursor");
  if (s) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function loadPersistedWorkWeek(): boolean {
  return localStorage.getItem("jarvis.cal.workweek") === "1";
}
```

- [ ] **Step 2: Run typecheck to confirm no errors in the new file**

```bash
pnpm typecheck 2>&1 | grep "calendar-model" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/calendar/calendar-model.ts
git commit -m "$(cat <<'EOF'
feat(calendar): calendar-model.ts — date helpers, DTO→view mapping, packDay

Pure TS module: fmtTime/fmtHour/fmtDur, isToday, nowMin, dtoToViewEvent,
groupEventsByDay, buildWeekDays, buildMonthCells, navigateCursor, rangeLabel,
and verbatim packDay port from design (overlap column packing). Browser-safe.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Create calendar-time-grid.tsx

**Files:**

- Create: `apps/web/src/calendar/calendar-time-grid.tsx`

The Day/Week shared time grid. Contains the inline `EventBlock` component. Accepts `DayData[]` — each day's date + pre-grouped events. Scroll position initialises at 7 AM (the design's scroll-to-7). Today's column gets the `is-today` class + a current-time dot+line rendered at `nowMin()` px from midnight.

**Lucide icons used:** `GitCommitHorizontal` (block hold indicator).

- [ ] **Step 1: Create `apps/web/src/calendar/calendar-time-grid.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { GitCommitHorizontal } from "lucide-react";

import {
  DOW_SHORT,
  fmtHour,
  fmtTime,
  isToday,
  nowMin,
  packDay,
  type CalendarViewEvent
} from "./calendar-model.js";

export interface DayData {
  readonly date: Date;
  readonly events: CalendarViewEvent[];
}

interface EventBlockProps {
  readonly e: CalendarViewEvent;
  readonly hourH: number;
  readonly dense: boolean;
  readonly onPick: (e: CalendarViewEvent) => void;
}

function EventBlock({ e, hourH, dense, onPick }: EventBlockProps) {
  const ppm = hourH / 60;
  const top = e.startMin * ppm;
  const height = Math.max((e.endMin - e.startMin) * ppm, 22);
  const cols = e._cols || 1;
  const col = e._col || 0;
  const w = 100 / cols;
  const left = col * w;
  const isBlock = e.kind === "block";
  const showTime = height >= 34;
  const showWhere = height >= 58 && !dense && e.where;
  const cls = "cal-ev" + (isBlock ? " cal-ev--block cal-ev--ghost" : " cal-ev--hard");

  return (
    <button
      type="button"
      className={cls}
      onClick={() => onPick(e)}
      style={
        {
          top,
          height,
          left: `calc(${left}% + 2px)`,
          width: `calc(${w}% - 4px)`,
          "--ev": isBlock ? "var(--accent)" : "var(--steel)"
        } as React.CSSProperties
      }
    >
      <span className="cal-ev__bar" />
      <span className="cal-ev__body">
        <span className="cal-ev__title">
          {isBlock ? (
            <span className="cal-ev__hold">
              <GitCommitHorizontal size={11} />
            </span>
          ) : null}
          {e.title}
        </span>
        {showTime ? <span className="cal-ev__meta">{fmtTime(e.startMin)}</span> : null}
        {showWhere ? <span className="cal-ev__where">{e.where}</span> : null}
      </span>
    </button>
  );
}

interface TimeGridProps {
  readonly days: DayData[];
  readonly hourH: number;
  readonly onPick: (e: CalendarViewEvent) => void;
}

export function CalendarTimeGrid({ days, hourH, onPick }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * hourH - 6;
    }
  }, [hourH]);

  const tmpl = `60px repeat(${days.length}, minmax(0, 1fr))`;
  const anyAllDay = days.some((d) => d.events.some((e) => e.allDay));
  const todayNowMin = nowMin();

  return (
    <div className="cal-tg" style={{ "--cal-h": hourH + "px" } as React.CSSProperties}>
      <div className="cal-tg__head" style={{ gridTemplateColumns: tmpl }}>
        <div className="cal-tg__corner" />
        {days.map((d) => (
          <div
            key={d.date.toISOString()}
            className={"cal-tg__dayhd" + (isToday(d.date) ? " is-today" : "")}
          >
            <span className="cal-tg__dow">{DOW_SHORT[d.date.getDay()]}</span>
            <span className="cal-tg__dnum">{d.date.getDate()}</span>
          </div>
        ))}
      </div>

      {anyAllDay ? (
        <div className="cal-tg__allday" style={{ gridTemplateColumns: tmpl }}>
          <div className="cal-tg__allday-lbl">all-day</div>
          {days.map((d) => (
            <div key={d.date.toISOString()} className="cal-tg__allday-cell">
              {d.events
                .filter((e) => e.allDay)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="cal-allchip"
                    style={
                      {
                        "--ev": e.kind === "block" ? "var(--accent)" : "var(--steel)"
                      } as React.CSSProperties
                    }
                    onClick={() => onPick(e)}
                  >
                    <span className="cal-allchip__dot" />
                    {e.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className="cal-tg__scroll" ref={scrollRef}>
        <div className="cal-tg__body" style={{ gridTemplateColumns: tmpl, height: 24 * hourH }}>
          <div className="cal-tg__gutter">
            {Array.from({ length: 24 }, (_, h) =>
              h === 0 ? null : (
                <span key={h} className="cal-tg__hr" style={{ top: h * hourH }}>
                  {fmtHour(h)}
                </span>
              )
            )}
          </div>
          {days.map((d) => {
            const packed = packDay([...d.events]);
            const todayCol = isToday(d.date);
            return (
              <div
                key={d.date.toISOString()}
                className={"cal-tg__col" + (todayCol ? " is-today" : "")}
              >
                {packed.map((e) => (
                  <EventBlock
                    key={e.id}
                    e={e}
                    hourH={hourH}
                    dense={days.length > 3}
                    onPick={onPick}
                  />
                ))}
                {todayCol ? (
                  <div className="cal-now" style={{ top: todayNowMin * (hourH / 60) }}>
                    <span className="cal-now__dot" />
                    <span className="cal-now__line" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck 2>&1 | grep "calendar-time-grid" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/calendar/calendar-time-grid.tsx
git commit -m "$(cat <<'EOF'
feat(calendar): calendar-time-grid.tsx — Day/Week time grid with overlap packing

EventBlock renders committed (hard) vs Jarvis-held (ghost/block) treatment.
Columns packed via packDay. Scroll initialises at 7 AM. Now-line rendered
at real current minute on today's column.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Create calendar-month.tsx

**Files:**

- Create: `apps/web/src/calendar/calendar-month.tsx`

The 5/6-week month grid. A trailing all-empty week is trimmed (same as the design). Clicking a date chip drills down to Day view via `onPickDay`. Up to 3 events shown per cell; overflow becomes an N-more button.

- [ ] **Step 1: Create `apps/web/src/calendar/calendar-month.tsx`**

```tsx
import {
  DOW_SHORT,
  MONTH_NAMES,
  buildMonthCells,
  dayKey,
  fmtTime,
  isToday,
  type CalendarViewEvent
} from "./calendar-model.js";

interface CalendarMonthProps {
  readonly cursor: Date;
  readonly eventsByDay: Map<string, CalendarViewEvent[]>;
  readonly onPickDay: (date: Date) => void;
  readonly onPick: (e: CalendarViewEvent) => void;
}

export function CalendarMonth({ cursor, eventsByDay, onPickDay, onPick }: CalendarMonthProps) {
  const cells = buildMonthCells(cursor);
  const curMonth = cursor.getMonth();
  const rowCount = cells.length / 7;

  return (
    <div className="cal-month">
      <div className="cal-month__head">
        {DOW_SHORT.map((d) => (
          <div key={d} className="cal-month__dow">
            {d}
          </div>
        ))}
      </div>
      <div className="cal-month__grid" style={{ gridTemplateRows: `repeat(${rowCount}, 1fr)` }}>
        {cells.map((date) => {
          const out = date.getMonth() !== curMonth;
          const today = isToday(date);
          const key = dayKey(date);
          const evs = (eventsByDay.get(key) ?? [])
            .slice()
            .sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || a.startMin - b.startMin);
          const shown = evs.slice(0, 3);
          const extra = evs.length - 3;

          return (
            <div
              key={key + "-" + date.getDate()}
              className={"cal-mcell" + (out ? " is-out" : "") + (today ? " is-today" : "")}
            >
              <button type="button" className="cal-mcell__date" onClick={() => onPickDay(date)}>
                <span className="n">{date.getDate()}</span>
                {date.getDate() === 1 ? (
                  <span className="mo">{MONTH_NAMES[date.getMonth()].slice(0, 3)}</span>
                ) : null}
              </button>
              <div className="cal-mcell__evs">
                {shown.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={"cal-mchip" + (e.kind === "block" ? " is-block" : "")}
                    style={
                      {
                        "--ev": e.kind === "block" ? "var(--accent)" : "var(--steel)"
                      } as React.CSSProperties
                    }
                    onClick={() => onPick(e)}
                  >
                    <span className="cal-mchip__dot" />
                    {!e.allDay ? (
                      <span className="cal-mchip__t">{fmtTime(e.startMin).replace(":00", "")}</span>
                    ) : null}
                    <span className="cal-mchip__title">{e.title}</span>
                  </button>
                ))}
                {extra > 0 ? (
                  <button type="button" className="cal-mmore" onClick={() => onPickDay(date)}>
                    {extra} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck 2>&1 | grep "calendar-month" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/calendar/calendar-month.tsx
git commit -m "$(cat <<'EOF'
feat(calendar): calendar-month.tsx — 5/6-week month grid

Trailing empty week trimmed. Up to 3 chips per cell with N-more overflow.
Block chips get the dashed is-block treatment. Date click drills to Day view.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Create calendar-peek.tsx

**Files:**

- Create: `apps/web/src/calendar/calendar-peek.tsx`

The right-side flyout detail panel. Committed events show "On your calendar"; Jarvis-held blocks show "Jarvis is holding this" + the held note at the bottom. Attendee count shown as "N people" only when > 0. No attendee names/emails ever shown (only the count from the DTO).

**Lucide icons used:** `CalendarCheck`, `GitCommitHorizontal`, `X`, `Clock`, `MapPin`, `Users`, `Sparkles`.

- [ ] **Step 1: Create `apps/web/src/calendar/calendar-peek.tsx`**

```tsx
import {
  CalendarCheck,
  Clock,
  GitCommitHorizontal,
  MapPin,
  Sparkles,
  Users,
  X
} from "lucide-react";

import { fmtDateLabel, fmtDur, fmtTime, type CalendarViewEvent } from "./calendar-model.js";

interface CalendarPeekProps {
  readonly event: CalendarViewEvent | null;
  readonly onClose: () => void;
}

export function CalendarPeek({ event, onClose }: CalendarPeekProps) {
  if (!event) return null;

  const isBlock = event.kind === "block";
  const evColor = isBlock ? "var(--accent)" : "var(--steel)";

  return (
    <>
      <div className="cal-peek-scrim" onClick={onClose} />
      <aside className="cal-peek" role="dialog" aria-label="Event details">
        <div className="cal-peek__head">
          {isBlock ? (
            <span className="cal-peek__kind cal-peek__kind--block">
              <GitCommitHorizontal size={13} />
              Jarvis is holding this
            </span>
          ) : (
            <span className="cal-peek__kind">
              <CalendarCheck size={13} />
              On your calendar
            </span>
          )}
          <button type="button" className="cal-peek__x" aria-label="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="cal-peek__titlewrap">
          <span className="cal-peek__mark" style={{ "--ev": evColor } as React.CSSProperties}>
            {isBlock ? <GitCommitHorizontal size={18} /> : <CalendarCheck size={18} />}
          </span>
          <h3 className="cal-peek__title">{event.title}</h3>
        </div>

        <div className="cal-peek__rows">
          <div className="cal-peek__row">
            <span className="ic">
              <Clock size={15} />
            </span>
            <div>
              <div className="cal-peek__rowmain">
                {event.allDay ? "All day" : fmtTime(event.startMin) + " – " + fmtTime(event.endMin)}
                {!event.allDay ? (
                  <span className="cal-peek__dur">
                    {" · "}
                    {fmtDur(event.endMin - event.startMin)}
                  </span>
                ) : null}
              </div>
              <div className="cal-peek__rowsub">{fmtDateLabel(event.date)}</div>
            </div>
          </div>

          {event.where ? (
            <div className="cal-peek__row">
              <span className="ic">
                <MapPin size={15} />
              </span>
              <div className="cal-peek__rowmain">{event.where}</div>
            </div>
          ) : null}

          {event.attendeeCount > 0 ? (
            <div className="cal-peek__row">
              <span className="ic">
                <Users size={15} />
              </span>
              <div className="cal-peek__rowmain">
                {event.attendeeCount} {event.attendeeCount === 1 ? "person" : "people"}
              </div>
            </div>
          ) : null}

          <div className="cal-peek__row">
            <span className="ic" style={{ paddingTop: 2 }}>
              <span className="cal-peek__catdot" style={{ background: evColor }} />
            </span>
            <div className="cal-peek__rowmain">{isBlock ? "Jarvis focus block" : "Committed"}</div>
          </div>
        </div>

        {isBlock ? (
          <div className="cal-peek__held">
            <Sparkles size={14} />
            <span>
              Jarvis can move or shorten this block when your day changes. Hard events always come
              first.
            </span>
          </div>
        ) : null}
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck 2>&1 | grep "calendar-peek" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/calendar/calendar-peek.tsx
git commit -m "$(cat <<'EOF'
feat(calendar): calendar-peek.tsx — right-flyout detail peek panel

Committed events: CalendarCheck header. Jarvis blocks: GitCommitHorizontal
header + held note footer. Attendee count shown as "N people" (no PII).
No category colors, no reschedule flags (UI honesty).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Replace calendar-page.tsx; clear old feed CSS

**Files:**

- Modify: `apps/web/src/calendar/calendar-page.tsx`
- Modify: `apps/web/src/calendar/calendar.css`

This is the main orchestration component. It replaces the old flat `CalendarEventRow` feed. State: `view`, `cursor`, `workWeek`, `peek`. All three are persisted to `localStorage` via the model helpers. React Query wires to the existing `listCalendarEvents()` fetch — URL unchanged.

The `calendar.css` old feed classes (`calendar-feed`, `calendar-day`, etc.) are no longer used — clear them to avoid dead CSS. The `kit-calendar.css` (already imported) provides all `cal-*` classes.

- [ ] **Step 1: Replace `apps/web/src/calendar/calendar-page.tsx`**

```tsx
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Inbox, LoaderCircle } from "lucide-react";

import { listCalendarEvents } from "../api/client.js";
import { queryKeys } from "../api/query-keys.js";
import "../styles/kit-calendar.css";

import {
  buildWeekDays,
  dtoToViewEvent,
  groupEventsByDay,
  isToday,
  loadPersistedCursor,
  loadPersistedView,
  loadPersistedWorkWeek,
  navigateCursor,
  rangeLabel,
  DOW_SHORT,
  type CalendarView,
  type CalendarViewEvent
} from "./calendar-model.js";
import { CalendarTimeGrid, type DayData } from "./calendar-time-grid.js";
import { CalendarMonth } from "./calendar-month.js";
import { CalendarPeek } from "./calendar-peek.js";

const HOUR_H = 58; // Comfortable density

export function CalendarPage() {
  const [view, setView] = useState<CalendarView>(loadPersistedView);
  const [cursor, setCursor] = useState<Date>(loadPersistedCursor);
  const [workWeek, setWorkWeek] = useState<boolean>(loadPersistedWorkWeek);
  const [peek, setPeek] = useState<CalendarViewEvent | null>(null);

  useEffect(() => {
    localStorage.setItem("jarvis.cal.view", view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("jarvis.cal.cursor", cursor.toISOString());
  }, [cursor]);
  useEffect(() => {
    localStorage.setItem("jarvis.cal.workweek", workWeek ? "1" : "0");
  }, [workWeek]);

  const calendarQuery = useQuery({
    queryKey: queryKeys.calendar.list,
    queryFn: () => listCalendarEvents()
  });

  const allViewEvents = useMemo(() => {
    return (calendarQuery.data?.events ?? [])
      .map(dtoToViewEvent)
      .filter((e): e is CalendarViewEvent => e !== null);
  }, [calendarQuery.data]);

  const eventsByDay = useMemo(() => groupEventsByDay(allViewEvents), [allViewEvents]);

  const weekDays = useMemo(
    () => (view === "week" ? buildWeekDays(cursor, workWeek) : []),
    [view, cursor, workWeek]
  );

  const dayObjs: DayData[] = useMemo(() => {
    const activeDays = view === "day" ? [cursor] : view === "week" ? weekDays : [];
    return activeDays.map((d) => ({
      date: d,
      events: eventsByDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? []
    }));
  }, [view, cursor, weekDays, eventsByDay]);

  const label = rangeLabel(cursor, view, view === "week" ? weekDays : [cursor]);

  const heldToday = useMemo(() => {
    const todayKey = `${new Date().getFullYear()}-${new Date().getMonth()}-${new Date().getDate()}`;
    return (eventsByDay.get(todayKey) ?? []).filter((e) => e.kind === "block").length;
  }, [eventsByDay]);

  function go(dir: -1 | 1) {
    setCursor((c) => navigateCursor(c, view, dir));
  }

  function pickDay(date: Date) {
    setCursor(date);
    setView("day");
  }

  if (calendarQuery.isLoading) {
    return (
      <div className="empty-state">
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
        <p>Loading calendar</p>
      </div>
    );
  }

  if (calendarQuery.error) {
    return (
      <div className="empty-state">
        <Inbox size={22} aria-hidden="true" />
        <p>{calendarQuery.error.message}</p>
      </div>
    );
  }

  return (
    <div className="cal-wrap" style={{ "--cal-h": HOUR_H + "px" } as React.CSSProperties}>
      {/* toolbar */}
      <div className="cal-toolbar">
        <div className="cal-toolbar__left">
          <button
            type="button"
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={() => setCursor(new Date())}
          >
            Today
          </button>
          <div className="cal-nav">
            <button
              type="button"
              className="jds-iconbtn jds-iconbtn--sm"
              aria-label="Previous"
              onClick={() => go(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="jds-iconbtn jds-iconbtn--sm"
              aria-label="Next"
              onClick={() => go(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <h2 className="cal-range">
            {view === "day" ? (
              <>
                <span className="cal-range__dow">{DOW_SHORT[cursor.getDay()]}</span>
                {label.replace(/^\w+,?\s*/, "")}
              </>
            ) : (
              label
            )}
          </h2>
        </div>
        <div className="cal-toolbar__right">
          {view === "week" ? (
            <div className="segmented-control" aria-label="Week type">
              <button
                type="button"
                className={workWeek ? "active" : ""}
                onClick={() => setWorkWeek(true)}
              >
                Work week
              </button>
              <button
                type="button"
                className={!workWeek ? "active" : ""}
                onClick={() => setWorkWeek(false)}
              >
                Full week
              </button>
            </div>
          ) : null}
          <div className="segmented-control" aria-label="View">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* legend (Day and Week only) */}
      {view !== "month" ? (
        <div className="cal-legend">
          <span className="cal-legend__item">
            <span className="cal-legend__sw cal-legend__sw--hard" />
            Committed
          </span>
          <span className="cal-legend__item">
            <span className="cal-legend__sw cal-legend__sw--hold" />
            Jarvis holding
          </span>
          {view === "day" && isToday(cursor) && heldToday > 0 ? (
            <span className="cal-legend__note">
              Jarvis is holding {heldToday} block{heldToday === 1 ? "" : "s"} around what matters
              today.
            </span>
          ) : null}
        </div>
      ) : null}

      {/* body */}
      <div className="cal-body">
        {view === "month" ? (
          <CalendarMonth
            cursor={cursor}
            eventsByDay={eventsByDay}
            onPickDay={pickDay}
            onPick={setPeek}
          />
        ) : (
          <CalendarTimeGrid days={dayObjs} hourH={HOUR_H} onPick={setPeek} />
        )}
      </div>

      <CalendarPeek event={peek} onClose={() => setPeek(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Clear old feed styles from `apps/web/src/calendar/calendar.css`**

Replace the entire file with a single comment (the old feed classes are now dead code):

```css
/* Calendar page — layout handled by kit-calendar.css (cal-* classes). */
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck 2>&1 | grep "calendar" | grep "error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/calendar/calendar-page.tsx apps/web/src/calendar/calendar.css
git commit -m "$(cat <<'EOF'
feat(calendar): replace flat feed with Day/Week/Month time grid

Calendar page now renders the design's Outlook-style time grid.
View/cursor/work-week persisted to localStorage (jarvis.cal.*).
Wired to existing listCalendarEvents() / queryKeys.calendar.list.
Old feed styles cleared from calendar.css (kit-calendar.css provides cal-* classes).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Full gate verification

**Files:** None new. This task is pure verification.

Run every check the spec's Exit Criteria requires.

- [ ] **Step 1: Pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: All three green. Fix any issues before proceeding.

- [ ] **Step 2: Run the calendar-email integration suite**

```bash
pnpm test:calendar-email 2>&1 | tail -40
```

Expected: All tests pass, including the new serialize/egress describe block (6 new tests).

- [ ] **Step 3: Check file sizes**

```bash
pnpm check:file-size 2>&1 | head -20
```

Expected: no file over 1000 lines. If `calendar-page.tsx` or `kit-calendar.css` is over 1000 lines, split before continuing. `kit-calendar.css` is currently 750 lines — should be fine.

- [ ] **Step 4: Full foundation gate**

```bash
pnpm verify:foundation 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 5: Release hardening audit**

```bash
pnpm audit:release-hardening 2>&1 | tail -20
```

Expected: green (no new findings).

- [ ] **Step 6: Fresh rebase before push**

```bash
git fetch origin main && git rebase origin/main
```

Expected: clean rebase (no conflicts — this branch has no overlap with main since `dccda83`).

---

## Self-Review Against Spec Exit Criteria

| Exit Criterion                                                                                                                  | Covered by                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| CalendarEventDto exposes isJarvisBlock/allDay/attendeeCount/status, no raw externalMetadata                                     | Task 1                                                                                                |
| serialize.ts is single reader; allowlists keys; type-narrows each value; derives isJarvisBlock from exact `/^jfb[0-9a-v]{32}$/` | Task 2                                                                                                |
| routes.ts + tools.ts both import from serialize.ts; tools.ts no longer from routes.ts                                           | Task 2                                                                                                |
| createCachedEventForTest removed from production repo                                                                           | Task 3                                                                                                |
| handleRouteError verified (not blanket-401)                                                                                     | routes.ts updated — `handleRouteError` still used, catch does not map to 401 (verified in route code) |
| All DTO consumers (today-page, chat/seeds, chat-drawer, e2e mocks) updated                                                      | Task 4 (e2e mocks); seeds/today/drawer use CalendarEventDto type only, no field access that breaks    |
| Web calendar: Day/Week/Month time grid, real dates, overlap packing, all-day strip, now-line, peek, legend, nav, persistence    | Tasks 5–9                                                                                             |
| No fabricated category colors / block subtypes / reschedule flags                                                               | calendar-page, time-grid, peek all omit these                                                         |
| RLS/migrations/other modules untouched                                                                                          | No migration added; no other package modified                                                         |
| Egress tests: allowlist, value-narrowing, jfb robustness, false-positive, tools path                                            | Task 3 — 6 new tests                                                                                  |
| Gate green; no file > 1000 lines                                                                                                | Task 10                                                                                               |

**Potential gaps to verify at implementation time:**

- `apps/web/src/today/today-page.tsx`, `apps/web/src/chat/seeds.ts`, `apps/web/src/chat/chat-drawer.tsx` — grep for any direct `.externalMetadata` field access (not just type imports). The pre-spec grep found none, but re-confirm during Task 4's typecheck step.
- `scripts/export-user-data.ts` uses `external_metadata AS "externalMetadata"` in raw SQL — this is the **DB column** in an admin export script, not the DTO. It is NOT broken by this change (it reads the column directly). No action needed.
