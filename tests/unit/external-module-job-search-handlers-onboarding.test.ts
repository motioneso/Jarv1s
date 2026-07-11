// tests/unit/external-module-job-search-handlers-onboarding.test.ts
//
// JS-03 (#932) Task 4: onboarding flow engine (deriveStep/updateOnboarding).
// Task 5 extends this file with the onboarding.get-state handler suite.
// The flow engine is the only writer of OnboardingState in JS-03; these tests
// pin the six-checkpoint order, forward-only flag merging (backward movement
// never deletes approved history — spec), and that the JS-02 unknown-key
// privacy guard stays on the write path (pasted resume text can never ride
// along in the progress record).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  JobSearchKvError,
  NS,
  approveProfile,
  approveResume,
  getOnboardingState,
  keys,
  saveMonitor,
  saveOriginalResume,
  saveProfileRevision
} from "../../external-modules/job-search/src/domain/index.js";
import type {
  JobSearchAi,
  WorkerPorts
} from "../../external-modules/job-search/src/worker/ai-port.js";
import {
  STEP_ORDER,
  deriveStep,
  updateOnboarding
} from "../../external-modules/job-search/src/worker/handlers/flow.js";
import {
  getMonitorHandler,
  listMonitorsHandler,
  saveMonitorHandler
} from "../../external-modules/job-search/src/worker/handlers/monitor.js";
import { getStateHandler } from "../../external-modules/job-search/src/worker/handlers/onboarding.js";
import {
  approveProfileHandler,
  getProfileHandler,
  saveProfileDraftHandler
} from "../../external-modules/job-search/src/worker/handlers/profile.js";
import {
  approveResumeHandler,
  getResumeHandler,
  saveResumeDraftHandler
} from "../../external-modules/job-search/src/worker/handlers/resume.js";
import { monitorRunHandler } from "../../external-modules/job-search/src/worker/handlers/run.js";
import { HANDLERS } from "../../external-modules/job-search/src/worker/registry.js";
import { wrap } from "../../external-modules/job-search/src/worker/wrap.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";
import type { MemoryKv } from "./helpers/job-search-memory-kv.js";

const portsFor = (kv: MemoryKv): WorkerPorts => ({
  kv,
  ai: null,
  now: () => new Date("2026-07-11T12:00:00.000Z")
});

describe("STEP_ORDER", () => {
  it("is the six spec checkpoints in onboarding order", () => {
    expect(STEP_ORDER).toEqual([
      "resume_intake",
      "resume_critique",
      "resume_approval",
      "profile",
      "sources_schedule",
      "review_enable"
    ]);
  });
});

describe("deriveStep", () => {
  it("returns the first checkpoint when nothing is complete", () => {
    expect(deriveStep({})).toBe("resume_intake");
  });

  it("returns the first incomplete checkpoint", () => {
    expect(deriveStep({ resume_intake: true })).toBe("resume_critique");
    expect(deriveStep({ resume_intake: true, resume_critique: true, resume_approval: true })).toBe(
      "profile"
    );
  });

  it("skips flags recorded false and unknown flags alike", () => {
    // false is not complete; unknown keys must not shift the derived step.
    expect(deriveStep({ resume_intake: false, bogus_step: true })).toBe("resume_intake");
  });

  it("returns done once all six checkpoints are complete", () => {
    const completed = Object.fromEntries(STEP_ORDER.map((step) => [step, true]));
    expect(deriveStep(completed)).toBe("done");
  });
});

