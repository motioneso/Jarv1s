import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import {
  CALENDAR_SCOPE,
  GMAIL_SCOPE,
  GOOGLE_EMAIL_CHUNK_SIZE,
  GOOGLE_SYNC_CONTINUATION_QUEUE,
  GOOGLE_SYNC_EXPIRE_SECONDS,
  GOOGLE_SYNC_QUEUE,
  GOOGLE_SYNC_QUEUE_DEFINITIONS,
  handleGoogleSyncJob,
  registerConnectorsRoutes,
  runGoogleSyncChunk,
  type GoogleSyncChunkOutcome,
  type GoogleSyncContinuationPayload,
  type GoogleSyncPayload
} from "@jarv1s/connectors";
import { ALLOWED_PAYLOAD_KEYS } from "@jarv1s/jobs";
import { getAllQueueDefinitions } from "@jarv1s/module-registry";
import { googleSyncRouteSchema, type GoogleSyncResponse } from "@jarv1s/shared";
import { PreferencesRepository } from "@jarv1s/structured-state";
import { ids } from "./test-database.js";
import {
  featureGrantsPrefKey,
  handles,
  seedGoogleAccount
} from "./helpers/google-sync-orchestration.js";

describe("google-sync queue contract", () => {
  it("uses an exclusive queue named connectors.google-sync", () => {
    expect(GOOGLE_SYNC_QUEUE).toBe("connectors.google-sync");
    const def = GOOGLE_SYNC_QUEUE_DEFINITIONS[0]!;
    expect(def.name).toBe(GOOGLE_SYNC_QUEUE);
    expect(def.options?.policy).toBe("exclusive");
  });

  it("registers a singleton continuation queue with a defensible sub-900-second bound", () => {
    const def = GOOGLE_SYNC_QUEUE_DEFINITIONS.find(
      (candidate) => candidate.name === GOOGLE_SYNC_CONTINUATION_QUEUE
    );
    expect(def?.options?.policy).toBe("singleton");
    expect(GOOGLE_SYNC_QUEUE_DEFINITIONS.map(({ options }) => options?.expireInSeconds)).toEqual([
      GOOGLE_SYNC_EXPIRE_SECONDS,
      GOOGLE_SYNC_EXPIRE_SECONDS
    ]);
    expect(GOOGLE_SYNC_EXPIRE_SECONDS).toBeLessThan(900);
    expect(10_000 + 30_000 + GOOGLE_EMAIL_CHUNK_SIZE * 50_000).toBeLessThan(
      GOOGLE_SYNC_EXPIRE_SECONDS * 1_000
    );
  });

  it("payload keys are all in the metadata-only allowlist", () => {
    const payload: GoogleSyncPayload = {
      actorUserId: "00000000-0000-0000-0000-000000000001",
      kind: "google-sync",
      idempotencyKey: "k"
    };
    for (const key of Object.keys(payload)) {
      expect(ALLOWED_PAYLOAD_KEYS.has(key)).toBe(true);
    }
  });

  it("continuation payload keys are all in the metadata-only allowlist", () => {
    const payload: GoogleSyncContinuationPayload = {
      actorUserId: "00000000-0000-0000-0000-000000000001",
      kind: "google-sync-continuation",
      idempotencyKey: "root-job",
      connectorAccountId: "00000000-0000-0000-0000-000000000002",
      phase: "email",
      cursor: "opaque-page-token",
      chunkIndex: 1,
      startedAt: "2026-08-01T00:00:00.000Z",
      calendarSeenSince: "2026-08-01T00:00:00.000Z",
      calendarUpserted: 0,
      calendarReconciled: 0,
      emailUpserted: 8,
      emailFailures: 0,
      escalations: 0,
      errors: []
    };
    for (const key of Object.keys(payload)) expect(ALLOWED_PAYLOAD_KEYS.has(key)).toBe(true);
  });
});

