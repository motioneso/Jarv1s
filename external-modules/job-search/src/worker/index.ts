// external-modules/job-search/src/worker/index.ts
// JS-03 (#932): tool dispatch shell. Each tool is a factory over WorkerPorts
// (kv + nullable ai + clock) so handler logic stays testable without the SDK
// runtime; `wrap` turns the two scrubbed-by-construction error types into
// structured results and rethrows everything else (→ generic handler_failed
// at the protocol layer, no accidental message leak). JS-05/06 tools and the
// monitor.run queue handler stay not-implemented stubs until their slices.
import { defineModuleWorker } from "@jarv1s/module-sdk/worker";
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { kvFromWorkerContext } from "../domain/index.js";
import type { JobSearchAi, WorkerPorts } from "./ai-port.js";
import { aiFromWorkerContext } from "./ai-port.js";
import { getStateHandler } from "./handlers/onboarding.js";
import {
  approveProfileHandler,
  getProfileHandler,
  saveProfileDraftHandler
} from "./handlers/profile.js";
import {
  approveResumeHandler,
  getResumeHandler,
  saveResumeDraftHandler
} from "./handlers/resume.js";
import type { ToolHandler } from "./wrap.js";
import { wrap } from "./wrap.js";

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

const tool = (factory: ToolFactory) => (ctx: ModuleWorkerContext) =>
  wrap(factory(ports(ctx)))(ctx.input);

const notImplemented: ToolFactory = () => async () => ({ status: "not-implemented" });

defineModuleWorker({
  handlers: {
    "onboarding.get-state": tool(getStateHandler),
    "profile.get": tool(getProfileHandler),
    "profile.save-draft": tool(saveProfileDraftHandler),
    "profile.approve": tool(approveProfileHandler),
    "resume.get": tool(getResumeHandler),
    "resume.save-draft": tool(saveResumeDraftHandler),
    "resume.approve": tool(approveResumeHandler),
    "monitor.list": tool(notImplemented),
    "monitor.get": tool(notImplemented),
    "monitor.save": tool(notImplemented),
    "opportunities.list": tool(notImplemented),
    "opportunities.get": tool(notImplemented),
    "opportunity.decide": tool(notImplemented),
    "monitor.run": tool(notImplemented)
  }
});
