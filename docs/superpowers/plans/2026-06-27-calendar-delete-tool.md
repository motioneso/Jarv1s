# Calendar Delete Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `calendar.deleteEvent` — a gateway-confirmed, owner-RLS-scoped tool that deletes a single Google Calendar event and best-effort removes it from the local cache.

**Architecture:** Extend the existing focus-block write seam: `CalendarWriteService` interface (calendar package) + concrete impl (chat package) + `GoogleApiClient.deleteEvent` (connectors package). A new migration grants `jarvis_app_runtime` DELETE on `app.calendar_events` with an owner+connector-scoped RLS policy identical to 0113's worker policy. The tool is `risk: "write"` with `actionFamilyId: "calendar_management"` (locked to `allowedTiers: ["always_confirm"]`), guaranteeing confirmation via two independent belt-and-suspenders paths.

**Tech Stack:** TypeScript, Kysely, Fastify, Vitest (integration tests), PostgreSQL RLS, Google Calendar REST API.

## Global Constraints

- **Never** declare `executionPolicy: "auto"` on `calendar.deleteEvent` — confirm path must be unbypassable.
- `calendar_management` family `allowedTiers: ["always_confirm"]` — no user setting may promote it to auto-run.
- All DB access through `DataContextDb` (owner-RLS-scoped); assert with `assertDataContextDb`.
- Connector credentials (access token) never appear in tool results, logs, job payloads, or AI prompts.
- Google event id comes from the resolved cache row (`row.external_id`) — never directly from model-supplied input.
- Best-effort cache mirror: a cache-delete failure must NEVER rethrow or fail an otherwise-successful external delete.
- Migration XXXX: add to `calendarModuleManifest.database.migrations` AND `foundation.test.ts` list simultaneously. **Before push: rename XXXX → coordinator-confirmed slot (expected 0126) and update both files.**
- Never edit applied migrations. Module SQL lives in `packages/calendar/sql/` only.
- `git add` only task-specific files — never `git add -A`.
- Commit with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` trailer.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/shared/src/calendar-api.ts` | Modify | Add `DeleteCalendarEventResponse` + `deleteCalendarEventResponseSchema` |
| `packages/calendar/src/calendar-write-service.ts` | Modify | Add `DeleteEventInput`, `DeleteEventResult`, `deleteEvent` to interface |
| `packages/calendar/src/repository.ts` | Modify | Add `deleteById` method |
| `packages/connectors/src/google-api-client.ts` | Modify | Add private `deleteVoid` + public `deleteEvent` |
| `packages/calendar/src/tools.ts` | Modify | Add `calendarDeleteEventExecute` + `summarizeDeleteEvent` |
| `packages/calendar/src/manifest.ts` | Modify | Add `assistantActionFamilies`, `calendar.deleteEvent` tool, migration entry |
| `packages/chat/src/calendar-write-impl.ts` | Modify | Implement `deleteEvent` in `buildCalendarWriteService` |
| `packages/calendar/sql/XXXX_app_runtime_calendar_events_delete.sql` | Create | Grant DELETE + owner+connector-scoped RLS policy for jarvis_app_runtime |
| `tests/integration/calendar-delete.test.ts` | Create | All integration tests for the delete tool |
| `tests/integration/foundation.test.ts` | Modify | Add XXXX migration entry to the asserted list |
| `package.json` | Modify | Add `"test:calendar-delete"` script |

---

## Task 1: Foundation types + migration SQL

**Files:**
- Modify: `packages/shared/src/calendar-api.ts`
- Modify: `packages/calendar/src/calendar-write-service.ts`
- Create: `packages/calendar/sql/XXXX_app_runtime_calendar_events_delete.sql`
- Modify: `packages/calendar/src/manifest.ts` (migration entry only)
- Modify: `tests/integration/foundation.test.ts` (migration list entry only)

**Interfaces:**
- Produces: `DeleteCalendarEventResponse`, `deleteCalendarEventResponseSchema` — consumed by manifest (Task 4) and impl (Task 5)
- Produces: `DeleteEventInput`, `DeleteEventResult`, `deleteEvent` on `CalendarWriteService` — consumed by impl (Task 5) and execute (Task 4)
- Produces: migration SQL — consumed by test DB in all subsequent integration test tasks

- [ ] **Step 1.1: Add `deleteCalendarEventResponseSchema` to `packages/shared/src/calendar-api.ts`**

Append after the `getCalendarEventRouteSchema` export:

```ts
export interface DeleteCalendarEventResponse {
  readonly deleted: boolean;
  readonly googleDeleted: "deleted" | "already-gone" | "skipped-no-scope" | "skipped-error";
  readonly cacheMirror: "deleted" | "skipped-rls" | "skipped-error" | "not-cached";
  readonly deletedTitle?: string;
  readonly message?: string;
}

export const deleteCalendarEventResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["deleted", "googleDeleted", "cacheMirror"],
  properties: {
    deleted: { type: "boolean" },
    googleDeleted: {
      type: "string",
      enum: ["deleted", "already-gone", "skipped-no-scope", "skipped-error"]
    },
    cacheMirror: {
      type: "string",
      enum: ["deleted", "skipped-rls", "skipped-error", "not-cached"]
    },
    deletedTitle: { type: "string" },
    message: { type: "string" }
  }
} as const;
```

- [ ] **Step 1.2: Extend `CalendarWriteService` in `packages/calendar/src/calendar-write-service.ts`**

Add after the existing `ProposeFocusResult` interface and before `CalendarWriteService`:

```ts
export interface DeleteEventInput {
  readonly eventId: string; // Jarvis cached event uuid (authoritative)
}

export interface DeleteEventResult {
  readonly deleted: boolean;
  readonly googleDeleted: "deleted" | "already-gone" | "skipped-no-scope" | "skipped-error";
  readonly cacheMirror: "deleted" | "skipped-rls" | "skipped-error" | "not-cached";
  readonly deletedTitle?: string;
  readonly message?: string;
}
```

And add `deleteEvent` to the `CalendarWriteService` interface:

```ts
export interface CalendarWriteService {
  proposeAndInsert(
    scopedDb: unknown,
    ctx: ToolContext,
    window: FocusBlockWindow
  ): Promise<ProposeFocusResult>;
  deleteEvent(
    scopedDb: unknown,
    ctx: ToolContext,
    input: DeleteEventInput
  ): Promise<DeleteEventResult>;
}
```

- [ ] **Step 1.3: Create `packages/calendar/sql/XXXX_app_runtime_calendar_events_delete.sql`**

