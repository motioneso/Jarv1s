import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  type GatewaySessionRecord
} from "@jarv1s/ai";
import { DataContextRunner, createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { SettingsRepository } from "@jarv1s/settings";
import { PreferencesRepository } from "@jarv1s/structured-state";
import {
  registerMcpTransportRoute,
  registerNativePermissionRoute
} from "../../packages/chat/src/mcp-transport.js";
import { resolveYoloMode } from "../../packages/chat/src/routes.js";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import { exampleToolCalls, exampleToolModule } from "./fixtures/example-tool-module.js";

/** Register a minimal resolve route that mirrors what registerChatRoutes does. */
function registerResolveRoute(
  app: FastifyInstance,
  gateway: AssistantToolGateway,
  actorUserId: string
) {
  app.post<{ Params: { id: string }; Body: { status: string } }>(
    "/api/chat/action-requests/:id/resolve",
    async (request, reply) => {
      const rawStatus = (request.body as { status?: unknown }).status;
      if (rawStatus !== "confirmed" && rawStatus !== "rejected" && rawStatus !== "cancelled") {
        return reply.code(400).send({ error: "status must be confirmed, rejected, or cancelled" });
      }
      try {
        await gateway.resolveActionRequest(actorUserId, request.params.id, rawStatus);
        return reply.code(204).send();
      } catch {
        return reply.code(400).send({ error: "Could not resolve action request" });
      }
    }
  );
}

describe("MCP HTTP transport", () => {
  let appDb: Kysely<JarvisDatabase>;
  let app: FastifyInstance;
  let tokens: SessionTokenRegistry;
  let gateway: AssistantToolGateway;
  let emitted: { chatSessionId: string; record: GatewaySessionRecord }[];

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    const runner = new DataContextRunner(appDb);
    const repository = new AiRepository();

    tokens = new SessionTokenRegistry();
    const confirmations = new ConfirmationRegistry();
    emitted = [];

    gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [exampleToolModule],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 2_000
    });

    app = Fastify({ logger: false });
    registerMcpTransportRoute(app, { gateway, tokens });
    await app.ready();
  });

  beforeEach(() => {
    exampleToolCalls.length = 0;
    emitted.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await appDb.destroy();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: "Bearer jst_bogus" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }
    });
    expect(res.statusCode).toBe(401);
  });

  it("responds to initialize with MCP protocol version", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: randomUUID(),
      allowedToolNames: null
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: { jsonrpc: "2.0", id: 0, method: "initialize", params: {} }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      result: { protocolVersion: string; capabilities: { tools: object } };
    }>();
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("returns 204 for notifications/initialized", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: randomUUID(),
      allowedToolNames: null
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: { jsonrpc: "2.0", method: "notifications/initialized" }
    });
    expect(res.statusCode).toBe(204);
  });

  it("tools/list returns executable tools and excludes declaration-only", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: randomUUID(),
      allowedToolNames: null
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ result: { tools: { name: string }[] } }>();
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain("example.read");
    expect(names).toContain("example.write");
    expect(names).not.toContain("example.declaration-only");
  });

  it("tools/list is actor-scoped at the transport level — userB token yields an empty list", async () => {
    const scopedTokens = new SessionTokenRegistry();
    const scopedGateway = new AssistantToolGateway({
      resolveActiveModules: async (actorUserId) =>
        actorUserId === ids.userA ? [exampleToolModule] : [],
      repository: new AiRepository(),
      runner: new DataContextRunner(appDb),
      tokens: scopedTokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: () => {} },
      confirmTimeoutMs: 2_000
    });
    const scopedApp = Fastify({ logger: false });
    registerMcpTransportRoute(scopedApp, { gateway: scopedGateway, tokens: scopedTokens });
    await scopedApp.ready();
    try {
      const callList = async (actorUserId: string) => {
        const token = scopedTokens.mint({
          actorUserId,
          chatSessionId: randomUUID(),
          allowedToolNames: null
        });
        const res = await scopedApp.inject({
          method: "POST",
          url: "/api/mcp",
          headers: { authorization: `Bearer ${token}` },
          body: { jsonrpc: "2.0", id: 1, method: "tools/list" }
        });
        expect(res.statusCode).toBe(200);
        return res
          .json<{ result: { tools: { name: string }[] } }>()
          .result.tools.map((t) => t.name);
      };

      const aNames = await callList(ids.userA);
      const bNames = await callList(ids.userB);

      expect(aNames).toContain("example.read");
      expect(aNames).toContain("example.write");
      expect(aNames).not.toContain("example.declaration-only");
      expect(bNames).toEqual([]);
    } finally {
      await scopedApp.close();
    }
  });

  it("tools/call runs a read tool and returns MCP content", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: randomUUID(),
      allowedToolNames: null
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "example.read", arguments: { value: "hello" } }
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      result: { isError: boolean; content: { type: string; text: string }[] };
    }>();
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0]!.type).toBe("text");
    const data = JSON.parse(body.result.content[0]!.text) as { echo: string; actor: string };
    expect(data.echo).toBe("hello");
    expect(data.actor).toBe(ids.userA);
    expect(exampleToolCalls).toHaveLength(1);
  });

  it("write call blocks, emits action_request, approves, executes", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: randomUUID(),
      allowedToolNames: null
    });

    const callPromise = app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "example.write", arguments: { value: "approve-me" } }
      }
    });

    // Deterministic wait for the gateway to create the pending action + emit action_request —
    // a fixed setTimeout raced this under full-suite CI load (#979, same class as #944).
    await vi.waitFor(() => {
      expect(emitted).toHaveLength(1);
    });
    const req = emitted[0]!.record;
    expect(req.kind).toBe("action_request");
    if (req.kind !== "action_request") throw new Error("unreachable");

    // Approve
    await gateway.resolveActionRequest(ids.userA, req.actionRequestId, "confirmed");

    const res = await callPromise;
    expect(res.statusCode).toBe(200);
    const body = res.json<{ result: { isError: boolean; content: { text: string }[] } }>();
    expect(body.result.isError).toBe(false);
    const data = JSON.parse(body.result.content[0]!.text) as { echo: string };
    expect(data.echo).toBe("approve-me");

    const actionResult = emitted[1]!.record;
    expect(actionResult.kind).toBe("action_result");
    if (actionResult.kind !== "action_result") throw new Error("unreachable");
    expect(actionResult.outcome).toBe("executed");
  });

  it("tools/call returns an error when tool is not in the session allowlist", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: randomUUID(),
      allowedToolNames: new Set(["example.write"])
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: {
        jsonrpc: "2.0",
        id: 99,
        method: "tools/call",
        params: { name: "example.read", arguments: { value: "blocked" } }
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ result: { isError: boolean; content: { text: string }[] } }>();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain("not in session allowlist");
    expect(exampleToolCalls).toHaveLength(0);
  });
});

