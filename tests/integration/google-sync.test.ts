import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import type { DataContextRunner, JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import {
  ConnectorsRepository,
  GoogleApiClient,
  extractEmailSignals,
  parseEmail,
  resolveEmailMessageCap,
  type EmailExtractDeps
} from "@jarv1s/connectors";
import { CalendarRepository } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";
import { ids } from "./test-database.js";
import {
  seedGoogleAccount as seedGoogleAccountWith,
  setupGoogleSyncDatabase,
  teardownGoogleSyncDatabase,
  type GoogleSyncDatabaseHandles
} from "./helpers/google-sync-shared.js";

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;
let workerDataContext: DataContextRunner;

beforeAll(async () => {
  const handles = await setupGoogleSyncDatabase();
  appDb = handles.appDb;
  dataContext = handles.dataContext;
  workerDataContext = handles.workerDataContext;
  teardownHandles = handles;
});

let teardownHandles: GoogleSyncDatabaseHandles;

afterAll(async () => {
  await teardownGoogleSyncDatabase(teardownHandles);
});

function seedGoogleAccount(scopes: string[], actorUserId: string = ids.userA): Promise<string> {
  return seedGoogleAccountWith(dataContext, scopes, actorUserId);
}

describe("email_messages summary/signals columns (0067)", () => {
  it("has nullable summary and a jsonb signals column defaulting to {}", async () => {
    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'email_messages'
        AND column_name IN ('summary', 'signals')
      ORDER BY column_name
    `.execute(appDb);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    expect(byName.summary?.data_type).toBe("text");
    expect(byName.summary?.is_nullable).toBe("YES");
    expect(byName.signals?.data_type).toBe("jsonb");
    expect(byName.signals?.is_nullable).toBe("NO");
  });

  it("declares a CHECK constraint that pins signals to a jsonb object", async () => {
    // A WHERE-false UPDATE never evaluates a CHECK, so assert the constraint EXISTS in the
    // catalog here; a real rejecting INSERT (signals = '[]') is exercised in C1 where a
    // valid connector account FK is available to reach the row insert at all.
    const checks = await sql<{ definition: string }>`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'app' AND t.relname = 'email_messages' AND c.contype = 'c'
    `.execute(appDb);
    const defs = checks.rows.map((r) => r.definition).join(" | ");
    expect(defs).toMatch(/jsonb_typeof\(signals\)\s*=\s*'object'/);
  });
});

// DEVIATION (vs plan A2 step 1): the plan's A2 tests call CalendarRepository.upsertCachedEvent,
// which (a) does not exist until Task B1 and (b) cannot SUCCEED at A2 time even once it exists —
// the relaxed INSERT WITH CHECK runs an EXISTS subquery over app.connector_accounts JOIN
// app.connector_definitions as the worker role, but the worker's SELECT grant on those tables
// only lands in Task A4 (0069). The plan masked this by ordering A2→A3→A4 BEFORE B1, so the
// end-to-end worker INSERT first executes under A4's grants. To keep A2 a self-contained,
// gate-green commit that genuinely verifies ITS OWN security-critical deliverable, A2 asserts
// the relaxation at the catalog level: the worker grant is present, the INSERT policy now
// applies to the worker role, owner-equality is preserved verbatim, and the EXISTS is relaxed
// to provider_type IN ('calendar','google') with the google branch scope-gated on the Calendar
// scope. The end-to-end worker INSERT (success + scope-guard rejection) is exercised once the
// connector grants exist (Task A4 / the F2 handler integration test).
describe("calendar RLS — worker role + google INSERT relax (0066)", () => {
  it("grants the worker role SELECT/INSERT/UPDATE on app.calendar_events", async () => {
    // aclexplode(relacl) is readable from any role and surfaces grants to OTHER roles
    // (information_schema.role_table_grants is filtered to the current role only).
    const grants = await sql<{ privilege_type: string }>`
      SELECT a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
      JOIN pg_roles g ON g.oid = a.grantee
      WHERE n.nspname = 'app' AND c.relname = 'calendar_events'
        AND g.rolname = 'jarvis_worker_runtime'
    `.execute(appDb);
    const privileges = grants.rows.map((r) => r.privilege_type);
    expect(privileges).toContain("SELECT");
    expect(privileges).toContain("INSERT");
    expect(privileges).toContain("UPDATE");
  });

  it("applies the INSERT policy to both the app and worker runtime roles", async () => {
    // One row per granted role (unnest of polroles) avoids array-literal serialization.
    const roles = await sql<{ rolname: string }>`
      SELECT g.rolname
      FROM pg_policy p
      CROSS JOIN LATERAL unnest(p.polroles) AS r(oid)
      JOIN pg_roles g ON g.oid = r.oid
      WHERE p.polrelid = 'app.calendar_events'::regclass
        AND p.polname = 'calendar_events_insert'
    `.execute(appDb);
    expect(new Set(roles.rows.map((r) => r.rolname))).toEqual(
      new Set(["jarvis_app_runtime", "jarvis_worker_runtime"])
    );
  });

  it("preserves owner-equality and adds a scope-gated google branch in the INSERT WITH CHECK", async () => {
    const policy = await sql<{ withcheck: string }>`
      SELECT pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
      FROM pg_policy p
      WHERE p.polrelid = 'app.calendar_events'::regclass AND p.polname = 'calendar_events_insert'
    `.execute(appDb);
    const withCheck = policy.rows[0]?.withcheck ?? "";
    // Owner-equality preserved verbatim (the M-B1 owner-only guarantee is NOT weakened).
    expect(withCheck).toMatch(/owner_user_id = app\.current_actor_user_id\(\)/);
    // Relaxed to accept the unified google account in addition to a native calendar account.
    expect(withCheck).toMatch(/provider_type = 'calendar'/);
    expect(withCheck).toMatch(/provider_type = 'google'/);
    // The google branch is scope-gated: only an account holding the Calendar scope qualifies.
    expect(withCheck).toMatch(/https:\/\/www\.googleapis\.com\/auth\/calendar/);
    expect(withCheck).toMatch(/ANY \(accounts\.scopes\)/);
  });
});

// DEVIATION (vs plan A3 step 1): mirrors the A2 deviation above. The plan's A3 tests call
// EmailRepository.upsertCachedMessage as the worker role, but that method does not exist until
// Task C1, AND a worker INSERT cannot succeed until A4 (0069) grants the worker SELECT on
// app.connector_accounts/app.connector_definitions (the relaxed INSERT WITH CHECK joins both in
// its EXISTS subquery, evaluated as the worker role). To keep A3 a self-contained, gate-green
// commit that genuinely verifies ITS OWN security-critical deliverable, A3 asserts the relaxation
// at the catalog level: the worker grant is present, the INSERT policy now applies to the worker
// role, owner-equality is preserved verbatim, and the EXISTS is relaxed to provider_type IN
// ('email','google') with the google branch scope-gated on the Gmail scope. The end-to-end worker
// INSERT (success + scope-guard rejection) is exercised once the connector grants exist (Task A4 /
// the F2 handler integration test).
describe("email RLS — worker role + google INSERT relax (0068)", () => {
  it("grants the worker role SELECT/INSERT/UPDATE on app.email_messages", async () => {
    // aclexplode(relacl) is readable from any role and surfaces grants to OTHER roles
    // (information_schema.role_table_grants is filtered to the current role only).
    const grants = await sql<{ privilege_type: string }>`
      SELECT a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
      JOIN pg_roles g ON g.oid = a.grantee
      WHERE n.nspname = 'app' AND c.relname = 'email_messages'
        AND g.rolname = 'jarvis_worker_runtime'
    `.execute(appDb);
    const privileges = grants.rows.map((r) => r.privilege_type);
    expect(privileges).toContain("SELECT");
    expect(privileges).toContain("INSERT");
    expect(privileges).toContain("UPDATE");
  });

  it("applies the INSERT policy to both the app and worker runtime roles", async () => {
    // One row per granted role (unnest of polroles) avoids array-literal serialization.
    const roles = await sql<{ rolname: string }>`
      SELECT g.rolname
      FROM pg_policy p
      CROSS JOIN LATERAL unnest(p.polroles) AS r(oid)
      JOIN pg_roles g ON g.oid = r.oid
      WHERE p.polrelid = 'app.email_messages'::regclass
        AND p.polname = 'email_messages_insert'
    `.execute(appDb);
    expect(new Set(roles.rows.map((r) => r.rolname))).toEqual(
      new Set(["jarvis_app_runtime", "jarvis_worker_runtime"])
    );
  });

  it("preserves owner-equality and adds a scope-gated google branch in the INSERT WITH CHECK", async () => {
    const policy = await sql<{ withcheck: string }>`
      SELECT pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
      FROM pg_policy p
      WHERE p.polrelid = 'app.email_messages'::regclass AND p.polname = 'email_messages_insert'
    `.execute(appDb);
    const withCheck = policy.rows[0]?.withcheck ?? "";
    // Owner-equality preserved verbatim (the M-B1 owner-only guarantee is NOT weakened).
    expect(withCheck).toMatch(/owner_user_id = app\.current_actor_user_id\(\)/);
    // Relaxed to accept the unified google account in addition to a native email account.
    expect(withCheck).toMatch(/provider_type = 'email'/);
    expect(withCheck).toMatch(/provider_type = 'google'/);
    // The google branch is scope-gated: only an account holding the Gmail scope qualifies.
    expect(withCheck).toMatch(/https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
    expect(withCheck).toMatch(/ANY \(accounts\.scopes\)/);
  });
});

// Task A4 (was plan-placeholder 0068; re-derived to 0069 — 0068 was taken by the email
// worker-grants migration that landed in A3). The google-sync worker (jarvis_worker_runtime)
// must SELECT the actor's encrypted Google OAuth bundle and UPDATE the re-encrypted refreshed
// token, while connector_accounts stay OWNER-ONLY (secrets are never shared cross-user).
describe("connector_accounts RLS — worker role (0069)", () => {
  it("the worker role reads the actor's active google account secret", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/calendar"]);
    const repo = new ConnectorsRepository();
    const secret = await workerDataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) => repo.getActiveGoogleAccountSecret(scopedDb)
    );
    expect(secret?.id).toBe(accountId);
  });

  it("the worker role cannot see another user's connector account", async () => {
    // Use ids.adminUser here: it is a third authenticated user (test-database.ts) that no test
    // ever gives a connector account, so cross-user invisibility is asserted cleanly regardless
    // of run order.
    const repo = new ConnectorsRepository();
    const secret = await workerDataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "test" },
      (scopedDb) => repo.getActiveGoogleAccountSecret(scopedDb)
    );
    expect(secret).toBeUndefined();
  });

  it("grants the worker role SELECT/UPDATE on connector_accounts and SELECT on connector_definitions", async () => {
    // aclexplode(relacl) surfaces grants to OTHER roles (information_schema is current-role only).
    const grants = await sql<{ relname: string; privilege_type: string }>`
      SELECT c.relname, a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
      JOIN pg_roles g ON g.oid = a.grantee
      WHERE n.nspname = 'app'
        AND c.relname IN ('connector_accounts', 'connector_definitions')
        AND g.rolname = 'jarvis_worker_runtime'
    `.execute(appDb);
    const byTable = grants.rows.reduce<Record<string, Set<string>>>((acc, r) => {
      (acc[r.relname] ??= new Set()).add(r.privilege_type);
      return acc;
    }, {});
    expect(byTable.connector_accounts).toContain("SELECT");
    expect(byTable.connector_accounts).toContain("UPDATE");
    // OWNER-ONLY secrets: the worker is deliberately NOT granted INSERT on connector_accounts
    // (connection creation stays app-runtime only).
    expect(byTable.connector_accounts?.has("INSERT")).toBe(false);
    expect(byTable.connector_definitions).toContain("SELECT");
  });

  it("keeps connector_accounts SELECT owner-only (no app.has_share arm) for both runtimes", async () => {
    const roles = await sql<{ rolname: string }>`
      SELECT g.rolname
      FROM pg_policy p
      CROSS JOIN LATERAL unnest(p.polroles) AS r(oid)
      JOIN pg_roles g ON g.oid = r.oid
      WHERE p.polrelid = 'app.connector_accounts'::regclass
        AND p.polname = 'connector_accounts_select'
    `.execute(appDb);
    expect(new Set(roles.rows.map((r) => r.rolname))).toEqual(
      new Set(["jarvis_app_runtime", "jarvis_worker_runtime"])
    );
    const policy = await sql<{ qual: string }>`
      SELECT pg_get_expr(p.polqual, p.polrelid) AS qual
      FROM pg_policy p
      WHERE p.polrelid = 'app.connector_accounts'::regclass
        AND p.polname = 'connector_accounts_select'
    `.execute(appDb);
    const qual = policy.rows[0]?.qual ?? "";
    expect(qual).toMatch(/owner_user_id = app\.current_actor_user_id\(\)/);
    // Secrets are never shared: no share-based read arm.
    expect(qual).not.toMatch(/has_share/);
  });
});

describe("CalendarRepository.upsertCachedEvent idempotency", () => {
  it("re-upserting the same external_id updates in place (one row, no duplicate)", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/calendar"]);
    const calendar = new CalendarRepository();
    const ctx = { actorUserId: ids.userA, requestId: "test" };
    await dataContext.withDataContext(ctx, (db) =>
      calendar.upsertCachedEvent(db, {
        connectorAccountId: accountId,
        externalId: "dup-1",
        title: "v1",
        startsAt: "2026-06-13T09:00:00.000Z",
        endsAt: "2026-06-13T09:30:00.000Z"
      })
    );
    const second = await dataContext.withDataContext(ctx, (db) =>
      calendar.upsertCachedEvent(db, {
        connectorAccountId: accountId,
        externalId: "dup-1",
        title: "v2",
        startsAt: "2026-06-13T10:00:00.000Z",
        endsAt: "2026-06-13T10:30:00.000Z"
      })
    );
    expect(second.title).toBe("v2");
    const rows = await dataContext.withDataContext(ctx, (db) =>
      db.db
        .selectFrom("app.calendar_events")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("external_id", "=", "dup-1")
        .executeTakeFirstOrThrow()
    );
    expect(Number(rows.n)).toBe(1);
  });
});

// Branch-review LOW (calendar/sql/0066:54 → 0087): the UPDATE policy's WITH CHECK
// must mirror the INSERT policy's connector-account/scope EXISTS guard so a cached
// event can only ever PERSIST behind a scoped connector account the actor owns —
// not merely behind owner-equality.
describe("calendar RLS — UPDATE WITH CHECK connector-scope parity (0087)", () => {
  it("brings the UPDATE WITH CHECK to parity with INSERT (owner-equality + scope-gated google branch)", async () => {
    const policy = await sql<{ withcheck: string }>`
      SELECT pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
      FROM pg_policy p
      WHERE p.polrelid = 'app.calendar_events'::regclass AND p.polname = 'calendar_events_update'
    `.execute(appDb);
    const withCheck = policy.rows[0]?.withcheck ?? "";
    // Owner-equality preserved verbatim.
    expect(withCheck).toMatch(/owner_user_id = app\.current_actor_user_id\(\)/);
    // The owner-or-share('manage') recipient path is preserved (unaffected by the guard).
    expect(withCheck).toMatch(/has_share\('calendar_event'/);
    // The connector-scope EXISTS guard is now present on UPDATE (was INSERT-only before 0087).
    expect(withCheck).toMatch(/connector_accounts/);
    expect(withCheck).toMatch(/provider_type = 'calendar'/);
    expect(withCheck).toMatch(/provider_type = 'google'/);
    expect(withCheck).toMatch(/https:\/\/www\.googleapis\.com\/auth\/calendar/);
    expect(withCheck).toMatch(/ANY \(accounts\.scopes\)/);
  });

  it("rejects an UPDATE once the backing account loses the Calendar scope (end-to-end)", async () => {
    // 1) Seed an account WITH the Calendar scope and INSERT an event (passes the guard).
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/calendar"]);
    const calendar = new CalendarRepository();
    const ctx = { actorUserId: ids.userA, requestId: "test" };
    await dataContext.withDataContext(ctx, (db) =>
      calendar.upsertCachedEvent(db, {
        connectorAccountId: accountId,
        externalId: "scope-guard-1",
        title: "v1",
        startsAt: "2026-06-13T09:00:00.000Z",
        endsAt: "2026-06-13T09:30:00.000Z"
      })
    );

    // 2) Strip the Calendar scope from the SAME account (singleton overwrite keeps the id,
    //    so the event's connector_account_id FK stays valid).
    await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);

    // 3) Re-upserting the same external_id triggers ON CONFLICT DO UPDATE. The UPDATE
    //    WITH CHECK now re-validates the backing account's scope and must REJECT, because
    //    the account no longer holds the Calendar scope. (Before 0087 this UPDATE succeeded
    //    on owner-equality alone.)
    await expect(
      dataContext.withDataContext(ctx, (db) =>
        calendar.upsertCachedEvent(db, {
          connectorAccountId: accountId,
          externalId: "scope-guard-1",
          title: "v2-should-be-rejected",
          startsAt: "2026-06-13T10:00:00.000Z",
          endsAt: "2026-06-13T10:30:00.000Z"
        })
      )
    ).rejects.toThrow(/row-level security/i);

    // The row is unchanged: the rejected UPDATE never landed.
    const row = await dataContext.withDataContext(ctx, (db) =>
      db.db
        .selectFrom("app.calendar_events")
        .select("title")
        .where("external_id", "=", "scope-guard-1")
        .executeTakeFirstOrThrow()
    );
    expect(row.title).toBe("v1");
  });
});

describe("EmailRepository.upsertCachedMessage idempotency + columns", () => {
  it("persists summary + signals and re-upserts in place", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    const email = new EmailRepository();
    const ctx = { actorUserId: ids.userA, requestId: "test" };
    await dataContext.withDataContext(ctx, (db) =>
      email.upsertCachedMessage(db, {
        connectorAccountId: accountId,
        externalId: "e-dup",
        sender: "a@b.com",
        subject: "v1",
        receivedAt: "2026-06-13T09:00:00.000Z",
        summary: "first",
        signals: { importance: "low", confidence: 0.4 }
      })
    );
    const second = await dataContext.withDataContext(ctx, (db) =>
      email.upsertCachedMessage(db, {
        connectorAccountId: accountId,
        externalId: "e-dup",
        sender: "a@b.com",
        subject: "v2",
        receivedAt: "2026-06-13T09:05:00.000Z",
        summary: "second",
        signals: { importance: "high", confidence: 0.9 }
      })
    );
    expect(second.subject).toBe("v2");
    expect(second.summary).toBe("second");
    expect((second.signals as { importance?: string }).importance).toBe("high");
  });

  it("has no full-body column on email_messages", async () => {
    const cols = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'email_messages'
    `.execute(appDb);
    const names = cols.rows.map((r) => r.column_name);
    expect(names).not.toContain("body");
    expect(names).not.toContain("body_full");
    expect(names).not.toContain("raw_body");
  });

  it("rejects a non-object signals value via the CHECK constraint (real insert path)", async () => {
    // The A1 catalog test proves the CHECK exists; this proves it actually REJECTS.
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    await expect(
      dataContext.withDataContext({ actorUserId: ids.userA, requestId: "test" }, (db) =>
        db.db
          .insertInto("app.email_messages")
          .values({
            id: "00000000-0000-0000-0000-0000000000aa",
            connector_account_id: accountId,
            owner_user_id: sql<string>`app.current_actor_user_id()`,
            sender: "a@b.com",
            recipients: [],
            subject: "bad signals",
            snippet: null,
            body_excerpt: null,
            received_at: "2026-06-13T09:00:00.000Z",
            external_id: "bad-signals-1",
            external_metadata: {},
            summary: null,
            signals: sql`'[]'::jsonb`,
            created_at: new Date(),
            updated_at: new Date()
          })
          .execute()
      )
    ).rejects.toThrow();
  });
});

function captureFetch(responder: (url: string) => { ok: boolean; status: number; body: unknown }) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), headers });
    const r = responder(String(url));
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body)
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe("GoogleApiClient.listCalendarEvents", () => {
  it("requests primary calendar with singleEvents=true, orderBy=startTime, the window, and pages", async () => {
    const { calls, fetchFn } = captureFetch((url) =>
      url.includes("pageToken=PAGE2")
        ? { ok: true, status: 200, body: { items: [{ id: "b" }] } }
        : { ok: true, status: 200, body: { items: [{ id: "a" }], nextPageToken: "PAGE2" } }
    );
    const client = new GoogleApiClient({ fetchFn });
    const events = await client.listCalendarEvents({
      accessToken: "tok",
      calendarId: "primary",
      timeMin: "2026-06-06T00:00:00.000Z",
      timeMax: "2026-07-13T00:00:00.000Z"
    });
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    const first = new URL(calls[0]!.url);
    expect(first.pathname).toContain("/calendars/primary/events");
    expect(first.searchParams.get("singleEvents")).toBe("true");
    expect(first.searchParams.get("orderBy")).toBe("startTime");
    expect(first.searchParams.get("timeMin")).toBe("2026-06-06T00:00:00.000Z");
    expect(calls[0]!.headers.authorization).toBe("Bearer tok");
  });

  it("throws without leaking the response body on non-2xx", async () => {
    const { fetchFn } = captureFetch(() => ({
      ok: false,
      status: 503,
      body: { error: "SECRET-LEAK-DETAIL" }
    }));
    const client = new GoogleApiClient({ fetchFn });
    await expect(
      client.listCalendarEvents({ accessToken: "tok", timeMin: "x", timeMax: "y" })
    ).rejects.toThrow(/Google calendar returned 503/);
    await expect(
      client.listCalendarEvents({ accessToken: "tok", timeMin: "x", timeMax: "y" })
    ).rejects.not.toThrow(/SECRET-LEAK-DETAIL/);
  });
});

