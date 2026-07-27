// external-modules/job-search/src/worker/index.ts
//
// Task 13 (#1297) / Task 15 (#1299): the worker entrypoint. The handler map itself lives in
// `registry.ts`, not here — `defineModuleWorker` is side-effecting at import time (it opens a
// readline interface on stdin), so no test may import this file, and `registry.ts` is what every
// handler unit test and the manifest's registry-completeness test import instead.
import { defineModuleWorker } from "@jarv1s/module-sdk/worker";

import { HANDLERS } from "./registry.js";

defineModuleWorker({ handlers: HANDLERS });
