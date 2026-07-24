import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import {
  createModuleCredentialSecretCipher,
  deleteModuleKvKey,
  getModuleKvValue,
  listModuleKvKeys,
  setModuleKvValue
} from "@jarv1s/settings";
import {
  createExternalModuleRpcHandler,
  ExternalModuleWorkerRuntime,
  getExternalModuleRegistrations,
  validateExternalModuleManifest
} from "@jarv1s/module-registry/node";

import { createApiServer } from "../../apps/api/src/server.js";
import { buildExternalModule } from "../../scripts/build-external-module.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const sourceDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

let appDb: Kysely<JarvisDatabase>;
let workerDb: Kysely<JarvisDatabase>;
let server: ReturnType<typeof createApiServer>;
let moduleDir: string;
let cookie: string;
let userId: string;

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
  await buildExternalModule(sourceDir);

  const root = mkdtempSync(join(tmpdir(), "job-search-module-"));
  moduleDir = join(root, "modules");
  mkdirSync(join(moduleDir, "job-search"), { recursive: true });
  cpSync(join(sourceDir, "jarvis.module.json"), join(moduleDir, "job-search/jarvis.module.json"));
  cpSync(join(sourceDir, "dist"), join(moduleDir, "job-search/dist"), { recursive: true });

  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  workerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 1 });
  server = createApiServer({
    appDb,
    logger: false,
    apiServerConfig: {
      host: "0.0.0.0",
      port: 0,
      mcpServerUrl: "http://127.0.0.1:0/api/mcp",
      externalModulesDir: moduleDir
    }
  });
  await server.ready();

  const signedUp = await signUp(server);
  cookie = signedUp.cookie;
  userId = signedUp.userId;
  const enabled = await server.inject({
    method: "POST",
    url: "/api/admin/external-modules/job-search",
    headers: { cookie, "content-type": "application/json" },
    payload: { enabled: true }
  });
  expect(enabled.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await Promise.allSettled([server?.close(), appDb?.destroy(), workerDb?.destroy()]);
  if (moduleDir) rmSync(moduleDir, { recursive: true, force: true });
});

async function seedKv(
  namespace: string,
  key: string,
  value: Record<string, unknown>
): Promise<void> {
  await new DataContextRunner(workerDb).withDataContext(
    { actorUserId: userId, requestId: `job-search-seed-${key}` },
    async (scopedDb) => {
      await sql`SELECT set_config('app.current_module_id', ${"job-search"}, true)`.execute(
        scopedDb.db
      );
      await setModuleKvValue(
        scopedDb,
        {
          moduleId: "job-search",
          namespace,
          scope: "user",
          ownerUserId: userId,
          key
        },
        value
      );
    }
  );
}

function invokeTool(name: string) {
  return server.inject({
    method: "POST",
    url: `/api/ai/assistant-tools/${name}/invoke`,
    headers: { cookie, "content-type": "application/json" },
    payload: { input: {} }
  });
}

