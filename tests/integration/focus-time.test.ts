import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ToolExecute,
  ToolServices,
  ModuleAssistantToolManifest,
  JarvisModuleManifest
} from "@jarv1s/module-sdk";
import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  type GatewaySessionRecord,
  type GatewayToolResponse,
  type SessionNotifier
} from "@jarv1s/ai";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import {
  ConnectorsRepository,
  GoogleApiClient,
  GoogleConnectionService,
  GoogleOAuthClient,
  createConnectorSecretCipher
} from "@jarv1s/connectors";
import {
  buildCalendarWriteService,
  buildChatGatewayDependencies,
  buildChatToolServices
} from "@jarv1s/chat";
import { calendarModuleManifest, CalendarRepository } from "@jarv1s/calendar";
import type { ProposeFocusResult } from "@jarv1s/calendar";
// registerMcpTransportRoute is NOT re-exported from @jarv1s/chat — import it via the deep src path
// exactly as chat-mcp-transport.test.ts does (verified).
import { registerMcpTransportRoute } from "../../packages/chat/src/mcp-transport.js";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

function okText(res: GatewayToolResponse): string {
  if (!res.ok) throw new Error("expected ok response");
  return String((res.data as { text: string }).text);
}

// D2 — fake calendar repositories that throw on the cache mirror, to prove mirrorEvent
// classifies deterministically (independent of whether connector-sync's RLS migration is
// applied in the run DB). upsertCachedEvent always throws, so Promise<never> satisfies the
// override of Promise<CalendarEvent>.
class RlsRejectingCalendarRepository extends CalendarRepository {
  // Simulate the calendar INSERT policy WITH CHECK failing (provider_type guard, pre-relax).
  override async upsertCachedEvent(): Promise<never> {
    const err = new Error(
      'new row violates row-level security policy for table "calendar_events"'
    ) as Error & {
      code?: string;
    };
    err.code = "42501"; // insufficient_privilege — what pg raises for an RLS violation
    throw err;
  }
}

class GenericFailingCalendarRepository extends CalendarRepository {
  override async upsertCachedEvent(): Promise<never> {
    const err = new Error("deadlock detected") as Error & { code?: string };
    err.code = "40P01"; // a NON-RLS error → must classify as skipped-error
    throw err;
  }
}

describe("Group A — tool-service injection seam (module-sdk types)", () => {
  it("a ToolExecute handler may accept a 4th services argument and read a named service", async () => {
    const handler: ToolExecute = async (_scopedDb, _input, _ctx, services?: ToolServices) => {
      const svc = (services ?? {}).demo as { ping: () => string } | undefined;
      return { data: { value: svc ? svc.ping() : "no-service" } };
    };
    const result = await handler(
      {},
      {},
      { actorUserId: "u", requestId: "r", chatSessionId: "s" },
      {
        demo: { ping: () => "pong" }
      }
    );
    expect(result.data.value).toBe("pong");
  });

  it("a 3-arg handler still satisfies ToolExecute (backwards compatible)", async () => {
    const legacy: ToolExecute = async (_scopedDb, _input, _ctx) => ({ data: { ok: true } });
    const result = await legacy({}, {}, { actorUserId: "u", requestId: "r", chatSessionId: "s" });
    expect(result.data.ok).toBe(true);
  });

  it("ModuleAssistantToolManifest accepts an optional requiresServices array", () => {
    const tool: ModuleAssistantToolManifest = {
      name: "demo.tool",
      description: "demo",
      permissionId: "demo.manage",
      risk: "write",
      requiresServices: ["demo"]
    };
    expect(tool.requiresServices).toEqual(["demo"]);
  });
});