describe("HTTP resolve endpoint", () => {
  let appDb: Kysely<JarvisDatabase>;
  let appA: FastifyInstance;
  let appB: FastifyInstance;
  let tokens: SessionTokenRegistry;
  let gateway: AssistantToolGateway;
  let emitted: { chatSessionId: string; record: GatewaySessionRecord }[];

  beforeAll(async () => {
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    const runner = new DataContextRunner(appDb);
    const repository = new AiRepository();
    tokens = new SessionTokenRegistry();
    const confirmations = new ConfirmationRegistry();
    emitted = [];

    gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [exampleToolModule],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 2_000
    });

    // Two separate Fastify apps, each resolving as a different user.
    appA = Fastify({ logger: false });
    registerMcpTransportRoute(appA, { gateway, tokens });
    registerResolveRoute(appA, gateway, ids.userA);
    await appA.ready();

    appB = Fastify({ logger: false });
    registerResolveRoute(appB, gateway, ids.userB);
    await appB.ready();
  });

  beforeEach(() => {
    exampleToolCalls.length = 0;
    emitted.length = 0;
  });

  afterAll(async () => {
    await appA.close();
    await appB.close();
    await appDb.destroy();
  });

  it("resolve returns 400 for unknown status value", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/chat/action-requests/any-id/resolve",
      payload: { status: "INVALID" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("approve via HTTP unblocks the pending call and returns 204", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });

    const callPromise = appA.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "example.write", arguments: { value: "http-approve" } }
      }
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(emitted).toHaveLength(1);
    const req = emitted[0]!.record;
    if (req.kind !== "action_request") throw new Error("expected action_request");

    const resolveRes = await appA.inject({
      method: "POST",
      url: `/api/chat/action-requests/${encodeURIComponent(req.actionRequestId)}/resolve`,
      payload: { status: "confirmed" }
    });
    expect(resolveRes.statusCode).toBe(204);

    const callRes = await callPromise;
    expect(callRes.statusCode).toBe(200);
    const body = callRes.json<{ result: { isError: boolean } }>();
    expect(body.result.isError).toBe(false);
    expect(exampleToolCalls).toHaveLength(1);
  });

  it("cross-user resolve does NOT unblock the owner's pending call (IDOR guard)", async () => {
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: ids.userA,
      allowedToolNames: null
    });

    const callPromise = appA.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "example.write", arguments: { value: "should-not-execute" } }
      }
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(emitted).toHaveLength(1);
    const req = emitted[0]!.record;
    if (req.kind !== "action_request") throw new Error("expected action_request");

    // User B tries to approve User A's action request
    const resolveRes = await appB.inject({
      method: "POST",
      url: `/api/chat/action-requests/${encodeURIComponent(req.actionRequestId)}/resolve`,
      payload: { status: "confirmed" }
    });
    // HTTP layer returns 204 (no information leak), but the call is NOT unblocked
    expect(resolveRes.statusCode).toBe(204);
    expect(exampleToolCalls).toHaveLength(0);

    // Confirm the call is still waiting — deny it via the real owner to unblock
    await gateway.resolveActionRequest(ids.userA, req.actionRequestId, "rejected");
    const callRes = await callPromise;
    const body = callRes.json<{ result: { isError: boolean } }>();
    expect(body.result.isError).toBe(true);
    expect(exampleToolCalls).toHaveLength(0);
  });
});

