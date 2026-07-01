/**
 * IMAP sync worker boundary regression (#642 / PR #657 security QA blocker).
 *
 * The scheduled IMAP job previously enqueued a payload of only { connectorAccountId }.
 * registerDataContextWorker calls `toAccessContext(job)` BEFORE the handler body runs, which
 * throws `missing actorUserId` when the payload lacks actorUserId — so every scheduled IMAP
 * sync died before runImapSync could load its account.
 *
 * This test drives the EXACT payload that reconcileImapAccountSchedule enqueues through the REAL
 * registerImapSyncWorker → toAccessContext boundary (via a minimal pg-boss stub, no DB) and
 * asserts a valid AccessContext is derived. It fails loudly if the scheduled payload ever again
 * drops actorUserId.
 */

import { describe, expect, it } from "vitest";
import type { Job, PgBoss, WorkHandler } from "pg-boss";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import {
  registerImapSyncWorker,
  type ImapSyncPayload,
  type ImapSyncResult
} from "@jarv1s/connectors";

import { reconcileImapAccountSchedule } from "../../packages/connectors/src/imap-schedule.js";

const ACTOR = "00000000-0000-4000-8000-000000000042";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

const CANNED_RESULT: ImapSyncResult = {
  emailUpserted: 0,
  emailFailures: 0,
  errors: [],
  truncated: false
};

describe("IMAP scheduled payload survives the worker/toAccessContext boundary", () => {
  it("derives a valid AccessContext (actorUserId present) instead of throwing missing actorUserId", async () => {
    // 1. Capture the exact payload reconcileImapAccountSchedule enqueues.
    let scheduledPayload: ImapSyncPayload | undefined;
    const scheduleBoss = {
      schedule: (_q: string, _cron: string, data: ImapSyncPayload) => {
        scheduledPayload = data;
        return Promise.resolve(undefined);
      },
      unschedule: () => Promise.resolve(undefined)
    } as unknown as PgBoss;
    await reconcileImapAccountSchedule(scheduleBoss, ACTOR, ACCOUNT, true);
    expect(scheduledPayload).toBeDefined();

    // 2. Register the REAL IMAP worker against a stub boss that captures the work handler.
    let capturedHandler: WorkHandler<ImapSyncPayload> | undefined;
    const workerBoss = {
      work: (_q: string, _o: unknown, handler: WorkHandler<ImapSyncPayload>) => {
        capturedHandler = handler;
        return Promise.resolve("stub-work-id");
      }
    } as unknown as PgBoss;

    // 3. Stub DataContextRunner: record the AccessContext toAccessContext derives, and do NOT
    //    invoke the handler body (which would need a real DB) — the boundary under test is
    //    toAccessContext, evaluated as withDataContext's first argument.
    let capturedCtx: AccessContext | undefined;
    const dataContext = {
      withDataContext: (ctx: AccessContext, _cb: (db: DataContextDb) => unknown) => {
        capturedCtx = ctx;
        return Promise.resolve(CANNED_RESULT);
      }
    } as unknown as DataContextRunner;

    await registerImapSyncWorker(workerBoss, { dataContext });
    expect(capturedHandler).toBeDefined();

    // 4. Feed the scheduled payload through the worker handler — must resolve, not reject.
    const job = {
      id: "22222222-2222-4222-8222-222222222222",
      name: "connectors.imap-sync",
      data: scheduledPayload
    } as unknown as Job<ImapSyncPayload>;

    await expect(capturedHandler!([job])).resolves.toEqual(CANNED_RESULT);
    expect(capturedCtx?.actorUserId).toBe(ACTOR);
  });
});
