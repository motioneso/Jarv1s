// external-modules/finance/src/worker/registry.ts
//
// FIN-01 (#1146): the handler-key → factory registry, split out of index.ts
// because defineModuleWorker attaches a readline on process.stdin at import
// time — tests must be able to pin the full registry (all manifest handler
// keys) without triggering that side effect. index.ts stays a thin dispatch
// shell over this table. All four keys start as notImplemented; Tasks 5–7
// (#1146) wire the real factories.
import type { WorkerPorts } from "./ports.js";
import type { ToolHandler } from "./wrap.js";

export type ToolFactory = (ports: WorkerPorts) => ToolHandler;

export const notImplemented: ToolFactory = () => async () => ({ status: "not-implemented" });

export const HANDLERS: Readonly<Record<string, ToolFactory>> = {
  "accounts.list": notImplemented,
  "connect.start": notImplemented,
  "connect.poll": notImplemented,
  "sync.run": notImplemented
};
