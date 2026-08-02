import { describe, expect, it, vi } from "vitest";
import {
  EmailRepository,
  PreferencesRepository,
  featureGrantsPrefKey,
  handles,
  ids,
  runGoogleSync,
  runGoogleSyncChunk,
  seedGoogleAccount
} from "./helpers/google-sync-orchestration.js";

describe("runGoogleSync email orchestration", () => {
  it("evaluates nine recent messages as sequential 8+1 continuation chunks", async () => {
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test-google-email-continuation" };
    const pages = {
      first: Array.from({ length: 8 }, (_, index) => ({ id: `bounded-${index}` })),
      second: [{ id: "bounded-8" }]
    };
    let activeExtractions = 0;
    let maxActiveExtractions = 0;
    const listMessageIdsPage = vi.fn(async ({ pageToken }: { pageToken?: string }) =>
      pageToken === "MAIL_PAGE_2"
        ? { messages: pages.second }
        : { messages: pages.first, nextPageToken: "MAIL_PAGE_2" }
    );
    const deps = {
      getFreshAccessToken: async () => "tok",
      getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
      googleClient: {
        listCalendarEvents: async () => [],
        listMessageIds: async () => [...pages.first, ...pages.second],
        listMessageIdsPage,
        getMessage: async ({ id }: { id: string }) => ({
          id,
          historyId: `history-${id}`,
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "Subject", value: id },
              { name: "From", value: "sender@example.test" }
            ],
            body: { data: Buffer.from("Please review this.").toString("base64") }
          }
        })
      },
      emailExtractDeps: {
        selectModel: async () => ({ tier: "economy" }),
        runChat: async () => {
          activeExtractions += 1;
          maxActiveExtractions = Math.max(maxActiveExtractions, activeExtractions);
          await Promise.resolve();
          activeExtractions -= 1;
          return {
            text: JSON.stringify({
              summary: "Review requested.",
              billsDue: [],
              actionItems: [],
              deadlines: [],
              actionability: { category: "fyi" },
              mayGetLostInShuffle: false,
              importance: "normal",
              confidence: 0.9
            })
          };
        }
      }
    };

    const first = await handles.workerDataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSyncChunk(scopedDb, deps)
    );
    expect(first.result.emailUpserted).toBe(8);
    expect(first.continuation).toMatchObject({ phase: "email", cursor: "MAIL_PAGE_2" });

    const second = await handles.workerDataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSyncChunk(scopedDb, deps, first.continuation)
    );
    expect(second.result.emailUpserted).toBe(9);
    expect(second.continuation).toBeUndefined();
    expect(listMessageIdsPage).toHaveBeenCalledTimes(2);
    expect(maxActiveExtractions).toBe(1);
  });

  it("processes every message returned by Gmail", async () => {
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test-uncapped-google-email" };
    const messages = Array.from({ length: 51 }, (_, index) => ({ id: `uncapped-${index}` }));

    const result = await handles.workerDataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [],
          listMessageIds: async () => messages,
          getMessage: async ({ id }) => ({
            id,
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "Subject", value: id },
                { name: "From", value: "sender@example.com" }
              ],
              body: { data: Buffer.from("body").toString("base64") }
            }
          })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        }
      })
    );

    expect(result.emailUpserted).toBe(51);
    expect(result.truncated).toBe(false);
  });

  it("skips email sync when the account email grant is off", async () => {
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const ctx = { actorUserId: ids.userA, requestId: "pgboss:test" };
    await handles.dataContext.withDataContext(ctx, (db) =>
      new PreferencesRepository().upsert(db, featureGrantsPrefKey(accountId), {
        email: false,
        calendar: true
      })
    );

    let calendarCalls = 0;
    let emailCalls = 0;
    const result = await handles.workerDataContext.withDataContext(ctx, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "tok",
        getActiveAccount: async () => ({ id: accountId, scopes: ["calendar", "gmail"] }),
        googleClient: {
          listCalendarEvents: async () => {
            calendarCalls += 1;
            return [];
          },
          listMessageIds: async () => {
            emailCalls += 1;
            return [];
          },
          getMessage: async () => ({ id: "x" })
        },
        emailExtractDeps: {
          selectModel: async () => undefined,
          runChat: async () => ({ text: "" })
        },
        now: () => new Date("2026-06-13T12:00:00.000Z")
      })
    );
    await handles.dataContext.withDataContext(ctx, (db) =>
      new PreferencesRepository().upsert(db, featureGrantsPrefKey(accountId), {
        email: true,
        calendar: true
      })
    );

    expect(calendarCalls).toBe(1);
    expect(emailCalls).toBe(0);
    expect(result.calendarUpserted).toBe(0);
    expect(result.emailUpserted).toBe(0);
    expect(result.errors).toEqual([]);
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
        threadId: "thread-1",
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
        return {
          text: JSON.stringify({
            summary: "ok",
            confidence: 0.9,
            actionability: { category: "fyi", reason: "Informational." }
          })
        };
      }
    };
    const run = () =>
      handles.workerDataContext.withDataContext(ctx, (db) =>
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

    const cached = await handles.dataContext.withDataContext(ctx, (db) =>
      new EmailRepository().getByConnectorAccountAndExternalId(db, accountId, "hist-1")
    );
    expect(cached?.external_metadata).toMatchObject({ threadId: "thread-1" });
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
    await handles.workerDataContext.withDataContext(ctx, (db) =>
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
    const result = await handles.workerDataContext.withDataContext(ctx, (db) =>
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
    await handles.workerDataContext.withDataContext(ctx, (scopedDb) =>
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
