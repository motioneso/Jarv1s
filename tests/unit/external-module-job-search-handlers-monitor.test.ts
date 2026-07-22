// tests/unit/external-module-job-search-handlers-monitor.test.ts
//
// JS-03 (#932) Task 10: monitor config tools. The load-bearing rule is the
// enable gate — a monitor can only be saved enabled once BOTH an approved
// resume and an approved profile exist (spec: enablement is the last
// checkpoint, after the user has reviewed real stored state). List responses
// are metadata-only: the query document never leaves via monitor.list.
//
// JS-04 (#933) Task 10: monitor.save additionally validates adapterId against
// the source-adapter registry (unknown/disabled → question naming the enabled
// ids) and persists the adapter-NORMALIZED board config — extra query keys
// never survive into storage.
//
// JS-10 (#1229): a submitted query.kind of "broad" routes to the discovery
// registry/validator instead — see the "monitor.save broad discovery branch"
// describe block below. The board-path tests above/below this comment must
// stay passing unmodified: the broad branch is strictly additive.
import { describe, expect, it } from "vitest";

import {
  approveProfile,
  approveResume,
  getMonitor,
  saveMonitorCursor,
  saveOriginalResume,
  saveProfileRevision
} from "../../external-modules/job-search/src/domain/index.js";
import type { WorkerPorts } from "../../external-modules/job-search/src/worker/ai-port.js";
import {
  getMonitorHandler,
  listMonitorsHandler,
  saveMonitorHandler
} from "../../external-modules/job-search/src/worker/handlers/monitor.js";
import { approveResumeHandler } from "../../external-modules/job-search/src/worker/handlers/resume.js";
import { approveProfileHandler } from "../../external-modules/job-search/src/worker/handlers/profile.js";
import { getStateHandler } from "../../external-modules/job-search/src/worker/handlers/onboarding.js";
import { wrap } from "../../external-modules/job-search/src/worker/wrap.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";
import type { MemoryKv } from "./helpers/job-search-memory-kv.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");
const LATER = new Date("2026-07-11T13:30:00.000Z");

/** Clock is injectable so the createdAt/updatedAt tests can move time. */
const portsAt = (kv: MemoryKv, now: Date): WorkerPorts => ({
  kv,
  ai: null,
  now: () => now
});

// A valid greenhouse board config — monitor.save now round-trips the query
// through adapter.validateConfig, so fixtures must be real board configs.
const QUERY = { board: "gitlab" };

/** Seed + approve resume and profile via the domain (pointer-level truth). */
async function approveBoth(kv: MemoryKv): Promise<void> {
  await saveOriginalResume(kv, "Line one", NOW);
  await approveResume(kv, "0", NOW);
  await saveProfileRevision(kv, {
    schemaVersion: 1,
    revisionId: "p1",
    createdAt: NOW.toISOString(),
    provenance: "user",
    fields: { targetTitles: ["Staff Engineer"] }
  });
  await approveProfile(kv, "p1", NOW);
}