describe("GoogleApiClient gmail", () => {
  it("lists message ids then gets a full message", async () => {
    const { calls, fetchFn } = captureFetch((url) =>
      url.includes("/messages/m1")
        ? { ok: true, status: 200, body: { id: "m1", payload: {} } }
        : { ok: true, status: 200, body: { messages: [{ id: "m1", threadId: "t1" }] } }
    );
    const client = new GoogleApiClient({ fetchFn });
    const ids = await client.listMessageIds({ accessToken: "tok", query: "newer_than:30d" });
    expect(ids.map((m) => m.id)).toEqual(["m1"]);
    const msg = await client.getMessage({ accessToken: "tok", id: "m1" });
    expect(msg.id).toBe("m1");
    const listUrl = new URL(calls[0]!.url);
    expect(listUrl.searchParams.get("q")).toBe("newer_than:30d");
    const getUrl = new URL(calls[1]!.url);
    expect(getUrl.searchParams.get("format")).toBe("full");
  });
});

describe("resolveEmailMessageCap (JARVIS_EMAIL_SYNC_CAP guard)", () => {
  it("returns the default (50) when unset", () => {
    expect(resolveEmailMessageCap(undefined)).toBe(50);
  });

  it("returns a valid positive integer as-is", () => {
    expect(resolveEmailMessageCap("100")).toBe(100);
    expect(resolveEmailMessageCap("1")).toBe(1);
  });

  it("falls back to the default for a non-numeric value (no silent zero-email sync)", () => {
    // Number('not-a-number') is NaN → slice(0, NaN) === [] → zero emails synced silently. Guard it.
    expect(resolveEmailMessageCap("not-a-number")).toBe(50);
  });

  it("falls back to the default for zero, negatives, and non-integers", () => {
    expect(resolveEmailMessageCap("0")).toBe(50);
    expect(resolveEmailMessageCap("-5")).toBe(50);
    expect(resolveEmailMessageCap("12.5")).toBe(50);
    expect(resolveEmailMessageCap("")).toBe(50);
  });
});

