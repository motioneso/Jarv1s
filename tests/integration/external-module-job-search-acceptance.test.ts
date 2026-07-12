// tests/integration/external-module-job-search-acceptance.test.ts
//
// JS-09 (#938) Task 1 — module-level acceptance E2E. Everything before this
// suite proves slices in isolation; this suite proves the WHOLE life cycle on
// production composition with ZERO fake hashes:
//
//   real discovery (getExternalModuleRegistrations over the built module,
//   sha256 hashes computed from disk) → enabled row carrying those REAL
//   hashes → six onboarding checkpoints over the real RPC kv host →
//   scheduled sweep through the production job handler + spawned worker
//   process (fetch fixture injected at the rpc seam, everything else real)
//   → sentinel privacy scan over job payloads, worker logs, and derived kv
//   namespaces → same-day sweep idempotency → package-drift refusal.
//
// Privacy sentinels: unique strings seeded into the resume, the profile, and
// a monitor query (companyName of a DISABLED monitor — enabled-monitor
// companyName legitimately flows into postings, so the query sentinel rides
// a monitor the sweep must skip; that skip is itself asserted). The scan
// proves none of the three ever reaches job payloads, worker logs, or the
// runs/opportunities/feed namespaces, with positive controls proving the
// scan would catch a leak (each sentinel IS found where it was seeded).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Job } from "pg-boss";
import type { Kysely } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import type { ExternalModuleJobPayload } from "@jarv1s/jobs";
import {
  ExternalModuleWorkerRuntime,
  getExternalModuleRegistrations
} from "@jarv1s/module-registry/node";
import { createModuleCredentialSecretCipher } from "@jarv1s/settings";
import type { ExternalModuleDiscovery } from "../../packages/module-registry/src/external/types.js";

import {
  createExternalModuleJobHandler,
  type ExternalModuleJobHandlerDeps
} from "../../apps/worker/src/external-module-job-handler.js";
import { buildExternalModule } from "../../scripts/build-external-module.js";
import type { JobSearchKv } from "../../external-modules/job-search/src/domain/index.js";
import {
  getRunSummary,
  listOpportunities
} from "../../external-modules/job-search/src/domain/index.js";
import type {
  JobSearchAi,
  WorkerPorts
} from "../../external-modules/job-search/src/worker/ai-port.js";
import { saveMonitorHandler } from "../../external-modules/job-search/src/worker/handlers/monitor.js";
import { getStateHandler } from "../../external-modules/job-search/src/worker/handlers/onboarding.js";
import {
  approveProfileHandler,
  saveProfileDraftHandler
} from "../../external-modules/job-search/src/worker/handlers/profile.js";
import {
  approveResumeHandler,
  saveResumeDraftHandler
} from "../../external-modules/job-search/src/worker/handlers/resume.js";
import {
  bootstrapJobSearchRows,
  jobSearchSourceDir,
  kvForActor
} from "./job-search-rpc-harness.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// Manifest compatibility is ">=0.1.0"; the root package.json still says
// 0.0.0 (pre-release), so acceptance pins the shipped floor explicitly —
// the same value the fail-closed discovery suite uses.
const CORE_VERSION = "0.1.0";
const REAL_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

// Sentinels are structured like real content but globally unique, so a scan
// hit is unambiguous. They are the ONLY private-adjacent strings this suite
// seeds — everything else (fixture postings) is public board data.
const RESUME_SENTINEL = "JS09-ACCEPT-RESUME-SENTINEL-93d1c4";
const PROFILE_SENTINEL = "JS09-ACCEPT-PROFILE-SENTINEL-93d1c4";
const QUERY_SENTINEL = "JS09-ACCEPT-QUERY-SENTINEL-93d1c4";
const SENTINELS = [RESUME_SENTINEL, PROFILE_SENTINEL, QUERY_SENTINEL] as const;

// The critique stub must propose a WHOLE line of the pasted resume — the
// whole-segment coverage guard rejects reworded or partial lines.
const RESUME_LINE = `${RESUME_SENTINEL} worked at Initech.`;
const RESUME_CONTENT = `# Resume\n${RESUME_LINE}`;

// Namespaces derived from monitor runs — the surfaces the privacy scan
// sweeps for sentinel leakage (private inputs must never reach outputs).
const DERIVED_NAMESPACES = [
  "job-search.runs",
  "job-search.opportunities",
  "job-search.feed"
] as const;

// Fixture: real GitLab greenhouse board snapshot, 3 jobs.
const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/job-search/greenhouse-board.json", import.meta.url)
);
const FIXTURE_JOB_COUNT = 3;

