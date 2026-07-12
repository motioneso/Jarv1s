// tests/integration/js06-module-surface.test.ts
// JS-06 (#935): permanent guards for the module-surface data plane —
// supersedes the temporary js06-invoke-smoke proof. Read tools succeed over
// the invoke route, write tools 403 without executing, run-now dedupes via the
// manual singleton, and a disabled module fails closed to 404.
// Harness cloned from tests/integration/external-module-job-search.test.ts
// (better-auth first-signup bootstraps the admin — do not invent a new auth path).
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutgoingHttpHeaders } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createDatabase, type JarvisDatabase } from "@jarv1s/db";
import { migratePgBoss } from "@jarv1s/jobs";

import { createApiServer } from "../../apps/api/src/server.js";
import { kvForActor, loadJobSearchModule } from "./job-search-rpc-harness.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";
import { buildExternalModule } from "../../scripts/build-external-module.js";
import type {
  JobSearchKv,
  OpportunityInput
} from "../../external-modules/job-search/src/domain/index.js";
import {
  approveProfile,
  approveResume,
  evaluationIdentity,
  getOpportunity,
  opportunityIdentity,
  rebuildFeed,
  saveEvaluation,
  saveOriginalResume,
  saveProfileRevision,
  upsertOpportunity
} from "../../external-modules/job-search/src/domain/index.js";

const sourceDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

let root: string;
let modulesDir: string;
let appDb: Kysely<JarvisDatabase>;
let server: ReturnType<typeof createApiServer>;
let adminCookie: string;
let adminUserId: string;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  // In production the worker's ExternalModuleJobReconciler creates external
  // module queues at boot (apps/worker); this API-only harness must provision
  // job-search.monitor-run itself or run-now's boss.send throws → 503.
  await migratePgBoss(connectionStrings.migration, [
    { name: "job-search.monitor-run", options: { retryLimit: 3 } }
  ]);
  await buildExternalModule(sourceDir);

  root = mkdtempSync(join(tmpdir(), "js06-surface-"));
  modulesDir = join(root, "modules");
  const installedDir = join(modulesDir, "job-search");
  mkdirSync(installedDir, { recursive: true });
  cpSync(join(sourceDir, "jarvis.module.json"), join(installedDir, "jarvis.module.json"));
  cpSync(join(sourceDir, "dist"), join(installedDir, "dist"), { recursive: true });

  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  server = createApiServer({
    appDb,
    logger: false,
    apiServerConfig: {
      host: "0.0.0.0",
      port: 0,
      mcpServerUrl: "http://127.0.0.1:0/api/mcp",
      enableExternalModules: true,
      externalModulesDir: modulesDir
    }
  });
  await server.ready();

  const admin = await signUp(server, "owner@js06-surface.test", "Owner");
  adminCookie = admin.cookie;
  adminUserId = admin.userId;
  const enable = await setEnabled(true);
  expect(enable.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await Promise.allSettled([server?.close(), appDb?.destroy()]);
  rmSync(root, { recursive: true, force: true });
});

const setEnabled = (enabled: boolean) =>
  server.inject({
    method: "POST",
    url: "/api/admin/external-modules/job-search",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    payload: { enabled }
  });

const invokeTool = (name: string, input: Record<string, unknown> = {}) =>
  server.inject({
    method: "POST",
    url: `/api/ai/assistant-tools/${name}/invoke`,
    headers: { cookie: adminCookie, "content-type": "application/json" },
    payload: { input }
  });

const runNow = () =>
  server.inject({
    method: "POST",
    url: "/api/modules/job-search/queues/job-search.monitor-run/run",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    payload: { jobKind: "job-search.monitor-run-now", params: { monitorId: "m-test" } }
  });

