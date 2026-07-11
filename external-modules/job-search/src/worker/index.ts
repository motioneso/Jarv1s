// external-modules/job-search/src/worker/index.ts
// JS-03 (#932): tool dispatch shell. Each tool is a factory over WorkerPorts
// (kv + nullable ai + clock) so handler logic stays testable without the SDK
// runtime; `wrap` turns the two scrubbed-by-construction error types into
// structured results and rethrows everything else (→ generic handler_failed
// at the protocol layer, no accidental message leak). JS-05/06 tools and the
// monitor.run queue handler stay not-implemented stubs until their slices.
import { defineModuleWorker } from "@jarv1s/module-sdk/worker";
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { JobSearchKvError, kvFromWorkerContext } from "../domain/index.js";
import type { JobSearchAi, WorkerPorts } from "./ai-port.js";
import { aiFromWorkerContext } from "./ai-port.js";
import { InputError } from "./validate.js";

type ToolHandler = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
type ToolFactory = (ports: WorkerPorts) => ToolHandler;

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
    now: () => new Date()
  };
}

function wrap(handler: ToolHandler): ToolHandler {
  return async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      if (error instanceof JobSearchKvError || error instanceof InputError) {
        // Both error types name keys/constraints only, never record content.
        return { status: "error", code: error.code, message: error.message };
      }
      throw error;
    }
  };
}

const tool = (factory: ToolFactory) => (ctx: ModuleWorkerContext) =>
  wrap(factory(ports(ctx)))(ctx.input);

const notImplemented: ToolFactory = () => async () => ({ status: "not-implemented" });

defineModuleWorker({
  handlers: {
    "onboarding.get-state": tool(notImplemented),
    "profile.get": tool(notImplemented),
    "profile.save-draft": tool(notImplemented),
    "profile.approve": tool(notImplemented),
    "resume.get": tool(notImplemented),
    "resume.save-draft": tool(notImplemented),
    "resume.approve": tool(notImplemented),
    "monitor.list": tool(notImplemented),
    "monitor.get": tool(notImplemented),
    "monitor.save": tool(notImplemented),
    "opportunities.list": tool(notImplemented),
    "opportunities.get": tool(notImplemented),
    "opportunity.decide": tool(notImplemented),
    "monitor.run": tool(notImplemented)
  }
});
