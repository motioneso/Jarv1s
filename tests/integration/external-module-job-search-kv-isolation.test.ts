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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { validateExternalModuleManifest } from "@jarv1s/module-registry";
import { createExternalModuleRpcHandler } from "@jarv1s/module-registry/node";
import { createModuleCredentialSecretCipher } from "@jarv1s/settings";
import type { Kysely } from "kysely";

import { deleteUserData } from "../../scripts/delete-user-data.js";
import { exportUserData } from "../../scripts/export-user-data.js";
import type {
  JobSearchKv,
  OpportunityInput
} from "../../external-modules/job-search/src/domain/index.js";
import {
  NS,
  approveProfile,
  approveResume,
  getActiveProfile,
  getActiveResume,
  getOpportunity,
  keys,
  opportunityIdentity,
  rebuildFeed,
  readFeed,
  saveOriginalResume,
  saveProfileRevision,
  upsertOpportunity
} from "../../external-modules/job-search/src/domain/index.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;
let bootstrap: pg.Client;
let workerDb: Kysely<JarvisDatabase>;

const manifestPath = fileURLToPath(
  new URL("../../external-modules/job-search/jarvis.module.json", import.meta.url)
);

// Parse the SHIPPED manifest through the real validator so this suite's
// declared namespaces cannot drift from what production would enforce.
function loadJobSearchModule() {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const result = validateExternalModuleManifest(raw, "job-search", "0.1.0");
  if (!result.ok) {
    throw new Error(`shipped manifest failed validation: ${JSON.stringify(result.errors)}`);
  }
  return {
    id: "job-search",
    dir: "/unused",
    manifest: result.manifest,
    manifestHash: "sha256:job-search",
    packageHash: "sha256:job-search"
  };
}

const jobSearchModule = loadJobSearchModule();

const NOW = new Date("2026-07-11T12:00:00.000Z");

const OPPORTUNITY: OpportunityInput = {
  adapterId: "greenhouse",
  externalId: "gh-1",
  posting: { title: "Engineer", company: "Acme", description: "Build things." }
};
const OPPORTUNITY_HASH = opportunityIdentity(OPPORTUNITY);

/** Domain KV port over the real RPC handler — scope pinned to "user". */
function kvForActor(
  actorUserId: string,
  options?: { toolRisk?: "read" | "write"; admin?: boolean }
): JobSearchKv {
  const rpc = createExternalModuleRpcHandler({
    module: jobSearchModule,
    toolRisk: options?.toolRisk ?? "write",
    actorUserId,
    requestId: `kv-isolation-${actorUserId.slice(-4)}`,
    workerDataContext: new DataContextRunner(workerDb),
    cipher: createModuleCredentialSecretCipher(),
    isActorAdmin: async () => options?.admin ?? false
  });
  const noSecret = (): void => undefined;
  return {
    get: (namespace, key) =>
      rpc("kv.get", { scope: "user", namespace, key }, noSecret) as Promise<Record<
        string,
        unknown
      > | null>,
    set: (namespace, key, value) =>
      rpc("kv.set", { scope: "user", namespace, key, value }, noSecret) as Promise<void>,
    delete: (namespace, key) =>
      rpc("kv.delete", { scope: "user", namespace, key }, noSecret) as Promise<boolean>,
    list: (namespace) =>
      rpc("kv.list", { scope: "user", namespace }, noSecret) as Promise<readonly string[]>
  };
}

/** Worker-role SQL with actor/module GUCs set — the RLS path modules run under. */
async function workerQuery<T>(actorUserId: string, moduleId: string, query: string): Promise<T[]> {
  const client = new Client({ connectionString: connectionStrings.worker });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.actor_user_id', $1, true)", [actorUserId]);
    await client.query("SELECT set_config('app.current_module_id', $1, true)", [moduleId]);
    const result = await client.query(query);
    await client.query("ROLLBACK");
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

async function bootstrapJobSearchRows(): Promise<
  Array<{ owner_user_id: string; namespace: string; key: string; value: string }>
> {
  const result = await bootstrap.query<{
    owner_user_id: string;
    namespace: string;
    key: string;
    value: string;
  }>(
    `SELECT owner_user_id, namespace, key, value::text AS value
     FROM app.module_kv WHERE module_id = 'job-search'
     ORDER BY owner_user_id, namespace, key`
  );
  return result.rows;
}

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
