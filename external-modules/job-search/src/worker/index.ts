// external-modules/job-search/src/worker/index.ts
//
// Task 13 (#1297): the worker entrypoint. Empty handler map on purpose — Tasks 15 and 16 add
// the actual tools, each as a factory over `toFetchLike`/`createSqlStore` (ports.ts,
// store-sql.ts) the same way finance's worker/index.ts builds `WorkerPorts` over its own
// bridges. Nothing here is a test seam: `defineModuleWorker` is side-effecting at import time
// (it opens a readline interface on stdin), so no test imports this file.
import { defineModuleWorker } from "@jarv1s/module-sdk/worker";

defineModuleWorker({ handlers: {} });
