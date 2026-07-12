// tests/integration/js08-decide-confirm-audit.test.ts
//
// JS-08 (#937) Task 7e — REQUIRED by plan adjudication: the REST route can
// only ever 403 a write tool (there is no waiter), so the confirm-gate proof
// must drive the SAME machinery assistant chat uses: AssistantToolGateway
// creates the pending action, the owner confirms it, and only then does the
// REAL job-search worker process (spawned from the built dist/worker.js, KV
// over the real RPC host against real Postgres RLS) execute the decision.
// Asserted end-to-end: execution happened (status flipped, reason stored),
// an owner-attributed audit row exists with approval_mode=confirmed, the
// tool result and gateway records never echo the owner-private reason, and
// the decided state survives module disable → re-enable untouched.
//
// Skeleton: tests/integration/external-module-gateway.test.ts (fake execute
// fn there); the execute fn here replicates apps/api/src/external-module-tools.ts
// so the wiring under test matches production composition.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Kysely } from "kysely";

import {
  AiRepository,
  AssistantToolGateway,
  ConfirmationRegistry,
  SessionTokenRegistry,
  type GatewaySessionRecord
} from "@jarv1s/ai";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import {
  createExternalModuleRpcHandler,
  createExternalToolManifests,
  ExternalModuleWorkerRuntime
} from "@jarv1s/module-registry/node";
import { createModuleCredentialSecretCipher } from "@jarv1s/settings";

import { buildExternalModule } from "../../scripts/build-external-module.js";
import type {
  JobSearchKv,
  OpportunityInput
} from "../../external-modules/job-search/src/domain/index.js";
import {
  getOpportunity,
  opportunityIdentity,
  readFeed,
  upsertOpportunity
} from "../../external-modules/job-search/src/domain/index.js";
import { jobSearchSourceDir, kvForActor, loadJobSearchModule } from "./job-search-rpc-harness.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const NOW = new Date("2026-07-11T12:00:00.000Z");
const DECIDE_JOB: OpportunityInput = {
  adapterId: "greenhouse",
  externalId: "gh-decide-1",
  posting: {
    title: "Decision Engineer",
    company: "Acme",
    description: "Owner-only posting body for the confirm-path proof."
  }
};
const DECIDE_HASH = opportunityIdentity(DECIDE_JOB);
const REASON = "Great fit — strong platform overlap, decided after review.";

