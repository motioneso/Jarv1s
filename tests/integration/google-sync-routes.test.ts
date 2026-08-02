import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  GOOGLE_EMAIL_CHUNK_SIZE,
  GOOGLE_SYNC_CONTINUATION_QUEUE,
  GOOGLE_SYNC_EXPIRE_SECONDS,
  GOOGLE_SYNC_QUEUE,
  GOOGLE_SYNC_QUEUE_DEFINITIONS,
  handleGoogleSyncJob,
  registerConnectorsRoutes,
  type GoogleSyncChunkOutcome,
  type GoogleSyncContinuationPayload,
  type GoogleSyncPayload
} from "@jarv1s/connectors";
import { ALLOWED_PAYLOAD_KEYS } from "@jarv1s/jobs";
import { getAllQueueDefinitions } from "@jarv1s/module-registry";
import { googleSyncRouteSchema, type GoogleSyncResponse } from "@jarv1s/shared";
import { ids } from "./test-database.js";
import { handles } from "./helpers/google-sync-orchestration.js";

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
