// Task 21 (#1305) tests 6, 9, 11: the REAL API server (server.inject, never a live port — see
// external-modules-routes.test.ts) plus the REAL ExternalModuleWorkerRuntime (a real spawned
// child process, never the stub-runtime pattern tests/integration/job-search.test.ts's synthetic
// briefing fixture uses). Split into its own file (not appended to job-search.test.ts) purely to
// stay under the file-size gate's 1000-line cap — this describe owns its own independent
// installModule()/dist-build/server lifecycle, so the split has no cross-file coupling.
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { OutgoingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { collectExternalBriefingContributions } from "@jarv1s/briefings";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { createPgBossClient } from "@jarv1s/jobs";
import {
  validateExternalModuleManifest,
  type ExternalModuleDiscovery
} from "@jarv1s/module-registry";
import { ExternalModuleWorkerRuntime } from "@jarv1s/module-registry/node";
import type { JsonJarvisModuleManifest } from "@jarv1s/module-sdk";
import { createModuleCredentialSecretCipher } from "@jarv1s/settings";
import type { Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createExternalBriefingInvoker } from "../../apps/worker/src/external-module-invoke.js";
import { installModule } from "../../scripts/module-install.js";
import { buildExternalModule } from "../../scripts/build-external-module.js";
import {
  moduleInstallRoleName,
  moduleRuntimeRoleName
} from "../../packages/db/src/module-role-broker.js";
import { JOB_SEARCH_TABLES } from "../../external-modules/job-search/src/db/tables.js";
import { connectionStrings, resetEmptyFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// resetFoundationDatabase() (seeded via seedProbeData) inserts 3 users directly via raw SQL,
// none with is_bootstrap_owner set — bypassing packages/auth's bootstrap path entirely. That
// makes bootstrapOwnerExists() report false forever, so the real sign-up below tries to
// self-promote to admin and app.users_guard_admin_flag() (migration 0053, #97) correctly
// rejects it: its exemption only fires at count_all_users() = 1, not "no flagged owner yet".
// This file mints its own admin from the sign-up response and never touches seedProbeData's
// rows, so resetEmptyFoundationDatabase() is both correct and matches every other integration
// suite that performs a real self-service sign-up (api-rate-limit, chat-multiplexer-admin,
// me-sessions, news-personalization-repository) — none of them use the seeded reset either.
beforeAll(async () => {
  await resetEmptyFoundationDatabase();
});

describe("job-search module through the real API + worker RPC surface (#1305, tests 6/9/11)", () => {
  const realModuleId = "job-search";
  const runtimeRole = moduleRuntimeRoleName(realModuleId);
  const ownedTables = JOB_SEARCH_TABLES.map((table) => `app.${table}`);
  const sourceDir = fileURLToPath(new URL("../../external-modules/job-search", import.meta.url));

  let root: string;
  let appDb: Kysely<JarvisDatabase>;
  let heavyWorkerDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let adminCookie: string;
  let adminUserId: string;
  let realManifest: JsonJarvisModuleManifest;
  let realDiscovery: ExternalModuleDiscovery;
  let workerRuntime: ExternalModuleWorkerRuntime;

  beforeAll(async () => {
    await installModule({
      moduleId: realModuleId,
      manifest: { database: { ownedTables } },
      bootstrapConnectionString: connectionStrings.bootstrap,
      migrationConnectionString: connectionStrings.migration,
      migrationsDirectory: "external-modules/job-search/sql"
    });

    await buildExternalModule(sourceDir);
    root = mkdtempSync(join(tmpdir(), "job-search-tierb-"));
    const modulesDir = join(root, "modules");
    const installedDir = join(modulesDir, "job-search");
    mkdirSync(installedDir, { recursive: true });
    cpSync(join(sourceDir, "jarvis.module.json"), join(installedDir, "jarvis.module.json"));
    cpSync(join(sourceDir, "dist"), join(installedDir, "dist"), { recursive: true });

    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    heavyWorkerDb = createDatabase({ connectionString: connectionStrings.worker, maxConnections: 4 });
    server = createApiServer({
      appDb,
      logger: false,
      apiServerConfig: {
        host: "0.0.0.0",
        port: 0,
        mcpServerUrl: "http://127.0.0.1:0/api/mcp",
        externalModulesDir: modulesDir
      }
    });
    await server.ready();

    const admin = await signUp(server, "owner@job-search-tierb.test", "Owner");
    adminCookie = admin.cookie;
    adminUserId = admin.userId;
    const enable = await server.inject({
      method: "POST",
      url: "/api/admin/external-modules/job-search",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { enabled: true }
    });
    expect(enable.statusCode).toBe(200);

    // Real hashes, not synthetic ones: createVerifiedExternalModuleInvoker's gate (test 11
    // runs through it via createExternalBriefingInvoker) checks both against this row, so a
    // hand-picked hash here would make the gate the thing under test instead of the handler.
    const row = await appDb
      .selectFrom("app.external_modules")
      .select(["manifest_hash", "package_hash"])
      .where("id", "=", realModuleId)
      .executeTakeFirstOrThrow();
    const raw: unknown = JSON.parse(readFileSync(join(sourceDir, "jarvis.module.json"), "utf8"));
    const validation = validateExternalModuleManifest(raw, "job-search", "0.1.0");
    if (!validation.ok) {
      throw new Error(`job-search manifest failed validation: ${validation.errors.join(", ")}`);
    }
    realManifest = validation.manifest;
    realDiscovery = {
      id: realModuleId,
      dir: sourceDir,
      manifest: realManifest,
      manifestHash: row.manifest_hash,
      packageHash: row.package_hash
    };
    workerRuntime = new ExternalModuleWorkerRuntime();
  }, 120_000);

  afterAll(async () => {
    await workerRuntime?.close();
    await Promise.allSettled([server?.close(), appDb?.destroy(), heavyWorkerDb?.destroy()]);
    rmSync(root, { recursive: true, force: true });

    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      for (const table of ownedTables) {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
      await client.query(
        `REVOKE ALL PRIVILEGES ON SCHEMA app FROM ${moduleInstallRoleName(realModuleId)} CASCADE`
      );
      await client.query(
        `REVOKE ALL PRIVILEGES ON app.users FROM ${moduleInstallRoleName(realModuleId)}`
      );
      await client.query(
        `REVOKE REFERENCES (id) ON app.users FROM ${moduleInstallRoleName(realModuleId)}`
      );
      await client.query(
        `REVOKE EXECUTE ON FUNCTION app.current_actor_user_id() FROM ` +
          `${moduleInstallRoleName(realModuleId)} CASCADE`
      );
      await client
        .query(`DROP ROLE IF EXISTS ${moduleInstallRoleName(realModuleId)}`)
        .catch(() => {});
      await client.query(`DROP ROLE IF EXISTS ${runtimeRole}`).catch(() => {});
      await client.query("DELETE FROM app.module_installs WHERE module_id = $1", [realModuleId]);
      await client.query("DELETE FROM app.module_schema_migrations WHERE module_id = $1", [
        realModuleId
      ]);
    } finally {
      await client.end();
    }
  });

  async function asHeavyRuntime<T>(
    actorUserId: string,
    fn: (client: pg.Client) => Promise<T>
  ): Promise<T> {
    const client = new Client({ connectionString: connectionStrings.worker });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${runtimeRole}`);
      await client.query("SELECT set_config('app.actor_user_id', $1, true)", [actorUserId]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      await client.end();
    }
  }

  it("test 6: manual-run enqueues a metadata-only job and dedupes a duplicate call", async () => {
    const profileId = randomUUID();
    await asHeavyRuntime(adminUserId, (client) =>
      client.query(
        `INSERT INTO app.job_search_profiles (id, owner_user_id, name, state)
         VALUES ($1, $2, 'Staff Engineer search', 'active')`,
        [profileId, adminUserId]
      )
    );

    // No reconciler runs in this harness, so the queue must exist before manual-run can enqueue
    // into it — same precondition external-modules-routes.test.ts's own manual-run test relies on.
    const migrationBoss = createPgBossClient(connectionStrings.migration);
    await migrationBoss.start();
    await migrationBoss.createQueue("job-search.crawl-run");
    await migrationBoss.stop({ graceful: false });

    const run = await server.inject({
      method: "POST",
      url: "/api/modules/job-search/queues/job-search.crawl-run/run",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { jobKind: "job-search.crawl-run", params: { profileId } }
    });
    expect(run.statusCode).toBe(202);
    expect(run.json()).toEqual({ jobId: expect.any(String) });

    // Same singleton window, called again immediately: the production dedupe path, not a
    // second distinct job.
    const duplicateRun = await server.inject({
      method: "POST",
      url: "/api/modules/job-search/queues/job-search.crawl-run/run",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { jobKind: "job-search.crawl-run", params: { profileId } }
    });
    expect(duplicateRun.statusCode).toBe(202);
    expect(duplicateRun.json()).toEqual({ jobId: null });

    const payloadClient = new Client({ connectionString: connectionStrings.bootstrap });
    await payloadClient.connect();
    try {
      const payload = await payloadClient.query<{ data: Record<string, unknown> }>(
        `SELECT data FROM pgboss.job_common WHERE name = 'job-search.crawl-run'
         ORDER BY created_on DESC LIMIT 1`
      );
      // Metadata-only whitelist (CLAUDE.md hard invariant): actor/resource ids, job kind,
      // manifest hash, and the small command param — never posting bodies, prompts, or secrets.
      expect(payload.rows[0]?.data).toEqual({
        actorUserId: adminUserId,
        moduleId: "job-search",
        jobKind: "job-search.crawl-run",
        manifestHash: realDiscovery.manifestHash,
        params: { profileId }
      });
    } finally {
      await payloadClient.end();
    }
  });

  it("test 9: matches.list is exposed and invocable exactly as the manifest declares it", async () => {
    const toolsResponse = await server.inject({
      method: "GET",
      url: "/api/ai/assistant-tools",
      headers: { cookie: adminCookie }
    });
    expect(toolsResponse.statusCode).toBe(200);
    const jobSearchTools = toolsResponse
      .json<{ tools: Array<{ moduleId: string; name: string }> }>()
      .tools.filter((tool) => tool.moduleId === "job-search");
    // Derived from the manifest, never hardcoded (#1305 requirement) — a renamed or removed
    // tool must fail here, not silently at invoke time (see prose-tool-names-unvalidated).
    expect(jobSearchTools.map((tool) => tool.name).sort()).toEqual(
      [...realManifest.assistantTools!.map((tool) => tool.name)].sort()
    );

    const profileId = randomUUID();
    const postingId = randomUUID();
    const matchId = randomUUID();
    await asHeavyRuntime(adminUserId, async (client) => {
      await client.query(
        `INSERT INTO app.job_search_profiles (id, owner_user_id, name, state)
         VALUES ($1, $2, 'Staff Engineer search', 'active')`,
        [profileId, adminUserId]
      );
      await client.query(
        `INSERT INTO app.job_search_postings
           (id, owner_user_id, profile_id, source_id, external_id, title, company, location, url, body)
         VALUES ($1, $2, $3, 'linkedin', $4, 'Staff Engineer', 'Acme', 'Remote',
                 'https://www.linkedin.com/jobs/1', 'Job body text')`,
        [postingId, adminUserId, profileId, postingId]
      );
      await client.query(
        `INSERT INTO app.job_search_matches (id, owner_user_id, profile_id, posting_id, fit, want, state)
         VALUES ($1, $2, $3, $4, 70, 80, 'new')`,
        [matchId, adminUserId, profileId, postingId]
      );
    });

    const invoke = await server.inject({
      method: "POST",
      url: "/api/ai/assistant-tools/job-search.matches.list/invoke",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { input: { profileId, limit: 15 } }
    });
    expect(invoke.statusCode).toBe(200);
    const invocation = invoke.json<{
      invocation: { status: string; result: { items: Array<{ id: string }> } };
    }>().invocation;
    expect(invocation.status).toBe("succeeded");
    expect(invocation.result.items.map((item) => item.id)).toContain(matchId);
  });

  // Test 11: three separate actors, one active profile each, so "most generous detail wins"
  // (briefing.ts) is trivially that profile's own briefingDetail — no need for a second profile
  // per actor to make the assertion real.
  async function seedBriefingScenario(
    detail: "count" | "top" | "full"
  ): Promise<{ actorUserId: string; profileId: string; matchIds: readonly string[] }> {
    const actor = await signUp(
      server,
      `briefing-${detail}-${randomUUID()}@job-search-tierb.test`,
      "Owner"
    );
    const profileId = randomUUID();
    const wants = [90, 70, 50, 30];
    const matchIds: string[] = [];
    await asHeavyRuntime(actor.userId, async (client) => {
      await client.query(
        `INSERT INTO app.job_search_profiles (id, owner_user_id, name, state, briefing_detail)
         VALUES ($1, $2, 'Staff Engineer search', 'active', $3)`,
        [profileId, actor.userId, detail]
      );
      for (const want of wants) {
        const postingId = randomUUID();
        const matchId = randomUUID();
        matchIds.push(matchId);
        await client.query(
          `INSERT INTO app.job_search_postings
             (id, owner_user_id, profile_id, source_id, external_id, title, company, location, url, body)
           VALUES ($1, $2, $3, 'linkedin', $4, $5, 'Acme', 'Remote',
                   'https://www.linkedin.com/jobs/' || $4, 'Job body text')`,
          [postingId, actor.userId, profileId, postingId, `Role Want ${want}`]
        );
        await client.query(
          `INSERT INTO app.job_search_matches (id, owner_user_id, profile_id, posting_id, fit, want, state)
           VALUES ($1, $2, $3, $4, 70, $5, 'new')`,
          [matchId, actor.userId, profileId, postingId, want]
        );
      }
    });
    return { actorUserId: actor.userId, profileId, matchIds };
  }

  it("test 11 (count): a count-detail profile contributes no items, only the headline", async () => {
    const scenario = await seedBriefingScenario("count");
    const invoke = createExternalBriefingInvoker({
      workerDb: heavyWorkerDb,
      discoveryById: new Map([[realModuleId, realDiscovery]]),
      dataContext: new DataContextRunner(heavyWorkerDb),
      cipher: createModuleCredentialSecretCipher(),
      runtime: workerRuntime,
      listActiveUserIds: async () => [scenario.actorUserId]
    });
    const result = await collectExternalBriefingContributions({
      manifests: [realManifest],
      selectedToolNames: [realManifest.briefing!.toolName],
      section: "morning",
      actorUserId: scenario.actorUserId,
      requestId: `req-briefing-count-${scenario.profileId}`,
      invoke
    });
    expect(result).toEqual([
      { moduleId: realModuleId, headline: "4 new job matches in Staff Engineer search.", items: [] }
    ]);
  });

  it("test 11 (top): a top-detail profile contributes its 3 highest-want matches", async () => {
    const scenario = await seedBriefingScenario("top");
    const invoke = createExternalBriefingInvoker({
      workerDb: heavyWorkerDb,
      discoveryById: new Map([[realModuleId, realDiscovery]]),
      dataContext: new DataContextRunner(heavyWorkerDb),
      cipher: createModuleCredentialSecretCipher(),
      runtime: workerRuntime,
      listActiveUserIds: async () => [scenario.actorUserId]
    });
    const result = await collectExternalBriefingContributions({
      manifests: [realManifest],
      selectedToolNames: [realManifest.briefing!.toolName],
      section: "morning",
      actorUserId: scenario.actorUserId,
      requestId: `req-briefing-top-${scenario.profileId}`,
      invoke
    });
    expect(result).toEqual([
      {
        moduleId: realModuleId,
        headline: "4 new job matches in Staff Engineer search.",
        items: [90, 70, 50].map((want) => ({
          id: expect.any(String),
          title: `Role Want ${want} at Acme`,
          detail: `Fit 70 · Want ${want}`,
          href: expect.stringMatching(
            new RegExp(`^/m/job-search/${scenario.profileId}/matches/.+$`)
          )
        }))
      }
    ]);
  });

  it("test 11 (full): a full-detail profile contributes all 4 matches", async () => {
    const scenario = await seedBriefingScenario("full");
    const invoke = createExternalBriefingInvoker({
      workerDb: heavyWorkerDb,
      discoveryById: new Map([[realModuleId, realDiscovery]]),
      dataContext: new DataContextRunner(heavyWorkerDb),
      cipher: createModuleCredentialSecretCipher(),
      runtime: workerRuntime,
      listActiveUserIds: async () => [scenario.actorUserId]
    });
    const result = await collectExternalBriefingContributions({
      manifests: [realManifest],
      selectedToolNames: [realManifest.briefing!.toolName],
      section: "morning",
      actorUserId: scenario.actorUserId,
      requestId: `req-briefing-full-${scenario.profileId}`,
      invoke
    });
    expect(result).toEqual([
      {
        moduleId: realModuleId,
        headline: "4 new job matches in Staff Engineer search.",
        items: [90, 70, 50, 30].map((want) => ({
          id: expect.any(String),
          title: `Role Want ${want} at Acme`,
          detail: `Fit 70 · Want ${want}`,
          href: expect.stringMatching(
            new RegExp(`^/m/job-search/${scenario.profileId}/matches/.+$`)
          )
        }))
      }
    ]);
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
