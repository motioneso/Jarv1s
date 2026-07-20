// external-modules/job-search/src/worker/index.ts
// JS-03 (#932): tool dispatch shell over the registry. Each tool is a factory
// over WorkerPorts (kv + nullable ai + clock) so handler logic stays testable
// without the SDK runtime; `wrap` turns the two scrubbed-by-construction error
// types into structured results and rethrows everything else (→ generic
// handler_failed at the protocol layer, no accidental message leak). The
// registry lives in registry.ts because defineModuleWorker is side-effecting
// at import time (stdin readline) — tests import the registry, never this.
import { defineModuleWorker } from "@jarv1s/module-sdk/worker";
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { fetchFromWorkerContext } from "../adapters/index.js";
import { kvFromWorkerContext } from "../domain/index.js";
import type { JobSearchAi, WorkerPorts } from "./ai-port.js";
import { aiFromWorkerContext } from "./ai-port.js";
import type { ToolFactory } from "./registry.js";
import { HANDLERS } from "./registry.js";
import { wrap } from "./wrap.js";

// ctx.ai ships with plan Task 0 (worker-capabilities D6); read it structurally
// so this worker builds against today's SDK and the critique path degrades
// gracefully (ai: null → "AI critique unavailable" question) until the bridge
// lands. This nullable seam is what keeps Task 0 severable.
type MaybeAiContext = ModuleWorkerContext & { readonly ai?: JobSearchAi };

function ports(ctx: ModuleWorkerContext): WorkerPorts {
  const ai = (ctx as MaybeAiContext).ai;
  return {
    kv: kvFromWorkerContext(ctx.kv),
    ai: ai ? aiFromWorkerContext(ai) : null,
    // ctx.fetch is typed required on ModuleWorkerContext, but guard anyway:
    // an older host omitting it must degrade to fetch_unavailable run
    // records (JS-05 #934), never a worker crash.
    fetch: ctx.fetch ? fetchFromWorkerContext(ctx.fetch) : null,
    attachments: ctx.attachments,
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
