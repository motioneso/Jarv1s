// tests/integration/external-module-job-search-kv-isolation.test.ts
//
// JS-02 (#931) Task 11 — SECURITY HEADLINE. Proves the job-search domain's
// owner-privacy claims against REAL Postgres RLS, not the unit fake: userB
// and an admin actor see nothing of userA's data (admin power is
// configuration only — Hard Invariant), same-key writes land on separate
// owner rows, the DB's 65,536-byte check backstops the domain cap, disable
// preserves data while hiding it from the worker role, and export/delete
// mirror the module_kv lifecycle. The harness copies
// module-worker-rpc.test.ts and drives the domain through
// createExternalModuleRpcHandler with the REAL parsed jarvis.module.json,
// so a declared-namespace drift fails here, not in production.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import type { Kysely } from "kysely";

import { deleteUserData } from "../../scripts/delete-user-data.js";
import { exportUserData } from "../../scripts/export-user-data.js";
import type { AdapterFetch } from "../../external-modules/job-search/src/adapters/index.js";
import type {
  ConfirmationRecord,
  EvaluationRecord,
  JobSearchKv,
  MonitorConfig,
  OpportunityInput
} from "../../external-modules/job-search/src/domain/index.js";
import {
  NS,
  approveProfile,
  approveResume,
  confirmationIdFor,
  contentHash,
  evaluationIdentity,
  getActiveProfile,
  getActiveResume,
  getEvaluation,
  getOpportunity,
  getScheduleState,
  keys,
  listOpportunities,
  opportunityIdentity,
  readBudgetUsed,
  rebuildFeed,
  readFeed,
  saveConfirmation,
  saveEvaluation,
  saveMonitor,
  saveOriginalResume,
  saveProfileRevision,
  saveScheduleState,
  takeBudget,
  upsertOpportunity
} from "../../external-modules/job-search/src/domain/index.js";
import type {
  JobSearchAi,
  JobSearchAiInput,
  WorkerPorts
} from "../../external-modules/job-search/src/worker/ai-port.js";
import {
  decideOpportunityHandler,
  getOpportunityHandler,
  listOpportunitiesHandler
} from "../../external-modules/job-search/src/worker/handlers/opportunities.js";
import {
  getResumeHandler,
  saveResumeDraftHandler
} from "../../external-modules/job-search/src/worker/handlers/resume.js";
import {
  monitorRunHandler,
  runMonitorDiscovery
} from "../../external-modules/job-search/src/worker/handlers/run.js";
import {
  bootstrapJobSearchRows as harnessBootstrapRows,
  kvForActor as harnessKvForActor,
  loadJobSearchModule,
  workerQuery,
  type KvActorOptions
} from "./job-search-rpc-harness.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;
let bootstrap: pg.Client;
let workerDb: Kysely<JarvisDatabase>;

const jobSearchModule = loadJobSearchModule();

const NOW = new Date("2026-07-11T12:00:00.000Z");

const OPPORTUNITY: OpportunityInput = {
  adapterId: "greenhouse",
  externalId: "gh-1",
  posting: { title: "Engineer", company: "Acme", description: "Build things." }
};
const OPPORTUNITY_HASH = opportunityIdentity(OPPORTUNITY);

// Thin aliases over the shared harness so the suite's call sites stay
// unchanged; workerDb/bootstrap are bound lazily (assigned in beforeAll).
const kvForActor = (actorUserId: string, options?: KvActorOptions): JobSearchKv =>
  harnessKvForActor(
    { module: jobSearchModule, workerDb, requestIdPrefix: "kv-isolation" },
    actorUserId,
    options
  );
const bootstrapJobSearchRows = (): ReturnType<typeof harnessBootstrapRows> =>
  harnessBootstrapRows(bootstrap);

beforeAll(async () => {
  await resetFoundationDatabase();
  bootstrap = new Client({ connectionString: connectionStrings.bootstrap });
  await bootstrap.connect();
  workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
  await bootstrap.query(
    `INSERT INTO app.external_modules (id, status, manifest_hash, package_hash, enabled_at, enabled_by)
     VALUES ('job-search', 'enabled', 'sha256:job-search', 'sha256:job-search', now(), $1)`,
    [ids.adminUser]
  );
});

afterAll(async () => Promise.allSettled([bootstrap?.end(), workerDb?.destroy()]));