describe("monitor.save handler", () => {
  it("enabled save with neither approval: question naming BOTH gaps, nothing persisted", async () => {
    const kv = createMemoryKv();
    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY,
      enabled: true
    });
    expect(result.status).toBe("question");
    expect(result.question).toMatch(/resume/i);
    expect(result.question).toMatch(/profile/i);
    expect(kv.dump().size).toBe(0);
  });

  it("enabled save with resume approved but no profile: question names the profile only", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, "Line one", NOW);
    await approveResume(kv, "0", NOW);
    const before = kv.dump();
    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY,
      enabled: true
    });
    expect(result.status).toBe("question");
    expect(result.question).not.toMatch(/resume/i);
    expect(result.question).toMatch(/profile/i);
    expect(kv.dump()).toEqual(before);
  });

  it("disabled save persists without approvals: sources_schedule complete, review_enable NOT", async () => {
    const kv = createMemoryKv();
    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY
    });
    expect(result).toEqual({
      status: "ok",
      monitorId: "m1",
      enabled: false,
      timezone: "UTC",
      dueTime: "07:00"
    });
    const stored = await getMonitor(kv, "m1");
    expect(stored).toEqual({
      schemaVersion: 1,
      monitorId: "m1",
      adapterId: "greenhouse",
      enabled: false,
      query: QUERY,
      timezone: "UTC",
      dueTime: "07:00",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    });
    const state = await getStateHandler(portsAt(kv, NOW))({});
    const completed = state.completed as Record<string, boolean>;
    expect(completed["sources_schedule"]).toBe(true);
    expect(completed["review_enable"]).toBeUndefined();
  });

  it("after both approvals an enabled save persists, review_enable completes, step is done", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, "Line one", NOW);
    // Approvals go through the HANDLERS so the onboarding flags advance the
    // same way they do in production (domain approve moves pointers only).
    await approveResumeHandler(portsAt(kv, NOW))({ revisionId: "0" });
    await saveProfileRevision(kv, {
      schemaVersion: 1,
      revisionId: "p1",
      createdAt: NOW.toISOString(),
      provenance: "user",
      fields: { targetTitles: ["Staff Engineer"] }
    });
    await approveProfileHandler(portsAt(kv, NOW))({ revisionId: "p1" });

    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY,
      enabled: true
    });
    expect(result).toEqual({
      status: "ok",
      monitorId: "m1",
      enabled: true,
      timezone: "UTC",
      dueTime: "07:00"
    });
    expect((await getMonitor(kv, "m1"))?.enabled).toBe(true);
    const state = await getStateHandler(portsAt(kv, NOW))({});
    expect(state.step).toBe("done");
    expect((state.completed as Record<string, boolean>)["review_enable"]).toBe(true);
    expect((state.gates as Record<string, boolean>)["monitorEnabled"]).toBe(true);
  });

  it("update preserves createdAt and refreshes updatedAt", async () => {
    const kv = createMemoryKv();
    await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY
    });
    await saveMonitorHandler(portsAt(kv, LATER))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: { board: "acme" }
    });
    const stored = await getMonitor(kv, "m1");
    expect(stored?.createdAt).toBe(NOW.toISOString());
    expect(stored?.updatedAt).toBe(LATER.toISOString());
    expect(stored?.query).toEqual({ board: "acme" });
  });

  it("disabling an enabled monitor is always allowed (no gate on the way down)", async () => {
    const kv = createMemoryKv();
    await approveBoth(kv);
    await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY,
      enabled: true
    });
    const result = await saveMonitorHandler(portsAt(kv, LATER))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY,
      enabled: false
    });
    expect(result).toEqual({
      status: "ok",
      monitorId: "m1",
      enabled: false,
      timezone: "UTC",
      dueTime: "07:00"
    });
    expect((await getMonitor(kv, "m1"))?.enabled).toBe(false);
  });

  it("unknown adapterId: question names the enabled adapter ids, nothing persisted", async () => {
    const kv = createMemoryKv();
    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "linkedin",
      query: QUERY
    });
    expect(result.status).toBe("question");
    const question = result.question as string;
    expect(question).toContain("greenhouse");
    expect(question).toContain("lever");
    expect(question).toContain("ashby");
    expect(kv.dump().size).toBe(0);
  });

  it("invalid board config: invalid_input envelope naming the constraint, nothing persisted", async () => {
    const kv = createMemoryKv();
    const result = await wrap(saveMonitorHandler(portsAt(kv, NOW)))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: { board: "a/b" }
    });
    expect(result.status).toBe("error");
    expect(result.code).toBe("invalid_input");
    // Constraint only — the hostile value itself is never echoed.
    expect(result.message).not.toContain("a/b");
    expect(kv.dump().size).toBe(0);
  });

  it("persists the NORMALIZED query exactly — extra keys do not survive", async () => {
    const kv = createMemoryKv();
    await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: { board: "gitlab", titles: ["Staff Engineer"], locations: ["remote"] }
    });
    expect((await getMonitor(kv, "m1"))?.query).toEqual({ board: "gitlab" });
  });

  it("rejects a missing monitorId/adapterId/query by name", async () => {
    const kv = createMemoryKv();
    const ports = portsAt(kv, NOW);
    const noId = await wrap(saveMonitorHandler(ports))({ adapterId: "greenhouse", query: QUERY });
    expect(noId.status).toBe("error");
    expect(noId.message).toMatch(/monitorId/);
    const noAdapter = await wrap(saveMonitorHandler(ports))({ monitorId: "m1", query: QUERY });
    expect(noAdapter.status).toBe("error");
    expect(noAdapter.message).toMatch(/adapterId/);
    const noQuery = await wrap(saveMonitorHandler(ports))({
      monitorId: "m1",
      adapterId: "greenhouse"
    });
    expect(noQuery.status).toBe("error");
    expect(noQuery.message).toMatch(/query/);
    expect(kv.dump().size).toBe(0);
  });
});

