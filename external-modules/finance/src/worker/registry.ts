// external-modules/finance/src/worker/registry.ts
//
// FIN-01 (#1146): the handler-key → factory registry, split out of index.ts
// because defineModuleWorker attaches a readline on process.stdin at import
// time — tests must be able to pin the full registry (all manifest handler
// keys) without triggering that side effect. index.ts stays a thin dispatch
// shell over this table. Remaining notImplemented keys are wired by
// Tasks 6–7 (#1146).
import { connectPollHandler, connectStartHandler } from "./handlers/connect.js";
import type { WorkerPorts } from "./ports.js";
import type { ToolHandler } from "./wrap.js";

export type ToolFactory = (ports: WorkerPorts) => ToolHandler;

export const notImplemented: ToolFactory = () => async () => ({ status: "not-implemented" });

export const HANDLERS: Readonly<Record<string, ToolFactory>> = {
  "accounts.list": notImplemented,
  "connect.start": connectStartHandler,
  "connect.poll": connectPollHandler,
  "sync.run": notImplemented
};