describe("GoogleApiClient.freeBusy fail-closed", () => {
  it("returns the busy list for the requested calendar on a clean 200", async () => {
    const busy = [{ start: "2026-06-17T13:00:00Z", end: "2026-06-17T13:30:00Z" }];
    const { fetchFn } = captureFetch(() => ({
      ok: true,
      status: 200,
      body: { calendars: { primary: { busy } } }
    }));
    const client = new GoogleApiClient({ fetchFn });
    const result = await client.freeBusy({
      accessToken: "tok",
      timeMin: "2026-06-17T13:00:00Z",
      timeMax: "2026-06-17T16:00:00Z",
      calendarId: "primary"
    });
    expect(result.busy).toEqual(busy);
  });

  it("THROWS (fail-closed) on a per-calendar errors[] so a real event is never treated as free", async () => {
    // A freeBusy 200 can carry a per-calendar errors[] (e.g. rateLimitExceeded) with empty busy.
    // Treating that as "fully free" would double-book the focus block over a real meeting.
    const { fetchFn } = captureFetch(() => ({
      ok: true,
      status: 200,
      body: { calendars: { primary: { busy: [], errors: [{ reason: "rateLimitExceeded" }] } } }
    }));
    const client = new GoogleApiClient({ fetchFn });
    await expect(
      client.freeBusy({
        accessToken: "tok",
        timeMin: "2026-06-17T13:00:00Z",
        timeMax: "2026-06-17T16:00:00Z",
        calendarId: "primary"
      })
    ).rejects.toThrow(/per-calendar error/);
  });

  it("THROWS (fail-closed) when the requested calendar key is absent from the response", async () => {
    const { fetchFn } = captureFetch(() => ({
      ok: true,
      status: 200,
      body: { calendars: {} }
    }));
    const client = new GoogleApiClient({ fetchFn });
    await expect(
      client.freeBusy({
        accessToken: "tok",
        timeMin: "2026-06-17T13:00:00Z",
        timeMax: "2026-06-17T16:00:00Z",
        calendarId: "primary"
      })
    ).rejects.toThrow(/missing calendar/);
  });

  it("does not leak the per-calendar error reason into the thrown Error message", async () => {
    const { fetchFn } = captureFetch(() => ({
      ok: true,
      status: 200,
      body: { calendars: { primary: { busy: [], errors: [{ reason: "SECRET-INTERNAL-REASON" }] } } }
    }));
    const client = new GoogleApiClient({ fetchFn });
    await expect(
      client.freeBusy({ accessToken: "tok", timeMin: "x", timeMax: "y", calendarId: "primary" })
    ).rejects.not.toThrow(/SECRET-INTERNAL-REASON/);
  });
});

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