// JS-10 (#1229): the broad discovery branch — a submitted query.kind of
// "broad" must route to getDiscoveryProvider/parseBroadQuery instead of the
// board adapter registry, and persist the outbound-minimized DiscoveryQuery
// plus the kind discriminator. Every board-path test above stays unmodified,
// which is itself the proof the two branches don't interfere.
describe("monitor.save broad discovery branch", () => {
  const BROAD_QUERY = {
    kind: "broad" as const,
    titles: ["Staff Engineer", "Principal Engineer"],
    locations: ["Remote"],
    remote: true,
    country: "us",
    maxResults: 50
  };

  it("persists query.kind:'broad' plus the parsed DiscoveryQuery, nothing extra", async () => {
    const kv = createMemoryKv();
    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "freehire",
      query: BROAD_QUERY
    });
    expect(result).toEqual({
      status: "ok",
      monitorId: "m1",
      enabled: false,
      timezone: "UTC",
      dueTime: "07:00"
    });
    const stored = await getMonitor(kv, "m1");
    expect(stored).toEqual({
      schemaVersion: 1,
      monitorId: "m1",
      adapterId: "freehire",
      enabled: false,
      query: {
        kind: "broad",
        titles: ["Staff Engineer", "Principal Engineer"],
        locations: ["Remote"],
        remote: true,
        country: "us",
        maxResults: 50
      },
      timezone: "UTC",
      dueTime: "07:00",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    });
  });

  it("outbound minimization: salary/dealbreakers/company/employmentType never reach storage", async () => {
    const kv = createMemoryKv();
    await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "freehire",
      query: {
        kind: "broad",
        titles: ["Staff Engineer"],
        locations: ["Remote"],
        country: "us",
        // These must all be dropped by parseBroadQuery — never stored, never
        // able to leave via buildRequests (spec AC5).
        salary: { min: 200000 },
        dealbreakers: ["no on-call"],
        company: "Acme",
        employmentType: "full-time"
      }
    });
    const stored = await getMonitor(kv, "m1");
    expect(Object.keys(stored!.query).sort()).toEqual([
      "country",
      "kind",
      "locations",
      "maxResults",
      "titles"
    ]);
  });

  it("rejects an unknown/disabled discovery provider: question names enabled providers, nothing persisted", async () => {
    const kv = createMemoryKv();
    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "indeed",
      query: BROAD_QUERY
    });
    expect(result.status).toBe("question");
    expect(result.question).toContain("freehire");
    expect(kv.dump().size).toBe(0);
  });

  it("rejects a broad query with no titles: invalid_input, nothing persisted", async () => {
    const kv = createMemoryKv();
    const result = await wrap(saveMonitorHandler(portsAt(kv, NOW)))({
      monitorId: "m1",
      adapterId: "freehire",
      query: { kind: "broad", titles: [], country: "us" }
    });
    expect(result.status).toBe("error");
    expect(result.code).toBe("invalid_input");
    expect(kv.dump().size).toBe(0);
  });

  it("respects the same enable gate as the board path (missing approvals blocks enabled save)", async () => {
    const kv = createMemoryKv();
    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "freehire",
      query: BROAD_QUERY,
      enabled: true
    });
    expect(result.status).toBe("question");
    expect(result.question).toMatch(/resume/i);
    expect(result.question).toMatch(/profile/i);
    expect(kv.dump().size).toBe(0);
  });

  it("after both approvals an enabled broad save persists and completes onboarding", async () => {
    const kv = createMemoryKv();
    // Approvals go through the HANDLERS (not the approveBoth domain helper)
    // so the onboarding checkpoint flags advance the same way they do in
    // production — mirrors the equivalent board-path test above.
    await saveOriginalResume(kv, "Line one", NOW);
    await approveResumeHandler(portsAt(kv, NOW))({ revisionId: "0" });
    await saveProfileRevision(kv, {
      schemaVersion: 1,
      revisionId: "p1",
      createdAt: NOW.toISOString(),
      provenance: "user",
      fields: { targetTitles: ["Staff Engineer"] }
    });
    await approveProfileHandler(portsAt(kv, NOW))({ revisionId: "p1" });

    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "freehire",
      query: BROAD_QUERY,
      enabled: true
    });
    expect(result.status).toBe("ok");
    expect((await getMonitor(kv, "m1"))?.enabled).toBe(true);
    const state = await getStateHandler(portsAt(kv, NOW))({});
    expect(state.step).toBe("done");
  });

  it("board path is unaffected: no kind (or kind !== 'broad') still resolves via the board adapter registry", async () => {
    const kv = createMemoryKv();
    // Absent kind: existing board behavior, byte-for-byte.
    const noKind = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY
    });
    expect(noKind.status).toBe("ok");
    expect((await getMonitor(kv, "m1"))?.query).toEqual(QUERY);

    // Explicit non-"broad" kind: still routes to the board adapter, which
    // silently drops the unrecognized key the same way validateConfig always
    // has (see "persists the NORMALIZED query exactly" above).
    const wrongKind = await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m2",
      adapterId: "greenhouse",
      query: { ...QUERY, kind: "board" }
    });
    expect(wrongKind.status).toBe("ok");
    expect((await getMonitor(kv, "m2"))?.query).toEqual(QUERY);
  });
});