describe("Group A — gateway passes toolServices as the 4th execute argument", () => {
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

  function gatewayWith(modules: JarvisModuleManifest[], toolServices: Record<string, unknown>) {
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
      confirmTimeoutMs: 150_000,
      toolServices
    });
    return { gateway, tokens, emitted };
  }

  // Drive a write/destructive tool through the confirm gate with an Approve. Reads the pending
  // actionRequestId off the emitted action_request card (no DB polling), then resolves it.
  async function callAndApprove(
    gateway: AssistantToolGateway,
    emitted: GatewaySessionRecord[],
    token: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<GatewayToolResponse> {
    const callP = gateway.callTool(token, toolName, input);
    // The action_request card is emitted synchronously inside confirmAndRun before it awaits
    // resolution; let the microtask + the createPendingAssistantAction round-trip settle.
    let card: Extract<GatewaySessionRecord, { kind: "action_request" }> | undefined;
    for (let i = 0; i < 200 && !card; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      card = emitted.find(
        (r): r is Extract<GatewaySessionRecord, { kind: "action_request" }> =>
          r.kind === "action_request" && r.toolName === toolName
      );
    }
    if (!card) throw new Error(`no action_request card emitted for ${toolName}`);
    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");
    return callP;
  }

  it("a WRITE tool declaring requiresServices receives the registered service (after approve)", async () => {
    const module: JarvisModuleManifest = {
      id: "demo",
      name: "Demo",
      version: "0",
      publisher: "t",
      lifecycle: "required",
      compatibility: { jarv1s: ">=0.0.0" },
      assistantTools: [
        {
          name: "demo.ping",
          description: "d",
          permissionId: "demo.view",
          risk: "write",
          inputSchema: { type: "object", properties: {} },
          requiresServices: ["demo"],
          execute: async (_db, _i, _c, services) => {
            const svc = (services ?? {}).demo as { ping: () => string };
            return { data: { value: svc.ping() } };
          }
        }
      ]
    };
    const { gateway, tokens, emitted } = gatewayWith([module], { demo: { ping: () => "pong" } });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });
    const res = await callAndApprove(gateway, emitted, token, "demo.ping", {});
    expect(res.ok).toBe(true);
    expect(okText(res)).toContain("pong");
  });

  it("a legacy 3-arg read tool still dispatches when toolServices is empty", async () => {
    const module: JarvisModuleManifest = {
      id: "legacy",
      name: "Legacy",
      version: "0",
      publisher: "t",
      lifecycle: "required",
      compatibility: { jarv1s: ">=0.0.0" },
      assistantTools: [
        {
          name: "legacy.read",
          description: "d",
          permissionId: "legacy.view",
          risk: "read",
          inputSchema: { type: "object", properties: {} },
          execute: async (_db, _i, _c) => ({ data: { ok: true } })
        }
      ]
    };
    const { gateway, tokens } = gatewayWith([module], {});
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });
    const res = await gateway.callTool(token, "legacy.read", {});
    expect(res.ok).toBe(true);
  });

  it("a WRITE tool receives ONLY its declared services, never the whole registry (HIGH #1)", async () => {
    const module: JarvisModuleManifest = {
      id: "iso",
      name: "Iso",
      version: "0",
      publisher: "t",
      lifecycle: "required",
      compatibility: { jarv1s: ">=0.0.0" },
      assistantTools: [
        {
          // declares "allowed" only — must NOT be able to see "secret"
          name: "iso.write",
          description: "d",
          permissionId: "iso.manage",
          risk: "write",
          inputSchema: { type: "object", properties: {} },
          requiresServices: ["allowed"],
          execute: async (_db, _i, _c, services) => {
            const s = services ?? {};
            return { data: { sawAllowed: "allowed" in s, sawSecret: "secret" in s } };
          }
        }
      ]
    };
    const { gateway, tokens, emitted } = gatewayWith([module], {
      allowed: { ok: () => "yes" },
      secret: { proposeAndInsert: () => "WOULD-WRITE" }
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });
    const res = await callAndApprove(gateway, emitted, token, "iso.write", {});
    expect(res.ok).toBe(true);
    // renderToolResult pretty-prints scalar `data` JSON (key: value with a space).
    expect(okText(res)).toContain('"sawAllowed": true');
    expect(okText(res)).toContain('"sawSecret": false');
  });

  it("a READ tool NEVER receives an injected service, even if it declares one (HIGH #5)", async () => {
    // A read tool dispatches WITHOUT confirmAndRun; handing it a (possibly write-capable) service
    // would bypass the write→confirm floor. The gateway must hide it at listing AND withhold the
    // service if somehow invoked. Both are asserted here.
    const module: JarvisModuleManifest = {
      id: "sneaky",
      name: "Sneaky",
      version: "0",
      publisher: "t",
      lifecycle: "required",
      compatibility: { jarv1s: ">=0.0.0" },
      assistantTools: [
        {
          name: "sneaky.read",
          description: "d",
          permissionId: "sneaky.view",
          risk: "read",
          inputSchema: { type: "object", properties: {} },
          requiresServices: ["writeCapable"],
          execute: async (_db, _i, _c, services) => ({
            data: { saw: "writeCapable" in (services ?? {}) }
          })
        }
      ]
    };
    const { gateway, tokens } = gatewayWith([module], {
      writeCapable: { proposeAndInsert: () => "WOULD-WRITE-NO-CONFIRM" }
    });
    // Hidden at listing (read tool declaring services is a misconfiguration).
    const listed = await gateway.listToolsForActor(ids.userA);
    expect(listed.find((t) => t.name === "sneaky.read")).toBeUndefined();
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });
    const res = await gateway.callTool(token, "sneaky.read", {});
    expect(res.ok).toBe(false); // not available — never reaches execute, never sees the service
  });

  it("a WRITE tool whose required service is NOT registered is not listed or invokable (HIGH #2)", async () => {
    const module: JarvisModuleManifest = {
      id: "needs",
      name: "Needs",
      version: "0",
      publisher: "t",
      lifecycle: "required",
      compatibility: { jarv1s: ">=0.0.0" },
      assistantTools: [
        {
          name: "needs.tool",
          description: "d",
          permissionId: "needs.manage",
          risk: "write",
          inputSchema: { type: "object", properties: {} },
          requiresServices: ["absent"],
          execute: async () => ({ data: { ok: true } })
        }
      ]
    };
    const { gateway, tokens } = gatewayWith([module], {}); // "absent" not registered
    const listed = await gateway.listToolsForActor(ids.userA);
    expect(listed.find((t) => t.name === "needs.tool")).toBeUndefined();
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });
    const res = await gateway.callTool(token, "needs.tool", {});
    expect(res.ok).toBe(false); // "Tool not available" — fail closed, no execute reached
  });
});

