// tests/unit/external-module-job-search-kv-monitors.test.ts
//
// JS-02 (#931) Task 6: monitor config + cursor repo. Cursors are derived
// scan state keyed per monitor; deleting a monitor must also drop its cursor
// so a re-created monitor with the same id never resumes from stale state.
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import type {
  MonitorConfig,
  MonitorCursor
} from "../../external-modules/job-search/src/domain/monitors.js";
import {
  deleteMonitor,
  getMonitor,
  getMonitorCursor,
  listMonitorIds,
  saveMonitor,
  saveMonitorCursor
} from "../../external-modules/job-search/src/domain/monitors.js";
import { keys } from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

function config(monitorId: string): MonitorConfig {
  return {
    schemaVersion: 1,
    monitorId,
    adapterId: "greenhouse",
    enabled: true,
    query: { role: "engineer" },
    createdAt: "2026-07-11T09:00:00.000Z",
    updatedAt: "2026-07-11T09:00:00.000Z"
  };
}

function cursor(monitorId: string): MonitorCursor {
  return {
    schemaVersion: 1,
    monitorId,
    cursor: { page: 3 },
    lastCheckedAt: "2026-07-11T09:30:00.000Z",
    lastSuccessAt: "2026-07-11T09:30:00.000Z"
  };
}

async function expectKvError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(JobSearchKvError);
  expect((error as JobSearchKvError).code).toBe(code);
}

describe("monitors repo", () => {
  it("round-trips a monitor config and its cursor", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, config("m1"));
    await saveMonitorCursor(kv, cursor("m1"));
    expect(await getMonitor(kv, "m1")).toEqual(config("m1"));
    expect(await getMonitorCursor(kv, "m1")).toEqual(cursor("m1"));
  });

  it("returns null for absent monitor and cursor", async () => {
    const kv = createMemoryKv();
    expect(await getMonitor(kv, "ghost")).toBeNull();
    expect(await getMonitorCursor(kv, "ghost")).toBeNull();
  });

  it("lists monitor ids only (cursor keys excluded)", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, config("m1"));
    await saveMonitor(kv, config("m2"));
    await saveMonitorCursor(kv, cursor("m1"));
    expect(await listMonitorIds(kv)).toEqual(["m1", "m2"]);
  });

  it("deleteMonitor removes the cursor too and reports existence", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, config("m1"));
    await saveMonitorCursor(kv, cursor("m1"));

    expect(await deleteMonitor(kv, "m1")).toBe(true);
    expect(await kv.get(NS.monitors, keys.monitor("m1"))).toBeNull();
    expect(await kv.get(NS.monitors, keys.monitorCursor("m1"))).toBeNull();

    expect(await deleteMonitor(kv, "m1")).toBe(false);
  });

  it("enforces assertId on every entry point", async () => {
    const kv = createMemoryKv();
    await expectKvError(saveMonitor(kv, config("bad id")), "invalid_record");
    await expectKvError(saveMonitorCursor(kv, cursor("bad id")), "invalid_record");
    await expectKvError(getMonitor(kv, "bad id"), "invalid_record");
    await expectKvError(getMonitorCursor(kv, "bad id"), "invalid_record");
    await expectKvError(deleteMonitor(kv, "bad id"), "invalid_record");
  });
});
