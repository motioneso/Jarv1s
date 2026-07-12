// tests/unit/external-module-job-search-handlers-run.test.ts
//
// JS-05 (#934): discovery core + monitor.run dispatch. Uses the REAL
// greenhouse adapter (courtesyIntervalMs = 1h) with an injected AdapterFetch
// so the JS-04 safe-reader path (compliance, courtesy, host pinning,
// normalize) is exercised end-to-end without network.
import { describe, expect, it } from "vitest";

import type { AdapterFetch } from "../../external-modules/job-search/src/adapters/index.js";
import {
  getEvaluation,
  readBudgetUsed
} from "../../external-modules/job-search/src/domain/evaluations.js";
import { readFeed } from "../../external-modules/job-search/src/domain/feed.js";
import {
  getMonitor,
  getRunSummary,
  listOpportunities,
  listRuns,
  saveMonitor,
  saveMonitorCursor,
  sourceKey,
  type MonitorConfig
} from "../../external-modules/job-search/src/domain/index.js";
import {
  approveProfile,
  saveProfileRevision
} from "../../external-modules/job-search/src/domain/profile.js";
import {
  approveResume,
  saveOriginalResume
} from "../../external-modules/job-search/src/domain/resume.js";
import type {
  JobSearchAi,
  JobSearchAiInput,
  JobSearchAiResult,
  WorkerPorts
} from "../../external-modules/job-search/src/worker/ai-port.js";
import {
  deriveRunId,
  monitorRunHandler,
  postingToOpportunity,
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

function makePorts(
  kv: MemoryKv,
  fetch: AdapterFetch | null,
  nowIso: string,
  ai: JobSearchAi | null = null
): WorkerPorts {
  return { kv, ai, fetch, now: () => new Date(nowIso) };
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

describe("monitor.run handler", () => {
  const sweepInput = (idempotencyKey: string) => ({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    jobKind: "job-search.monitor-sweep",
    idempotencyKey,
    params: {}
  });
  const runNowInput = (idempotencyKey: string, monitorId: string) => ({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    jobKind: "job-search.monitor-run-now",
    idempotencyKey,
    params: { monitorId }
  });

  it("sweep runs a due monitor once; a second tick the same hour/day no-ops (idempotency proof)", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor());
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0));
    const first = await handler(sweepInput("job-search:sweep:1"));
    expect(first).toMatchObject({ status: "ok", checked: 1, ran: 1 });
    // Double-tick: same local day, slot consumed → due-check no-ops. No
    // second fetch, no second run record.
    const again = monitorRunHandler(makePorts(kv, okFetch, "2026-07-11T09:00:00.000Z"));
    const second = await again(sweepInput("job-search:sweep:2"));
    expect(second).toMatchObject({ status: "ok", checked: 1, ran: 0, skipped: 1 });
    expect((await listRuns(kv, "mon-1")).length).toBe(1);
  });

  it("sweep skips before the local due time", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor({ dueTime: "22:00" }));
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0)); // 08:00 UTC
    expect(await handler(sweepInput("k1"))).toMatchObject({ ran: 0, skipped: 1 });
    expect(await listRuns(kv, "mon-1")).toEqual([]);
  });

  it("sweep ignores disabled monitors", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor({ enabled: false }));
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0));
    expect(await handler(sweepInput("k1"))).toMatchObject({ checked: 0, ran: 0 });
  });

  it("sweep failure does not consume the slot: a later tick the same day retries", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor());
    await monitorRunHandler(makePorts(kv, failFetch, T0))(sweepInput("k1"));
    // 2h later (courtesy elapsed), fetch healthy again → runs the SAME day.
    const result = await monitorRunHandler(makePorts(kv, okFetch, "2026-07-11T10:00:00.000Z"))(
      sweepInput("k2")
    );
    expect(result).toMatchObject({ ran: 1 });
  });

  it("sweep isolates per-monitor failures (one bad monitor never aborts the rest)", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor({ monitorId: "mon-bad", adapterId: "greenhouse" }));
    // Corrupt the stored query so validateConfig throws at run time.
    const bad = await getMonitor(kv, "mon-bad");
    await saveMonitor(kv, { ...(bad as MonitorConfig), query: { board: "NOT A TOKEN!!" } });
    await saveMonitor(kv, monitor({ monitorId: "mon-good" }));
    const result = await monitorRunHandler(makePorts(kv, okFetch, T0))(sweepInput("k1"));
    expect(result).toMatchObject({ checked: 2, ran: 1, failed: 1 });
  });

  it("run-now runs immediately without consuming the daily slot", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor());
    const runNow = await monitorRunHandler(makePorts(kv, okFetch, "2026-07-11T05:00:00.000Z"))(
      runNowInput("manual:1", "mon-1")
    );
    expect(runNow).toMatchObject({ status: "ok", ran: true });
    // The scheduled sweep at 08:00 still runs today — run-now is additive.
    const sweep = await monitorRunHandler(makePorts(kv, okFetch, T0))(sweepInput("k1"));
    expect(sweep).toMatchObject({ ran: 1 });
  });

  it("run-now respects courtesy (compliance floor applies to manual runs too)", async () => {
    const kv = createMemoryKv();
    await saveMonitor(kv, monitor());
    await monitorRunHandler(makePorts(kv, okFetch, T0))(runNowInput("manual:1", "mon-1"));
    const second = await monitorRunHandler(makePorts(kv, okFetch, "2026-07-11T08:10:00.000Z"))(
      runNowInput("manual:2", "mon-1")
    );
    expect(second).toMatchObject({ status: "ok", ran: false, reason: "courtesy_not_due" });
    expect((await listRuns(kv, "mon-1")).length).toBe(1);
  });

  it("run-now rejects unknown and disabled monitors with fixed messages", async () => {
    const kv = createMemoryKv();
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0));
    expect(await handler(runNowInput("k1", "mon-x"))).toMatchObject({
      status: "error",
      code: "monitor_not_found"
    });
    await saveMonitor(kv, monitor({ enabled: false }));
    expect(await handler(runNowInput("k2", "mon-1"))).toMatchObject({
      status: "error",
      code: "monitor_disabled"
    });
  });

  it("rejects an unsupported jobKind naming the key only", async () => {
    const kv = createMemoryKv();
    const handler = monitorRunHandler(makePorts(kv, okFetch, T0));
    await expect(
      handler({ jobKind: "job-search.other", idempotencyKey: "k1", params: {} })
    ).rejects.toThrow("jobKind is not supported");
  });
});