describe("native permission YOLO", () => {
  let appDb: Kysely<JarvisDatabase>;
  let tokens: SessionTokenRegistry;
  let confirmations: ConfirmationRegistry;
  let runner: DataContextRunner;
  let repository: AiRepository;
  let emitted: { chatSessionId: string; record: GatewaySessionRecord }[];

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  beforeEach(() => {
    emitted = [];
  });

  async function buildApp(yoloGrant: boolean | "effective"): Promise<FastifyInstance> {
    runner = new DataContextRunner(appDb);
    repository = new AiRepository();
    tokens = new SessionTokenRegistry();
    confirmations = new ConfirmationRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [],
      repository,
      runner,
      tokens,
      confirmations,
      notifier: { emit: (chatSessionId, record) => emitted.push({ chatSessionId, record }) },
      confirmTimeoutMs: 2_000,
      yoloMode:
        yoloGrant === "effective"
          ? (ctx) =>
              runner.withDataContext(
                { actorUserId: ctx.actorUserId, requestId: ctx.requestId },
                resolveYoloMode
              )
          : async () => yoloGrant
    });
    const app = Fastify({ logger: false });
    registerNativePermissionRoute(app, { gateway, tokens });
    await app.ready();
    return app;
  }

  async function setEffectiveYoloState(input: {
    readonly master: boolean;
    readonly allowed: boolean;
    readonly enabled: boolean;
  }): Promise<void> {
    await runner.withDataContext(
      { actorUserId: ids.adminUser, requestId: `yolo-master-${randomUUID()}` },
      (scopedDb) =>
        new SettingsRepository().upsertInstanceSetting(scopedDb, {
          key: "yolo.instance_enabled",
          value: { enabled: input.master },
          updatedByUserId: ids.adminUser,
          requestId: `yolo-master-${randomUUID()}`
        })
    );
    const preferences = new PreferencesRepository();
    await runner.withDataContext(
      { actorUserId: ids.userA, requestId: `yolo-state-${randomUUID()}` },
      async (scopedDb) => {
        await preferences.upsert(scopedDb, "yolo.allowed", input.allowed);
        await preferences.upsert(scopedDb, "yolo.enabled", input.enabled);
      }
    );
  }

  async function rejectPending(
    pending: Promise<Awaited<ReturnType<FastifyInstance["inject"]>>>,
    toolName: string
  ): Promise<void> {
    await vi.waitFor(() =>
      expect(emitted).toContainEqual(
        expect.objectContaining({
          record: expect.objectContaining({ kind: "action_request", toolName })
        })
      )
    );
    const request = emitted.find(
      (entry) => entry.record.kind === "action_request" && entry.record.toolName === toolName
    )?.record;
    if (!request || request.kind !== "action_request") throw new Error("expected action_request");
    confirmations.resolve(request.actionRequestId, "rejected");
    const response = await pending;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ decision: "deny", reason: "Denied by user." });
  }

  it("auto-grants allowlisted Write only when effective persisted YOLO state is active", async () => {
    const app = await buildApp("effective");
    try {
      await setEffectiveYoloState({ master: true, allowed: true, enabled: true });
      const chatSessionId = randomUUID();
      const rawSecret = "never-persist-this-native-input-value";
      const token = tokens.mint({
        actorUserId: ids.userA,
        chatSessionId,
        allowedToolNames: null
      });
      const res = await app.inject({
        method: "POST",
        url: "/internal/permission",
        headers: { authorization: `Bearer ${token}` },
        body: {
          tool_name: "Write",
          tool_input: { file_path: "src/safe.ts", content: rawSecret },
          cwd: "/workspace"
        }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ decision: "allow", reason: "Allowed by YOLO." });
      expect(emitted).toEqual([
        {
          chatSessionId,
          record: expect.objectContaining({
            kind: "action_result",
            toolName: "Write",
            outcome: "allowed"
          })
        }
      ]);

      let persistedAudit:
        | Awaited<ReturnType<AiRepository["listActionAuditLog"]>>[number]
        | undefined;
      await vi.waitFor(async () => {
        const rows = await runner.withDataContext(
          { actorUserId: ids.userA, requestId: `audit-check-${randomUUID()}` },
          (scopedDb) =>
            repository.listActionAuditLog(scopedDb, {
              since: new Date(Date.now() - 60_000),
              limit: 500
            })
        );
        persistedAudit = rows.find((row) => row.chat_session_id === chatSessionId);
        expect(persistedAudit).toBeDefined();
      });
      expect(persistedAudit!.input_summary).toEqual({
        inputKeys: ["content", "file_path"],
        inputKeyCount: 2,
        truncated: false
      });
      expect(JSON.stringify(persistedAudit!.input_summary)).not.toContain(rawSecret);
    } finally {
      await app.close();
    }
  });

  it.each([
    ["master off", { master: false, allowed: true, enabled: true }],
    ["account revoked", { master: true, allowed: false, enabled: false }],
    ["user off", { master: true, allowed: true, enabled: false }]
  ])("keeps Write behind confirmation when effective state is %s", async (_label, state) => {
    const app = await buildApp("effective");
    try {
      await setEffectiveYoloState(state);
      const token = tokens.mint({
        actorUserId: ids.userA,
        chatSessionId: randomUUID(),
        allowedToolNames: null
      });
      const pending = app.inject({
        method: "POST",
        url: "/internal/permission",
        headers: { authorization: `Bearer ${token}` },
        body: {
          tool_name: "Write",
          tool_input: { file_path: "src/safe.ts", content: "safe" },
          cwd: "/workspace"
        }
      });
      await rejectPending(pending, "Write");
      expect(emitted).not.toContainEqual(
        expect.objectContaining({ record: expect.objectContaining({ outcome: "allowed" }) })
      );
    } finally {
      await app.close();
    }
  });

  it("keeps Bash behind confirmation even when effective YOLO state is active", async () => {
    const app = await buildApp("effective");
    try {
      await setEffectiveYoloState({ master: true, allowed: true, enabled: true });
      const token = tokens.mint({
        actorUserId: ids.userA,
        chatSessionId: randomUUID(),
        allowedToolNames: null
      });
      const pending = app.inject({
        method: "POST",
        url: "/internal/permission",
        headers: { authorization: `Bearer ${token}` },
        body: { tool_name: "Bash", tool_input: { command: "echo hi" }, cwd: "/workspace" }
      });
      await rejectPending(pending, "Bash");
    } finally {
      await app.close();
    }
  });

  it("rejects invalid native permission authority before evaluating YOLO", async () => {
    const app = await buildApp(true);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/internal/permission",
        headers: { authorization: "Bearer jst_invalid" },
        body: {
          tool_name: "Write",
          tool_input: { file_path: "src/safe.ts", content: "safe" },
          cwd: "/workspace"
        }
      });
      expect(response.statusCode).toBe(401);
      expect(emitted).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