```sql
-- #557: grant jarvis_app_runtime DELETE on calendar_events for calendar.deleteEvent tool.
-- Owner+connector scoped (identical structure to 0113 worker-runtime delete policy).
-- No BYPASSRLS. FORCE RLS remains enabled.

GRANT DELETE ON app.calendar_events TO jarvis_app_runtime;

DROP POLICY IF EXISTS calendar_events_app_runtime_delete ON app.calendar_events;

CREATE POLICY calendar_events_app_runtime_delete
ON app.calendar_events
FOR DELETE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.connector_accounts accounts
    JOIN app.connector_definitions definitions
      ON definitions.provider_id = accounts.provider_id
    WHERE accounts.id = connector_account_id
      AND accounts.owner_user_id = app.current_actor_user_id()
      AND (
        definitions.provider_type = 'calendar'
        OR (
          definitions.provider_type = 'google'
          AND 'https://www.googleapis.com/auth/calendar' = ANY (accounts.scopes)
        )
      )
  )
);
```

- [ ] **Step 1.4: Add migration entry to `packages/calendar/src/manifest.ts`**

In the `database.migrations` array, append:

```ts
"sql/XXXX_app_runtime_calendar_events_delete.sql"
```

So the full array becomes:
```ts
migrations: [
  "sql/0011_calendar_module.sql",
  "sql/0066_calendar_worker_grants_and_google_insert.sql",
  "sql/0087_calendar_events_update_connector_scope.sql",
  "sql/0113_worker_calendar_events_delete.sql",
  "sql/XXXX_app_runtime_calendar_events_delete.sql"
],
```

- [ ] **Step 1.5: Add migration entry to `tests/integration/foundation.test.ts`**

After `{ version: "0124", name: "0124_scheduled_recurring_briefings.sql" }`, append:

```ts
{ version: "XXXX", name: "XXXX_app_runtime_calendar_events_delete.sql" }
```

- [ ] **Step 1.6: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: exit 0, no errors.

- [ ] **Step 1.7: Commit**

```bash
git add packages/shared/src/calendar-api.ts \
        packages/calendar/src/calendar-write-service.ts \
        packages/calendar/sql/XXXX_app_runtime_calendar_events_delete.sql \
        packages/calendar/src/manifest.ts \
        tests/integration/foundation.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): add deleteEvent types, interface, and RLS migration (#557)

Add DeleteCalendarEventResponse schema (shared), DeleteEventInput/DeleteEventResult
and deleteEvent to CalendarWriteService interface (calendar), and
XXXX_app_runtime_calendar_events_delete.sql granting jarvis_app_runtime a
owner+connector-scoped DELETE policy on app.calendar_events.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: CalendarRepository.deleteById + test scaffold

**Files:**
- Modify: `packages/calendar/src/repository.ts`
- Create: `tests/integration/calendar-delete.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DataContextDb`, `assertDataContextDb` (from `@jarv1s/db`); `CalendarEvent` type
- Produces: `CalendarRepository.deleteById(scopedDb: DataContextDb, eventId: string): Promise<void>` — consumed by Task 5 impl

- [ ] **Step 2.1: Create `tests/integration/calendar-delete.test.ts` with Section A (repository tests)**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DataContextRunner,
  createDatabase,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  ConnectorsRepository,
  createConnectorSecretCipher
} from "@jarv1s/connectors";
import { CalendarRepository } from "@jarv1s/calendar";
import type { Kysely } from "kysely";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

// ─── Section A: CalendarRepository.deleteById ────────────────────────────────

describe("Section A — CalendarRepository.deleteById", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });
  afterAll(async () => {
    await appDb.destroy();
  });

  async function seedGoogleAccount(ownerId: string, scopes: string[]): Promise<string> {
    const cipher = createConnectorSecretCipher();
    const repo = new ConnectorsRepository();
    const account = await dataContext.withDataContext(
      { actorUserId: ownerId, requestId: "seed" },
      (scopedDb) =>
        repo.upsertGoogleAccount(scopedDb, {
          scopes,
          encryptedSecret: cipher.encryptJson({
            kind: "google-oauth",
            clientId: "cid",
            clientSecret: "csecret",
            accessToken: "atoken",
            refreshToken: "rtoken",
            tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
            grantedScopes: scopes
          })
        })
    );
    return account.id;
  }

  it("deleteById removes an existing owned event; getById returns undefined after", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const repo = new CalendarRepository();

    // Insert a cache row as userA
    const inserted = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "insert" },
      (scopedDb) =>
        repo.upsertCachedEvent(scopedDb, {
          connectorAccountId: accountId,
          externalId: "google-evt-A1",
          title: "Team meeting",
          startsAt: new Date("2026-06-28T14:00:00Z"),
          endsAt: new Date("2026-06-28T15:00:00Z")
        })
    );

    // Delete it
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "delete" },
      (scopedDb) => repo.deleteById(scopedDb, inserted.id)
    );

    // Should be gone
    const found = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "check" },
      (scopedDb) => repo.getById(scopedDb, inserted.id)
    );
    expect(found).toBeUndefined();
  });

  it("deleteById is a no-op (does not throw) when the event does not exist", async () => {
    const repo = new CalendarRepository();
    await expect(
      dataContext.withDataContext(
        { actorUserId: ids.userA, requestId: "noop" },
        (scopedDb) => repo.deleteById(scopedDb, "00000000-0000-4000-8000-999999999999")
      )
    ).resolves.toBeUndefined();
  });

  it("RLS: userB cannot delete userA's event (row invisible cross-user)", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const repo = new CalendarRepository();

    const inserted = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "insert" },
      (scopedDb) =>
        repo.upsertCachedEvent(scopedDb, {
          connectorAccountId: accountId,
          externalId: "google-evt-A2",
          title: "Private meeting",
          startsAt: new Date("2026-06-28T16:00:00Z"),
          endsAt: new Date("2026-06-28T17:00:00Z")
        })
    );

    // userB tries to delete userA's event — RLS makes it a no-op (row invisible)
    await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "b-delete" },
      (scopedDb) => repo.deleteById(scopedDb, inserted.id)
    );

    // userA's event is still there
    const found = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "check" },
      (scopedDb) => repo.getById(scopedDb, inserted.id)
    );
    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
  });
});
```

- [ ] **Step 2.2: Add `test:calendar-delete` to `package.json`**

Find the `"test:focus-time"` line in `package.json` and add after it:

```json
"test:calendar-delete": "vitest run tests/integration/calendar-delete.test.ts",
```