// JS-07 (#936) Step 1: structured posting facts + sourceKey ride from the
// adapter's NormalizedPosting into the opportunities repo. sourceKey binds a
// record to (adapterId, board) so later freshness marking can scope
// absence-from-fetch to the board that was actually fetched.
describe("postingToOpportunity (JS-07 structured facts)", () => {
  it("maps publishedAt/workMode/employmentType/compensation and computes sourceKey", () => {
    const input = postingToOpportunity("greenhouse", "acme", {
      externalId: "101",
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/101",
      title: "Platform Engineer",
      company: "acme",
      locations: ["Remote"],
      workMode: "remote",
      employmentType: "Full-time",
      compensation: "$100k - $150k",
      publishedAt: "2026-07-01T00:00:00.000Z",
      description: "Build the platform.",
      descriptionTruncated: false
    });
    expect(input.sourceKey).toBe(sourceKey("greenhouse", "acme"));
    expect(input.posting).toMatchObject({
      publishedAt: "2026-07-01T00:00:00.000Z",
      workMode: "remote",
      employmentType: "Full-time",
      compensation: "$100k - $150k"
    });
  });

  it("omits absent facts rather than writing undefined placeholders", () => {
    const input = postingToOpportunity("greenhouse", "acme", {
      externalId: "102",
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/102",
      title: "Staff Engineer",
      company: "acme",
      locations: [],
      description: "Lead things.",
      descriptionTruncated: false
    });
    expect("publishedAt" in input.posting).toBe(false);
    expect("workMode" in input.posting).toBe(false);
    expect("employmentType" in input.posting).toBe(false);
    expect("compensation" in input.posting).toBe(false);
  });

  it("discovery run persists facts and sourceKey end-to-end", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await runMonitorDiscovery(makePorts(kv, okFetch, T0), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    const records = await listOpportunities(kv);
    const remote = records.find((r) => r.posting.title === "Platform Engineer");
    expect(remote?.sourceKey).toBe(sourceKey("greenhouse", "acme"));
    expect(remote?.posting.workMode).toBe("remote");
    expect(remote?.posting.publishedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

// JS-07 (#936) Step 7: the discovery run wires the full pipeline — freshness
// (this run's seen set, this board's sourceKey) after ingestion, retention,
// then gate + evaluation, then a feed rebuild so THIS run's evaluations rank
// this run's feed. Counts stay metadata-only (numbers keyed by fixed names).
describe("runMonitorDiscovery — JS-07 pipeline wiring", () => {
  const TODAY = "2026-07-11";
  const T2 = "2026-07-11T10:00:00.000Z"; // 2h later — greenhouse courtesy (1h) elapsed
  const T3 = "2026-07-11T12:00:00.000Z";

  // Same board with job 101's content changed (new contentHash → outdated eval).
  const changedPayload = {
    jobs: [
      { ...greenhousePayload.jobs[0], content: "&lt;p&gt;Build the NEW platform.&lt;/p&gt;" },
      greenhousePayload.jobs[1]
    ]
  };
  // Same board with job 102 absent (freshness: unseen on its own board → stale).
  const only101Payload = { jobs: [greenhousePayload.jobs[0]] };
  const fetchOf =
    (payload: unknown): AdapterFetch =>
    async () => ({ status: 200, bodyText: JSON.stringify(payload) });

  interface StubAi extends JobSearchAi {
    readonly calls: JobSearchAiInput[];
  }
  function stubAi(respond: (input: JobSearchAiInput) => JobSearchAiResult): StubAi {
    const calls: JobSearchAiInput[] = [];
    return {
      calls,
      async generateStructured(input) {
        calls.push(input);
        return respond(input);
      }
    };
  }
  function okAi(): StubAi {
    return stubAi(() => ({
      ok: true,
      object: {
        fitBand: "strong",
        recommendation: "review",
        evidence: [{ requirement: "TS", evidence: "8y TS", source: "resume" }],
        blockers: [],
        gaps: [],
        unknowns: [],
        preferenceMatches: [],
        preferenceConflicts: [],
        postingConfidence: "high",
        overallConfidence: "medium",
        summary: "Strong match."
      }
    }));
  }

  async function seedProfileAndResume(kv: MemoryKv): Promise<void> {
    const at = new Date("2026-07-10T00:00:00.000Z");
    await saveProfileRevision(kv, {
      schemaVersion: 1,
      revisionId: "profile-rev-1",
      createdAt: at.toISOString(),
      provenance: "user",
      fields: {}
    });
    await approveProfile(kv, "profile-rev-1", at);
    await saveOriginalResume(kv, "Resume: 8 years TypeScript.", at);
    await approveResume(kv, "0", at);
  }

  async function hashOf(kv: MemoryKv, title: string): Promise<string> {
    const record = (await listOpportunities(kv)).find((r) => r.posting.title === title);
    if (record === undefined) throw new Error("fixture record missing");
    return record.identityHash;
  }

  it("evaluates survivors, spends budget, extends counts, and the feed carries fit bands", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await seedProfileAndResume(kv);
    const ai = okAi();
    const outcome = await runMonitorDiscovery(makePorts(kv, okFetch, T0, ai), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    expect(outcome).toMatchObject({
      ran: true,
      counts: { evaluated: 2, evalPending: 0, gateExcluded: 0, staleMarked: 0 }
    });
    expect(ai.calls.length).toBe(2);
    expect(await readBudgetUsed(kv, TODAY)).toBe(2);
    const evaluation = await getEvaluation(kv, await hashOf(kv, "Platform Engineer"));
    expect(evaluation).toMatchObject({ fitBand: "strong", recommendation: "review" });
    // Feed was rebuilt AFTER evaluation: entries carry this run's bands. Tie
    // on e/b/c/freshness → newest posting first (102 published 07-02).
    const feed = await readFeed(kv);
    expect(feed?.entries.map((e) => ({ b: e.b, c: e.c, e: e.e }))).toEqual([
      { b: "s", c: "m", e: "e" },
      { b: "s", c: "m", e: "e" }
    ]);
    expect(feed?.entries[0]?.h).toBe(await hashOf(kv, "Staff Engineer"));
  });

  it("run-twice-identical produces exactly one evaluation per job (no AI re-calls)", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await seedProfileAndResume(kv);
    const ai = okAi();
    await runMonitorDiscovery(makePorts(kv, okFetch, T0, ai), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    const second = await runMonitorDiscovery(makePorts(kv, okFetch, T2, ai), config, {
      runId: "b".repeat(32),
      consumeSlot: false
    });
    expect(second).toMatchObject({ ran: true, counts: { evaluated: 0, evalPending: 0 } });
    expect(ai.calls.length).toBe(2); // both from the first run
    expect(await readBudgetUsed(kv, TODAY)).toBe(2);
  });

  it("changed posting content re-evaluates only the changed job", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await seedProfileAndResume(kv);
    const ai = okAi();
    await runMonitorDiscovery(makePorts(kv, okFetch, T0, ai), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    const hash101 = await hashOf(kv, "Platform Engineer");
    const before = await getEvaluation(kv, hash101);
    const second = await runMonitorDiscovery(
      makePorts(kv, fetchOf(changedPayload), T2, ai),
      config,
      { runId: "b".repeat(32), consumeSlot: false }
    );
    expect(second).toMatchObject({ ran: true, counts: { ingested: 1, evaluated: 1 } });
    expect(ai.calls.length).toBe(3);
    const after = await getEvaluation(kv, hash101);
    expect(after?.evaluationId).not.toBe(before?.evaluationId);
    expect(after?.inputs.opportunityContentHash).not.toBe(before?.inputs.opportunityContentHash);
  });

  it("AI failure leaves the prior evaluation intact and counts the job pending", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await seedProfileAndResume(kv);
    const ai = okAi();
    await runMonitorDiscovery(makePorts(kv, okFetch, T0, ai), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    const hash101 = await hashOf(kv, "Platform Engineer");
    const before = await getEvaluation(kv, hash101);
    const failingAi = stubAi(() => ({ ok: false, error: "provider_error" }));
    const second = await runMonitorDiscovery(
      makePorts(kv, fetchOf(changedPayload), T2, failingAi),
      config,
      { runId: "b".repeat(32), consumeSlot: false }
    );
    expect(second).toMatchObject({ ran: true, counts: { evaluated: 0, evalPending: 1 } });
    // Prior evaluation still stored, byte-for-byte identity fields intact.
    expect(await getEvaluation(kv, hash101)).toEqual(before);
  });

  it("absence from this board's fetch marks stale, gate-excludes, and ranks last in the feed", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await seedProfileAndResume(kv);
    const ai = okAi();
    await runMonitorDiscovery(makePorts(kv, okFetch, T0, ai), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    const second = await runMonitorDiscovery(
      makePorts(kv, fetchOf(only101Payload), T2, ai),
      config,
      { runId: "b".repeat(32), consumeSlot: false }
    );
    expect(second).toMatchObject({
      ran: true,
      counts: { staleMarked: 1, gateExcluded: 1, evaluated: 0, evalPending: 0 }
    });
    const hash102 = await hashOf(kv, "Staff Engineer");
    const record102 = (await listOpportunities(kv)).find((r) => r.identityHash === hash102);
    expect(record102).toMatchObject({ freshness: "stale", status: "stale" });
    const feed = await readFeed(kv);
    expect(feed?.entries.map((e) => e.h)).toEqual([await hashOf(kv, "Platform Engineer"), hash102]);
    expect(feed?.entries[1]?.e).toBe("x");
    // Freshness never regresses on a later identical run either: re-seen 101
    // stays active and stale 102 stays stale without re-counting.
    const third = await runMonitorDiscovery(
      makePorts(kv, fetchOf(only101Payload), T3, ai),
      config,
      {
        runId: "c".repeat(32),
        consumeSlot: false
      }
    );
    expect(third).toMatchObject({ ran: true, counts: { staleMarked: 0 } });
  });

  it("no AI bridge: survivors stay pending and no budget is spent", async () => {
    const kv = createMemoryKv();
    const config = monitor();
    await saveMonitor(kv, config);
    await seedProfileAndResume(kv);
    const outcome = await runMonitorDiscovery(makePorts(kv, okFetch, T0, null), config, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    expect(outcome).toMatchObject({
      ran: true,
      counts: { evaluated: 0, evalPending: 2, gateExcluded: 0 }
    });
    expect(await readBudgetUsed(kv, TODAY)).toBe(0);
  });
});
