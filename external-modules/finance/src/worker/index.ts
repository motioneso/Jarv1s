// external-modules/finance/src/worker/index.ts
// FIN-01 (#1146): tool dispatch shell over the registry (job-search index.ts
// pattern). Each tool is a factory over WorkerPorts so handler logic stays
// testable without the SDK runtime; `wrap` turns the scrubbed-by-construction
// error types into structured results and rethrows everything else (→ generic
// handler_failed at the protocol layer, no accidental message leak). The
// registry lives in registry.ts because defineModuleWorker is side-effecting
// at import time (stdin readline) — tests import the registry, never this.
import { defineModuleWorker } from "@jarv1s/module-sdk/worker";
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { fetchFromWorkerContext } from "../adapters/index.js";
import { kvFromWorkerContext } from "../domain/index.js";
import type { FinanceAi, WorkerPorts } from "./ports.js";
import { aiFromWorkerContext } from "./ports.js";
import type { ToolFactory } from "./registry.js";
import { HANDLERS } from "./registry.js";
import { wrap } from "./wrap.js";

// ctx.ai is read structurally (job-search precedent) so this worker builds
// against today's SDK and degrades gracefully when no AI bridge is present.
type MaybeAiContext = ModuleWorkerContext & { readonly ai?: FinanceAi };

function ports(ctx: ModuleWorkerContext): WorkerPorts {
  const ai = (ctx as MaybeAiContext).ai;
  return {
    kv: kvFromWorkerContext(ctx.kv),
    ai: ai ? aiFromWorkerContext(ai) : null,
    // ctx.fetch is typed required on ModuleWorkerContext, but guard anyway:
    // an older host omitting it must degrade to a structured fetch error,
    // never a worker crash.
    fetch: ctx.fetch ? fetchFromWorkerContext(ctx.fetch) : null,
    // Stubs until Task 5 (#1146) lands auth-port.ts — the ONLY code allowed
    // to touch ctx.auth. read() → null mirrors the real port's error
    // collapse; write() throws so a mis-wired early handler can never
    // silently drop a token map.
    tokens: {
      read: async () => null,
      write: async () => {
        throw new Error("tokens_port_not_wired");
      }
    },
    settings: { getEnvironment: async () => "production" },
    // ModuleWorkerContext exposes no admin flag today — admin-gated inputs
    // (connect.start environment override) stay dropped until it does
    // (re-checked in Task 5, #1146).
    isAdmin: false,
    now: () => new Date()
  };
}

const tool = (factory: ToolFactory) => (ctx: ModuleWorkerContext) =>
  wrap(factory(ports(ctx)))(ctx.input);

defineModuleWorker({
  handlers: Object.fromEntries(
    Object.entries(HANDLERS).map(([key, factory]) => [key, tool(factory)])
  )
});