- [ ] **Step 2.3: Run the test to verify it FAILS** (deleteById doesn't exist yet)

```bash
pnpm test:calendar-delete 2>&1 | grep -E "FAIL|Error|deleteById|not a function" | head -20
```

Expected: error like `repo.deleteById is not a function` or TypeScript compile error.

- [ ] **Step 2.4: Implement `deleteById` in `packages/calendar/src/repository.ts`**

Add after `deleteStaleCachedEvents`:

```ts
async deleteById(scopedDb: DataContextDb, eventId: string): Promise<void> {
  assertDataContextDb(scopedDb);
  await scopedDb.db
    .deleteFrom("app.calendar_events")
    .where("id", "=", eventId)
    .execute();
}
```

- [ ] **Step 2.5: Run the test to verify it PASSES**

```bash
pnpm test:calendar-delete 2>&1 | tail -15
```

Expected: all Section A tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add packages/calendar/src/repository.ts \
        tests/integration/calendar-delete.test.ts \
        package.json
git commit -m "$(cat <<'EOF'
feat(calendar): add CalendarRepository.deleteById + test scaffold (#557)

Owner-RLS-scoped delete-by-id method on CalendarRepository; Section A integration
tests verify happy path, no-op on unknown id, and cross-user RLS isolation.
Adds test:calendar-delete script to package.json.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: GoogleApiClient.deleteEvent + tests

**Files:**
- Modify: `packages/connectors/src/google-api-client.ts`
- Modify: `tests/integration/calendar-delete.test.ts` (add Section B)

**Interfaces:**
- Produces: `GoogleApiClient.deleteEvent(input: { accessToken: string; calendarId?: string; eventId: string }): Promise<{ deleted: "deleted" | "already-gone" }>` — consumed by Task 5 impl

- [ ] **Step 3.1: Add Section B to `tests/integration/calendar-delete.test.ts`**

Add after the closing `});` of Section A:

```ts
// ─── Section B: GoogleApiClient.deleteEvent ──────────────────────────────────

import { GoogleApiClient, GoogleApiError } from "@jarv1s/connectors";

describe("Section B — GoogleApiClient.deleteEvent", () => {
  function makeClient(
    reply: (url: string, init?: RequestInit) => { status?: number; body?: unknown }
  ) {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      const r = reply(url, init);
      return {
        ok: (r.status ?? 204) < 400,
        status: r.status ?? 204,
        json: async () => r.body ?? {},
        text: async () => JSON.stringify(r.body ?? {})
      } as Response;
    }) as unknown as typeof fetch;
    return { client: new GoogleApiClient({ fetchFn }), calls };
  }

  it("204 No Content → { deleted: 'deleted' }", async () => {
    const { client, calls } = makeClient(() => ({ status: 204 }));
    const result = await client.deleteEvent({
      accessToken: "tok",
      calendarId: "primary",
      eventId: "evt-123"
    });
    expect(result.deleted).toBe("deleted");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toContain("/calendars/primary/events/evt-123");
  });

  it("uses 'primary' as default calendarId when omitted", async () => {
    const { client, calls } = makeClient(() => ({ status: 204 }));
    await client.deleteEvent({ accessToken: "tok", eventId: "evt-xyz" });
    expect(calls[0]?.url).toContain("/calendars/primary/events/evt-xyz");
  });

  it("404 → { deleted: 'already-gone' } (idempotent success)", async () => {
    const { client } = makeClient(() => ({ status: 404, body: { error: "NOT_FOUND" } }));
    const result = await client.deleteEvent({
      accessToken: "tok",
      calendarId: "primary",
      eventId: "evt-gone"
    });
    expect(result.deleted).toBe("already-gone");
  });

  it("410 → { deleted: 'already-gone' } (idempotent success)", async () => {
    const { client } = makeClient(() => ({ status: 410, body: { error: "GONE" } }));
    const result = await client.deleteEvent({
      accessToken: "tok",
      calendarId: "primary",
      eventId: "evt-410"
    });
    expect(result.deleted).toBe("already-gone");
  });

  it("403 → throws GoogleApiError with statusCode 403", async () => {
    const { client } = makeClient(() => ({
      status: 403,
      body: { error: { message: "SECRET_BODY" } }
    }));
    await expect(
      client.deleteEvent({ accessToken: "tok", calendarId: "primary", eventId: "evt-403" })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("403 error message does NOT contain the response body", async () => {
    const { client } = makeClient(() => ({
      status: 403,
      body: { error: { message: "SECRET_BODY" } }
    }));
    try {
      await client.deleteEvent({ accessToken: "tok", calendarId: "primary", eventId: "evt-403" });
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleApiError);
      expect((err as Error).message).not.toContain("SECRET_BODY");
    }
  });

  it("500 → throws GoogleApiError with statusCode 500", async () => {
    const { client } = makeClient(() => ({
      status: 500,
      body: { error: "internal" }
    }));
    await expect(
      client.deleteEvent({ accessToken: "tok", calendarId: "primary", eventId: "evt-500" })
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});
```

- [ ] **Step 3.2: Run the test to verify Section B FAILS**

```bash
pnpm test:calendar-delete 2>&1 | grep -E "FAIL|deleteEvent|not a function" | head -10
```

Expected: `client.deleteEvent is not a function` or similar.

- [ ] **Step 3.3: Implement `deleteEvent` in `packages/connectors/src/google-api-client.ts`**

Add a private `deleteVoid` method and public `deleteEvent` method. Insert after the `insertEvent` method, before the private `getJson` method:

```ts
async deleteEvent(input: {
  accessToken: string;
  calendarId?: string;
  eventId: string;
}): Promise<{ deleted: "deleted" | "already-gone" }> {
  const calendarId = input.calendarId ?? "primary";
  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}`;
  try {
    await this.deleteVoid(url, input.accessToken, "calendar");
    return { deleted: "deleted" };
  } catch (error) {
    if (
      error instanceof GoogleApiError &&
      (error.statusCode === 404 || error.statusCode === 410)
    ) {
      return { deleted: "already-gone" };
    }
    throw error;
  }
}

private async deleteVoid(url: string, accessToken: string, api: string): Promise<void> {
  const response = await this.fetchFn(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (response.ok) return;
  // Log status only; NEVER embed the response body in Error.message —
  // handleRouteError propagates Error.message to HTTP responses.
  this.logger.error({ statusCode: response.status, api }, "Google API call failed");
  throw new GoogleApiError(`Google ${api} returned ${response.status}`, response.status);
}
```

- [ ] **Step 3.4: Run the test to verify Section B PASSES**

```bash
pnpm test:calendar-delete 2>&1 | tail -15
```

Expected: all Section A + B tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add packages/connectors/src/google-api-client.ts \
        tests/integration/calendar-delete.test.ts
git commit -m "$(cat <<'EOF'
feat(connectors): add GoogleApiClient.deleteEvent with idempotent 404/410 handling (#557)

Adds private deleteVoid helper (DELETE, no response body, no body leak in Error.message)
and public deleteEvent returning 'deleted' or 'already-gone'. Section B integration tests
cover all HTTP status paths.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Tool execute + summarize + manifest + gateway tests

**Files:**
- Modify: `packages/calendar/src/tools.ts`
- Modify: `packages/calendar/src/manifest.ts`
- Modify: `tests/integration/calendar-delete.test.ts` (add Section C)

**Interfaces:**
- Consumes: `deleteCalendarEventResponseSchema` from `@jarv1s/shared`
- Consumes: `CalendarWriteService.deleteEvent` (Task 1 interface)
- Produces: `calendarDeleteEventExecute: ToolExecute`, `summarizeDeleteEvent: ToolSummarize`
- Produces: `calendar.deleteEvent` in manifest + `calendar_management` action family

- [ ] **Step 4.1: Add Section C to `tests/integration/calendar-delete.test.ts`**

Add after Section B (before the last `}`):

```ts
// ─── Section C: manifest structure + gateway routing ─────────────────────────

import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  type GatewaySessionRecord,
  type GatewayToolResponse,
  type SessionNotifier
} from "@jarv1s/ai";
import { calendarModuleManifest } from "@jarv1s/calendar";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