describe("job-search KV owner/admin isolation + lifecycle (#931)", () => {
  it("seeds userA through the domain over the real RPC KV", async () => {
    const kvA = kvForActor(ids.userA);
    await saveOriginalResume(kvA, "# Resume\nUserA original resume text.", NOW);
    await approveResume(kvA, "0", NOW);
    await saveProfileRevision(kvA, {
      schemaVersion: 1,
      revisionId: "p1",
      createdAt: NOW.toISOString(),
      provenance: "user",
      fields: { targetRole: "Engineer" }
    });
    await approveProfile(kvA, "p1", NOW);
    const upserted = await upsertOpportunity(kvA, OPPORTUNITY, NOW);
    expect(upserted.suppressed).toBe(false);
    await rebuildFeed(kvA, NOW);

    expect(await getActiveResume(kvA)).not.toBeNull();
    expect(await getActiveProfile(kvA)).not.toBeNull();
    expect((await readFeed(kvA))?.entries.map((e) => e.h)).toEqual([OPPORTUNITY_HASH]);
  });

  it("userB sees none of userA's data through the same namespaces and keys", async () => {
    const kvB = kvForActor(ids.userB);
    expect(await getActiveResume(kvB)).toBeNull();
    expect(await getActiveProfile(kvB)).toBeNull();
    expect(await getOpportunity(kvB, OPPORTUNITY_HASH)).toBeNull();
    for (const namespace of Object.values(NS)) {
      expect(await kvB.list(namespace)).toEqual([]);
    }
  });

  it("admin actor sees nothing either — admin power is configuration only", async () => {
    const kvAdmin = kvForActor(ids.adminUser, { admin: true });
    expect(await getActiveResume(kvAdmin)).toBeNull();
    expect(await getOpportunity(kvAdmin, OPPORTUNITY_HASH)).toBeNull();
    for (const namespace of Object.values(NS)) {
      expect(await kvAdmin.list(namespace)).toEqual([]);
    }
    // Same result one layer down: worker-role SQL with the admin as actor
    // yields zero rows — RLS applies to all actors, no BYPASSRLS.
    const rows = await workerQuery(
      ids.adminUser,
      "job-search",
      "SELECT key FROM app.module_kv WHERE module_id = 'job-search'"
    );
    expect(rows).toEqual([]);
  });

  it("cross-owner key construction touches only the writer's own row", async () => {
    const before = await bootstrapJobSearchRows();
    const userARow = before.find(
      (r) => r.owner_user_id === ids.userA && r.key === keys.job(OPPORTUNITY_HASH)
    );
    expect(userARow).toBeDefined();

    // userB ingests the SAME posting: identical identity hash, identical key.
    const kvB = kvForActor(ids.userB);
    const result = await upsertOpportunity(kvB, OPPORTUNITY, NOW);
    expect(result.suppressed).toBe(false);
    expect(await getOpportunity(kvB, OPPORTUNITY_HASH)).not.toBeNull();

    // Two rows now share the key, split by owner; userA's is byte-identical.
    const after = await bootstrapJobSearchRows();
    const sameKey = after.filter((r) => r.key === keys.job(OPPORTUNITY_HASH));
    expect(sameKey.map((r) => r.owner_user_id).sort()).toEqual([ids.userA, ids.userB].sort());
    expect(
      after.find((r) => r.owner_user_id === ids.userA && r.key === keys.job(OPPORTUNITY_HASH))
        ?.value
    ).toBe(userARow?.value);
  });

  it("defense-in-depth: the DB size check rejects what the domain cap should have caught", async () => {
    await expect(
      bootstrap.query(
        `INSERT INTO app.module_kv (module_id, namespace, scope, owner_user_id, key, value)
         VALUES ('job-search', 'job-search.opportunities', 'user', $1, 'oversize-probe', $2::jsonb)`,
        [ids.userA, JSON.stringify({ pad: "x".repeat(66_000) })]
      )
    ).rejects.toThrow(/module_kv_value_size_ck/);
  });

  it("disable hides data from the worker role but preserves it; re-enable restores access", async () => {
    await bootstrap.query(
      `UPDATE app.external_modules SET status = 'disabled' WHERE id = 'job-search'`
    );
    expect(
      await workerQuery(
        ids.userA,
        "job-search",
        "SELECT key FROM app.module_kv WHERE module_id = 'job-search'"
      )
    ).toEqual([]);
    // The rows themselves survive the disable — nothing was purged.
    expect((await bootstrapJobSearchRows()).length).toBeGreaterThan(0);

    await bootstrap.query(
      `UPDATE app.external_modules SET status = 'enabled' WHERE id = 'job-search'`
    );
    expect(await getActiveResume(kvForActor(ids.userA))).not.toBeNull();
  });

  it("export includes the owner's job-search rows; delete cascades them and spares userB", async () => {
    const exported = await exportUserData({
      appConnectionString: connectionStrings.app,
      exportedAt: NOW,
      userId: ids.userA
    });
    const moduleKv = exported.tables.moduleKv as Array<{ moduleId: string; key: string }>;
    const jobSearchRows = moduleKv.filter((row) => row.moduleId === "job-search");
    expect(jobSearchRows.length).toBeGreaterThan(0);
    expect(jobSearchRows.some((row) => row.key === keys.resumeRevision("0"))).toBe(true);

    const deleted = await deleteUserData({
      bootstrapConnectionString: connectionStrings.bootstrap,
      confirmUserId: ids.userA,
      dryRun: false,
      userId: ids.userA
    });
    expect(deleted.deleted).toBe(true);

    const remaining = await bootstrapJobSearchRows();
    expect(remaining.filter((r) => r.owner_user_id === ids.userA)).toEqual([]);
    // userB's row from the cross-owner case is untouched by userA's delete.
    expect(remaining.filter((r) => r.owner_user_id === ids.userB).length).toBeGreaterThan(0);
  });
});

