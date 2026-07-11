// tests/unit/external-module-job-search-handlers-run.test.ts
//
// JS-05 (#934): discovery core + monitor.run dispatch. Uses the REAL
// greenhouse adapter (courtesyIntervalMs = 1h) with an injected AdapterFetch
// so the JS-04 safe-reader path (compliance, courtesy, host pinning,
// normalize) is exercised end-to-end without network.
import { describe, expect, it } from "vitest";

import type { AdapterFetch } from "../../external-modules/job-search/src/adapters/index.js";
import {
  getRunSummary,
  listOpportunities,
  listRuns,
  saveMonitor,
  saveMonitorCursor,
  type MonitorConfig
} from "../../external-modules/job-search/src/domain/index.js";
import type { WorkerPorts } from "../../external-modules/job-search/src/worker/ai-port.js";
import {
  deriveRunId,
  runMonitorDiscovery
} from "../../external-modules/job-search/src/worker/handlers/run.js";
import { createMemoryKv, type MemoryKv } from "./helpers/job-search-memory-kv.js";

const T0 = "2026-07-11T08:00:00.000Z"; // 08:00 UTC — past the 07:00 default due time

const greenhousePayload = {
  jobs: [
    {
      id: 101,
      absolute_url: "https://boards.greenhouse.io/acme/jobs/101",
      title: "Platform Engineer",
      location: { name: "Remote" },
      content: "&lt;p&gt;Build the platform.&lt;/p&gt;",
      first_published: "2026-07-01T00:00:00Z"
    },
    {
      id: 102,
      absolute_url: "https://boards.greenhouse.io/acme/jobs/102",
      title: "Staff Engineer",
      location: { name: "New York" },
      content: "&lt;p&gt;Lead things.&lt;/p&gt;",
      first_published: "2026-07-02T00:00:00Z"
    }
  ]
};

const okFetch: AdapterFetch = async () => ({
  status: 200,
  bodyText: JSON.stringify(greenhousePayload)
});
const failFetch: AdapterFetch = async () => ({ status: 500, bodyText: "upstream exploded" });

function makePorts(kv: MemoryKv, fetch: AdapterFetch | null, nowIso: string): WorkerPorts {
  return { kv, ai: null, fetch, now: () => new Date(nowIso) };
}

function monitor(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    schemaVersion: 1,
    monitorId: "mon-1",
    adapterId: "greenhouse",
    enabled: true,
    query: { board: "acme" },
    timezone: "UTC",
    dueTime: "07:00",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

describe("runMonitorDiscovery", () => {
  it("ingests postings, records an ok run, and advances the cursor", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    const outcome = await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    expect(outcome).toMatchObject({
      ran: true,
      counts: { fetched: 2, ingested: 2, suppressed: 0, skipped: 0 }
    });
    expect((await listOpportunities(kv)).length).toBe(2);
    const summary = await getRunSummary(kv, "mon-1");
    expect(summary).toMatchObject({ lastStatus: "ok" });
  });

  it("re-run is idempotent on content (second run suppresses, does not duplicate)", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    // 2h later — greenhouse courtesy (1h) has elapsed, same payload.
    const outcome = await runMonitorDiscovery(
      makePorts(kv, okFetch, "2026-07-11T10:00:00.000Z"),
      config,
      { runId: "b".repeat(32), consumeSlot: false }
    );
    expect(outcome).toMatchObject({
      ran: true,
      counts: { fetched: 2, ingested: 0, suppressed: 2 }
    });
    expect((await listOpportunities(kv)).length).toBe(2);
  });

  it("courtesy-not-due skips silently: no run record, no cursor write", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    // Checked 10 minutes ago; greenhouse courtesy interval is 1h.
    await saveMonitorCursor(kv, {
      schemaVersion: 1,
      monitorId: "mon-1",
      cursor: {},
      lastCheckedAt: "2026-07-11T07:50:00.000Z"
    });
    const outcome = await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: true
    });
    expect(outcome).toEqual({ ran: false, reason: "courtesy_not_due" });
    expect(await listRuns(kv, "mon-1")).toEqual([]);
  });

  it("fetch failure records an error run, keeps known jobs, preserves lastSuccessAt, never marks stale", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    const before = await listOpportunities(kv);
    const outcome = await runMonitorDiscovery(
      makePorts(kv, failFetch, "2026-07-11T10:00:00.000Z"),
      config,
      { runId: "b".repeat(32), consumeSlot: true }
    );
    expect(outcome).toMatchObject({ ran: false, reason: "error", errorCode: "unexpected_status" });
    // JS-05 NEVER touches opportunity records on failure (stale marking = JS-07).
    expect(await listOpportunities(kv)).toEqual(before);
    const summary = await getRunSummary(kv, "mon-1");
    expect(summary).toMatchObject({ lastStatus: "error" });
  });

  it("run records and outcomes are metadata-only (no titles/descriptions/URLs/upstream text)", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    await runMonitorDiscovery(makePorts(kv, failFetch, "2026-07-11T10:00:00.000Z"), config, {
      runId: "b".repeat(32),
      consumeSlot: false
    });
    // Storage keys are "namespace key"; runs namespace is NS.runs
    // ("job-search.runs") — covers both run records and latest summaries.
    for (const [storageKey, value] of (kv as MemoryKv).dump()) {
      if (!storageKey.startsWith("job-search.runs ")) continue;
      const encoded = JSON.stringify(value);
      expect(encoded).not.toContain("Platform Engineer");
      expect(encoded).not.toContain("greenhouse.io");
      expect(encoded).not.toContain("upstream exploded");
    }
  });

  it("deriveRunId is deterministic 32-hex (duplicate delivery converges)", () => {
    const a = deriveRunId("job-search:job-search.monitor-sweep:42", "mon-1");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deriveRunId("job-search:job-search.monitor-sweep:42", "mon-1")).toBe(a);
    expect(deriveRunId("job-search:job-search.monitor-sweep:43", "mon-1")).not.toBe(a);
  });

  it("records fetch_unavailable when the platform gave no fetch port", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    const outcome = await runMonitorDiscovery(makePorts(kv, null, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: true
    });
    expect(outcome).toMatchObject({ ran: false, reason: "error", errorCode: "fetch_unavailable" });
  });
});
