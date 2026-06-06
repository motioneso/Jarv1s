import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type { PgBoss } from "pg-boss";

import { DataContextRunner } from "../../auth-rls-safety/src/data-context.js";
import { createDatabase } from "../../auth-rls-safety/src/database.js";
import { RlsProbeRepository } from "../../auth-rls-safety/src/rls-probe-repository.js";
import {
  ids,
  connectionStrings,
  resetSpikeDatabase
} from "../../auth-rls-safety/test/test-database.js";
import { createPgBoss, RLS_PROBE_QUEUE, type RlsProbeJobPayload } from "../src/pg-boss-config.js";
import { resetPgBossDatabase } from "./pg-boss-test-database.js";

const { Client } = pg;

describe("pg-boss worker RLS posture spike", () => {
  let appBoss: PgBoss;
  let workerBoss: PgBoss;

  beforeEach(async () => {
    await resetSpikeDatabase();
    await resetPgBossDatabase();

    appBoss = createPgBoss(connectionStrings.app);
    workerBoss = createPgBoss(connectionStrings.worker);

    await appBoss.start();
    await workerBoss.start();
  });

  afterEach(async () => {
    await Promise.allSettled([
      appBoss?.stop({ graceful: false }),
      workerBoss?.stop({ graceful: false })
    ]);
  });

  it("runs API and worker pg-boss clients without runtime migration privileges", async () => {
    await expect(appBoss.schemaVersion()).resolves.toBeGreaterThan(0);
    await expect(workerBoss.schemaVersion()).resolves.toBeGreaterThan(0);

    await expect(appBoss.createQueue("runtime-created-queue")).rejects.toThrow(
      /permission denied/i
    );
  });

  it("processes a job through stored actor context without bypassing protected RLS", async () => {
    const resultPromise = handleNextProbeJob(workerBoss, ids.itemBPrivate);

    const jobId = await appBoss.send(RLS_PROBE_QUEUE, {
      actorUserId: ids.userA,
      targetItemId: ids.itemBPrivate
    } satisfies RlsProbeJobPayload);

    const result = await resultPromise;

    expect(jobId).toBeTypeOf("string");
    expect(result.targetItemVisible).toBe(false);
    expect(result.ownItemVisible).toBe(true);
    expect(result.grantedItemVisible).toBe(true);
  });

  it("allows workspace-scoped pg-boss jobs only for workspace-shared rows", async () => {
    const resultPromise = handleNextProbeJob(workerBoss, ids.itemBWorkspaceShared);

    await appBoss.send(RLS_PROBE_QUEUE, {
      actorUserId: ids.userA,
      workspaceId: ids.workspaceAlpha,
      targetItemId: ids.itemBWorkspaceShared
    } satisfies RlsProbeJobPayload);

    const result = await resultPromise;

    expect(result.targetItemVisible).toBe(true);
    expect(result.workspacePrivateItemVisible).toBe(false);
  });

  it("keeps pg-boss metadata outside protected app tables and payloads minimal", async () => {
    await appBoss.send(RLS_PROBE_QUEUE, {
      actorUserId: ids.userA,
      targetItemId: ids.itemBPrivate
    } satisfies RlsProbeJobPayload);

    const client = new Client({ connectionString: connectionStrings.superuser });
    await client.connect();
    try {
      const metadata = await client.query<{
        schema_name: string;
        table_name: string;
      }>(
        `
          SELECT table_schema AS schema_name, table_name
          FROM information_schema.tables
          WHERE table_schema IN ('app', 'pgboss')
            AND table_name IN ('rls_probe_items', 'job_common')
          ORDER BY table_schema, table_name
        `
      );

      const payloads = await client.query<{ data: Record<string, unknown> }>(
        `
          SELECT data
          FROM pgboss.job_common
          WHERE name = $1
        `,
        [RLS_PROBE_QUEUE]
      );

      expect(metadata.rows).toEqual([
        { schema_name: "app", table_name: "rls_probe_items" },
        { schema_name: "pgboss", table_name: "job_common" }
      ]);
      expect(payloads.rows[0]?.data).toEqual({
        actorUserId: ids.userA,
        targetItemId: ids.itemBPrivate
      });
      expect(payloads.rows[0]?.data).not.toHaveProperty("body");
    } finally {
      await client.end();
    }
  });
});

interface ProbeJobResult {
  targetItemVisible: boolean;
  ownItemVisible: boolean;
  grantedItemVisible: boolean;
  workspacePrivateItemVisible: boolean;
}

async function handleNextProbeJob(
  workerBoss: PgBoss,
  expectedTargetItemId: string
): Promise<ProbeJobResult> {
  const workerDb = createDatabase({
    connectionString: connectionStrings.worker,
    maxConnections: 1
  });
  const dataContext = new DataContextRunner(workerDb);
  const repository = new RlsProbeRepository();

  try {
    return await new Promise<ProbeJobResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for pg-boss worker"));
      }, 10_000);

      workerBoss
        .work<RlsProbeJobPayload>(
          RLS_PROBE_QUEUE,
          { pollingIntervalSeconds: 0.5 },
          async ([job]) => {
            try {
              if (!job) {
                throw new Error("pg-boss worker invoked without a job");
              }

              expect(job?.data.targetItemId).toBe(expectedTargetItemId);

              const result = await dataContext.withDataContext(
                {
                  actorUserId: job.data.actorUserId,
                  workspaceId: job.data.workspaceId ?? null,
                  requestId: `pgboss:${job.id}`
                },
                async (scopedDb) => {
                  const [targetItem, ownItem, grantedItem, workspacePrivateItem] =
                    await Promise.all([
                      repository.getById(scopedDb, job.data.targetItemId),
                      repository.getById(scopedDb, ids.itemAOwnPrivate),
                      repository.getById(scopedDb, ids.itemBGrantedToA),
                      repository.getById(scopedDb, ids.itemBWorkspacePrivate)
                    ]);

                  return {
                    targetItemVisible: targetItem !== undefined,
                    ownItemVisible: ownItem !== undefined,
                    grantedItemVisible: grantedItem !== undefined,
                    workspacePrivateItemVisible: workspacePrivateItem !== undefined
                  };
                }
              );

              clearTimeout(timeout);
              resolve(result);
              return result;
            } catch (error) {
              clearTimeout(timeout);
              reject(error);
              throw error;
            }
          }
        )
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  } finally {
    await workerDb.destroy();
  }
}