// Known-valid evaluation object (mirrors the worker-evaluate unit fixture)
// so the queue-path ai bridge stub returns something the module accepts.
const EVALUATION = {
  fitBand: "strong",
  recommendation: "review",
  evidence: [{ requirement: "5y TypeScript", evidence: "8y TypeScript at Acme", source: "resume" }],
  blockers: [],
  gaps: ["No Kubernetes exposure"],
  unknowns: ["Team size"],
  preferenceMatches: ["remote"],
  preferenceConflicts: [],
  postingConfidence: "high",
  overallConfidence: "medium",
  summary: "Strong technical match."
};

describe("js-09 acceptance — real-hash life cycle E2E (#938)", () => {
  let bootstrap: pg.Client;
  let workerDb: Kysely<JarvisDatabase>;
  let runtime: ExternalModuleWorkerRuntime;
  let registration: ExternalModuleDiscovery;
  let kvA: JobSearchKv;
  // Every worker-process log line, captured for the sentinel scan.
  const workerLogs: string[] = [];

  const modulesDir = fileURLToPath(new URL("../../external-modules", import.meta.url));

  const sweepPayload = (): ExternalModuleJobPayload => ({
    actorUserId: ids.userA,
    moduleId: "job-search",
    jobKind: "job-search.monitor-sweep",
    manifestHash: registration.manifestHash
  });

  const monitorQueue = () => {
    const queue = registration.manifest.worker?.queues?.[0];
    if (!queue) throw new Error("job-search manifest must declare a worker queue");
    return queue;
  };

  const jobOf = (data: ExternalModuleJobPayload, id: string): Job<ExternalModuleJobPayload> =>
    ({ id, name: monitorQueue().name, data }) as Job<ExternalModuleJobPayload>;

  // Production job-handler composition. Only the fetch rpc method is
  // intercepted (fixture instead of the live greenhouse API); kv, ai, and
  // the spawned worker process are the real production path.
  const buildSweepHandler = (
    overrides: Partial<ExternalModuleJobHandlerDeps> = {}
  ): ((job: Job<ExternalModuleJobPayload>) => Promise<unknown>) => {
    const fixtureBase64 = Buffer.from(readFileSync(FIXTURE_PATH, "utf8")).toString("base64");
    const deps: ExternalModuleJobHandlerDeps = {
      module: registration,
      queue: monitorQueue(),
      runtime: {
        invoke: (module, handler, input, rpc) =>
          runtime.invoke(module, handler, input, async (method, params, rememberSecret) => {
            if (method === "fetch.request") {
              // ModuleFetchResponse shape from the rpc host — bodyBase64,
              // never bodyText (that is the module-internal decoded form).
              return {
                status: 200,
                headers: { "content-type": "application/json" },
                bodyBase64: fixtureBase64
              };
            }
            return rpc(method, params, rememberSecret);
          })
      },
      workerDb,
      dataContext: new DataContextRunner(workerDb),
      cipher: createModuleCredentialSecretCipher(),
      discoveryById: new Map([["job-search", registration]]),
      listActiveUserIds: async () => [ids.userA],
      ai: async () => ({ ok: true, object: EVALUATION }),
      ...overrides
    };
    return createExternalModuleJobHandler(deps);
  };

  beforeAll(async () => {
    await resetFoundationDatabase();
    // Build BEFORE discovery: packageHash covers dist/worker.js, and the
    // sweep spawns that exact artifact.
    await buildExternalModule(jobSearchSourceDir);
    const { discoveries, rejected } = getExternalModuleRegistrations({
      modulesDir,
      coreVersion: CORE_VERSION
    });
    const found = discoveries.find((entry) => entry.id === "job-search");
    if (!found) {
      throw new Error(`job-search not discovered; rejected: ${JSON.stringify(rejected)}`);
    }
    registration = found;

    bootstrap = new Client({ connectionString: connectionStrings.bootstrap });
    await bootstrap.connect();
    workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
    runtime = new ExternalModuleWorkerRuntime({
      logger: {
        warn: (obj, msg) => {
          workerLogs.push(JSON.stringify({ obj, msg }));
        }
      }
    });
    // The enable row carries the REAL discovery hashes — the exact triple
    // (status, manifest_hash, package_hash) the job handler re-checks.
    await bootstrap.query(
      `INSERT INTO app.external_modules (id, status, manifest_hash, package_hash, enabled_at, enabled_by)
       VALUES ('job-search', 'enabled', $1, $2, now(), $3)`,
      [registration.manifestHash, registration.packageHash, ids.adminUser]
    );
    kvA = kvForActor({ module: registration, workerDb, requestIdPrefix: "js09-accept" }, ids.userA);
  }, 120_000);

  afterAll(async () =>
    Promise.allSettled([runtime?.close(), bootstrap?.end(), workerDb?.destroy()])
  );

  it("discovers the built module with real content hashes and enables it with those hashes", async () => {
    expect(registration.manifestHash).toMatch(REAL_HASH_PATTERN);
    expect(registration.packageHash).toMatch(REAL_HASH_PATTERN);
    // Guard against ever regressing to the unit-harness placeholder hashes.
    expect(registration.manifestHash).not.toBe("sha256:job-search");
    expect(registration.packageHash).not.toBe("sha256:job-search");

    const row = await bootstrap.query(
      `SELECT status, manifest_hash, package_hash FROM app.external_modules WHERE id = 'job-search'`
    );
    expect(row.rows).toEqual([
      {
        status: "enabled",
        manifest_hash: registration.manifestHash,
        package_hash: registration.packageHash
      }
    ]);
  });

  it("walks the six onboarding checkpoints over the real RPC kv, seeding privacy sentinels", async () => {
    const now = () => new Date();
    const ports: WorkerPorts = { kv: kvA, ai: null, now };
    const stepNow = async (): Promise<string> => {
      const state = await getStateHandler({ kv: kvA, ai: null, now })({});
      return state.step as string;
    };

    expect(await stepNow()).toBe("resume_intake");

    // 1. resume_intake — paste the sentinel-bearing resume.
    await saveResumeDraftHandler(ports)({ mode: "manual", content: RESUME_CONTENT });
    expect(await stepNow()).toBe("resume_critique");

    // 2. resume_critique — AI stub proposing a whole original line.
    const critiqueAi: JobSearchAi = {
      generateStructured: async () => ({
        ok: true as const,
        object: {
          critiqueSummary: "tightened",
          proposedMarkdown: RESUME_LINE,
          materialClaims: [{ kind: "outcome", text: RESUME_LINE, quote: RESUME_LINE }]
        }
      })
    };
    const critique = await saveResumeDraftHandler({ kv: kvA, ai: critiqueAi, now })({
      mode: "critique"
    });
    expect(critique.status).toBe("ok");
    expect(await stepNow()).toBe("resume_approval");

    // 3. resume_approval
    await approveResumeHandler(ports)({ revisionId: critique.revisionId as string });
    expect(await stepNow()).toBe("profile");

    // 4. profile — sentinel in a user-provenance field, then approve.
    const draft = await saveProfileDraftHandler(ports)({
      provenance: "user",
      fields: { targetTitles: [`${PROFILE_SENTINEL} staff engineer`] }
    });
    await approveProfileHandler(ports)({ revisionId: draft.revisionId as string });
    expect(await stepNow()).toBe("sources_schedule");

    // 5. sources_schedule — save m1 disabled. dueTime 00:00 UTC keeps it
    // "due" under the spawned worker's REAL clock (no time injection on the
    // job path).
    await saveMonitorHandler(ports)({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: { board: "gitlab" },
      timezone: "UTC",
      dueTime: "00:00"
    });
    expect(await stepNow()).toBe("review_enable");

    // 6. review_enable — enable m1, onboarding done.
    await saveMonitorHandler(ports)({
      monitorId: "m1",
      adapterId: "greenhouse",
      query: { board: "gitlab" },
      timezone: "UTC",
      dueTime: "00:00",
      enabled: true
    });
    expect(await stepNow()).toBe("done");

    const state = await getStateHandler({ kv: kvA, ai: null, now })({});
    expect(state.gates).toEqual({
      resumeApproved: true,
      profileApproved: true,
      monitorEnabled: true
    });

    // Query sentinel carrier: a DISABLED monitor whose companyName holds the
    // sentinel. Enabled-monitor companyName legitimately becomes
    // posting.company, so the sentinel must ride a monitor the sweep skips —
    // which also proves disabled monitors never run. Onboarding flags are
    // monotone: saving m2 must not disturb the done state.
    await saveMonitorHandler(ports)({
      monitorId: "m2",
      adapterId: "greenhouse",
      query: { board: "gitlab", companyName: QUERY_SENTINEL },
      timezone: "UTC",
      dueTime: "00:00"
    });
    expect(await stepNow()).toBe("done");
  }, 120_000);

  it("runs the scheduled sweep through the production job handler and a real spawned worker", async () => {
    const handler = buildSweepHandler();
    const result = (await handler(jobOf(sweepPayload(), "js09-sweep-1"))) as Record<
      string,
      unknown
    >;
    // Disabled m2 is silently skipped by the sweep loop (not even counted),
    // so exactly one monitor is checked and it runs.
    expect(result).toMatchObject({
      status: "ok",
      jobKind: "job-search.monitor-sweep",
      checked: 1,
      ran: 1,
      skipped: 0,
      failed: 0
    });

    const summary = await getRunSummary(kvA, "m1");
    expect(summary).toMatchObject({ lastStatus: "ok" });

    const opportunities = await listOpportunities(kvA);
    expect(opportunities).toHaveLength(FIXTURE_JOB_COUNT);

    const rows = await bootstrapJobSearchRows(bootstrap);
    expect(rows.some((row) => row.namespace === "job-search.feed")).toBe(true);
  }, 120_000);

  it("keeps every sentinel out of job payloads, worker logs, and derived namespaces — with positive controls", async () => {
    const payloadJson = JSON.stringify(sweepPayload());
    const logDump = workerLogs.join("\n");
    const rows = await bootstrapJobSearchRows(bootstrap);
    const derivedDump = rows
      .filter((row) => (DERIVED_NAMESPACES as readonly string[]).includes(row.namespace))
      .map((row) => `${row.namespace}/${row.key}:${JSON.stringify(row.value)}`)
      .join("\n");
    // The derived surfaces must be non-empty or the absence scan is vacuous.
    expect(derivedDump.length).toBeGreaterThan(0);

    for (const sentinel of SENTINELS) {
      expect(payloadJson).not.toContain(sentinel);
      expect(logDump).not.toContain(sentinel);
      expect(derivedDump).not.toContain(sentinel);
    }

    // Positive controls: the scan finds each sentinel where it was seeded,
    // proving a real leak could not slip past this test.
    const dumpOf = (namespace: string): string =>
      rows
        .filter((row) => row.namespace === namespace)
        .map((row) => JSON.stringify(row.value))
        .join("\n");
    expect(dumpOf("job-search.resume")).toContain(RESUME_SENTINEL);
    expect(dumpOf("job-search.profile")).toContain(PROFILE_SENTINEL);
    expect(dumpOf("job-search.monitors")).toContain(QUERY_SENTINEL);
  });

  it("skips a same-day second sweep (daily slot consumed) without new derived rows", async () => {
    const rowsBefore = await bootstrapJobSearchRows(bootstrap);

    const handler = buildSweepHandler();
    const result = (await handler(jobOf(sweepPayload(), "js09-sweep-2"))) as Record<
      string,
      unknown
    >;
    expect(result).toMatchObject({
      status: "ok",
      jobKind: "job-search.monitor-sweep",
      checked: 1,
      ran: 0,
      skipped: 1,
      failed: 0
    });

    const rowsAfter = await bootstrapJobSearchRows(bootstrap);
    // The skipped sweep may touch run bookkeeping but must not grow the
    // derived opportunity/feed surface.
    const countIn = (rows: typeof rowsAfter, namespace: string): number =>
      rows.filter((row) => row.namespace === namespace).length;
    expect(countIn(rowsAfter, "job-search.opportunities")).toBe(
      countIn(rowsBefore, "job-search.opportunities")
    );
    expect(countIn(rowsAfter, "job-search.feed")).toBe(countIn(rowsBefore, "job-search.feed"));
    expect(await listOpportunities(kvA)).toHaveLength(FIXTURE_JOB_COUNT);
  }, 120_000);

  it("refuses to run when the on-disk package drifts from the enabled hashes", async () => {
    const workerJsPath = join(registration.dir, "dist", "worker.js");
    const original = readFileSync(workerJsPath);
    try {
      // Tamper the built artifact — REAL drift, not a synthetic hash swap.
      appendFileSync(workerJsPath, "\n// js09 acceptance drift tamper\n");
      const drifted = getExternalModuleRegistrations({
        modulesDir,
        coreVersion: CORE_VERSION
      }).discoveries.find((entry) => entry.id === "job-search");
      if (!drifted) throw new Error("drifted job-search discovery missing");
      expect(drifted.packageHash).not.toBe(registration.packageHash);

      // Fresh handler composed over the DRIFTED discovery; the DB row still
      // holds the original enable-time hashes, so the triple check must
      // refuse silently — zero worker invocations, zero kv writes.
      const invocations: unknown[] = [];
      const rowsBefore = await bootstrapJobSearchRows(bootstrap);
      const handler = buildSweepHandler({
        module: drifted,
        discoveryById: new Map([["job-search", drifted]]),
        runtime: {
          invoke: async (_module, _handler, input) => {
            invocations.push(input);
            return { ok: true };
          }
        }
      });
      await expect(
        handler(jobOf({ ...sweepPayload(), manifestHash: drifted.manifestHash }, "js09-drift"))
      ).resolves.toBeUndefined();
      expect(invocations).toHaveLength(0);

      const rowsAfter = await bootstrapJobSearchRows(bootstrap);
      expect(rowsAfter.length).toBe(rowsBefore.length);
    } finally {
      writeFileSync(workerJsPath, original);
    }
  }, 120_000);
});
