import type { FastifyInstance } from "fastify";

import type { AssistantToolGateway, GatewayToolResponse, SessionTokenRegistry } from "@jarv1s/ai";
import type { AiAssistantToolDto } from "@jarv1s/shared";

const MCP_PROTOCOL_VERSION = "2024-11-05";

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
  server.post<{ Body: McpRequest }>("/api/mcp", async (request, reply) => {
    const auth = (request.headers.authorization as string | undefined) ?? "";
    if (!auth.startsWith("Bearer ")) {
      return reply.code(401).send(jsonRpcError(null, -32600, "Missing Authorization header"));
    }
    const token = auth.slice(7);
    try {
      deps.tokens.verify(token);
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
        result: { tools: deps.gateway.listTools().map(dtoToMcpTool) }
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
  });
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
      content: [{ type: "text", text: JSON.stringify(res.data) }],
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

function jsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string
) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
