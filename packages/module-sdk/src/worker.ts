import { createInterface } from "node:readline";

import {
  MODULE_WORKER_CONTRACT_VERSION,
  type WorkerRpcId,
  type WorkerRpcRequest,
  type WorkerRpcResponse
} from "./worker-protocol.js";
import type { ModuleFetchRequest, ModuleFetchResponse } from "./index.js";

export { MODULE_WORKER_CONTRACT_VERSION } from "./worker-protocol.js";

export interface ModuleWorkerContext {
  readonly input: Record<string, unknown>;
  readonly auth: { getCredential(authId: string): Promise<string> };
  readonly fetch: (request: ModuleFetchRequest) => Promise<ModuleFetchResponse>;
  readonly kv: {
    get(
      scope: "instance" | "user",
      namespace: string,
      key: string
    ): Promise<Record<string, unknown> | null>;
    set(
      scope: "instance" | "user",
      namespace: string,
      key: string,
      value: Record<string, unknown>
    ): Promise<void>;
    delete(scope: "instance" | "user", namespace: string, key: string): Promise<boolean>;
    list(scope: "instance" | "user", namespace: string): Promise<readonly string[]>;
  };
}

type Handler = (ctx: ModuleWorkerContext) => Promise<unknown>;

export function defineModuleWorker(input: {
  readonly handlers: Readonly<Record<string, Handler>>;
}): void {
  let nextId = 0;
  const pending = new Map<
    WorkerRpcId,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const callParent = (method: string, params: unknown): Promise<unknown> => {
    const id = `worker:${++nextId}`;
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const kv = {
    get: (scope: "instance" | "user", namespace: string, key: string) =>
      callParent("kv.get", { scope, namespace, key }) as Promise<Record<string, unknown> | null>,
    set: (
      scope: "instance" | "user",
      namespace: string,
      key: string,
      value: Record<string, unknown>
    ) => callParent("kv.set", { scope, namespace, key, value }) as Promise<void>,
    delete: (scope: "instance" | "user", namespace: string, key: string) =>
      callParent("kv.delete", { scope, namespace, key }) as Promise<boolean>,
    list: (scope: "instance" | "user", namespace: string) =>
      callParent("kv.list", { scope, namespace }) as Promise<readonly string[]>
  };

  createInterface({ input: process.stdin }).on("line", (line) => {
    void (async () => {
      let message: WorkerRpcRequest | WorkerRpcResponse;
      try {
        message = JSON.parse(line) as WorkerRpcRequest | WorkerRpcResponse;
      } catch {
        return;
      }
      if (!("method" in message)) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method !== "module.invoke") return;
      const params = message.params as { handler?: unknown; input?: unknown };
      const handler =
        typeof params.handler === "string" ? input.handlers[params.handler] : undefined;
      if (!handler) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "handler_not_found" }
        });
        return;
      }
      try {
        const result = await handler({
          input:
            params.input && typeof params.input === "object" && !Array.isArray(params.input)
              ? (params.input as Record<string, unknown>)
              : {},
          auth: {
            getCredential: (authId) =>
              callParent("auth.getCredential", { authId }) as Promise<string>
          },
          fetch: (request) => callParent("fetch.request", request) as Promise<ModuleFetchResponse>,
          kv
        });
        send({ jsonrpc: "2.0", id: message.id, result });
      } catch {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "handler_failed" }
        });
      }
    })();
  });
  send({
    jsonrpc: "2.0",
    method: "worker.ready",
    params: { version: MODULE_WORKER_CONTRACT_VERSION }
  });
}
