/**
 * Route-local rate-limit junk-credential gates (#207).
 *
 * Proves that the route-local limiters on POST /api/chat/turn and POST /api/mcp collapse
 * malformed bearer credentials onto the shared per-peer IP bucket (so a caller cannot vary
 * `Authorization: Bearer <junk-N>` to mint fresh per-route buckets), while valid credential
 * shapes (UUID session bearer / jst_<uuid> MCP token) keep their own per-principal bucket.
 *
 * The limit knobs (JARVIS_RL_CHAT_MAX / JARVIS_RL_MCP_MAX) are read at module-import time, so
 * we set them BEFORE dynamically importing the real route modules. The real
 * @fastify/rate-limit plugin is registered (global:false) so only these routes' configs fire.
 * No DB: the limiter runs in onRequest, before the handler, so the runtime/gateway are stubbed.
 */
import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionTokenRegistry } from "@jarv1s/ai";
import type { AccessContext } from "@jarv1s/db";

import { PageContextStore } from "../../packages/chat/src/live/page-context-store.js";

// Low ceilings so 3 distinct junk tokens cross the threshold: with max=2, requests #1 and #2
// pass and #3 is throttled — only possible if all three share ONE bucket.
process.env.JARVIS_RL_CHAT_MAX = "2";
process.env.JARVIS_RL_CHAT_MUTATION_MAX = "2";
process.env.JARVIS_RL_MCP_MAX = "2";

const PEER_IP = "203.0.113.50";
const VALID_SESSION_UUID = "40000000-0000-4000-8000-000000000001";