describe("js-06 module surface data plane (#935)", () => {
  it("lists the declared job-search assistant tools", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-tools",
      headers: { cookie: adminCookie }
    });
    expect(response.statusCode).toBe(200);
    const names = response
      .json<{ tools: Array<{ moduleId: string; name: string }> }>()
      .tools.filter((tool) => tool.moduleId === "job-search")
      .map((tool) => tool.name);
    for (const required of [
      "job-search.onboarding.get-state",
      "job-search.profile.get",
      "job-search.resume.get",
      "job-search.monitor.list",
      "job-search.monitor.get",
      "job-search.sources.list"
    ]) {
      expect(names).toContain(required);
    }
  });

  it("executes a risk:read tool over the invoke route", async () => {
    const response = await invokeTool("job-search.monitor.list");
    expect(response.statusCode).toBe(200);
    expect(response.json().invocation).toMatchObject({
      status: "succeeded",
      blockedReason: null,
      result: { status: "ok", monitors: [] }
    });
  });

  it("blocks a write tool with confirmation_required and does not execute it", async () => {
    const response = await invokeTool("job-search.monitor.save");
    expect(response.statusCode).toBe(403);
    expect(response.json().invocation).toMatchObject({
      status: "blocked",
      blockedReason: "confirmation_required"
    });
  });

  it("run-now accepts a manual submission with 202 and a jobId", async () => {
    const first = await runNow();
    expect(first.statusCode).toBe(202);
    expect(typeof first.json<{ jobId: string | null }>().jobId).toBe("string");

    // Known gap (#965): the manual-path singletonKey does NOT dedupe today —
    // pg-boss v12 only enforces singleton keys through policy-filtered unique
    // indexes, and external queues are created with the default standard
    // policy. A second submit while queued therefore also gets a fresh jobId.
    // Once #965 lands (singletonSeconds on the run route), tighten this to
    // assert the second response carries jobId: null.
    const second = await runNow();
    expect(second.statusCode).toBe(202);
  });

  it("fails closed after disable: invoke answers 404 tool-not-declared", async () => {
    const disable = await setEnabled(false);
    expect(disable.statusCode).toBe(200);

    // A formerly-good read tool must vanish from the declared set entirely.
    const response = await invokeTool("job-search.monitor.list");
    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// JS-08 (#937) Task 7 — the opportunity feed over the REAL REST invoke route.
// Everything here goes through `server.inject` (never the service directly)
// because the response passes THREE lossy layers in production:
// sanitizeAssistantToolResult's outputSchema projection,
// boundedAssistantToolResultData's 16k degradation, and fast-json-stringify's
// silent drop of undeclared fields (the recurring #859/#885 trap). A field
// missing from any layer vanishes without an error — these tests exist to
// make that loud. Seeding writes go through the same real RPC KV handler the
// isolation suite uses, as the signed-up admin owner (owner-only data; admin
// power stays configuration-only).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-11T12:00:00.000Z");

const REST_JOB: OpportunityInput = {
  adapterId: "greenhouse",
  externalId: "gh-rest-1",
  posting: {
    title: "Feed Engineer",
    company: "Acme",
    location: "Remote",
    description: "Owner-only posting body served through the REST surface."
  }
};
const REST_HASH = opportunityIdentity(REST_JOB);

describe("js-08 opportunity feed over the REST invoke surface (#937)", () => {
  let workerDb: Kysely<JarvisDatabase>;

  // Shared-harness KV as the signed-up owner. The first-signup owner IS the
  // instance admin — model that honestly; scope stays "user" so RLS
  // owner-splits every row regardless.
  const ownerKv = (): JobSearchKv =>
    kvForActor(
      { module: loadJobSearchModule(), workerDb, requestIdPrefix: "js08-rest" },
      adminUserId,
      { admin: true }
    );

  beforeAll(async () => {
    // The JS-06 describe above deliberately ends with the module disabled.
    const enable = await setEnabled(true);
    expect(enable.statusCode).toBe(200);
    workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });

    // Seed: approved resume + approved empty-fields profile (deterministic
    // gate), one job, one CURRENT evaluation pinned to the active revisions
    // (so `outdated` stays false and the feed carries e/b/c codes), feed
    // rebuilt — the exact state the assistant reads back below.
    const kv = ownerKv();
    await saveOriginalResume(kv, "# Resume\nOwner resume text.", NOW);
    await approveResume(kv, "0", NOW);
    await saveProfileRevision(kv, {
      schemaVersion: 1,
      revisionId: "p1",
      createdAt: NOW.toISOString(),
      provenance: "user",
      fields: {}
    });
    await approveProfile(kv, "p1", NOW);
    await upsertOpportunity(kv, REST_JOB, NOW);
    const record = await getOpportunity(kv, REST_HASH);
    if (record === null) throw new Error("seed record missing");
    await saveEvaluation(kv, {
      schemaVersion: 1,
      evaluationId: evaluationIdentity({
        opportunityContentHash: record.contentHash,
        profileRevisionId: "p1",
        resumeRevisionId: "0"
      }),
      identityHash: REST_HASH,
      fitBand: "strong",
      recommendation: "review",
      evidence: [{ requirement: "TypeScript", evidence: "8y TypeScript", source: "resume" }],
      blockers: [],
      gaps: ["No staff-level scope evidence."],
      unknowns: [],
      preferenceMatches: [],
      preferenceConflicts: [],
      postingConfidence: "high",
      overallConfidence: "medium",
      summary: "Strong platform match.",
      inputs: {
        opportunityContentHash: record.contentHash,
        profileRevisionId: "p1",
        resumeRevisionId: "0"
      },
      createdAt: NOW.toISOString()
    });
    await rebuildFeed(kv, NOW);
  }, 60_000);

  afterAll(async () => {
    await workerDb?.destroy();
  });

  it("list over REST keeps every declared card field — the silent-drop trap test", async () => {
    const response = await invokeTool("job-search.opportunities.list", { view: "new" });
    expect(response.statusCode).toBe(200);
    const invocation = response.json<{
      invocation: { status: string; result: Record<string, unknown> };
    }>().invocation;
    expect(invocation.status).toBe("succeeded");
    expect(invocation.result).toMatchObject({ status: "ok", view: "new", total: 1 });
    // Every declared card field must survive schema projection + serialization
    // end-to-end; a single missing key here means a layer silently ate it.
    const card = (invocation.result.opportunities as Array<Record<string, unknown>>)[0];
    expect(card).toMatchObject({
      identityHash: REST_HASH,
      status: "new",
      title: "Feed Engineer",
      company: "Acme",
      location: "Remote",
      source: "greenhouse",
      freshness: "uncertain",
      eligibility: "eligible",
      fitBand: "strong",
      confidence: "medium",
      evaluationPending: false,
      topEvidence: "8y TypeScript",
      topGap: "No staff-level scope evidence."
    });
    expect(typeof card?.firstSeenAt).toBe("string");
    // Cards never carry the posting description — that is get territory.
    expect(card).not.toHaveProperty("description");
  });

  it("get over REST carries posting + evaluation; description present and bounded", async () => {
    const response = await invokeTool("job-search.opportunities.get", {
      identityHash: REST_HASH
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<{
      invocation: { result: { opportunity: Record<string, unknown> } };
    }>().invocation.result;
    const opportunity = result.opportunity;
    expect(opportunity).toMatchObject({
      identityHash: REST_HASH,
      status: "new",
      freshness: "uncertain",
      posting: {
        title: "Feed Engineer",
        company: "Acme",
        location: "Remote",
        description: "Owner-only posting body served through the REST surface.",
        descriptionTruncated: false,
        descriptionClipped: false
      },
      evaluation: {
        fitBand: "strong",
        recommendation: "review",
        summary: "Strong platform match.",
        evidence: [{ requirement: "TypeScript", evidence: "8y TypeScript", source: "resume" }],
        gaps: ["No staff-level scope evidence."],
        outdated: false,
        inputs: { profileRevisionId: "p1", resumeRevisionId: "0" }
      }
    });
    // Bounded by construction: the whole rendered result stays under the
    // 16k degradation threshold, or `opportunity` would have collapsed to
    // a bare {text} and the assertions above would already have failed.
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(16_000);
  });

  it("decide over REST is confirm-gated: 403 + pending action, nothing executed", async () => {
    const response = await invokeTool("job-search.opportunity.decide", {
      identityHash: REST_HASH,
      decision: "saved",
      reason: "REST must never execute this."
    });
    expect(response.statusCode).toBe(403);
    const invocation = response.json<{
      invocation: { status: string; blockedReason: string; actionRequestId: string | null };
    }>().invocation;
    expect(invocation).toMatchObject({ status: "blocked", blockedReason: "confirmation_required" });
    expect(typeof invocation.actionRequestId).toBe("string");

    // Confirm-gate proof: the decision did NOT land — the card still reads
    // "new" through the same REST surface.
    const list = await invokeTool("job-search.opportunities.list", { view: "new" });
    expect(list.statusCode).toBe(200);
    const cards = list.json<{
      invocation: { result: { opportunities: Array<{ identityHash: string; status: string }> } };
    }>().invocation.result.opportunities;
    expect(cards.find((card) => card.identityHash === REST_HASH)?.status).toBe("new");
    const saved = await invokeTool("job-search.opportunities.list", { view: "saved" });
    expect(
      saved.json<{ invocation: { result: { total: number } } }>().invocation.result.total
    ).toBe(0);
  });

  it("disable fails closed to 404; re-enable finds the data intact", async () => {
    expect((await setEnabled(false)).statusCode).toBe(200);
    expect((await invokeTool("job-search.opportunities.list")).statusCode).toBe(404);
    expect(
      (await invokeTool("job-search.opportunities.get", { identityHash: REST_HASH })).statusCode
    ).toBe(404);

    expect((await setEnabled(true)).statusCode).toBe(200);
    const response = await invokeTool("job-search.opportunities.get", {
      identityHash: REST_HASH
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ invocation: { result: { opportunity: Record<string, unknown> } } }>()
        .invocation.result.opportunity
    ).toMatchObject({
      identityHash: REST_HASH,
      status: "new",
      evaluation: { fitBand: "strong" }
    });
  });
});

async function signUp(
  target: ReturnType<typeof createApiServer>,
  email: string,
  name: string
): Promise<{ cookie: string; userId: string }> {
  const res = await target.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: { name, email, password: "correct horse battery staple" }
  });
  if (res.statusCode !== 200) {
    throw new Error(`sign-up for ${email} failed (${res.statusCode}): ${res.body}`);
  }
  return {
    cookie: cookieHeader(res.headers),
    userId: res.json<{ user: { id: string } }>().user.id
  };
}

function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}