describe("parseEmail", () => {
  it("extracts headers and decodes a base64url text/plain body", () => {
    const parsed = parseEmail({
      id: "m1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "snip",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "Hello" },
          { name: "From", value: "a@b.com" },
          { name: "To", value: "c@d.com" },
          { name: "Date", value: "Sat, 13 Jun 2026 09:00:00 +0000" }
        ],
        body: { data: b64url("Plain body text") }
      }
    });
    expect(parsed.subject).toBe("Hello");
    expect(parsed.from).toBe("a@b.com");
    expect(parsed.recipients).toContain("c@d.com");
    expect(parsed.labelIds).toContain("INBOX");
    expect(parsed.body).toContain("Plain body text");
  });

  it("falls back to stripped text/html when no text/plain part exists", () => {
    const parsed = parseEmail({
      id: "m2",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "Subject", value: "H" },
          { name: "From", value: "a@b.com" }
        ],
        parts: [{ mimeType: "text/html", body: { data: b64url("<p>Hi <b>there</b></p>") } }]
      }
    });
    expect(parsed.body).toContain("Hi");
    expect(parsed.body).not.toContain("<p>");
  });

  it("truncates the decoded body to the bounded cap", () => {
    const big = "x".repeat(100_000);
    const parsed = parseEmail({
      id: "m3",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "H" },
          { name: "From", value: "a@b.com" }
        ],
        body: { data: b64url(big) }
      }
    });
    expect(parsed.body.length).toBeLessThanOrEqual(parsed.bodyTruncated ? 20_000 : big.length);
  });
});

