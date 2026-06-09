import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { registerMcpTransportRoute } from "../../packages/chat/src/mcp-transport.js";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";
import { exampleToolCalls, exampleToolModule } from "./fixtures/example-tool-module.js";

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
      resolveActiveModules: () => [exampleToolModule],
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
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: randomUUID() });
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: { jsonrpc: "2.0", id: 0, method: "initialize", params: {} }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ result: { protocolVersion: string; capabilities: { tools: object } } }>();
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("returns 204 for notifications/initialized", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: randomUUID() });
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: `Bearer ${token}` },
      body: { jsonrpc: "2.0", method: "notifications/initialized" }
    });
    expect(res.statusCode).toBe(204);
  });

  it("tools/list returns executable tools and excludes declaration-only", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: randomUUID() });
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

  it("tools/call runs a read tool and returns MCP content", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: randomUUID() });
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
    const body = res.json<{ result: { isError: boolean; content: { type: string; text: string }[] } }>();
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0]!.type).toBe("text");
    const data = JSON.parse(body.result.content[0]!.text) as { echo: string; actor: string };
    expect(data.echo).toBe("hello");
    expect(data.actor).toBe(ids.userA);
    expect(exampleToolCalls).toHaveLength(1);
  });

  it("write call blocks, emits action_request, approves, executes", async () => {
    const token = tokens.mint({ actorUserId: ids.userA, chatSessionId: randomUUID() });

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

    // Give the gateway a tick to create the pending action + emit action_request
    await new Promise((r) => setTimeout(r, 100));

    expect(emitted).toHaveLength(1);
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
});