describe("google-sync continuation handoff", () => {
  it("commits before enqueue and reuses the deterministic child id on retry", async () => {
    const events: string[] = [];
    const sends: Array<{ queue: string; options?: { id?: string }; payload: unknown }> = [];
    const boss = {
      send: async (queue: string, payload: unknown, options?: { id?: string }) => {
        events.push("enqueue");
        sends.push({ queue, payload, options });
        return options?.id ?? "job";
      }
    } as never;
    const dataContext = {
      async withDataContext(_context: unknown, work: (db: never) => Promise<unknown>) {
        const result = await work({} as never);
        events.push("commit");
        return result;
      }
    } as never;
    const rootJobId = "00000000-0000-0000-0000-000000000132";
    const job = {
      id: rootJobId,
      data: { actorUserId: ids.userA, kind: "google-sync", idempotencyKey: "request" }
    } as never;
    const outcome: GoogleSyncChunkOutcome = {
      result: { calendarUpserted: 0, calendarReconciled: 0, emailUpserted: 8, errors: [] },
      continuation: {
        idempotencyKey: rootJobId,
        connectorAccountId: "00000000-0000-0000-0000-000000000002",
        phase: "email",
        cursor: "PAGE_2",
        chunkIndex: 1,
        startedAt: "2026-08-01T00:00:00.000Z",
        calendarSeenSince: "2026-08-01T00:00:00.000Z",
        calendarUpserted: 0,
        calendarReconciled: 0,
        emailUpserted: 8,
        emailFailures: 0,
        escalations: 0,
        errors: []
      }
    };

    await handleGoogleSyncJob(boss, dataContext, job, async () => outcome);
    await handleGoogleSyncJob(boss, dataContext, job, async () => outcome);

    expect(events.slice(0, 2)).toEqual(["commit", "enqueue"]);
    expect(sends[0]!.queue).toBe(GOOGLE_SYNC_CONTINUATION_QUEUE);
    expect(sends[0]!.payload).toMatchObject({
      actorUserId: ids.userA,
      kind: "google-sync-continuation",
      cursor: "PAGE_2"
    });
    expect(sends[0]!.options?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sends[1]!.options?.id).toBe(sends[0]!.options?.id);
  });

  it("projects the interactive first email page before queuing historical backfill", async () => {
    const accountId = await seedGoogleAccount(handles.dataContext, [CALENDAR_SCOPE, GMAIL_SCOPE]);
    const context = { actorUserId: ids.userA, requestId: "test:interactive-sync-first-page" };
    const preferencesRepository = new PreferencesRepository();
    await handles.dataContext.withDataContext(context, (scopedDb) =>
      preferencesRepository.upsert(scopedDb, featureGrantsPrefKey(accountId), {
        calendar: true,
        email: true
      })
    );

    const events: string[] = [];
    const sends: Array<{
      payload: GoogleSyncContinuationPayload;
      options: { id: string };
    }> = [];
    const taskCreate = vi.fn(async () => {
      events.push("project");
      return { id: "task-1" };
    });
    const firstPage = Array.from({ length: 8 }, (_, index) => ({ id: `interactive-${index}` }));
    const scheduledData: GoogleSyncPayload = {
      actorUserId: ids.userA,
      kind: "google-sync",
      idempotencyKey: `schedule:${ids.userA}`
    };
    const job: { id: string; data: GoogleSyncPayload } = {
      id: "00000000-0000-0000-0000-000000000327",
      data: scheduledData
    };
    const boss = {
      send: async (
        _queue: string,
        payload: GoogleSyncContinuationPayload,
        options: { id: string }
      ) => {
        events.push("enqueue-backfill");
        sends.push({ payload, options });
        return "continuation";
      }
    } as never;

    const runJob = (currentJob: typeof job) =>
      handleGoogleSyncJob(boss, handles.workerDataContext, currentJob as never, (scopedDb) =>
        runGoogleSyncChunk(scopedDb, {
          getFreshAccessToken: async () => "fixture-token",
          getActiveAccount: async () => ({ id: accountId, scopes: [CALENDAR_SCOPE, GMAIL_SCOPE] }),
          googleClient: {
            listCalendarEvents: async () => [],
            listMessageIds: async () => firstPage,
            listMessageIdsPage: async () => ({
              messages: firstPage,
              nextPageToken: "HISTORICAL_PAGE_2"
            }),
            getMessage: async ({ id }) => ({
              id,
              historyId: `history-${id}`,
              internalDate: String(Date.parse("2026-08-01T04:00:00.000Z")),
              payload: {
                mimeType: "text/plain",
                headers: [
                  { name: "Subject", value: "Approval needed" },
                  { name: "From", value: "sender@example.test" }
                ],
                body: { data: Buffer.from("Please approve this today.").toString("base64") }
              }
            })
          },
          emailExtractDeps: {
            runChat: async (_prompt, _signal, batchSize = 1) => ({
              text: JSON.stringify({
                results: Array.from({ length: batchSize }, (_, index) => ({
                  index,
                  value: {
                    summary: "Approval is needed today.",
                    billsDue: [],
                    actionItems: [],
                    deadlines: [],
                    mayGetLostInShuffle: true,
                    importance: "high",
                    confidence: 0.95,
                    actionability: {
                      category: "needs_action",
                      reason: "The sender requested approval.",
                      inferredSubject: "Approval",
                      suggestedTasks: [{ text: "Approve the request" }]
                    }
                  }
                }))
              })
            })
          },
          actionProjection: {
            taskPort: { create: taskCreate },
            preferencesRepository,
            actorUserId: ids.userA
          },
          runId: currentJob.id,
          now: () => new Date("2026-08-01T04:00:00.000Z")
        })
      );
    const result = await runJob(job);

    expect(result).toMatchObject({ emailFailures: 0, emailUpserted: 8, truncated: true });
    expect(taskCreate).toHaveBeenCalled();
    expect(events[0]).toBe("project");
    expect(events.at(-1)).toBe("enqueue-backfill");
    expect(sends[0]!.payload).toMatchObject({
      cursor: "HISTORICAL_PAGE_2",
      chunkIndex: 1,
      idempotencyKey: job.id
    });

    const nextOccurrence = {
      ...job,
      id: "00000000-0000-0000-0000-000000000328"
    };
    await runJob(nextOccurrence);
    expect(nextOccurrence.data).toEqual(job.data);
    expect(sends[1]!.payload.idempotencyKey).toBe(nextOccurrence.id);
    expect(sends[1]!.options.id).not.toBe(sends[0]!.options.id);
  });
});

