import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { AiRepository, aiExplainRecentErrorsExecute } from "@jarv1s/ai";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("jarvis error log", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repo: AiRepository;

  beforeAll(async () => {
    await resetFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    dataContext = new DataContextRunner(appDb);
    repo = new AiRepository();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("records and lists only the actor's own errors", async () => {
    const ownId = randomUUID();
    const otherId = randomUUID();

    await dataContext.withDataContext({ actorUserId: ids.userA, requestId: "req-a" }, (scopedDb) =>
      repo.recordError(scopedDb, {
        id: ownId,
        feature: "sports",
        operation: "GET /api/sports",
        errorCategory: "request_failed",
        retryable: true,
        userMessage: "Scores are temporarily unavailable",
        internalSummary: "Route returned a 503",
        requestId: "req-a"
      })
    );

    await dataContext.withDataContext({ actorUserId: ids.userB, requestId: "req-b" }, (scopedDb) =>
      repo.recordError(scopedDb, {
        id: otherId,
        feature: "sports",
        operation: "GET /api/sports",
        errorCategory: "request_failed",
        retryable: false,
        userMessage: "Other user error",
        internalSummary: "Must not leak",
        requestId: "req-b"
      })
    );

    const rows = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-list" },
      (scopedDb) => repo.listRecentErrors(scopedDb, { query: "sports", limit: 20 })
    );

    expect(rows.map((row) => row.id)).toContain(ownId);
    expect(rows.map((row) => row.id)).not.toContain(otherId);
  });

  it("rejects a stack field structurally", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-stack" },
      async (scopedDb) => {
        await repo.recordError(scopedDb, {
          id: randomUUID(),
          feature: "client",
          operation: "POST /api/errors",
          errorCategory: "client_error",
          retryable: false,
          userMessage: "The page hit an error",
          internalSummary: "Client reported react_error",
          requestId: "req-stack",
          // @ts-expect-error stack is intentionally not accepted at the persistence boundary.
          stack: "Error: secret"
        });
      }
    );
  });

  it("schema has no stack, payload, header, cookie, or prompt columns", async () => {
    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const result = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'jarvis_error_log'`
      );
      const names = result.rows.map((row) => row.column_name);
      expect(names).not.toContain("stack");
      expect(names).not.toContain("request_body");
      expect(names).not.toContain("headers");
      expect(names).not.toContain("cookies");
      expect(names).not.toContain("prompt");
    } finally {
      await client.end();
    }
  });

  it("anonymous rows are insertable through the security definer but invisible to user reads", async () => {
    const id = randomUUID();
    await repo.recordAnonymousError(appDb, {
      id,
      feature: "client",
      operation: "POST /api/errors",
      errorCategory: "client_error",
      retryable: false,
      userMessage: "The page hit an error",
      internalSummary: "Client reported uncaught_error",
      requestId: "anon-1"
    });

    const rows = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-list-anon" },
      (scopedDb) => repo.listRecentErrors(scopedDb, { query: "client", limit: 50 })
    );

    expect(rows.map((row) => row.id)).not.toContain(id);
  });

  it("runtime cannot insert anonymous rows directly", async () => {
    await expect(
      appDb
        .insertInto("app.jarvis_error_log")
        .values({
          id: randomUUID(),
          owner_user_id: null,
          feature: "client",
          operation: "POST /api/errors",
          error_category: "client_error",
          retryable: false,
          user_message: "The page hit an error",
          internal_summary: "Direct anonymous insert must fail",
          request_id: "direct-anon"
        })
        .execute()
    ).rejects.toThrow();
  });

  it("assistant tool returns bounded recent matching errors", async () => {
    await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-tool-seed" },
      (scopedDb) =>
        repo.recordError(scopedDb, {
          id: randomUUID(),
          feature: "sports",
          operation: "GET /api/sports/scores",
          errorCategory: "upstream_provider_unavailable",
          retryable: true,
          userMessage: "Scores are temporarily unavailable for some leagues",
          internalSummary: "Provider returned partial league data",
          requestId: "req-tool-seed"
        })
    );

    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-tool" },
      (scopedDb) =>
        aiExplainRecentErrorsExecute(
          scopedDb,
          { query: "sports scores", limit: 5 },
          { actorUserId: ids.userA, requestId: "req-tool", chatSessionId: "" }
        )
    );

    expect(result.data.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: "sports",
          operation: "GET /api/sports/scores",
          errorCategory: "upstream_provider_unavailable",
          retryable: true
        })
      ])
    );
    expect(JSON.stringify(result.data)).not.toContain("stack");
  });

  it("assistant tool says when no diagnostic data exists", async () => {
    const result = await dataContext.withDataContext(
      { actorUserId: ids.userA, requestId: "req-tool-empty" },
      (scopedDb) =>
        aiExplainRecentErrorsExecute(
          scopedDb,
          { query: "not-real-feature", limit: 5 },
          { actorUserId: ids.userA, requestId: "req-tool-empty", chatSessionId: "" }
        )
    );

    expect(result.data).toEqual({
      errors: [],
      message:
        "No matching structured error data was found. The feature may not have emitted instrumentation for this error yet."
    });
  });
});