// JS-03 (#932) Task 12 — adversarial proof for THIS slice's record families:
// resume revisions, confirmation records, and profile revisions + the active
// pointer are owner-only under the same real-RLS harness. The lifecycle
// describe above ends by DELETING userA (users row included), so this block
// re-creates and re-seeds A before probing as B and as an admin.
const RESUME_TEXT = "# Resume\nUserA JS-03 private resume body — must never cross owners.";
const CLAIM_TEXT = "Cut deploy time 40% at Acme.";
const CONFIRMATION: ConfirmationRecord = {
  schemaVersion: 1,
  confirmationId: confirmationIdFor("metric", CLAIM_TEXT),
  claimKind: "metric",
  claimText: CLAIM_TEXT,
  confirmedAt: NOW.toISOString()
};

describe("job-search onboarding/resume/profile record isolation (#932)", () => {
  beforeAll(async () => {
    // deleteUserData above removed userA's app.users row — restore it so the
    // FK on module_kv.owner_user_id accepts fresh writes.
    await bootstrap.query(
      `INSERT INTO app.users (id, email, is_instance_admin)
       VALUES ($1, 'user-a@example.test', false)`,
      [ids.userA]
    );
  });

  it("userA writes resume revision 0, a confirmation, and an approved profile via A's rpc-backed kv", async () => {
    const kvA = kvForActor(ids.userA);
    await saveOriginalResume(kvA, RESUME_TEXT, NOW);
    await saveConfirmation(kvA, CONFIRMATION);
    await saveProfileRevision(kvA, {
      schemaVersion: 1,
      revisionId: "p2",
      createdAt: NOW.toISOString(),
      provenance: "user",
      fields: { targetRole: "Staff Engineer" }
    });
    await approveProfile(kvA, "p2", NOW); // writes the profile active pointer

    expect(await kvA.get(NS.resume, keys.resumeRevision("0"))).not.toBeNull();
    expect(
      await kvA.get(NS.resume, keys.resumeConfirmation(CONFIRMATION.confirmationId))
    ).not.toBeNull();
    expect((await getActiveProfile(kvA))?.revisionId).toBe("p2");
  });

  it("userB's get/list on the resume and profile namespaces see none of it", async () => {
    const kvB = kvForActor(ids.userB);
    expect(await kvB.get(NS.resume, keys.resumeRevision("0"))).toBeNull();
    expect(
      await kvB.get(NS.resume, keys.resumeConfirmation(CONFIRMATION.confirmationId))
    ).toBeNull();
    expect(await kvB.get(NS.profile, keys.profileRevision("p2"))).toBeNull();
    expect(await kvB.get(NS.profile, keys.profileActive)).toBeNull();
    expect(await kvB.list(NS.resume)).toEqual([]);
    expect(await kvB.list(NS.profile)).toEqual([]);
  });

  it("userB's resume.get handler asks the onboarding question and never surfaces A's content", async () => {
    const handler = getResumeHandler({ kv: kvForActor(ids.userB), ai: null, now: () => NOW });
    const result = await handler({});
    expect(result.status).toBe("question");
    expect(result.question).toBe(
      "I don't have a resume for you yet. Paste your current resume text and " +
        "I'll store it as the original to work from."
    );
    // Belt and braces: A's private resume body appears nowhere in B's response.
    expect(JSON.stringify(result)).not.toContain("private resume body");
  });

  it("admin actor still cannot read A's onboarding records — no private-data bypass", async () => {
    const kvAdmin = kvForActor(ids.adminUser, { admin: true });
    expect(await kvAdmin.get(NS.resume, keys.resumeRevision("0"))).toBeNull();
    expect(
      await kvAdmin.get(NS.resume, keys.resumeConfirmation(CONFIRMATION.confirmationId))
    ).toBeNull();
    expect(await kvAdmin.get(NS.profile, keys.profileRevision("p2"))).toBeNull();
    expect(await kvAdmin.get(NS.profile, keys.profileActive)).toBeNull();
    expect(await kvAdmin.list(NS.resume)).toEqual([]);
    expect(await kvAdmin.list(NS.profile)).toEqual([]);
    // One layer down: worker-role SQL as the admin actor over these
    // namespaces yields zero rows — RLS applies to all actors.
    const rows = await workerQuery(
      ids.adminUser,
      "job-search",
      `SELECT key FROM app.module_kv WHERE module_id = 'job-search'
       AND namespace IN ('job-search.resume', 'job-search.profile')`
    );
    expect(rows).toEqual([]);
  });
});