describe("monitor.list handler", () => {
  it("items carry exactly the seven metadata keys — the query document never leaks", async () => {
    const kv = createMemoryKv();
    await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY
    });
    // companyName survives normalization, so the leak assertion still bites.
    await saveMonitorHandler(portsAt(kv, LATER))({
      monitorId: "m2",
      adapterId: "lever",
      query: { board: "leverdemo", companyName: "do-not-leak" }
    });
    const result = await listMonitorsHandler(portsAt(kv, NOW))({});
    expect(result.status).toBe("ok");
    const monitors = result.monitors as Record<string, unknown>[];
    expect(monitors).toHaveLength(2);
    for (const item of monitors) {
      expect(Object.keys(item).sort()).toEqual([
        "adapterId",
        "createdAt",
        "dueTime",
        "enabled",
        "monitorId",
        "timezone",
        "updatedAt"
      ]);
    }
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
  });

  it("empty list is ok with no items", async () => {
    const kv = createMemoryKv();
    const result = await listMonitorsHandler(portsAt(kv, NOW))({});
    expect(result).toEqual({ status: "ok", monitors: [] });
  });
});

describe("monitor.get handler", () => {
  it("returns the full config plus cursor TIMESTAMPS only (never the cursor document)", async () => {
    const kv = createMemoryKv();
    await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY
    });
    await saveMonitorCursor(kv, {
      schemaVersion: 1,
      monitorId: "m1",
      cursor: { lastSeenPostingId: "cursor-secret" },
      lastCheckedAt: LATER.toISOString(),
      lastSuccessAt: LATER.toISOString()
    });
    const result = await getMonitorHandler(portsAt(kv, NOW))({ monitorId: "m1" });
    expect(result.status).toBe("ok");
    expect(result.monitorId).toBe("m1");
    expect(result.adapterId).toBe("greenhouse");
    expect(result.enabled).toBe(false);
    expect(result.query).toEqual(QUERY);
    expect(result.cursor).toEqual({
      lastCheckedAt: LATER.toISOString(),
      lastSuccessAt: LATER.toISOString()
    });
    expect(JSON.stringify(result)).not.toContain("cursor-secret");
  });

  it("omits cursor when the monitor has never been scanned", async () => {
    const kv = createMemoryKv();
    await saveMonitorHandler(portsAt(kv, NOW))({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: QUERY
    });
    const result = await getMonitorHandler(portsAt(kv, NOW))({ monitorId: "m1" });
    expect(result.cursor).toBeUndefined();
  });

  it("unknown monitor id: missing_record error", async () => {
    const kv = createMemoryKv();
    const result = await wrap(getMonitorHandler(portsAt(kv, NOW)))({ monitorId: "nope" });
    expect(result.status).toBe("error");
    expect(result.code).toBe("missing_record");
  });
});

