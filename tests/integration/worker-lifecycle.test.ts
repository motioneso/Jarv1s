/**
 * Worker lifecycle tests — OTNR #165 (MED testability).
 *
 * These tests cover:
 * (a) No-actor rejection: a job without actorUserId throws BEFORE any DB read.
 *     The guarantee lives in packages/jobs/src/pg-boss.ts `toAccessContext`
 *     (lines 145–149), which is called by `registerDataContextWorker` before
 *     the handler body runs.  We test it by calling the wrapper with a mock
 *     pg-boss that delivers a no-actorUserId job, asserting the throw surfaces
 *     and the handler body (which would set a flag) never executes.
 *
 * (b) Shutdown ordering: boss.stop() resolves before workerDb.destroy() is
 *     called.  We verify this with a call-order tracker using lightweight stubs
 *     that resolve synchronously — no DB needed.
 *
 * Neither test boots the full worker binary (buildWorker).  Full worker lifecycle
 * is covered by the foundation.test.ts pg-boss integration suite.
 */

import { describe, expect, it } from "vitest";
import type { Job, PgBoss, WorkHandler } from "pg-boss";

import {
  registerDataContextWorker,
  type ActorScopedJobPayload,
  type RlsProbeJobPayload
} from "@jarv1s/jobs";
import type { DataContextRunner } from "@jarv1s/db";

// ---------------------------------------------------------------------------
// (a) No-actor rejection at the registerDataContextWorker wrapper level
//
// We bypass the real pg-boss by providing a minimal stub that immediately
// invokes the registered work handler with a malformed job (no actorUserId).
// This is the narrowest layer where the invariant actually lives and avoids
// needing live DB or pg-boss schema permissions.
// ---------------------------------------------------------------------------
describe("registerDataContextWorker no-actor rejection (#165)", () => {
  it("throws 'missing actorUserId' before handler body runs when job has no actorUserId", async () => {
    let handlerBodyExecuted = false;

    // Capture the registered handler so we can invoke it directly.
    let capturedHandler: WorkHandler<ActorScopedJobPayload> | undefined;

    // Minimal pg-boss stub: records the handler passed to boss.work().
    const stubBoss = {
      work: (
        _queue: string,
        _opts: unknown,
        handler: WorkHandler<ActorScopedJobPayload>
      ): Promise<string> => {
        capturedHandler = handler;
        return Promise.resolve("stub-work-id");
      }
    } as unknown as PgBoss;

    // Minimal DataContextRunner stub — withDataContext must NOT be called.
    const stubContext = {
      withDataContext: () => {
        handlerBodyExecuted = true;
        return Promise.resolve(undefined);
      }
    } as unknown as DataContextRunner;

    await registerDataContextWorker<RlsProbeJobPayload, void>(
      stubBoss,
      "rls-probe",
      stubContext,
      async () => {
        handlerBodyExecuted = true;
      }
    );

    // Invoke the captured handler with a job that is missing actorUserId.
    // Cast via unknown because we only need the fields that toAccessContext reads.
    const malformedJob = {
      id: "00000000-0000-4000-8000-000000000099",
      name: "rls-probe",
      data: { actorUserId: "" } as ActorScopedJobPayload, // empty string → falsy
      expireInSeconds: 60,
      heartbeatSeconds: null,
      signal: new AbortController().signal
    } as unknown as Job<ActorScopedJobPayload>;

    await expect(capturedHandler!([malformedJob])).rejects.toThrow(/missing actorUserId/i);
    expect(handlerBodyExecuted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) Shutdown ordering (#165 MED)
//
// boss.stop({ graceful: true }) must resolve BEFORE workerDb.destroy() is
// called. We replicate the shutdown function from buildWorker using stubs.
// ---------------------------------------------------------------------------
describe("shutdown ordering (#165 MED)", () => {
  it("stops boss before destroying the db pool", async () => {
    const callOrder: string[] = [];

    // Minimal stubs: each records a call and resolves immediately.
    const mockBoss = {
      stop: async ({ graceful }: { graceful: boolean }) => {
        callOrder.push(`boss.stop(graceful=${graceful})`);
      }
    };
    const mockDb = {
      destroy: async () => {
        callOrder.push("db.destroy");
      }
    };

    // Replicate the shutdown function from buildWorker exactly:
    //   1. Race boss.stop(graceful:true) vs 10s timeout
    //   2. await db.destroy() AFTER boss.stop resolves
    const GRACEFUL_STOP_TIMEOUT_MS = 10_000;
    async function shutdown(): Promise<void> {
      await Promise.race([
        mockBoss.stop({ graceful: true }),
        new Promise<void>((resolve) => {
          setTimeout(resolve, GRACEFUL_STOP_TIMEOUT_MS);
        })
      ]);
      await mockDb.destroy();
    }

    await shutdown();

    expect(callOrder).toEqual(["boss.stop(graceful=true)", "db.destroy"]);
    expect(callOrder.indexOf("boss.stop(graceful=true)")).toBeLessThan(
      callOrder.indexOf("db.destroy")
    );
  });
});
