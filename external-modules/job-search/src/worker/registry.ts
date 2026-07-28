// external-modules/job-search/src/worker/registry.ts
//
// A side-effect-free map from every handler name the manifest declares to the function that
// serves it. Split out of `index.ts` on purpose: `defineModuleWorker` (the only thing
// `index.ts` calls) opens a stdin `readline` interface at import time
// (`packages/module-sdk/src/worker.ts`), so no test may import `index.ts` itself. This file has
// no such side effect and is what `tests/unit/job-search-manifest.test.ts`'s registry-
// completeness test and every handler unit test import instead.
//
// `storeFrom(ctx)` — not a store built once at module load — because `JobSearchStore` is built
// from `ctx.db`/`ctx.kv` (`store-sql.ts#createSqlStore`), and those only exist inside a per-RPC-
// call `ModuleWorkerContext`. `finance/src/worker/registry.ts`'s `ToolFactory = (ports) =>
// ToolHandler` pattern does not fit here for the same reason: finance's ports are built once
// from a `WorkerPorts` object assembled outside any single call, ours cannot be.
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";

import { createBriefingContributeHandler } from "./handlers/briefing.js";
import {
  createMatchesListHandler,
  createMatchGetHandler,
  createMatchSetStateHandler
} from "./handlers/matches.js";
import {
  createCrawlRunHandler,
  createCrawlRunNowHandler,
  createCrawlSweepHandler
} from "./handlers/pass.js";
import { createPortalListHandler, createPortalSetEnabledHandler } from "./handlers/portal.js";
import {
  createCriteriaSetHandler,
  createProfileBootstrapHandler,
  createProfileCreateHandler,
  createProfileListHandler,
  createSetBriefingDetailHandler,
  createSetContextHandler
} from "./handlers/profile.js";
import { createResumeGetHandler, createResumeSetHandler } from "./handlers/resume.js";
import { createSourceAddHandler, createSourceRemoveHandler } from "./handlers/source.js";
import { createSqlStore } from "./store-sql.js";

export type CtxHandler = (ctx: ModuleWorkerContext) => Promise<unknown>;

function storeFrom(ctx: ModuleWorkerContext) {
  return createSqlStore(ctx.db, ctx.kv);
}

/** Keys are handler names exactly as `jarvis.module.json` spells them in
 * `assistantTools[].handler`, `worker.queues[].handler`, and `briefing.handler` — never the tool
 * or queue NAME, which is a different, `job-search.`-prefixed string. `match.set-state` appears
 * once here even though two manifest entries (the `job-search.match-state` queue and the
 * `job-search.match.dismiss` tool) name it: one handler, two ways in, distinguished internally
 * by `ctx.input`'s own shape (`handlers/matches.ts`). `tests/unit/job-search-manifest.test.ts`
 * asserts this object's key set is a superset of every handler name the manifest declares — a
 * renamed tool or queue handler with no matching edit here fails that test, not silently at
 * runtime with nothing going red (ledger N23). */
export const HANDLERS: Readonly<Record<string, CtxHandler>> = {
  "profile.create": (ctx) => createProfileCreateHandler(storeFrom(ctx))(ctx),
  // Queue-only (job-search.profile-bootstrap); no assistantTools entry names it, deliberately —
  // see the handler's header for why the empty state cannot use profile.create.
  "profile.bootstrap": (ctx) => createProfileBootstrapHandler(storeFrom(ctx))(ctx),
  "profile.list": (ctx) => createProfileListHandler(storeFrom(ctx))(ctx),
  "criteria.set": (ctx) => createCriteriaSetHandler(storeFrom(ctx))(ctx),
  "profile.set-context": (ctx) => createSetContextHandler(storeFrom(ctx))(ctx),
  "profile.set-briefing-detail": (ctx) => createSetBriefingDetailHandler(storeFrom(ctx))(ctx),
  "resume.set": (ctx) => createResumeSetHandler(storeFrom(ctx))(ctx),
  "resume.get": (ctx) => createResumeGetHandler(storeFrom(ctx))(ctx),
  "portal.set-enabled": (ctx) => createPortalSetEnabledHandler(storeFrom(ctx))(ctx),
  "portal.list": (ctx) => createPortalListHandler(storeFrom(ctx))(ctx),
  "source.add": (ctx) => createSourceAddHandler(storeFrom(ctx))(ctx),
  "source.remove": (ctx) => createSourceRemoveHandler(storeFrom(ctx))(ctx),
  "crawl.run": (ctx) => createCrawlRunHandler(storeFrom(ctx))(ctx),
  "crawl.run-now": (ctx) => createCrawlRunNowHandler(storeFrom(ctx))(ctx),
  "crawl.sweep": (ctx) => createCrawlSweepHandler(storeFrom(ctx))(ctx),
  "matches.list": (ctx) => createMatchesListHandler(storeFrom(ctx))(ctx),
  "match.get": (ctx) => createMatchGetHandler(storeFrom(ctx))(ctx),
  "match.set-state": (ctx) => createMatchSetStateHandler(storeFrom(ctx))(ctx),
  "briefing.contribute": (ctx) => createBriefingContributeHandler(storeFrom(ctx))(ctx)
};