// JS-05 (#934): per-monitor schedule fields. Optional on save (defaults
// UTC/07:00), preserved when omitted on update, echoed by save/get/list.
describe("monitor.save schedule fields (JS-05)", () => {
  const SAVE_INPUT = { monitorId: "m1", adapterId: "greenhouse", query: QUERY };

  it("persists and echoes timezone and dueTime", async () => {
    const kv = createMemoryKv();
    const result = await saveMonitorHandler(portsAt(kv, NOW))({
      ...SAVE_INPUT,
      timezone: "America/New_York",
      dueTime: "06:30"
    });
    expect(result).toMatchObject({
      status: "ok",
      timezone: "America/New_York",
      dueTime: "06:30"
    });
    const got = await getMonitorHandler(portsAt(kv, NOW))({ monitorId: "m1" });
    expect(got).toMatchObject({ timezone: "America/New_York", dueTime: "06:30" });
  });

  it("defaults timezone/dueTime to UTC/07:00 when omitted", async () => {
    const kv = createMemoryKv();
    const result = await saveMonitorHandler(portsAt(kv, NOW))({ ...SAVE_INPUT });
    expect(result).toMatchObject({ status: "ok", timezone: "UTC", dueTime: "07:00" });
  });

  it("preserves previously saved timezone/dueTime when omitted on update", async () => {
    const kv = createMemoryKv();
    await saveMonitorHandler(portsAt(kv, NOW))({
      ...SAVE_INPUT,
      timezone: "America/New_York",
      dueTime: "06:30"
    });
    const result = await saveMonitorHandler(portsAt(kv, LATER))({ ...SAVE_INPUT });
    expect(result).toMatchObject({ timezone: "America/New_York", dueTime: "06:30" });
  });

  it("echoes defaults from monitor.list items", async () => {
    const kv = createMemoryKv();
    await saveMonitorHandler(portsAt(kv, NOW))({ ...SAVE_INPUT });
    const result = await listMonitorsHandler(portsAt(kv, NOW))({});
    const monitors = result.monitors as Record<string, unknown>[];
    expect(monitors[0]).toMatchObject({ timezone: "UTC", dueTime: "07:00" });
  });

  it("rejects a non-IANA timezone naming key+constraint only", async () => {
    const kv = createMemoryKv();
    const result = await wrap(saveMonitorHandler(portsAt(kv, NOW)))({
      ...SAVE_INPUT,
      timezone: "Mars/Olympus"
    });
    expect(result.status).toBe("error");
    expect(result.code).toBe("invalid_input");
    expect(result.message).toBe("timezone must be a valid IANA time zone");
    // Constraint only — the hostile value itself is never echoed.
    expect(JSON.stringify(result)).not.toContain("Mars/Olympus");
    expect(kv.dump().size).toBe(0);
  });

  it("rejects a malformed dueTime naming key+constraint only", async () => {
    const kv = createMemoryKv();
    const result = await wrap(saveMonitorHandler(portsAt(kv, NOW)))({
      ...SAVE_INPUT,
      dueTime: "7am"
    });
    expect(result.status).toBe("error");
    expect(result.code).toBe("invalid_input");
    expect(result.message).toBe("dueTime must be HH:MM (24-hour)");
    expect(JSON.stringify(result)).not.toContain("7am");
    expect(kv.dump().size).toBe(0);
  });
});