function captureFetch(
  reply: (url: string, init?: RequestInit) => { status?: number; body: unknown }
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = reply(url, init);
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body)
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe("Group B — GoogleApiClient.freeBusy + insertEvent", () => {
  it("freeBusy posts to the freeBusy endpoint and returns busy intervals for primary", async () => {
    const { calls, fetchFn } = captureFetch(() => ({
      body: {
        calendars: {
          primary: { busy: [{ start: "2026-06-17T09:00:00Z", end: "2026-06-17T10:00:00Z" }] }
        }
      }
    }));
    const client = new GoogleApiClient({ fetchFn });
    const result = await client.freeBusy({
      accessToken: "tok",
      timeMin: "2026-06-17T09:00:00Z",
      timeMax: "2026-06-17T12:00:00Z",
      calendarId: "primary"
    });
    expect(calls[0]!.url).toContain("/freeBusy");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(result.busy).toEqual([{ start: "2026-06-17T09:00:00Z", end: "2026-06-17T10:00:00Z" }]);
  });

  it("insertEvent posts to the primary calendar events endpoint and returns the created id + htmlLink", async () => {
    const { calls, fetchFn } = captureFetch(() => ({
      body: { id: "evt-123", htmlLink: "https://calendar.google.com/evt-123" }
    }));
    const client = new GoogleApiClient({ fetchFn });
    const created = await client.insertEvent({
      accessToken: "tok",
      calendarId: "primary",
      summary: "Focus time",
      start: "2026-06-17T09:00:00Z",
      end: "2026-06-17T11:00:00Z",
      extendedPrivateProperties: { jarvisCreated: "true", jarvisTool: "proposeFocusBlock" }
    });
    expect(calls[0]!.url).toContain("/calendars/primary/events");
    expect(calls[0]!.init?.method).toBe("POST");
    const sentBody = JSON.parse(String(calls[0]!.init?.body));
    expect(sentBody.extendedProperties.private.jarvisCreated).toBe("true");
    expect(created.id).toBe("evt-123");
    expect(created.htmlLink).toBe("https://calendar.google.com/evt-123");
  });

  it("insertEvent throws a body-free GoogleApiError on a non-2xx", async () => {
    const { fetchFn } = captureFetch(() => ({
      status: 500,
      body: { error: "SECRET-INTERNAL-DETAIL" }
    }));
    const client = new GoogleApiClient({ fetchFn });
    await expect(
      client.insertEvent({
        accessToken: "tok",
        calendarId: "primary",
        summary: "x",
        start: "2026-06-17T09:00:00Z",
        end: "2026-06-17T11:00:00Z"
      })
    ).rejects.toThrow("Google calendar returned 500");
    await expect(
      client.insertEvent({
        accessToken: "tok",
        calendarId: "primary",
        summary: "x",
        start: "2026-06-17T09:00:00Z",
        end: "2026-06-17T11:00:00Z"
      })
    ).rejects.not.toThrow(/SECRET-INTERNAL-DETAIL/);
  });
});

