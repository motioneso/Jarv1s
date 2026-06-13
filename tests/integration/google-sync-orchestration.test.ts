import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  GOOGLE_SYNC_QUEUE,
  GOOGLE_SYNC_QUEUE_DEFINITIONS,
  registerConnectorsRoutes,
  runGoogleSync,
  type GoogleSyncPayload
} from "@jarv1s/connectors";
import { ALLOWED_PAYLOAD_KEYS } from "@jarv1s/jobs";
import { getAllQueueDefinitions } from "@jarv1s/module-registry";
import { googleSyncRouteSchema, type GoogleSyncResponse } from "@jarv1s/shared";
import { ids } from "./test-database.js";
import {
  seedGoogleAccount,
  setupGoogleSyncDatabase,
  teardownGoogleSyncDatabase,
  type GoogleSyncDatabaseHandles
} from "./helpers/google-sync-shared.js";

let handles: GoogleSyncDatabaseHandles;

beforeAll(async () => {
  handles = await setupGoogleSyncDatabase();
});

afterAll(async () => {
  await teardownGoogleSyncDatabase(handles);
});

describe("google-sync queue contract", () => {
  it("uses an exclusive queue named connectors.google-sync", () => {
    expect(GOOGLE_SYNC_QUEUE).toBe("connectors.google-sync");
    const def = GOOGLE_SYNC_QUEUE_DEFINITIONS[0]!;
    expect(def.name).toBe(GOOGLE_SYNC_QUEUE);
    expect(def.options?.policy).toBe("exclusive");
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
});

describe("runGoogleSync handler", () => {
  it("syncs calendar + email and returns metadata-only counts", async () => {
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    const result = await handles.dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["calendar", "gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [
            {
              id: "g1",
              summary: "Standup",
              start: { dateTime: "2026-06-13T09:00:00Z" },
              end: { dateTime: "2026-06-13T09:15:00Z" }
            }
          ],
          listMessageIds: async () => [{ id: "m1" }],
          getMessage: async () => ({
            id: "m1",
            payload: {
              headers: [
                { name: "Subject", value: "S" },
                { name: "From", value: "a@b.com" }
              ],
              mimeType: "text/plain",
              body: { data: Buffer.from("hi").toString("base64") }
            }
          })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    expect(result.calendarUpserted).toBe(1);
    expect(result.emailUpserted).toBe(1);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result)).not.toContain("accessToken");
  });

  it("records a no-active-connection error without throwing", async () => {
    const ctx = { actorUserId: ids.userB, requestId: "pgboss:test" };
    const result = await handles.dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => {
          throw new Error("No active Google connection");
        },
        getActiveAccount: async () => undefined,
        googleClient: {
          listCalendarEvents: async () => [],
          listMessageIds: async () => [],
          getMessage: async () => ({ id: "x" })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date()
      })
    );
    expect(result.errors).toContain("no-active-connection");
  });

  it("skips the LLM pass for a message whose historyId is unchanged since last sync", async () => {
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    let llmCalls = 0;
    const client = {
      listCalendarEvents: async () => [],
      listMessageIds: async () => [{ id: "hist-1" }],
      getMessage: async () => ({
        id: "hist-1",
        historyId: "H100",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Subject", value: "S" },
            { name: "From", value: "a@b.com" }
          ],
          body: { data: Buffer.from("hi").toString("base64") }
        }
      })
    };
    const extractDeps = {
      selectModel: async () => ({ tier: "economy" }),
      runChat: async () => {
        llmCalls += 1;
        return { text: JSON.stringify({ summary: "ok", confidence: 0.9 }) };
      }
    };
    const run = () =>
      handles.dataContext.withDataContext(ctx, (db) =>
        runGoogleSync(db, {
          getFreshAccessToken: async () => "tok",
          getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
          googleClient: client,
          emailExtractDeps: extractDeps,
          now: () => new Date("2026-06-13T12:00:00.000Z")
        })
      );
    await run(); // first sync: summarizes once, stores historyId H100 + a non-null summary
    await run(); // second sync: historyId unchanged AND summary present → skip the LLM pass
    expect(llmCalls).toBe(1);
  });

  it("re-summarizes an unchanged message that was first cached with NO summary", async () => {
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    const client = {
      listCalendarEvents: async () => [],
      listMessageIds: async () => [{ id: "hist-2" }],
      getMessage: async () => ({
        id: "hist-2",
        historyId: "H200",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Subject", value: "S" },
            { name: "From", value: "a@b.com" }
          ],
          body: { data: Buffer.from("hi").toString("base64") }
        }
      })
    };
    // First sync: NO model configured → summary stays null, historyId H200 stored.
    await handles.dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: client,
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    let llmCalls = 0;
    // Second sync: SAME historyId, but a model now exists and the prior summary is null →
    // must NOT skip; it summarizes this time.
    const result = await handles.dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: client,
        emailExtractDeps: {
          selectModel: async () => ({ tier: "economy" }),
          runChat: async () => {
            llmCalls += 1;
            return { text: JSON.stringify({ summary: "now summarized", confidence: 0.8 }) };
          }
        },
        now: () => new Date("2026-06-13T13:00:00.000Z")
      })
    );
    expect(llmCalls).toBe(1);
    expect(result.emailUpserted).toBe(1);
  });

  it("forces a token refresh and retries once on a 401 from a Google call", async () => {
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    let refreshes = 0;
    let calendarAttempts = 0;
    const result = await handles.dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async (_db, opts) => {
          if (opts?.force) refreshes += 1;
          return opts?.force ? "fresh-tok" : "stale-tok";
        },
        getActiveAccount: async () => ({ id: accountId, scopes: ["calendar"] }),
        googleClient: {
          listCalendarEvents: async ({ accessToken }) => {
            calendarAttempts += 1;
            if (accessToken === "stale-tok") {
              const e = new Error("Google calendar returned 401") as Error & { statusCode: number };
              e.statusCode = 401;
              throw e;
            }
            return [
              {
                id: "g1",
                summary: "X",
                start: { dateTime: "2026-06-13T09:00:00Z" },
                end: { dateTime: "2026-06-13T09:15:00Z" }
              }
            ];
          },
          listMessageIds: async () => [],
          getMessage: async () => ({ id: "x" })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    expect(refreshes).toBe(1);
    expect(calendarAttempts).toBe(2);
    expect(result.calendarUpserted).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("NEVER persists the full email body in any email_messages column (privacy posture)", async () => {
    // A full body LONGER than MAX_SUMMARY_CHARS (600). The fake model deliberately MISBEHAVES
    // and returns the ENTIRE body as the summary — the worst case. The persisted summary must
    // still be truncated below the cap, so the verbatim full body can never round-trip into a
    // column. (A model legitimately quoting a phrase is acceptable; persisting the whole body
    // verbatim is the invariant we defend.)
    const FULL_BODY = "SENTINEL-FULL-BODY-MUST-NOT-PERSIST-" + "x".repeat(900); // > 600 chars
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    await handles.dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [],
          listMessageIds: async () => [{ id: "sentinel-1" }],
          getMessage: async () => ({
            id: "sentinel-1",
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "Subject", value: "S" },
                { name: "From", value: "a@b.com" }
              ],
              body: { data: Buffer.from(FULL_BODY).toString("base64") }
            }
          })
        },
        // Misbehaving model: echoes the WHOLE body back as the summary.
        emailExtractDeps: {
          selectModel: async () => ({ tier: "economy" }),
          runChat: async () => ({ text: JSON.stringify({ summary: FULL_BODY, confidence: 0.9 }) })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    const row = await handles.dataContext.withDataContext(ctx, (db) =>
      db.db
        .selectFrom("app.email_messages")
        .selectAll()
        .where("external_id", "=", "sentinel-1")
        .executeTakeFirstOrThrow()
    );
    // The verbatim FULL body must not appear in ANY column (subject/snippet/body_excerpt/
    // summary/signals/external_metadata, all serialized).
    expect(JSON.stringify(row)).not.toContain(FULL_BODY);
    // The summary, if present, is hard-capped at MAX_SUMMARY_CHARS so it cannot be the full body.
    const summary = (row as { summary: string | null }).summary;
    expect((summary ?? "").length).toBeLessThanOrEqual(600);
    // body_excerpt is explicitly NOT written by sync (handler never passes it).
    expect((row as { body_excerpt: string | null }).body_excerpt).toBeNull();
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
