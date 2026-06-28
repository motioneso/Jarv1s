import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DataContextRunner,
  createDatabase,
  type JarvisDatabase
} from "@jarv1s/db";
import {
  ConnectorsRepository,
  createConnectorSecretCipher,
  GoogleApiClient,
  GoogleApiError
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

// ─── Section B: GoogleApiClient.deleteEvent ──────────────────────────────────

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

// ─── Section C: manifest structure + gateway routing ─────────────────────────

import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  type GatewaySessionRecord,
  type SessionNotifier
} from "@jarv1s/ai";
import { calendarModuleManifest } from "@jarv1s/calendar";
import type { JarvisModuleManifest, ModuleAssistantToolManifest } from "@jarv1s/module-sdk";
import {
  buildCalendarWriteService,
  type CalendarWriteImplDeps
} from "@jarv1s/chat";
import {
  GoogleConnectionService,
  GoogleOAuthClient
} from "@jarv1s/connectors";

describe("Section C — manifest structure + gateway routing", () => {
  it("calendar.deleteEvent is registered with correct risk/family/services/no-auto", () => {
    const tool = (calendarModuleManifest as JarvisModuleManifest).assistantTools?.find(
      (t) => t.name === "calendar.deleteEvent"
    ) as ModuleAssistantToolManifest | undefined;
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
    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "rejected");
    await callP;
  });

  it("gateway falls to confirm even if a trusted_auto tier is stored and executionPolicy=auto is set on a hypothetical tool variant", async () => {
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
    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "rejected");
    await callP;
  });
});

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

  function buildImpl(opts: {
    deleteStatus?: number;
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
    // Seed with full calendar scope so INSERT RLS passes, then downgrade to gmail-only
    // so getCalendarWriteScopeState sees hasScope:false when deleteEvent runs.
    const accountIdWithScope = await seedGoogleAccount(ids.userB, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const eventId = await insertCacheRow(ids.userB, accountIdWithScope, "google-evt-scope-check", "Scoped event");
    // Downgrade scopes — upsertGoogleAccount updates the existing account in-place.
    await seedGoogleAccount(ids.userB, ["https://www.googleapis.com/auth/gmail.modify"]);
    const { impl, deleteCalls } = buildImpl({});
    const res = await dataContext.withDataContext({ actorUserId: ids.userB, requestId: "t" }, (db) =>
      impl.deleteEvent(db, { ...ctx, actorUserId: ids.userB }, { eventId })
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
    await seedGoogleAccount(ids.userA, [
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