// JS-03 (#932) QA RED fix cycle 2 — attack-path proof for the B1 finding
// (PR #956, Codex issuecomment-4946275153 + Opus issuecomment-4946268694):
// an AI response that under-declares materialClaims (here: []) while
// fabricating in proposedMarkdown must NOT persist a draft revision and must
// never become approvable — proven through the REAL RPC kv port and real
// Postgres, not the in-memory kv. FABRICATED is Codex's exact cycle-2 PoC:
// all-lowercase spelled-out numbers defeated the cycle-1 caps/digit
// heuristic (zero spans → vacuous pass); the segment-phrase guard fails it.
describe("job-search critique truth-guard coverage — fabrication cannot persist (#932)", () => {
  const B_ORIGINAL = "Product Manager at Globex Corporation\nShipped the Meridian platform in 2024";
  const FABRICATED =
    "vice president at initech from twenty twenty to twenty twenty four\nincreased revenue by tenfold";

  it("materialClaims: [] + fabricated markdown → question, no revision row, approve fails", async () => {
    // userB still exists in app.users and its resume namespace is empty after
    // the #932 describe above — no re-seed choreography needed.
    const kvB = kvForActor(ids.userB);
    // Seed B's original through the real manual-save path.
    const seed = await saveResumeDraftHandler({ kv: kvB, ai: null, now: () => NOW })({
      mode: "manual",
      content: B_ORIGINAL
    });
    expect(seed.status).toBe("ok");

    const ai: JobSearchAi = {
      generateStructured: async () => ({
        ok: true,
        object: {
          critiqueSummary: "puffed the resume up",
          proposedMarkdown: FABRICATED,
          materialClaims: []
        }
      })
    };
    const result = await saveResumeDraftHandler({ kv: kvB, ai, now: () => NOW })({
      mode: "critique"
    });
    expect(result.status).toBe("question");
    // Spans echo raw segments now — check segment-aware, lowercase like the PoC.
    expect((result.unverifiedSpans as string[]).some((span) => span.includes("initech"))).toBe(
      true
    );

    // Ground truth via worker-role SQL: only the seeded original revision row
    // exists, and the fabricated content appears in NO row at all.
    const revisionRows = await workerQuery<{ key: string }>(
      ids.userB,
      "job-search",
      `SELECT key FROM app.module_kv WHERE module_id = 'job-search'
       AND namespace = 'job-search.resume' AND key LIKE 'revision/%' ORDER BY key`
    );
    expect(revisionRows.map((r) => r.key)).toEqual(["revision/0"]);
    const fabricatedRows = await workerQuery<{ key: string }>(
      ids.userB,
      "job-search",
      `SELECT key FROM app.module_kv WHERE module_id = 'job-search'
       AND value::text LIKE '%initech%'`
    );
    expect(fabricatedRows).toEqual([]);

    // The draft the critique WOULD have created can never be approved.
    await expect(
      approveResume(kvB, contentHash(["rev", "0", FABRICATED].join("\0")), NOW)
    ).rejects.toMatchObject({ code: "missing_revision" });
  });
});

// JS-05 (#934) Task 6 — the monitoring slice's NEW record family. The sweep's
// schedule/<id> state (which local day last completed) lives in NS.monitors and
// must be owner-only like everything else: B never learns when A's monitors run.
// Same real-RLS harness; both users exist at this point in the suite.
describe("job-search schedule-state isolation (#934)", () => {
  it("schedule state is invisible across owners", async () => {
    const kvA = kvForActor(ids.userA);
    const kvB = kvForActor(ids.userB);
    await saveScheduleState(kvA, {
      schemaVersion: 1,
      monitorId: "mon-iso",
      lastCompletedLocalDate: "2026-07-11"
    });
    expect(await getScheduleState(kvB, "mon-iso")).toBeNull();
    expect(await kvB.list(NS.monitors)).not.toContain("schedule/mon-iso");
    // Owner A still sees their own state — the write itself landed.
    expect(await getScheduleState(kvA, "mon-iso")).toMatchObject({
      lastCompletedLocalDate: "2026-07-11"
    });
  });
});

// ---------------------------------------------------------------------------
// JS-07 (#936) Step 8 — integration + security proof for the freshness/dedup/
// fit slice, over the SAME real-RLS harness. Queue-path ctx.ai end-to-end is
// covered by tests/integration/module-worker-queue-ai.test.ts (Step 0) — not
// duplicated here. Suite order note: userA exists (re-created by the #932
// describe) with resume revision 0 + approved profile p2; the #934 describe
// left schedule/mon-iso rows for A, which #962-item-2 below extends.
// ---------------------------------------------------------------------------

const EVAL_TARGET_HASH = contentHash("js-07 eval isolation target");
const EVAL_BUDGET_DATE = "2026-07-09"; // distinct from the pipeline's UTC day
const EVALUATION_A: EvaluationRecord = {
  schemaVersion: 1,
  evaluationId: evaluationIdentity({
    opportunityContentHash: EVAL_TARGET_HASH,
    profileRevisionId: "p2",
    resumeRevisionId: "0"
  }),
  identityHash: EVAL_TARGET_HASH,
  fitBand: "strong",
  recommendation: "review",
  evidence: [{ requirement: "TypeScript", evidence: "8y TypeScript", source: "resume" }],
  blockers: [],
  gaps: [],
  unknowns: [],
  preferenceMatches: [],
  preferenceConflicts: [],
  postingConfidence: "high",
  overallConfidence: "medium",
  summary: "UserA private fit summary — must never cross owners.",
  inputs: {
    opportunityContentHash: EVAL_TARGET_HASH,
    profileRevisionId: "p2",
    resumeRevisionId: "0"
  },
  createdAt: NOW.toISOString()
};