describe("updateOnboarding", () => {
  it("creates the initial record on first call and stores the derived step", async () => {
    const kv = createMemoryKv();
    const state = await updateOnboarding(kv, { complete: ["resume_intake"] });
    expect(state).toEqual({
      schemaVersion: 1,
      step: "resume_critique",
      completed: { resume_intake: true }
    });
    // Round-trips through the JS-02 repo — the returned state IS the stored state.
    expect(await getOnboardingState(kv)).toEqual(state);
  });

  it("an empty patch on a fresh kv persists the initial state", async () => {
    const kv = createMemoryKv();
    const state = await updateOnboarding(kv, {});
    expect(state).toEqual({ schemaVersion: 1, step: "resume_intake", completed: {} });
    expect(await getOnboardingState(kv)).toEqual(state);
  });

  it("merges complete flags monotonically — later patches never unset earlier ones", async () => {
    const kv = createMemoryKv();
    await updateOnboarding(kv, { complete: ["resume_intake", "resume_critique"] });
    const state = await updateOnboarding(kv, { complete: ["resume_approval"] });
    expect(state.completed).toEqual({
      resume_intake: true,
      resume_critique: true,
      resume_approval: true
    });
    expect(state.step).toBe("profile");
    // An empty patch is a pure re-derive — nothing lost.
    const unchanged = await updateOnboarding(kv, {});
    expect(unchanged).toEqual(state);
  });

  it("persists approved revision ids and keeps them across later patches", async () => {
    const kv = createMemoryKv();
    await updateOnboarding(kv, {
      complete: ["resume_intake"],
      approvedResumeRevisionId: "0"
    });
    const state = await updateOnboarding(kv, {
      complete: ["profile"],
      approvedProfileRevisionId: "p1"
    });
    expect(state.approvedResumeRevisionId).toBe("0");
    expect(state.approvedProfileRevisionId).toBe("p1");
    expect(await getOnboardingState(kv)).toEqual(state);
  });

  it("fails closed on a poisoned stored record — the JS-02 unknown-key guard is the write path", async () => {
    const kv = createMemoryKv();
    // Adversarial seed: bypass the repo and plant an extra key next to valid state.
    await kv.set(NS.onboarding, keys.onboardingState, {
      schemaVersion: 1,
      step: "resume_intake",
      completed: {},
      resumeText: "My whole resume..."
    });
    const error = await updateOnboarding(kv, { complete: ["resume_intake"] }).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("invalid_record");
  });
});

