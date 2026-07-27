// #1282 Task 2: integration coverage for the briefing composer's NEW caller of the shared
// trust gate (apps/worker/src/external-module-invoke.ts). tests/integration/module-worker-queue-ai.test.ts
// already proves the gate against the pre-existing job queue path — passing there proves
// nothing about this second caller, since a briefing-specific wiring bug (e.g. skipping the
// gate, or building invokeExternalBriefing over the wrong deps) would show up only here.
//
// Every case asserts on the COMPOSED OUTPUT of collectExternalBriefingContributions — the
// actual function compose.ts/compose-evening.ts call — never on a thrown error (J3): a
// module that fails a trust check must silently contribute nothing, not fail the briefing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { collectExternalBriefingContributions } from "@jarv1s/briefings";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import type { JsonJarvisModuleManifest } from "@jarv1s/module-sdk";
import { createModuleCredentialSecretCipher } from "@jarv1s/settings";
import type { Kysely } from "kysely";

import { createExternalBriefingInvoker } from "../../apps/worker/src/external-module-invoke.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// assertModuleJobPayload elsewhere requires sha256:<64 hex>; reuse the same shape here so a
// row's hash columns look like real discovery hashes.
const HASH = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;

let bootstrap: pg.Client;
let workerDb: Kysely<JarvisDatabase>;

const moduleId = "job-search-briefing";

const manifest: JsonJarvisModuleManifest = {
  schemaVersion: 1,
  id: moduleId,
  name: "Job Search",
  version: "1.0.0",
  publisher: "Jarvis",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
  briefing: {
    handler: "briefing.contribute",
    sections: ["morning", "evening"],
    toolName: "job-search.briefing"
  }
};

const discovery = {
  id: moduleId,
  dir: "/unused",
  manifest,
  manifestHash: HASH,
  packageHash: HASH
};

beforeAll(async () => {
  await resetFoundationDatabase();
  bootstrap = new Client({ connectionString: connectionStrings.bootstrap });
  await bootstrap.connect();
  workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
});

afterAll(async () => {
  await Promise.allSettled([bootstrap?.end(), workerDb?.destroy()]);
});

/** Inserts (or replaces) the module's app.external_modules row for one test case. */
async function seedModuleRow(overrides: {
  status: "enabled" | "disabled";
  manifestHash?: string;
  packageHash?: string;
}): Promise<void> {
  await bootstrap.query(`DELETE FROM app.external_modules WHERE id = $1`, [moduleId]);
  await bootstrap.query(
    `INSERT INTO app.external_modules (id, status, manifest_hash, package_hash, enabled_at, enabled_by)
     VALUES ($1, $2, $3, $4, now(), $5)`,
    [
      moduleId,
      overrides.status,
      overrides.manifestHash ?? HASH,
      overrides.packageHash ?? HASH,
      ids.adminUser
    ]
  );
}

/** Builds the real gate + adapter, exactly as apps/worker/src/worker.ts composes them, with
 * only runtime.invoke stubbed so the test controls what the "module" returns. */
function buildInvoker(runtimeResult: unknown = { headline: "Two new leads", items: [] }) {
  return createExternalBriefingInvoker({
    workerDb,
    discoveryById: new Map([[moduleId, discovery]]),
    dataContext: new DataContextRunner(workerDb),
    cipher: createModuleCredentialSecretCipher(),
    runtime: { invoke: async () => runtimeResult },
    listActiveUserIds: async () => [ids.userA]
  });
}

async function collect(invoke: ReturnType<typeof buildInvoker>) {
  return collectExternalBriefingContributions({
    manifests: [manifest],
    selectedToolNames: [manifest.briefing!.toolName],
    section: "morning",
    actorUserId: ids.userA,
    requestId: "req-job-search-briefing",
    invoke
  });
}

describe("external module briefing contribution — real trust gate (#1282)", () => {
  it("contributes no section when the module row is disabled", async () => {
    await seedModuleRow({ status: "disabled" });
    const result = await collect(buildInvoker());
    expect(result).toEqual([]);
  });

  it("contributes no section when the stored package_hash differs from the discovery", async () => {
    await seedModuleRow({ status: "enabled", packageHash: OTHER_HASH });
    const result = await collect(buildInvoker());
    expect(result).toEqual([]);
  });

  it("contributes no section when the stored manifest_hash differs from the discovery", async () => {
    await seedModuleRow({ status: "enabled", manifestHash: OTHER_HASH });
    const result = await collect(buildInvoker());
    expect(result).toEqual([]);
  });

  it("contributes a section on the happy path", async () => {
    await seedModuleRow({ status: "enabled" });
    const result = await collect(
      buildInvoker({
        headline: "Two new leads",
        items: [{ id: "job-1", title: "Staff Engineer", detail: "Posted today" }]
      })
    );
    expect(result).toEqual([
      {
        moduleId,
        headline: "Two new leads",
        items: [{ id: "job-1", title: "Staff Engineer", detail: "Posted today" }]
      }
    ]);
  });
});