describe("Group B — hasCalendarWriteScope (owner-scoped, read-only)", () => {
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

  // Inserts a real app.connector_accounts row via ConnectorsRepository.upsertGoogleAccount under the
  // owner's RLS, with an encrypted bundle so has_secret is true — the bundle contents are never read
  // by the scope check.
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

  it("returns true when the active google account holds the calendar scope", async () => {
    const accountId = await seedGoogleAccount(ids.userA, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    expect(accountId).toBeTruthy();
    const repo = new ConnectorsRepository();
    const has = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "test" },
      (scopedDb) => repo.hasCalendarWriteScope(scopedDb)
    );
    expect(has).toBe(true);
  });

  it("returns false when the active google account lacks the calendar scope", async () => {
    await seedGoogleAccount(ids.userB, ["https://www.googleapis.com/auth/gmail.modify"]);
    const repo = new ConnectorsRepository();
    const has = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "test" },
      (scopedDb) => repo.hasCalendarWriteScope(scopedDb)
    );
    expect(has).toBe(false);
  });

  it("returns false when there is no active google connection", async () => {
    // ids.adminUser is a seeded foundation user with NO google account in this suite — the honest
    // "no connection" actor. (test-database.ts seeds only userA/userB/adminUser; there is no userC.)
    const repo = new ConnectorsRepository();
    const has = await dataContext.withDataContext(
      { actorUserId: ids.adminUser, requestId: "test" },
      (scopedDb) => repo.hasCalendarWriteScope(scopedDb)
    );
    expect(has).toBe(false);
  });
});

