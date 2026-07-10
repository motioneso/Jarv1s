export { MODULE_WORKER_CONTRACT_VERSION } from "./index.js";

export type WorkerRpcId = string | number;

export interface WorkerRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: WorkerRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface WorkerRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: WorkerRpcId;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}
