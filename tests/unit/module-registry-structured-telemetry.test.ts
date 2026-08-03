import { describe, expect, it, vi } from "vitest";

import type * as ConnectorsModule from "@jarv1s/connectors";
import { getBuiltInModuleRegistrations } from "@jarv1s/module-registry";

const connectorWorkerCapture = vi.hoisted(() => ({
  deps: undefined as unknown
}));

vi.mock("@jarv1s/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectorsModule>();
  return {
    ...actual,
    registerConnectorsJobWorkers: vi.fn(async (_boss: unknown, deps: unknown) => {
      connectorWorkerCapture.deps = deps;
      return ["connectors-test-worker"];
    }),
    registerGoogleSyncSweepWorker: vi.fn(async () => "sweep-test-worker"),
    registerImapSyncWorker: vi.fn(async () => ["imap-test-worker"]),
    registerSourceMonitorWorkers: vi.fn(async () => ["monitor-test-worker"])
  };
});

describe("module-registry structured telemetry wiring", () => {
  it("passes the worker logger into connector registration", async () => {
    const registration = getBuiltInModuleRegistrations().find(
      (item) => item.manifest.id === "connectors"
    );
    const logger = { info: vi.fn(), warn: vi.fn() };

    await registration?.registerWorkers?.({} as never, {
      rootDb: {} as never,
      dataContext: {} as never,
      logger: logger as never
    });

    expect(connectorWorkerCapture.deps).toMatchObject({ logger });
  });
});