describe("Group C — calendar.proposeFocusBlock tool wiring", () => {
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

  // Drive the focus-time write tool through the confirm gate with an Approve. Reads the pending
  // actionRequestId off the emitted action_request card (no DB polling), then resolves it.
  async function callAndApprove(
    gateway: AssistantToolGateway,
    emitted: GatewaySessionRecord[],
    token: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<GatewayToolResponse> {
    const callP = gateway.callTool(token, toolName, input);
    let card: Extract<GatewaySessionRecord, { kind: "action_request" }> | undefined;
    for (let i = 0; i < 200 && !card; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      card = emitted.find(
        (r): r is Extract<GatewaySessionRecord, { kind: "action_request" }> =>
          r.kind === "action_request" && r.toolName === toolName
      );
    }
    if (!card) throw new Error(`no action_request card emitted for ${toolName}`);
    await gateway.resolveActionRequest(ids.userA, card.actionRequestId, "confirmed");
    return callP;
  }

  it("summarize renders requested-window card text mentioning the next-clear-slot caveat", () => {
    const tool = calendarModuleManifest.assistantTools!.find(
      (t) => t.name === "calendar.proposeFocusBlock"
    );
    expect(tool).toBeTruthy();
    expect(tool!.risk).toBe("write");
    expect(tool!.permissionId).toBe("calendar.manage");
    expect(tool!.requiresServices).toEqual(["calendarWrite"]);
    const text = tool!.summarize!(
      { partOfDay: "morning", durationMinutes: 120, title: "Deep work" },
      { actorUserId: "u", requestId: "r", chatSessionId: "s" }
    );
    expect(text).toMatch(/Deep work/);
    expect(text).toMatch(/next clear slot/i);
  });

  it("on approve, execute resolves a window and delegates to services.calendarWrite", async () => {
    let captured: { start: Date; end: Date; durationMinutes: number; title: string } | null = null;
    const fakeService = {
      async proposeAndInsert(
        _db: unknown,
        _ctx: unknown,
        window: { start: Date; end: Date; durationMinutes: number; title: string }
      ) {
        captured = window;
        const r: ProposeFocusResult = {
          created: true,
          resolvedStart: window.start.toISOString(),
          resolvedEnd: window.end.toISOString(),
          shifted: false,
          conflict: "none",
          googleEventId: "evt-xyz",
          calendarMirror: "skipped-rls"
        };
        return r;
      }
    };

    const tokens = new SessionTokenRegistry();
    const confirmations = new ConfirmationRegistry();
    const emitted: GatewaySessionRecord[] = [];
    const notifier: SessionNotifier = {
      emit(_sessionId, record) {
        emitted.push(record);
      }
    };
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [calendarModuleManifest],
      repository: new AiRepository(),
      runner: dataContext,
      tokens,
      confirmations,
      notifier,
      confirmTimeoutMs: 150_000,
      toolServices: { calendarWrite: fakeService }
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });

    const res = await callAndApprove(gateway, emitted, token, "calendar.proposeFocusBlock", {
      partOfDay: "morning",
      durationMinutes: 120,
      title: "Deep work"
    });

    expect(res.ok).toBe(true);
    expect(captured).not.toBeNull();
    // The seam must carry the REQUESTED duration (120m), not the band width (Codex HIGH #3).
    expect(captured!.durationMinutes).toBe(120);
    expect(okText(res)).toContain("evt-xyz");
  });
});

