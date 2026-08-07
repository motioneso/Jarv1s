// tests/fixtures/module-web-sdk-ui-smoke/src/worker/index.ts
// #1388 Foundation task 11: buildExternalModule() always emits a worker bundle
// (scripts/build-external-module.ts has no existsSync guard on the worker entry,
// unlike the optional web one), so this fixture needs a minimal worker even
// though the thing under test is the web bundle. No handlers — nothing here
// exercises tool dispatch.
import { defineModuleWorker } from "@moss/module-sdk/worker";

defineModuleWorker({ handlers: {} });