describe("google-sync route schema (G1)", () => {
  it("exposes a 202 google-sync route schema with enqueued/deduped/jobId", () => {
    expect(googleSyncRouteSchema.response[202]).toBeDefined();
    const r: GoogleSyncResponse = { enqueued: true, deduped: false, jobId: "j" };
    expect(r.enqueued).toBe(true);
    const d: GoogleSyncResponse = { enqueued: false, deduped: true, jobId: null };
    expect(d.deduped).toBe(true);
  });
});

function fakeBoss(captured: {
  sends: Array<{ queue: string; payload: Record<string, unknown>; options?: unknown }>;
}) {
  return {
    send: async (queue: string, payload: unknown, options?: unknown) => {
      captured.sends.push({
        queue,
        payload: payload as Record<string, unknown>,
        options
      });
      return "job-1";
    }
  } as never;
}

describe("POST /api/connectors/google/sync route (G2)", () => {
  it("enqueues one metadata-only job and returns 202", async () => {
    const captured = {
      sends: [] as Array<{ queue: string; payload: Record<string, unknown>; options?: unknown }>
    };
    const server = Fastify();
    registerConnectorsRoutes(server, {
      resolveAccessContext: async () => ({ actorUserId: ids.userA, requestId: "r" }),
      dataContext: handles.dataContext,
      boss: fakeBoss(captured)
    });
    await server.ready();
    const res = await server.inject({ method: "POST", url: "/api/connectors/google/sync" });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body) as GoogleSyncResponse;
    expect(body.enqueued).toBe(true);
    expect(body.deduped).toBe(false);
    expect(captured.sends).toHaveLength(1);
    expect(captured.sends[0]!.queue).toBe("connectors.google-sync");
    expect(Object.keys(captured.sends[0]!.payload).sort()).toEqual([
      "actorUserId",
      "idempotencyKey",
      "kind"
    ]);
    await server.close();
  });

  it("returns enqueued=false/deduped=true when an actor sync is already in flight (null jobId)", async () => {
    // A singletonKey collision makes sendJob resolve to null (briefings precedent,
    // packages/jobs/src/pg-boss.ts). The route must report dedupe, NOT a phantom enqueue.
    const server = Fastify();
    registerConnectorsRoutes(server, {
      resolveAccessContext: async () => ({ actorUserId: ids.userA, requestId: "r" }),
      dataContext: handles.dataContext,
      boss: { send: async () => null } as never
    });
    await server.ready();
    const res = await server.inject({ method: "POST", url: "/api/connectors/google/sync" });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body) as GoogleSyncResponse;
    expect(body.enqueued).toBe(false);
    expect(body.deduped).toBe(true);
    expect(body.jobId).toBeNull();
    await server.close();
  });
});

describe("module-registry wiring (G3)", () => {
  it("registers the connectors.google-sync queue globally", () => {
    const names = getAllQueueDefinitions().map((q) => q.name);
    expect(names).toContain("connectors.google-sync");
  });
});
