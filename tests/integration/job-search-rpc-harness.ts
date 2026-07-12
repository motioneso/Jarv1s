// tests/integration/job-search-rpc-harness.ts
//
// Shared harness for job-search integration suites that exercise the module
// domain over the REAL external-module RPC host (the same kv path a spawned
// worker process uses), instead of stubbing kv in-memory. Extracted from
// external-module-job-search-kv-isolation.test.ts so every suite pins the
// same production wiring — and so no single test file outgrows the
// 1000-line file-size gate.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import type { Kysely } from "kysely";

import { DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { validateExternalModuleManifest } from "@jarv1s/module-registry";
import { createExternalModuleRpcHandler } from "@jarv1s/module-registry/node";
import { createModuleCredentialSecretCipher } from "@jarv1s/settings";
import type { ExternalModuleDiscovery } from "../../packages/module-registry/src/external/types.js";

import type { JobSearchKv } from "../../external-modules/job-search/src/domain/index.js";
import { connectionStrings } from "./test-database.js";

const { Client } = pg;

/** Real module source dir — contains jarvis.module.json and (after a build) dist/worker.js. */
export const jobSearchSourceDir = fileURLToPath(
  new URL("../../external-modules/job-search", import.meta.url)
);

// Parse the SHIPPED manifest through the real validator so a suite's declared
// namespaces cannot drift from what production would enforce. `dir` matters
// only to suites that spawn the worker runtime — pass jobSearchSourceDir there.
export function loadJobSearchModule(dir = "/unused"): ExternalModuleDiscovery {
  const raw = JSON.parse(
    readFileSync(join(jobSearchSourceDir, "jarvis.module.json"), "utf8")
  ) as Record<string, unknown>;
  const result = validateExternalModuleManifest(raw, "job-search", "0.1.0");
  if (!result.ok) {
    throw new Error(`shipped manifest failed validation: ${JSON.stringify(result.errors)}`);
  }
  return {
    id: "job-search",
    dir,
    manifest: result.manifest,
    manifestHash: "sha256:job-search",
    packageHash: "sha256:job-search"
  };
}

export interface KvActorOptions {
  toolRisk?: "read" | "write";
  admin?: boolean;
}

/** Domain KV port over the real RPC handler — scope pinned to "user". */
export function kvForActor(
  context: {
    module: ExternalModuleDiscovery;
    workerDb: Kysely<JarvisDatabase>;
    requestIdPrefix: string;
  },
  actorUserId: string,
  options?: KvActorOptions
): JobSearchKv {
  const rpc = createExternalModuleRpcHandler({
    module: context.module,
    toolRisk: options?.toolRisk ?? "write",
    actorUserId,
    requestId: `${context.requestIdPrefix}-${actorUserId.slice(-4)}`,
    workerDataContext: new DataContextRunner(context.workerDb),
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
export async function workerQuery<T>(
  actorUserId: string,
  moduleId: string,
  query: string
): Promise<T[]> {
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

/** Every job-search module_kv row, read as bootstrap (RLS-exempt ground truth). */
export async function bootstrapJobSearchRows(
  bootstrap: pg.Client
): Promise<Array<{ owner_user_id: string; namespace: string; key: string; value: string }>> {
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
