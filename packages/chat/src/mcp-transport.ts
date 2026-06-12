import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AssistantToolGateway, GatewayToolResponse, SessionTokenRegistry } from "@jarv1s/ai";
import { parsePositiveIntEnv, type AiAssistantToolDto } from "@jarv1s/shared";

const MCP_PROTOCOL_VERSION = "2024-11-05";

// Per-session rate-limit key: use the MCP Bearer token (minted per chat session,
// one token per user). Unauthenticated requests have no token and fall back to IP;
// they will get a 401 before consuming any AI spend.
//
// Override the limit via env: JARVIS_RL_MCP_MAX=<n> (requests per minute, default 120).
// tools/call is the only method that drives actual AI work; other methods (initialize,
// tools/list, notifications/*) are cheap but share the same counter to avoid bypass.
const MCP_MAX = parsePositiveIntEnv(process.env.JARVIS_RL_MCP_MAX, 120);

function mcpRateLimitKey(request: FastifyRequest): string {
  const auth = (request.headers.authorization as string | undefined) ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : request.ip;
}

interface McpRequest {
  jsonrpc: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface McpToolCallParams {
  name: string;
  arguments?: unknown;
}

export interface McpTransportDependencies {
  readonly gateway: AssistantToolGateway;
  readonly tokens: SessionTokenRegistry;
}

/**
 * Registers the MCP JSON-RPC over HTTP endpoint.
 *
 * Supported methods: initialize · notifications/initialized · tools/list · tools/call
 *
 * Security: every request must carry a valid per-session Bearer token. tools/call
 * passes the token to the gateway so identity comes only from the server-minted token
 * (never from the request body).
 */
export function registerMcpTransportRoute(
  server: FastifyInstance,
  deps: McpTransportDependencies
): void {
  server.post<{ Body: McpRequest }>(
    "/api/mcp",
    {
      config: {
        rateLimit: {
          max: MCP_MAX,
          timeWindow: "1 minute",
          keyGenerator: mcpRateLimitKey
        }
      }
    },
    async (request, reply) => {
      const auth = (request.headers.authorization as string | undefined) ?? "";
      if (!auth.startsWith("Bearer ")) {
        return reply.code(401).send(jsonRpcError(null, -32600, "Missing Authorization header"));
      }
      const token = auth.slice(7);
      let identity: ReturnType<typeof deps.tokens.verify>;
      try {
        identity = deps.tokens.verify(token);
      } catch {
        return reply.code(401).send(jsonRpcError(null, -32600, "Invalid or expired session token"));
      }

      const body = request.body as McpRequest;
      const id = body.id ?? null;
      const method = body.method ?? "";

      if (method === "initialize") {
        return reply.code(200).send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "jarvis", version: "0.1.0" }
          }
        });
      }

      if (method.startsWith("notifications/")) {
        return reply.code(204).send();
      }

      if (method === "tools/list") {
        return reply.code(200).send({
          jsonrpc: "2.0",
          id,
          result: { tools: deps.gateway.listToolsForActor(identity.actorUserId).map(dtoToMcpTool) }
        });
      }

      if (method === "tools/call") {
        const params = body.params as McpToolCallParams | undefined;
        if (!params?.name) {
          return reply.code(200).send(jsonRpcError(id, -32602, "tools/call requires params.name"));
        }
        let response: GatewayToolResponse;
        try {
          response = await deps.gateway.callTool(token, params.name, params.arguments ?? {});
        } catch (err) {
          // callTool only throws on invalid token — guard already passed above.
          const message = err instanceof Error ? err.message : "Internal error";
          return reply.code(200).send(jsonRpcError(id, -32603, message));
        }
        return reply.code(200).send({
          jsonrpc: "2.0",
          id,
          result: gatewayResponseToMcp(response)
        });
      }

      return reply.code(200).send(jsonRpcError(id, -32601, `Method not found: ${method}`));
    }
  );
}

function dtoToMcpTool(dto: AiAssistantToolDto) {
  return {
    name: dto.name,
    description: dto.description,
    inputSchema: dto.inputSchema ?? { type: "object" as const, properties: {} }
  };
}

export function gatewayResponseToMcp(res: GatewayToolResponse) {
  if (res.ok) {
    return {
      content: [{ type: "text", text: (res.data as { text: string }).text }],
      isError: false
    };
  }
  if ("denied" in res) {
    return {
      content: [{ type: "text", text: res.reason }],
      isError: true
    };
  }
  return {
    content: [{ type: "text", text: res.error }],
    isError: true
  };
}

function jsonRpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
