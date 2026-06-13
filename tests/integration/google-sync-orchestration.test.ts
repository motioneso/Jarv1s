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

  it("a single DB-level upsert failure does NOT roll back OTHER upserts or fabricate counts", async () => {
    // HIGH: the whole sync runs in ONE outer transaction. Without per-item SAVEPOINTs, a single
    // DB-level error (here a CHECK violation: a calendar event whose start is AFTER its end) would
    // abort the transaction; the email upsert would then fail 25P02 (swallowed), yet the handler
    // returned non-zero counts and the outer COMMIT became a silent ROLLBACK — total data loss with
    // fabricated success. With SAVEPOINTs the bad event is confined: it's counted as an error, the
    // email upsert COMMITS, and the reported counts MATCH what is actually persisted.
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
              id: "bad-evt",
              summary: "Inverted times (CHECK violation)",
              // start AFTER end → ends_at >= starts_at CHECK fails on upsert.
              start: { dateTime: "2026-06-13T10:00:00Z" },
              end: { dateTime: "2026-06-13T09:00:00Z" }
            },
            {
              id: "good-evt",
              summary: "Valid event",
              start: { dateTime: "2026-06-13T11:00:00Z" },
              end: { dateTime: "2026-06-13T11:30:00Z" }
            }
          ],
          listMessageIds: async () => [{ id: "txn-msg-1" }],
          getMessage: async () => ({
            id: "txn-msg-1",
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "Subject", value: "Survives the bad calendar event" },
                { name: "From", value: "a@b.com" }
              ],
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

    // The bad event is recorded as an error, not silently dropped; the good event + the email are
    // upserted. Crucially the handler did NOT throw and did NOT fabricate counts.
    expect(result.errors).toContain("calendar-item-error");
    expect(result.calendarUpserted).toBe(1);
    expect(result.emailUpserted).toBe(1);

    // The reported counts MATCH the rows that actually committed (no silent rollback). Query the
    // specific external_ids this test created — the connector account is a singleton per user, so
    // events from sibling tests share the same account id.
    const persisted = await handles.dataContext.withDataContext(ctx, (db) =>
      Promise.all([
        db.db
          .selectFrom("app.calendar_events")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("external_id", "=", "good-evt")
          .executeTakeFirstOrThrow(),
        db.db
          .selectFrom("app.calendar_events")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("external_id", "=", "bad-evt")
          .executeTakeFirstOrThrow(),
        db.db
          .selectFrom("app.email_messages")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("external_id", "=", "txn-msg-1")
          .executeTakeFirstOrThrow()
      ])
    );
    expect(Number(persisted[0].n)).toBe(1); // the good event committed
    expect(Number(persisted[1].n)).toBe(0); // the bad event's savepoint rolled back — not persisted
    expect(Number(persisted[2].n)).toBe(1); // the email survived the bad calendar upsert
  });

  it("skips all-day / missing-time events instead of fabricating 1970-epoch instants", async () => {
    // MED: an all-day event (date, no time) must NOT map to UTC midnight via a 1970 epoch, and an
    // event missing start/end must be SKIPPED rather than producing end < start (CHECK landmine).
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/calendar"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    const result = await handles.dataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["calendar"] }),
        googleClient: {
          listCalendarEvents: async () => [
            {
              // All-day event: Google sends `date` (exclusive end). Must produce a valid range.
              id: "allday-1",
              summary: "All-day offsite",
              start: { date: "2026-06-20" },
              end: { date: "2026-06-21" }
            },
            {
              // Missing end entirely → skipped, NOT fabricated as a 1970-epoch end.
              id: "no-end-1",
              summary: "Broken event",
              start: { dateTime: "2026-06-20T09:00:00Z" }
            }
          ],
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
    // Only the all-day event is upserted; the malformed one is skipped (no error, no fabrication).
    expect(result.calendarUpserted).toBe(1);
    expect(result.errors).toEqual([]);
    const row = await handles.dataContext.withDataContext(ctx, (db) =>
      db.db
        .selectFrom("app.calendar_events")
        .selectAll()
        .where("external_id", "=", "allday-1")
        .executeTakeFirstOrThrow()
    );
    // The all-day range is valid (end > start) and NOT the 1970 epoch.
    const starts = new Date((row as { starts_at: Date | string }).starts_at).getTime();
    const ends = new Date((row as { ends_at: Date | string }).ends_at).getTime();
    expect(ends).toBeGreaterThan(starts);
    expect(starts).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());
    expect((row as { external_metadata: { allDay?: boolean } }).external_metadata.allDay).toBe(
      true
    );
    // The malformed missing-end event was never persisted.
    const broken = await handles.dataContext.withDataContext(ctx, (db) =>
      db.db
        .selectFrom("app.calendar_events")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("external_id", "=", "no-end-1")
        .executeTakeFirstOrThrow()
    );
    expect(Number(broken.n)).toBe(0);
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

  it("a mid-loop 401 rotates the token for ALL remaining messages (no per-message re-refresh)", async () => {
    // LOW: when one message 401s and the forced refresh succeeds, the rotated token must be carried
    // forward (shared holder), so every later message uses the fresh token rather than 401ing and
    // refreshing again. Here only the FIRST getMessage on the stale token 401s; with the holder,
    // exactly ONE refresh occurs even though there are several messages.
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    let refreshes = 0;
    let staleHits = 0;
    const msg = (id: string) => ({
      id,
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "S" },
          { name: "From", value: "a@b.com" }
        ],
        body: { data: Buffer.from("hi").toString("base64") }
      }
    });
    const result = await handles.dataContext.withDataContext(ctx, (db) =>
      runGoogleSync(db, {
        getFreshAccessToken: async (_db, opts) => {
          if (opts?.force) refreshes += 1;
          return opts?.force ? "fresh-tok" : "stale-tok";
        },
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [],
          listMessageIds: async () => [{ id: "loop-1" }, { id: "loop-2" }, { id: "loop-3" }],
          getMessage: async ({ accessToken, id }) => {
            if (accessToken === "stale-tok") {
              staleHits += 1;
              const e = new Error("Google gmail returned 401") as Error & { statusCode: number };
              e.statusCode = 401;
              throw e;
            }
            return msg(id);
          }
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    // Exactly one refresh (the first 401), and the stale token is hit exactly once — later messages
    // reuse the fresh token instead of re-401ing per message.
    expect(refreshes).toBe(1);
    expect(staleHits).toBe(1);
    expect(result.emailUpserted).toBe(3);
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
