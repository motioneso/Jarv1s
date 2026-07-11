import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import {
  createExternalModuleRpcHandler,
  ExternalModuleRpcError
} from "@jarv1s/module-registry/node";
import { createModuleCredentialSecretCipher } from "@jarv1s/settings";
import type { Kysely } from "kysely";

import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;
let bootstrap: pg.Client;
let workerDb: Kysely<JarvisDatabase>;

beforeAll(async () => {
  await resetFoundationDatabase();
  bootstrap = new Client({ connectionString: connectionStrings.bootstrap });
  await bootstrap.connect();
  workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
  await bootstrap.query(`
    INSERT INTO app.external_modules (id, status, manifest_hash, package_hash, enabled_at, enabled_by)
    VALUES
      ('acme-a', 'enabled', 'sha256:a', 'sha256:a', now(), '${ids.adminUser}'),
      ('acme-b', 'enabled', 'sha256:b', 'sha256:b', now(), '${ids.adminUser}'),
      ('acme-off', 'disabled', 'sha256:c', 'sha256:c', NULL, NULL);
    INSERT INTO app.module_credentials
      (module_id, credential_id, scope, owner_user_id, display_name, encrypted_secret, created_by)
    VALUES
      ('acme-a', 'acme-a.shared', 'instance', NULL, 'A', '{"ciphertext":"a"}', '${ids.adminUser}'),
      ('acme-b', 'acme-b.shared', 'instance', NULL, 'B', '{"ciphertext":"b"}', '${ids.adminUser}'),
      ('acme-a', 'acme-a.user', 'user', '${ids.userA}', 'A user', '{"ciphertext":"u"}', '${ids.userA}');
    INSERT INTO app.module_kv (module_id, namespace, scope, owner_user_id, key, value)
    VALUES
      ('acme-a', 'acme-a.state', 'instance', NULL, 'shared', '{"v":1}'),
      ('acme-b', 'acme-b.state', 'instance', NULL, 'shared', '{"v":2}'),
      ('acme-a', 'acme-a.state', 'user', '${ids.userA}', 'mine', '{"v":3}');
  `);
  const envelope = createModuleCredentialSecretCipher().encryptJson({ value: "runtime-secret" });
  await bootstrap.query(
    `UPDATE app.module_credentials SET encrypted_secret = $1::jsonb
     WHERE module_id = 'acme-a' AND credential_id = 'acme-a.shared'`,
    [JSON.stringify(envelope)]
  );
});

afterAll(async () => Promise.allSettled([bootstrap?.end(), workerDb?.destroy()]));

const moduleA = {
  id: "acme-a",
  dir: "/unused",
  manifest: {
    schemaVersion: 1 as const,
    id: "acme-a",
    name: "Acme A",
    version: "1.0.0",
    publisher: "Acme",
    lifecycle: "optional" as const,
    compatibility: { jarv1s: ">=0.0.0" },
    auth: [
      {
        id: "acme-a.shared",
        displayName: "Shared",
        kind: "api-key" as const,
        scope: "instance" as const
      }
    ],
    storage: [{ namespace: "acme-a.state", scopes: ["instance", "user"] as const }],
    fetchHosts: ["api.example.com"]
  },
  manifestHash: "sha256:a",
  packageHash: "sha256:a"
};

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