describe("Group D — CalendarWriteService impl (faked Google fetch)", () => {
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

  // Inserts a real app.connector_accounts row via ConnectorsRepository.upsertGoogleAccount under the
  // owner's RLS, with an encrypted bundle so has_secret is true.
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

  function buildImpl(opts: {
    freeBusyBusy?: Array<{ start: string; end: string }>;
    insertReply?: { id: string; htmlLink?: string };
    insertStatus?: number;
    /** Override the calendar repository (D2 injects one whose upsertCachedEvent throws 42501). */
    calendarRepository?: CalendarRepository;
  }) {
    const { fetchFn } = captureFetch((url) => {
      if (url.includes("/freeBusy")) {
        return { body: { calendars: { primary: { busy: opts.freeBusyBusy ?? [] } } } };
      }
      if (url.includes("/events")) {
        if (opts.insertStatus) return { status: opts.insertStatus, body: { error: "SECRET" } };
        return { body: opts.insertReply ?? { id: "evt-new", htmlLink: "https://x/evt-new" } };
      }
      return { body: {} };
    });
    const cipher = createConnectorSecretCipher();
    const repository = new ConnectorsRepository();
    const googleService = new GoogleConnectionService({
      repository,
      cipher,
      oauthClient: new GoogleOAuthClient({ fetchFn })
    });
    return buildCalendarWriteService({
      googleService,
      googleApiClient: new GoogleApiClient({ fetchFn }),
      connectorsRepository: repository,
      calendarRepository: opts.calendarRepository ?? new CalendarRepository()
    });
  }

  it("happy path: clear window → insertEvent with jarvisCreated tag → created:true", async () => {
    await seedGoogleAccount(ids.userA, ["https://www.googleapis.com/auth/calendar"]);
    const impl = buildImpl({ freeBusyBusy: [] });
    const res = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "t" },
      (scopedDb) =>
        impl.proposeAndInsert(
          scopedDb,
          { actorUserId: ids.userA, requestId: "t", chatSessionId: "s" },
          {
            start: new Date("2026-06-17T13:00:00Z"),
            end: new Date("2026-06-17T16:00:00Z"),
            durationMinutes: 120,
            title: "Focus time"
          }
        )
    );
    expect(res.created).toBe(true);
    expect(res.googleEventId).toBe("evt-new");
    expect(res.conflict).toBe("none");
    // Duration regression guard: a 120-minute request over a 09:00–12:00 (180-min) band
    // must insert a 120-minute block, NOT the whole band. resolvedEnd - resolvedStart = 120m.
    const inserted =
      (new Date(res.resolvedEnd).getTime() - new Date(res.resolvedStart).getTime()) / 60_000;
    expect(inserted).toBe(120);
  });

  it("conflict: a busy interval shifts the slot (shifted:true)", async () => {
    await seedGoogleAccount(ids.userA, ["https://www.googleapis.com/auth/calendar"]);
    const impl = buildImpl({
      freeBusyBusy: [{ start: "2026-06-17T13:00:00Z", end: "2026-06-17T13:30:00Z" }]
    });
    const res = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "t" },
      (scopedDb) =>
        impl.proposeAndInsert(
          scopedDb,
          { actorUserId: ids.userA, requestId: "t", chatSessionId: "s" },
          {
            start: new Date("2026-06-17T13:00:00Z"),
            end: new Date("2026-06-17T16:00:00Z"),
            durationMinutes: 120,
            title: "Focus time"
          }
        )
    );
    expect(res.created).toBe(true);
    expect(res.shifted).toBe(true);
    expect(res.conflict).toBe("shifted");
  });

  it("fully busy: no-clear-slot → created:false, no insert call", async () => {
    await seedGoogleAccount(ids.userA, ["https://www.googleapis.com/auth/calendar"]);
    const impl = buildImpl({
      freeBusyBusy: [{ start: "2026-06-17T13:00:00Z", end: "2026-06-17T16:00:00Z" }]
    });
    const res = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "t" },
      (scopedDb) =>
        impl.proposeAndInsert(
          scopedDb,
          { actorUserId: ids.userA, requestId: "t", chatSessionId: "s" },
          {
            start: new Date("2026-06-17T13:00:00Z"),
            end: new Date("2026-06-17T16:00:00Z"),
            durationMinutes: 120,
            title: "Focus time"
          }
        )
    );
    expect(res.created).toBe(false);
    expect(res.conflict).toBe("no-clear-slot");
  });

  it("missing scope: returns created:false with a re-consent message, no Google call", async () => {
    await seedGoogleAccount(ids.userB, ["https://www.googleapis.com/auth/gmail.modify"]);
    const impl = buildImpl({ freeBusyBusy: [] });
    const res = await dataContext.withDataContext(
      { actorUserId: ids.userB, requestId: "t" },
      (scopedDb) =>
        impl.proposeAndInsert(
          scopedDb,
          { actorUserId: ids.userB, requestId: "t", chatSessionId: "s" },
          {
            start: new Date("2026-06-17T13:00:00Z"),
            end: new Date("2026-06-17T16:00:00Z"),
            durationMinutes: 120,
            title: "Focus time"
          }
        )
    );
    expect(res.created).toBe(false);
    expect(res.message).toMatch(/reconnect/i);
  });

  // D2 — cache mirror gating (deterministic). Inject a calendar repository whose
  // upsertCachedEvent throws the exact SQLSTATE Postgres raises for an RLS WITH CHECK
  // violation (42501), so the test exercises the classification branch in mirrorEvent
  // regardless of whether connector-sync's RLS-relax migration is applied in the run DB
  // (Codex MED #6). The call must still return created:true and never throw — the Google
  // event is the source of truth; the mirror is best-effort.
  it("classifies an RLS (42501) mirror failure as skipped-rls; call still created:true", async () => {
    await seedGoogleAccount(ids.userA, ["https://www.googleapis.com/auth/calendar"]);
    const impl = buildImpl({
      freeBusyBusy: [],
      calendarRepository: new RlsRejectingCalendarRepository()
    });
    const res = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "t" },
      (scopedDb) =>
        impl.proposeAndInsert(
          scopedDb,
          { actorUserId: ids.userA, requestId: "t", chatSessionId: "s" },
          {
            start: new Date("2026-06-17T13:00:00Z"),
            end: new Date("2026-06-17T16:00:00Z"),
            durationMinutes: 120,
            title: "Focus time"
          }
        )
    );
    expect(res.created).toBe(true); // the Google event is the source of truth; mirror is best-effort
    expect(res.calendarMirror).toBe("skipped-rls");
    expect(res.googleEventId).toBe("evt-new");
  });

  it("classifies a non-RLS DB error as skipped-error; call still created:true", async () => {
    await seedGoogleAccount(ids.userA, ["https://www.googleapis.com/auth/calendar"]);
    const impl = buildImpl({
      freeBusyBusy: [],
      calendarRepository: new GenericFailingCalendarRepository()
    });
    const res = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "t" },
      (scopedDb) =>
        impl.proposeAndInsert(
          scopedDb,
          { actorUserId: ids.userA, requestId: "t", chatSessionId: "s" },
          {
            start: new Date("2026-06-17T13:00:00Z"),
            end: new Date("2026-06-17T16:00:00Z"),
            durationMinutes: 120,
            title: "Focus time"
          }
        )
    );
    expect(res.created).toBe(true);
    expect(res.calendarMirror).toBe("skipped-error");
  });
});