describe("onboarding.get-state handler", () => {
  it("fresh user: first step, nothing completed, all gates closed", async () => {
    const kv = createMemoryKv();
    const result = await getStateHandler(portsFor(kv))({});
    expect(result).toEqual({
      status: "ok",
      step: "resume_intake",
      completed: {},
      gates: { resumeApproved: false, profileApproved: false, monitorEnabled: false }
    });
  });

  it("all gates open once resume + profile are approved and a monitor is enabled", async () => {
    const kv = createMemoryKv();
    const now = new Date("2026-07-11T12:00:00.000Z");
    // Content markers below are what the leak sweep greps for.
    await saveOriginalResume(kv, "RESUME-CONTENT-MARKER worked at Initech", now);
    await approveResume(kv, "0", now);
    await saveProfileRevision(kv, {
      schemaVersion: 1,
      revisionId: "p1",
      createdAt: now.toISOString(),
      provenance: "user",
      fields: { role: "PROFILE-FIELD-MARKER staff engineer" }
    });
    await approveProfile(kv, "p1", now);
    await saveMonitor(kv, {
      schemaVersion: 1,
      monitorId: "m1",
      adapterId: "web-search",
      enabled: true,
      query: { terms: "MONITOR-QUERY-MARKER" },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    await updateOnboarding(kv, {
      complete: [...STEP_ORDER],
      approvedResumeRevisionId: "0",
      approvedProfileRevisionId: "p1"
    });

    const result = await getStateHandler(portsFor(kv))({});
    expect(result).toEqual({
      status: "ok",
      step: "done",
      completed: Object.fromEntries(STEP_ORDER.map((step) => [step, true])),
      gates: { resumeApproved: true, profileApproved: true, monitorEnabled: true },
      approvedResumeRevisionId: "0",
      approvedProfileRevisionId: "p1"
    });
    // Leak sweep: progress responses carry ids and flags only, never the
    // resume text, profile field values, or monitor query.
    const json = JSON.stringify(result);
    expect(json).not.toContain("RESUME-CONTENT-MARKER");
    expect(json).not.toContain("PROFILE-FIELD-MARKER");
    expect(json).not.toContain("MONITOR-QUERY-MARKER");
  });

  it("a disabled monitor does not open the monitorEnabled gate", async () => {
    const kv = createMemoryKv();
    const now = new Date("2026-07-11T12:00:00.000Z");
    await saveMonitor(kv, {
      schemaVersion: 1,
      monitorId: "m1",
      adapterId: "web-search",
      enabled: false,
      query: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    const result = await getStateHandler(portsFor(kv))({});
    expect((result.gates as Record<string, boolean>).monitorEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 10: six-checkpoint walkthrough, provider-leak sweep, registry isolation
// ---------------------------------------------------------------------------

describe("six-checkpoint walkthrough (durable checkpoint resume)", () => {
  it("walks paste → critique → approve → profile → approve → monitor → enable, re-deriving state from kv after every step", async () => {
    const kv = createMemoryKv();
    const now = new Date("2026-07-11T12:00:00.000Z");
    const ports: WorkerPorts = { kv, ai: null, now: () => now };
    // State is re-read through a FRESH handler instance over the same kv at
    // every step — the checkpoint survives a worker restart because it lives
    // in kv, never in handler memory.
    const stepNow = async (): Promise<string> => {
      const state = await getStateHandler({ kv, ai: null, now: () => now })({});
      return state.step as string;
    };

    expect(await stepNow()).toBe("resume_intake");

    // 1. paste the original resume
    await saveResumeDraftHandler(ports)({
      mode: "manual",
      content: "Shipped the Initech migration"
    });
    expect(await stepNow()).toBe("resume_critique");

    // 2. AI critique with a sourced claim (fake ai)
    const ai: JobSearchAi = {
      generateStructured: async () => ({
        ok: true as const,
        object: {
          critiqueSummary: "tightened",
          // Must EQUAL a whole line of the pasted original — the
          // whole-segment coverage guard (verdict B, #932) rejects reworded
          // or shortened lines.
          proposedMarkdown: "Shipped the Initech migration",
          materialClaims: [
            {
              kind: "outcome",
              text: "Shipped the Initech migration",
              quote: "Shipped the Initech migration"
            }
          ]
        }
      })
    };
    const critique = await saveResumeDraftHandler({ kv, ai, now: () => now })({
      mode: "critique"
    });
    expect(critique.status).toBe("ok");
    expect(await stepNow()).toBe("resume_approval");

    // 3. approve the critiqued revision
    await approveResumeHandler(ports)({ revisionId: critique.revisionId as string });
    expect(await stepNow()).toBe("profile");

    // 4+5. profile draft (user provenance) then approve
    const draft = await saveProfileDraftHandler(ports)({
      provenance: "user",
      fields: { targetTitles: ["Staff Engineer"] }
    });
    expect(await stepNow()).toBe("profile"); // draft alone is not the checkpoint
    await approveProfileHandler(ports)({ revisionId: draft.revisionId as string });
    expect(await stepNow()).toBe("sources_schedule");

    // 6a. save a disabled monitor (JS-04: adapterId + query must be a real
    // registry adapter and a valid board config — monitor.save validates)
    await saveMonitorHandler(ports)({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: { board: "gitlab" }
    });
    expect(await stepNow()).toBe("review_enable");

    // 6b. enable it — onboarding done
    await saveMonitorHandler(ports)({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: { board: "gitlab" },
      enabled: true
    });
    expect(await stepNow()).toBe("done");

    // Backward movement after enable: a new critique draft changes NOTHING
    // about flags, pointers, or history.
    const before = await getStateHandler(ports)({});
    const again = await saveResumeDraftHandler({ kv, ai, now: () => now })({
      mode: "critique"
    });
    expect(again.status).toBe("ok");
    const after = await getStateHandler(ports)({});
    expect(after).toEqual(before);
    expect(await stepNow()).toBe("done");
  });
});

describe("provider-leak sweep", () => {
  it("no implemented handler response ever names a provider or model", async () => {
    const PROVIDER_RE = /anthropic|openai|claude|gpt-|gemini|sonnet|opus/i;
    const now = new Date("2026-07-11T12:00:00.000Z");
    const results: unknown[] = [];
    const run = async (result: unknown): Promise<void> => {
      results.push(result);
    };

    // ok / question / error scenarios across every implemented handler.
    const kv = createMemoryKv();
    const ports: WorkerPorts = { kv, ai: null, now: () => now };
    await run(await getStateHandler(ports)({}));
    await run(await getResumeHandler(ports)({})); // question: no resume
    await run(await getProfileHandler(ports)({}));
    await run(await listMonitorsHandler(ports)({}));
    await run(await wrap(getResumeHandler(ports))({ revisionId: "nope" })); // error
    await run(await wrap(getMonitorHandler(ports))({ monitorId: "nope" })); // error
    await run(await wrap(approveProfileHandler(ports))({ revisionId: "nope" })); // error
    await run(await wrap(approveResumeHandler(ports))({ revisionId: "nope" })); // error
    await run(await wrap(saveMonitorHandler(ports))({})); // input error
    // ai unavailable question — the seam most tempted to name a provider
    await run(await saveResumeDraftHandler(ports)({ mode: "critique" }));

    await saveResumeDraftHandler(ports)({ mode: "manual", content: "Shipped the migration" });
    // gate question (no profile yet) — valid adapter+query so the enable
    // gate (not adapter validation) is what answers
    await run(
      await saveMonitorHandler(ports)({
        monitorId: "m1",
        adapterId: "greenhouse",
        query: { board: "gitlab" },
        enabled: true
      })
    );
    // unknown-adapter question (JS-04) — names registry ids, never providers
    await run(
      await saveMonitorHandler(ports)({
        monitorId: "m1",
        adapterId: "boards",
        query: { board: "gitlab" }
      })
    );
    // unsupported-claim question + provider_error question via fake ai
    const fabricating: JobSearchAi = {
      generateStructured: async () => ({
        ok: true as const,
        object: {
          critiqueSummary: "puffed",
          proposedMarkdown: "CEO of Initech",
          materialClaims: [{ kind: "role", text: "CEO of Initech", quote: "CEO of Initech" }]
        }
      })
    };
    await run(
      await saveResumeDraftHandler({ kv, ai: fabricating, now: () => now })({ mode: "critique" })
    );
    const failing: JobSearchAi = {
      generateStructured: async () => ({ ok: false as const, error: "provider_error" })
    };
    await run(
      await saveResumeDraftHandler({ kv, ai: failing, now: () => now })({ mode: "critique" })
    );
    // happy paths
    await run(await saveResumeDraftHandler(ports)({ mode: "manual", content: "Shipped it well" }));
    await run(
      await saveProfileDraftHandler(ports)({ provenance: "user", fields: { narrative: "x" } })
    );
    await run(
      await saveMonitorHandler(ports)({
        monitorId: "m1",
        adapterId: "greenhouse",
        query: { board: "gitlab" }
      })
    );
    await run(await getMonitorHandler(ports)({ monitorId: "m1" }));

    expect(results.length).toBeGreaterThanOrEqual(16);
    for (const result of results) {
      expect(JSON.stringify(result)).not.toMatch(PROVIDER_RE);
    }
  });
});

describe("monitor jobs cannot edit resume or profile", () => {
  it("monitor.run is wired to the dispatch handler; malformed input writes nothing", async () => {
    // JS-05 (#934): the stub became the real sweep/run-now dispatch. The
    // inertness guarantee this suite cares about survives as: a malformed
    // payload is rejected before ANY kv write (resume/profile untouched).
    expect(HANDLERS["monitor.run"]).toBe(monitorRunHandler);
    const kv = createMemoryKv();
    await expect(
      HANDLERS["monitor.run"]!({ kv, ai: null, now: () => new Date(0) })({})
    ).rejects.toThrow("jobKind");
    expect(kv.dump().size).toBe(0);
  });

  it("every spec tool key is present in the registry", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(
      [
        "onboarding.get-state",
        "profile.get",
        "profile.save-draft",
        "profile.approve",
        "resume.get",
        "resume.save-draft",
        "resume.approve",
        "monitor.list",
        "monitor.get",
        "monitor.save",
        "sources.list",
        "capture.paste",
        "capture.url",
        "opportunities.list",
        "opportunities.get",
        "opportunity.decide",
        "monitor.run"
      ].sort()
    );
  });

  it("handlers/monitor.ts has no import from the resume/profile/confirmation modules", () => {
    const source = readFileSync(
      new URL("../../external-modules/job-search/src/worker/handlers/monitor.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+"[^"]*handlers\/resume/);
    expect(source).not.toMatch(/from\s+"[^"]*handlers\/profile/);
    expect(source).not.toMatch(/from\s+"[^"]*confirmations/);
  });
});