describe("Job Search module activation (#1232)", () => {
  it("installs and enables through the real path, then lists a seeded profile", async () => {
    await seedKv("job-search.profiles", "profile-1", {
      id: "profile-1",
      title: "Operations leadership",
      status: "building"
    });

    const response = await invokeTool("job-search.profiles.list");
    expect(response.statusCode).toBe(200);
    expect(response.json().invocation).toMatchObject({
      status: "succeeded",
      result: {
        profiles: [{ id: "profile-1", title: "Operations leadership", status: "building" }]
      }
    });
  });

  it("runs the reset handler over the real worker runtime and clears every namespace", async () => {
    const namespaces = [
      "job-search.profiles",
      "job-search.resume",
      "job-search.sources",
      "job-search.candidates",
      "job-search.matches",
      "job-search.feedback",
      "job-search.settings",
      "job-search.meta"
    ];
    for (const namespace of namespaces)
      await seedKv(namespace, `stale-${namespace}`, { stale: true });

    const rawManifest = JSON.parse(
      readFileSync(join(moduleDir, "job-search/jarvis.module.json"), "utf8")
    ) as Record<string, unknown>;
    const validated = validateExternalModuleManifest(rawManifest, "job-search", "0.1.0");
    if (!validated.ok) throw new Error(validated.errors.join(", "));
    const discovery = getExternalModuleRegistrations({
      modulesDir: moduleDir,
      coreVersion: "0.1.0"
    }).discoveries[0];
    if (!discovery) throw new Error("Job Search discovery missing");
    const runtime = new ExternalModuleWorkerRuntime({ invocationTimeoutMs: 10_000 });
    const rpc = async (method: string, params: unknown) => {
      const value = params as {
        scope: "user";
        namespace: string;
        key?: string;
        value?: Record<string, unknown>;
      };
      return new DataContextRunner(workerDb).withDataContext(
        { actorUserId: userId, requestId: "job-search-reset-runtime" },
        async (scopedDb) => {
          await sql`SELECT set_config('app.current_module_id', ${"job-search"}, true)`.execute(
            scopedDb.db
          );
          const base = {
            moduleId: "job-search",
            namespace: value.namespace,
            scope: value.scope,
            ownerUserId: userId
          } as const;
          if (method === "kv.get") return getModuleKvValue(scopedDb, { ...base, key: value.key! });
          if (method === "kv.list") return listModuleKvKeys(scopedDb, base);
          if (method === "kv.delete")
            return deleteModuleKvKey(scopedDb, { ...base, key: value.key! });
          if (method === "kv.set")
            return setModuleKvValue(scopedDb, { ...base, key: value.key! }, value.value!);
          throw new Error("unexpected rpc");
        }
      );
    };

    try {
      await runtime.invoke(discovery, "reset", { jobKind: "job-search.reset" }, rpc);
      for (const namespace of namespaces) {
        await expect(
          new DataContextRunner(workerDb).withDataContext(
            { actorUserId: userId, requestId: `job-search-reset-check-${namespace}` },
            async (scopedDb) => {
              await sql`SELECT set_config('app.current_module_id', ${"job-search"}, true)`.execute(
                scopedDb.db
              );
              return listModuleKvKeys(scopedDb, {
                moduleId: "job-search",
                namespace,
                scope: "user",
                ownerUserId: userId
              });
            }
          )
        ).resolves.toEqual(namespace === "job-search.meta" ? ["resetDone"] : []);
      }
    } finally {
      await runtime.close();
    }
  });

  it("keeps intake, critique, and approval owner-scoped over the real worker runtime", async () => {
    const other = await signUp(server);
    const discovery = getExternalModuleRegistrations({
      modulesDir: moduleDir,
      coreVersion: "0.1.0"
    }).discoveries[0];
    if (!discovery) throw new Error("Job Search discovery missing");

    const runtime = new ExternalModuleWorkerRuntime({ invocationTimeoutMs: 10_000 });
    const resumeText = "Led a migration from a legacy platform. Managed a team of six engineers.";
    const calls: string[] = [];
    const invokeFor = (actorUserId: string, handler: string, input: Record<string, unknown>) => {
      const rpc = createExternalModuleRpcHandler({
        module: discovery,
        toolRisk: "write",
        actorUserId,
        requestId: `job-search-resume-${actorUserId}-${handler}`,
        workerDataContext: new DataContextRunner(workerDb),
        cipher: createModuleCredentialSecretCipher(),
        isActorAdmin: async () => false,
        ai: async (_scopedDb, request) => {
          calls.push(request.tierHint ?? "missing");
          return {
            ok: true as const,
            object: {
              critique: [{ section: "Experience", text: "Keep the scope visible." }],
              revisions: [
                {
                  section: "Summary",
                  before: "Led a migration",
                  after: "Led a platform migration with clear outcomes.",
                  evidence: "Led a migration"
                }
              ],
              strengths: [{ text: "Migration leadership", evidence: "Led a migration" }],
              gaps: [{ text: "Cloud certification" }]
            }
          };
        }
      });
      return runtime.invoke(discovery, handler, input, rpc);
    };

    const readResume = (actorUserId: string) =>
      new DataContextRunner(workerDb).withDataContext(
        { actorUserId, requestId: `job-search-resume-read-${actorUserId}` },
        async (scopedDb) => {
          await sql`SELECT set_config('app.current_module_id', ${"job-search"}, true)`.execute(
            scopedDb.db
          );
          return getModuleKvValue(scopedDb, {
            moduleId: "job-search",
            namespace: "job-search.resume",
            scope: "user",
            ownerUserId: actorUserId,
            key: "record"
          });
        }
      );

    try {
      await invokeFor(userId, "resume.intake", { source: "paste", text: resumeText });
      const critique = (await invokeFor(userId, "resume.critique", {})) as {
        status: string;
        revisionId: string;
      };
      expect(critique.status).toBe("ok");
      expect(calls).toEqual(["reasoning"]);

      const approved = (await invokeFor(userId, "resume-revise", {
        params: { revisionId: critique.revisionId }
      })) as { status: string; state: string };
      expect(approved).toMatchObject({ status: "ok", state: "approved" });

      await expect(readResume(other.userId)).resolves.toBeNull();
      await expect(readResume(userId)).resolves.toMatchObject({
        current: {
          status: "approved",
          text: "Led a platform migration with clear outcomes. from a legacy platform. Managed a team of six engineers."
        },
        revisions: [
          { kind: "source" },
          { kind: "review", artifact: { strengths: [{ evidence: "Led a migration" }] } },
          {
            kind: "approved",
            sourceText:
              "Led a platform migration with clear outcomes. from a legacy platform. Managed a team of six engineers."
          }
        ]
      });
    } finally {
      await runtime.close();
    }
  });
});

let signUpCount = 0;

async function signUp(
  target: ReturnType<typeof createApiServer>
): Promise<{ cookie: string; userId: string }> {
  const response = await target.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json" },
    payload: {
      name: "Job Search Owner",
      email: `job-search-js01-${++signUpCount}@example.test`,
      password: "correct horse battery staple"
    }
  });
  if (response.statusCode !== 200) throw new Error(`sign-up failed: ${response.body}`);
  const setCookie = response.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return {
    cookie: cookies.map((item) => item.split(";")[0]).join("; "),
    userId: response.json<{ user: { id: string } }>().user.id
  };
}