describe("Section C — manifest structure + gateway routing", () => {
  it("calendar.deleteEvent is registered with correct risk/family/services/no-auto", () => {
    const tool = calendarModuleManifest.assistantTools?.find(
      (t) => t.name === "calendar.deleteEvent"
    );
    expect(tool).toBeDefined();
    expect(tool!.risk).toBe("write");
    expect(tool!.actionFamilyId).toBe("calendar_management");
    expect(tool!.requiresServices).toEqual(["calendarWrite"]);
    expect(tool!.executionPolicy).toBeUndefined(); // must NOT be "auto"
    expect(tool!.permissionId).toBe("calendar.manage");
    expect(typeof tool!.execute).toBe("function");
    expect(typeof tool!.summarize).toBe("function");
  });

  it("calendar_management family is locked to allowedTiers: ['always_confirm']", () => {
    const family = calendarModuleManifest.assistantActionFamilies?.find(
      (f) => f.id === "calendar_management"
    );
    expect(family).toBeDefined();
    expect(family!.defaultTier).toBe("always_confirm");
    expect(family!.allowedTiers).toEqual(["always_confirm"]);
  });

  it("summarizeDeleteEvent with displayTitle + displayWhen renders full card text", () => {
    const tool = calendarModuleManifest.assistantTools!.find(
      (t) => t.name === "calendar.deleteEvent"
    )!;
    const text = tool.summarize!(
      { eventId: "uuid-1", displayTitle: "Board sync", displayWhen: "Fri Jun 28, 14:00–15:00" },
      { actorUserId: "u", requestId: "r", chatSessionId: "s" }
    );
    expect(text).toContain("Board sync");
    expect(text).toContain("Fri Jun 28, 14:00–15:00");
    expect(text).toMatch(/attendees.*notified|notified.*attendees/i);
    expect(text).toMatch(/can't be undone/i);
  });

  it("summarizeDeleteEvent with only displayTitle renders partial card", () => {
    const tool = calendarModuleManifest.assistantTools!.find(
      (t) => t.name === "calendar.deleteEvent"
    )!;
    const text = tool.summarize!(
      { eventId: "uuid-1", displayTitle: "Team standup" },
      { actorUserId: "u", requestId: "r", chatSessionId: "s" }
    );
    expect(text).toContain("Team standup");
    expect(text).toMatch(/can't be undone/i);
  });

  it("summarizeDeleteEvent with no display fields renders generic fallback", () => {
    const tool = calendarModuleManifest.assistantTools!.find(
      (t) => t.name === "calendar.deleteEvent"
    )!;
    const text = tool.summarize!(
      { eventId: "uuid-1" },
      { actorUserId: "u", requestId: "r", chatSessionId: "s" }
    );
    expect(text).toMatch(/delete this calendar event/i);
    expect(text).toMatch(/can't be undone/i);
  });

  // Gateway routing tests (need a real DB)
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });
  afterAll(async () => {
    await appDb.destroy();
  });

  function buildGateway(modules: JarvisModuleManifest[], services: Record<string, unknown>) {
    const tokens = new SessionTokenRegistry();
    const emitted: GatewaySessionRecord[] = [];
    const notifier: SessionNotifier = {
      emit(_sessionId, record) {
        emitted.push(record);
      }
    };
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => modules,
      repository: new AiRepository(),
      runner: dataContext,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier,
      confirmTimeoutMs: 5_000,
      toolServices: services
    });
    return { gateway, tokens, emitted };
  }

  async function waitForCard(
    emitted: GatewaySessionRecord[],
    toolName: string,
    timeoutMs = 2_000
  ): Promise<Extract<GatewaySessionRecord, { kind: "action_request" }>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const card = emitted.find(
        (r): r is Extract<GatewaySessionRecord, { kind: "action_request" }> =>
          r.kind === "action_request" && r.toolName === toolName
      );
      if (card) return card;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timeout: no action_request card for ${toolName}`);
  }

  it("callTool always emits an action_request card (never auto-runs)", async () => {
    const fakeDelete = {
      async proposeAndInsert() {
        throw new Error("should not be called");
      },
      async deleteEvent() {
        return {
          deleted: true,
          googleDeleted: "deleted" as const,
          cacheMirror: "deleted" as const,
          deletedTitle: "Board sync"
        };
      }
    };
    const { gateway, tokens, emitted } = buildGateway([calendarModuleManifest], {
      calendarWrite: fakeDelete
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });

    const callP = gateway.callTool(token, "calendar.deleteEvent", {
      eventId: "some-uuid",
      displayTitle: "Board sync"
    });

    const card = await waitForCard(emitted, "calendar.deleteEvent");
    expect(card.kind).toBe("action_request");
    // Deny so callP resolves (avoids test hang)
    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "denied");
    await callP;
  });

  it("gateway falls to confirm even if a trusted_auto tier is stored and executionPolicy=auto is set on a hypothetical tool variant", async () => {
    // This test proves the allowedTiers lock: even if we construct a tool that has
    // executionPolicy: "auto" and the stored tier is "trusted_auto", the
    // calendar_management family's allowedTiers:["always_confirm"] still falls closed.
    const autoVariant: JarvisModuleManifest = {
      ...calendarModuleManifest,
      assistantActionFamilies: [
        {
          id: "calendar_management",
          label: "Delete calendar events",
          description: "test",
          defaultTier: "always_confirm",
          allowedTiers: ["always_confirm"] // locked — no trusted_auto
        }
      ],
      assistantTools: [
        {
          ...calendarModuleManifest.assistantTools!.find((t) => t.name === "calendar.deleteEvent")!,
          executionPolicy: "auto" // hypothetical mistake — should still confirm
        }
      ]
    };

    let executed = false;
    const fakeDelete = {
      async proposeAndInsert() {
        throw new Error("not called");
      },
      async deleteEvent() {
        executed = true;
        return {
          deleted: true,
          googleDeleted: "deleted" as const,
          cacheMirror: "deleted" as const
        };
      }
    };

    const { gateway, tokens, emitted } = buildGateway([autoVariant], {
      calendarWrite: fakeDelete
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });

    const callP = gateway.callTool(token, "calendar.deleteEvent", { eventId: "u" });
    const card = await waitForCard(emitted, "calendar.deleteEvent");
    // The tool did NOT auto-run (no execute call before confirm card)
    expect(executed).toBe(false);
    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "denied");
    await callP;
  });
});
```

- [ ] **Step 4.2: Run Section C tests to verify they FAIL** (tool not in manifest yet)

```bash
pnpm test:calendar-delete 2>&1 | grep -E "FAIL|calendar.deleteEvent|undefined" | head -10
```

Expected: assertions fail because `calendar.deleteEvent` is not yet in the manifest.

- [ ] **Step 4.3: Add `calendarDeleteEventExecute` and `summarizeDeleteEvent` to `packages/calendar/src/tools.ts`**

First, in `narrowCalendarWrite`, add a check for `deleteEvent` alongside the existing one:

```ts
function narrowCalendarWrite(services: ToolServices | undefined): CalendarWriteService {
  const svc = (services ?? {}).calendarWrite as CalendarWriteService | undefined;
  if (!svc || typeof svc.proposeAndInsert !== "function") {
    throw new Error("calendarWrite service is not available");
  }
  return svc;
}
```

(No change needed — keeping `proposeAndInsert` check is sufficient since both methods are on the same service object and TypeScript enforces the full type.)

Add the following after `summarizeProposeFocusBlock`:

```ts
export const calendarDeleteEventExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx,
  services
): Promise<ToolResult> => {
  const service = narrowCalendarWrite(services);
  const eventId = typeof input.eventId === "string" ? input.eventId : undefined;
  if (!eventId) {
    return {
      data: {
        deleted: false,
        googleDeleted: "skipped-error",
        cacheMirror: "not-cached",
        message: "eventId is required"
      }
    };
  }
  const result = await service.deleteEvent(scopedDb, ctx, { eventId });
  return { data: { ...result } };
};

export function summarizeDeleteEvent(
  input: Record<string, unknown>,
  _ctx: ToolContext
): string {
  const title = typeof input.displayTitle === "string" ? input.displayTitle : undefined;
  const when = typeof input.displayWhen === "string" ? input.displayWhen : undefined;
  if (title && when) {
    return (
      `Delete **"${title}"** (${when}) from your calendar? ` +
      `Attendees will be notified of the cancellation. This can't be undone from Jarvis.`
    );
  }
  if (title) {
    return (
      `Delete **"${title}"** from your calendar? ` +
      `Attendees will be notified of the cancellation. This can't be undone from Jarvis.`
    );
  }
  return (
    `Delete this calendar event? ` +
    `Attendees will be notified of the cancellation. This can't be undone from Jarvis.`
  );
}
```

- [ ] **Step 4.4: Update `packages/calendar/src/manifest.ts` to add the tool + action family**

Add imports at the top:

```ts
import {
  calendarListVisibleEventsExecute,
  calendarProposeFocusBlockExecute,
  summarizeProposeFocusBlock,
  calendarDeleteEventExecute,
  summarizeDeleteEvent
} from "./tools.js";
```

And add to the shared import from `@jarv1s/shared`:

```ts
import {
  getCalendarBriefingSettingsResponseSchema,
  getCalendarEventResponseSchema,
  listCalendarEventsResponseSchema,
  updateCalendarBriefingSettingsRequestSchema,
  deleteCalendarEventResponseSchema
} from "@jarv1s/shared";
```

Add `assistantActionFamilies` right before `assistantTools`:

```ts
assistantActionFamilies: [
  {
    id: "calendar_management",
    label: "Delete calendar events",
    description: "Let Jarvis delete events from your calendar. Always asks first.",
    defaultTier: "always_confirm",
    allowedTiers: ["always_confirm"]
  }
],
```

Add `calendar.deleteEvent` as the second entry in `assistantTools` (after `proposeFocusBlock`):

```ts
{
  name: "calendar.deleteEvent",
  description:
    "Delete a single calendar event the user owns. Always asks for confirmation; on approval " +
    "the event is removed from the user's Google Calendar (attendees are notified of the " +
    "cancellation). One event at a time; cannot delete recurring series.",
  permissionId: "calendar.manage",
  risk: "write",
  actionFamilyId: "calendar_management",
  // No executionPolicy: "auto" → gateway always confirms (belt 1). allowedTiers lock is belt 2.
  requiresServices: ["calendarWrite"],
  inputSchema: {
    type: "object",
    required: ["eventId"],
    properties: {
      eventId: {
        type: "string",
        description: "Jarvis calendar event id (uuid) from listVisibleEvents"
      },
      displayTitle: {
        type: "string",
        description: "Card preview only; the eventId is authoritative"
      },
      displayWhen: {
        type: "string",
        description: "Card preview only, e.g. 'Fri Jun 28, 14:00–15:00'"
      }
    }
  },
  outputSchema: deleteCalendarEventResponseSchema,
  execute: calendarDeleteEventExecute,
  summarize: summarizeDeleteEvent
},
```

- [ ] **Step 4.5: Run Section C tests to verify they PASS**

```bash
pnpm test:calendar-delete 2>&1 | tail -15
```

Expected: all Section A + B + C tests pass.

- [ ] **Step 4.6: Verify typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 4.7: Commit**

```bash
git add packages/calendar/src/tools.ts \
        packages/calendar/src/manifest.ts \
        tests/integration/calendar-delete.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): add calendar.deleteEvent tool execute/summarize + manifest (#557)

Adds calendarDeleteEventExecute and summarizeDeleteEvent to tools.ts; registers
calendar.deleteEvent in the manifest with risk:write, actionFamilyId:calendar_management,
requiresServices:[calendarWrite]. Adds calendar_management action family locked to
allowedTiers:["always_confirm"]. Section C tests verify manifest structure, summarize
output, and that gateway always emits an action_request card (including with a
hypothetical executionPolicy:auto — the allowedTiers lock still falls to confirm).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CalendarWriteService.deleteEvent impl + integration tests

**Files:**
- Modify: `packages/chat/src/calendar-write-impl.ts`
- Modify: `tests/integration/calendar-delete.test.ts` (add Section D)

**Interfaces:**
- Consumes: `CalendarRepository.deleteById` (Task 2), `GoogleApiClient.deleteEvent` (Task 3), `DeleteEventResult` (Task 1)
- Consumes: `ConnectorsRepository.getCalendarWriteScopeState`, `GoogleConnectionService.getFreshAccessToken` (existing)

- [ ] **Step 5.1: Add Section D to `tests/integration/calendar-delete.test.ts`**

Add all necessary imports at the top of the file (merge with existing imports):

```ts
import {
  buildCalendarWriteService,
  type CalendarWriteImplDeps
} from "@jarv1s/chat";
import {
  GoogleConnectionService,
  GoogleOAuthClient,
  GoogleApiError
} from "@jarv1s/connectors";
```

Add Section D after Section C:

```ts
// ─── Section D: buildCalendarWriteService.deleteEvent (faked Google fetch) ───

describe("Section D — buildCalendarWriteService.deleteEvent", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;

  beforeAll(async () => {
    process.env.JARVIS_CONNECTOR_SECRET_KEY = "test-connector-secret-key";
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });
  afterAll(async () => {
    await appDb.destroy();
  });

  async function seedGoogleAccount(ownerId: string, scopes: string[]): Promise<string> {
    const cipher = createConnectorSecretCipher();
    const repo = new ConnectorsRepository();
    const account = await dataContext.withDataContext(
      { actorUserId: ownerId, requestId: "seed" },
      (scopedDb) =>
        repo.upsertGoogleAccount(scopedDb, {
          scopes,
          encryptedSecret: cipher.encryptJson({
            kind: "google-oauth",
            clientId: "cid",
            clientSecret: "csecret",
            accessToken: "atoken",
            refreshToken: "rtoken",
            tokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
            grantedScopes: scopes
          })
        })
    );
    return account.id;
  }

  async function insertCacheRow(
    ownerId: string,
    accountId: string,
    externalId: string,
    title: string
  ): Promise<string> {
    const repo = new CalendarRepository();
    const row = await dataContext.withDataContext(
      { actorUserId: ownerId, requestId: "insert" },
      (scopedDb) =>
        repo.upsertCachedEvent(scopedDb, {
          connectorAccountId: accountId,
          externalId,
          title,
          startsAt: new Date("2026-06-28T14:00:00Z"),
          endsAt: new Date("2026-06-28T15:00:00Z")
        })
    );
    return row.id;
  }

  // Build a CalendarWriteService with a fake fetch that responds to DELETE calls.
  function buildImpl(opts: {
    deleteStatus?: number;
    /** Override the calendar repository for RLS classification tests. */
    calendarRepository?: CalendarRepository;
  }) {
    const deleteCalls: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleteCalls.push(url);
        const status = opts.deleteStatus ?? 204;
        return {
          ok: status < 400,
          status,
          json: async () => ({}),
          text: async () => "{}"
        } as Response;
      }
      // OAuth refresh: return a valid token response
      if (url.includes("oauth2") || url.includes("token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "fresh-tok",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "https://www.googleapis.com/auth/calendar"
          }),
          text: async () => ""
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" } as Response;
    }) as unknown as typeof fetch;

    const cipher = createConnectorSecretCipher();
    const connectorsRepo = new ConnectorsRepository();
    const impl = buildCalendarWriteService({
      googleService: new GoogleConnectionService({
        repository: connectorsRepo,
        cipher,
        oauthClient: new GoogleOAuthClient({ fetchFn })
      }),
      googleApiClient: new GoogleApiClient({ fetchFn }),
      connectorsRepository: connectorsRepo,
      calendarRepository: opts.calendarRepository ?? new CalendarRepository()
    });
    return { impl, deleteCalls };
  }

  const ctx = { actorUserId: ids.userA, requestId: "t", chatSessionId: "s" };

  it("unknown eventId → deleted:false, skipped-error, not-cached, no Google call", async () => {
    const { impl, deleteCalls } = buildImpl({});
    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId: "00000000-0000-4000-8000-999999999999" })
    );
    expect(res.deleted).toBe(false);
    expect(res.googleDeleted).toBe("skipped-error");
    expect(res.cacheMirror).toBe("not-cached");
    expect(res.message).toMatch(/already gone|may already be gone/i);
    expect(deleteCalls).toHaveLength(0);
  });

  it("missing calendar-write scope → deleted:false, skipped-no-scope, reconnect message, no Google call", async () => {
    await seedGoogleAccount(ids.userB, ["https://www.googleapis.com/auth/gmail.modify"]);
    const { impl, deleteCalls } = buildImpl({});
    const res = await dataContext.withDataContext({ actorUserId: ids.userB, requestId: "t" }, (db) =>
      impl.deleteEvent(db, { ...ctx, actorUserId: ids.userB }, { eventId: "any-uuid" })
    );
    expect(res.deleted).toBe(false);
    expect(res.googleDeleted).toBe("skipped-no-scope");
    expect(res.message).toMatch(/reconnect/i);
    expect(deleteCalls).toHaveLength(0);
  });

  it("happy path: 204 + cache delete succeeds → deleted:true, 'deleted'/'deleted', deletedTitle", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const eventId = await insertCacheRow(ids.userA, accountId, "google-evt-D1", "Board sync");
    const { impl } = buildImpl({ deleteStatus: 204 });

    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId })
    );
    expect(res.deleted).toBe(true);
    expect(res.googleDeleted).toBe("deleted");
    expect(res.cacheMirror).toBe("deleted");
    expect(res.deletedTitle).toBe("Board sync");

    // Cache row should be gone
    const calRepo = new CalendarRepository();
    const found = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "check" },
      (db) => calRepo.getById(db, eventId)
    );
    expect(found).toBeUndefined();
  });

  it("Google 404 → deleted:true, googleDeleted:'already-gone', cache row removed", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const eventId = await insertCacheRow(ids.userA, accountId, "google-evt-D2", "Team standup");
    const { impl } = buildImpl({ deleteStatus: 404 });

    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId })
    );
    expect(res.deleted).toBe(true);
    expect(res.googleDeleted).toBe("already-gone");
    expect(res.cacheMirror).toBe("deleted");
  });

  it("Google 410 → deleted:true, googleDeleted:'already-gone', cache row removed", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const eventId = await insertCacheRow(ids.userA, accountId, "google-evt-D3", "Retro");
    const { impl } = buildImpl({ deleteStatus: 410 });

    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId })
    );
    expect(res.deleted).toBe(true);
    expect(res.googleDeleted).toBe("already-gone");
  });

  it("Google 403 → deleted:false, no-permission message, cache row untouched", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const eventId = await insertCacheRow(ids.userA, accountId, "google-evt-D4", "Read-only event");
    const { impl } = buildImpl({ deleteStatus: 403 });

    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId })
    );
    expect(res.deleted).toBe(false);
    expect(res.googleDeleted).toBe("skipped-error");
    expect(res.message).toMatch(/permission/i);

    // Cache row still present
    const calRepo = new CalendarRepository();
    const found = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "check" },
      (db) => calRepo.getById(db, eventId)
    );
    expect(found).toBeDefined();
  });

  it("Google 500 → deleted:false, try-again message", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const eventId = await insertCacheRow(ids.userA, accountId, "google-evt-D5", "Planning");
    const { impl } = buildImpl({ deleteStatus: 500 });

    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId })
    );
    expect(res.deleted).toBe(false);
    expect(res.message).toMatch(/try again/i);
  });

  it("cache delete 42501 → cacheMirror:'skipped-rls', deleted:true (never rethrows)", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const eventId = await insertCacheRow(ids.userA, accountId, "google-evt-D6", "Sync");

    class RlsRejectingDelete extends CalendarRepository {
      override async deleteById(): Promise<void> {
        const err = new Error(
          'new row violates row-level security policy for table "calendar_events"'
        ) as Error & { code?: string };
        err.code = "42501";
        throw err;
      }
    }

    const { impl } = buildImpl({ deleteStatus: 204, calendarRepository: new RlsRejectingDelete() });
    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId })
    );
    expect(res.deleted).toBe(true); // Google delete succeeded; cache miss is non-fatal
    expect(res.cacheMirror).toBe("skipped-rls");
  });

  it("cache delete generic error → cacheMirror:'skipped-error', deleted:true (never rethrows)", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const eventId = await insertCacheRow(ids.userA, accountId, "google-evt-D7", "All-hands");

    class GenericRejectingDelete extends CalendarRepository {
      override async deleteById(): Promise<void> {
        const err = new Error("deadlock detected") as Error & { code?: string };
        err.code = "40P01";
        throw err;
      }
    }

    const { impl } = buildImpl({
      deleteStatus: 204,
      calendarRepository: new GenericRejectingDelete()
    });
    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId })
    );
    expect(res.deleted).toBe(true);
    expect(res.cacheMirror).toBe("skipped-error");
  });

  it("result does NOT contain access token or connector secret", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const eventId = await insertCacheRow(ids.userA, accountId, "google-evt-D8", "Meeting");
    const { impl } = buildImpl({ deleteStatus: 204 });

    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId })
    );
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("atoken");
    expect(serialized).not.toContain("fresh-tok");
    expect(serialized).not.toContain("csecret");
    expect(serialized).not.toContain("rtoken");
  });

  it("RLS isolation: userA cannot deleteEvent for an event owned by userB", async () => {
    const accountIdB = await seedGoogleAccount(ids.userB, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const repo = new CalendarRepository();
    const row = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "insert" },
      (db) =>
        repo.upsertCachedEvent(db, {
          connectorAccountId: accountIdB,
          externalId: "google-evt-D9",
          title: "B private",
          startsAt: new Date("2026-06-28T14:00:00Z"),
          endsAt: new Date("2026-06-28T15:00:00Z")
        })
    );
    const accountIdA = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const { impl, deleteCalls } = buildImpl({ deleteStatus: 204 });

    const res = await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "t" }, (db) =>
      impl.deleteEvent(db, ctx, { eventId: row.id })
    );
    // getById returns undefined cross-user → "already gone" result, no Google call
    expect(res.deleted).toBe(false);
    expect(deleteCalls).toHaveLength(0);

    // userB's event is still there
    const found = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "check" },
      (db) => repo.getById(db, row.id)
    );
    expect(found).toBeDefined();
  });
});
```

- [ ] **Step 5.2: Run Section D tests to verify they FAIL** (deleteEvent not implemented)

```bash
pnpm test:calendar-delete 2>&1 | grep -E "FAIL|deleteEvent|not a function" | head -10
```

Expected: `impl.deleteEvent is not a function` or TypeScript error.

- [ ] **Step 5.3: Implement `deleteEvent` in `packages/chat/src/calendar-write-impl.ts`**

Add the following imports (merge with existing):
```ts
import {
  chooseSlot,
  focusBlockEventId,
  type CalendarWriteService,
  type FocusBlockWindow,
  type ProposeFocusResult,
  type ResolvedWindow,
  type CalendarRepository,
  type DeleteEventInput,
  type DeleteEventResult
} from "@jarv1s/calendar";
```

Add a private `deleteCachedEvent` helper function (after `mirrorEvent`):

```ts
async function deleteCachedEvent(
  deps: CalendarWriteImplDeps,
  scopedDb: DataContextDb,
  eventId: string
): Promise<"deleted" | "skipped-rls" | "skipped-error"> {
  try {
    await deps.calendarRepository.deleteById(scopedDb, eventId);
    return "deleted";
  } catch (error) {
    // Classify on stable SQLSTATE first (42501 = insufficient_privilege / RLS violation);
    // message text is locale/version-dependent, so only fall back to it.
    const code = (error as { code?: string } | null)?.code;
    if (code === "42501") return "skipped-rls";
    const message = error instanceof Error ? error.message : "";
    return /row-level security|violates row-level|policy/i.test(message)
      ? "skipped-rls"
      : "skipped-error";
  }
}
```

Add `deleteEvent` to the returned object inside `buildCalendarWriteService` (after `proposeAndInsert`):

```ts
async deleteEvent(
  scopedDbRaw: unknown,
  ctx: ToolContext,
  input: DeleteEventInput
): Promise<DeleteEventResult> {
  assertDataContextDb(scopedDbRaw);
  const scopedDb = scopedDbRaw as DataContextDb;

  // 1. Resolve the cached row (owner-RLS-scoped; cross-user row is invisible → undefined).
  const row = await deps.calendarRepository.getById(scopedDb, input.eventId);
  if (!row) {
    return {
      deleted: false,
      googleDeleted: "skipped-error",
      cacheMirror: "not-cached",
      message: "That event isn't in your calendar — it may already be gone."
    };
  }

  // 2. Scope gate — no Google call without calendar-write scope.
  const calendarScope = await deps.connectorsRepository.getCalendarWriteScopeState(scopedDb);
  if (!calendarScope?.hasScope) {
    return {
      deleted: false,
      googleDeleted: "skipped-no-scope",
      cacheMirror: "not-cached",
      message:
        "Your Google connection doesn't have calendar-write permission yet — reconnect in Settings to grant it."
    };
  }

  // 3. Fresh access token.
  let accessToken: string;
  try {
    accessToken = await deps.googleService.getFreshAccessToken(scopedDb);
  } catch (error) {
    const message =
      error instanceof GoogleConnectError
        ? "Connect Google in Settings first."
        : "Couldn't refresh your Google access — reconnect in Settings.";
    return {
      deleted: false,
      googleDeleted: "skipped-error",
      cacheMirror: "not-cached",
      message
    };
  }

  // 4. Calendar id: use the row's recorded calendarId, fall back to "primary" (V1 default).
  const calendarId =
    (row.external_metadata as Record<string, unknown> | null)?.calendarId as
      | string
      | undefined ?? "primary";

  // 5. Delete at Google.
  let googleDeleted: "deleted" | "already-gone";
  try {
    const result = await deps.googleApiClient.deleteEvent({
      accessToken,
      calendarId,
      eventId: row.external_id
    });
    googleDeleted = result.deleted;
  } catch (error) {
    if (error instanceof GoogleApiError && error.statusCode === 403) {
      return {
        deleted: false,
        googleDeleted: "skipped-error",
        cacheMirror: "not-cached",
        message: "You don't have permission to delete events on that calendar."
      };
    }
    return {
      deleted: false,
      googleDeleted: "skipped-error",
      cacheMirror: "not-cached",
      message: "Couldn't delete the event — try again."
    };
  }

  // 6. Best-effort cache mirror. NEVER rethrow — a cache miss must not fail a
  // successful external delete. Google is the source of truth; next sync reconciles.
  const cacheMirror = await deleteCachedEvent(deps, scopedDb, input.eventId);

  return {
    deleted: true,
    googleDeleted,
    cacheMirror,
    deletedTitle: row.title
  };
},
```

- [ ] **Step 5.4: Run all calendar-delete tests to verify they PASS**

```bash
pnpm test:calendar-delete 2>&1 | tail -20
```

Expected: all Section A + B + C + D tests pass.

- [ ] **Step 5.5: Run the full verification gate**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all exit 0.

- [ ] **Step 5.6: Run the spec's targeted test suites**

```bash
pnpm test:calendar-email 2>&1 | tail -5
pnpm test:connectors 2>&1 | tail -5
pnpm test:ai 2>&1 | tail -5
pnpm test:ai-tools 2>&1 | tail -5
pnpm test:focus-time 2>&1 | tail -5
```

Expected: all pass (no regressions in existing suites).

- [ ] **Step 5.7: Commit**

```bash
git add packages/chat/src/calendar-write-impl.ts \
        tests/integration/calendar-delete.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): implement CalendarWriteService.deleteEvent + full integration tests (#557)

Implements deleteEvent in buildCalendarWriteService: resolve cached row (owner-RLS),
scope gate, fresh token, Google DELETE (idempotent 404/410), best-effort cache mirror
with RLS classification (42501→skipped-rls, other→skipped-error, never rethrows).
Returns deletedTitle from the actual DB row, not model-supplied display fields.

Section D integration tests cover: unknown eventId, missing scope, happy path (204),
Google 404/410, 403, 500, cache-delete RLS failure, generic cache failure, credential
leak assertion, and cross-user RLS isolation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Pre-push checklist (run before `coordinated-wrap-up`)

- [ ] **Rebase on origin/main**

```bash
git fetch origin main && git rebase origin/main
```

- [ ] **Confirm migration slot with coordinator before push**

The migration file is named `XXXX_app_runtime_calendar_events_delete.sql` and both `manifest.ts` and `foundation.test.ts` reference version `"XXXX"`. **Escalate to coordinator** (`herdr-pane-message`) with: "Need migration slot for #557 (expected 0126 per handoff). Confirm before push so I can rename XXXX → actual slot."

Once confirmed (assume `0126`):
```bash
# Rename the SQL file
mv packages/calendar/sql/XXXX_app_runtime_calendar_events_delete.sql \
   packages/calendar/sql/0126_app_runtime_calendar_events_delete.sql

# Update manifest.ts: replace "sql/XXXX_app_runtime..." with "sql/0126_app_runtime..."
# Update foundation.test.ts: replace { version: "XXXX", name: "XXXX_..." } with { version: "0126", name: "0126_..." }
```

- [ ] **Run full gate after rename**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test:calendar-delete 2>&1 | tail -5
pnpm test:focus-time 2>&1 | tail -5
```

Expected: all pass with the renamed migration.

- [ ] **Invoke `coordinated-wrap-up` skill** to push, open PR, and report to coordinator.

---

## Self-review against spec

| Spec §/AC | Task covering it |
|-----------|-----------------|
| `risk: "write"`, no `executionPolicy: "auto"` | Task 4 (manifest), Section C test |
| `calendar_management` locked `allowedTiers: ["always_confirm"]` | Task 4 (manifest), Section C test |
| Always emits action_request card (never auto-runs) | Section C gateway tests |
| allowedTiers lock even with stale `trusted_auto` + hypothetical `auto` policy | Section C allowedTiers test |
| On approval: Google DELETE called, cache row removed | Section D happy path |
| Unknown/owner-invisible eventId → no Google call, friendly message | Section D unknown-id test |
| Missing scope → reconnect message, no Google call | Section D missing-scope test |
| Google 404/410 → `already-gone`, `deleted: true` | Section D 404/410 tests |
| Google 403 → `deleted: false`, no-permission message | Section D 403 test |
| Google other error → `deleted: false`, try-again message | Section D 500 test |
| Cache 42501 → `cacheMirror: "skipped-rls"`, `deleted: true` | Section D RLS-cache test |
| `deletedTitle` from DB row (not model-supplied) | Section D happy path assertion |
| User A cannot delete user B's event | Section A + D RLS isolation tests |
| No token/secret in result/log | Section D credential assertion |
| New migration: owner+connector-scoped DELETE, FORCE RLS, no BYPASSRLS | Task 1 SQL file |
| Migration in manifest migrations list | Task 1 manifest update |
| Migration in `foundation.test.ts` list | Task 1 foundation test update |
| `deleteById` repository method (owner-RLS scoped) | Task 2 |
| `GoogleApiClient.deleteEvent` (DELETE, 204, idempotent 404/410, no body leak) | Task 3 |
| `summarizeDeleteEvent` all three fallback paths | Section C summarize tests |