// JS-07 (#936) Step 8 item 1 — the slice's NEW record families (eval/<h> and
// evalBudget/<date>, both in NS.opportunities) are owner-only under real RLS.
// SECURITY tier: denial is proven as 0-rows/null with a positive control (A
// sees the rows through the very same probes), never as absence-of-error.
describe("job-search evaluation + budget-ledger isolation (#936)", () => {
  it("userA writes an evaluation and spends budget through the RPC kv", async () => {
    const kvA = kvForActor(ids.userA);
    await saveEvaluation(kvA, EVALUATION_A);
    expect(await takeBudget(kvA, EVAL_BUDGET_DATE, 3)).toBe(3);
    // Positive control for every denial probe below: the owner sees both rows.
    expect(await getEvaluation(kvA, EVAL_TARGET_HASH)).toMatchObject({
      fitBand: "strong",
      summary: EVALUATION_A.summary
    });
    expect(await readBudgetUsed(kvA, EVAL_BUDGET_DATE)).toBe(3);
    const rows = await workerQuery<{ key: string }>(
      ids.userA,
      "job-search",
      `SELECT key FROM app.module_kv WHERE module_id = 'job-search'
       AND (key LIKE 'eval/%' OR key LIKE 'evalBudget/%')`
    );
    // Sort in JS — the DB collation orders 'evalBudget/' vs 'eval/' by locale.
    expect(rows.map((r) => r.key).sort()).toEqual(
      [keys.evaluation(EVAL_TARGET_HASH), keys.evalBudget(EVAL_BUDGET_DATE)].sort()
    );
  });

  it("userB sees neither A's evaluation nor A's budget ledger", async () => {
    const kvB = kvForActor(ids.userB);
    expect(await getEvaluation(kvB, EVAL_TARGET_HASH)).toBeNull();
    expect(await kvB.get(NS.opportunities, keys.evaluation(EVAL_TARGET_HASH))).toBeNull();
    expect(await kvB.get(NS.opportunities, keys.evalBudget(EVAL_BUDGET_DATE))).toBeNull();
    // A fresh day for B: A's spend must not count against B's budget.
    expect(await readBudgetUsed(kvB, EVAL_BUDGET_DATE)).toBe(0);
    // B's own opportunity rows (earlier describes) may list — A's eval keys must not.
    const listed = await kvB.list(NS.opportunities);
    expect(listed).not.toContain(keys.evaluation(EVAL_TARGET_HASH));
    expect(listed).not.toContain(keys.evalBudget(EVAL_BUDGET_DATE));
    // One layer down: worker-role SQL as B over the eval key families → 0 rows.
    const rows = await workerQuery(
      ids.userB,
      "job-search",
      `SELECT key FROM app.module_kv WHERE module_id = 'job-search'
       AND (key LIKE 'eval/%' OR key LIKE 'evalBudget/%')`
    );
    expect(rows).toEqual([]);
  });

  it("admin actor is denied the same way — no private-data bypass", async () => {
    const kvAdmin = kvForActor(ids.adminUser, { admin: true });
    expect(await getEvaluation(kvAdmin, EVAL_TARGET_HASH)).toBeNull();
    expect(await kvAdmin.get(NS.opportunities, keys.evalBudget(EVAL_BUDGET_DATE))).toBeNull();
    expect(await readBudgetUsed(kvAdmin, EVAL_BUDGET_DATE)).toBe(0);
    expect(await kvAdmin.list(NS.opportunities)).toEqual([]);
    const rows = await workerQuery(
      ids.adminUser,
      "job-search",
      `SELECT key FROM app.module_kv WHERE module_id = 'job-search'
       AND (key LIKE 'eval/%' OR key LIKE 'evalBudget/%')`
    );
    expect(rows).toEqual([]);
  });
});

// JS-07 (#936) Step 8 items 2–3 — the full discovery pipeline (ingest →
// freshness → retention → gate → evaluate → feed rebuild) runs at module
// level over the REAL RPC kv, mirroring the unit fixture in
// tests/unit/external-module-job-search-handlers-run.test.ts. Proves the
// pipeline's KV traffic (batched reads, eval writes, budget ledger, feed
// index) all survive the RPC + RLS path, and that dedup holds against real
// Postgres, not just the in-memory fake.
const GREENHOUSE_PAYLOAD = {
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
  bodyText: JSON.stringify(GREENHOUSE_PAYLOAD)
});
const T_RUN1 = "2026-07-11T12:00:00.000Z";
const T_RUN2 = "2026-07-11T14:00:00.000Z"; // greenhouse courtesy (1h) elapsed
const PIPELINE_BUDGET_DATE = "2026-07-11"; // budgetDateFor(T_RUN1/T_RUN2), UTC

interface StubAi extends JobSearchAi {
  readonly calls: JobSearchAiInput[];
}
function okAi(): StubAi {
  const calls: JobSearchAiInput[] = [];
  return {
    calls,
    async generateStructured(input) {
      calls.push(input);
      return {
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
      };
    }
  };
}

function makePorts(kv: JobSearchKv, ai: JobSearchAi | null, nowIso: string): WorkerPorts {
  return { kv, ai, fetch: okFetch, now: () => new Date(nowIso) };
}

