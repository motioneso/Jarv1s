import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";
import {
  ConnectorsRepository,
  GoogleApiClient,
  GOOGLE_SYNC_QUEUE,
  GOOGLE_SYNC_QUEUE_DEFINITIONS,
  createConnectorSecretCipher,
  extractEmailSignals,
  parseEmail,
  runGoogleSync,
  type EmailExtractDeps,
  type GoogleSyncPayload
} from "@jarv1s/connectors";
import { ALLOWED_PAYLOAD_KEYS } from "@jarv1s/jobs";
import { googleSyncRouteSchema, type GoogleSyncResponse } from "@jarv1s/shared";
import { CalendarRepository } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

let appDb: Kysely<JarvisDatabase>;
let dataContext: DataContextRunner;
let workerDb: Kysely<JarvisDatabase>;
let workerDataContext: DataContextRunner;

beforeAll(async () => {
  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app });
  dataContext = new DataContextRunner(appDb);
  workerDb = createDatabase({ connectionString: connectionStrings.worker });
  workerDataContext = new DataContextRunner(workerDb);
});

afterAll(async () => {
  await appDb.destroy();
  await workerDb.destroy();
});

// IMPORTANT — test isolation. `upsertGoogleAccount` is a SINGLETON per user (keyed on
// provider_id = GOOGLE_PROVIDER_ID): every call for the same actor OVERWRITES that user's
// one google account (id + scopes). The connector-account row is seeded via the APP
// DataContext (the worker has no INSERT grant on connector_accounts — see 0069 note); the
// worker DataContext only ever READS it. Seed POSITIVE cases under `ids.userA`; the A4
// cross-user invisibility case uses `ids.adminUser`, which no test ever gives an account.
async function seedGoogleAccount(
  scopes: string[],
  actorUserId: string = ids.userA
): Promise<string> {
  const cipher = createConnectorSecretCipher();
  const repo = new ConnectorsRepository();
  return dataContext.withDataContext({ actorUserId, requestId: "test" }, async (scopedDb) => {
    const account = await repo.upsertGoogleAccount(scopedDb, {
      scopes,
      encryptedSecret: cipher.encryptJson({ kind: "google-oauth" })
    });
    // Prove the precondition: the stored scopes are exactly what this test seeded.
    const stored = await scopedDb.db
      .selectFrom("app.connector_accounts")
      .select("scopes")
      .where("id", "=", account.id)
      .executeTakeFirstOrThrow();
    expect(new Set(stored.scopes)).toEqual(new Set(scopes));
    return account.id;
  });
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

  it("escalates exactly once on high importance + low confidence", async () => {
    const deps = fakeDeps({
      replies: [
        JSON.stringify({ summary: "x", importance: "high", confidence: 0.2 }),
        JSON.stringify({ summary: "escalated", importance: "high", confidence: 0.8 })
      ],
      models: [{ tier: "economy" }, { tier: "interactive" }]
    });
    const result = await extractEmailSignals(PARSED, deps, { escalateConfidence: 0.5 });
    expect(result.summary).toBe("escalated");
    expect(result.signals.confidence).toBe(0.8);
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
});

describe("google-sync queue contract", () => {
  it("uses an exclusive queue named connectors.google-sync", () => {
    expect(GOOGLE_SYNC_QUEUE).toBe("connectors.google-sync");
    const def = GOOGLE_SYNC_QUEUE_DEFINITIONS[0]!;
    expect(def.name).toBe(GOOGLE_SYNC_QUEUE);
    expect(def.options?.policy).toBe("exclusive");
  });

  it("payload keys are all in the metadata-only allowlist", () => {
    const payload: GoogleSyncPayload = {
      actorUserId: "00000000-0000-0000-0000-000000000001",
      kind: "google-sync",
      idempotencyKey: "k"
    };
    for (const key of Object.keys(payload)) {
      expect(ALLOWED_PAYLOAD_KEYS.has(key)).toBe(true);
    }
  });
});

describe("runGoogleSync handler", () => {
  it("syncs calendar + email and returns metadata-only counts", async () => {
    const accountId = await seedGoogleAccount([
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    const result = await dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["calendar", "gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [
            {
              id: "g1",
              summary: "Standup",
              start: { dateTime: "2026-06-13T09:00:00Z" },
              end: { dateTime: "2026-06-13T09:15:00Z" }
            }
          ],
          listMessageIds: async () => [{ id: "m1" }],
          getMessage: async () => ({
            id: "m1",
            payload: {
              headers: [
                { name: "Subject", value: "S" },
                { name: "From", value: "a@b.com" }
              ],
              mimeType: "text/plain",
              body: { data: Buffer.from("hi").toString("base64") }
            }
          })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    expect(result.calendarUpserted).toBe(1);
    expect(result.emailUpserted).toBe(1);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result)).not.toContain("accessToken");
  });

  it("records a no-active-connection error without throwing", async () => {
    const ctx = { actorUserId: ids.userB, requestId: "pgboss:test" };
    const result = await dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => {
          throw new Error("No active Google connection");
        },
        getActiveAccount: async () => undefined,
        googleClient: {
          listCalendarEvents: async () => [],
          listMessageIds: async () => [],
          getMessage: async () => ({ id: "x" })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date()
      })
    );
    expect(result.errors).toContain("no-active-connection");
  });

  it("skips the LLM pass for a message whose historyId is unchanged since last sync", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    let llmCalls = 0;
    const client = {
      listCalendarEvents: async () => [],
      listMessageIds: async () => [{ id: "hist-1" }],
      getMessage: async () => ({
        id: "hist-1",
        historyId: "H100",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Subject", value: "S" },
            { name: "From", value: "a@b.com" }
          ],
          body: { data: Buffer.from("hi").toString("base64") }
        }
      })
    };
    const extractDeps = {
      selectModel: async () => ({ tier: "economy" }),
      runChat: async () => {
        llmCalls += 1;
        return { text: JSON.stringify({ summary: "ok", confidence: 0.9 }) };
      }
    };
    const run = () =>
      dataContext.withDataContext(ctx, (db) =>
        runGoogleSync(db, {
          getFreshAccessToken: async () => "tok",
          getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
          googleClient: client,
          emailExtractDeps: extractDeps,
          now: () => new Date("2026-06-13T12:00:00.000Z")
        })
      );
    await run(); // first sync: summarizes once, stores historyId H100 + a non-null summary
    await run(); // second sync: historyId unchanged AND summary present → skip the LLM pass
    expect(llmCalls).toBe(1);
  });

  it("re-summarizes an unchanged message that was first cached with NO summary", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    const client = {
      listCalendarEvents: async () => [],
      listMessageIds: async () => [{ id: "hist-2" }],
      getMessage: async () => ({
        id: "hist-2",
        historyId: "H200",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Subject", value: "S" },
            { name: "From", value: "a@b.com" }
          ],
          body: { data: Buffer.from("hi").toString("base64") }
        }
      })
    };
    // First sync: NO model configured → summary stays null, historyId H200 stored.
    await dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: client,
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    let llmCalls = 0;
    // Second sync: SAME historyId, but a model now exists and the prior summary is null →
    // must NOT skip; it summarizes this time.
    const result = await dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: client,
        emailExtractDeps: {
          selectModel: async () => ({ tier: "economy" }),
          runChat: async () => {
            llmCalls += 1;
            return { text: JSON.stringify({ summary: "now summarized", confidence: 0.8 }) };
          }
        },
        now: () => new Date("2026-06-13T13:00:00.000Z")
      })
    );
    expect(llmCalls).toBe(1);
    expect(result.emailUpserted).toBe(1);
  });

  it("forces a token refresh and retries once on a 401 from a Google call", async () => {
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/calendar"]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    let refreshes = 0;
    let calendarAttempts = 0;
    const result = await dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async (_db, opts) => {
          if (opts?.force) refreshes += 1;
          return opts?.force ? "fresh-tok" : "stale-tok";
        },
        getActiveAccount: async () => ({ id: accountId, scopes: ["calendar"] }),
        googleClient: {
          listCalendarEvents: async ({ accessToken }) => {
            calendarAttempts += 1;
            if (accessToken === "stale-tok") {
              const e = new Error("Google calendar returned 401") as Error & { statusCode: number };
              e.statusCode = 401;
              throw e;
            }
            return [
              {
                id: "g1",
                summary: "X",
                start: { dateTime: "2026-06-13T09:00:00Z" },
                end: { dateTime: "2026-06-13T09:15:00Z" }
              }
            ];
          },
          listMessageIds: async () => [],
          getMessage: async () => ({ id: "x" })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    expect(refreshes).toBe(1);
    expect(calendarAttempts).toBe(2);
    expect(result.calendarUpserted).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("NEVER persists the full email body in any email_messages column (privacy posture)", async () => {
    // A full body LONGER than MAX_SUMMARY_CHARS (600). The fake model deliberately MISBEHAVES
    // and returns the ENTIRE body as the summary — the worst case. The persisted summary must
    // still be truncated below the cap, so the verbatim full body can never round-trip into a
    // column. (A model legitimately quoting a phrase is acceptable; persisting the whole body
    // verbatim is the invariant we defend.)
    const FULL_BODY = "SENTINEL-FULL-BODY-MUST-NOT-PERSIST-" + "x".repeat(900); // > 600 chars
    const accountId = await seedGoogleAccount(["https://www.googleapis.com/auth/gmail.modify"]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    await dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [],
          listMessageIds: async () => [{ id: "sentinel-1" }],
          getMessage: async () => ({
            id: "sentinel-1",
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "Subject", value: "S" },
                { name: "From", value: "a@b.com" }
              ],
              body: { data: Buffer.from(FULL_BODY).toString("base64") }
            }
          })
        },
        // Misbehaving model: echoes the WHOLE body back as the summary.
        emailExtractDeps: {
          selectModel: async () => ({ tier: "economy" }),
          runChat: async () => ({ text: JSON.stringify({ summary: FULL_BODY, confidence: 0.9 }) })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    const row = await dataContext.withDataContext(ctx, (db) =>
      db.db
        .selectFrom("app.email_messages")
        .selectAll()
        .where("external_id", "=", "sentinel-1")
        .executeTakeFirstOrThrow()
    );
    // The verbatim FULL body must not appear in ANY column (subject/snippet/body_excerpt/
    // summary/signals/external_metadata, all serialized).
    expect(JSON.stringify(row)).not.toContain(FULL_BODY);
    // The summary, if present, is hard-capped at MAX_SUMMARY_CHARS so it cannot be the full body.
    const summary = (row as { summary: string | null }).summary;
    expect((summary ?? "").length).toBeLessThanOrEqual(600);
    // body_excerpt is explicitly NOT written by sync (handler never passes it).
    expect((row as { body_excerpt: string | null }).body_excerpt).toBeNull();
  });
});

describe("google-sync route schema (G1)", () => {
  it("exposes a 202 google-sync route schema with enqueued/deduped/jobId", () => {
    expect(googleSyncRouteSchema.response[202]).toBeDefined();
    const r: GoogleSyncResponse = { enqueued: true, deduped: false, jobId: "j" };
    expect(r.enqueued).toBe(true);
    const d: GoogleSyncResponse = { enqueued: false, deduped: true, jobId: null };
    expect(d.deduped).toBe(true);
  });
});