describe("route-local junk-credential rate-limit gates (#207)", () => {
  let chatApp: FastifyInstance;
  let mcpApp: FastifyInstance;
  let tokens: SessionTokenRegistry;
  let validMcpToken: string;

  beforeAll(async () => {
    // Belt-and-suspenders: ensure the knobs are set before the route modules evaluate.
    process.env.JARVIS_RL_CHAT_MAX = "2";
    process.env.JARVIS_RL_CHAT_MUTATION_MAX = "2";
    process.env.JARVIS_RL_MCP_MAX = "2";

    const { registerChatLiveRoutes } = await import("../../packages/chat/src/live-routes.js");
    const { registerMcpTransportRoute } = await import("../../packages/chat/src/mcp-transport.js");

    // --- Chat app: real /api/chat/turn route on the real session limiter ---
    chatApp = Fastify({ logger: false });
    await chatApp.register(rateLimit, { global: false });
    const stubRuntime = {
      manager: {
        submitTurn: async () => ({ reply: "ok" }),
        clear: async () => undefined,
        switchProvider: async () => undefined
      },
      resolveUserName: async () => "Tester"
    };
    registerChatLiveRoutes(chatApp, {
      // A UUID-shaped bearer is a valid principal; anything else 401s (mirrors real resolve).
      resolveAccessContext: async (request): Promise<AccessContext> => {
        const auth = request.headers.authorization ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
        if (token === VALID_SESSION_UUID) {
          return { actorUserId: randomUUID(), requestId: randomUUID() };
        }
        throw new Error("unauthenticated");
      },
      runtime: stubRuntime as never,
      pageContextStore: new PageContextStore({ now: () => Date.now(), ttlMs: 300_000 })
    });
    await chatApp.ready();

    // --- MCP app: real /api/mcp route on the real MCP token limiter ---
    mcpApp = Fastify({ logger: false });
    await mcpApp.register(rateLimit, { global: false });
    tokens = new SessionTokenRegistry();
    validMcpToken = tokens.mint({
      actorUserId: randomUUID(),
      chatSessionId: randomUUID(),
      allowedToolNames: null
    });
    registerMcpTransportRoute(mcpApp, { gateway: {} as never, tokens });
    await mcpApp.ready();
  });

  afterAll(async () => {
    await chatApp?.close();
    await mcpApp?.close();
  });

  it("collapses 3 distinct malformed bearers on /api/chat/turn onto one IP bucket and 429s by the threshold", async () => {
    const send = (token: string) =>
      chatApp.inject({
        method: "POST",
        url: "/api/chat/turn",
        remoteAddress: PEER_IP,
        headers: { authorization: `Bearer ${token}` },
        body: { text: "hi" }
      });

    // Three DIFFERENT junk tokens from the same peer. If each minted its own bucket, none
    // would ever 429; sharing the ip:<peer> bucket means the third trips the max=2 ceiling.
    const first = await send("junk-token-1");
    const second = await send("junk-token-2");
    const third = await send("junk-token-3");

    expect(first.statusCode).not.toBe(429);
    expect(second.statusCode).not.toBe(429);
    expect(third.statusCode).toBe(429);

    // The 429 must not echo the raw credential anywhere.
    expect(third.body).not.toContain("junk-token-3");
    expect(JSON.stringify(third.headers)).not.toContain("junk-token");
  });

  it("keeps a valid UUID session bearer on its own per-principal bucket after the IP bucket is exhausted", async () => {
    // Exhaust the shared IP bucket with junk from this peer.
    await chatApp.inject({
      method: "POST",
      url: "/api/chat/turn",
      remoteAddress: "203.0.113.60",
      headers: { authorization: "Bearer junk-a" },
      body: { text: "hi" }
    });
    await chatApp.inject({
      method: "POST",
      url: "/api/chat/turn",
      remoteAddress: "203.0.113.60",
      headers: { authorization: "Bearer junk-b" },
      body: { text: "hi" }
    });
    const overIp = await chatApp.inject({
      method: "POST",
      url: "/api/chat/turn",
      remoteAddress: "203.0.113.60",
      headers: { authorization: "Bearer junk-c" },
      body: { text: "hi" }
    });
    expect(overIp.statusCode).toBe(429);

    // A valid UUID bearer from the SAME peer hashes to a separate bearer: bucket → not throttled.
    const validCaller = await chatApp.inject({
      method: "POST",
      url: "/api/chat/turn",
      remoteAddress: "203.0.113.60",
      headers: { authorization: `Bearer ${VALID_SESSION_UUID}` },
      body: { text: "hi" }
    });
    expect(validCaller.statusCode).not.toBe(429);
    expect(validCaller.statusCode).toBe(200);
  });

  it("rate-limits POST /api/chat/clear per valid session principal", async () => {
    const send = () =>
      chatApp.inject({
        method: "POST",
        url: "/api/chat/clear",
        remoteAddress: "203.0.113.80",
        headers: { authorization: `Bearer ${VALID_SESSION_UUID}` }
      });

    expect((await send()).statusCode).toBe(204);
    expect((await send()).statusCode).toBe(204);
    expect((await send()).statusCode).toBe(429);
  });

  it("rate-limits POST /api/chat/switch per valid session principal", async () => {
    const send = () =>
      chatApp.inject({
        method: "POST",
        url: "/api/chat/switch",
        remoteAddress: "203.0.113.81",
        headers: { authorization: `Bearer ${VALID_SESSION_UUID}` }
      });

    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
  });

  it("collapses 3 distinct malformed bearers on /api/mcp onto one IP bucket and 429s by the threshold", async () => {
    const send = (token: string) =>
      mcpApp.inject({
        method: "POST",
        url: "/api/mcp",
        remoteAddress: PEER_IP,
        headers: { authorization: `Bearer ${token}` },
        body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }
      });

    // Non-jst junk tokens (one even mimics a session UUID) must all share the ip:<peer> bucket.
    const first = await send("junk-mcp-1");
    const second = await send(VALID_SESSION_UUID);
    const third = await send("jst_not-a-uuid");

    expect(first.statusCode).not.toBe(429);
    expect(second.statusCode).not.toBe(429);
    expect(third.statusCode).toBe(429);

    expect(third.body).not.toContain("jst_not-a-uuid");
    expect(JSON.stringify(third.headers)).not.toContain("jst_not-a-uuid");
  });

  it("keeps a valid jst_<uuid> MCP token on its own per-session bucket after the IP bucket is exhausted", async () => {
    const peer = "203.0.113.70";
    await mcpApp.inject({
      method: "POST",
      url: "/api/mcp",
      remoteAddress: peer,
      headers: { authorization: "Bearer junk-mcp-a" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }
    });
    await mcpApp.inject({
      method: "POST",
      url: "/api/mcp",
      remoteAddress: peer,
      headers: { authorization: "Bearer junk-mcp-b" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }
    });
    const overIp = await mcpApp.inject({
      method: "POST",
      url: "/api/mcp",
      remoteAddress: peer,
      headers: { authorization: "Bearer junk-mcp-c" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }
    });
    expect(overIp.statusCode).toBe(429);

    // The valid MCP token from the same peer hashes to a separate mcp: bucket → not throttled.
    const validCaller = await mcpApp.inject({
      method: "POST",
      url: "/api/mcp",
      remoteAddress: peer,
      headers: { authorization: `Bearer ${validMcpToken}` },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }
    });
    expect(validCaller.statusCode).not.toBe(429);
    expect(validCaller.statusCode).toBe(200);
  });
});