const MONITOR_A: MonitorConfig = {
  schemaVersion: 1,
  monitorId: "mon-a",
  adapterId: "greenhouse",
  enabled: true,
  query: { board: "acme" },
  timezone: "UTC",
  dueTime: "07:00",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

async function hashOf(kv: JobSearchKv, title: string): Promise<string> {
  const record = (await listOpportunities(kv)).find((r) => r.posting.title === title);
  if (record === undefined) throw new Error("fixture record missing");
  return record.identityHash;
}

describe("job-search discovery pipeline over the real RPC kv (#936)", () => {
  const ai = okAi();

  beforeAll(async () => {
    const kvA = kvForActor(ids.userA);
    // A's resume revision 0 exists from the #932 describe but was never
    // approved (that describe only approved the profile). The evaluator
    // requires BOTH approvals; approve rev 0 and a fresh empty-fields profile
    // p3 so the gate excludes nothing (deterministic verdicts, mirroring the
    // unit fixture).
    await approveResume(kvA, "0", NOW);
    await saveProfileRevision(kvA, {
      schemaVersion: 1,
      revisionId: "p3",
      createdAt: NOW.toISOString(),
      provenance: "user",
      fields: {}
    });
    await approveProfile(kvA, "p3", NOW);
    await saveMonitor(kvA, MONITOR_A);
  });

  it("full run: gate verdicts, evaluations persisted, feed order + e/b/c codes", async () => {
    const kvA = kvForActor(ids.userA);
    const outcome = await runMonitorDiscovery(makePorts(kvA, ai, T_RUN1), MONITOR_A, {
      runId: "a".repeat(32),
      consumeSlot: false
    });
    expect(outcome).toMatchObject({
      ran: true,
      counts: {
        fetched: 2,
        ingested: 2,
        gateExcluded: 0,
        evaluated: 2,
        evalPending: 0,
        staleMarked: 0
      }
    });
    expect(ai.calls.length).toBe(2);
    expect(await readBudgetUsed(kvA, PIPELINE_BUDGET_DATE)).toBe(2);

    // Evaluations persisted through the RPC kv, bound to THIS run's inputs.
    const evaluation = await getEvaluation(kvA, await hashOf(kvA, "Platform Engineer"));
    expect(evaluation).toMatchObject({
      fitBand: "strong",
      recommendation: "review",
      inputs: { profileRevisionId: "p3", resumeRevisionId: "0" }
    });

    // Feed rebuilt AFTER evaluation: single-char codes present, eligible +
    // strong + medium on both; tie broken by newest publishedAt (job 102).
    const feed = await readFeed(kvA);
    expect(feed?.entries.map((e) => ({ e: e.e, b: e.b, c: e.c }))).toEqual([
      { e: "e", b: "s", c: "m" },
      { e: "e", b: "s", c: "m" }
    ]);
    expect(feed?.entries[0]?.h).toBe(await hashOf(kvA, "Staff Engineer"));

    // Pipeline-produced records stay owner-only too.
    const kvB = kvForActor(ids.userB);
    expect(await getEvaluation(kvB, await hashOf(kvA, "Platform Engineer"))).toBeNull();
    expect(await kvB.get(NS.feed, keys.feedActive)).toBeNull();
  });

  it("run-twice-identical dedups at module level: no re-evaluation, no AI calls, budget unchanged", async () => {
    const kvA = kvForActor(ids.userA);
    const budgetBefore = await readBudgetUsed(kvA, PIPELINE_BUDGET_DATE);
    const outcome = await runMonitorDiscovery(makePorts(kvA, ai, T_RUN2), MONITOR_A, {
      runId: "b".repeat(32),
      consumeSlot: false
    });
    expect(outcome).toMatchObject({
      ran: true,
      counts: { fetched: 2, ingested: 0, suppressed: 2, evaluated: 0, evalPending: 0 }
    });
    expect(ai.calls.length).toBe(2); // both from the first run
    expect(await readBudgetUsed(kvA, PIPELINE_BUDGET_DATE)).toBe(budgetBefore);
  });
});

// #962 item 1 (folded into JS-07 Step 8) — handler-level cross-owner run-now
// denial: B invoking the run-now tool with A's monitorId must get the same
// fixed `monitor_not_found` an unknown id gets (RLS hides A's monitor from
// B's kv), and the denied invocation must write NOTHING — proven by a
// byte-identical snapshot of the whole module_kv table, both owners.
describe("job-search run-now cross-owner denial (#962)", () => {
  it("actor B running A's monitor gets monitor_not_found and writes nothing", async () => {
    const before = await bootstrapJobSearchRows();
    // Sanity: A's monitor row is really there for RLS to hide.
    expect(
      before.some((r) => r.owner_user_id === ids.userA && r.key === keys.monitor("mon-a"))
    ).toBe(true);

    const handler = monitorRunHandler(makePorts(kvForActor(ids.userB), null, T_RUN2));
    const result = await handler({
      actorUserId: ids.userB,
      jobKind: "job-search.monitor-run-now",
      idempotencyKey: "manual-b:1",
      params: { monitorId: "mon-a" }
    });
    expect(result).toMatchObject({ status: "error", code: "monitor_not_found" });

    // Nothing written against A — or anyone: the table is byte-identical.
    expect(await bootstrapJobSearchRows()).toEqual(before);
  });
});

// #962 item 2 (folded into JS-07 Step 8) — UPDATE-side cross-owner clobber
// guard, extending the #934 read-denial pattern: B writing schedule state for
// the SAME monitorId A uses must land on B's own row (insert, then update)
// and leave A's row byte-identical. Guards the RLS UPDATE policy, not just
// SELECT.
describe("job-search schedule-state cross-owner clobber guard (#962)", () => {
  it("B's insert+update on A's schedule id never touches A's row", async () => {
    const rowBytesFor = async (owner: string): Promise<string | undefined> =>
      (await bootstrapJobSearchRows()).find(
        (r) => r.owner_user_id === owner && r.key === keys.monitorSchedule("mon-iso")
      )?.value;

    // A's row exists from the #934 describe above.
    const aBefore = await rowBytesFor(ids.userA);
    expect(aBefore).toBeDefined();

    const kvB = kvForActor(ids.userB);
    // INSERT side: B's first write creates B's own row for the same key…
    await saveScheduleState(kvB, {
      schemaVersion: 1,
      monitorId: "mon-iso",
      lastCompletedLocalDate: "2026-07-09"
    });
    // …UPDATE side: B's second write must update B's row, not A's.
    await saveScheduleState(kvB, {
      schemaVersion: 1,
      monitorId: "mon-iso",
      lastCompletedLocalDate: "2026-07-10"
    });

    expect(await rowBytesFor(ids.userA)).toBe(aBefore);
    expect(await getScheduleState(kvForActor(ids.userA), "mon-iso")).toMatchObject({
      lastCompletedLocalDate: "2026-07-11"
    });
    expect(await getScheduleState(kvB, "mon-iso")).toMatchObject({
      lastCompletedLocalDate: "2026-07-10"
    });
    // Two rows share the key, split by owner.
    const sameKey = (await bootstrapJobSearchRows()).filter(
      (r) => r.key === keys.monitorSchedule("mon-iso")
    );
    expect(sameKey.map((r) => r.owner_user_id).sort()).toEqual([ids.userA, ids.userB].sort());
  });
});

// ---------------------------------------------------------------------------
// JS-08 (#937) Task 6 — feed reads and decisions across owners, over the SAME
// real-RLS harness, now through the actual assistant tool handlers (list /
// get / decide) rather than raw domain calls. SECURITY tier rule holds:
// every denial (null / missing_record / absent hash) is paired with a
// positive control proving the very same probe finds the data for its owner.
// Suite-state note: userB owns ONE opportunity row (the shared OPPORTUNITY
// ingested in the #931 cross-owner case), so B's list is asserted as
// "only B's own hash, never any of A's" — strictly stronger evidence than
// the empty-world 0 the plan sketched, because it shows the handler filtering
// a NON-empty table by owner.
// ---------------------------------------------------------------------------

const FEED_JOB: OpportunityInput = {
  adapterId: "greenhouse",
  externalId: "gh-feed-1",
  posting: {
    title: "Feed Engineer",
    company: "Acme",
    description: "UserA owner-only posting detail — must never cross owners."
  }
};
const FEED_HASH = opportunityIdentity(FEED_JOB);
const FEED_SUMMARY = "UserA private feed-slice fit summary.";

describe("job-search opportunity feed + decision isolation (#937)", () => {
  beforeAll(async () => {
    // Seed A: job + evaluation + feed rebuild. A's active profile is p3 and
    // active resume is revision 0 (approved in the #936 pipeline describe),
    // so pinning the evaluation inputs to (p3, 0) keeps `outdated` false.
    const kvA = kvForActor(ids.userA);
    await upsertOpportunity(kvA, FEED_JOB, NOW);
    const record = await getOpportunity(kvA, FEED_HASH);
    if (record === null) throw new Error("seed record missing");
    await saveEvaluation(kvA, {
      schemaVersion: 1,
      evaluationId: evaluationIdentity({
        opportunityContentHash: record.contentHash,
        profileRevisionId: "p3",
        resumeRevisionId: "0"
      }),
      identityHash: FEED_HASH,
      fitBand: "strong",
      recommendation: "review",
      evidence: [{ requirement: "TypeScript", evidence: "8y TypeScript", source: "resume" }],
      blockers: [],
      gaps: [],
      unknowns: [],
      preferenceMatches: [],
      preferenceConflicts: [],
      postingConfidence: "high",
      overallConfidence: "medium",
      summary: FEED_SUMMARY,
      inputs: {
        opportunityContentHash: record.contentHash,
        profileRevisionId: "p3",
        resumeRevisionId: "0"
      },
      createdAt: NOW.toISOString()
    });
    await rebuildFeed(kvA, NOW);
  });

  it("positive control: owner A's feed has the entry and A's handlers return it", async () => {
    const kvA = kvForActor(ids.userA);
    expect((await readFeed(kvA))?.entries.map((e) => e.h)).toContain(FEED_HASH);

    const ports = makePorts(kvA, null, T_RUN2);
    const list = await listOpportunitiesHandler(ports)({ view: "new" });
    expect(list.status).toBe("ok");
    const cards = list.opportunities as Array<{ identityHash: string }>;
    expect(cards.map((c) => c.identityHash)).toContain(FEED_HASH);

    const detail = await getOpportunityHandler(ports)({ identityHash: FEED_HASH });
    expect(detail).toMatchObject({
      status: "ok",
      opportunity: {
        identityHash: FEED_HASH,
        status: "new",
        evaluation: { fitBand: "strong", summary: FEED_SUMMARY, outdated: false }
      }
    });
  });

  it("userB sees none of A's feed: readFeed null, list holds only B's own row, get/decide deny", async () => {
    const kvB = kvForActor(ids.userB);
    // B never built a feed, and A's feed row is invisible to B — null, not
    // A's entries. (Asserted BEFORE the list handler below self-heals a feed
    // for B out of B's own rows.)
    expect(await readFeed(kvB)).toBeNull();
    expect(await getOpportunity(kvB, FEED_HASH)).toBeNull();
    expect((await listOpportunities(kvB)).map((r) => r.identityHash)).toEqual([OPPORTUNITY_HASH]);

    const ports = makePorts(kvB, null, T_RUN2);
    const list = await listOpportunitiesHandler(ports)({});
    const hashes = (list.opportunities as Array<{ identityHash: string }>).map(
      (c) => c.identityHash
    );
    expect(hashes).not.toContain(FEED_HASH);
    expect(hashes.every((h) => h === OPPORTUNITY_HASH)).toBe(true);
    // A's private evaluation summary appears nowhere in B's page.
    expect(JSON.stringify(list)).not.toContain("private feed-slice");

    await expect(getOpportunityHandler(ports)({ identityHash: FEED_HASH })).rejects.toMatchObject({
      code: "missing_record"
    });
    await expect(
      decideOpportunityHandler(ports)({
        identityHash: FEED_HASH,
        decision: "passed",
        reason: "cross-owner probe"
      })
    ).rejects.toMatchObject({ code: "missing_record" });
  });

  it("admin actor gets the same denials — no private-data bypass", async () => {
    const kvAdmin = kvForActor(ids.adminUser, { admin: true });
    expect(await readFeed(kvAdmin)).toBeNull();
    expect(await getOpportunity(kvAdmin, FEED_HASH)).toBeNull();

    const ports = makePorts(kvAdmin, null, T_RUN2);
    // Admin owns no opportunity rows at all, so the self-healed feed is empty.
    const list = await listOpportunitiesHandler(ports)({});
    expect(list).toMatchObject({ status: "ok", total: 0, opportunities: [] });
    await expect(getOpportunityHandler(ports)({ identityHash: FEED_HASH })).rejects.toMatchObject({
      code: "missing_record"
    });
    await expect(
      decideOpportunityHandler(ports)({ identityHash: FEED_HASH, decision: "saved" })
    ).rejects.toMatchObject({ code: "missing_record" });
  });

  it("userB's denied decide leaves A's record byte-identical; the owner's own decide lands", async () => {
    const rowFor = async (): Promise<string | undefined> =>
      (await bootstrapJobSearchRows()).find(
        (r) => r.owner_user_id === ids.userA && r.key === keys.job(FEED_HASH)
      )?.value;
    const before = await rowFor();
    expect(before).toBeDefined();

    await expect(
      decideOpportunityHandler(makePorts(kvForActor(ids.userB), null, T_RUN2))({
        identityHash: FEED_HASH,
        decision: "passed",
        reason: "B trying to clobber A's decision"
      })
    ).rejects.toMatchObject({ code: "missing_record" });

    // A's stored record is byte-identical after B's attempt — the denial
    // happened before any write, not by rolling one back.
    expect(await rowFor()).toBe(before);
    expect(await getOpportunity(kvForActor(ids.userA), FEED_HASH)).toMatchObject({
      status: "new"
    });

    // Positive control: the owner's decide DOES land over the same RPC kv,
    // the ack never echoes the reason, and the record + rebuilt feed carry
    // the new status for the owner only.
    const kvA = kvForActor(ids.userA);
    const ack = await decideOpportunityHandler(makePorts(kvA, null, T_RUN2))({
      identityHash: FEED_HASH,
      decision: "saved",
      reason: "Great fit for the platform role."
    });
    expect(ack).toMatchObject({ status: "ok", identityHash: FEED_HASH, decision: "saved" });
    expect(JSON.stringify(ack)).not.toContain("Great fit");
    expect(await getOpportunity(kvA, FEED_HASH)).toMatchObject({
      status: "saved",
      decisionReason: "Great fit for the platform role."
    });
    expect((await readFeed(kvA))?.entries.find((e) => e.h === FEED_HASH)?.s).toBe("saved");
    // The owner-private reason stays out of the derived feed index entirely.
    const feedRow = (await bootstrapJobSearchRows()).find(
      (r) => r.owner_user_id === ids.userA && r.key === keys.feedActive
    );
    expect(feedRow?.value).not.toContain("Great fit");
  });
});