describe("external module worker RLS", () => {
  it("binds credential and KV reads to enabled module plus invoking actor", async () => {
    const credentials = await workerQuery<{ module_id: string; credential_id: string }>(
      ids.userA,
      "acme-a",
      "SELECT module_id, credential_id FROM app.module_credentials ORDER BY credential_id"
    );
    expect(credentials).toEqual([
      { module_id: "acme-a", credential_id: "acme-a.shared" },
      { module_id: "acme-a", credential_id: "acme-a.user" }
    ]);
    const kv = await workerQuery<{ module_id: string; key: string }>(
      ids.userA,
      "acme-a",
      "SELECT module_id, key FROM app.module_kv ORDER BY key"
    );
    expect(kv).toEqual([
      { module_id: "acme-a", key: "mine" },
      { module_id: "acme-a", key: "shared" }
    ]);
  });

  it("denies userB access to userA credential and KV rows", async () => {
    expect(
      await workerQuery<{ credential_id: string }>(
        ids.userB,
        "acme-a",
        "SELECT credential_id FROM app.module_credentials ORDER BY credential_id"
      )
    ).toEqual([{ credential_id: "acme-a.shared" }]);
    expect(
      await workerQuery<{ key: string }>(
        ids.userB,
        "acme-a",
        "SELECT key FROM app.module_kv ORDER BY key"
      )
    ).toEqual([{ key: "shared" }]);
  });

  it("returns no rows for a disabled or missing module context", async () => {
    expect(
      await workerQuery(ids.userA, "acme-off", "SELECT module_id FROM app.module_credentials")
    ).toEqual([]);
    expect(await workerQuery(ids.userA, "", "SELECT module_id FROM app.module_kv")).toEqual([]);
  });

  it("proxies declared credentials without retaining plaintext", async () => {
    const remembered: string[] = [];
    const rpc = createExternalModuleRpcHandler({
      module: moduleA,
      toolRisk: "read",
      actorUserId: ids.userA,
      requestId: "rpc-auth",
      workerDataContext: new DataContextRunner(workerDb),
      cipher: createModuleCredentialSecretCipher(),
      isActorAdmin: async () => false
    });
    await expect(
      rpc("auth.getCredential", { authId: "acme-a.shared" }, (value) => remembered.push(value))
    ).resolves.toBe("runtime-secret");
    expect(remembered).toEqual(["runtime-secret"]);
    await expect(
      rpc("auth.getCredential", { authId: "acme-b.shared" }, () => undefined)
    ).rejects.toMatchObject({ code: "undeclared_auth" });

    await bootstrap.query(
      `UPDATE app.module_credentials SET encrypted_secret = NULL, revoked_at = now()
       WHERE module_id = 'acme-a' AND credential_id = 'acme-a.shared'`
    );
    await expect(
      rpc("auth.getCredential", { authId: "acme-a.shared" }, () => undefined)
    ).rejects.toMatchObject({ code: "credential_missing" });
  });

  it("allows declared KV reads but denies read-tool and non-admin instance mutations", async () => {
    const base = {
      module: moduleA,
      actorUserId: ids.userA,
      requestId: "rpc-kv",
      workerDataContext: new DataContextRunner(workerDb),
      cipher: createModuleCredentialSecretCipher(),
      isActorAdmin: async () => false
    };
    const read = createExternalModuleRpcHandler({ ...base, toolRisk: "read" });
    await expect(
      read("kv.get", { scope: "user", namespace: "acme-a.state", key: "mine" }, () => undefined)
    ).resolves.toEqual({ v: 3 });
    await expect(
      read(
        "kv.set",
        { scope: "user", namespace: "acme-a.state", key: "new", value: { v: 4 } },
        () => undefined
      )
    ).rejects.toBeInstanceOf(ExternalModuleRpcError);

    const write = createExternalModuleRpcHandler({ ...base, toolRisk: "write" });
    await expect(
      write(
        "kv.set",
        { scope: "instance", namespace: "acme-a.state", key: "new", value: { v: 4 } },
        () => undefined
      )
    ).rejects.toMatchObject({ code: "forbidden_instance_kv_write" });
    await expect(
      write(
        "kv.set",
        { scope: "user", namespace: "acme-a.state", key: "new", value: { v: 4 } },
        () => undefined
      )
    ).resolves.toBeUndefined();
  });

  it("projects host-pinned fetch responses onto the bounded wire DTO", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const rpc = createExternalModuleRpcHandler({
      module: moduleA,
      toolRisk: "write",
      actorUserId: ids.userA,
      requestId: "rpc-fetch",
      workerDataContext: new DataContextRunner(workerDb),
      cipher: createModuleCredentialSecretCipher(),
      isActorAdmin: async () => false,
      createFetch: () => async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "x-private": "drop" }
        });
      }
    });

    await expect(
      rpc("fetch.request", { url: "https://api.example.com/data" }, () => undefined)
    ).resolves.toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      bodyBase64: "e30="
    });
    expect(requests).toEqual([{ input: "https://api.example.com/data", init: { method: "GET" } }]);
  });
});