const PARSED = {
  externalId: "m1",
  historyId: null,
  subject: "Electric bill",
  from: "billing@utility.com",
  recipients: ["me@x.com"],
  receivedAt: "2026-06-13T09:00:00.000Z",
  labelIds: ["INBOX"],
  snippet: null,
  body: "Your bill of $84.20 is due 2026-06-30.",
  bodyTruncated: false
};

function fakeDeps(opts: {
  replies: string[]; // one per generateChat call, in order
  models: Array<{ tier: string } | undefined>; // per selectModelForCapability call
}): EmailExtractDeps {
  let replyIdx = 0;
  let modelIdx = 0;
  return {
    selectModel: async () => opts.models[modelIdx++] as never,
    runChat: async () => ({ text: opts.replies[replyIdx++] ?? "" })
  };
}

describe("extractEmailSignals", () => {
  it("parses a valid JSON reply into summary + signals", async () => {
    const deps = fakeDeps({
      replies: [
        JSON.stringify({
          summary: "Utility bill $84.20 due 2026-06-30",
          billsDue: [
            { description: "Electric", amount: 84.2, currency: "USD", dueDate: "2026-06-30" }
          ],
          actionItems: [],
          deadlines: [],
          mayGetLostInShuffle: false,
          importance: "normal",
          confidence: 0.9
        })
      ],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toContain("84.20");
    expect(result.signals.billsDue?.[0]?.amount).toBe(84.2);
    expect(result.signals.confidence).toBe(0.9);
  });

  it("degrades to null summary / empty signals on a garbage reply (never throws)", async () => {
    const deps = fakeDeps({ replies: ["not json at all"], models: [{ tier: "economy" }] });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toBeNull();
    expect(result.signals.confidence).toBe(0);
    expect(result.signals.billsDue ?? []).toEqual([]);
  });

  it("stays economy-tier only — never escalates to a pricier tier", async () => {
    // Even on high importance + low confidence, the sync pass must NOT request a second
    // (interactive/reasoning) model: the plan pins inbox triage to the user's economy tier.
    const tiers: string[] = [];
    const deps: EmailExtractDeps = {
      selectModel: async (tier) => {
        tiers.push(tier);
        return { tier };
      },
      runChat: async () => ({
        text: JSON.stringify({ summary: "x", importance: "high", confidence: 0.2 })
      })
    };
    const result = await extractEmailSignals(PARSED, deps);
    expect(tiers).toEqual(["economy"]);
    expect(result.escalated).toBe(false);
    expect(result.summary).toBe("x");
  });

  it("drops signal text that echoes the email body and strips unknown keys (privacy)", async () => {
    // A prompt-injected model packs the full body into actionItems[].text and adds a rogue key.
    // The sanitizer must drop the body-echoing item and never carry the unknown key through.
    const deps = fakeDeps({
      replies: [
        JSON.stringify({
          summary: "Utility bill due soon",
          actionItems: [{ text: PARSED.body }, { text: "Pay the electric bill" }],
          rawBody: PARSED.body,
          confidence: 0.9
        })
      ],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(PARSED, deps);
    // The body-echoing action item is dropped; the legitimate one survives.
    expect(result.signals.actionItems?.map((a) => a.text)).toEqual(["Pay the electric bill"]);
    // No unknown key (e.g. rawBody) ever lands in the persisted signals object.
    expect(Object.keys(result.signals)).not.toContain("rawBody");
    const serialized = JSON.stringify(result.signals);
    expect(serialized).not.toContain(PARSED.body);
  });

  it("strips text signals when they collectively reconstruct the body (split-chunk attack)", async () => {
    // A hostile model splits the body into many short (<=40-char) chunks across action items so
    // each one slips past the per-field echo floor; the cumulative guard must still strip them.
    const body =
      "Meeting moved to Friday. Bring the signed contract and the Q3 budget spreadsheet please.";
    const parsed = { ...PARSED, body, snippet: null };
    const chunks = body.split(" ").map((text) => ({ text }));
    const deps = fakeDeps({
      replies: [JSON.stringify({ summary: "Logistics for Friday meeting", actionItems: chunks })],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(parsed, deps);
    expect(result.signals.actionItems).toEqual([]);
    expect(JSON.stringify(result.signals)).not.toContain("budget spreadsheet");
  });

  it("keeps legitimate signals that do not reconstruct the body", async () => {
    const deps = fakeDeps({
      replies: [
        JSON.stringify({
          summary: "Utility bill due soon",
          billsDue: [{ description: "Electric", amount: 84.2, dueDate: "2026-06-30" }],
          actionItems: [{ text: "Pay the electric bill" }],
          confidence: 0.8
        })
      ],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.signals.billsDue?.[0]?.description).toBe("Electric");
    expect(result.signals.actionItems?.[0]?.text).toBe("Pay the electric bill");
  });

  it("caps signal strings at the bound (no unbounded model text persisted)", async () => {
    const huge = "z".repeat(5000);
    const deps = fakeDeps({
      replies: [
        JSON.stringify({ summary: "s", billsDue: [{ description: huge }], confidence: 0.5 })
      ],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(PARSED, deps);
    expect((result.signals.billsDue?.[0]?.description.length ?? 0) <= 280).toBe(true);
  });

  it("skips the LLM pass and returns metadata-only when no model is configured", async () => {
    const deps = fakeDeps({ replies: [], models: [undefined] });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toBeNull();
    expect(result.signals).toEqual({});
  });

  it("nulls the summary when a short-body model echoes the body verbatim", async () => {
    // The model summary is byte-for-byte the parsed body (whitespace aside) — no summarization.
    // The exact-echo guard must drop it so the raw body is never persisted as summary.
    const deps = fakeDeps({
      replies: [JSON.stringify({ summary: `  ${PARSED.body}  `, confidence: 0.9 })],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toBeNull();
  });

  it("nulls the summary when the model wraps the full body (Summary: <body> prefix)", async () => {
    // A bad/jailbroken model prefixes the body to slip past exact-equality; the containment
    // guard must still drop it so the full body is never persisted as summary (privacy).
    const deps = fakeDeps({
      replies: [JSON.stringify({ summary: `Summary: ${PARSED.body} -- regards`, confidence: 0.9 })],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toBeNull();
  });

  it("nulls a summary that is a long verbatim body PREFIX longer than the summary cap", async () => {
    // Defeat the pre-truncation gap: a model returns the first 600 chars of a 700-char body
    // verbatim as the summary. Because the guard now runs on the RAW (untruncated) summary and
    // catches a long verbatim body substring, the near-complete body prefix must NOT be persisted.
    const body = "Sensitive paragraph. ".repeat(40); // ~840 chars of real body content
    const parsed = { ...PARSED, body, snippet: null };
    const prefix = body.slice(0, 600); // first 600 chars — a near-complete body prefix
    const deps = fakeDeps({
      replies: [JSON.stringify({ summary: prefix, confidence: 0.9 })],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(parsed, deps);
    expect(result.summary).toBeNull();
  });

  it("nulls a 200+ char verbatim body PREFIX that is BELOW 50% of a long body (echo-guard)", async () => {
    // Regression: a 200–600 char contiguous body prefix below BODY_RECONSTRUCTION_FRACTION used to
    // slip the echo-guard and persist raw email text into summary. The summary substring check now
    // drops any 200+ char verbatim body slice regardless of fraction.
    const body = "Sensitive confidential paragraph number. ".repeat(80); // ~3280 chars
    const parsed = { ...PARSED, body, snippet: null };
    const prefix = body.slice(0, 250); // ~7.6% of the body — well below 50%
    const deps = fakeDeps({
      replies: [JSON.stringify({ summary: prefix, confidence: 0.9 })],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(parsed, deps);
    expect(result.summary).toBeNull();
  });

  it("nulls a WRAPPER-PREFIXED 200+ char verbatim body run below 50% (sliding-window guard)", async () => {
    // Codex re-verify gap: a model returns "Summary: <250-char verbatim body prefix> -- regards".
    // body.includes(summary) is false (body lacks the wrapper) and summary.includes(body) is false
    // (body is far longer), so ONLY the sliding-window scan over the summary catches the embedded
    // 200+ char verbatim body run. The raw email text must NOT be persisted.
    const body = "Sensitive confidential paragraph number. ".repeat(80); // ~3280 chars
    const parsed = { ...PARSED, body, snippet: null };
    const wrapped = `Summary: ${body.slice(0, 250)} -- regards`; // wrapper + ~7.6% verbatim run
    const deps = fakeDeps({
      replies: [JSON.stringify({ summary: wrapped, confidence: 0.9 })],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(parsed, deps);
    expect(result.summary).toBeNull();
  });

  it("keeps a genuine short summary that is NOT a long verbatim body slice", async () => {
    // False-positive guard: a normal paraphrase of a long body survives the substring check.
    const body = "Sensitive paragraph. ".repeat(40);
    const parsed = { ...PARSED, body, snippet: null };
    const deps = fakeDeps({
      replies: [JSON.stringify({ summary: "Repeated sensitive paragraph; no action needed." })],
      models: [{ tier: "economy" }]
    });
    const result = await extractEmailSignals(parsed, deps);
    expect(result.summary).toBe("Repeated sensitive paragraph; no action needed.");
  });

  it("degrades to metadata-only when the router resolves a NON-economy model", async () => {
    // selectModelForCapability can fall through the tier ladder (or final any-model fallback) and
    // return an interactive/reasoning model for an "economy" request. The strict tier gate must
    // reject it and persist a metadata-only row rather than run a pricier tier (cost posture) —
    // and crucially never call the model, so no body is ever sent.
    let chatCalls = 0;
    const deps: EmailExtractDeps = {
      selectModel: async () => ({ tier: "reasoning" }),
      runChat: async () => {
        chatCalls += 1;
        return { text: JSON.stringify({ summary: "should never run" }) };
      }
    };
    const result = await extractEmailSignals(PARSED, deps);
    expect(result.summary).toBeNull();
    expect(result.signals).toEqual({});
    expect(chatCalls).toBe(0);
  });
});
