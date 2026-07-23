import { defineModuleWorker } from "@jarv1s/module-sdk/worker";
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { kvFromWorkerContext } from "../domain/kv-port.js";
import type { WorkerPorts } from "./ports.js";
import { aiFromWorkerContext, fetchFromWorkerContext } from "./ports.js";
import type { ToolFactory } from "./registry.js";
import { HANDLERS } from "./registry.js";
import { wrap } from "./wrap.js";

function ports(ctx: ModuleWorkerContext): WorkerPorts {
  return {
    kv: kvFromWorkerContext(ctx.kv),
    fetch: ctx.fetch ? fetchFromWorkerContext(ctx.fetch) : null,
    ai: ctx.ai ? aiFromWorkerContext(ctx.ai) : null,
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
