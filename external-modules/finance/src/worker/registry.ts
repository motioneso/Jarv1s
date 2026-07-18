// external-modules/finance/src/worker/registry.ts
//
// FIN-01 (#1146): the handler-key → factory registry, split out of index.ts
// because defineModuleWorker attaches a readline on process.stdin at import
// time — tests must be able to pin the full registry (all manifest handler
// keys) without triggering that side effect. index.ts stays a thin dispatch
// shell over this table. All four FIN-01 manifest handler keys are real as
// of Task 7 (#1146); notImplemented stays exported for FIN-02's Task 8 keys.
import { accountsListHandler } from "./handlers/accounts.js";
import { connectPollHandler, connectStartHandler } from "./handlers/connect.js";
import {
  categorizeApplyHandler,
  transactionCategorizeHandler,
  transactionsQueryHandler
} from "./handlers/feed.js";
import { syncRunHandler } from "./handlers/sync.js";
import type { WorkerPorts } from "./ports.js";
import type { ToolHandler } from "./wrap.js";

export type ToolFactory = (ports: WorkerPorts) => ToolHandler;

export const notImplemented: ToolFactory = () => async () => ({ status: "not-implemented" });

export const HANDLERS: Readonly<Record<string, ToolFactory>> = {
  "accounts.list": accountsListHandler,
  "connect.start": connectStartHandler,
  "connect.poll": connectPollHandler,
  "sync.run": syncRunHandler,
  // FIN-02 (#1147) Task 10: the feed surface declared by manifest v2.
  "transactions.query": transactionsQueryHandler,
  "transaction.categorize": transactionCategorizeHandler,
  "categorize.apply": categorizeApplyHandler
};