describe("Group D — buildChatToolServices wires calendarWrite into the gateway (MCP path)", () => {
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

  // The plan harness uses a discarding notifier ({ emit() {} }), so the pending action id is
  // discovered by reading the owner's pending action requests under their own RLS context.
  async function waitForPendingActionId(
    runner: DataContextRunner,
    actorUserId: string
  ): Promise<string> {
    const repo = new AiRepository();
    for (let i = 0; i < 200; i++) {
      const pending = await runner.withDataContext(
        { actorUserId, requestId: "wait-pending" },
        (scopedDb) => repo.listAssistantActions(scopedDb)
      );
      const found = pending.find((a) => a.status === "pending");
      if (found) return found.id;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("no pending action request appeared");
  }

  // Build an app whose gateway uses toolServices PRODUCED BY THE REAL FACTORY (not a literal).
  function buildGatewayAppFromFactory(collaborators: {
    googleConnectionService?: GoogleConnectionService;
    googleApiClient?: GoogleApiClient;
    connectorsRepository?: ConnectorsRepository;
  }) {
    const toolServices = buildChatToolServices(collaborators); // ← exercises D3's code path
    const tokens = new SessionTokenRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [calendarModuleManifest],
      repository: new AiRepository(),
      runner: dataContext,
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit() {} },
      confirmTimeoutMs: 150_000,
      toolServices
    });
    const app = Fastify({ logger: false });
    registerMcpTransportRoute(app, { gateway, tokens });
    app.post<{ Params: { id: string }; Body: { status: string } }>(
      "/api/chat/action-requests/:id/resolve",
      async (request, reply) => {
        await gateway.resolveActionRequest(
          ids.userA,
          request.params.id,
          request.body.status as "confirmed"
        );
        return reply.code(204).send();
      }
    );
    return { app, tokens };
  }

  async function mcp(app: FastifyInstance, token: string, method: string, params: unknown) {
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: { jsonrpc: "2.0", id: 1, method, params }
    });
    return res.json();
  }

  it("WITH collaborators: the factory yields calendarWrite; tools/list includes it and tools/call+resolve executes it", async () => {
    await seedGoogleAccount(ids.userA, ["https://www.googleapis.com/auth/calendar"]);
    // Real collaborators over a faked Google fetch — buildChatToolServices builds a real
    // buildCalendarWriteService from them, so a successful tools/call proves the whole D3 chain.
    const { fetchFn } = captureFetch((url) =>
      url.includes("/freeBusy")
        ? { body: { calendars: { primary: { busy: [] } } } }
        : { body: { id: "evt-mcp", htmlLink: "https://x/evt-mcp" } }
    );
    const cipher = createConnectorSecretCipher();
    const connectorsRepository = new ConnectorsRepository();
    const { app, tokens } = buildGatewayAppFromFactory({
      googleConnectionService: new GoogleConnectionService({
        repository: connectorsRepository,
        cipher,
        oauthClient: new GoogleOAuthClient({ fetchFn })
      }),
      googleApiClient: new GoogleApiClient({ fetchFn }),
      connectorsRepository
    });
    await app.ready();
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });

    const list = await mcp(app, token, "tools/list", {});
    const names = (list.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain("calendar.proposeFocusBlock"); // factory produced calendarWrite ⇒ tool listed

    const callP = mcp(app, token, "tools/call", {
      name: "calendar.proposeFocusBlock",
      arguments: { partOfDay: "morning", durationMinutes: 120 }
    });
    const actionId = await waitForPendingActionId(dataContext, ids.userA);
    await app.inject({
      method: "POST",
      url: `/api/chat/action-requests/${actionId}/resolve`,
      payload: { status: "confirmed" }
    });
    const callResult = await callP;
    // tools/call surfaces the created event id once approved + executed via the real wired service.
    expect(JSON.stringify(callResult)).toContain("evt-mcp");
    await app.close();
  });

  it("WITHOUT collaborators: the factory yields {} so tools/list EXCLUDES the tool and tools/call is rejected", async () => {
    const { app, tokens } = buildGatewayAppFromFactory({}); // factory returns {}
    await app.ready();
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });
    const list = await mcp(app, token, "tools/list", {});
    const names = (list.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).not.toContain("calendar.proposeFocusBlock"); // fail-closed: hidden
    const call = await mcp(app, token, "tools/call", {
      name: "calendar.proposeFocusBlock",
      arguments: {}
    });
    // gateway returns ok:false "Tool not available" → MCP surfaces an error, never reaches execute.
    expect(JSON.stringify(call).toLowerCase()).toMatch(/not available|error/);
    await app.close();
  });

  // Guards the "factory exists but registerChatRoutes forgot to pass toolServices" gap (Codex Round-4 MED):
  // assert the EXACT dependency object registerChatRoutes builds carries toolServices from the factory.
  it("buildChatGatewayDependencies (the helper registerChatRoutes uses) carries toolServices.calendarWrite", () => {
    const { fetchFn } = captureFetch(() => ({ body: {} }));
    const connectorsRepository = new ConnectorsRepository();
    const deps = buildChatGatewayDependencies({
      resolveActiveModules: async () => [calendarModuleManifest],
      repository: new AiRepository(),
      runner: dataContext,
      tokens: new SessionTokenRegistry(),
      confirmations: new ConfirmationRegistry(),
      notifier: { emit() {} },
      collaborators: {
        googleConnectionService: new GoogleConnectionService({
          repository: connectorsRepository,
          cipher: createConnectorSecretCipher(),
          oauthClient: new GoogleOAuthClient({ fetchFn })
        }),
        googleApiClient: new GoogleApiClient({ fetchFn }),
        connectorsRepository
      }
    });
    expect(deps.toolServices).toBeDefined();
    expect((deps.toolServices as Record<string, unknown>).calendarWrite).toBeDefined();
    // and WITHOUT collaborators, the same helper omits it:
    const bare = buildChatGatewayDependencies({
      resolveActiveModules: async () => [calendarModuleManifest],
      repository: new AiRepository(),
      runner: dataContext,
      tokens: new SessionTokenRegistry(),
      confirmations: new ConfirmationRegistry(),
      notifier: { emit() {} },
      collaborators: {}
    });
    expect((bare.toolServices as Record<string, unknown>).calendarWrite).toBeUndefined();
  });
});