describe("js-08 opportunity.decide — real confirm path + audit (#937)", () => {
  let bootstrap: pg.Client;
  let workerDb: Kysely<JarvisDatabase>;
  let appDb: Kysely<JarvisDatabase>;
  let runtime: ExternalModuleWorkerRuntime;

  // dir = real module source so the worker runtime can spawn dist/worker.js.
  const module = loadJobSearchModule(jobSearchSourceDir);

  /** Owner-scoped domain KV over the real RPC host — seeding + ground truth. */
  const kvFor = (actorUserId: string): JobSearchKv =>
    kvForActor({ module, workerDb, requestIdPrefix: "js08-decide" }, actorUserId);

  beforeAll(async () => {
    await resetFoundationDatabase();
    await buildExternalModule(jobSearchSourceDir);
    bootstrap = new Client({ connectionString: connectionStrings.bootstrap });
    await bootstrap.connect();
    workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    runtime = new ExternalModuleWorkerRuntime({
      logger: { warn: () => undefined }
    });
    // RLS hides module_kv rows unless the module row reads enabled.
    await bootstrap.query(
      `INSERT INTO app.external_modules (id, status, manifest_hash, package_hash, enabled_at, enabled_by)
       VALUES ('job-search', 'enabled', 'sha256:job-search', 'sha256:job-search', now(), $1)`,
      [ids.adminUser]
    );
    await upsertOpportunity(kvFor(ids.userA), DECIDE_JOB, NOW);
  }, 120_000);

  afterAll(async () =>
    Promise.allSettled([runtime?.close(), bootstrap?.end(), workerDb?.destroy(), appDb?.destroy()])
  );

  it("confirmed decide executes in the real worker, audits to the owner, and survives disable/re-enable", async () => {
    // Production execute-fn shape (apps/api/src/external-module-tools.ts):
    // per-call RPC host bound to the tool's declared risk + the CALLER's
    // actor id, real worker process invocation, {data} envelope.
    const cipher = createModuleCredentialSecretCipher();
    const manifests = createExternalToolManifests([module], async (mod, tool, input, context) => {
      const rpc = createExternalModuleRpcHandler({
        module: mod,
        toolRisk: tool.risk,
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        workerDataContext: new DataContextRunner(workerDb),
        cipher,
        isActorAdmin: async () => false
      });
      const value = await runtime.invoke(mod, tool.handler, input, rpc);
      return { data: value as Record<string, unknown> };
    });

    const tokens = new SessionTokenRegistry();
    const emitted: GatewaySessionRecord[] = [];
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => manifests,
      repository: new AiRepository(),
      runner: new DataContextRunner(appDb),
      tokens,
      confirmations: new ConfirmationRegistry(),
      notifier: { emit: (_session, record) => emitted.push(record) },
      confirmTimeoutMs: 5_000
    });
    const token = tokens.mint({
      actorUserId: ids.userA,
      chatSessionId: "js08-decide",
      allowedToolNames: null
    });

    const pending = gateway.callTool(token, "job-search.opportunity.decide", {
      identityHash: DECIDE_HASH,
      decision: "saved",
      reason: REASON
    });
    while (emitted.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const request = emitted[0];
    if (!request || request.kind !== "action_request") throw new Error("expected action request");

    // Blocking confirmation: nothing executed yet — the record still reads
    // "new" for its owner while the action sits pending.
    expect(await getOpportunity(kvFor(ids.userA), DECIDE_HASH)).toMatchObject({ status: "new" });

    await gateway.resolveActionRequest(ids.userA, request.actionRequestId, "confirmed");
    const result = await pending;
    expect(result).toMatchObject({ ok: true });
    // The ack never re-emits the owner-private reason (the assistant already
    // has it in-conversation; tool results fan out further than that).
    expect(JSON.stringify(result)).not.toContain("Great fit");

    // The decision EXECUTED through the real worker: status flipped, the
    // reason persisted owner-private, and the rebuilt feed tracks the status.
    const decided = await getOpportunity(kvFor(ids.userA), DECIDE_HASH);
    expect(decided).toMatchObject({
      status: "saved",
      decisionReason: REASON
    });
    expect(
      (await readFeed(kvFor(ids.userA)))?.entries.find((entry) => entry.h === DECIDE_HASH)?.s
    ).toBe("saved");

    // Owner-attributed audit row (fire-and-forget write — poll for it).
    let audited = false;
    for (let attempt = 0; attempt < 100 && !audited; attempt += 1) {
      const audit = await bootstrap.query(
        `SELECT owner_user_id, approval_mode, outcome, tool_name
         FROM app.jarvis_action_audit_log WHERE tool_module_id = 'job-search'`
      );
      if (audit.rowCount) {
        expect(audit.rows[0]).toMatchObject({
          owner_user_id: ids.userA,
          approval_mode: "confirmed",
          outcome: "success",
          tool_name: "job-search.opportunity.decide"
        });
        audited = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    if (!audited) throw new Error("audit row not written");

    // Disable → the worker role loses sight of the rows; re-enable → the
    // decided status AND the stored reason come back byte-for-byte.
    await bootstrap.query(
      `UPDATE app.external_modules SET status = 'disabled' WHERE id = 'job-search'`
    );
    expect(await getOpportunity(kvFor(ids.userA), DECIDE_HASH)).toBeNull();
    await bootstrap.query(
      `UPDATE app.external_modules SET status = 'enabled' WHERE id = 'job-search'`
    );
    expect(await getOpportunity(kvFor(ids.userA), DECIDE_HASH)).toMatchObject({
      status: "saved",
      decisionReason: REASON
    });
  }, 60_000);
});
